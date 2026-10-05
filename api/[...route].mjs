// Vercel glue: one function serves the whole API. All logic lives in the bundled _core.mjs.
import {handle} from './_core.mjs';
import {upstash} from './_redis.mjs';
export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const chunks = [];
  let body = req.body;
  if (body === undefined) { for await (const c of req) chunks.push(c); const raw = Buffer.concat(chunks).toString('utf8'); try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; } }
  else if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const h = req.headers;
  const out = await handle({
    method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: body || {},
    headers: Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : String(v)])),
    ip: String(h['x-vercel-forwarded-for'] || h['x-real-ip'] || (h['x-forwarded-for'] || '').split(',')[0] || 'unknown').trim(),
    host: String(h['x-forwarded-host'] || h.host || 'localhost'), proto: String(h['x-forwarded-proto'] || 'https').split(',')[0],
  }, { redis: upstash(process.env), env: process.env, now: () => Date.now() });
  res.statusCode = out.status;
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  res.end(out.body);
}
