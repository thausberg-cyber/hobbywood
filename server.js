import express from "express";
import cors from "cors";
import OpenAI from "openai";
const app=express(),port=process.env.PORT||10000;
const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
const model=process.env.OPENAI_MODEL||"gpt-5.6-luna";
app.use(cors({origin:["https://thausberg-cyber.github.io","http://localhost:3000","http://127.0.0.1:3000"]}));
app.use(express.json({limit:"35mb"}));
app.get("/",(_,res)=>res.json({service:"look, talk 'n build backend",version:"0.7.3",status:"ok"}));
app.get("/health",(_,res)=>res.json({ok:true,version:"0.7.3"}));
const cleanJson=t=>t.trim().replace(/^```json\s*/i,"").replace(/```$/," ").trim();
const parse=t=>JSON.parse(cleanJson(t));
async function createJsonResponse(content,repairLabel="Antwort"){
 const first=await client.responses.create({model,input:[{role:"user",content}]});
 try{return parse(first.output_text)}catch(err){
  console.warn(`${repairLabel}: JSON parse failed, retrying once`,err.message);
  const repair=[{type:"input_text",text:`Die folgende Antwort ist inhaltlich zu erhalten, aber syntaktisch kein gueltiges JSON. Gib ausschliesslich repariertes, gueltiges JSON zurueck. Keine Markdown-Codefences, keine Erklaerung.\n\n${first.output_text}`}];
  const second=await client.responses.create({model,input:[{role:"user",content:repair}]});
  return parse(second.output_text);
 }
}
function normalizeImageDataUrl(value,index){
 if(typeof value!=="string") throw new Error(`Bild ${index+1}: keine Zeichenkette`);
 const m=value.match(/^data:([^;,]+);base64,(.+)$/s);
 if(!m) throw new Error(`Bild ${index+1}: ungültige Data-URL`);
 const raw=m[2].replace(/\s/g,"");
 const buf=Buffer.from(raw,"base64");
 if(buf.length<16) throw new Error(`Bild ${index+1}: Bilddaten leer oder zu kurz`);
 let mime=null;
 if(buf[0]===0xff&&buf[1]===0xd8&&buf[2]===0xff) mime="image/jpeg";
 else if(buf.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) mime="image/png";
 else if(["GIF87a","GIF89a"].includes(buf.subarray(0,6).toString("ascii"))) mime="image/gif";
 else if(buf.subarray(0,4).toString("ascii")==="RIFF"&&buf.subarray(8,12).toString("ascii")==="WEBP") mime="image/webp";
 else throw new Error(`Bild ${index+1}: Dateikopf ist kein JPEG/PNG/GIF/WebP (${buf.subarray(0,12).toString("hex")})`);
 return `data:${mime};base64,${buf.toString("base64")}`;
}
const addImages=(c,imgs=[])=>{imgs.forEach((value,index)=>c.push({type:"input_image",image_url:normalizeImageDataUrl(value,index)}));return c};

app.post("/analyze",async(req,res)=>{try{
 const {images=[],knowledge="",previousState=null,chat=[],round=0}=req.body||{};
 if(!images.length)return res.status(400).json({error:"images required"});
 let content=[{type:"input_text",text:`Du bist der erfahrene Werkstattkollege von "look, talk 'n build". Analysiere ALLE Fotos als ein Projekt und beziehe das Nutzerwissen ein. Erfinde keine Maße, Holzarten, verdeckten Verbindungen oder Tragfähigkeiten. Trenne erkannt, vermutet und offen. Offene Punkte müssen konkret beantwortbar sein. Priorisiere streng: nenne maximal 3 offene Punkte, die fuer die Konstruktion, Machbarkeit oder Sicherheit wirklich relevant sind. next_request darf nur EINE konkrete naechste Frage oder Fotoanforderung enthalten. JSON:
{"object":"...","summary":"...","recognized":["..."],"assumptions":["..."],"unknown":["..."],"safety_notes":["..."],"enough_information":true,"next_request":{"type":"done|detail_photo|measurement|question","prompt":"..."}}
Nutzerwissen:${knowledge}
Bisher:${JSON.stringify(previousState)}
Dialog:${JSON.stringify(chat)}
Runde:${round}`}];addImages(content,images);
 res.json(await createJsonResponse(content,"analysis"));
}catch(e){console.error(e);res.status(500).json({error:"analysis_failed",detail:e.message})}});

app.post("/talk",async(req,res)=>{try{
 const {images=[],knowledge="",analysis={},chat=[]}=req.body||{};
 let content=[{type:"input_text",text:`Du bist ein erfahrener Werkstattkollege. Führe mit dem Nutzer ein fachliches Werkstattgespräch auf Augenhöhe, nicht wie einen Prüf- oder Fragebogen. Er darf korrigieren, Maße nennen, widersprechen und Alternativen diskutieren. Prüfe fachlich und stimme nicht automatisch zu. Übernimm belastbare Nutzerangaben und Entscheidungen in den Projektstand. Entferne damit geklärte Punkte aus unknown und frage sie nicht erneut ab. Zerlege eine brauchbare Antwort nicht in neue Unterfragen. Erzeuge pro Nutzerbeitrag hoechstens EINEN neuen offenen Punkt, und nur wenn er fuer Konstruktion, Machbarkeit oder Sicherheit wirklich relevant ist. Nicht sicherheitskritische Detailfragen duerfen offen bleiben, ohne aktiv nachgefragt zu werden. Nichts erfinden. Die reply soll kurz, kollegial und konkret bestaetigen, was uebernommen wurde, und falls noetig genau den einen naechsten Punkt nennen. JSON:
{"reply":"direkte fachliche Antwort","analysis":{"object":"...","summary":"...","recognized":["..."],"assumptions":["..."],"unknown":["hoechstens die wirklich relevanten noch offenen Punkte"],"safety_notes":["..."]}}
Nutzerwissen:${knowledge}
Projektstand:${JSON.stringify(analysis)}
Gespräch:${JSON.stringify(chat)}`}];addImages(content,images);
 res.json(await createJsonResponse(content,"talk"));
}catch(e){console.error(e);res.status(500).json({error:"talk_failed",detail:e.message})}});

app.post("/reconstruct",async(req,res)=>{try{
 const {analysis={},knowledge="",chat=[],images=[]}=req.body||{};
 let content=[{type:"input_text",text:`Erstelle "Mein Projekt" als praktikablen Bauentwurf aus dem gemeinsam erarbeiteten Projektstand. Nutzerangaben und Entscheidungen haben Vorrang vor früheren Vermutungen. Keine erfundenen Maße; unbekannte Maße "vor Ort bestimmen". JSON:
{"title":"...","summary":"...","construction":"...","materials":[{"item":"...","quantity":"...","spec":"..."}],"tools":["..."],"steps":["..."],"open_points":["..."],"safety_notes":["..."]}
Analyse:${JSON.stringify(analysis)}
Nutzerwissen:${knowledge}
Werkstattgespräch:${JSON.stringify(chat)}`}];addImages(content,images);
 res.json(await createJsonResponse(content,"project"));
}catch(e){console.error(e);res.status(500).json({error:"reconstruction_failed",detail:e.message})}});
app.listen(port,()=>console.log(`look, talk 'n build backend 0.7.3 listening on port ${port}`));