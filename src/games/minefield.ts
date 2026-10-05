import {rng2,type Game} from '../engine.ts';
// Minefield: 8x8 grid, 10 hidden mines. Reveal safe cells using the neighbour counts. A mine ends the run.
const N=8,MINES=10,SAFE=N*N-MINES;
const nb=(i:number)=>{const r=Math.floor(i/N),c=i%N,o:number[]=[];for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){if(!dr&&!dc)continue;const rr=r+dr,cc=c+dc;if(rr>=0&&rr<N&&cc>=0&&cc<N)o.push(rr*N+cc);}return o;};
const count=(mines:number[],i:number)=>nb(i).filter(x=>mines.includes(x)).length;
function open(s:any,start:number){const q=[start];const seen=new Set<number>();while(q.length){const i=q.pop()!;if(seen.has(i)||s.mines.includes(i))continue;seen.add(i);s.cells[i]=count(s.mines,i);if(s.cells[i]===0)for(const j of nb(i))q.push(j);}}
const rows=(cells:number[],mines:number[],showMines:boolean)=>Array.from({length:N},(_,r)=>cells.slice(r*N,r*N+N).map((v,c)=>showMines&&mines.includes(r*N+c)?'*':v<0?'#':v===0?'.':String(v)).join(''));
export const minefield:Game={id:'minefield',version:1,name:'Minefield',category:'INFERENCE',openBook:true,hidden:['mines'],
 description:'8x8 grid with 10 hidden mines. Reveal a cell with "row,col" (0-7, row 0 is the top). A revealed cell shows how many of its 8 neighbours are mines ("." means 0, "#" is unrevealed); zeros open their neighbours. A free opening is already revealed. Reveal a mine and the run ends. 10 points per safe cell, plus a bonus for clearing every safe cell quickly.',maxTurns:54,
 init(seed){const r=rng2(seed);const mines:number[]=[];while(mines.length<MINES){const p=Math.floor(r()*64);if(!mines.includes(p))mines.push(p);}
  const s:any={turns:0,done:false,mines,cells:Array(64).fill(-1),hit:false,board:[] as string[]};
  const zeros=[...Array(64).keys()].filter(i=>!mines.includes(i)&&count(mines,i)===0);const start=zeros[Math.floor(r()*zeros.length)];open(s,start);s.board=rows(s.cells,mines,false);return s;},
 legalMoves(s){if(s.done)return [];const c=s.cells as number[];const o:string[]=[];for(let i=0;i<64;i++)if(c[i]<0)o.push(`${Math.floor(i/N)},${i%N}`);return o;},
 step(s,m){const [r,c]=m.split(',').map(Number);const i=r*N+c;s.turns++;const mines=s.mines as number[];
  if(mines.includes(i)){s.hit=true;s.done=true;}else{open(s,i);if((s.cells as number[]).filter(v=>v>=0).length===SAFE)s.done=true;}
  s.board=rows(s.cells as number[],mines,!!s.done);return s;},
 score(s){const safe=(s.cells as number[]).filter(v=>v>=0).length;return safe*10+(!s.hit&&safe===SAFE?200+(54-(s.turns as number))*5:0);},
 describe(s){const safe=(s.cells as number[]).filter(v=>v>=0).length;return s.done?(s.hit?`Mine hit after ${safe} safe cells.`:'Field cleared.'):`${safe}/${SAFE} safe cells revealed. Reveal "row,col".`;}};
