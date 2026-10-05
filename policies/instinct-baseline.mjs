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
 default:return L[0];}}
