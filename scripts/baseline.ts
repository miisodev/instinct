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
 fourrows(g,s){const W=7,H=6;const b=[...(s.board as number[])];const drop=(c:number)=>{for(let r=H-1;r>=0;r--)if(!b[r*W+c])return r;return -1;};
  const win=(p:number)=>{for(let r=0;r<H;r++)for(let c=0;c<W;c++)for(const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]]){let n=0;for(let k=0;k<4;k++){const rr=r+dr*k,cc=c+dc*k;if(rr<0||rr>=H||cc<0||cc>=W||b[rr*W+cc]!==p)break;n++;}if(n===4)return true;}return false;};
  const ev=()=>{let v=0;for(let r=0;r<H;r++)for(let c=0;c<W;c++){const x=b[r*W+c];if(x)v+=(x===1?1:-1)*(3-Math.abs(c-3));}return v;};
  const ord=[3,2,4,1,5,0,6];
  const ab=(p:number,d:number,al:number,be:number):number=>{if(win(1))return 1000+d;if(win(2))return -1000-d;const mv=ord.filter(c=>drop(c)>=0);if(!mv.length)return 0;if(!d)return ev();let best=p===1?-1e9:1e9;for(const c of mv){const r=drop(c);b[r*W+c]=p;const v=ab(3-p,d-1,al,be);b[r*W+c]=0;if(p===1){best=Math.max(best,v);al=Math.max(al,v);}else{best=Math.min(best,v);be=Math.min(be,v);}if(al>=be)break;}return best;};
  let bc=-1,bv=-1e9;for(const c of ord){const r=drop(c);if(r<0)continue;b[r*W+c]=1;const v=ab(2,5,-1e9,1e9);b[r*W+c]=0;if(v>bv){bv=v;bc=c;}}return String(bc);},
 courier(g,s){const P=s.points as {x:number;y:number}[];const dep=s.depot as {x:number;y:number};const dist=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
  if(!(globalThis as any).__route||(s.turns as number)===0){// nearest neighbour then 2-opt on the full tour
   let order:number[]=[];const left=new Set(P.map((_,i)=>i));let cur=dep;while(left.size){let bi=-1,bd=1e9;for(const i of left){const dd=dist(cur,P[i]);if(dd<bd){bd=dd;bi=i;}}order.push(bi);left.delete(bi);cur=P[bi];}
   const len=(o:number[])=>{let L=dist(dep,P[o[0]]);for(let i=1;i<o.length;i++)L+=dist(P[o[i-1]],P[o[i]]);return L+dist(P[o[o.length-1]],dep);};
   let improved=true;while(improved){improved=false;for(let i=0;i<order.length-1;i++)for(let j=i+1;j<order.length;j++){const n=[...order.slice(0,i),...order.slice(i,j+1).reverse(),...order.slice(j+1)];if(len(n)<len(order)-1e-9){order=n;improved=true;}}}
   // or-opt: move single stops
   improved=true;while(improved){improved=false;for(let i=0;i<order.length;i++)for(let j=0;j<order.length;j++){if(i===j)continue;const n=[...order];const [x]=n.splice(i,1);n.splice(j,0,x);if(len(n)<len(order)-1e-9){order=n;improved=true;}}}
   (globalThis as any).__route=order;}
  return String((globalThis as any).__route[s.turns as number]);},
};
const seeds=process.argv.slice(2).map(a=>a==='daily'?dailySeed():Number(a));if(!seeds.length)seeds.push(42);
mkdirSync('results',{recursive:true});
// @ts-expect-error untyped reference policy module (plain .mjs, observations in, move out)
const ref=(await import('../policies/instinct-baseline.mjs')).default as (o:unknown)=>string;
const move=(g:Game,s:State)=>pol[g.id]?pol[g.id](g,s):ref({game:g.id,turn:s.turns,description:g.describe(s),observation:observe(g,s),legalMoves:g.legalMoves(s)});
for(const g of games)for(const seed of seeds){let s=g.init(seed);const moves:string[]=[];while(!s.done){const m=move(g,s);s=advance(g,s,m);moves.push(m);}
 const replay={schema:1 as const,game:g.id,version:g.version,seed,agent:H,moves};const v=validateReplay(replay,games);writeFileSync(`results/${g.id}-${seed}-${H}.json`,JSON.stringify(replay)+'\n');console.log(`${g.id} seed ${seed}: ${v.score} pts in ${v.turns} turns`);}
