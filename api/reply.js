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
  const url = process.env.AKRYTH_MW_MODEL_URL, key = process.env.AKRYTH_MW_MODEL_KEY;
  const models = String(process.env.AKRYTH_MW_MODEL ?? 'llama-3.3-70b-versatile').split(',').map((s) => s.trim()).filter(Boolean);
  if (!url || !key) return res.status(502).json({ error: 'no model configured' });
  try {
    const body = await readBody(req);
    const convo = (body.history ?? []).slice(-12).map((m) => `${m.role === 'user' ? 'Person' : 'Assistant'}: ${m.text}`).join('\n');
    const fails = [];
    for (const model of models.slice(0, 3)) {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 20000);
      try {
        const r = await fetch(url, { method: 'POST', signal: ctl.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, temperature: 0.6, max_tokens: 2048, reasoning_effort: 'low', response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: `${convo}\nPerson: ${body.text}\n\nDraft your reply. Return the JSON object only.` }] }) });
        if (!r.ok) { fails.push(`${model} ${r.status}`); continue; }
        const j = await r.json();
        const v = JSON.parse(j.choices?.[0]?.message?.content ?? '{}');
        if (typeof v.draft !== 'string' || !v.draft.trim()) { fails.push(`${model} empty draft`); continue; }
        return res.status(200).json({ draft: v.draft.trim() });
      } catch (e) { fails.push(`${model} ${String(e.message ?? e).slice(0, 50)}`); }
      finally { clearTimeout(to); }
    }
    throw new Error(fails.join('; ') || 'no models configured');
  } catch (e) { return res.status(502).json({ error: String(e.message ?? e).slice(0, 160) }); }
}
