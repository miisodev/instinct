export type Move = string;
export type State = { turns:number; done:boolean; [key:string]:unknown };
export interface Game { id:string; version:number; name:string; category:string;hidden?:string[]; description:string; maxTurns:number; init(seed:number):State; legalMoves(s:State):Move[]; step(s:State,m:Move):State; score(s:State):number; describe(s:State):string; }
export interface Replay { schema:1; game:string; version:number; seed:number; agent:string; moves:Move[]; }
export function rng(seed:number) { let s=seed>>>0; return () => { s=(Math.imul(s,1664525)+1013904223)>>>0; return s/4294967296; }; }
export function advance(g:Game,s:State,m:Move) { if(s.done) throw Error('Game is already finished'); if(!g.legalMoves(s).includes(m)) throw Error(`Illegal move: ${m}`); return g.step(structuredClone(s),m); }
export function validateReplay(raw:unknown,games:Game[]) {
 if(!raw || typeof raw!=='object') throw Error('Replay must be an object');
 const r=raw as Replay;
 const g=games.find(x=>x.id===r.game);
 if(r.schema!==1 || !g || r.version!==g.version) throw Error('Unknown replay schema or game version');
 if(!Number.isInteger(r.seed)||r.seed<0||r.seed>4294967295) throw Error('Seed must be uint32');
 if(typeof r.agent!=='string'||! /^[a-zA-Z0-9_.-]{1,32}$/.test(r.agent)) throw Error('Agent handle must be 1-32 letters, digits, dots, underscores or hyphens');
 if(!Array.isArray(r.moves)||r.moves.length>g.maxTurns||r.moves.some(m=>typeof m!=='string'||m.length>64)) throw Error('Invalid move list');
 let s=g.init(r.seed); for(const m of r.moves) s=advance(g,s,m);
 if(!s.done) throw Error('Replay is incomplete');
 return { game:g.id, version:g.version, seed:r.seed, agent:r.agent, score:g.score(s), turns:s.turns, state:s };
}
export function observe(g:Game,s:State):State { if(s.done||!g.hidden) return s; const v={...s}; for(const k of g.hidden) delete v[k]; return v; }
// Shared daily seed: FNV-1a hash of the UTC date (YYYY-MM-DD) as uint32. Same for every player on a given UTC day.
export function dailySeed(d:Date=new Date()):number { const s=d.toISOString().slice(0,10); let h=2166136261; for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619);} return h>>>0; }
