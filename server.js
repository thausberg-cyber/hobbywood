import express from "express";
import cors from "cors";
import OpenAI from "openai";
const app=express(),port=process.env.PORT||10000;
const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
const model=process.env.OPENAI_MODEL||"gpt-5.6-luna";
app.use(cors({origin:["https://thausberg-cyber.github.io","http://localhost:3000","http://127.0.0.1:3000"]}));
app.use(express.json({limit:"35mb"}));
app.get("/",(_,res)=>res.json({service:"look, talk 'n build backend",version:"0.7.2",status:"ok"}));
app.get("/health",(_,res)=>res.json({ok:true,version:"0.7.2"}));
const parse=t=>JSON.parse(t.trim().replace(/^```json\s*/i,"").replace(/```$/,"").trim());
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
 let content=[{type:"input_text",text:`Du bist der erfahrene Werkstattkollege von "look, talk 'n build". Analysiere ALLE Fotos als ein Projekt und beziehe das Nutzerwissen ein. Erfinde keine Maße, Holzarten, verdeckten Verbindungen oder Tragfähigkeiten. Trenne erkannt, vermutet und offen. Offene Punkte müssen konkret beantwortbar sein. JSON:
{"object":"...","summary":"...","recognized":["..."],"assumptions":["..."],"unknown":["..."],"safety_notes":["..."],"enough_information":true,"next_request":{"type":"done|detail_photo|measurement|question","prompt":"..."}}
Nutzerwissen:${knowledge}
Bisher:${JSON.stringify(previousState)}
Dialog:${JSON.stringify(chat)}
Runde:${round}`}];addImages(content,images);
 const r=await client.responses.create({model,input:[{role:"user",content}]});res.json(parse(r.output_text));
}catch(e){console.error(e);res.status(500).json({error:"analysis_failed",detail:e.message})}});

app.post("/talk",async(req,res)=>{try{
 const {images=[],knowledge="",analysis={},chat=[]}=req.body||{};
 let content=[{type:"input_text",text:`Du bist ein erfahrener Werkstattkollege. Führe mit dem Nutzer ein fachliches Gespräch auf Augenhöhe. Er darf korrigieren, Maße nennen, widersprechen und Alternativen diskutieren. Prüfe fachlich und stimme nicht automatisch zu. Übernimm belastbare Nutzerangaben und Entscheidungen in den Projektstand. Bereits geklärte Punkte nicht erneut als offen führen. Nichts erfinden. JSON:
{"reply":"direkte fachliche Antwort","analysis":{"object":"...","summary":"...","recognized":["..."],"assumptions":["..."],"unknown":["..."],"safety_notes":["..."]}}
Nutzerwissen:${knowledge}
Projektstand:${JSON.stringify(analysis)}
Gespräch:${JSON.stringify(chat)}`}];addImages(content,images);
 const r=await client.responses.create({model,input:[{role:"user",content}]});res.json(parse(r.output_text));
}catch(e){console.error(e);res.status(500).json({error:"talk_failed",detail:e.message})}});

app.post("/reconstruct",async(req,res)=>{try{
 const {analysis={},knowledge="",chat=[],images=[]}=req.body||{};
 let content=[{type:"input_text",text:`Erstelle den praktikablen Bauentwurf aus dem gemeinsam erarbeiteten Projektstand. Nutzerangaben und Entscheidungen haben Vorrang vor früheren Vermutungen. Keine erfundenen Maße; unbekannte Maße "vor Ort bestimmen". JSON:
{"title":"...","summary":"...","construction":"...","materials":[{"item":"...","quantity":"...","spec":"..."}],"tools":["..."],"steps":["..."],"open_points":["..."],"safety_notes":["..."]}
Analyse:${JSON.stringify(analysis)}
Nutzerwissen:${knowledge}
Werkstattgespräch:${JSON.stringify(chat)}`}];addImages(content,images);
 const r=await client.responses.create({model,input:[{role:"user",content}]});res.json(parse(r.output_text));
}catch(e){console.error(e);res.status(500).json({error:"reconstruction_failed",detail:e.message})}});
app.listen(port,()=>console.log(`look, talk 'n build backend 0.7.2 listening on port ${port}`));