// instinct-owner: sealed policy, observations only. No imports, no fs, no network, no salt access.
const now=()=>Date.now();
const fb=(sec,g)=>{let e=0;const a=[0,0,0,0],b=[0,0,0,0];for(let i=0;i<4;i++){if(sec[i]===g[i])e++;else{a[+sec[i]]++;b[+g[i]]++;}}return [e,a.reduce((n,v,i)=>n+Math.min(v,b[i]),0)];};
const codes=Array.from({length:256},(_,i)=>i.toString(4).padStart(4,'0'));
const pairs=[[0,1],[1,2],[3,4],[4,5],[6,7],[7,8],[0,3],[1,4],[2,5],[3,6],[4,7],[5,8]];

// ---------- signal: pick the guess that splits the consistent set best ----------
function signal(ob){
 const cands=codes.filter(c=>ob.history.every(x=>{const [e,n]=fb(c,x.guess);return e===x.exact&&n===x.near;}));
 if(cands.length<=2)return cands[0]??codes[0];
 const isC=new Set(cands);let best=null,bs=1e18;
 for(const g of codes){const cnt=new Map();for(const c of cands){const [e,n]=fb(c,g);const k=e*5+n;cnt.set(k,(cnt.get(k)||0)+1);}
  let s=0;for(const v of cnt.values())s+=v*v;if(!isC.has(g))s+=0.5;if(s<bs){bs=s;best=g;}}
 return best;}

// ---------- gridshift: BFS shortest solution ----------
function gridshift(ob,L){const start=ob.tiles.join('');const goal='123456780';const prev=new Map([[start,null]]);let q=[start];
 while(q.length&&!prev.has(goal)){const nq=[];for(const k of q){const t=k.split('').map(Number);const z=t.indexOf(0);for(const p of pairs){if(!p.includes(z))continue;const i=p[0]===z?p[1]:p[0];const u=[...t];[u[z],u[i]]=[u[i],u[z]];const key=u.join('');if(!prev.has(key)){prev.set(key,[k,String(i)]);nq.push(key);}}}q=nq;}
 if(!prev.has(goal))return L[0];let k=goal;while(prev.get(k)[0]!==start)k=prev.get(k)[0];return prev.get(k)[1];}

// ---------- vault: exact subset-order DP over shards, recomputed each step ----------
const man=(a,b)=>Math.abs(Math.floor(a/6)-Math.floor(b/6))+Math.abs(a%6-b%6);
function vaultBest(pos,shards,left){ // best future value (shards*150 + 10*leftover) from pos, must reach 35
 const n=shards.length,F=1<<n;let best=10*(left-man(pos,35));if(man(pos,35)>left)return -1e9;
 const dp=Array.from({length:F},()=>new Array(n).fill(1e9));
 for(let i=0;i<n;i++)dp[1<<i][i]=man(pos,shards[i]);
 for(let m=1;m<F;m++){let cnt=0;for(let i=0;i<n;i++)if(m>>i&1)cnt++;
  for(let i=0;i<n;i++){const d=dp[m][i];if(d>=1e9||!(m>>i&1))continue;
   const t=d+man(shards[i],35);if(t<=left){const v=150*cnt+10*(left-t);if(v>best)best=v;}
   for(let j=0;j<n;j++){if(m>>j&1)continue;const nd=d+man(shards[i],shards[j]);if(nd<dp[m|1<<j][j])dp[m|1<<j][j]=nd;}}}
 return best;}
function vault(ob,L){const D={up:-6,down:6,left:-1,right:1};const pos=ob.pos,left=24-ob.turns;let bm=L[0],bv=-1e18;
 for(const m of L){if(m==='extract')continue;const np=pos+D[m];const gain=ob.shards.includes(np)?150:0;
  const rest=ob.shards.filter(s=>s!==np);const v=gain+vaultBest(np,rest,left-1)+(np===35?0:0);
  if(v>bv){bv=v;bm=m;}}
 return bm;}

// ---------- handshake: Bayesian belief over opponent kind + short expectimax ----------
const kinds=['mirror','grudge','hawk','dove','pavlov','dice'];
const pay={CC:3,CD:0,DC:5,DD:1};
function resp(k,last,everD){switch(k){case 'mirror':return last?last.me:'C';case 'grudge':return everD?'D':'C';case 'hawk':return 'D';case 'dove':return 'C';case 'pavlov':return last?(last.me===last.them?'C':'D'):'C';default:return null;}}
const vdMemo=new Map();
function vdet(k,last,everD,rem){if(rem<=0)return 0;if(k==='dice')return 3.8*rem;
 const key=k+(last?last.me+last.them:'--')+(everD?1:0)+rem;let v=vdMemo.get(key);if(v!==undefined)return v;v=-1;
 for(const m of ['C','D']){const t=resp(k,last,everD);const val=pay[m+t]+vdet(k,{me:m,them:t},everD||m==='D',rem-1);if(val>v)v=val;}
 vdMemo.set(key,v);return v;}
function look(w,last,everD,rem,h){ // w: weights by kind; returns [bestValue,bestMove]
 if(rem<=0)return [0,'C'];
 if(h<=0){let s=0;for(let i=0;i<6;i++)if(w[i]>0)s+=w[i]*vdet(kinds[i],last,everD,rem);return [s,'C'];}
 let bv=-1,bm='C';
 for(const m of ['C','D']){const wc=[0,0,0,0,0,0],wd=[0,0,0,0,0,0];
  for(let i=0;i<6;i++){if(w[i]<=0)continue;if(i===5){wc[i]=w[i]*0.7;wd[i]=w[i]*0.3;}else{(resp(kinds[i],last,everD)==='C'?wc:wd)[i]=w[i];}}
  let v=0;const ne=everD||m==='D';
  for(const [r,ww] of [['C',wc],['D',wd]]){const tot=ww.reduce((a,b)=>a+b,0);if(tot<=0)continue;v+=tot*pay[m+r]+look(ww,{me:m,them:r},ne,rem-1,h-1)[0];}
  if(v>bv+1e-9){bv=v;bm=m;}}
 return [bv,bm];}
function handshake(ob){const hist=ob.history;const w=[1,1,1,1,1,1];let last=null,everD=false;
 for(const x of hist){for(let i=0;i<6;i++){if(w[i]<=0)continue;if(i===5)w[i]*=x.them==='C'?0.7:0.3;else if(resp(kinds[i],last,everD)!==x.them)w[i]=0;}
  last=x;everD=everD||x.me==='D';}
 const tot=w.reduce((a,b)=>a+b,0);for(let i=0;i<6;i++)w[i]/=tot;
 const rem=20-hist.length;return look(w,last,everD,rem,Math.min(rem,9))[1];}

// ---------- radar: Monte Carlo over fleet placements consistent with all shots ----------
const LENS=[4,3,3,2];
const PL=[...new Set(LENS)].reduce((o,L)=>{const a=[];for(let r=0;r<8;r++)for(let c=0;c<8;c++){if(c+L<=8)a.push(Array.from({length:L},(_,i)=>r*8+c+i));if(r+L<=8)a.push(Array.from({length:L},(_,i)=>(r+i)*8+c));}o[L]=a;return o;},{});
let seedR=12345;const rnd=()=>{seedR=(Math.imul(seedR,1664525)+1013904223)>>>0;return seedR/4294967296;};
function radar(ob,L){
 const hits=new Set(),miss=new Set(),shot=new Set();
 for(const x of ob.shots){const [r,c]=x.m.split(',').map(Number);const k=r*8+c;shot.add(k);(x.hit?hits:miss).add(k);}
 const valid=L.map(m=>{const [r,c]=m.split(',').map(Number);return r*8+c;});
 const placements=[...new Set(LENS)].reduce((o,l)=>{o[l]=PL[l].filter(p=>!p.some(c=>miss.has(c)));return o;},{});
 const cnt=new Array(64).fill(0);let acc=0;const t0=now(),budget=ob.shots.length<2?60:260;let tries=0;
 const hitArr=[...hits];
 while(tries<60000){tries++;if((tries&63)===0&&now()-t0>budget)break;
  const used=new Set();const ships=[];let ok=true;
  const order=LENS.map((l,i)=>[l,rnd()+i*0]).sort((a,b)=>a[1]-b[1]).map(x=>x[0]);
  for(const l of order){const unc=hitArr.filter(c=>!used.has(c)&&!ships.some(s=>s.includes(c)));
   let pool=placements[l].filter(p=>!p.some(c=>used.has(c)));
   if(!pool.length){ok=false;break;}
   if(unc.length&&rnd()<0.9){const cov=pool.filter(p=>p.some(c=>unc.includes(c)));if(cov.length)pool=cov;}
   const p=pool[Math.floor(rnd()*pool.length)];ships.push(p);p.forEach(c=>used.add(c));}
  if(!ok)continue;
  if(hitArr.some(c=>!used.has(c)))continue;
  let sunk=0;for(const s of ships)if(s.every(c=>hits.has(c)))sunk++;
  if(sunk!==ob.sunk)continue;
  acc++;for(const c of used)if(!shot.has(c))cnt[c]++;}
 let bm=null,bv=-1;
 if(acc>0){for(const k of valid){if(cnt[k]>bv){bv=cnt[k];bm=k;}}}
 if(bm===null||bv<=0){ // fallback: hunt/target
  for(const k of [...hits].reverse()){const r=Math.floor(k/8),c=k%8;for(const [a,b] of [[r,c+1],[r,c-1],[r+1,c],[r-1,c]]){if(a<0||b<0||a>7||b>7)continue;if(!shot.has(a*8+b))return `${a},${b}`;}}
  return L.find(m=>{const [r,c]=m.split(',').map(Number);return (r+c)%2===0;})??L[0];}
 return `${Math.floor(bm/8)},${bm%8}`;}

// ---------- heaps: expectation DP against the known blundering opponent model ----------
const xor=a=>a.reduce((x,y)=>x^y,0);
const hMemo=new Map(),aMemo=new Map();
const hkey=h=>[...h].sort((a,b)=>a-b).join(',');
function oppDist(h){const mv=[];h.forEach((v,i)=>{for(let n=1;n<=v;n++)mv.push([i,n]);});let g=-1;
 for(let j=0;j<mv.length;j++){const t=[...h];t[mv[j][0]]-=mv[j][1];if(xor(t)===0){g=j;break;}}
 return mv.map((m,j)=>[m,g<0?1/mv.length:0.2/mv.length+(j===g?0.8:0)]);}
// R = E[win ? 1000-20*(my remaining moves) : 0], P = win probability. Opponent to move in oppNode.
function oppNode(h){const key=hkey(h);let v=aMemo.get(key);if(v)return v;let R=0,P=0;
 for(const [[i,n],p] of oppDist(h)){const t=[...h];t[i]-=n;if(t.every(x=>x===0))continue;const [r,pp]=myNode(t);R+=p*(r-20*pp);P+=p*pp;}
 v=[R,P];aMemo.set(key,v);return v;}
function myNode(h){const key=hkey(h);let v=hMemo.get(key);if(v)return v;let bR=-1e9,bP=0;
 for(let i=0;i<h.length;i++)for(let n=1;n<=h[i];n++){const t=[...h];t[i]-=n;let R,P;
  if(t.every(x=>x===0)){R=980;P=1;}else[R,P]=oppNode(t);
  if(R>bR){bR=R;bP=P;}}
 v=[bR,bP];hMemo.set(key,v);return v;}
function heaps(ob){const h=ob.heaps;let bm=null,bR=-1e9;
 for(let i=0;i<h.length;i++)for(let n=1;n<=h[i];n++){const t=[...h];t[i]-=n;let R;
  if(t.every(x=>x===0))R=980;else R=oppNode(t)[0];
  if(R>bR){bR=R;bm=`${i}:${n}`;}}
 return bm;}

// ---------- fourrows: exact model of the (deterministic) opponent, lookahead over my moves ----------
const W=7,H=6,ORD=[3,2,4,1,5,0,6];
const WINS=[];for(let r=0;r<H;r++)for(let c=0;c<W;c++)for(const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]]){const w=[];let ok=true;for(let k=0;k<4;k++){const rr=r+dr*k,cc=c+dc*k;if(rr<0||rr>=H||cc<0||cc>=W){ok=false;break;}w.push(rr*W+cc);}if(ok)WINS.push(w);}
const TAB=[0,1,4,20,0];
function evalB(b,p){let s=0;const q=3-p;for(const w of WINS){let a=0,o=0;for(let k=0;k<4;k++){const v=b[w[k]];if(v===p)a++;else if(v===q)o++;}if(!o)s+=TAB[a];if(!a)s-=TAB[o];}for(let r=0;r<H;r++)if(b[r*W+3]===p)s+=3;return s;}
function dropRow(b,c){for(let r=H-1;r>=0;r--)if(!b[r*W+c])return r;return -1;}
function winAt(b,r,c,p){for(const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]]){let n=1;for(let k=1;k<4;k++){const rr=r+dr*k,cc=c+dc*k;if(rr<0||rr>=H||cc<0||cc>=W||b[rr*W+cc]!==p)break;n++;}for(let k=1;k<4;k++){const rr=r-dr*k,cc=c-dc*k;if(rr<0||rr>=H||cc<0||cc>=W||b[rr*W+cc]!==p)break;n++;}if(n>=4)return true;}return false;}
function osearch(b,p,me,d,al,be,lr,lc,lp){if(winAt(b,lr,lc,lp))return lp===me?1000+d:-1000-d;
 let any=false;const mv=[];for(const c of ORD){if(dropRow(b,c)>=0){mv.push(c);any=true;}}if(!any)return 0;if(!d)return evalB(b,me);
 let best=p===me?-1e9:1e9;for(const c of mv){const r=dropRow(b,c);b[r*W+c]=p;const v=osearch(b,3-p,me,d-1,al,be,r,c,p);b[r*W+c]=0;
  if(p===me){if(v>best)best=v;if(v>al)al=v;}else{if(v<best)best=v;if(v<be)be=v;}if(al>=be)break;}return best;}
const oppCache=new Map();
function oppPlay(b,depth){const key=depth+b.join('');let v=oppCache.get(key);if(v!==undefined)return v;let bc=-1,bv=-1e9;
 for(const c of ORD){const r=dropRow(b,c);if(r<0)continue;b[r*W+c]=2;const x=osearch(b,1,2,depth-1,-1e9,1e9,r,c,2);b[r*W+c]=0;if(x>bv){bv=x;bc=c;}}
 oppCache.set(key,bc);return bc;}
class Timeout extends Error{}
function fourrows(ob,L){const b0=[...ob.board],depth=ob.depth??4,t0=ob.turn;const deadline=now()+600;
 const full=b=>b.every(x=>x);
 function mine(b,t,d){ // my move, t = turns so far; returns best value (score scale)
  if(now()>deadline)throw new Timeout();let best=-1e9;
  for(const c of ORD){const r=dropRow(b,c);if(r<0)continue;b[r*W+c]=1;let v;
   if(winAt(b,r,c,1))v=1000-(t+1)*15;
   else if(full(b))v=300;
   else{const oc=oppPlay(b,depth),orr=dropRow(b,oc);b[orr*W+oc]=2;
    if(winAt(b,orr,oc,2))v=(t+1)*5;else if(full(b)||t+1>=21)v=300;
    else if(d<=1){v=Math.max(60,Math.min(750,380+evalB(b,1)*4));}
    else v=mine(b,t+1,d-1);
    b[orr*W+oc]=0;}
   b[r*W+c]=0;if(v>best)best=v;}
  return best;}
 let bm=null;const legal=L.map(Number);
 for(let d=1;d<=12;d++){try{let bv=-1e9,m=null;
   for(const c of ORD){if(!legal.includes(c))continue;const b=[...b0];const r=dropRow(b,c);b[r*W+c]=1;let v;
    if(winAt(b,r,c,1))v=1000-(t0+1)*15;else if(full(b))v=300;
    else{const oc=oppPlay(b,depth),orr=dropRow(b,oc);b[orr*W+oc]=2;
     if(winAt(b,orr,oc,2))v=(t0+1)*5;else if(full(b)||t0+1>=21)v=300;
     else if(d<=1)v=Math.max(60,Math.min(750,380+evalB(b,1)*4));else v=mine(b,t0+1,d-1);}
    if(v>bv){bv=v;m=c;}}
   bm=m;if(bv>=1000-(t0+d)*15-1&&bv>=700)break;
  }catch(e){if(e instanceof Timeout)break;throw e;}}
 return String(bm??L[0]);}

// ---------- courier: 2-opt + Or-opt with restarts, tour computed once ----------
let tour=null;
function courierPlan(P,depot){const pts=[depot,...P];const n=pts.length;const D=pts.map(a=>pts.map(b=>Math.hypot(a.x-b.x,a.y-b.y)));
 const len=t=>{let s=0;for(let i=0;i<t.length;i++)s+=D[t[i]][t[(i+1)%t.length]];return s;};
 function improve(t){let imp=true;while(imp){imp=false;
  for(let i=1;i<n-1;i++)for(let j=i+1;j<n;j++){const a=t[i-1],b=t[i],c=t[j],d=t[(j+1)%n];if(D[a][c]+D[b][d]<D[a][b]+D[c][d]-1e-9){let x=i,y=j;while(x<y){[t[x],t[y]]=[t[y],t[x]];x++;y--;}imp=true;}}
  for(let seg=1;seg<=3;seg++)for(let i=1;i+seg<=n;i++){const s=t.slice(i,i+seg);const rest=[...t.slice(0,i),...t.slice(i+seg)];const m=rest.length;
   const cur=len(t);let bestL=cur-1e-9,bt=null;
   for(let k=0;k<m;k++){for(const sg of [s,[...s].reverse()]){const cand=[...rest.slice(0,k+1),...sg,...rest.slice(k+1)];const l=len(cand);if(l<bestL){bestL=l;bt=cand;}}}
   if(bt){for(let q=0;q<n;q++)t[q]=bt[q];imp=true;}}}
  return t;}
 let best=null,bl=1e18;const t0=now();let seed=7;const rr=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 let cur=null;
 for(let it=0;now()-t0<700||it<3;it++){
  let t;
  if(it===0){t=[0];const left=new Set(Array.from({length:n-1},(_,i)=>i+1));while(left.size){let bj=-1,bd=1e9;for(const j of left)if(D[t[t.length-1]][j]<bd){bd=D[t[t.length-1]][j];bj=j;}t.push(bj);left.delete(bj);}}
  else if(cur&&it%2){t=[...cur]; // double-bridge perturbation
   const p=[1+Math.floor(rr()*(n-1)),1+Math.floor(rr()*(n-1)),1+Math.floor(rr()*(n-1))].sort((a,b)=>a-b);
   t=[...t.slice(0,p[0]),...t.slice(p[1],p[2]),...t.slice(p[0],p[1]),...t.slice(p[2])];}
  else{const rest=Array.from({length:n-1},(_,i)=>i+1);for(let i=rest.length-1;i>0;i--){const j=Math.floor(rr()*(i+1));[rest[i],rest[j]]=[rest[j],rest[i]];}t=[0,...rest];}
  improve(t);const l=len(t);
  if(!cur||l<=len(cur))cur=[...t];
  if(l<bl){bl=l;best=[...t];}
  if(now()-t0>1200)break;}
 return best.slice(1).map(i=>i-1);}
function courier(ob,L){if(ob.turn===0||!tour)tour=courierPlan(ob.points,ob.depot);
 for(const m of tour)if(L.includes(String(m)))return String(m);return L[0];}

export default function(o){const ob=o.observation,L=o.legalMoves;
 switch(o.game){
 case 'signal':return signal(ob);
 case 'gridshift':return gridshift(ob,L);
 case 'vault':return vault(ob,L);
 case 'handshake':return handshake(ob);
 case 'radar':return radar(ob,L);
 case 'heaps':return heaps(ob);
 case 'fourrows':return fourrows({...ob,turn:o.turn},L);
 case 'courier':return courier({...ob,turn:o.turn},L);
 default:return L[0];}}
