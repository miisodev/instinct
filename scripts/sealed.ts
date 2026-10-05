// Sealed evaluation: runs submitted policies (policies/<handle>.mjs) against games whose hidden state is derived from a secret season salt.
// Players never see the salt, so reading the source cannot reveal secrets or pre-solve the instances. Policies see observations only.
// Usage: SEALED_SALT=... node scripts/sealed.ts [--out public/sealed.json] [--seeds 5]   (without SEALED_SALT a PUBLIC dev salt is used and the output is marked dev:true)
import {readdirSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {spawn,spawnSync} from 'node:child_process';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {advance,observe,sealedSeed} from '../src/engine.ts';import {games} from '../src/games/index.ts';
const arg=(k:string,d:string)=>{const i=process.argv.indexOf(k);return i>=0?process.argv[i+1]:d;};
const salt=process.env.SEALED_SALT||'public-dev-salt';const dev=!process.env.SEALED_SALT;const K=Number(arg('--seeds','5'));const out=arg('--out','public/sealed.json');
const season=process.env.SEALED_SEASON||'dev';
const files=readdirSync('policies').filter(f=>/^[a-zA-Z0-9_.-]{1,32}\.mjs$/.test(f)).sort();
async function play(file:string,g:typeof games[0],seed:number):Promise<number>{
 const runner=resolve('scripts/policy-runner.mjs'),pol=resolve('policies',file);
 const hasUnshare=process.platform==='linux'&&!process.env.NO_NETNS&&spawnSync('unshare',['-rn','true']).status===0;
 const args=['--permission',`--allow-fs-read=${runner}`,`--allow-fs-read=${pol}`,runner,pathToFileURL(pol).href];
 const child=hasUnshare?spawn('unshare',['-rn',process.execPath,...args],{env:{PATH:process.env.PATH??''},stdio:['pipe','pipe','ignore']}):spawn(process.execPath,args,{env:{},stdio:['pipe','pipe','ignore']});
 let buf='';const waiters:((m:string)=>void)[]=[];child.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i);buf=buf.slice(i+1);waiters.shift()?.(JSON.parse(l));}});
 const ask=(o:unknown)=>new Promise<string>((res,rej)=>{const t=setTimeout(()=>rej(Error('timeout')),2000);waiters.push(m=>{clearTimeout(t);res(m);});child.stdin.write(JSON.stringify(o)+'\n');});
 let s=g.init(sealedSeed(seed,salt));const t0=Date.now();
 try{while(!s.done){if(Date.now()-t0>30000)break;const legal=g.legalMoves(s);const m=await ask({game:g.id,turn:s.turns,description:g.describe(s),observation:observe(g,s),legalMoves:legal});if(!legal.includes(m))break;s=advance(g,s,m);}}catch{}
 child.kill();return s.done?g.score(s):0;}
const result:Record<string,{agent:string;mean:number;scores:number[]}[]>={};
for(const g of games){const rows=[];for(const f of files){const scores:number[]=[];for(let i=1;i<=K;i++)scores.push(await play(f,g,i));rows.push({agent:f.replace(/\.mjs$/,''),mean:Math.round(scores.reduce((a,b)=>a+b,0)/K),scores});}rows.sort((a,b)=>b.mean-a.mean||a.agent.localeCompare(b.agent));result[g.id]=rows;}
writeFileSync(out,JSON.stringify({season,dev,seeds:K,commitment:createHash('sha256').update(salt).digest('hex'),games:result},null,1)+'\n');console.log(`sealed ${season}${dev?' (DEV salt)':''}: ${files.length} policies x ${games.length} games x ${K} seeds`);
