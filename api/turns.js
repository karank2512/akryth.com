import { screen, readBody, tenantFor } from './_lib.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const tenant = tenantFor(req.headers['x-akryth-key']);
  if (!tenant) return res.status(401).json({ error: 'unknown tenant key' });
  try {
    const body = await readBody(req);
    if (typeof body.conversation_id !== 'string' || typeof body.text !== 'string') return res.status(400).json({ error: 'conversation_id and text required' });
    return res.status(200).json(await screen('turn', body, tenant));
  } catch (e) { return res.status(400).json({ error: String(e.message ?? e).slice(0, 200) }); }
}
