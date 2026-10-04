import {rng,type Game} from '../engine.ts';
const deltas:Record<string,number>={up:-6,down:6,left:-1,right:1};
export const vault:Game={id:'vault',version:1,name:'Vault Runner',category:'OPTIMIZATION',description:'Collect data shards and reach the exit. Every step costs energy. Choose the best route, not the longest one.',maxTurns:24,
init(seed){const r=rng(seed);const shards:number[]=[];while(shards.length<8){const p=1+Math.floor(r()*34);if(!shards.includes(p))shards.push(p);}return {turns:0,done:false,pos:0,shards,collected:0,escaped:false};},
legalMoves(s){if(s.done)return [];const p=s.pos as number;return Object.keys(deltas).filter(m=>{const n=p+deltas[m];return n>=0&&n<36&&(m==='left'?p%6>0:m==='right'?p%6<5:true);}).concat('extract');},
step(s,m){s.turns++;if(m==='extract'){s.done=true;s.escaped=s.pos===35;return s;}s.pos=(s.pos as number)+deltas[m];const shards=s.shards as number[];if(shards.includes(s.pos as number)){s.collected=(s.collected as number)+1;s.shards=shards.filter(x=>x!==s.pos);}s.escaped=s.pos===35;s.done=!!s.escaped||s.turns>=24;return s;},
score(s){return (s.collected as number)*150+(s.escaped?500+(24-s.turns)*10:0);},describe(s){return s.done?(s.escaped?'Exit reached. Payload secured.':'Run ended without an exit bonus.'):`${24-s.turns} energy. ${s.collected}/8 shards. Reach the bottom-right exit.`;}};
