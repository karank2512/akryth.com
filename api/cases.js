import { listCases, getCase } from './_lib.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (token !== (process.env.AKRYTH_MW_DEMO_TOKEN ?? 'dev-token')) return res.status(401).json({ error: 'unknown reviewer token' });
  const id = req.query?.id ?? new URL(req.url, 'http://localhost').searchParams.get('id');
  if (id) { const c = getCase('demo-tenant', id); return res.status(c ? 200 : 404).json(c ?? { error: 'not found' }); }
  return res.status(200).json({ cases: listCases('demo-tenant') });
}
