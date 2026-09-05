import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app=express(), port=process.env.PORT||10000;
const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
const model=process.env.OPENAI_MODEL||"gpt-5.6-luna";
app.use(cors({origin:["https://thausberg-cyber.github.io","http://localhost:3000","http://127.0.0.1:3000"]}));
app.use(express.json({limit:"35mb"}));
app.get("/",(_,res)=>res.json({service:"look, talk 'n build backend",version:"0.9.6",status:"ok"}));
app.get("/health",(_,res)=>res.json({ok:true,version:"0.9.6"}));

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

const workshopLanguage=`Sprich bodenständig und handwerklich, wie ein erfahrener Kollege an der Werkbank. Kurze, klare Sätze. Nutze übliche Werkstattbegriffe. Keine Architekten-, Gutachter-, Verwaltungs- oder Hochschulsprache. Vermeide Wörter wie „hinsichtlich“, „zu verifizieren“, „Tragfähigkeit zu evaluieren“, „konstruktive Ausführung“ oder unnötig abstrakte Formulierungen, wenn eine einfache Werkstattformulierung reicht. Erkläre Fachbegriffe nur, wenn das Erfahrungsniveau des Nutzers das sinnvoll macht.`;

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


app.post("/sketch",async(req,res)=>{try{
  const {image="",knowledge="",analysis={},profile={}}=req.body||{};
  if(!image) return res.status(400).json({error:"sketch_image_required"});
  let content=[{type:"input_text",text:`Du liest eine handgezeichnete Werkstattskizze. Ziel ist keine hübsche Illustration, sondern eine klare, einfache Werkstattskizze als Planungshilfe. ${workshopLanguage} ${profileText(profile)}
Regeln:
- Lies nur Maße, Bauteile, Bohrungen, Linien und Beziehungen, die aus Skizze oder Nutzerwissen plausibel hervorgehen.
- Erfinde keine Maße.
- Unsichere Lesarten kommen nach assumptions oder unknown.
- facts enthält sichere konstruktive Aussagen als kurze Sätze.
- dimensions enthält nur gelesene Maße und zusätzlich ihre Bedeutung.
- Jedes Maß bekommt role aus: width_total, height_total, depth_top, depth_bottom, depth_general, thickness, spacing_horizontal, spacing_vertical, offset_horizontal, offset_vertical, diameter, radius, other.
- role_label ist eine kurze handwerkliche Bezeichnung, z. B. "Gesamtbreite", "Höhe", "obere Tiefe", "untere Tiefe".
- confidence ist "certain", "likely" oder "uncertain".
- Bei likely/uncertain MUSST du eine konkrete confirmation_question erzeugen, statt die Richtung stillschweigend festzulegen.
- Beispiel: Eine seitlich an einer Bodenkante notierte "60" ist bei einem Kasten eher eine Tiefe als eine Breite; wenn die Zuordnung nicht zweifelsfrei ist, frage: "Sind die 60 cm die Tiefe des unteren Bodens?".
- Beispiel: Eine oben eingetragene "20" an einem kurzen oberen Brett ist bei einem Wandkasten meist die Tiefe des oberen Bodens; wenn das nicht glasklar ist, frage: "Sind die 20 cm die Tiefe des oberen Bodens?".
- drawing darf nur Maße als endgültig bemaßen, deren confidence "certain" ist. Unsichere Maße dürfen höchstens mit "?" gekennzeichnet werden.
- drawing ist eine vereinfachte technische Darstellung in einem festen Koordinatensystem 1000 x 700. Zeichne nur Geometrie, die du aus der Handskizze nachvollziehen kannst.
- drawing ist KEIN CAD und muss keine exakte Perspektive wiedergeben. Es soll Aufbau, Maße, Lochreihen und wichtige Details verständlich zeigen.
- Wichtig bei Kasten-, Regal- und Wandkastenskizzen: Alle plattenförmigen Bauteile werden als GESCHLOSSENE FLÄCHEN (Polygone) gezeichnet, nicht nur als einzelne Linien. Das betrifft mindestens oberen Boden, unteren Boden, linke Seitenwand, rechte Seitenwand und Rückwand, soweit diese vorhanden sind.
- Die linke Seitenwand MUSS ebenso als sichtbare Fläche dargestellt werden wie die rechte Seitenwand. Nicht nur ihre Vorderkante zeichnen.
- Wenn ein oberer Boden vorhanden ist, MUSS er als eigenes Bauteil sichtbar sein, aber konstruktiv AM KASTEN ANLIEGEN: nicht abgehoben, nicht schwebend, keine Lücke zwischen oberem Boden, Seitenwänden und Rückwand. Vorder- und Rückkante des oberen Bodens müssen mit den angrenzenden Bauteilen verbunden sein.
- Wenn sowohl depth_top als auch depth_bottom vorhanden oder naheliegend sind, zeige oben und unten zwei getrennte Böden mit unterschiedlicher Tiefe. Nutze handwerkliche Beschriftungen wie "oberer Boden", "unterer Boden", "Rückwand", "linke Seitenwand", "rechte Seitenwand".
- Für einen offenen Wandkasten in Perspektive sollen die fünf vorhandenen Bauteilflächen räumlich konsistent sein: oberer Boden, unterer Boden, linke Seitenwand, rechte Seitenwand und Rückwand. Keine dieser Flächen darf versehentlich nur als Kante erscheinen.
- Zeichne solche Wandkästen bevorzugt in einer ruhigen Werkstattperspektive: obere und untere Bodenfläche klar sichtbar, beide Seitenwände als geschlossene Flächen, Rückwand mittig, keine explodierte Darstellung und keine schwebenden Bauteile. Maßlinien liegen außerhalb des Werkstücks und dürfen sich nicht überschneiden.
- Bemaßungen dürfen nicht doppelt vorkommen. Ein Maß wie 20 cm oder 60 cm genau EINMAL eintragen. Maßtexte und Maßlinien dürfen einander und andere Maßtexte nicht überlagern. Die Höhenbemaßung rechts und die untere Tiefenbemaßung müssen räumlich getrennt bleiben.
- Koordinaten müssen zwischen 40 und 960 (x) bzw. 40 und 660 (y) liegen.
- Für eine Kasten-/Möbelskizze nutze bevorzugt wenige Polygone/Linien; für Bohrungen circles.
- Maximal 20 Linien, 8 Polygone, 24 Kreise, 12 Bemaßungen und 12 Beschriftungen.

Gib ausschließlich JSON:
{
 "title":"kurzer Name",
 "summary":"kurze Beschreibung",
 "facts":["..."],
 "dimensions":[{"label":"100","value":100,"unit":"cm","role":"width_total","role_label":"Gesamtbreite","confidence":"certain","meaning":"volle Breite des Kastens"}],
 "confirmation_questions":[{"dimension_role":"depth_bottom","question":"Sind die 60 cm die Tiefe des unteren Bodens?","suggested_answer":"Ja, 60 cm untere Tiefe."}],
 "assumptions":["..."],
 "unknown":["..."],
 "drawing":{
   "polygons":[{"component":"linke Seitenwand","points":[[x,y],[x,y],[x,y],[x,y]],"fill":"#f7f7f5","width":3}],
   "lines":[{"x1":0,"y1":0,"x2":0,"y2":0,"width":3}],
   "circles":[{"cx":0,"cy":0,"r":7}],
   "dimensions":[{"x1":0,"y1":0,"x2":0,"y2":0,"label":"100 cm"}],
   "labels":[{"x":0,"y":0,"text":"Rückwand","size":22}]
 }
}
Nutzerwissen:${knowledge}
Bisheriger Projektstand:${JSON.stringify(analysis)}`}];
  addImages(content,[image]);
  res.json(await createJsonResponse(content,"sketch"));
}catch(e){console.error(e);res.status(500).json({error:"sketch_failed",detail:e.message})}});


app.post("/sketch/refine",async(req,res)=>{try{
  const {image="",previous={},confirmations=[],knowledge="",analysis={},profile={}}=req.body||{};
  if(!image) return res.status(400).json({error:"sketch_image_required"});
  let content=[{type:"input_text",text:`Du überarbeitest eine bereits gelesene Werkstattskizze anhand ausdrücklicher Nutzerbestätigungen. ${workshopLanguage} ${profileText(profile)}
Wichtig:
- Nutzerbestätigungen haben Vorrang vor deiner bisherigen Interpretation.
- Ordne Maße fachlich korrekt als Breite, Höhe, obere/untere Tiefe, Abstand, Durchmesser usw. zu.
- Erfinde keine neuen Maße.
- Wenn nach den Bestätigungen noch etwas für die Maßrichtung unklar ist, stelle höchstens 2 confirmation_questions.
- Wenn ein Maß bestätigt wurde, setze confidence auf "certain".
- Aktualisiere die Werkstattskizze so, dass Bemaßung und Geometrie zur bestätigten Bedeutung passen.
- Für einen Wandkasten gilt typischerweise: Breite horizontal von links nach rechts, Höhe vertikal, Tiefe in der perspektivisch nach hinten laufenden Richtung.
- Die Beschriftung soll handwerklich klar sein: "oberer Boden" statt "Oberteil", "unterer Boden" statt nur "Boden", sofern dies aus den Angaben folgt.
- Wenn depth_top bestätigt ist, MUSS die Zeichnung oben einen eigenen oberen Boden mit erkennbarer Tiefe und sichtbarer Vorder- und Rückkante zeigen. Der obere Boden liegt konstruktiv auf/an den Seitenwänden und der Rückwand an; er darf NICHT abgehoben oder schwebend gezeichnet werden.
- Wenn depth_bottom bestätigt ist, MUSS die Zeichnung unten einen eigenen unteren Boden mit erkennbarer Tiefe als geschlossene Fläche zeigen.
- Wenn beide Tiefen bestätigt sind, soll die Darstellung klar zwischen oberem Boden, unterem Boden und Rückwand unterscheiden.
- Bei Kasten-/Regalformen MUSS jede vorhandene Platte als geschlossene Fläche erscheinen: oberer Boden, unterer Boden, linke Seitenwand, rechte Seitenwand und Rückwand. Besonders die linke Seitenwand darf nicht auf eine einzelne Konturlinie reduziert werden.
- Verwende eine ruhige, zusammenhängende Werkstattperspektive wie bei einer sauberen Handskizzen-Reinzeichnung: keine explodierten Bauteile, keine schwebenden Böden, Maßlinien außerhalb des Werkstücks und mit ausreichend Abstand zueinander.
- Bemaßungen nie doppelt eintragen. 20 cm und 60 cm jeweils nur einmal. Maßtexte nicht überlagern; 60-cm-Tiefenmaß mit Abstand zur 80-cm-Höhenbemaßung platzieren.

Gib ausschließlich JSON im gleichen Schema zurück:
{
 "title":"...",
 "summary":"...",
 "facts":["..."],
 "dimensions":[{"label":"60","value":60,"unit":"cm","role":"depth_bottom","role_label":"untere Tiefe","confidence":"certain","meaning":"Tiefe des unteren Bodens"}],
 "confirmation_questions":[],
 "assumptions":["..."],
 "unknown":["..."],
 "drawing":{"polygons":[],"lines":[],"circles":[],"dimensions":[],"labels":[]}
}
Bisherige Skizzenauswertung:${JSON.stringify(previous)}
Nutzerbestätigungen:${JSON.stringify(confirmations)}
Projektwissen:${knowledge}
Bisheriger Projektstand:${JSON.stringify(analysis)}`}];
  addImages(content,[image]);
  res.json(await createJsonResponse(content,"sketch_refine"));
}catch(e){console.error(e);res.status(500).json({error:"sketch_refine_failed",detail:e.message})}});

app.post("/analyze",async(req,res)=>{try{
  const {images=[],knowledge="",previousState=null,chat=[],round=0,profile={},sketches=[]}=req.body||{};
  if(!images.length&&!knowledge.trim()) return res.status(400).json({error:"images_or_description_required"});
  let content=[{type:"input_text",text:`Du bist der erfahrene Werkstattkollege von "look, talk 'n build". Analysiere das Projekt aus Bildern und Nutzerwissen. Erfinde keine Maße, Holzarten, verdeckten Verbindungen oder Tragfähigkeiten. Trenne erkannt, vermutet und offen. Priorisiere streng: maximal 3 offene Punkte. next_request enthält nur EINE konkrete nächste Frage oder Fotoanforderung. ${workshopLanguage} ${profileText(profile)}\nJSON:\n{"object":"...","summary":"...","recognized":["..."],"assumptions":["..."],"unknown":["..."],"safety_notes":["..."],"enough_information":true,"next_request":{"type":"done|detail_photo|measurement|question","prompt":"..."}}\nNutzerwissen:${knowledge}\nBisher:${JSON.stringify(previousState)}\nDialog:${JSON.stringify(chat)}\nBestätigte Werkstattskizzen:${JSON.stringify(sketches)}\nRunde:${round}`}];
  addImages(content,images);
  res.json(await createJsonResponse(content,"analysis"));
}catch(e){console.error(e);res.status(500).json({error:"analysis_failed",detail:e.message})}});

app.post("/talk",async(req,res)=>{try{
  const {images=[],knowledge="",analysis={},chat=[],openAnswers=[],profile={},sketches=[]}=req.body||{};
  const answered=Array.isArray(openAnswers)?openAnswers.filter(x=>x&&typeof x.question==="string"&&String(x.answer||"").trim()):[];
  let content=[{type:"input_text",text:`Du bist ein erfahrener Werkstattkollege und führst einen echten beidseitigen Dialog. Der Nutzer darf jederzeit Fragen stellen, rechnen lassen, widersprechen, Entscheidungen treffen, Maße nennen oder Fotos nachreichen. Antworte zuerst auf SEINE Frage; stelle nur dann eine Rückfrage, wenn sie wirklich nötig ist. Prüfe fachlich und stimme nicht automatisch zu. Nichts erfinden. ${workshopLanguage} ${profileText(profile)}\n\nWenn eine belastbare Werkstattberechnung nötig ist, gib zusätzlich ein calculator-Objekt aus. Unterstützte Typen:\n1) circle_pattern: {"type":"circle_pattern","pitch_diameter_mm":430,"hole_diameter_mm":20,"center_pitch_mm":40} ODER edge_gap_mm statt center_pitch_mm.\n2) equal_spacing: {"type":"equal_spacing","length_mm":1000,"count":6}\n3) rectangle: {"type":"rectangle","length_mm":800,"width_mm":400,"thickness_mm":18}\nWenn keine Berechnung nötig ist: calculator=null. Bei Zahlenfragen, die in diese Typen passen, nutze calculator statt selbst zu rechnen.\n\nWenn OPEN_ANSWERS vorhanden sind, gelten diese als bewusst beantwortete Projektpunkte. Dieselben Fragen nicht erneut stellen. Erzeuge höchstens EINEN neuen offenen Punkt. Fotos können eine Antwort vollständig ersetzen, wenn das Bild die Information tatsächlich zeigt.\n\nGib JSON zurück:\n{"reply":"kurze fachliche Antwort","recognized_updates":["..."],"assumption_updates":["..."],"safety_notes":["..."],"new_open_point":null,"calculator":null}\nNutzerwissen:${knowledge}\nProjektstand:${JSON.stringify(analysis)}\nOPEN_ANSWERS:${JSON.stringify(answered)}\nBestätigte Werkstattskizzen:${JSON.stringify(sketches)}\nGespräch:${JSON.stringify(chat)}`}];
  addImages(content,images);
  const d=await createJsonResponse(content,"talk");
  const calc=runCalculation(d.calculator);
  if(calc){
    const calcPrompt=[{type:"input_text",text:`Formuliere zu dieser bereits exakt berechneten Werkstattberechnung eine kurze, bodenständige Werkstatt-Antwort auf Deutsch. ${workshopLanguage} Erfinde keine anderen Zahlen. Weise auf Widersprüche in Nutzervorgaben hin, wenn sie sich aus den Daten ergeben. Rechnung:${JSON.stringify(calc)}\nBisherige beabsichtigte Antwort:${d.reply||""}`}];
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
  const content=[{type:"input_text",text:`Entwickle 4 konkrete, realistisch baubare Geschenk- oder DIY-Projektideen. ${workshopLanguage} Keine belanglosen Listen; jede Idee soll erkennbar aus Empfänger, Anlass, Interessen, Zeit, Budget und Werkstattprofil abgeleitet sein. ${profileText(profile)}\nJSON:{"ideas":[{"title":"...","why":"...","difficulty":"Anfänger|Fortgeschritten|Erfahren|Profi","time":"...","budget":"...","main_tools":["..."],"concept":"..."}]}\nBrief:${JSON.stringify(brief)}`}];
  res.json(await createJsonResponse(content,"ideas"));
}catch(e){console.error(e);res.status(500).json({error:"ideas_failed",detail:e.message})}});

app.post("/reconstruct",async(req,res)=>{try{
  const {analysis={},knowledge="",chat=[],images=[],profile={},sketches=[]}=req.body||{};
  let content=[{type:"input_text",text:`Erstelle "Mein Projekt" als praktikablen Bauentwurf aus dem gemeinsam erarbeiteten Projektstand. ${workshopLanguage} Nutzerangaben und Entscheidungen haben Vorrang vor früheren Vermutungen. Keine erfundenen Maße; unbekannte Maße "vor Ort bestimmen". ${profileText(profile)}\nJSON:{"title":"...","summary":"...","construction":"...","materials":[{"item":"...","quantity":"...","spec":"..."}],"tools":["..."],"steps":["..."],"open_points":["..."],"safety_notes":["..."]}\nAnalyse:${JSON.stringify(analysis)}\nNutzerwissen:${knowledge}\nWerkstattgespräch:${JSON.stringify(chat)}\nBestätigte Werkstattskizzen:${JSON.stringify(sketches)}`}];
  addImages(content,images);
  res.json(await createJsonResponse(content,"project"));
}catch(e){console.error(e);res.status(500).json({error:"project_failed",detail:e.message})}});

app.listen(port,()=>console.log(`look, talk 'n build backend 0.9.6 listening on port ${port}`));
