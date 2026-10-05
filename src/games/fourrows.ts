import {rng2 as rng,type Game} from '../engine.ts';
// Four Rows: Connect Four (7 columns x 6 rows) against a depth-limited minimax opponent. Perfect information, no secrets:
// reading the source gives you the opponent's algorithm, not a shortcut. Seed picks the opponent depth (2-4) and two random opening plies.
const W=7,H=6;const idx=(r:number,c:number)=>r*W+c; // r=0 is the top row
function drop(b:number[],c:number){for(let r=H-1;r>=0;r--)if(!b[idx(r,c)])return r;return -1;}
function win(b:number[],p:number){for(let r=0;r<H;r++)for(let c=0;c<W;c++)for(const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]]){let n=0;for(let k=0;k<4;k++){const rr=r+dr*k,cc=c+dc*k;if(rr<0||rr>=H||cc<0||cc>=W||b[idx(rr,cc)]!==p)break;n++;}if(n===4)return true;}return false;}
function evalB(b:number[],p:number){let s=0;const q=3-p;for(let r=0;r<H;r++)for(let c=0;c<W;c++)for(const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]]){let a=0,o=0;for(let k=0;k<4;k++){const rr=r+dr*k,cc=c+dc*k;if(rr<0||rr>=H||cc<0||cc>=W){a=o=-9;break;}const v=b[idx(rr,cc)];if(v===p)a++;else if(v===q)o++;}if(a>=0&&o>=0){if(o===0)s+=[0,1,4,20][a]??0;if(a===0)s-=[0,1,4,20][o]??0;}}for(let r=0;r<H;r++)if(b[idx(r,3)]===p)s+=3;return s;}
const order=[3,2,4,1,5,0,6];
function search(b:number[],p:number,me:number,d:number,al:number,be:number):number{if(win(b,me))return 1000+d;if(win(b,3-me))return -1000-d;const moves=order.filter(c=>drop(b,c)>=0);if(!moves.length)return 0;if(!d)return evalB(b,me);
 let best=p===me?-1e9:1e9;for(const c of moves){const r=drop(b,c);b[idx(r,c)]=p;const v=search(b,3-p,me,d-1,al,be);b[idx(r,c)]=0;if(p===me){best=Math.max(best,v);al=Math.max(al,v);}else{best=Math.min(best,v);be=Math.min(be,v);}if(al>=be)break;}return best;}
function oppPlay(b:number[],depth:number){let bc=-1,bv=-1e9;for(const c of order){const r=drop(b,c);if(r<0)continue;b[idx(r,c)]=2;const v=search(b,1,2,depth-1,-1e9,1e9);b[idx(r,c)]=0;if(v>bv){bv=v;bc=c;}}return bc;}
export const fourrows:Game={id:'fourrows',version:1,name:'Four Rows',category:'PERFECT INFORMATION',openBook:false,
 description:'Connect four in a row (7x6) against a minimax machine of seed-chosen depth. Drop a disc with a column 0-6. Win fast for more points; losing still pays a little for each move you survive.',maxTurns:21,
 init(seed){const r=rng(seed);const depth=2+Math.floor(r()*3);const b=Array(W*H).fill(0);for(const p of [1,2]){for(;;){const c=Math.floor(r()*W);const row=drop(b,c);if(row>=0){b[idx(row,c)]=p;break;}}}return {turns:0,done:false,board:b,depth,result:'',moves:0};},
 legalMoves(s){if(s.done)return [];const b=s.board as number[];return [0,1,2,3,4,5,6].filter(c=>drop(b,c)>=0).map(String);},
 step(s,m){const b=s.board as number[];const c=+m;b[idx(drop(b,c),c)]=1;s.turns++;
  if(win(b,1)){s.result='win';s.done=true;return s;}if(b.every(x=>x)){s.result='draw';s.done=true;return s;}
  const oc=oppPlay(b,s.depth as number);b[idx(drop(b,oc),oc)]=2;
  if(win(b,2)){s.result='loss';s.done=true;}else if(b.every(x=>x)){s.result='draw';s.done=true;}else if(s.turns>=21){s.result='draw';s.done=true;}return s;},
 score(s){return s.result==='win'?1000-(s.turns as number)*15:s.result==='draw'?300:s.result==='loss'?(s.turns as number)*5:0;},
 describe(s){return s.done?`Game over: ${s.result}.`:`You are 1, the machine is 2. Board is 7 columns by 6 rows, row 0 on top. Pick a column.`;}};
