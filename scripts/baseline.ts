// Reference agent. Writes replays under the honest handle `instinct-baseline` so the board is never empty.
// Uses only observations (hidden state is never read). Run: node scripts/baseline.ts [seed ...]  (default: 42)
import {writeFileSync,mkdirSync} from 'node:fs';
import {advance,observe,validateReplay,dailySeed,type Game,type State} from '../src/engine.ts';import {games} from '../src/games/index.ts';
const H='instinct-baseline';
const fb=(sec:string,g:string)=>{let e=0;const a=[0,0,0,0],b=[0,0,0,0];for(let i=0;i<4;i++){if(sec[i]===g[i])e++;else{a[+sec[i]]++;b[+g[i]]++;}}return [e,a.reduce((n,v,i)=>n+Math.min(v,b[i]),0)];};
const codes=Array.from({length:256},(_,i)=>i.toString(4).padStart(4,'0'));
const pol:Record<string,(g:Game,s:State)=>string>={
 signal(g,s){const h=observe(g,s).history as {guess:string;exact:number;near:number}[];return codes.find(c=>h.every(x=>{const [e,n]=fb(c,x.guess);return e===x.exact&&n===x.near;}))!;},
 gridshift(g,s){// BFS to optimal solution from current state
  const start=(s.tiles as number[]).join('');const goal='123456780';const prev=new Map<string,[string,string]>([[start,['','']]]);let q=[start];
  while(q.length&&!prev.has(goal)){const nq:string[]=[];for(const k of q){const t=k.split('').map(Number);const z=t.indexOf(0);const st={...s,tiles:t};for(const m of g.legalMoves(st as State)){const u=[...t];[u[z],u[+m]]=[u[+m],u[z]];const key=u.join('');if(!prev.has(key)){prev.set(key,[k,m]);nq.push(key);}}}q=nq;}
  let k=goal;let m='';while(prev.get(k)![0]!==start&&prev.get(k)![0]!==''){k=prev.get(k)![0];}m=prev.get(k)![1];return m;},
 vault(g,s){// exact DP over (pos,remaining shards,turn)
  const shards=s.shards as number[];const memo=new Map<string,[number,string]>();const D:Record<string,number>={up:-6,down:6,left:-1,right:1};
  const f=(pos:number,mask:number,t:number):[number,string]=>{const key=pos+','+mask+','+t;const c=memo.get(key);if(c)return c;let best:[number,string]=[mask===0?0:0,'extract'];const got=shards.length-popc(mask);
   const base=got*150+(pos===35?500+(24-t)*10:0);best=[base,'extract'];
   if(t<24&&pos!==35){for(const m of Object.keys(D)){const n=pos+D[m];if(n<0||n>35||(m==='left'&&pos%6===0)||(m==='right'&&pos%6===5))continue;let mk=mask;const idx=shards.indexOf(n);if(idx>=0&&(mask>>idx&1))mk=mask&~(1<<idx);const v=f(n,mk,t+1)[0];if(v>best[0])best=[v,m];}}
   memo.set(key,best);return best;};
  const popc=(x:number)=>{let c=0;while(x){c+=x&1;x>>=1;}return c;};
  return f(s.pos as number,(1<<shards.length)-1,s.turns as number)[1];},
 handshake(g,s){const h=observe(g,s).history as {me:string;them:string}[];return h.length?h[h.length-1].them:'C';},
 radar(g,s){const shots=observe(g,s).shots as {m:string;hit:boolean}[];const tried=new Set(shots.map(x=>x.m));const legal=g.legalMoves(s);
  // target: unfired neighbours of hits, else parity hunt
  for(const x of [...shots].reverse()){if(!x.hit)continue;const [r,c]=x.m.split(',').map(Number);for(const [a,b] of [[r,c+1],[r,c-1],[r+1,c],[r-1,c]]){const m=`${a},${b}`;if(legal.includes(m))return m;}}
  return legal.find(m=>{const [r,c]=m.split(',').map(Number);return (r+c)%2===0;})??legal[0];},
 heaps(g,s){const h=s.heaps as number[];const x=h.reduce((a,b)=>a^b,0);for(let i=0;i<h.length;i++){const t=h[i]^x;if(t<h[i])return `${i}:${h[i]-t}`;}const i=h.findIndex(v=>v>0);return `${i}:1`;},
};
const seeds=process.argv.slice(2).map(a=>a==='daily'?dailySeed():Number(a));if(!seeds.length)seeds.push(42);
mkdirSync('results',{recursive:true});
for(const g of games)for(const seed of seeds){let s=g.init(seed);const moves:string[]=[];while(!s.done){const m=pol[g.id](g,s);s=advance(g,s,m);moves.push(m);}
 const replay={schema:1 as const,game:g.id,version:g.version,seed,agent:H,moves};const v=validateReplay(replay,games);writeFileSync(`results/${g.id}-${seed}-${H}.json`,JSON.stringify(replay)+'\n');console.log(`${g.id} seed ${seed}: ${v.score} pts in ${v.turns} turns`);}
