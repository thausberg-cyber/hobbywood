import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const port = process.env.PORT || 10000;
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";

app.use(cors({
  origin: [
    "https://thausberg-cyber.github.io",
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ]
}));
app.use(express.json({ limit: "35mb" }));

app.get("/", (req,res)=>res.json({ service:"look 'n build backend", version:"0.6.0", status:"ok" }));
app.get("/health", (req,res)=>res.json({ ok:true, version:"0.6.0" }));

function parseJsonText(text){
  const cleaned = text.trim().replace(/^```json\s*/i,"").replace(/```$/,"").trim();
  return JSON.parse(cleaned);
}

app.post("/analyze", async (req,res)=>{
  try{
    const { images=[], previousState=null, round=0 } = req.body || {};
    if(!Array.isArray(images) || images.length===0) return res.status(400).json({error:"images required"});
    const content = [
      {type:"input_text", text:
`Du bist die Bildanalyse-Stufe von "look 'n build", einem HOBBYWOOD-Werkstattassistenten.
Analysiere ALLE übergebenen Fotos gemeinsam als EIN Projekt. Berücksichtige den bisherigen Projektstand.
Erfinde keine Maße, Holzarten, verdeckten Verbindungen, Beschläge oder Tragfähigkeiten.
Trenne strikt: erkannt / vermutet / offen.
Fordere höchstens EINE gezielte nächste Information an. Wenn die Rekonstruktion bereits sinnvoll möglich ist, setze enough_information=true und next_request.type="done".
Normale Restunsicherheiten dürfen den Abschluss nicht blockieren. Sicherheitskritische Unsicherheit darf als safety note verbleiben und muss klar markiert werden.
Runde: ${round}
Bisheriger Projektstand: ${JSON.stringify(previousState)}
Antworte ausschließlich als JSON:
{
 "object":"...",
 "summary":"...",
 "recognized":["..."],
 "assumptions":["..."],
 "unknown":["..."],
 "safety_notes":["..."],
 "enough_information":true,
 "next_request":{"type":"done|detail_photo|measurement|question","prompt":"..."}
}` }
    ];
    for(const image_url of images){
      content.push({type:"input_image", image_url});
    }
    const response = await client.responses.create({ model, input:[{role:"user", content}] });
    const data = parseJsonText(response.output_text);
    res.json(data);
  }catch(err){
    console.error(err);
    res.status(500).json({error:"analysis_failed", detail:err?.message||String(err)});
  }
});

app.post("/reconstruct", async (req,res)=>{
  try{
    const { analysis, images=[] } = req.body || {};
    if(!analysis) return res.status(400).json({error:"analysis required"});
    const content = [
      {type:"input_text", text:
`Du bist die Rekonstruktions-Stufe von "look 'n build".
Erstelle auf Basis des bestätigten Analysezustands und ALLER Referenzfotos einen praktikablen Werkstattentwurf.
Keine erfundenen Maße oder technischen Kennwerte. Unbekannte Maße als "vor Ort bestimmen" kennzeichnen.
Keine sicherheitskritischen Annahmen als Tatsachen darstellen.
Antworte ausschließlich als JSON:
{
 "title":"...",
 "summary":"...",
 "construction":"...",
 "materials":[{"item":"...","quantity":"...","spec":"..."}],
 "tools":["..."],
 "steps":["..."],
 "open_points":["..."],
 "safety_notes":["..."]
}
Analysezustand: ${JSON.stringify(analysis)}`
      }
    ];
    for(const image_url of images){
      content.push({type:"input_image", image_url});
    }
    const response = await client.responses.create({ model, input:[{role:"user", content}] });
    res.json(parseJsonText(response.output_text));
  }catch(err){
    console.error(err);
    res.status(500).json({error:"reconstruction_failed", detail:err?.message||String(err)});
  }
});

app.listen(port, ()=>console.log(`look 'n build backend 0.6 listening on port ${port}`));
