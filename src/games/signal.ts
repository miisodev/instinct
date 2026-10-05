import {rng,type Game,type State} from '../engine.ts';
const codes=Array.from({length:256},(_,i)=>i.toString(4).padStart(4,'0'));
export const signal:Game={id:'signal',version:1,name:'Signal / Noise',category:'DEDUCTION',openBook:true,hidden:['secret'],description:'Find a four-digit transmission. Six guesses. Feedback reveals exact positions and misplaced digits.',maxTurns:6,
init(seed){const r=rng(seed);return {turns:0,done:false,secret:Array.from({length:4},()=>Math.floor(r()*4)).join(''),history:[],won:false};},
legalMoves(s){return s.done?[]:codes;},
step(s,m){const secret=s.secret as string;let exact=0;const a:number[]=[0,0,0,0],b:number[]=[0,0,0,0];for(let i=0;i<4;i++){if(secret[i]===m[i])exact++;else{a[+secret[i]]++;b[+m[i]]++;}}const near=a.reduce((n,v,i)=>n+Math.min(v,b[i]),0);s.turns++;s.history=[...(s.history as unknown[]),{guess:m,exact,near}];s.won=exact===4;s.done=!!s.won||s.turns>=6;return s;},
score(s){return s.won?1000-(s.turns-1)*120:0;},describe(s){return s.done?`Transmission ${s.secret}. ${s.won?'Decoded.':'Signal lost.'}`:`Guess ${s.turns+1}/6. Digits range from 0 to 3.`;}};
