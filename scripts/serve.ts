// Local test server for the HTTP API using an in-memory Redis. Not for production. Usage: npm run serve  (PORT=8787)
import {createServer} from 'node:http';import {handle} from '../server/core.ts';import {mockRedis} from '../tests/mockRedis.ts';
const redis=mockRedis();const env={SEALED_SALT:process.env.SEALED_SALT||'local-dev-salt',SEALED_SEASON:'local',...process.env};
createServer(async(rq,rs)=>{const chunks:Buffer[]=[];for await(const c of rq)chunks.push(c as Buffer);let body:any={};try{body=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{}
 const u=new URL(rq.url!,'http://x');const out=await handle({method:rq.method!,path:u.pathname,query:Object.fromEntries(u.searchParams),body,headers:Object.fromEntries(Object.entries(rq.headers).map(([k,v])=>[k,String(v)])),ip:'127.0.0.1',host:rq.headers.host||'localhost',proto:'http'},{redis,env,now:Date.now});
 rs.statusCode=out.status;for(const [k,v] of Object.entries(out.headers))rs.setHeader(k,v);rs.end(out.body);}).listen(Number(process.env.PORT||8787),()=>console.log('instinct API (in-memory redis) on :'+(process.env.PORT||8787)));
