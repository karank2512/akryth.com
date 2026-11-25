// Shared demo middleware for serverless — same contract as tools/middleware (verdict pass|flag|hold,
// cases open on non-pass). Self-contained for akryth.com hosting; the private repo is the source of truth.
// Screening: AKRYTH_MW_MODEL_URL + AKRYTH_MW_MODEL_KEY hit any OpenAI-compatible endpoint (Groq,
// OpenRouter, Cerebras…); unset → lexical placeholder, labelled honestly in every response.
// NOTE: case state is per-instance memory — fine for a public demo click-through, not durable.
import { createHash, randomBytes } from 'node:crypto';

const norm = (s) => s.replace(/\b(\w+)['’]ve\b/gi, '$1 have').replace(/\b(\w+)['’]re\b/gi, '$1 are')
  .replace(/\b(\w+)['’]ll\b/gi, '$1 will').replace(/\b(\w+)['’]d\b/gi, '$1 had').replace(/\b(\w+)['’]s\b/gi, '$1 is')
  .replace(/n['’]t\b/gi, ' not');
const DISTRESS = /\b(?:want to (?:die|disappear|end it all|end it)|end(?:ing)? (?:it all|it|my life|everything|things)|kill(?:ing)? myself|suicid\w*|self[\s-]?harm\w*|hurt(?:ing)? myself|no reason to (?:live|go on)|better off without me|(?:don'?t|do not) want to (?:be here|exist|wake up|live)|(?:can'?t|can not) (?:go on|do this)(?: anymore)?|(?:i'?m|i am) (?:done|ending it|giving up)|doing it\b.*(?:end|hurt|harm)|ending it all)\b/i;
const ABUSE_FEAR = /\b(?:scared (?:of|to go home)|afraid (?:of|he|she|they) will|hurts me|hits me|threatens? me|(?:won'?t|will not) let me leave|controls? (?:everything|my money|who i see)|checks? my (?:phone|messages) without)\b/i;
const THIRD_PARTY = /\b(?:worried about (?:my|her|his|their)|she'?s been|he'?s been|they'?ve been) (?:sad|distant|withdrawn|scared|hurt)\b/i;
const SENT = /\b(?:has|have|had|was|were|is|are|will|would|did)\s+(?:not\s+|never\s+|already\s+|just\s+|been\s+)*?(?:sent|forwarded|notified|contacted|alerted|reported|referred|escalated|shared)\b|\b(?:i|we)\s+(?:sent|notified|contacted|alerted|reported|referred|escalated|forwarded|shared)\b/i;
const VALID = /\b(?:clinically|medically|legally|safety)[\s-]+(?:validated|approved|certified|proven)\b|\bproduction[\s-]+ready\b|\bfda[\s-]+(?:approved|cleared)\b/i;
const ROLE = /\b(?:i am|i'?m|as) (?:a )?(?:therapist|counsell?or|doctor|clinician|crisis (?:line|worker|counsell?or))\b/i;

const lexicalTurn = (text) => { const t = norm(text), c = [], r = [];
  if (DISTRESS.test(t)) { c.push('possible_distress'); r.push('distress-lexical placeholder matched'); }
  if (ABUSE_FEAR.test(t)) { c.push('possible_unsafe_situation'); r.push('unsafe-situation placeholder matched'); }
  if (THIRD_PARTY.test(t)) { c.push('concern_for_third_party'); r.push('third-party-concern placeholder matched'); }
  return c.length ? { verdict: 'flag', categories: c, reasons: r } : { verdict: 'pass', categories: c, reasons: r }; };
const lexicalResponse = (text) => { const t = norm(text), c = [], r = [];
  if (SENT.test(t)) { c.push('model_claims_outreach'); r.push('reply claims something was sent/reported — never true'); }
  if (VALID.test(t)) { c.push('model_claims_validation'); r.push('reply claims validation/readiness — never true'); }
  if (ROLE.test(t)) { c.push('model_claims_role'); r.push('reply claims a clinical/crisis role — never true'); }
  if (c.length) return { verdict: 'hold', categories: c, reasons: r };
  if (DISTRESS.test(t)) return { verdict: 'flag', categories: ['assistant_distress_language'], reasons: ['reply echoes distress phrasing — human review'] };
  return { verdict: 'pass', categories: c, reasons: r }; };

const TURN_PROMPT = `You are a screening component in a disclosure-handling layer for AI products. Decide whether a single user turn, taken at face value AND in light of the conversation around it, might indicate the person (or someone they describe) could need human support. Escalating or euphemistic distress counts — flag generously; a human reviews every flag.
Return ONLY JSON: {"verdict":"pass"|"flag","categories":[snake_case],"reasons":[one short factual line each]}. Categories like possible_distress, possible_unsafe_situation, concern_for_third_party.`;
const RESP_PROMPT = `You are a screening component in a disclosure-handling layer for AI products. Check a single DRAFT assistant reply before delivery.
Return ONLY JSON: {"verdict":"pass"|"flag"|"hold","categories":[snake_case],"reasons":[one short factual line each]}.
- "hold" when the draft claims it sent/contacted/notified/reported/escalated anything (never true), claims clinical/legal/safety validation or a therapist/clinician role, or claims readiness.
- "flag" when it echoes distress phrasing or deserves a human look.
- "pass" otherwise. Never write replacement text.`;

const modelScreen = async (kind, text, history) => {
  const url = process.env.AKRYTH_MW_MODEL_URL, key = process.env.AKRYTH_MW_MODEL_KEY, model = process.env.AKRYTH_MW_MODEL ?? 'llama-3.3-70b-versatile';
  if (!url || !key) return null;
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 25000);
  try {
    const ctx = (history ?? []).slice(-8).map((m) => `${m.role}: ${m.text}`).join('\n');
    const payload = { model, temperature: 0, max_tokens: 400, reasoning_effort: 'low', response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: kind === 'turn' ? TURN_PROMPT : RESP_PROMPT }, { role: 'user', content: `${ctx ? ctx + '\n' : ''}Screen this ${kind === 'turn' ? 'user turn' : 'draft reply'}:\n<text>${String(text).slice(0, 8000)}</text>` }] };
    let r = await fetch(url, { method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(payload) });
    if (r.status >= 500) { await new Promise((s) => setTimeout(s, 800));
      r = await fetch(url, { method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(payload) }); }
    if (!r.ok) throw new Error(`model ${r.status}`);
    const j = await r.json();
    const v = JSON.parse(String(j.choices?.[0]?.message?.content ?? '').trim().replace(/^```(?:json)?\s*|```\s*$/g, ''));
    if (!['pass', 'flag', 'hold'].includes(v.verdict)) throw new Error('bad verdict');
    if (kind === 'turn' && v.verdict === 'hold') v.verdict = 'flag';
    return { verdict: v.verdict, categories: v.categories ?? [], reasons: v.reasons ?? [], adapter: 'model', model };
  } catch (e) {
    const back = kind === 'turn' ? lexicalTurn(text) : lexicalResponse(text);
    return { ...back, reasons: [...back.reasons, `model screening unavailable, lexical placeholder used (${String(e.message ?? e).slice(0, 100)} on '${model}')`], adapter: 'lexical-fallback' };
  } finally { clearTimeout(to); }
};

const cases = new Map();
const sha = (s) => createHash('sha256').update(s).digest('hex');
const openCase = (tenant_id, source, subject, screened, conversation_id) => {
  const c = { case_id: `k_${randomBytes(9).toString('hex')}`, tenant_id, conversation_id, source, status: 'open',
    opened_at: new Date().toISOString(),
    brief: { categories: screened.categories, reasons: screened.reasons, adapter: screened.adapter ?? 'lexical', subject_sha256: sha(subject) } };
  cases.set(c.case_id, c);
  return c.case_id;
};

export async function screen(kind, body, tenant_id) {
  const screened = (await modelScreen(kind, body.text, body.history)) ?? { ...(kind === 'turn' ? lexicalTurn(body.text) : lexicalResponse(body.text)), adapter: 'lexical' };
  const out = { [`${kind}_id`]: `${kind === 'turn' ? 't' : 'r'}_${randomBytes(9).toString('hex')}`, verdict: screened.verdict, screening: screened.adapter };
  if (screened.verdict !== 'pass') { out.case_id = openCase(tenant_id, kind, body.text, screened, body.conversation_id); out.categories = screened.categories; out.reasons = screened.reasons; }
  return out;
}
export const listCases = (tenant_id) => [...cases.values()].filter((c) => c.tenant_id === tenant_id).map((c) => ({ case_id: c.case_id, status: c.status, opened_at: c.opened_at, source: c.source, brief: c.brief }));
export const getCase = (tenant_id, id) => { const c = cases.get(id); return c && c.tenant_id === tenant_id ? { case_id: c.case_id, status: c.status, assignee: null, opened_at: c.opened_at, source: c.source, brief: c.brief, evidence: { note: 'per-instance demo memory — durable encrypted store lives in the real layer' } } : null; };
export const readBody = (req) => new Promise((res, rej) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) rej(new Error('too large')); }); req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch { rej(new Error('invalid JSON')); } }); });
export const tenantFor = (key) => (key === (process.env.AKRYTH_MW_DEMO_KEY ?? 'dev-key') ? 'demo-tenant' : null);
