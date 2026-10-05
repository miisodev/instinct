// Upstash REST client (generated copy of server/redis.ts logic in plain JS).
export function upstash(env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  const post = async (path, body) => {
    if (!url || !token) throw new Error('Redis is not configured');
    const r = await fetch(url.replace(/\/$/, '') + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`redis http ${r.status}`);
    return r.json();
  };
  return {
    async cmd(...a) { const j = await post('/', a); if (j.error) throw new Error(j.error); return j.result; },
    async pipe(cmds) { const j = await post('/pipeline', cmds); return j.map(x => { if (x.error) throw new Error(x.error); return x.result; }); },
  };
}
