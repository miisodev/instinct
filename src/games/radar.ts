import {rng,type Game} from '../engine.ts';
// Dead Reckoning: hidden-fleet search on an 8x8 grid. 40 shots to sink 4 ships (12 cells).
const lens=[4,3,3,2];
type Shot={m:string;hit:boolean};
function place(seed:number){const r=rng(seed);r();r();r();const used=new Set<number>();const ships:number[][]=[];
 for(const L of lens){for(let tries=0;tries<500;tries++){const h=r()<0.5,row=Math.floor(r()*8),col=Math.floor(r()*8);const cells:number[]=[];for(let i=0;i<L;i++){const rr=h?row:row+i,cc=h?col+i:col;if(rr>7||cc>7){cells.length=0;break;}cells.push(rr*8+cc);}
  if(cells.length===L&&!cells.some(c=>used.has(c))){cells.forEach(c=>used.add(c));ships.push(cells);break;}}}
 return ships;}
export const radar:Game={id:'radar',version:1,name:'Dead Reckoning',category:'HIDDEN SEARCH',openBook:true,hidden:['ships'],
 description:'Four hidden ships (lengths 4,3,3,2) on an 8x8 grid. Fire at "row,col" (0-7). 40 shots. Sink the fleet with as few shots as you can.',maxTurns:40,
 init(seed){return {turns:0,done:false,ships:place(seed),shots:[] as Shot[],hits:0,sunk:0};},
 legalMoves(s){if(s.done)return [];const t=new Set((s.shots as Shot[]).map(x=>x.m));const out:string[]=[];for(let r=0;r<8;r++)for(let c=0;c<8;c++){const m=`${r},${c}`;if(!t.has(m))out.push(m);}return out;},
 step(s,m){const [r,c]=m.split(',').map(Number);const cell=r*8+c;const ships=s.ships as number[][];const hit=ships.some(x=>x.includes(cell));(s.shots as Shot[]).push({m,hit});if(hit)s.hits=(s.hits as number)+1;
  const fired=new Set((s.shots as Shot[]).filter(x=>x.hit).map(x=>{const [a,b]=x.m.split(',').map(Number);return a*8+b;}));s.sunk=ships.filter(x=>x.every(k=>fired.has(k))).length;
  s.turns++;s.done=s.sunk===4||s.turns>=40;return s;},
 score(s){return s.sunk===4?500+(40-(s.turns as number))*20:(s.hits as number)*30;},
 describe(s){return s.done?(s.sunk===4?'Fleet destroyed.':'Out of shots.'):`${40-s.turns} shots left. ${s.sunk}/4 ships sunk, ${s.hits}/12 cells hit. Fire "row,col".`;}};
