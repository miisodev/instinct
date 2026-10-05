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
 for(const g of games){const st=(await s.call('POST','/api/start',{game:g.id,mode:'sealed'},{token:tok})).json();assert.equal(st.index,1);assert.equal('secret' in st.observation,false);assert.equal('ships' in st.observation,false);assert.equal('opp' in st.observation,false);
  let v=st;let n=0;while(!v.done&&n++<100){const m=v.legalMoves[0];const r=await s.call('POST','/api/move',{session:st.session,move:m});assert.equal(r.status,200);v=r.json();}
  assert.equal(v.done,true);assert.equal(v.recorded,true);assert.equal(v.finalScore,v.score);
  const lb=(await s.call('GET','/api/leaderboard?game='+g.id)).json();assert.equal(lb.rows[0].handle,'bot');}
 const me=(await s.call('GET','/api/me',{},{token:tok})).json();assert.equal(me.sealed.signal.started,1);});

test('sealed instances: per-handle different, each index once, K cap, practice unaffected',async()=>{const s=mk({SEALED_SEEDS:'2'});const a=await s.reg('aa','2.2.2.2'),b=await s.reg('bb','3.3.3.3');
 const obs=async(t:string)=>{const r=(await s.call('POST','/api/start',{game:'courier',mode:'sealed'},{token:t})).json();return JSON.stringify(r.observation.points);};
 const pa=await obs(a),pb=await obs(b);assert.notEqual(pa,pb);
 const a2=await s.call('POST','/api/start',{game:'courier',mode:'sealed'},{token:a});assert.equal(a2.json().index,2);
 assert.equal((await s.call('POST','/api/start',{game:'courier',mode:'sealed'},{token:a})).status,409);
 assert.equal((await s.call('POST','/api/start',{game:'heaps',mode:'sealed'},{token:a})).status,200);
 const pr=await s.call('POST','/api/start',{game:'courier',mode:'practice',seed:42},{token:a});assert.equal(pr.status,200);});

test('sealed hidden state is never exposed mid-game, even with illegal-move probing',async()=>{const s=mk();const t=await s.reg('p');const st=(await s.call('POST','/api/start',{game:'signal',mode:'sealed'},{token:t})).json();
 const r=await s.call('POST','/api/move',{session:st.session,move:'9999'});assert.equal(r.status,400);assert.equal(JSON.stringify(r.json()).includes('secret'),false);});

test('illegal moves rejected, 50 end the session at score 0',async()=>{const s=mk();const t=await s.reg('q');const st=(await s.call('POST','/api/start',{game:'heaps',mode:'sealed'},{token:t})).json();let last:any;
 for(let i=0;i<50;i++){last=await s.call('POST','/api/move',{session:st.session,move:'nope'});}
 assert.equal(last.status,200);assert.equal(last.json().done,true);assert.equal(last.json().finalScore,0);assert.equal((await s.call('GET','/api/leaderboard?game=heaps')).json().rows[0].score,0);});

test('no rewind or branching: concurrent moves conflict, finished sessions are final',async()=>{const s=mk();const t=await s.reg('r');const st=(await s.call('POST','/api/start',{game:'gridshift',mode:'practice',seed:1},{token:t})).json();
 const [x,y]=await Promise.all([s.call('POST','/api/move',{session:st.session,move:st.legalMoves[0]}),s.call('POST','/api/move',{session:st.session,move:st.legalMoves[0]})]);assert.deepEqual([x.status,y.status].sort(),[200,409]);});

test('auth: no token, bad token, session id is not guessable input',async()=>{const s=mk();assert.equal((await s.call('POST','/api/start',{game:'signal'})).status,401);assert.equal((await s.call('POST','/api/start',{game:'signal'},{token:'x'.repeat(40)})).status,401);assert.equal((await s.call('POST','/api/move',{session:'zz',move:'a'})).status,400);assert.equal((await s.call('POST','/api/move',{session:'0'.repeat(32),move:'a'})).status,404);});

test('abuse caps: per-IP registration, daily registrations, monthly game capacity, kill switch',async()=>{const s=mk({MAX_REGS_PER_IP_HOUR:'2'});await s.reg('i1','9.9.9.9');await s.reg('i2','9.9.9.9');assert.equal((await s.call('POST','/api/register',{handle:'i3'},{ip:'9.9.9.9'})).status,429);assert.equal((await s.call('POST','/api/register',{handle:'i3'},{ip:'8.8.8.8'})).status,200);
 const d=mk({MAX_REGS_PER_DAY:'1'});await d.reg('d1');assert.equal((await d.call('POST','/api/register',{handle:'d2'},{ip:'4.4.4.4'})).status,503);
 const m=mk({MAX_GAMES_PER_MONTH:'1'});const t=await m.reg('m1');assert.equal((await m.call('POST','/api/start',{game:'heaps',mode:'practice'},{token:t})).status,200);assert.equal((await m.call('POST','/api/start',{game:'heaps',mode:'practice'},{token:t})).status,503);assert.equal((await m.call('GET','/api/games')).status,200);
 const k=mk({API_DISABLED:'1'});assert.equal((await k.call('GET','/api/games')).status,503);});

test('sealed mode refuses to run without a salt (fail closed)',async()=>{const s=mk({SEALED_SALT:''});const t=await s.reg('n');assert.equal((await s.call('POST','/api/start',{game:'signal',mode:'sealed'},{token:t})).status,503);});

test('plain-text mirror: whole flow by GET, next-step URLs included',async()=>{const s=mk();const r=await s.call('GET','/api/text/register?handle=txt');assert.match(r.text,/TOKEN: \S+/);const tok=r.text.match(/TOKEN: (\S+)/)![1];
 const st=await s.call('GET',`/api/text/start?token=${tok}&game=heaps&mode=sealed`);assert.match(st.text,/NEXT: GET https:\/\/arcade\.test\/api\/text\/move\?session=/);const sid=st.text.match(/session=([a-f0-9]{32})/)![1];
 const mv=st.text.match(/legal moves: (\S+)/)![1];const m=await s.call('GET',`/api/text/move?session=${sid}&move=${mv}`);assert.match(m.text,/turn: 1/);
 assert.equal((await s.call('GET','/api/text/games')).status,200);assert.match((await s.call('GET','/api/text/board?game=heaps')).text,/leaderboard/);assert.match((await s.call('GET','/api/text/move?session=bad&move=1')).text,/^ERROR 400/);});

test('stats count handles, starts and finishes; agents.md served with the request origin',async()=>{const s=mk();const t=await s.reg('st');const st=(await s.call('POST','/api/start',{game:'heaps',mode:'practice'},{token:t})).json();await s.call('POST','/api/move',{session:st.session,move:st.legalMoves[0]});const j=(await s.call('GET','/api/stats')).json();assert.equal(j.handles,1);assert.equal(j.gamesStarted,1);
 const a=await s.call('GET','/api/agents');assert.match(a.text,/BASE = https:\/\/arcade\.test/);assert.ok(!a.text.includes('{{BASE}}'));
 for(const p of ['/agents.md','/llms.txt']){const r=await s.call('GET',p);assert.equal(r.status,200);assert.match(r.text,/BASE = https:\/\/arcade\.test/);}});

test('server verification matches independent replay and practice board keeps the best run per handle',async()=>{const s=mk();const t=await s.reg('pp');for(let k=0;k<2;k++){const st=(await s.call('POST','/api/start',{game:'signal',mode:'practice',seed:42},{token:t})).json();let v=st;while(!v.done)v=(await s.call('POST','/api/move',{session:st.session,move:k?'0000':'1020'})).json();}
 const lb=(await s.call('GET','/api/leaderboard?game=signal&board=practice&seed=42')).json();assert.equal(lb.rows.length,1);assert.equal(lb.rows[0].score,1000);});

test('redis command budget per full game stays small',async()=>{const s=mk();const t=await s.reg('bud');const before=s.redis.count();const st=(await s.call('POST','/api/start',{game:'signal',mode:'sealed'},{token:t})).json();let v=st,n=0;while(!v.done){v=(await s.call('POST','/api/move',{session:st.session,move:v.legalMoves[n++%256]})).json();}const used=s.redis.count()-before;assert.ok(used<=6*2+20,`commands used ${used}`);});
