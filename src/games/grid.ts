import {rng,type Game} from '../engine.ts';
const pairs=[[0,1],[1,2],[3,4],[4,5],[6,7],[7,8],[0,3],[1,4],[2,5],[3,6],[4,7],[5,8]];
export const grid:Game={id:'gridshift',version:1,name:'Gridshift',category:'PLANNING',description:'A 3x3 sliding-tile puzzle with a deterministic scramble. Positions are numbered 0-8 row by row (left to right, top to bottom). A move is the position (as a string) of a tile next to the gap; it slides into the gap. Goal: 1 2 3 / 4 5 6 / 7 8 gap within 80 moves.',maxTurns:80,
init(seed){const r=rng(seed);let tiles=[1,2,3,4,5,6,7,8,0];let prev=-1;for(let n=0;n<28;n++){const z=tiles.indexOf(0);const opts=pairs.filter(p=>p.includes(z)).map(p=>p[0]===z?p[1]:p[0]).filter(i=>i!==prev);const i=opts[Math.floor(r()*opts.length)];[tiles[z],tiles[i]]=[tiles[i],tiles[z]];prev=z;}return {turns:0,done:false,tiles,won:false};},
legalMoves(s){if(s.done)return [];const z=(s.tiles as number[]).indexOf(0);return pairs.filter(p=>p.includes(z)).map(p=>String(p[0]===z?p[1]:p[0]));},
step(s,m){const tiles=s.tiles as number[],i=+m,z=tiles.indexOf(0);[tiles[z],tiles[i]]=[tiles[i],tiles[z]];s.turns++;s.won=tiles.every((x,i)=>x===(i+1)%9);s.done=!!s.won||s.turns>=80;return s;},
score(s){return s.won?2000-s.turns*15:0;},describe(s){return s.done?(s.won?'Order restored.':'Move budget exhausted.'):`${80-s.turns} moves left. Slide a tile next to the gap.`;}};
