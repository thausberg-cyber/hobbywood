import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';

app.use(cors({
  origin(origin, cb) {
    const allowed = [
      'https://thausberg-cyber.github.io',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:5500',
      'http://127.0.0.1:5500'
    ];
    if (!origin || allowed.includes(origin)) return cb(null, true);
    cb(new Error('Origin not allowed by CORS'));
  }
}));
app.use(express.json({ limit: '35mb' }));

app.get('/', (_req, res) => res.json({ service: "look 'n build backend", version: '0.5.0', status: 'ok' }));
app.get('/health', (_req, res) => res.json({ ok: true, version: '0.5.0' }));

function cleanJson(text) {
  const raw = String(text || '').trim();
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const first = unfenced.indexOf('{');
  const last = unfenced.lastIndexOf('}');
  if (first < 0 || last < first) throw new Error('Model returned no JSON object');
  return JSON.parse(unfenced.slice(first, last + 1));
}

app.post('/analyze', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });

    const legacy = req.body?.imageDataUrl ? [req.body.imageDataUrl] : [];
    const imagesDataUrls = Array.isArray(req.body?.imagesDataUrls) ? req.body.imagesDataUrls : legacy;
    const validImages = imagesDataUrls.filter(x => typeof x === 'string' && /^data:image\//i.test(x));
    if (!validImages.length) return res.status(400).json({ error: 'No valid image Data URL supplied' });
    if (validImages.length > 10) return res.status(400).json({ error: 'Maximum 10 images per analysis' });

    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 8000) : '';
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-5) : [];
    const round = Math.max(1, Number(req.body?.round) || 1);
    const maxFollowups = Math.max(1, Math.min(5, Number(req.body?.maxFollowups) || 3));
    const forceProceed = req.body?.forceProceed === true;

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const policy = `Du bist die Bildanalyse von "look 'n build", einem HOBBYWOOD-Online-Workshop für das Rekonstruieren einfacher Holzobjekte aus Fotos.

ZIEL DIESER STUFE:
Erstelle noch KEINE vollständige Bauanleitung. Führe eine iterative Rekonstruktionsanalyse durch. Alle aktuell mitgesendeten Fotos gehören zum selben Objekt und müssen GEMEINSAM ausgewertet werden. Frühere Erkenntnisse und Nutzerantworten sind Teil desselben Projektstands.

GRUNDREGELN:
- Erfinde niemals Maße, Holzarten, verdeckte Verbindungen, Befestigungsmittel, Tragfähigkeiten oder sonstige nicht sichtbare Fakten.
- Trenne sauber zwischen ERKANNT, VERMUTET und OFFEN.
- Nutze neue Detailfotos dazu, frühere offene Punkte zu schließen. Vergiss frühere Fotos oder bestätigte Angaben nicht.
- Wiederhole keine Rückfrage, die durch ein vorhandenes Foto, eine Nutzerantwort oder den bisherigen Projektstand bereits beantwortet ist.
- Pro Runde höchstens EINE Rückfrage bzw. EINE konkrete Detailfoto-Anforderung. Wähle die Information mit dem höchsten konstruktiven Informationsgewinn.
- Ein offener Punkt muss nicht zwangsläufig geklärt werden. Wenn er für einen brauchbaren Rekonstruktionsplan nicht zwingend nötig ist, lasse ihn als offen/vor Ort zu bestimmen stehen.
- Sicherheitskritische Unsicherheiten dürfen niemals als Tatsache ausgegeben werden.
- Nach spätestens ${maxFollowups} gezielten Folgerunden soll die Analyse auf "ready_for_reconstruction": true wechseln, sofern keine tatsächlich sicherheitskritische, blockierende Unklarheit verbleibt.
- Wenn forceProceed=true, setze ready_for_reconstruction=true, sofern KEINE sicherheitskritische blockierende Unklarheit besteht; verbleibende normale Unsicherheiten bleiben in unknown.
- next_request.type darf nur sein: "detail_photo", "measurement", "question" oder "none".
- Wenn ready_for_reconstruction=true, MUSS next_request.type="none" sein.

WAS IST BLOCKIEREND SICHERHEITSKRITISCH?
Nur eine Unklarheit, ohne deren Klärung eine nachfolgende Rekonstruktion vernünftigerweise ein unmittelbares Risiko erzeugen könnte (z. B. tragende/lastkritische Befestigung, elektrische/gasführende Komponente). Normale unbekannte Maße, Materialart oder verdeckte Details sind NICHT automatisch blockierend; sie können später als "vor Ort bestimmen" behandelt werden.

ANTWORTE AUSSCHLIESSLICH ALS GÜLTIGES JSON in genau dieser Struktur:
{
  "object": "kurzer Objektname",
  "summary": "knappe Gesamteinschätzung des aktuellen, kumulierten Projektstands",
  "recognized": [{"item":"...","confidence":"hoch|mittel|niedrig"}],
  "assumptions": [{"item":"...","reason":"..."}],
  "unknown": ["..."],
  "blocking_safety_unknowns": ["..."],
  "safety_notes": ["..."],
  "ready_for_reconstruction": false,
  "next_request": {"type":"detail_photo|measurement|question|none","instruction":"genau eine konkrete nächste Anforderung oder leer"}
}`;

    const context = `Aktueller Analyseschritt: ${round}.
Anzahl aktuell gemeinsam vorliegender Fotos: ${validImages.length}.
Nutzerwissen/Antworten:\n${note || '(keine)'}

Bisheriger Projektverlauf (nur zur Kontinuität; aktuelle Bilder haben Vorrang):\n${JSON.stringify(history).slice(0, 16000)}

forceProceed=${forceProceed}.`;

    const content = [
      { type: 'input_text', text: policy + '\n\n' + context },
      ...validImages.map(image_url => ({ type: 'input_image', image_url }))
    ];

    const response = await client.responses.create({
      model: MODEL,
      input: [{ role: 'user', content }]
    });

    const parsed = cleanJson(response.output_text);
    parsed.recognized = Array.isArray(parsed.recognized) ? parsed.recognized : [];
    parsed.assumptions = Array.isArray(parsed.assumptions) ? parsed.assumptions : [];
    parsed.unknown = Array.isArray(parsed.unknown) ? parsed.unknown : [];
    parsed.blocking_safety_unknowns = Array.isArray(parsed.blocking_safety_unknowns) ? parsed.blocking_safety_unknowns : [];
    parsed.safety_notes = Array.isArray(parsed.safety_notes) ? parsed.safety_notes : [];
    parsed.next_request = parsed.next_request && typeof parsed.next_request === 'object' ? parsed.next_request : { type: 'none', instruction: '' };

    const allowedTypes = new Set(['detail_photo','measurement','question','none']);
    if (!allowedTypes.has(parsed.next_request.type)) parsed.next_request = { type: 'none', instruction: '' };

    const limitReached = round > maxFollowups;
    const hasBlocking = parsed.blocking_safety_unknowns.length > 0;
    if ((forceProceed || limitReached) && !hasBlocking) parsed.ready_for_reconstruction = true;
    parsed.ready_for_reconstruction = parsed.ready_for_reconstruction === true;
    if (parsed.ready_for_reconstruction) parsed.next_request = { type: 'none', instruction: '' };

    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Analysis failed', detail: err?.message || String(err) });
  }
});


app.post('/reconstruct', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });
    const imagesDataUrls = Array.isArray(req.body?.imagesDataUrls) ? req.body.imagesDataUrls : [];
    const validImages = imagesDataUrls.filter(x => typeof x === 'string' && /^data:image\//i.test(x)).slice(0, 10);
    if (!validImages.length) return res.status(400).json({ error: 'No valid images supplied' });
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 8000) : '';
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-6) : [];
    const finalAnalysis = req.body?.finalAnalysis && typeof req.body.finalAnalysis === 'object' ? req.body.finalAnalysis : {};
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const policy = `Du bist die Rekonstruktionsstufe von "look 'n build" (HOBBYWOOD). Der Analyseabschnitt ist abgeschlossen. Erstelle aus allen Fotos, Nutzerangaben und dem bestätigten Projektstand einen brauchbaren, aber konservativen Rekonstruktionsentwurf für ein einfaches Holzobjekt.

WICHTIG:
- Keine erfundenen Maße, Holzarten, Beschläge, Traglasten oder verdeckten Verbindungen.
- Jede Maß-/Materialangabe erhält einen Status: "erkannt", "gemessen", "vom Nutzer angegeben", "abgeleitet" oder "vor Ort bestimmen".
- Wenn ein Wert nicht belastbar feststeht, schreibe ausdrücklich "vor Ort bestimmen" statt eine Zahl zu erfinden.
- Abgeleitete Angaben nur, wenn sie konstruktiv plausibel aus bekannten Angaben folgen; als "abgeleitet" kennzeichnen.
- Sicherheitskritische Punkte deutlich nennen. Keine Freigabe von Traglasten.
- Die Arbeitsfolge darf nur Schritte enthalten, die aus dem Projektstand plausibel folgen.
- Dies ist ein Rekonstruktionsentwurf, keine statische/elektrische/gastechnische Fachplanung.

Antworte AUSSCHLIESSLICH als gültiges JSON:
{
  "project_title":"...",
  "construction_summary":"...",
  "dimensions":[{"part":"...","value":"...","status":"erkannt|gemessen|vom Nutzer angegeben|abgeleitet|vor Ort bestimmen"}],
  "materials":[{"item":"...","quantity":"...","specification":"...","status":"erkannt|vom Nutzer angegeben|abgeleitet|vor Ort bestimmen"}],
  "tools":["..."],
  "steps":[{"title":"...","instruction":"..."}],
  "open_points":["..."],
  "safety_notes":["..."]
}`;

    const context = `Bestätigte Endanalyse:\n${JSON.stringify(finalAnalysis).slice(0, 14000)}\n\nNutzerwissen:\n${note || '(keine)'}\n\nProjektverlauf:\n${JSON.stringify(history).slice(0, 12000)}`;
    const content = [
      { type: 'input_text', text: policy + '\n\n' + context },
      ...validImages.map(image_url => ({ type: 'input_image', image_url }))
    ];
    const response = await client.responses.create({ model: MODEL, input: [{ role: 'user', content }] });
    const parsed = cleanJson(response.output_text);
    parsed.dimensions = Array.isArray(parsed.dimensions) ? parsed.dimensions : [];
    parsed.materials = Array.isArray(parsed.materials) ? parsed.materials : [];
    parsed.tools = Array.isArray(parsed.tools) ? parsed.tools : [];
    parsed.steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    parsed.open_points = Array.isArray(parsed.open_points) ? parsed.open_points : [];
    parsed.safety_notes = Array.isArray(parsed.safety_notes) ? parsed.safety_notes : [];
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Reconstruction failed', detail: err?.message || String(err) });
  }
});

app.listen(PORT, () => console.log(`look 'n build backend 0.5 listening on port ${PORT}`));
