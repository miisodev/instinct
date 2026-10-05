// Authoritative game server logic. Pure: (request, deps) -> response. No framework, no secrets in code.
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {advance,dailySeed,observe,sealedSeed,validateReplay,type Game,type State} from '../src/engine.ts';
import {games} from '../src/games/index.ts';
import type {Redis,Arg} from './redis.ts';
import agentsTemplate from './agents.ts';

export interface Req {method:string;path:string;query:Record<string,string>;body:any;headers:Record<string,string>;ip:string;host:string;proto:string}
export interface Res {status:number;headers:Record<string,string>;body:string}
export interface Deps {redis:Redis;env:Record<string,string|undefined>;now:()=>number}

const ctx=new AsyncLocalStorage<{all:boolean;max:number}>();
const HANDLE=/^[a-zA-Z0-9_.-]{1,32}$/;
const SCRIPT_CAS="if redis.call('HGET',KEYS[1],'step')==ARGV[1] then redis.call('HSET',KEYS[1],'step',ARGV[2],'json',ARGV[3]) redis.call('EXPIRE',KEYS[1],ARGV[4]) return 1 end return 0";
export const CAS_SCRIPT=SCRIPT_CAS;
const CORS={'access-control-allow-origin':'*','access-control-allow-headers':'authorization, content-type','access-control-allow-methods':'GET, POST, OPTIONS'};
class HttpError extends Error{status:number;extra:Record<string,unknown>;constructor(status:number,msg:string,extra:Record<string,unknown>={}){super(msg);this.status=status;this.extra=extra;}}
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const num=(v:string|undefined,d:number)=>{const n=Number(v);return Number.isFinite(n)&&n>0?n:d;};

function cfg(env:Deps['env']){return {
 season:env.SEALED_SEASON||'s1',salt:env.SEALED_SALT||'',K:num(env.SEALED_SEEDS,5),
 maxRegIp:num(env.MAX_REGS_PER_IP_HOUR,5),maxRegDay:num(env.MAX_REGS_PER_DAY,500),
 maxPractice:num(env.MAX_PRACTICE_PER_HANDLE_DAY,100),maxGamesMonth:num(env.MAX_GAMES_PER_MONTH,6000),
 ttl:num(env.SESSION_TTL_SECONDS,86400),maxBad:50,disabled:env.API_DISABLED==='1'};}

const LEGAL_MAX=300;
function legalInfo(g:Game,s:State){const m=g.legalMoves(s);if(ctx.getStore()?.all||m.length<=(ctx.getStore()?.max??LEGAL_MAX))return {legalMoves:m};return {legalMoves:null,legalMovesCount:m.length,legalMovesSample:m.slice(0,8),moveRule:moveFormat(g.id),legalMovesNote:'Full list omitted (large). Add "legal":"all" to the request to get it.'};}
function view(g:Game,sess:any,extra:Record<string,unknown>={}){const s=sess.state as State;return {session:sess.id,game:g.id,mode:sess.mode,...(sess.mode==='sealed'?{index:sess.idx,of:sess.of}:{seed:sess.seed}),turn:s.turns,done:sess.done,score:g.score(s),description:g.describe(s),observation:observe(g,s),...legalInfo(g,s),...extra};}

async function auth(d:Deps,req:Req){const h=req.headers['authorization']||'';const tok=(h.startsWith('Bearer ')?h.slice(7):'')||req.body?.key||req.query.key||req.body?.token||req.query.token||'';
 if(typeof tok!=='string'||tok.length<20||tok.length>200)throw new HttpError(401,'Missing or invalid play key. Send the playKey from your first /api/start (header Authorization: Bearer KEY, or "key" in the body or query).');
 const handle=await d.redis.cmd('GET','t:'+sha(tok));if(!handle)throw new HttpError(401,'Unknown play key. Start with a new handle to get one.');return String(handle);}

async function register(d:Deps,req:Req){const c=cfg(d.env);const handle=req.body?.handle??req.query.handle;
 if(typeof handle!=='string'||!HANDLE.test(handle))throw new HttpError(400,'handle must be 1-32 chars: letters, digits, dot, underscore, hyphen');
 if(/^instinct([-_.]|$)/i.test(handle))throw new HttpError(400,'handles starting with "instinct" are reserved');
 const day=new Date(d.now()).toISOString().slice(0,10),hour=Math.floor(d.now()/3600000);
 const [ipn,dayn]=await d.redis.pipe([['INCR',`rl:reg:${req.ip}:${hour}`],['INCR','reg:'+day],['EXPIRE',`rl:reg:${req.ip}:${hour}`,3600],['EXPIRE','reg:'+day,172800]]);
 if(ipn>c.maxRegIp)throw new HttpError(429,'Too many new handles from this address. Try again in an hour.');
 if(dayn>c.maxRegDay)throw new HttpError(503,'Daily capacity for new handles reached. Try again tomorrow, or play anonymous practice (no handle).');
 const token=randomBytes(24).toString('base64url');const hash=sha(token);
 const ok=await d.redis.cmd('SET','h:'+handle.toLowerCase(),hash,'NX');
 if(!ok)throw new HttpError(409,'That handle is already claimed. If it is yours, send its play key ("key"); otherwise pick another handle.');
 await d.redis.pipe([['SET','t:'+hash,handle],['HINCRBY','st2','reg',1]]);
 return {handle,token,playKey:token,note:'Handle claimed. This play key is shown once; send it as "key" to play again as this handle.'};}

async function start(d:Deps,req:Req){const c=cfg(d.env);const hasKey=!!((req.headers['authorization']||'').startsWith('Bearer ')||req.body?.key||req.query.key||req.body?.token||req.query.token);
 const wanted=req.body?.handle??req.query.handle;let handle:string|null=null,claimed:any=null;
 if(hasKey)handle=await auth(d,req);
 else if(wanted!==undefined){claimed=await register(d,req);handle=claimed.handle;}
 const gid=req.body?.game??req.query.game;const g=games.find(x=>x.id===gid);
 if(!g)throw new HttpError(400,'Unknown game. GET /api/games',{games:games.map(x=>x.id)});
 const mode=(req.body?.mode??req.query.mode??(handle?'sealed':'practice'));if(mode!=='sealed'&&mode!=='practice')throw new HttpError(400,'mode must be "sealed" or "practice"');
 if(mode==='sealed'&&!handle)throw new HttpError(400,'Ranked (sealed) play needs a handle: add "handle":"your-name" to claim one. Without a handle you can play anonymous practice.');
 if(mode==='sealed'&&c.salt){const openId=await d.redis.cmd('GET',`a:${c.season}:${handle!.toLowerCase()}:${g.id}`);
  if(openId){const raw=await d.redis.cmd('HGET','s:'+openId,'json');if(raw){const prev=JSON.parse(raw);if(!prev.done)return view(g,prev,{note:`Resumed your unfinished sealed instance ${prev.idx} of ${c.K} (same state, nothing new consumed). Finish it to move on.`});}}}
 if(mode==='sealed'&&!c.salt)throw new HttpError(503,'Sealed mode is not configured on this server.');
 const month=new Date(d.now()).toISOString().slice(0,7),day=new Date(d.now()).toISOString().slice(0,10);
 if(!handle){const day0=new Date(d.now()).toISOString().slice(0,10),k=`p:anon:${req.ip}:${day0}`;const n=await d.redis.cmd('INCR',k);if(n===1)await d.redis.cmd('EXPIRE',k,172800);if(n>c.maxPractice)throw new HttpError(429,'Daily anonymous practice limit reached for this address. Claim a handle for more.');}
 const cap=await d.redis.cmd('INCR','cap:'+month);if(cap===1)await d.redis.cmd('EXPIRE','cap:'+month,3000000);
 if(cap>c.maxGamesMonth)throw new HttpError(503,'Monthly play capacity reached. Reads still work. Capacity resets on the 1st (UTC).');
 let seed:number,idx=0;
 if(mode==='sealed'){idx=await d.redis.cmd('INCR',`n:${c.season}:${handle!.toLowerCase()}:${g.id}`);
  if(idx>c.K)throw new HttpError(409,`All ${c.K} sealed instances of ${g.id} are used for this handle this season. Try another game or practice mode.`);
  seed=sealedSeed(idx,`${c.salt}|${c.season}|${handle!.toLowerCase()}|${g.id}`);}
 else{const sd=req.body?.seed??req.query.seed??42;seed=sd==='daily'?dailySeed():Number(sd);
  if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw new HttpError(400,'seed must be an integer 0..4294967295 or "daily"');
  const pk=`p:${(handle||'').toLowerCase()}:${day}`;const p=handle?await d.redis.cmd('INCR',pk):0;if(p===1)await d.redis.cmd('EXPIRE',pk,172800);
  if(p>c.maxPractice)throw new HttpError(429,'Daily practice limit reached for this handle.');}
 const id=randomBytes(16).toString('hex');const state=g.init(seed);
 if(mode==='sealed')await d.redis.cmd('SET',`a:${c.season}:${handle!.toLowerCase()}:${g.id}`,id,'EX',c.ttl);
 const sess={id,handle,game:g.id,mode,seed,idx,of:c.K,season:c.season,step:0,state,moves:[] as string[],bad:0,done:false};
 await d.redis.pipe([['HSET','s:'+id,'step',0,'json',JSON.stringify(sess)],['EXPIRE','s:'+id,c.ttl],['HINCRBY','st2','s:'+g.id,1]]);
 const pre=claimed?{handle,playKey:claimed.playKey,keyNote:'Your handle is claimed. This play key is shown once; send it as "key" in later /api/start calls to play as this handle. Moves need only the session id.'}:{};
 return view(g,sess,{...pre,...(mode==='sealed'?{note:`Sealed instance ${idx} of ${c.K}. It can be played once; unfinished instances score 0.`}:{note:handle?'Practice: public seed, solvable offline, not sealed.':'Anonymous practice: public seed, solvable offline, not recorded on a board. Add "handle" to claim a name and get on the boards.'})});}

async function load(d:Deps,id:unknown){if(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))throw new HttpError(400,'session must be the 32-char id from /api/start');
 const raw=await d.redis.cmd('HGET','s:'+id,'json');if(!raw)throw new HttpError(404,'Session not found or expired. Start a new one.');return JSON.parse(raw);}

async function record(d:Deps,sess:any,g:Game,score:number){const c=cfg(d.env);const h=sess.handle;if(!h){await d.redis.cmd('HINCRBY','st2','f:'+g.id,1);return;}const lh=h.toLowerCase();
 if(sess.mode==='sealed'){const rk=`r:${sess.season}:${g.id}:${lh}`;
  const [,vals]=await d.redis.pipe([['HSET',rk,String(sess.idx),score],['HVALS',rk]]);
  const sum=(vals as string[]).reduce((a,b)=>a+Number(b),0);
  await d.redis.pipe([['ZADD',`lb:${sess.season}:${g.id}`,Math.round(sum/c.K*10)/10,h],['HINCRBY','st2','f:'+g.id,1]]);}
 else await d.redis.pipe([['ZADD',`lbp:${g.id}:${sess.seed}`,'GT',score,h],['HINCRBY','st2','f:'+g.id,1]]);}

async function move(d:Deps,req:Req){const c=cfg(d.env);const id=req.body?.session??req.query.session;const m=req.body?.move??req.query.move;
 const sess=await load(d,id);const g=games.find(x=>x.id===sess.game)!;
 if(sess.done)return view(g,sess,{note:'Game already finished.'});
 if(typeof m!=='string'||m.length>64)throw new HttpError(400,'move must be a string from legalMoves');
 const prev=sess.step;let err='';
 if(!g.legalMoves(sess.state).includes(m)){sess.bad++;err=`Illegal move: ${m}`;if(sess.bad>=c.maxBad){sess.done=true;sess.aborted=true;}}
 else{sess.state=advance(g,sess.state,m);sess.moves.push(m);sess.step=prev+1;if(sess.state.done)sess.done=true;}
 let final=false,score=g.score(sess.state);
 if(sess.done&&!err||sess.aborted){final=true;
  if(!sess.aborted){// independent verification: replay the full log from the seed with the reviewed engine
   const v=validateReplay({schema:1,game:g.id,version:g.version,seed:sess.seed,agent:'verify',moves:sess.moves},games);
   if(v.score!==score)throw new HttpError(500,'verification mismatch; result not recorded');}
  else score=0;}
 const ok=await d.redis.cmd('EVAL',SCRIPT_CAS,1,'s:'+sess.id,String(prev),String(sess.step),JSON.stringify(sess),sess.done?3600:c.ttl);
 if(ok!==1)throw new HttpError(409,'Conflict: another request moved this session. GET /api/session to resync.');
 if(err&&!sess.aborted)throw new HttpError(400,err,{...legalInfo(g,sess.state),moveRule:moveFormat(g.id),badMoves:sess.bad,maxBad:c.maxBad});
 if(final)await record(d,sess,g,score);
 return view(g,sess,{...(final?{final:true,recorded:true,finalScore:score}:{}),...(sess.aborted?{note:'Session ended: too many illegal moves. Score 0.'}:{})});}

async function session(d:Deps,req:Req){const sess=await load(d,req.query.session);return view(games.find(x=>x.id===sess.game)!,sess);}

async function me(d:Deps,req:Req){const c=cfg(d.env);const handle=await auth(d,req);const lh=handle.toLowerCase();
 const out=await d.redis.pipe(games.flatMap(g=>[['GET',`n:${c.season}:${lh}:${g.id}`],['HGETALL',`r:${c.season}:${g.id}:${lh}`]]));
 const prog:Record<string,unknown>={};games.forEach((g,i)=>{const used=Number(out[i*2]||0);const arr=out[i*2+1] as string[]||[];const scores:Record<string,number>={};for(let k=0;k<arr.length;k+=2)scores[arr[k]]=Number(arr[k+1]);prog[g.id]={started:Math.min(used,c.K),of:c.K,finished:scores};});
 return {handle,season:c.season,sealed:prog};}

async function leaderboard(d:Deps,req:Req){const c=cfg(d.env);const gid=req.query.game;const g=games.find(x=>x.id===gid);if(!g)throw new HttpError(400,'game=<id> required',{games:games.map(x=>x.id)});
 const board=req.query.board||'sealed';let key:string,meta:any;
 if(board==='policies'){const p=await policyBoard(d);const rows=(p.games[g.id]??[]).slice(0,25).map((r,i)=>({rank:i+1,handle:r.agent,score:r.mean}));
  return {game:g.id,board,season:p.season,seeds:p.seeds,commitment:p.commitment,note:`Submitted policies (policies/<handle>.mjs), mean over ${p.seeds} hidden seeds, evaluated in sandboxed CI.`,rows};}
 if(board==='sealed'){key=`lb:${c.season}:${g.id}`;meta={board,season:c.season,seeds:c.K,note:`Mean over ${c.K} hidden per-handle instances; unplayed count 0.`};}
 else{const sd=req.query.seed==='daily'?dailySeed():Number(req.query.seed??42);key=`lbp:${g.id}:${sd}`;meta={board:'practice',seed:sd,note:'Public seed, solvable offline.'};}
 const r=await d.redis.cmd('ZREVRANGE',key,0,24,'WITHSCORES') as string[];let rows:any[]=[];for(let i=0;i<r.length;i+=2)rows.push({handle:r[i],score:Number(r[i+1])});
 if(board==='sealed'){const p=await policyBoard(d);const refs=(p.games[g.id]??[]).map(x=>({handle:x.agent,score:x.mean,reference:true}));
  if(refs.length){rows=[...rows,...refs].sort((a,b)=>b.score-a.score||a.handle.localeCompare(b.handle)).slice(0,25);meta.note+=' Rows marked reference are submitted policies run by CI on hidden seeds (the bar to beat), not live HTTP players.';}}
 return {game:g.id,...meta,rows:rows.map((x,i)=>({rank:i+1,...x}))};}

// Policy board: computed by the sealed CI workflow (scripts/publish-sealed.ts), stored whole under one key.
export const POLICY_KEY='sealed:policies';
type PolicyBoard={season:string|null;dev?:boolean;seeds:number;commitment?:string;updated?:string;games:Record<string,{agent:string;mean:number;scores:number[]}[]>};
async function policyBoard(d:Deps):Promise<PolicyBoard>{const raw=await d.redis.cmd('GET',POLICY_KEY) as string|null;if(!raw)return {season:null,seeds:0,games:{}};return JSON.parse(raw);}

const flat=(a:any):Record<string,string>=>{if(Array.isArray(a)){const o:Record<string,string>={};for(let i=0;i+1<a.length;i+=2)o[String(a[i])]=String(a[i+1]);return o;}return a&&typeof a==='object'?Object.fromEntries(Object.entries(a).map(([k,v])=>[k,String(v)])):{};};
async function stats(d:Deps){const h=flat(await d.redis.cmd('HGETALL','st2'));const s:Record<string,number>={},f:Record<string,number>={};
 for(const [k,v] of Object.entries(h)){if(k.startsWith('s:'))s[k.slice(2)]=Number(v);else if(k.startsWith('f:'))f[k.slice(2)]=Number(v);}
 const sum=(o:Record<string,number>)=>Object.values(o).reduce((a,b)=>a+b,0);
 return {handles:Number(h.reg||0),gamesStarted:sum(s),gamesFinished:sum(f),startedByGame:s,finishedByGame:f};}

// ---------- admin (optional, guarded by ADMIN_SECRET env; remove a handle everywhere) ----------
async function admin(d:Deps,req:Req){const secret=d.env.ADMIN_SECRET||'';const given=req.headers['x-admin-secret']||'';
 const a=Buffer.from(sha(given)),b=Buffer.from(sha(secret));
 if(secret.length<16||!timingSafeEqual(a,b))throw new HttpError(secret.length<16?404:401,secret.length<16?'Not found. Start at GET /api/games or /agents.md':'Unauthorized');
 const action=req.body?.action,handle=req.body?.handle;
 if(action!=='delete-handle'||typeof handle!=='string'||!HANDLE.test(handle))throw new HttpError(400,'POST {"action":"delete-handle","handle":"..."} with header x-admin-secret');
 const c=cfg(d.env);const lh=handle.toLowerCase();const hash=await d.redis.cmd('GET','h:'+lh);
 const cmds:Arg[][]=[['DEL','h:'+lh]];if(hash)cmds.push(['DEL','t:'+hash]);
 for(const g of games){cmds.push(['ZREM',`lb:${c.season}:${g.id}`,handle],['DEL',`r:${c.season}:${g.id}:${lh}`],['DEL',`n:${c.season}:${lh}:${g.id}`]);}
 let cursor='0';do{const r=await d.redis.cmd('SCAN',cursor,'MATCH','lbp:*','COUNT',1000) as [string,string[]];cursor=String(r[0]);for(const k of r[1])cmds.push(['ZREM',k,handle]);}while(cursor!=='0');
 await d.redis.pipe(cmds);return {deleted:handle,commands:cmds.length,note:'Registration, token, sealed and practice board entries removed. Counters in /api/stats are not rewound.'};}

function gamesList(){return {games:games.map(g=>({id:g.id,name:g.name,category:g.category,maxTurns:g.maxTurns,openBook:!!g.openBook,rules:g.description,moveFormat:moveFormat(g.id)}))};}
function moveFormat(id:string){return ({signal:'4 digits, each 0-3, e.g. "1020"',gridshift:'index (0-8) of the tile to slide into the gap, as a string',vault:'one of up, down, left, right, extract',handshake:'"C" (cooperate) or "D" (defect)',radar:'"row,col" with 0-7, e.g. "3,4"',heaps:'"heap:count", e.g. "2:3"',fourrows:'column 0-6 as a string',courier:'stop index 0-23 as a string'} as Record<string,string>)[id]??'see legalMoves';}

// ---------- plain-text mirror for fetch-only agents ----------
function text(base:string,action:string,r:any){const L:string[]=[];
 const mv=(r.legalMoves as string[]|null|undefined);
 if(action==='games'){L.push('INSTINCT games. Pick a game and play. No sign-up.','');for(const g of r.games)L.push(`- ${g.id}: ${g.rules}\n  moves: ${g.moveFormat}`);L.push('',`NEXT (ranked): GET ${base}/api/text/start?handle=YOUR-NAME&game=GAME&mode=sealed  (claims the handle, returns a play key)`,`Or anonymous practice: GET ${base}/api/text/start?game=GAME`);}
 else if(action==='register'||action==='claim'){L.push(`Handle claimed: ${r.handle}`,`PLAY KEY: ${r.playKey}`,'Shown once.','',`NEXT: GET ${base}/api/text/start?key=${r.playKey}&game=signal&mode=sealed`);}
 else if(action==='start'||action==='move'||action==='session'){L.push(`game: ${r.game}   mode: ${r.mode}${r.index?` (instance ${r.index} of ${r.of})`:` seed ${r.seed}`}`,`turn: ${r.turn}   ${r.done?'FINISHED':'in progress'}   score: ${r.score}`);if(r.playKey)L.push('',`Handle claimed: ${r.handle}`,`PLAY KEY (shown once, keep it): ${r.playKey}`,`Next start as this handle: GET ${base}/api/text/start?key=${r.playKey}&game=GAME&mode=sealed`);if(r.note)L.push(r.note);L.push('',r.description,'','observation: '+JSON.stringify(r.observation));
  if(r.done)L.push('',r.recorded?`FINAL SCORE ${r.finalScore} recorded.`:'Finished.',`Board: GET ${base}/api/text/board?game=${r.game}`);
  else{L.push('legal moves: '+(mv?mv.join(' '):`${r.legalMovesCount} options, e.g. ${(r.legalMovesSample||[]).join(' ')}. Rule: ${r.moveRule}`),'',`NEXT: GET ${base}/api/text/move?session=${r.session}&move=MOVE`);}}
 else if(action==='board'){L.push(`${r.game} leaderboard (${r.board})`,r.note,'');for(const x of r.rows)L.push(`${x.rank}. ${x.handle}  ${x.score}${x.reference?'  (reference policy)':''}`);if(!r.rows.length)L.push('(no entries yet)');}
 else if(action==='me'){L.push(`handle: ${r.handle}  season: ${r.season}`);for(const [g,p] of Object.entries<any>(r.sealed))L.push(`${g}: started ${p.started}/${p.of}, scores ${JSON.stringify(p.finished)}`);}
 else L.push(JSON.stringify(r));return L.join('\n')+'\n';}

export const handle=(req:Req,d:Deps):Promise<Res>=>ctx.run({all:req.query.legal==='all'||req.body?.legal==='all',max:Number(d.env.MAX_LEGAL_LIST)||LEGAL_MAX},()=>handleInner(req,d));
async function handleInner(req:Req,d:Deps):Promise<Res>{
 const json=(status:number,o:unknown,h:Record<string,string>={}):Res=>({status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...CORS,...h},body:JSON.stringify(o)});
 const plain=(status:number,s:string,h:Record<string,string>={}):Res=>({status,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store',...CORS,...h},body:s});
 if(req.method==='OPTIONS')return {status:204,headers:CORS,body:''};
 const base=`${req.proto}://${req.host}`;let path=req.path.replace(/^\/api/,'').replace(/\/+$/,'')||'/';const isText=path.startsWith('/text');if(isText){path=path.slice(5)||(req.query.action?'/'+req.query.action:'/games');}
 const c=cfg(d.env);
 try{
  if(req.body&&(req.body as any).__badJson)throw new HttpError(400,'Request body is not valid JSON. Send {"session":"...","move":"..."} with content-type application/json, or use the GET /api/text/* mirror.');
  if(c.disabled)throw new HttpError(503,'The arcade API is paused.');
  const cache={'cache-control':'public, s-maxage=120, stale-while-revalidate=300'};
  // Vercel rewrites keep the original path, so /agents.md and /llms.txt arrive here unchanged.
  if(path==='/agents'||path==='/agents.md'||path==='/llms.txt'||path==='/'&&!isText)return plain(200,agentsTemplate.replaceAll('{{BASE}}',base),{'cache-control':'public, s-maxage=300'});
  const post=req.method==='POST'||isText;
  let result:any,action=path.slice(1),headers:Record<string,string>={};
  switch(path){
   case '/games':result=gamesList();headers=cache;break;
   case '/leaderboard':case '/board':action='board';result=await leaderboard(d,req);headers=cache;break;
   case '/policies':result=await policyBoard(d);headers=cache;break;
   case '/stats':result=await stats(d);headers={'cache-control':'public, s-maxage=60, stale-while-revalidate=120'};break;
   case '/admin':if(req.method!=='POST')throw new HttpError(404,'Not found. Start at GET /api/games or /agents.md');result=await admin(d,req);break;
   case '/session':result=await session(d,req);break;
   case '/me':result=await me(d,req);break;
   case '/claim':
   case '/register':if(!post)throw new HttpError(405,'POST {"handle":"..."}');result=await register(d,req);break;
   case '/start':if(!post)throw new HttpError(405,'POST {"game":"...","mode":"sealed"}');result=await start(d,req);break;
   case '/move':if(!post)throw new HttpError(405,'POST {"session":"...","move":"..."}');result=await move(d,req);break;
   default:throw new HttpError(404,'Not found. Start at GET /api/games or /agents.md');}
  return isText?plain(200,text(base,action,result),headers):json(200,result,headers);
 }catch(e:any){
  const status=e instanceof HttpError?e.status:500;const msg=e instanceof HttpError?e.message:'Server error';
  if(!(e instanceof HttpError))console.error('instinct api error',e?.message);
  return isText?plain(status,`ERROR ${status}: ${msg}\n${e.extra?.legalMoves?`legal moves: ${(e.extra.legalMoves as string[]).join(' ')}\n`:e.extra?.moveRule?`move rule: ${e.extra.moveRule}\n`:''}`):json(status,{error:msg,...(e instanceof HttpError?e.extra:{})});}
}
