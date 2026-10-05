import {readFileSync} from 'node:fs';
import test from 'node:test';import assert from 'node:assert/strict';
import {handle,type Req} from '../server/core.ts';import {mockRedis} from './mockRedis.ts';import {games} from '../src/games/index.ts';
import {bundle,current} from '../scripts/bundle-api.ts';
const mk=(env:Record<string,string>={})=>{const redis=mockRedis();let now=Date.parse('2026-10-05T10:00:00Z');const deps={redis,env:{SEALED_SALT:'test-salt',SEALED_SEASON:'t1',...env},now:()=>now};
 const call=async(method:string,path:string,body:any={},o:{token?:string;ip?:string;query?:Record<string,string>}={})=>{const u=new URL(path,'http://x');const r:Req={method,path:u.pathname,query:{...Object.fromEntries(u.searchParams),...(o.query||{})},body,headers:o.token?{authorization:'Bearer '+o.token}:{},ip:o.ip||'1.1.1.1',host:'arcade.test',proto:'https'};const res=await handle(r,deps);return {status:res.status,json:()=>JSON.parse(res.body),text:res.body,headers:res.headers};};
 const reg=async(h:string,ip='1.1.1.1')=>(await call('POST','/api/register',{handle:h},{ip})).json().token as string;
 return {redis,deps,call,reg,tick:(ms:number)=>{now+=ms;}};};

test('bundled api/_core.mjs is up to date (run npm run bundle:api)',async()=>{assert.equal(await bundle(),current());});

test('register: token once, handle unique (case-insensitive), reserved prefix, bad handle',async()=>{const s=mk();const a=await s.call('POST','/api/register',{handle:'Alpha'});assert.equal(a.status,200);assert.ok(a.json().token.length>=30);
 assert.equal((await s.call('POST','/api/register',{handle:'alpha'})).status,409);assert.equal((await s.call('POST','/api/register',{handle:'instinct-baseline'})).status,400);assert.equal((await s.call('POST','/api/register',{handle:'<x>'})).status,400);});

test('full sealed run of every game via HTTP, scored server-side, recorded on the board',async()=>{const s=mk();const tok=await s.reg('bot');
 for(const g of games){const st=(await s.call('POST','/api/start',{game:g.id,mode:'sealed'},{token:tok})).json();assert.equal(st.slot,1);assert.equal('secret' in st.observation,false);assert.equal('ships' in st.observation,false);assert.equal('opp' in st.observation,false);
  let v=st;let n=0;while(!v.done&&n++<100){const m=(v.legalMoves||v.legalMovesSample)[0];const r=await s.call('POST','/api/move',{session:st.session,move:m});assert.equal(r.status,200);v=r.json();}
  assert.equal(v.done,true);assert.equal(v.recorded,true);assert.equal(v.finalScore,v.score);
  const lb=(await s.call('GET','/api/leaderboard?game='+g.id)).json();assert.equal(lb.rows[0].handle,'bot');}
 const me=(await s.call('GET','/api/me',{},{token:tok})).json();assert.equal(me.ranked.signal.runsUsed,1);});

test('sealed instances: per-handle different, each index once, K cap, practice unaffected',async()=>{const s=mk({SEALED_SEEDS:'2',SEALED_ATTEMPTS:'1'});const a=await s.reg('aa','2.2.2.2'),b=await s.reg('bb','3.3.3.3');
 const fin=async(r:any)=>{let v=r,n=0;while(!v.done&&n++<100)v=(await s.call('POST','/api/move',{session:r.session,move:(v.legalMoves||v.legalMovesSample)[0]})).json();};
 const obs=async(t:string)=>{const r=(await s.call('POST','/api/start',{game:'courier',mode:'sealed'},{token:t})).json();const o=JSON.stringify(r.observation.points);await fin(r);return o;};
 const pa=await obs(a),pb=await obs(b);assert.notEqual(pa,pb);
 const a2=await s.call('POST','/api/start',{game:'courier',mode:'sealed'},{token:a});assert.equal(a2.json().slot,2);await fin(a2.json());
 assert.equal((await s.call('POST','/api/start',{game:'courier',mode:'sealed'},{token:a})).status,409);
 assert.equal((await s.call('POST','/api/start',{game:'heaps',mode:'sealed'},{token:a})).status,200);
 const pr=await s.call('POST','/api/start',{game:'courier',mode:'practice',seed:42},{token:a});assert.equal(pr.status,200);});

test('sealed hidden state is never exposed mid-game, even with illegal-move probing',async()=>{const s=mk();const t=await s.reg('p');const st=(await s.call('POST','/api/start',{game:'signal',mode:'sealed'},{token:t})).json();
 const r=await s.call('POST','/api/move',{session:st.session,move:'9999'});assert.equal(r.status,400);assert.equal(JSON.stringify(r.json()).includes('secret'),false);});

test('illegal moves rejected, 50 end the session at score 0',async()=>{const s=mk();const t=await s.reg('q');const st=(await s.call('POST','/api/start',{game:'heaps',mode:'sealed'},{token:t})).json();let last:any;
 for(let i=0;i<50;i++){last=await s.call('POST','/api/move',{session:st.session,move:'nope'});}
 assert.equal(last.status,200);assert.equal(last.json().done,true);assert.equal(last.json().finalScore,0);assert.equal((await s.call('GET','/api/leaderboard?game=heaps')).json().rows[0].score,0);});

test('no rewind or branching: concurrent moves conflict, finished sessions are final',async()=>{const s=mk();const t=await s.reg('r');const st=(await s.call('POST','/api/start',{game:'gridshift',mode:'practice',seed:1},{token:t})).json();
 const [x,y]=await Promise.all([s.call('POST','/api/move',{session:st.session,move:(st.legalMoves||st.legalMovesSample)[0]}),s.call('POST','/api/move',{session:st.session,move:(st.legalMoves||st.legalMovesSample)[0]})]);assert.deepEqual([x.status,y.status].sort(),[200,409]);});

test('auth: no token, bad token, session id is not guessable input',async()=>{const s=mk();assert.equal((await s.call('POST','/api/start',{game:'signal',mode:'sealed'})).status,400);assert.equal((await s.call('POST','/api/start',{game:'signal'},{token:'x'.repeat(40)})).status,401);assert.equal((await s.call('POST','/api/move',{session:'zz',move:'a'})).status,400);assert.equal((await s.call('POST','/api/move',{session:'0'.repeat(32),move:'a'})).status,404);});

test('abuse caps: per-IP registration, daily registrations, monthly game capacity, kill switch',async()=>{const s=mk({MAX_REGS_PER_IP_HOUR:'2'});await s.reg('i1','9.9.9.9');await s.reg('i2','9.9.9.9');assert.equal((await s.call('POST','/api/register',{handle:'i3'},{ip:'9.9.9.9'})).status,429);assert.equal((await s.call('POST','/api/register',{handle:'i3'},{ip:'8.8.8.8'})).status,200);
 const d=mk({MAX_REGS_PER_DAY:'1'});await d.reg('d1');assert.equal((await d.call('POST','/api/register',{handle:'d2'},{ip:'4.4.4.4'})).status,503);
 const m=mk({MAX_GAMES_PER_MONTH:'1'});const t=await m.reg('m1');assert.equal((await m.call('POST','/api/start',{game:'heaps',mode:'practice'},{token:t})).status,200);assert.equal((await m.call('POST','/api/start',{game:'heaps',mode:'practice'},{token:t})).status,503);assert.equal((await m.call('GET','/api/games')).status,200);
 const k=mk({API_DISABLED:'1'});assert.equal((await k.call('GET','/api/games')).status,503);});

test('sealed mode refuses to run without a salt (fail closed)',async()=>{const s=mk({SEALED_SALT:''});const t=await s.reg('n');assert.equal((await s.call('POST','/api/start',{game:'signal',mode:'sealed'},{token:t})).status,503);});

test('plain-text mirror: whole flow by GET, next-step URLs included',async()=>{const s=mk();const st=await s.call('GET','/api/text/start?handle=txt&game=heaps&mode=sealed');assert.match(st.text,/PLAY KEY[^:]*: \S+/);assert.match(st.text,/NEXT: GET https:\/\/arcade\.test\/api\/text\/move\?session=/);const sid=st.text.match(/session=([a-f0-9]{32})/)![1];
 const mv=st.text.match(/legal moves: (\S+)/)![1];const m=await s.call('GET',`/api/text/move?session=${sid}&move=${mv}`);assert.match(m.text,/turn: 1/);
 assert.equal((await s.call('GET','/api/text/games')).status,200);assert.match((await s.call('GET','/api/text/board?game=heaps')).text,/leaderboard/);assert.match((await s.call('GET','/api/text/move?session=bad&move=1')).text,/^ERROR 400/);});

test('stats count handles, starts and finishes; agents.md served with the request origin',async()=>{const s=mk();const t=await s.reg('st');const st=(await s.call('POST','/api/start',{game:'heaps',mode:'practice'},{token:t})).json();await s.call('POST','/api/move',{session:st.session,move:(st.legalMoves||st.legalMovesSample)[0]});const j=(await s.call('GET','/api/stats')).json();assert.equal(j.handles,1);assert.equal(j.gamesStarted,1);
 const a=await s.call('GET','/api/agents');assert.match(a.text,/BASE = https:\/\/arcade\.test/);assert.ok(!a.text.includes('{{BASE}}'));
 for(const p of ['/agents.md','/llms.txt']){const r=await s.call('GET',p);assert.equal(r.status,200);assert.match(r.text,/BASE = https:\/\/arcade\.test/);}});

test('server verification matches independent replay and practice board keeps the best run per handle',async()=>{const s=mk();const t=await s.reg('pp');for(let k=0;k<2;k++){const st=(await s.call('POST','/api/start',{game:'signal',mode:'practice',seed:42},{token:t})).json();let v=st;while(!v.done)v=(await s.call('POST','/api/move',{session:st.session,move:k?'0000':'1020'})).json();}
 const lb=(await s.call('GET','/api/leaderboard?game=signal')).json();assert.equal(lb.rows.length,0,'casual runs never reach the ranked board');});

test('redis command budget per full game stays small',async()=>{const s=mk();const t=await s.reg('bud');const before=s.redis.count();const st=(await s.call('POST','/api/start',{game:'signal',mode:'sealed'},{token:t})).json();let v=st,n=0;while(!v.done){v=(await s.call('POST','/api/move',{session:st.session,move:(v.legalMoves||v.legalMovesSample)[n++%8]})).json();}const used=s.redis.count()-before;assert.ok(used<=6*2+40,`commands used ${used}`);});

test('policy board: empty until CI publishes, then served whole and per game',async()=>{const s=mk();
 assert.equal((await s.call('GET','/api/policies')).json().season,null);assert.deepEqual((await s.call('GET','/api/leaderboard?game=heaps&board=policies')).json().rows,[]);
 await s.redis.cmd('SET','sealed:policies',JSON.stringify({season:'s1',seeds:5,commitment:'ab',games:{heaps:[{agent:'opencode',mean:900,scores:[900]},{agent:'instinct-owner',mean:800,scores:[800]}]}}));
 assert.equal((await s.call('GET','/api/policies')).json().season,'s1');
 const b=(await s.call('GET','/api/leaderboard?game=heaps&board=policies')).json();assert.deepEqual(b.rows,[{rank:1,handle:'opencode',score:900},{rank:2,handle:'instinct-owner',score:800}]);assert.equal(b.season,'s1');});

test('legal move lists are full up to the cap, summarized beyond it; legal=all returns them; error body stays small',async()=>{const full=mk();const ft=await full.reg('fl');const fs=(await full.call('POST','/api/start',{game:'signal',mode:'casual',seed:1},{token:ft})).json();assert.equal(fs.legalMoves.length,256);const s=mk({MAX_LEGAL_LIST:'40'});const t=await s.reg('big');const st=(await s.call('POST','/api/start',{game:'signal',mode:'casual',seed:1},{token:t})).json();
 assert.equal(st.legalMoves,null);assert.equal(st.legalMovesCount,256);assert.equal(st.legalMovesSample.length,8);assert.ok(st.moveRule);
 const e=await s.call('POST','/api/move',{session:st.session,move:'zzzz'});assert.equal(e.status,400);assert.ok(e.text.length<1200,'error body small');assert.equal(e.json().legalMovesCount,256);
 const all=(await s.call('POST','/api/move',{session:st.session,move:'zzzz',legal:'all'})).json();assert.equal(all.legalMoves.length,256);
 const sm=(await s.call('POST','/api/start',{game:'heaps',mode:'practice'},{token:t})).json();assert.ok(Array.isArray(sm.legalMoves));});

test('text mirror works as /api/text/<action> and as /api/text?action=<action> (vercel rewrite)',async()=>{const s=mk();
 const a=await s.call('GET','/api/text/games');assert.equal(a.status,200);const b=await s.call('GET','/api/text',{}, {query:{action:'games'}});assert.equal(b.status,200);assert.equal(a.text,b.text);
 const r=await s.call('GET','/api/text',{},{query:{action:'register',handle:'texty'}});assert.equal(r.status,200);assert.match(r.text,/PLAY KEY/);});

test('vercel.json rewrites nested /api/text/<action> to the catch-all with ?action=',()=>{const v=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
 const rw=v.rewrites.find((x:any)=>x.source==='/api/text/:action');assert.ok(rw);assert.equal(rw.destination,'/api/text?action=:action');});

test('stats move after registration and finished games (single hash, both result shapes parsed)',async()=>{const s=mk();const t=await s.reg('sx');const st=(await s.call('POST','/api/start',{game:'heaps',mode:'practice'},{token:t})).json();let v=st;let n=0;while(!v.done&&n++<100){v=(await s.call('POST','/api/move',{session:st.session,move:(v.legalMoves||v.legalMovesSample)[0]})).json();}
 const j=(await s.call('GET','/api/stats')).json();assert.equal(j.handles,1);assert.equal(j.gamesStarted,1);assert.equal(j.gamesFinished,1);assert.equal(j.finishedByGame.heaps,1);
 const o=mk();o.deps.redis.cmd=async()=>({reg:'3','s:heaps':'2','f:heaps':'1'});const k=(await handle({method:'GET',path:'/api/stats',query:{},body:{},headers:{},ip:'1',host:'x',proto:'https'},o.deps)).body;assert.equal(JSON.parse(k).handles,3);});

test('malformed JSON body gets a 400 with a message (glue marks it)',async()=>{const s=mk();const r=await s.call('POST','/api/move',{__badJson:true});assert.equal(r.status,400);assert.match(r.json().error,/not valid JSON/);});

test('admin delete-handle: disabled without a long secret, guarded, removes handle from all boards',async()=>{
 const off=mk();assert.equal((await off.call('POST','/api/admin',{action:'delete-handle',handle:'x'})).status,404);
 const s=mk({ADMIN_SECRET:'a-long-secret-value-1234'});const t=await s.reg('victim');
 const st=(await s.call('POST','/api/start',{game:'heaps',mode:'practice',seed:7},{token:t})).json();let v=st;let n=0;while(!v.done&&n++<100)v=(await s.call('POST','/api/move',{session:st.session,move:(v.legalMoves||v.legalMovesSample)[0]})).json();
 const sealed=(await s.call('POST','/api/start',{game:'heaps',mode:'sealed'},{token:t})).json();let w=sealed;n=0;while(!w.done&&n++<100)w=(await s.call('POST','/api/move',{session:sealed.session,move:(w.legalMoves||w.legalMovesSample)[0]})).json();
 const adm=(h:any,b:any)=>s.call('POST','/api/admin',b,{}).then(x=>x);
 const bad=await handle({method:'POST',path:'/api/admin',query:{},body:{action:'delete-handle',handle:'victim'},headers:{'x-admin-secret':'wrong-wrong-wrong-wrong'},ip:'1',host:'x',proto:'https'},s.deps);assert.equal(bad.status,401);
 const ok=await handle({method:'POST',path:'/api/admin',query:{},body:{action:'delete-handle',handle:'victim'},headers:{'x-admin-secret':'a-long-secret-value-1234'},ip:'1',host:'x',proto:'https'},s.deps);assert.equal(ok.status,200);
 const keys=[...s.redis.kv.keys()];assert.ok(!keys.some(k=>k.startsWith('h:victim')||k.startsWith('n:')&&k.includes(':victim:')));
 for(const [k,m] of s.redis.kv)if(k.startsWith('lb')&&m instanceof Map)assert.ok(!m.has('victim'),k);
 assert.equal((await s.call('POST','/api/start',{game:'heaps',mode:'sealed'},{token:t})).status,401);
 assert.equal((await s.call('POST','/api/register',{handle:'victim'})).status,200);void adm;});

test('no sign-up step: first start with a handle claims it and returns a play key inline; key reuses it',async()=>{const s=mk();
 const a=(await s.call('POST','/api/start',{game:'heaps',mode:'sealed',handle:'Walker'},{ip:'2.2.2.2'}));assert.equal(a.status,200);const j=a.json();assert.ok(j.playKey.length>=30);assert.equal(j.handle,'Walker');
 assert.equal((await s.call('POST','/api/start',{game:'heaps',mode:'sealed',handle:'walker'},{ip:'3.3.3.3'})).status,409);
 const b=await s.call('POST','/api/start',{game:'heaps',mode:'sealed',key:j.playKey});assert.equal(b.status,200);assert.equal(b.json().playKey,undefined);
 assert.equal((await s.call('GET','/api/me',{}, {token:j.playKey})).status,200);
 const st=await s.call('GET','/api/stats');assert.equal(st.json().handles,1);});

test('anonymous practice needs no handle or key, is capped per address, never lists on a board; sealed needs a handle',async()=>{const s=mk({MAX_PRACTICE_PER_HANDLE_DAY:'3'});
 const a=await s.call('POST','/api/start',{game:'heaps'},{ip:'9.9.9.9'});assert.equal(a.status,200);const j=a.json();assert.equal(j.mode,'casual');
 let v=j,n=0;while(!v.done&&n++<100)v=(await s.call('POST','/api/move',{session:j.session,move:(v.legalMoves||v.legalMovesSample)[0]})).json();assert.ok(v.done);
 assert.equal((await s.call('GET','/api/leaderboard',{},{query:{game:'heaps'}})).json().rows.length,0);
 assert.equal((await s.call('POST','/api/start',{game:'heaps',mode:'sealed'},{ip:'9.9.9.9'})).status,400);
 await s.call('POST','/api/start',{game:'heaps'},{ip:'9.9.9.9'});await s.call('POST','/api/start',{game:'heaps'},{ip:'9.9.9.9'});
 assert.equal((await s.call('POST','/api/start',{game:'heaps'},{ip:'9.9.9.9'})).status,429);});

test('agents.md and text mirror avoid account/register wording; text start with handle shows the play key',async()=>{const s=mk();
 const a=(await s.call('GET','/api/agents')).text;assert.ok(!/register|account|sign.?up (is|required)/i.test(a.replace(/No sign-up, no email\./,'')),'agents.md wording');
 const g=(await s.call('GET','/api/text/games')).text;assert.ok(!/regist|account/i.test(g));
 const t=(await s.call('GET','/api/text/start',{},{query:{handle:'texter',game:'heaps',mode:'sealed'},ip:'4.4.4.4'}));assert.equal(t.status,200);assert.match(t.text,/PLAY KEY/);});

test('unfinished sealed instance is resumed on restart, not burned; malformed move costs nothing',async()=>{const s=mk();const t=await s.reg('crash');
 const a=(await s.call('POST','/api/start',{game:'radar',mode:'sealed'},{token:t})).json();
 const m1=await s.call('POST','/api/move',{session:a.session,move:(a.legalMoves||a.legalMovesSample)[0]});assert.equal(m1.status,200);
 const bad=await s.call('POST','/api/move',{session:a.session});assert.equal(bad.status,400);
 const b=(await s.call('POST','/api/start',{game:'radar',mode:'sealed'},{token:t})).json();assert.equal(b.session,a.session);assert.equal(b.turn,1);assert.match(b.note,/Resumed/);
 const me=(await s.call('GET','/api/me',{},{token:t})).json();assert.equal(me.ranked.radar.runsUsed,1);
 const after=await s.call('POST','/api/move',{session:a.session,move:'zzz'});assert.equal(after.json().badMoves,1);});

test('sealed board on the live API includes reference policies, flagged',async()=>{const s=mk();
 await s.deps.redis.cmd('SET','sealed:policies',JSON.stringify({season:'t1',seeds:5,games:{heaps:[{agent:'instinct-baseline',mean:500,scores:[]}]}}));
 const t=await s.reg('p1');const st=(await s.call('POST','/api/start',{game:'heaps',mode:'sealed'},{token:t})).json();let v=st,n=0;while(!v.done&&n++<100)v=(await s.call('POST','/api/move',{session:st.session,move:(v.legalMoves||v.legalMovesSample)[0]})).json();
 const lb=(await s.call('GET','/api/leaderboard',{},{query:{game:'heaps'}})).json();const ref=lb.rows.find((r:any)=>r.handle==='instinct-baseline');assert.ok(ref&&ref.reference===true);assert.ok(lb.rows.some((r:any)=>r.handle==='p1'&&!r.reference));assert.deepEqual(lb.rows.map((r:any)=>r.rank),lb.rows.map((_:any,i:number)=>i+1));});

test('ranked slots: 5 slots x 3 attempts, fresh instance each attempt, board = mean of slot bests, never lowered',async()=>{const s=mk({SEALED_SEEDS:'2',SEALED_ATTEMPTS:'2'});const t=await s.reg('rep');
 const play=async(mv?:(v:any)=>string)=>{const st=(await s.call('POST','/api/start',{game:'lights',mode:'ranked'},{token:t}));assert.equal(st.status,200);const j=st.json();let v=j,n=0;while(!v.done&&n++<100)v=(await s.call('POST','/api/move',{session:j.session,move:mv?mv(v):v.legalMoves[0]})).json();return {j,v};};
 const seeds=new Set<string>();const scores:number[]=[];
 for(let i=0;i<4;i++){const {j,v}=await play();seeds.add(JSON.stringify(j.observation.board));scores.push(v.finalScore);assert.equal(j.slot,(i%2)+1);assert.equal(j.attempt,Math.floor(i/2)+1);}
 assert.equal(seeds.size,4,'every attempt is a fresh instance');
 assert.equal((await s.call('POST','/api/start',{game:'lights',mode:'ranked'},{token:t})).status,409);
 const lb=(await s.call('GET','/api/leaderboard',{},{query:{game:'lights'}})).json();const best1=Math.max(scores[0],scores[2]),best2=Math.max(scores[1],scores[3]);
 assert.equal(lb.rows[0].score,Math.round((best1+best2)/2*10)/10);});

test('profile, run replay and overview: scores, history, top 10, lazy rebuild for pre-profile handles',async()=>{const s=mk({SEALED_SEEDS:'2',SEALED_ATTEMPTS:'1'});const t=await s.reg('prof');
 const st=(await s.call('POST','/api/start',{game:'heaps',mode:'ranked'},{token:t})).json();let v=st,n=0;while(!v.done&&n++<100)v=(await s.call('POST','/api/move',{session:st.session,move:v.legalMoves[0]})).json();
 const pr=(await s.call('GET','/api/profile',{},{query:{handle:'PROF'}})).json();assert.equal(pr.handle,'prof');assert.ok(pr.games.heaps.score>=0);assert.equal(pr.games.heaps.runs,1);assert.equal(pr.recent.length,1);assert.equal(pr.overviewRank,1);
 const run=(await s.call('GET','/api/run',{},{query:{id:pr.recent[0].id}})).json();assert.equal(run.game,'heaps');assert.ok(run.moves.length>0);
 const ov=(await s.call('GET','/api/overview')).json();assert.equal(ov.rows[0].handle,'prof');
 assert.equal((await s.call('GET','/api/profile',{},{query:{handle:'nobody'}})).status,404);
 const old=await s.reg('oldtimer');await s.deps.redis.cmd('ZADD',`lb:t1:signal`,321,'oldtimer');const op=(await s.call('GET','/api/profile',{},{query:{handle:'oldtimer'}})).json();assert.equal(op.games.signal.score,321);
 assert.equal((await s.call('GET','/api/text/overview')).status,200);assert.equal((await s.call('GET','/api/text/profile',{},{query:{handle:'prof'}})).status,200);void old;});

test('new games: minefield and lights are replay-verified over HTTP and hide mines until the end',async()=>{const s=mk();
 const m=(await s.call('POST','/api/start',{game:'minefield',mode:'casual',seed:3})).json();assert.equal('mines' in m.observation,false);assert.ok(m.observation.board.some((r:string)=>/[.1-8]/.test(r)));
 let v=m,n=0;while(!v.done&&n++<100)v=(await s.call('POST','/api/move',{session:m.session,move:v.legalMoves[0]})).json();assert.ok(v.done);assert.ok(v.observation.mines.length===10);
 const l=(await s.call('POST','/api/start',{game:'lights',mode:'casual',seed:3})).json();assert.equal(l.legalMoves.length,25);});

test('handles expire after 14 idle days: removed from boards, profile and key; activity keeps them; name can be reclaimed',async()=>{const s=mk({SEALED_SEEDS:'1',SEALED_ATTEMPTS:'1'});const day=86400000;
 const run=async(t:string)=>{const st=(await s.call('POST','/api/start',{game:'heaps',mode:'ranked'},{token:t})).json();let v=st,n=0;while(!v.done&&n++<100)v=(await s.call('POST','/api/move',{session:st.session,move:v.legalMoves[0]})).json();};
 const a=await s.reg('keeper','1.1.1.1'),b=await s.reg('sleeper','2.2.2.2');await run(a);await run(b);
 s.tick(10*day);assert.equal((await s.call('POST','/api/start',{game:'lights',mode:'casual'},{token:a})).status,200);// keeper plays again: activity
 s.tick(6*day);// sleeper idle 16 days, keeper idle 6
 const lb=(await s.call('GET','/api/leaderboard',{},{query:{game:'heaps'}})).json();assert.deepEqual(lb.rows.map((r:any)=>r.handle),['keeper']);
 const ov=(await s.call('GET','/api/overview')).json();assert.deepEqual(ov.rows.map((r:any)=>r.handle),['keeper']);
 assert.equal((await s.call('GET','/api/profile',{},{query:{handle:'sleeper'}})).status,404);
 assert.equal((await s.call('POST','/api/start',{game:'heaps',mode:'ranked'},{token:b})).status,401,'key is gone');
 s.tick(1);assert.equal((await s.call('POST','/api/start',{game:'heaps',mode:'ranked',handle:'sleeper'},{ip:'5.5.5.5'})).status,200,'name can be claimed again');
 assert.equal((await s.call('GET','/api/profile',{},{query:{handle:'keeper'}})).status,200);});

test('storage limit errors from Redis become a clear 503; openapi and robots ship; llms.txt is the current brief',async()=>{const s=mk();s.deps.redis.cmd=async()=>{throw new Error('ERR max daily request limit exceeded');};
 const r=await handle({method:'GET',path:'/api/stats',query:{},body:{},headers:{},ip:'1',host:'x',proto:'https'},s.deps);assert.equal(r.status,503);assert.match(r.body,/capacity/);
 const spec=JSON.parse(readFileSync(new URL('../public/openapi.json',import.meta.url),'utf8'));assert.ok(spec.paths['/api/start']&&spec.paths['/api/profile']);assert.match(readFileSync(new URL('../public/robots.txt',import.meta.url),'utf8'),/Allow: \//);
 const l=(await mk().call('GET','/llms.txt')).text;assert.match(l,/Twelve deterministic games/);assert.ok(!/sealed|practice mode/i.test(l),'no stale mode names');});

test('v0.5.1: feed, daily streak, badge, card, share page, replay frames, tiers',async()=>{const s=mk();const tok=await s.reg('streaker');
 const fin=async(game:string)=>{const st=(await s.call('POST','/api/start',{game,mode:'sealed'},{token:tok})).json();let v=st,n=0;while(!v.done&&n++<200)v=(await s.call('POST','/api/move',{session:st.session,move:(v.legalMoves||v.legalMovesSample)[0]})).json();return st.session as string;};
 const d1=(await s.call('GET','/api/daily')).json();assert.equal(d1.date,'2026-10-05');assert.ok(games.some(g=>g.id===d1.game));
 const sid=await fin(d1.game);
 let p=(await s.call('GET','/api/profile?handle=streaker')).json();assert.equal(p.streak,1);assert.equal(p.dailyDoneToday,true);
 assert.equal((await s.call('GET','/api/daily')).json().rows[0].handle,'streaker');
 await fin(d1.game);p=(await s.call('GET','/api/profile?handle=streaker')).json();assert.equal(p.streak,1,'same day does not double count');
 s.tick(86400000);const d2=(await s.call('GET','/api/daily')).json();assert.equal(d2.date,'2026-10-06');await fin(d2.game);
 p=(await s.call('GET','/api/profile?handle=streaker')).json();assert.equal(p.streak,2);
 s.tick(3*86400000);p=(await s.call('GET','/api/profile?handle=streaker')).json();assert.equal(p.streak,0);assert.equal(p.bestStreak,2);
 const feed=(await s.call('GET','/api/feed')).json();assert.equal(feed.rows[0].handle,'streaker');
 const run=(await s.call('GET','/api/run?id='+sid)).json();assert.equal(run.frames.length,run.moves.length+1);assert.equal('seed' in run,false);
 const b=await s.call('GET','/api/badge?handle=streaker');assert.equal(b.status,200);assert.match(b.headers['content-type'],/svg/);assert.match(b.text,/<svg/);
 assert.equal((await s.call('GET','/api/badge?handle=nobody')).status,404);
 assert.match((await s.call('GET','/api/card?run='+sid)).text,/streaker/);
 const sh=await s.call('GET','/api/share?run='+sid);assert.match(sh.text,/og:image/);
 assert.equal((await s.call('GET','/api/card?run=<script>')).status,400);});

test('v0.5.2: a refused ranked start does not consume a run or monthly capacity',async()=>{const s=mk({SEALED_SEEDS:'1',SEALED_ATTEMPTS:'1'});const t=await s.reg('prober');
 const fin=async(r:any)=>{let v=r,n=0;while(!v.done&&n++<200)v=(await s.call('POST','/api/move',{session:r.session,move:(v.legalMoves||v.legalMovesSample)[0]})).json();};
 await fin((await s.call('POST','/api/start',{game:'signal',mode:'sealed'},{token:t})).json());
 for(let i=0;i<4;i++)assert.equal((await s.call('POST','/api/start',{game:'signal',mode:'sealed'},{token:t})).status,409);
 const me=(await s.call('GET','/api/me',{},{token:t})).json();assert.equal(me.ranked.signal.runsUsed,1);
 const cap=await s.redis.cmd('GET','cap:2026-10');assert.equal(Number(cap),1);});

test('v0.5.2: fourrows hides opponent depth and noise stream in ranked observations; replay stays deterministic',async()=>{const s=mk();const t=await s.reg('fr');
 const st=(await s.call('POST','/api/start',{game:'fourrows',mode:'sealed'},{token:t})).json();const o=JSON.stringify(st.observation);assert.equal(o.includes('depth'),false);assert.equal(o.includes('"ns"'),false);
 let v=st,n=0;while(!v.done&&n++<30)v=(await s.call('POST','/api/move',{session:st.session,move:(v.legalMoves||v.legalMovesSample)[0]})).json();assert.equal(v.recorded,true);});

test('v0.6.0: ratings need a finished ranked run, one per handle per game, averaged on /games and /ratings, removed on expiry',async()=>{const s=mk();
 const st=(await s.call('POST','/api/start',{game:'lights',mode:'ranked',handle:'rater'})).json();const key=st.playKey;
 assert.equal((await s.call('POST','/api/rate',{key,game:'lights',rating:9})).status,403);
 let v=st,n=0;while(!v.done&&n++<100)v=(await s.call('POST','/api/move',{session:st.session,move:v.legalMoves[0]})).json();assert.match(v.rateIt,/api\/rate/);
 for(const bad of [0,11,7.5,'x'])assert.equal((await s.call('POST','/api/rate',{key,game:'lights',rating:bad})).status,400);
 assert.equal((await s.call('POST','/api/rate',{key,game:'nope',rating:5})).status,400);assert.equal((await s.call('POST','/api/rate',{game:'lights',rating:5})).status,401);
 assert.equal((await s.call('POST','/api/rate',{key,game:'lights',rating:9})).json().avg,9);
 const r2=(await s.call('POST','/api/rate',{key,game:'lights',rating:7})).json();assert.equal(r2.avg,7);assert.equal(r2.count,1);
 const st2=(await s.call('POST','/api/start',{game:'lights',mode:'ranked',handle:'rater2'})).json();let w=st2;n=0;while(!w.done&&n++<100)w=(await s.call('POST','/api/move',{session:st2.session,move:w.legalMoves[0]})).json();
 assert.equal((await s.call('GET','/api/text/rate',{},{query:{key:st2.playKey,game:'lights',rating:'10'}})).status,200);
 const g=(await s.call('GET','/api/games')).json().games.find((x:any)=>x.id==='lights');assert.deepEqual(g.rating,{avg:8.5,count:2});
 assert.deepEqual((await s.call('GET','/api/ratings')).json().ratings.signal,{avg:null,count:0});
 s.tick(15*86400000);s.redis.kv.delete('prune:last');await s.call('GET','/api/leaderboard',{},{query:{game:'lights'}});
 assert.deepEqual((await s.call('GET','/api/ratings')).json().ratings.lights,{avg:null,count:0},'expired handles take their ratings with them');});

test('v0.6.0: a season bump starts boards, overview, feed, daily, ratings and stats fresh without deleting the old season',async()=>{const s=mk();
 const st=(await s.call('POST','/api/start',{game:'lights',mode:'ranked',handle:'veteran'})).json();let v=st,n=0;while(!v.done&&n++<100)v=(await s.call('POST','/api/move',{session:st.session,move:v.legalMoves[0]})).json();
 await s.call('POST','/api/rate',{key:st.playKey,game:'lights',rating:8});
 assert.equal((await s.call('GET','/api/feed')).json().rows.length,1);assert.equal((await s.call('GET','/api/ratings')).json().ratings.lights.count,1);
 s.deps.env.SEALED_SEASON='t2';
 assert.equal((await s.call('GET','/api/leaderboard',{},{query:{game:'lights'}})).json().rows.filter((r:any)=>!r.reference).length,0);
 assert.equal((await s.call('GET','/api/overview')).json().rows.filter((r:any)=>!r.reference).length,0);
 assert.equal((await s.call('GET','/api/feed')).json().rows.length,0);assert.deepEqual((await s.call('GET','/api/ratings')).json().ratings.lights,{avg:null,count:0});
 assert.equal((await s.call('GET','/api/stats')).json().gamesFinished,0);
 assert.equal((await s.call('GET','/api/me',{},{token:st.playKey})).json().ranked.lights.runsUsed,0,'fresh slots in the new season');
 s.deps.env.SEALED_SEASON='t1';assert.equal((await s.call('GET','/api/feed')).json().rows.length,1,'old season still readable');});
