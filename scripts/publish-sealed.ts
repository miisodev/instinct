// Publishes public/sealed.json (from scripts/sealed.ts) to the arcade's Redis, where GET /api/policies serves it.
// Runs in the sealed CI workflow after evaluation. Needs UPSTASH_REDIS_REST_URL/TOKEN (or KV_REST_API_URL/TOKEN).
import {readFileSync} from 'node:fs';
import {upstash} from '../server/redis.ts';
import {POLICY_KEY} from '../server/core.ts';
const file=process.argv[2]||'public/sealed.json';
const board=JSON.parse(readFileSync(file,'utf8'));
if(board.dev){console.error('Refusing to publish a DEV-salt board: set SEALED_SALT.');process.exit(1);}
board.updated=new Date().toISOString();
await upstash(process.env).cmd('SET',POLICY_KEY,JSON.stringify(board));
console.log(`published ${POLICY_KEY}: season ${board.season}, ${Object.values<any[]>(board.games)[0]?.length??0} policies`);
