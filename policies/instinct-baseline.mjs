// Reference policy. Sees observations only. Add your own as policies/<handle>.mjs (single file, default export (obs)=>move).
const fb=(sec,g)=>{let e=0;const a=[0,0,0,0],b=[0,0,0,0];for(let i=0;i<4;i++){if(sec[i]===g[i])e++;else{a[+sec[i]]++;b[+g[i]]++;}}return [e,a.reduce((n,v,i)=>n+Math.min(v,b[i]),0)];};
const codes=Array.from({length:256},(_,i)=>i.toString(4).padStart(4,'0'));
const pairs=[[0,1],[1,2],[3,4],[4,5],[6,7],[7,8],[0,3],[1,4],[2,5],[3,6],[4,7],[5,8]];
function four(board,L){const W=7,H=6,b=[...board];const drop=c=>{for(let r=H-1;r>=0;r--)if(!b[r*W+c])return r;return -1;};
 const win=p=>{for(let r=0;r<H;r++)for(let c=0;c<W;c++)for(const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]]){let n=0;for(let k=0;k<4;k++){const rr=r+dr*k,cc=c+dc*k;if(rr<0||rr>=H||cc<0||cc>=W||b[rr*W+cc]!==p)break;n++;}if(n===4)return true;}return false;};
 const ev=()=>{let v=0;for(let r=0;r<H;r++)for(let c=0;c<W;c++)for(const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]]){let a=0,o=0,ok=true;for(let k=0;k<4;k++){const rr=r+dr*k,cc=c+dc*k;if(rr<0||rr>=H||cc<0||cc>=W){ok=false;break;}const x=b[rr*W+cc];if(x===1)a++;else if(x===2)o++;}if(ok){if(!o)v+=[0,1,4,20][a]??0;if(!a)v-=[0,1,4,20][o]??0;}}for(let r=0;r<H;r++)if(b[r*W+3]===1)v+=3;return v;};
 const ord=[3,2,4,1,5,0,6];
 const ab=(p,d,al,be)=>{if(win(1))return 1000+d;if(win(2))return -1000-d;const mv=ord.filter(c=>drop(c)>=0);if(!mv.length)return 0;if(!d)return ev();let best=p===1?-1e9:1e9;for(const c of mv){const r=drop(c);b[r*W+c]=p;const v=ab(3-p,d-1,al,be);b[r*W+c]=0;if(p===1){best=Math.max(best,v);al=Math.max(al,v);}else{best=Math.min(best,v);be=Math.min(be,v);}if(al>=be)break;}return best;};
 let bc=-1,bv=-1e9;for(const c of ord){const r=drop(c);if(r<0)continue;b[r*W+c]=1;const v=ab(2,5,-1e9,1e9);b[r*W+c]=0;if(v>bv){bv=v;bc=c;}}return String(bc>=0?bc:L[0]);}

// lights: solve A x = b over GF(2); the null space is tiny, so take the lightest of the solutions.
function lightsMove(lit,L){const n=25,idx=(r,c)=>r*5+c;const rows=[];for(let i=0;i<n;i++){const r=Math.floor(i/5),c=i%5;let m=0n;for(const [dr,dc] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){const rr=r+dr,cc=c+dc;if(rr>=0&&rr<5&&cc>=0&&cc<5)m|=1n<<BigInt(idx(rr,cc));}rows.push([m,lit[i]?1:0]);}
 // rows[i]: cells toggled by pressing i (symmetric matrix), rhs = lit[i]. Gaussian elimination on equations "sum over j of A[i][j] x_j = lit[i]".
 const piv=[];let r0=0;const eq=rows.map(([m,b])=>({m,b}));for(let col=0;col<n&&r0<n;col++){let p=-1;for(let i=r0;i<n;i++)if((eq[i].m>>BigInt(col))&1n){p=i;break;}if(p<0)continue;[eq[r0],eq[p]]=[eq[p],eq[r0]];for(let i=0;i<n;i++)if(i!==r0&&((eq[i].m>>BigInt(col))&1n)){eq[i].m^=eq[r0].m;eq[i].b^=eq[r0].b;}piv.push(col);r0++;}
 const free=[];for(let c=0;c<n;c++)if(!piv.includes(c))free.push(c);let best=null;
 for(let mask=0;mask<(1<<free.length);mask++){const x=Array(n).fill(0);free.forEach((f,k)=>{x[f]=(mask>>k)&1;});for(let k=piv.length-1;k>=0;k--){const e=eq[k];let v=e.b;for(const f of free)if((e.m>>BigInt(f))&1n)v^=x[f];x[piv[k]]=v;}
  if(eq.slice(piv.length).some(e=>e.b))return L[0];const w=x.reduce((a,b)=>a+b,0);if(!best||w<best.w)best={w,x};}
 const k=best?best.x.findIndex(v=>v===1):-1;return k>=0&&L.includes(String(k))?String(k):L[0];}
// minefield: constraint deduction, then the lowest-risk guess.
function mineMove(board,L){const N=8,cell=(r,c)=>board[r][c];const nb=(r,c)=>{const o=[];for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){if(!dr&&!dc)continue;const a=r+dr,b=c+dc;if(a>=0&&a<N&&b>=0&&b<N)o.push([a,b]);}return o;};
 const M=new Set(),S=new Set(),key=(r,c)=>r*N+c;let ch=true;
 while(ch){ch=false;for(let r=0;r<N;r++)for(let c=0;c<N;c++){const v=cell(r,c);if(v==='#'||v==='.')continue;const n=+v;const unk=nb(r,c).filter(([a,b])=>cell(a,b)==='#'&&!M.has(key(a,b))&&!S.has(key(a,b)));const m=nb(r,c).filter(([a,b])=>M.has(key(a,b))).length;
   if(!unk.length)continue;if(n-m===0){for(const [a,b] of unk)S.add(key(a,b));ch=true;}else if(n-m===unk.length){for(const [a,b] of unk)M.add(key(a,b));ch=true;}}}
 for(const m of L){const [r,c]=m.split(',').map(Number);if(S.has(key(r,c)))return m;}
 let unrevealed=0;for(let r=0;r<N;r++)for(let c=0;c<N;c++)if(cell(r,c)==='#')unrevealed++;const dens=Math.max(0.01,(10-M.size)/Math.max(1,unrevealed-M.size));
 let bm=L[0],bp=2;for(const m of L){const [r,c]=m.split(',').map(Number);if(M.has(key(r,c)))continue;let p=0,k=0;for(const [a,b] of nb(r,c)){const v=cell(a,b);if(v==='#'||v==='.')continue;const unk=nb(a,b).filter(([x,y])=>cell(x,y)==='#'&&!M.has(key(x,y))).length;const mm=nb(a,b).filter(([x,y])=>M.has(key(x,y))).length;if(unk){p=Math.max(p,(+v-mm)/unk);k++;}}
  const risk=k?p:dens;if(risk<bp){bp=risk;bm=m;}}
 return bm;}
// prospector: UCB1 over the six claims, using only the struck/dug tallies.
function prospectMove(ob,L){const n=ob.pulls,g=ob.gold,t=n.reduce((a,b)=>a+b,0);const fresh=n.findIndex(x=>x===0);if(fresh>=0)return String(fresh);
 let bi=0,bv=-1;for(let i=0;i<n.length;i++){const v=g[i]/n[i]+Math.sqrt(0.6*Math.log(t+1)/n[i]);if(v>bv){bv=v;bi=i;}}return String(bi);}
// nextterm: try simple rule families in order, keep the first that explains every known term.
function nextTermMove(ob){const x=ob.terms,n=x.length,ds=x.slice(1).map((v,i)=>v-x[i]);const ok=v=>Number.isInteger(v)&&v>=0&&v<=999;const fits=f=>{let checked=0;for(let i=2;i<n;i++){const v=f(x.slice(0,i));if(Number.isNaN(v))continue;checked++;if(v!==x[i])return false;}return checked>0;};
 const dsum=v=>String(v).split('').reduce((a,c)=>a+Number(c),0);
 const rules=[
  a=>a[a.length-1]+(a[a.length-1]-a[a.length-2]),
  a=>{if(a.length<3)return NaN;const k=a.length;return 3*a[k-1]-3*a[k-2]+a[k-3];},
  a=>a[a.length-1]+a[a.length-2],
  a=>{const k=a.length;if(k<4)return NaN;return a[k-2]+(a[k-2]-a[k-4]);},
  a=>a[a.length-1]+dsum(a[a.length-1]),
  ...[2,3].map(p=>a=>{const k=a.length;if(k<=p)return NaN;return a[k-1]+(a[k-p]-a[k-p-1]);}),
  ...[1,2,3,4].map(c=>a=>(a[a.length-1]*2+c)%1000)];
 for(const f of rules)if(fits(f)){const v=f(x);if(ok(v))return String(v);}
 const v=x[n-1]+(ds[ds.length-1]??0);return String(Math.min(999,Math.max(0,v)));}
export default function(o){const ob=o.observation,L=o.legalMoves;
 switch(o.game){
 case 'signal':return codes.find(c=>ob.history.every(x=>{const [e,n]=fb(c,x.guess);return e===x.exact&&n===x.near;}));
 case 'gridshift':{const start=ob.tiles.join('');const goal='123456780';const prev=new Map([[start,null]]);let q=[start];
  while(q.length&&!prev.has(goal)){const nq=[];for(const k of q){const t=k.split('').map(Number);const z=t.indexOf(0);for(const p of pairs){if(!p.includes(z))continue;const i=p[0]===z?p[1]:p[0];const u=[...t];[u[z],u[i]]=[u[i],u[z]];const key=u.join('');if(!prev.has(key)){prev.set(key,[k,String(i)]);nq.push(key);}}}q=nq;}
  let k=goal;if(!prev.has(goal))return L[0];while(prev.get(k)[0]!==start)k=prev.get(k)[0];return prev.get(k)[1];}
 case 'vault':{const pos=ob.pos,sh=ob.shards;const D={up:-6,down:6,left:-1,right:1};const cost=(a,b)=>Math.abs(Math.floor(a/6)-Math.floor(b/6))+Math.abs(a%6-b%6);
  const left=24-ob.turns;let target=35;let best=1e9;for(const s of sh){const c=cost(pos,s);if(c+cost(s,35)<=left&&c<best){best=c;target=s;}}
  if(pos===target&&target!==35)target=35;let bm=L[0],bd=1e9;for(const m of L){if(m==='extract')continue;const n=pos+D[m];const d=cost(n,target);if(d<bd){bd=d;bm=m;}}return bm;}
 case 'handshake':return ob.history.length?ob.history[ob.history.length-1].them:'C';
 case 'radar':{const shots=ob.shots;for(const x of [...shots].reverse()){if(!x.hit)continue;const [r,c]=x.m.split(',').map(Number);for(const [a,b] of [[r,c+1],[r,c-1],[r+1,c],[r-1,c]]){const m=`${a},${b}`;if(L.includes(m))return m;}}return L.find(m=>{const [r,c]=m.split(',').map(Number);return (r+c)%2===0;})??L[0];}
 case 'heaps':{const h=ob.heaps;const x=h.reduce((a,b)=>a^b,0);for(let i=0;i<h.length;i++){const t=h[i]^x;if(t<h[i])return `${i}:${h[i]-t}`;}return `${h.findIndex(v=>v>0)}:1`;}
 case 'fourrows':return four(ob.board,L);
 case 'courier':{const P=ob.points;let cur=ob.at<0?ob.depot:P[ob.at];let b=null,bd=1e9;for(const m of L){const p=P[+m];const d=Math.hypot(cur.x-p.x,cur.y-p.y);if(d<bd){bd=d;b=m;}}return b;}
 case 'lights':return lightsMove(ob.lights,L);
 case 'minefield':return mineMove(ob.board,L);
 case 'prospector':return prospectMove(ob,L);
 case 'nextterm':return nextTermMove(ob);
 default:return L[0];}}
