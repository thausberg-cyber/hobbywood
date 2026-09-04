import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app=express(), port=process.env.PORT||10000;
const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
const model=process.env.OPENAI_MODEL||"gpt-5.6-luna";
app.use(cors({origin:["https://thausberg-cyber.github.io","http://localhost:3000","http://127.0.0.1:3000"]}));
app.use(express.json({limit:"35mb"}));
app.get("/",(_,res)=>res.json({service:"look, talk 'n build backend",version:"0.8.0",status:"ok"}));
app.get("/health",(_,res)=>res.json({ok:true,version:"0.8.0"}));

const cleanJson=t=>t.trim().replace(/^```json\s*/i,"").replace(/```$/," ").trim();
const parse=t=>JSON.parse(cleanJson(t));
async function createJsonResponse(content,label="Antwort"){
  const first=await client.responses.create({model,input:[{role:"user",content}]});
  try{return parse(first.output_text)}catch(err){
    console.warn(`${label}: JSON parse failed, retrying once`,err.message);
    const repair=[{type:"input_text",text:`Repariere ausschließlich die JSON-Syntax der folgenden Antwort. Inhalt nicht erweitern. Gib nur gültiges JSON zurück, ohne Markdown.\n\n${first.output_text}`}];
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
  else throw new Error(`Bild ${index+1}: Dateikopf ist kein JPEG/PNG/GIF/WebP`);
  return `data:${mime};base64,${buf.toString("base64")}`;
}
const addImages=(c,imgs=[])=>{imgs.forEach((v,i)=>c.push({type:"input_image",image_url:normalizeImageDataUrl(v,i)}));return c};
const profileText=p=>`Nutzerprofil: Erfahrungsniveau=${p?.skill||"nicht angegeben"}. Werkzeuge=${JSON.stringify(p?.tools||{})}. Passe Erklärungsniveau, Fachsprache und Fertigungsvorschläge daran an. Bevorzuge vorhandene Werkzeuge. Als 'will ich anschaffen' markierte Werkzeuge dürfen als Option genannt werden, aber nicht als vorhanden behandelt werden.`;

function calcCirclePattern(spec={}){
  const d=Number(spec.pitch_diameter_mm);
  const hole=Number(spec.hole_diameter_mm||0);
  let desiredPitch=Number(spec.center_pitch_mm||0);
  const edgeGap=Number(spec.edge_gap_mm||0);
  if(!desiredPitch && hole && edgeGap>=0) desiredPitch=hole+edgeGap;
  if(!(d>0&&desiredPitch>0)) return null;
  const circumference=Math.PI*d;
  const count=Math.max(1,Math.round(circumference/desiredPitch));
  const actualPitch=circumference/count;
  const angle=360/count;
  return {
    type:"circle_pattern",
    pitch_diameter_mm:d,
    hole_diameter_mm:hole||null,
    requested_center_pitch_mm:desiredPitch,
    requested_edge_gap_mm:edgeGap||null,
    circumference_mm:+circumference.toFixed(2),
    count,
    actual_center_pitch_mm:+actualPitch.toFixed(2),
    actual_edge_gap_mm:hole?+(actualPitch-hole).toFixed(2):null,
    angle_deg:+angle.toFixed(3)
  };
}
function calcEqualSpacing(spec={}){
  const length=Number(spec.length_mm), count=Number(spec.count);
  if(!(length>0&&count>=2)) return null;
  return {type:"equal_spacing",length_mm:length,count,spacing_mm:+(length/(count-1)).toFixed(2)};
}
function calcRectangle(spec={}){
  const a=Number(spec.length_mm),b=Number(spec.width_mm),t=Number(spec.thickness_mm||0);
  if(!(a>0&&b>0))return null;
  return {type:"rectangle",area_m2:+(a*b/1e6).toFixed(4),volume_l:t>0?+(a*b*t/1e6).toFixed(3):null};
}
function runCalculation(spec){
  if(!spec||typeof spec!=="object") return null;
  if(spec.type==="circle_pattern") return calcCirclePattern(spec);
  if(spec.type==="equal_spacing") return calcEqualSpacing(spec);
  if(spec.type==="rectangle") return calcRectangle(spec);
  return null;
}

app.post("/analyze",async(req,res)=>{try{
  const {images=[],knowledge="",previousState=null,chat=[],round=0,profile={}}=req.body||{};
  if(!images.length&&!knowledge.trim()) return res.status(400).json({error:"images_or_description_required"});
  let content=[{type:"input_text",text:`Du bist der erfahrene Werkstattkollege von "look, talk 'n build". Analysiere das Projekt aus Bildern und Nutzerwissen. Erfinde keine Maße, Holzarten, verdeckten Verbindungen oder Tragfähigkeiten. Trenne erkannt, vermutet und offen. Priorisiere streng: maximal 3 offene Punkte. next_request enthält nur EINE konkrete nächste Frage oder Fotoanforderung. ${profileText(profile)}\nJSON:\n{"object":"...","summary":"...","recognized":["..."],"assumptions":["..."],"unknown":["..."],"safety_notes":["..."],"enough_information":true,"next_request":{"type":"done|detail_photo|measurement|question","prompt":"..."}}\nNutzerwissen:${knowledge}\nBisher:${JSON.stringify(previousState)}\nDialog:${JSON.stringify(chat)}\nRunde:${round}`}];
  addImages(content,images);
  res.json(await createJsonResponse(content,"analysis"));
}catch(e){console.error(e);res.status(500).json({error:"analysis_failed",detail:e.message})}});

app.post("/talk",async(req,res)=>{try{
  const {images=[],knowledge="",analysis={},chat=[],openAnswers=[],profile={}}=req.body||{};
  const answered=Array.isArray(openAnswers)?openAnswers.filter(x=>x&&typeof x.question==="string"&&String(x.answer||"").trim()):[];
  let content=[{type:"input_text",text:`Du bist ein erfahrener Werkstattkollege und führst einen echten beidseitigen Dialog. Der Nutzer darf jederzeit Fragen stellen, rechnen lassen, widersprechen, Entscheidungen treffen, Maße nennen oder Fotos nachreichen. Antworte zuerst auf SEINE Frage; stelle nur dann eine Rückfrage, wenn sie wirklich nötig ist. Prüfe fachlich und stimme nicht automatisch zu. Nichts erfinden. ${profileText(profile)}\n\nWenn eine belastbare Werkstattberechnung nötig ist, gib zusätzlich ein calculator-Objekt aus. Unterstützte Typen:\n1) circle_pattern: {"type":"circle_pattern","pitch_diameter_mm":430,"hole_diameter_mm":20,"center_pitch_mm":40} ODER edge_gap_mm statt center_pitch_mm.\n2) equal_spacing: {"type":"equal_spacing","length_mm":1000,"count":6}\n3) rectangle: {"type":"rectangle","length_mm":800,"width_mm":400,"thickness_mm":18}\nWenn keine Berechnung nötig ist: calculator=null. Bei Zahlenfragen, die in diese Typen passen, nutze calculator statt selbst zu rechnen.\n\nWenn OPEN_ANSWERS vorhanden sind, gelten diese als bewusst beantwortete Projektpunkte. Dieselben Fragen nicht erneut stellen. Erzeuge höchstens EINEN neuen offenen Punkt. Fotos können eine Antwort vollständig ersetzen, wenn das Bild die Information tatsächlich zeigt.\n\nGib JSON zurück:\n{"reply":"kurze fachliche Antwort","recognized_updates":["..."],"assumption_updates":["..."],"safety_notes":["..."],"new_open_point":null,"calculator":null}\nNutzerwissen:${knowledge}\nProjektstand:${JSON.stringify(analysis)}\nOPEN_ANSWERS:${JSON.stringify(answered)}\nGespräch:${JSON.stringify(chat)}`}];
  addImages(content,images);
  const d=await createJsonResponse(content,"talk");
  const calc=runCalculation(d.calculator);
  if(calc){
    const calcPrompt=[{type:"input_text",text:`Formuliere zu dieser bereits exakt berechneten Werkstattberechnung eine kurze fachliche Antwort auf Deutsch. Erfinde keine anderen Zahlen. Weise auf Widersprüche in Nutzervorgaben hin, wenn sie sich aus den Daten ergeben. Rechnung:${JSON.stringify(calc)}\nBisherige beabsichtigte Antwort:${d.reply||""}`}];
    const x=await client.responses.create({model,input:[{role:"user",content:calcPrompt}]});
    d.reply=x.output_text.trim();
  }
  const currentUnknown=Array.isArray(analysis?.unknown)?analysis.unknown:[];
  const answeredQuestions=new Set(answered.map(x=>x.question));
  let remaining=currentUnknown.filter(q=>!answeredQuestions.has(q));
  const newPoint=typeof d.new_open_point==="string"?d.new_open_point.trim():"";
  if(newPoint&&!remaining.includes(newPoint)&&!answeredQuestions.has(newPoint)) remaining.push(newPoint);
  remaining=remaining.slice(0,3);
  const merged={...analysis};
  merged.recognized=[...(Array.isArray(analysis?.recognized)?analysis.recognized:[]),...(Array.isArray(d.recognized_updates)?d.recognized_updates:[])];
  merged.assumptions=[...(Array.isArray(analysis?.assumptions)?analysis.assumptions:[]),...(Array.isArray(d.assumption_updates)?d.assumption_updates:[])];
  merged.safety_notes=[...(Array.isArray(analysis?.safety_notes)?analysis.safety_notes:[]),...(Array.isArray(d.safety_notes)?d.safety_notes:[])];
  merged.unknown=remaining;
  res.json({reply:d.reply||"Projektstand aktualisiert.",analysis:merged,calculation:calc});
}catch(e){console.error(e);res.status(500).json({error:"talk_failed",detail:e.message})}});

app.post("/ideas",async(req,res)=>{try{
  const {brief={},profile={}}=req.body||{};
  const content=[{type:"input_text",text:`Entwickle 4 konkrete, realistisch baubare Geschenk- oder DIY-Projektideen. Keine belanglosen Listen; jede Idee soll erkennbar aus Empfänger, Anlass, Interessen, Zeit, Budget und Werkstattprofil abgeleitet sein. ${profileText(profile)}\nJSON:{"ideas":[{"title":"...","why":"...","difficulty":"Anfänger|Fortgeschritten|Erfahren|Profi","time":"...","budget":"...","main_tools":["..."],"concept":"..."}]}\nBrief:${JSON.stringify(brief)}`}];
  res.json(await createJsonResponse(content,"ideas"));
}catch(e){console.error(e);res.status(500).json({error:"ideas_failed",detail:e.message})}});

app.post("/reconstruct",async(req,res)=>{try{
  const {analysis={},knowledge="",chat=[],images=[],profile={}}=req.body||{};
  let content=[{type:"input_text",text:`Erstelle "Mein Projekt" als praktikablen Bauentwurf aus dem gemeinsam erarbeiteten Projektstand. Nutzerangaben und Entscheidungen haben Vorrang vor früheren Vermutungen. Keine erfundenen Maße; unbekannte Maße "vor Ort bestimmen". ${profileText(profile)}\nJSON:{"title":"...","summary":"...","construction":"...","materials":[{"item":"...","quantity":"...","spec":"..."}],"tools":["..."],"steps":["..."],"open_points":["..."],"safety_notes":["..."]}\nAnalyse:${JSON.stringify(analysis)}\nNutzerwissen:${knowledge}\nWerkstattgespräch:${JSON.stringify(chat)}`}];
  addImages(content,images);
  res.json(await createJsonResponse(content,"project"));
}catch(e){console.error(e);res.status(500).json({error:"project_failed",detail:e.message})}});

app.listen(port,()=>console.log(`look, talk 'n build backend 0.8.0 listening on port ${port}`));
