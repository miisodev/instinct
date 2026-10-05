import {rng2,type Game} from '../engine.ts';
// Prospector: a 6-armed bandit. Each claim strikes gold with a hidden probability. 40 digs.
// Scored against the best claim's own luck on the same hidden coin flips, so a lucky or unlucky instance does not move the score.
const K=6,DIGS=40;
const bestOf=(p:number[])=>p.indexOf(Math.max(...p));
const bestLuck=(s:any)=>{const b=bestOf(s.p);return (s.coins as number[][]).filter(row=>row[b]<s.p[b]).length;};
export const prospector:Game={id:'prospector',version:1,name:'Prospector',category:'EXPLORATION',openBook:true,hidden:['p','coins'],
 description:'Six claims (0-5) each strike gold with a hidden, fixed probability. You get 40 digs; a dig at a claim strikes gold or comes up empty. Find the richest claim without wasting digs. Score is gold struck compared with what the richest claim alone would have struck on the same luck, out of 1000.',maxTurns:DIGS,
 init(seed){const r=rng2(seed);const top=0.6+r()*0.2;const p=Array.from({length:K},()=>0.05+r()*0.4);const at=Math.floor(r()*K);p[at]=top;
  const coins=Array.from({length:DIGS},()=>Array.from({length:K},()=>r()));return {turns:0,done:false,p,coins,pulls:Array(K).fill(0),gold:Array(K).fill(0),total:0,last:''};},
 legalMoves(s){return s.done?[]:Array.from({length:K},(_,i)=>String(i));},
 step(s,m){const k=Number(m);const hit=(s.coins as number[][])[s.turns][k]<(s.p as number[])[k];(s.pulls as number[])[k]++;if(hit){(s.gold as number[])[k]++;s.total=(s.total as number)+1;}
  s.last=`claim ${k}: ${hit?'gold':'empty'}`;s.turns++;s.done=s.turns>=DIGS;return s;},
 score(s){const b=Math.max(1,bestLuck(s));return Math.min(1000,Math.round(1000*(s.total as number)/b));},
 describe(s){const tally=(s.pulls as number[]).map((n,i)=>`${i}:${(s.gold as number[])[i]}/${n}`).join(' ');
  return s.done?`Gold ${s.total}. The richest claim alone would have struck ${bestLuck(s)} on the same luck.`:`${DIGS-s.turns} digs left. Gold ${s.total}. Struck/dug per claim ${tally}.${s.last?` Last: ${s.last}.`:''}`;}};
