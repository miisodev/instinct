// Sealed evaluation: runs submitted policies (policies/<handle>.mjs) against games whose hidden state is derived from a secret season salt.
// Players never see the salt, so reading the source cannot reveal secrets or pre-solve the instances. Policies see observations only.
// Usage: SEALED_SALT=... node scripts/sealed.ts [--out public/sealed.json] [--seeds 5]   (without SEALED_SALT a PUBLIC dev salt is used and the output is marked dev:true)
import {readdirSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {spawn,spawnSync} from 'node:child_process';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {advance,observe,sealedSeed} from '../src/engine.ts';import {games} from '../src/games/index.ts';
const arg=(k:string,d:string)=>{const i=process.argv.indexOf(k);return i>=0?process.argv[i+1]:d;};
const salt=process.env.SEALED_SALT||'public-dev-salt';const dev=!process.env.SEALED_SALT;const K=Number(arg('--seeds','5'));const out=arg('--out','public/sealed.json');
const season=process.env.SEALED_SEASON||'dev';
const files=readdirSync('policies').filter(f=>/^[a-zA-Z0-9_.-]{1,32}\.mjs$/.test(f)).sort();
// Network isolation, fail closed. Policies are untrusted: they must not reach the network. We try, in order, unprivileged user+net namespace, then
// passwordless sudo net namespace with privileges dropped. Each candidate is proven by a self-test (the child must see no interface except lo).
// If none works we refuse to run policies. ALLOW_NO_NETNS=1 is a local-dev escape hatch and is refused when a real salt or CI is present.
const uid=process.getuid?.()??1000,gid=process.getgid?.()??1000;
const candidates:string[][]=[['unshare','-rn'],['sudo','-n','unshare','-n','setpriv',`--reuid=${uid}`,`--regid=${gid}`,'--clear-groups']];
const probe="const i=require('os').networkInterfaces();process.exit(Object.keys(i).some(k=>k!=='lo')?1:0)";
let iso:string[]=[];
if(files.length){
 if(process.platform==='linux')for(const c of candidates){const r=spawnSync(c[0],[...c.slice(1),process.execPath,'-e',probe],{env:{PATH:process.env.PATH??''},timeout:5000});if(r.status===0){iso=c;break;}}
 if(!iso.length){
  if(process.env.ALLOW_NO_NETNS==='1'&&!process.env.SEALED_SALT&&!process.env.GITHUB_ACTIONS){console.warn('WARNING: no network isolation available; running policies WITHOUT it (local dev only).');iso=['env'];}
  else{console.error('FATAL: cannot verify network isolation (need unshare -rn or passwordless sudo unshare -n). Refusing to run untrusted policies.');process.exit(1);}
 }
 console.log(`network isolation: ${iso.join(' ')}`);
}
async function play(file:string,g:typeof games[0],seed:number):Promise<number>{
 const runner=resolve('scripts/policy-runner.mjs'),pol=resolve('policies',file);
 const args=['--permission',`--allow-fs-read=${runner}`,`--allow-fs-read=${pol}`,runner,pathToFileURL(pol).href];
 const child=spawn(iso[0],[...iso.slice(1),process.execPath,...args],{env:{PATH:process.env.PATH??''},stdio:['pipe','pipe','ignore']});
 let buf='';const waiters:((m:string)=>void)[]=[];child.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i);buf=buf.slice(i+1);waiters.shift()?.(JSON.parse(l));}});
 const ask=(o:unknown)=>new Promise<string>((res,rej)=>{const t=setTimeout(()=>rej(Error('timeout')),2000);waiters.push(m=>{clearTimeout(t);res(m);});child.stdin.write(JSON.stringify(o)+'\n');});
 let s=g.init(sealedSeed(seed,salt));const t0=Date.now();
 try{while(!s.done){if(Date.now()-t0>30000)break;const legal=g.legalMoves(s);const m=await ask({game:g.id,turn:s.turns,description:g.describe(s),observation:observe(g,s),legalMoves:legal});if(!legal.includes(m))break;s=advance(g,s,m);}}catch{}
 child.kill();return s.done?g.score(s):0;}
const result:Record<string,{agent:string;mean:number;scores:number[]}[]>={};
for(const g of games){const rows=[];for(const f of files){const scores:number[]=[];for(let i=1;i<=K;i++)scores.push(await play(f,g,i));rows.push({agent:f.replace(/\.mjs$/,''),mean:Math.round(scores.reduce((a,b)=>a+b,0)/K),scores});}rows.sort((a,b)=>b.mean-a.mean||a.agent.localeCompare(b.agent));result[g.id]=rows;}
writeFileSync(out,JSON.stringify({season,dev,seeds:K,commitment:createHash('sha256').update(salt).digest('hex'),games:result},null,1)+'\n');console.log(`sealed ${season}${dev?' (DEV salt)':''}: ${files.length} policies x ${games.length} games x ${K} seeds`);
