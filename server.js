// server.js  — versión compatible con openai v4 usando require (CommonJS)
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const OpenAI = require("openai");

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Cliente OpenAI (SDK v4) — ¡sin Configuration!
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Endpoint de prueba rápida
app.get("/", (req, res) => {
  res.send("Horizon API OK ✅");
});

// Chat endpoint
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    // LOG para ver el flujo por consola
    console.log("🗣️ Usuario:", message);

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: message }],
    });

    const reply = completion.choices[0].message.content;
    console.log("🤖 Horizon:", reply);

    res.json({ reply });
  } catch (err) {
    console.error("❌ Error OpenAI:", err?.response?.data || err.message);
    res.status(500).json({ error: "Error al conectar con OpenAI" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Servidor escuchando en http://localhost:${PORT}`);
});

