import {rng2,type Game} from '../engine.ts';
// Lights Out: 5x5. Pressing a cell toggles it and its orthogonal neighbours. Turn every light off within 15 presses.
const N=5,BUDGET=15;
const press=(b:number[],i:number)=>{const r=Math.floor(i/N),c=i%N;for(const [dr,dc] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){const rr=r+dr,cc=c+dc;if(rr>=0&&rr<N&&cc>=0&&cc<N)b[rr*N+cc]^=1;}};
const rows=(b:number[])=>Array.from({length:N},(_,r)=>b.slice(r*N,r*N+N).map(v=>v?'#':'.').join(''));
export const lights:Game={id:'lights',version:1,name:'Lights Out',category:'PLANNING',openBook:true,
 description:'5x5 grid of lights ("#" on, "." off). Pressing cell k (0-24, row by row from the top left) toggles that cell and its up, down, left and right neighbours. Turn every light off within 15 presses. The scramble is always solvable in at most 11 presses. Solved: 1000 plus 40 per unused press. Unsolved: 20 per light that is off.',maxTurns:BUDGET,
 init(seed){const r=rng2(seed);const b=Array(25).fill(0);const k=8+Math.floor(r()*4);const picked:number[]=[];while(picked.length<k){const p=Math.floor(r()*25);if(!picked.includes(p)){picked.push(p);press(b,p);}}
  if(b.every(v=>v===0))press(b,0);return {turns:0,done:false,lights:b,board:rows(b)};},
 legalMoves(s){return s.done?[]:Array.from({length:25},(_,i)=>String(i));},
 step(s,m){const b=s.lights as number[];press(b,Number(m));s.turns++;s.board=rows(b);s.done=b.every(v=>v===0)||s.turns>=BUDGET;return s;},
 score(s){const b=s.lights as number[];const on=b.filter(Boolean).length;return on===0?1000+(BUDGET-(s.turns as number))*40:(25-on)*20;},
 describe(s){const on=(s.lights as number[]).filter(Boolean).length;return s.done?(on===0?'All lights off.':'Out of presses.'):`${BUDGET-(s.turns as number)} presses left, ${on} lights on. Press 0-24.`;}};
