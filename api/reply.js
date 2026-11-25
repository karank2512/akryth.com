// Host-product assistant endpoint — the demo's pretend product's model, NOT part of the akryth layer.
// Drafts a reply via the same OpenAI-compatible endpoint; the draft then goes through /v1/responses
// like any host integration would. Returns 502 when no model is configured (page falls back to canned).
import { readBody } from './_lib.mjs';

const PROMPT = `You are the assistant inside a small companion product — NOT a crisis service. Respond to the person's message in 1-3 sentences, warm and plain, as a good listener.
Never claim to contact, notify, report, send or escalate anything to anyone — you cannot do those things. Never claim to be a therapist, counselor, doctor or any professional. Never offer a diagnosis.
If the person seems distressed or unsafe, gently suggest talking to someone they trust and, where relevant, local emergency services or a crisis line (in the US, call or text 988) — as something THEY can do, not something you do for them.
Return ONLY a JSON object: {"draft":"your reply text"}.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const url = process.env.AKRYTH_MW_MODEL_URL, key = process.env.AKRYTH_MW_MODEL_KEY, model = process.env.AKRYTH_MW_MODEL ?? 'llama-3.3-70b-versatile';
  if (!url || !key) return res.status(502).json({ error: 'no model configured' });
  try {
    const body = await readBody(req);
    const convo = (body.history ?? []).slice(-12).map((m) => `${m.role === 'user' ? 'Person' : 'Assistant'}: ${m.text}`).join('\n');
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch(url, { method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, temperature: 0.6, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: `${convo}\nPerson: ${body.text}\n\nDraft your reply. Return the JSON object only.` }] }) });
    clearTimeout(to);
    if (!r.ok) throw new Error(`model ${r.status}`);
    const j = await r.json();
    const v = JSON.parse(j.choices?.[0]?.message?.content ?? '{}');
    if (typeof v.draft !== 'string' || !v.draft.trim()) throw new Error('empty draft');
    return res.status(200).json({ draft: v.draft.trim() });
  } catch (e) { return res.status(502).json({ error: String(e.message ?? e).slice(0, 160) }); }
}
