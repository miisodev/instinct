import {rng,type Game} from '../engine.ts';
// Handshake: 20-round repeated trust game against a hidden, seed-chosen opponent.
// v2: scored against the best total any player could have reached against that same opponent on the same hidden coin flips,
// cubed so that only near-best play scores high. Drawing a stingy opponent no longer caps the score, and a fixed strategy
// (always C, always D) is punished by some opponent in the pool: reading who you face is the skill.
const kinds=['mirror','grudge','hawk','dove','pavlov','noisy','tester'] as const;
const pay:Record<string,number>={CC:3,CD:0,DC:5,DD:1};
const ROUNDS=20,NOISE=0.15;
type Round={me:string;them:string};
// noisy: a mirror that flips its answer 15% of the time. tester: defects first; if you hit back in the first two rounds it plays mirror, otherwise it alternates.
function reply(kind:string,h:Round[],coin:number){const last=h[h.length-1],t=h.length;
 switch(kind){case 'mirror':return last?last.me:'C';case 'grudge':return h.some(x=>x.me==='D')?'D':'C';case 'hawk':return 'D';case 'dove':return 'C';
 case 'pavlov':return last?(last.me===last.them?'C':'D'):'C';
 case 'noisy':{const m=last?last.me:'C';return coin<NOISE?(m==='C'?'D':'C'):m;}
 default:if(t===0)return 'D';if(h.slice(0,2).some(x=>x.me==='D'))return last.me;return t%2?'C':'D';}}
// Exact best total for this instance: every kind's reply depends only on (round, last pair, any defection, defected in rounds 1-2, coin).
// noisy is judged against its noise-free mirror: its flips cannot be foreseen, so hindsight would set an unreachable bar.
function best(s:any):number{const memo=new Map<string,number>();const coins=s.coins as number[];
 const go=(h:Round[]):number=>{const t=h.length;if(t===ROUNDS)return 0;const l=h[t-1];
  const key=`${t}|${l?.me??''}${l?.them??''}|${h.some(x=>x.me==='D')}|${h.slice(0,2).some(x=>x.me==='D')}`;const hit=memo.get(key);if(hit!==undefined)return hit;
  const them=reply(s.opp,h,s.opp==='noisy'?1:coins[t]);let b=-1;for(const m of ['C','D'])b=Math.max(b,pay[m+them]+go([...h,{me:m,them}]));memo.set(key,b);return b;};
 return Math.max(1,go([]));}
export const handshake:Game={id:'handshake',version:2,name:'Handshake',category:'OPPONENT MODELING',openBook:true,hidden:['opp','coins'],
 description:'Twenty rounds of cooperate (C) or defect (D) against a hidden opponent with a fixed strategy. Payoffs per round: both C 3/3, you D and they C 5/0, both D 1/1. Learn who you face from the history, then exploit or cooperate. Score = 1000 × (your total ÷ best total possible against that opponent)³, so only near-best play scores high.',maxTurns:ROUNDS,
 init(seed){const r=rng(seed);r();r();r();const opp=kinds[Math.floor(r()*kinds.length)];return {turns:0,done:false,opp,coins:Array.from({length:ROUNDS},()=>r()),history:[] as Round[],total:0};},
 legalMoves(s){return s.done?[]:['C','D'];},
 step(s,m){const h=s.history as Round[];const them=reply(s.opp as string,h,(s.coins as number[])[s.turns]);h.push({me:m,them});s.total=(s.total as number)+pay[m+them];s.turns++;s.done=s.turns>=ROUNDS;return s;},
 score(s){return Math.round(1000*Math.min(1,(s.total as number)/best(s))**3);},
 describe(s){return s.done?`Opponent was ${s.opp}. Final ${s.total} points of a possible ${best(s)}.`:`Round ${s.turns+1}/${ROUNDS}. Payoffs: CC 3/3, DC 5/0, DD 1/1. Your total ${s.total}.`;}};
