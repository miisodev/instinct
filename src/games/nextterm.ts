import {rng2,type Game} from '../engine.ts';
// Next Term: induce a hidden integer rule from its first four terms, then predict ten more. Each true term is revealed after every guess.
const SHOWN=4,GUESSES=10,LEN=SHOWN+GUESSES;
const dsum=(n:number)=>String(n).split('').reduce((a,c)=>a+Number(c),0);
type Gen=(r:()=>number)=>[string,number[]];
const pick=(r:()=>number,a:number,b:number)=>a+Math.floor(r()*(b-a+1));
const families:Gen[]=[
 r=>{const a=pick(r,0,60),d=pick(r,3,45);return ['arithmetic',Array.from({length:LEN},(_,n)=>a+d*n)];},
 r=>{const a=pick(r,0,30),b=pick(r,-4,6),c=pick(r,1,4);return ['quadratic',Array.from({length:LEN},(_,n)=>a+b*n+c*n*n)];},
 r=>{const x=[pick(r,1,9),pick(r,1,9)];while(x.length<LEN)x.push(x[x.length-1]+x[x.length-2]);return ['additive (each term is the sum of the two before it)',x];},
 r=>{const a=pick(r,0,50),d=pick(r,2,20),b=pick(r,100,300),e=pick(r,-12,12);return ['two interleaved arithmetic sequences',Array.from({length:LEN},(_,n)=>n%2?b+e*((n-1)/2):a+d*(n/2))];},
 r=>{const per=pick(r,2,3),ds=Array.from({length:per},()=>pick(r,-15,40));const x=[pick(r,20,120)];while(x.length<LEN)x.push(x[x.length-1]+ds[(x.length-1)%per]);return [`repeating differences (${ds.join(', ')})`,x];},
 r=>{const x=[pick(r,1,99)];while(x.length<LEN)x.push(x[x.length-1]+dsum(x[x.length-1]));return ['add the digit sum of the previous term',x];},
 r=>{const k=pick(r,1,4);const x=[pick(r,1,15)];while(x.length<LEN)x.push((x[x.length-1]*2+k)%1000);return [`double and add ${k}, modulo 1000`,x];},
 r=>{const x=[pick(r,0,3),pick(r,0,3),pick(r,1,4)];while(x.length<LEN)x.push((x[x.length-1]+x[x.length-2]+x[x.length-3])%1000);return ['each term is the sum of the three before it, modulo 1000',x];},
 r=>{const a=pick(r,0,40),b=pick(r,0,5),c=pick(r,0,2);return ['cubic: a + b·n + c·n² + n³/3 rounded down',Array.from({length:LEN},(_,n)=>a+b*n+c*n*n+Math.floor(n*n*n/3))];},
 r=>{const off=pick(r,0,40),k=pick(r,0,8);return [`the primes from the ${k+1}th, plus ${off}`,PRIMES.slice(k,k+LEN).map(p=>p+off)];},
 r=>{const k=pick(r,1,9);const x=[pick(r,5,60)];while(x.length<LEN)x.push(((x[x.length-1]*3-k)%1000+1000)%1000);return [`triple and subtract ${k}, modulo 1000`,x];},
];
const PRIMES=Array.from({length:120},(_,i)=>i+2).filter(n=>{for(let d=2;d*d<=n;d++)if(n%d===0)return false;return true;});
const valid=(x:number[])=>x.every(v=>Number.isInteger(v)&&v>=0&&v<=999);
export const nextterm:Game={id:'nextterm',version:1,name:'Next Term',category:'INDUCTION',openBook:true,hidden:['seq','rule'],
 description:'A hidden rule makes a sequence of whole numbers between 0 and 999. You see the first four terms. Predict the next term; the true term is then revealed and you predict again, ten times in all. 100 points per exact prediction.',maxTurns:GUESSES,
 init(seed){const r=rng2(seed);let rule='',seq:number[]=[];for(let t=0;t<200;t++){[rule,seq]=families[Math.floor(r()*families.length)](r);if(valid(seq))break;}
  if(!valid(seq)){rule='arithmetic';seq=Array.from({length:LEN},(_,n)=>5+7*n);}
  return {turns:0,done:false,seq,rule,terms:seq.slice(0,SHOWN),hits:0,log:[] as string[]};},
 legalMoves(s){return s.done?[]:Array.from({length:1000},(_,i)=>String(i));},
 step(s,m){const seq=s.seq as number[];const truth=seq[SHOWN+s.turns];const ok=Number(m)===truth;if(ok)s.hits=(s.hits as number)+1;
  (s.log as string[]).push(`${m}${ok?' ✓':` ✗ (${truth})`}`);(s.terms as number[]).push(truth);s.turns++;s.done=s.turns>=GUESSES;return s;},
 score(s){return (s.hits as number)*100;},
 describe(s){return s.done?`The rule was: ${s.rule}. ${s.hits}/${GUESSES} exact.`:`Prediction ${s.turns+1}/${GUESSES}. Terms so far: ${(s.terms as number[]).join(', ')}. Name the next term (0-999).`;}};
