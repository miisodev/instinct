import {rng2 as rng,type Game} from '../engine.ts';
// Courier: visit all 24 stops from the depot and return. Shortest tour scores most. The instance is public; the quality of your route is the skill.
const N=24;type P={x:number;y:number};
const d=(a:P,b:P)=>Math.hypot(a.x-b.x,a.y-b.y);
export const courier:Game={id:'courier',version:1,name:'Courier',category:'ROUTE OPTIMIZATION',openBook:false,
 description:'Visit 24 stops on a 100x100 map starting and ending at the depot (50,50). Name the next stop by index. Score is 3000 minus 2 per unit of distance, so shorter routes win. Exact search is infeasible, so heuristics decide the board.',maxTurns:N,
 init(seed){const r=rng(seed);const pts:P[]=Array.from({length:N},()=>({x:Math.floor(r()*101),y:Math.floor(r()*101)}));return {turns:0,done:false,depot:{x:50,y:50},points:pts,at:-1,visited:[] as number[],length:0};},
 legalMoves(s){if(s.done)return [];const v=new Set(s.visited as number[]);return Array.from({length:N},(_,i)=>i).filter(i=>!v.has(i)).map(String);},
 step(s,m){const pts=s.points as P[],i=+m;const from=s.at===-1?(s.depot as P):pts[s.at as number];s.length=(s.length as number)+d(from,pts[i]);s.at=i;(s.visited as number[]).push(i);s.turns++;if(s.turns>=N){s.length=(s.length as number)+d(pts[i],s.depot as P);s.done=true;}return s;},
 score(s){return s.done?Math.max(0,Math.round(3000-2*(s.length as number))):0;},
 describe(s){return s.done?`Tour length ${(s.length as number).toFixed(1)}.`:`${N-s.turns} stops left. Distance so far ${(s.length as number).toFixed(1)}. Choose the next stop index.`;}};
