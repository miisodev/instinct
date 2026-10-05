import {rng,type Game} from '../engine.ts';
// Heaps: take-from-heaps (Nim, normal play) against a seed-driven opponent that sometimes blunders.
// Move "h:n" removes n (>=1) from heap h. Whoever takes the last stone wins. The start is never lost for the first player.
const xor=(a:number[])=>a.reduce((x,y)=>x^y,0);
function oppMove(h:number[],coin:number){const moves:[number,number][]=[];h.forEach((v,i)=>{for(let n=1;n<=v;n++)moves.push([i,n]);});
 const good=moves.find(([i,n])=>{const t=[...h];t[i]-=n;return xor(t)===0;});
 if(good&&coin>=0.2)return good; return moves[Math.floor((coin*997)%moves.length)];}
export const heaps:Game={id:'heaps',version:1,name:'Heaps',category:'ADVERSARIAL',openBook:true,hidden:['coins'],
 description:'Five heaps of stones. You and a machine take turns removing one or more stones from a single heap, written "heap:count". Taking the last stone wins. The machine plays well, but not perfectly.',maxTurns:40,
 init(seed){const r=rng(seed);r();r();r();const h=Array.from({length:5},()=>1+Math.floor(r()*12));if(xor(h)===0)h[0]++;return {turns:0,done:false,heaps:h,coins:Array.from({length:40},()=>r()),won:false,log:[] as string[]};},
 legalMoves(s){if(s.done)return [];const out:string[]=[];(s.heaps as number[]).forEach((v,i)=>{for(let n=1;n<=v;n++)out.push(`${i}:${n}`);});return out;},
 step(s,m){const h=s.heaps as number[];const [i,n]=m.split(':').map(Number);h[i]-=n;s.turns++;(s.log as string[]).push(`you ${m}`);
  if(h.every(x=>x===0)){s.won=true;s.done=true;return s;}
  const [oi,on]=oppMove(h,(s.coins as number[])[s.turns]);h[oi]-=on;(s.log as string[]).push(`machine ${oi}:${on}`);
  if(h.every(x=>x===0)){s.done=true;s.won=false;}else s.done=s.turns>=40;return s;},
 score(s){return s.won?1000-(s.turns as number)*20:0;},
 describe(s){return s.done?(s.won?'You took the last stone.':'The machine took the last stone.'):`Heaps ${(s.heaps as number[]).join(' / ')}. Take the last stone to win; fewer turns score more.`;}};
