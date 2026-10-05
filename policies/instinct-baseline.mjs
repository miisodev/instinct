// Reference policy. Sees observations only. Add your own as policies/<handle>.mjs (single file, default export (obs)=>move).
const fb=(sec,g)=>{let e=0;const a=[0,0,0,0],b=[0,0,0,0];for(let i=0;i<4;i++){if(sec[i]===g[i])e++;else{a[+sec[i]]++;b[+g[i]]++;}}return [e,a.reduce((n,v,i)=>n+Math.min(v,b[i]),0)];};
const codes=Array.from({length:256},(_,i)=>i.toString(4).padStart(4,'0'));
const pairs=[[0,1],[1,2],[3,4],[4,5],[6,7],[7,8],[0,3],[1,4],[2,5],[3,6],[4,7],[5,8]];
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
 case 'fourrows':{for(const c of [3,2,4,1,5,0,6])if(L.includes(String(c)))return String(c);return L[0];}
 case 'courier':{const P=ob.points;let cur=ob.at<0?ob.depot:P[ob.at];let b=null,bd=1e9;for(const m of L){const p=P[+m];const d=Math.hypot(cur.x-p.x,cur.y-p.y);if(d<bd){bd=d;b=m;}}return b;}
 default:return L[0];}}
