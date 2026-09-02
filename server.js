import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const port = process.env.PORT || 3000;

const allowedOrigins = [
  "https://thausberg-cyber.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:5500"
];

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error("Origin not allowed"));
  }
}));
app.use(express.json({ limit: "12mb" }));

app.get("/", (req, res) => {
  res.json({ service: "look 'n build backend", version: "0.3.0", status: "ok" });
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/analyze", async (req, res) => {
  try {
    const { imageDataUrl, note = "" } = req.body || {};
    if (!imageDataUrl || typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
      return res.status(400).json({ error: "Kein gültiges Bild übergeben." });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY fehlt auf dem Server." });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `Du bist die Bildanalyse-Stufe von \"look 'n build\", einem Online-Workshop von HOBBYWOOD.\nAnalysiere ein Foto eines handwerklich nachbaubaren Gegenstands, mit Schwerpunkt Holz/Möbel/DIY.\n\nRegeln:\n- Erfinde keine Maße, Holzarten, Verbindungsmittel, Belastbarkeiten oder verdeckten Konstruktionen.\n- Trenne strikt zwischen sicher erkannt, plausibel vermutet und nicht erkennbar.\n- Sicherheitsrelevante Unklarheiten dürfen niemals als Tatsache ausgegeben werden.\n- Ziel ist noch NICHT die komplette Bauanleitung.\n- Ziel ist: Objekt erkennen, sichtbare Merkmale erfassen und die kleinste sinnvolle nächste Rückfrage bzw. Detailaufnahme bestimmen.\n- Formuliere auf Deutsch, knapp und handwerklich präzise.\n\nZusatzangabe des Nutzers:\n${note || "(keine)"}\n\nGib AUSSCHLIESSLICH valides JSON in genau dieser Struktur zurück:\n{\n  \"object\": \"kurze Objektbezeichnung\",\n  \"summary\": \"1-3 Sätze\",\n  \"recognized\": [{\"item\": \"...\", \"confidence\": \"hoch|mittel|niedrig\"}],\n  \"assumptions\": [{\"item\": \"...\", \"reason\": \"...\"}],\n  \"unknown\": [\"...\"],\n  \"next_request\": {\"type\": \"detail_photo|measurement|question|none\", \"instruction\": \"konkrete Anweisung an den Nutzer\"},\n  \"safety_notes\": [\"...\"]\n}`;

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: imageDataUrl }
        ]
      }]
    });

    const text = response.output_text?.trim();
    if (!text) return res.status(502).json({ error: "Die KI hat keine auswertbare Antwort geliefert." });

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
      parsed = JSON.parse(cleaned);
    }
    res.json(parsed);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Analyse fehlgeschlagen.", detail: error?.message || "Unbekannter Fehler" });
  }
});

app.listen(port, () => console.log(`look 'n build backend listening on port ${port}`));
