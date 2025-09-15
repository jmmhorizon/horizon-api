// server.js — JMM Horizon (IA siempre ON, límites, anti-spam y FAQs)
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ================== CONFIG ==================
const SITE_NAME = process.env.SITE_NAME || "JMM Horizon";
const OWNER_PHONE = process.env.OWNER_PHONE || "34636147135"; // sin '+'
const OWNER_EMAIL = process.env.OWNER_EMAIL || "info@jmmhorizon.com";

const MAX_MSGS_PER_SESSION = parseInt(process.env.MAX_MSGS_PER_SESSION || "50", 10); // límite mensajes
const COOLDOWN_MINUTES     = parseInt(process.env.COOLDOWN_MINUTES || "20", 10);     // espera tras tope
const RATE_LIMIT_PER_MIN   = parseInt(process.env.RATE_LIMIT_PER_MIN || "5", 10);    // anti-spam

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const ALLOW_AI       = true; // 🔥 IA SIEMPRE activada
if (!OPENAI_API_KEY) {
  console.warn("⚠️ Falta OPENAI_API_KEY. Añádela en Render → Environment para que la IA funcione.");
}

// ====== PLANES ======
const DEFAULT_PRICING = {
  basico: {
    name: "Básico — Web one-page",
    monthly: "35 €/mes",
    setup: "500 €",
    includes: [
      "Diseño y lanzamiento de página única",
      "Hosting y mantenimiento",
      "Cambios menores incluidos",
      "Sin chatbot / sin teléfono IA"
    ]
  },
  esencial: {
    name: "Chatbot Esencial",
    monthly: "120 €/mes",
    setup: "300 € (sin web)",
    includes: [
      "Chat en Web o WhatsApp",
      "1.000 chats/mes incluidos",
      "FAQs y formularios simples",
      "Soporte por email"
    ]
  },
  combo: {
    name: "Combo: Web + Chatbot",
    monthly: "155 €/mes",
    setup: "800 €",
    includes: [
      "Web one-page + chatbot en Web/WhatsApp",
      "1.000 chats/mes incluidos",
      "Hosting, mantenimiento y soporte"
    ]
  },
  premium: {
    name: "Premium — Web + Chat + Teléfono IA",
    monthly: "500 €/mes",
    setup: "1.500 €",
    includes: [
      "Asistente telefónico IA con voz natural",
      "1.000 min/mes incluidos",
      "Deriva a humano, agenda y avisos por WhatsApp/email",
      "Chat IA multicanal incluido"
    ],
    notes: ["Permanencia 12 meses"]
  }
};
let PRICING = DEFAULT_PRICING;
try {
  if (process.env.PRICING_JSON) PRICING = JSON.parse(process.env.PRICING_JSON);
} catch {}

// ================== UTILS ==================
const waLink = (msg = `Hola, vengo de la web de ${SITE_NAME}.`) =>
  `https://wa.me/${OWNER_PHONE}?text=${encodeURIComponent(msg)}`;
const telLink = `tel:+${OWNER_PHONE}`;
const sessions = new Map();

function nowMs() { return Date.now(); }
function msToMin(ms) { return Math.max(0, Math.ceil(ms / 60000)); }
function getSessionId(req){ return req.headers["x-session-id"] || req.ip || "anon"; }
function getSession(req){
  const id = getSessionId(req);
  if (!sessions.has(id)) sessions.set(id, { msgs: 0, cooldownUntil: 0, history: [] });
  return { id, data: sessions.get(id) };
}

const SHORT = new Set(["ok","vale","si","sí","no","hola","jaja","gracias","👍","👌","🤙","😊","😉"]);

// Filtro anti-spam
function prefilter(userMsg, session) {
  const txt = (userMsg || "").toLowerCase().trim();
  const now = nowMs();

  if (session.cooldownUntil && now < session.cooldownUntil) {
    const left = msToMin(session.cooldownUntil - now);
    return { blocked: true, text: `⏳ Alcanzaste ${MAX_MSGS_PER_SESSION} mensajes. Espera **${left} min** o WhatsApp: ${waLink()}` };
  }

  if (!txt || SHORT.has(txt)) {
    return { blocked: true, text: "😉 Entendido. ¿Quieres *precios*, *contacto* o *cómo funciona*?" };
  }

  session.history = (session.history || []).filter(ts => now - ts < 60000);
  if (session.history.length >= RATE_LIMIT_PER_MIN) {
    return { blocked: true, text: "🕒 Máximo 5 mensajes por minuto. Espera un momento." };
  }
  session.history.push(now);

  if (session.msgs >= MAX_MSGS_PER_SESSION) {
    session.cooldownUntil = now + COOLDOWN_MINUTES * 60 * 1000;
    return { blocked: true, text: `🚧 Límite de **${MAX_MSGS_PER_SESSION}**. Vuelve en **${COOLDOWN_MINUTES} min** o usa WhatsApp: ${waLink()}` };
  }
  return { blocked: false };
}

// Intenciones
function intentOf(text) {
  const t = (text || "").toLowerCase();
  if (/(whats?app|contacto|tel[eé]fono)/i.test(t)) return "contact";
  if (/(precio|plan|tarifa|mensual|anual|coste)/i.test(t)) return "pricing";
  if (/(b[aá]sico)/i.test(t)) return "basico";
  if (/(esencial)/i.test(t)) return "esencial";
  if (/(combo)/i.test(t)) return "combo";
  if (/(premium|tel[eé]fono ia|voz|llamada)/i.test(t)) return "premium";
  if (/(setup|instalaci[oó]n)/i.test(t)) return "setup";
  if (/(permanencia|contrato)/i.test(t)) return "permanencia";
  if (/(c[oó]mo funciona|funciona|implementaci[oó]n)/i.test(t)) return "how";
  if (/(email|correo)/i.test(t)) return "email";
  if (/(agente|humano|soporte)/i.test(t)) return "human";
  if (/(consumo|l[ií]mite|mensajes)/i.test(t)) return "usage";
  return "fallback";
}

// Textos
function blockPlan(p){
  return `💠 ${p.name}\n` +
         `  · Cuota: ${p.monthly}\n` +
         `  · Setup: ${p.setup}\n` +
         p.includes.map(x => `  · ${x}`).join("\n") +
         (p.notes?.length ? `\n  (${p.notes.join(" — ")})` : "");
}
function pricingAll(){
  return [
    blockPlan(PRICING.basico),
    blockPlan(PRICING.esencial),
    blockPlan(PRICING.combo),
    blockPlan(PRICING.premium)
  ].join("\n\n") + `\n\n¿Quieres que te recomiende el plan más conveniente?`;
}
function contactText(){
  return `📞 Tel: +${OWNER_PHONE} (llamar: ${telLink})\n💬 WhatsApp: ${waLink("Hola, quiero información y precios")}\n✉️ Email: ${OWNER_EMAIL}`;
}
function howText(){
  return `🧠 Pasos:\n1) Instalo widget en tu web\n2) Cargo FAQs/URLs/PDFs\n3) Capto leads y envío a Sheets/CRM\n4) Canales: Web/WhatsApp y, en Premium, Teléfono IA`;
}
function usageText(s){
  const left = Math.max(MAX_MSGS_PER_SESSION - s.msgs, 0);
  const cdLeft = s.cooldownUntil && nowMs() < s.cooldownUntil ? msToMin(s.cooldownUntil - nowMs()) : 0;
  return `📊 Mensajes: ${s.msgs}/${MAX_MSGS_PER_SESSION} (restan ${left})` + (cdLeft ? ` — Cooldown: ${cdLeft} min` : "");
}

// IA (OpenAI)
async function aiAnswer(prompt){
  if (!OPENAI_API_KEY) return null;
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: `Eres el asistente de ${SITE_NAME}. Usa estos datos oficiales: ${JSON.stringify(PRICING)}. Contacto: WhatsApp ${waLink()}, Tel +${OWNER_PHONE}, Email ${OWNER_EMAIL}. Sé claro y útil.` },
          { role: "user", content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 250
      })
    });
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch { return null; }
}

// ================== RUTAS ==================
app.get("/", (_, res) => res.send(`${SITE_NAME} API OK ✅`));
app.get("/about/pricing", (_req, res) => res.json({ ok: true, pricing: PRICING }));

app.post("/chat", async (req, res) => {
  const { id, data } = getSession(req);
  const userMsg = req.body?.message || "";

  const gate = prefilter(userMsg, data);
  if (gate.blocked)
    return res.json({ ok:true, sessionId:id, reply:{ text: gate.text }, usage:{ msgs:data.msgs, limit:MAX_MSGS_PER_SESSION, cooldownUntil:data.cooldownUntil||0 }});

  const intent = intentOf(userMsg);
  let text = "";
  switch (intent) {
    case "contact":     text = contactText(); break;
    case "pricing":     text = pricingAll(); break;
    case "basico":      text = blockPlan(PRICING.basico); break;
    case "esencial":    text = blockPlan(PRICING.esencial); break;
    case "combo":       text = blockPlan(PRICING.combo); break;
    case "premium":     text = blockPlan(PRICING.premium); break;
    case "setup":       text = "💳 Setups: " + Object.values(PRICING).map(p => `${p.name}: ${p.setup}`).join(" | "); break;
    case "permanencia": text = "Solo **Premium** tiene permanencia: **12 meses**."; break;
    case "how":         text = howText(); break;
    case "email":       text = `✉️ ${OWNER_EMAIL} o WhatsApp ${waLink()}`; break;
    case "human":       text = `Te paso con humano: ${waLink("Hola, quiero hablar con un agente")}`; break;
    case "usage":       text = usageText(data); break;
    default:
      text = await aiAnswer(userMsg) || "Puedo ayudarte con **precios**, **contacto** y **cómo funciona**. Dime: *precios*, *contacto*, *premium*, *combo*, *esencial* o *básico*.";
  }

  data.msgs += 1;
  if (data.msgs >= MAX_MSGS_PER_SESSION && !data.cooldownUntil) {
    data.cooldownUntil = nowMs() + COOLDOWN_MINUTES * 60 * 1000;
    text += `\n\n⚠️ Límite de ${MAX_MSGS_PER_SESSION} mensajes. Espera ${COOLDOWN_MINUTES} min o usa WhatsApp: ${waLink()}`;
  }

  res.json({ ok:true, sessionId:id, intent, reply:{ text }, usage:{ msgs:data.msgs, limit:MAX_MSGS_PER_SESSION, cooldownUntil:data.cooldownUntil||0 } });
});

// Puerto
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor escuchando en http://localhost:${PORT}`));
