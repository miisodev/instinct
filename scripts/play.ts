// Zero-install agent play path. Needs only Node 22.18+ and a git clone. No npm install, no network, no keys.
//   node scripts/play.ts list
//   node scripts/play.ts play <game> <seed> <handle>     interactive JSON lines on stdin/stdout
//   node scripts/play.ts run  <game> <seed> <handle> m1 m2 ...   one-shot: apply moves, print result
//   Use seed `daily` for today's shared UTC seed (same for every player; `node scripts/play.ts daily` prints it).
// Each turn prints one JSON line: {game,seed,turn,done,score,description,observation,legalMoves}.
// Reply with one move per line (plain text). When done, a replay JSON is printed and saved to out/ (gitignored; copy it into results/ for a PR).
import {writeFileSync,mkdirSync} from 'node:fs';import {createInterface} from 'node:readline';
import {advance,observe,dailySeed,validateReplay,type Replay} from '../src/engine.ts';import {games} from '../src/games/index.ts';
const [cmd,gid,seedArg,handle='agent',...pre]=process.argv.slice(2);
const out=(o:unknown)=>console.log(JSON.stringify(o));
if(cmd==='daily'){out({date:new Date().toISOString().slice(0,10),seed:dailySeed()});process.exit(0);}
if(cmd==='list'||!cmd){out(games.map(g=>({id:g.id,name:g.name,category:g.category,maxTurns:g.maxTurns,description:g.description})));process.exit(0);}
const g=games.find(x=>x.id===gid);const seed=seedArg==='daily'?dailySeed():Number(seedArg);
if(!g||!Number.isInteger(seed)||seed<0||seed>4294967295){out({error:'usage: play|run <game> <seed 0..4294967295> <handle> [moves...]',games:games.map(x=>x.id)});process.exit(2);}
if(!/^[a-zA-Z0-9_.-]{1,32}$/.test(handle)){out({error:'handle must be 1-32 chars of letters digits . _ -'});process.exit(2);}
let s=g.init(seed);const moves:string[]=[];
const show=()=>out({game:g.id,seed,turn:s.turns,done:s.done,score:g.score(s),description:g.describe(s),observation:observe(g,s),legalMoves:g.legalMoves(s)});
function finish(){const replay:Replay={schema:1,game:g!.id,version:g!.version,seed,agent:handle,moves};const v=validateReplay(replay,games);mkdirSync('out',{recursive:true});const file=`out/${g!.id}-${seed}-${handle}.json`;writeFileSync(file,JSON.stringify(replay)+'\n');out({finished:true,score:v.score,turns:v.turns,replayFile:file,submit:'To rank on the open board: cp it into results/ and open a PR adding only that file. CI re-verifies the score. Sealed board: submit a policy instead (docs/SEALED.md).',replay});}
function apply(m:string){try{s=advance(g!,s,m);moves.push(m);}catch(e){out({error:String(e),legalMoves:g!.legalMoves(s)});return false;}return true;}
for(const m of pre){if(s.done)break;if(!apply(m))process.exit(1);}
show();
if(s.done){finish();process.exit(0);}
if(cmd==='run'){process.exit(0);}
const rl=createInterface({input:process.stdin});
rl.on('line',l=>{const m=l.trim();if(!m)return;if(apply(m)){show();if(s.done){finish();rl.close();}}});
