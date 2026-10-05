// Minimal Upstash Redis REST client (plain fetch, no dependencies). Works with the env vars the Vercel/Upstash integration injects.
export type Arg = string | number;
export interface Redis { cmd(...a: Arg[]): Promise<any>; pipe(cmds: Arg[][]): Promise<any[]>; }
export function upstash(env: Record<string, string | undefined>): Redis {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Redis is not configured (expected KV_REST_API_URL/KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN)');
  const post = async (path: string, body: unknown) => {
    const r = await fetch(url.replace(/\/$/, '') + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`redis http ${r.status}`);
    return r.json();
  };
  return {
    async cmd(...a) { const j: any = await post('/', a); if (j.error) throw new Error(j.error); return j.result; },
    async pipe(cmds) { const j: any[] = await post('/pipeline', cmds); return j.map(x => { if (x.error) throw new Error(x.error); return x.result; }); },
  };
}
