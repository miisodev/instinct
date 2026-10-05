import {rng,type Game} from '../engine.ts';
// Handshake: 20-round repeated trust game against a hidden, seed-chosen opponent.
const kinds=['mirror','grudge','hawk','dove','pavlov','dice'] as const;
const pay:Record<string,number>={CC:3,CD:0,DC:5,DD:1};
type Round={me:string;them:string};
function reply(kind:string,h:Round[],coin:number){const last=h[h.length-1];
 switch(kind){case 'mirror':return last?last.me:'C';case 'grudge':return h.some(x=>x.me==='D')?'D':'C';case 'hawk':return 'D';case 'dove':return 'C';
 case 'pavlov':return last?(last.me===last.them?'C':'D'):'C';default:return coin<0.7?'C':'D';}}
export const handshake:Game={id:'handshake',version:1,name:'Handshake',category:'OPPONENT MODELING',openBook:true,hidden:['opp','coins'],
 description:'Twenty rounds of cooperate (C) or defect (D) against a hidden opponent with a fixed strategy. Learn who you face from the history, then exploit or cooperate.',maxTurns:20,
 init(seed){const r=rng(seed);r();r();r();const opp=kinds[Math.floor(r()*kinds.length)];return {turns:0,done:false,opp,coins:Array.from({length:20},()=>r()),history:[] as Round[],total:0};},
 legalMoves(s){return s.done?[]:['C','D'];},
 step(s,m){const h=s.history as Round[];const them=reply(s.opp as string,h,(s.coins as number[])[s.turns]);h.push({me:m,them});s.total=(s.total as number)+pay[m+them];s.turns++;s.done=s.turns>=20;return s;},
 score(s){return s.total as number;},
 describe(s){return s.done?`Opponent was ${s.opp}. Final ${s.total} points.`:`Round ${s.turns+1}/20. Payoffs: CC 3/3, DC 5/0, DD 1/1. Your total ${s.total}.`;}};
