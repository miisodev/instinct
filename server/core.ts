// Authoritative game server logic. Pure: (request, deps) -> response. No framework, no secrets in code.
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {advance,dailySeed,observe,sealedSeed,validateReplay,type Game,type State} from '../src/engine.ts';
import {games} from '../src/games/index.ts';
import type {Redis,Arg} from './redis.ts';
import agentsTemplate from './agents.ts';
import {badge,card,dailyGame,dayKey,round,tierBounds,tierOf,TIER_COLOR,xml} from './extras.ts';

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
 maxPractice:num(env.MAX_PRACTICE_PER_HANDLE_DAY,100),maxGamesMonth:num(env.MAX_GAMES_PER_MONTH,5000),A:num(env.SEALED_ATTEMPTS,3),
 ttl:num(env.SESSION_TTL_SECONDS,86400),idleDays:num(env.HANDLE_IDLE_DAYS,14),maxBad:50,disabled:env.API_DISABLED==='1'};}

const LEGAL_MAX=300;
function legalInfo(g:Game,s:State){const m=g.legalMoves(s);if(ctx.getStore()?.all||m.length<=(ctx.getStore()?.max??LEGAL_MAX))return {legalMoves:m};return {legalMoves:null,legalMovesCount:m.length,legalMovesSample:m.slice(0,8),moveRule:moveFormat(g.id),legalMovesNote:'Full list omitted (large). Add "legal":"all" to the request to get it.'};}
function view(g:Game,sess:any,extra:Record<string,unknown>={}){const s=sess.state as State;return {session:sess.id,game:g.id,mode:sess.mode==='sealed'?'ranked':'casual',...(sess.mode==='sealed'?{slot:sess.slot??sess.idx,attempt:sess.attempt??1,of:sess.of}:{seed:sess.seed}),turn:s.turns,done:sess.done,score:g.score(s),description:g.describe(s),observation:observe(g,s),...legalInfo(g,s),...extra};}

async function auth(d:Deps,req:Req){return (await authFull(d,req))[0];}
async function authFull(d:Deps,req:Req):Promise<[string,string]>{const h=req.headers['authorization']||'';const tok=(h.startsWith('Bearer ')?h.slice(7):'')||req.body?.key||req.query.key||req.body?.token||req.query.token||'';
 if(typeof tok!=='string'||tok.length<20||tok.length>200)throw new HttpError(401,'Missing or invalid play key. Send the playKey from your first /api/start (header Authorization: Bearer KEY, or "key" in the body or query).');
 const handle=await d.redis.cmd('GET','t:'+sha(tok));if(!handle)throw new HttpError(401,'Unknown play key. Start with a new handle to get one.');return [String(handle),sha(tok)];}

// ---------- sliding 14-day expiry: a handle, its play key, scores, profile and run history go after HANDLE_IDLE_DAYS without activity ----------
async function touch(d:Deps,handle:string,thash:string|undefined){const c=cfg(d.env);const lh=handle.toLowerCase(),ttl=c.idleDays*86400;
 await d.redis.pipe([['ZADD','act',d.now()+ttl*1000,lh],['EXPIRE','h:'+lh,ttl],...(thash?[['EXPIRE','t:'+thash,ttl]]:[])]);}
async function purge(d:Deps,handle:string){const c=cfg(d.env);const lh=handle.toLowerCase();
 const [disp,hash]=await d.redis.pipe([['HGET',`pf:${c.season}:${lh}`,'handle'],['GET','h:'+lh]]);const names=[...new Set([handle,String(disp||handle)])];
 const cmds:Arg[][]=[['DEL','h:'+lh],['ZREM','act',lh]];if(hash)cmds.push(['DEL','t:'+hash]);
 cmds.push(['DEL',`pf:${c.season}:${lh}`],['DEL',`hist:${c.season}:${lh}`]);for(const n of names)cmds.push(['ZREM',`ov:${c.season}`,n]);
 for(const g of games){for(const n of names)cmds.push(['ZREM',`lb:${c.season}:${g.id}`,n]);cmds.push(['HDEL','rt:'+g.id,lh],['DEL',`r:${c.season}:${g.id}:${lh}`],['DEL',`n:${c.season}:${lh}:${g.id}`],['DEL',`a:${c.season}:${lh}:${g.id}`]);}
 await d.redis.pipe(cmds);return cmds.length;}
async function prune(d:Deps){try{const ok=await d.redis.cmd('SET','prune:last','1','NX','EX',3600);if(!ok)return;
 const old=await d.redis.cmd('ZRANGEBYSCORE','act','-inf',d.now(),'LIMIT',0,10) as string[];for(const lh of old)await purge(d,lh);}catch{/* best effort */}}
async function liveRows(d:Deps,rows:any[]){if(!rows.length)return rows;const sc=await d.redis.cmd('ZMSCORE','act',...rows.map(r=>String(r.handle).toLowerCase())) as (string|null)[];const now=d.now(),idle=cfg(d.env).idleDays*86400000;
 const fill:Arg[][]=[];const out=rows.filter((r,i)=>{const s=sc[i];if(s===null||s===undefined){fill.push(['ZADD','act','NX',now+idle,String(r.handle).toLowerCase()]);return true;}return Number(s)>now;});
 if(fill.length)await d.redis.pipe(fill);return out;}

async function register(d:Deps,req:Req){const c=cfg(d.env);const handle=req.body?.handle??req.query.handle;
 if(typeof handle!=='string'||!HANDLE.test(handle))throw new HttpError(400,'handle must be 1-32 chars: letters, digits, dot, underscore, hyphen');
 if(/^instinct([-_.]|$)/i.test(handle))throw new HttpError(400,'handles starting with "instinct" are reserved');
 const day=new Date(d.now()).toISOString().slice(0,10),hour=Math.floor(d.now()/3600000);
 const [ipn,dayn]=await d.redis.pipe([['INCR',`rl:reg:${req.ip}:${hour}`],['INCR','reg:'+day],['EXPIRE',`rl:reg:${req.ip}:${hour}`,3600],['EXPIRE','reg:'+day,172800]]);
 if(ipn>c.maxRegIp)throw new HttpError(429,'Too many new handles from this address. Try again in an hour.');
 if(dayn>c.maxRegDay)throw new HttpError(503,'Daily capacity for new handles reached. Try again tomorrow, or play anonymous practice (no handle).');
 const lh0=handle.toLowerCase();const act0=await d.redis.cmd('ZSCORE','act',lh0);if(act0!==null&&act0!==undefined&&Number(act0)<d.now())await purge(d,handle);
 const token=randomBytes(24).toString('base64url');const hash=sha(token);
 const ok=await d.redis.cmd('SET','h:'+lh0,hash,'NX');
 if(!ok)throw new HttpError(409,'That handle is already claimed. If it is yours, send its play key ("key"); otherwise pick another handle.');
 await d.redis.pipe([['SET','t:'+hash,handle],['HINCRBY','st2','reg',1]]);await touch(d,handle,hash);
 return {handle,token,playKey:token,note:'Handle claimed. This play key is shown once; send it as "key" to play again as this handle.'};}

async function start(d:Deps,req:Req){const c=cfg(d.env);const hasKey=!!((req.headers['authorization']||'').startsWith('Bearer ')||req.body?.key||req.query.key||req.body?.token||req.query.token);
 const wanted=req.body?.handle??req.query.handle;let handle:string|null=null,claimed:any=null;
 let th:string|undefined;if(hasKey){[handle,th]=await authFull(d,req);await touch(d,handle,th);}
 else if(wanted!==undefined){claimed=await register(d,req);handle=claimed.handle;th=sha(claimed.token);}
 await prune(d);
 const gid=req.body?.game??req.query.game;const g=games.find(x=>x.id===gid);
 if(!g)throw new HttpError(400,'Unknown game. GET /api/games',{games:games.map(x=>x.id)});
 const rawMode=String(req.body?.mode??req.query.mode??(handle?'ranked':'casual'));const mode=rawMode==='ranked'||rawMode==='sealed'?'sealed':rawMode==='casual'||rawMode==='practice'?'practice':'';if(!mode)throw new HttpError(400,'mode must be "ranked" or "casual"');
 if(mode==='sealed'&&!handle)throw new HttpError(400,'Ranked play needs a handle: add "handle":"your-name" to claim one. Without a handle you can play casual mode (anonymous, unranked).');
 if(mode==='sealed'&&c.salt){const openId=await d.redis.cmd('GET',`a:${c.season}:${handle!.toLowerCase()}:${g.id}`);
  if(openId){const raw=await d.redis.cmd('HGET','s:'+openId,'json');if(raw){const prev=JSON.parse(raw);if(!prev.done)return view(g,prev,{note:`Resumed your unfinished ranked run (slot ${prev.slot??prev.idx}, attempt ${prev.attempt??1}). Same state, nothing new consumed. Finish it to move on.`});}}}
 if(mode==='sealed'&&!c.salt)throw new HttpError(503,'Ranked mode is not configured on this server.');
 const month=new Date(d.now()).toISOString().slice(0,7),day=new Date(d.now()).toISOString().slice(0,10);
 if(!handle){const day0=new Date(d.now()).toISOString().slice(0,10),k=`p:anon:${req.ip}:${day0}`;const n=await d.redis.cmd('INCR',k);if(n===1)await d.redis.cmd('EXPIRE',k,172800);if(n>c.maxPractice)throw new HttpError(429,'Daily casual limit reached for this address. Claim a handle for more.');}
 const cap=await d.redis.cmd('INCR','cap:'+month);if(cap===1)await d.redis.cmd('EXPIRE','cap:'+month,3000000);
 if(cap>c.maxGamesMonth)throw new HttpError(503,'Monthly play capacity reached. Reads still work. Capacity resets on the 1st (UTC).');
 let seed:number,idx=0;
 if(mode==='sealed'){idx=await d.redis.cmd('INCR',`n:${c.season}:${handle!.toLowerCase()}:${g.id}`);
  if(idx>c.K*c.A){await d.redis.pipe([['DECR',`n:${c.season}:${handle!.toLowerCase()}:${g.id}`],['DECR','cap:'+month]]);throw new HttpError(409,`All ${c.K*c.A} ranked runs of ${g.id} (${c.K} slots x ${c.A} attempts) are used for this handle this season. Try another game, or casual mode.`);}
  seed=sealedSeed(idx,`${c.salt}|${c.season}|${handle!.toLowerCase()}|${g.id}`);}
 else{const sd=req.body?.seed??req.query.seed??42;seed=sd==='daily'?dailySeed():Number(sd);
  if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw new HttpError(400,'seed must be an integer 0..4294967295 or "daily"');
  const pk=`p:${(handle||'').toLowerCase()}:${day}`;const p=handle?await d.redis.cmd('INCR',pk):0;if(p===1)await d.redis.cmd('EXPIRE',pk,172800);
  if(p>c.maxPractice)throw new HttpError(429,'Daily practice limit reached for this handle.');}
 const id=randomBytes(16).toString('hex');const state=g.init(seed);
 if(mode==='sealed')await d.redis.cmd('SET',`a:${c.season}:${handle!.toLowerCase()}:${g.id}`,id,'EX',c.ttl);
 const slot=idx?((idx-1)%c.K)+1:0,attempt=idx?Math.floor((idx-1)/c.K)+1:0;
 const sess={id,handle,th,game:g.id,mode,seed,idx,slot,attempt,of:c.K,season:c.season,step:0,state,moves:[] as string[],bad:0,done:false};
 await d.redis.pipe([['HSET','s:'+id,'step',0,'json',JSON.stringify(sess)],['EXPIRE','s:'+id,c.ttl],['HINCRBY','st2','s:'+g.id,1]]);
 const pre=claimed?{handle,playKey:claimed.playKey,keyNote:'Your handle is claimed. This play key is shown once; send it as "key" in later /api/start calls to play as this handle. Moves need only the session id.'}:{};
 return view(g,sess,{...pre,...(mode==='sealed'?{note:`Ranked run ${idx} of ${c.K*c.A}: slot ${slot} of ${c.K}, attempt ${attempt} of ${c.A}. Each slot keeps its best attempt, and your board score is the mean of the ${c.K} slot bests (empty slots count 0). Every attempt is a fresh hidden instance.`}:{note:handle?'Casual: public seed, solvable offline, not ranked.':'Casual: anonymous, public seed, not ranked. Add "handle" to claim a name and play ranked.'})});}

async function load(d:Deps,id:unknown){if(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))throw new HttpError(400,'session must be the 32-char id from /api/start');
 const raw=await d.redis.cmd('HGET','s:'+id,'json');if(!raw)throw new HttpError(404,'Session not found or expired. Start a new one.');return JSON.parse(raw);}

const RUN_TTL=7776000;
const FEED_MAX=30;
async function daily(d:Deps,sess:any,g:Game,h:string,pk:string,lh:string,score:number){const today=dayKey(d.now());if(dailyGame(d.now()).id!==g.id)return;
 const [dd,ds,db]=await d.redis.pipe([['HGET',pk,'dd'],['HGET',pk,'ds'],['HGET',pk,'db']]) as (string|null)[];
 const cmds:Arg[][]=[['ZADD','dl:'+today,'GT',score,h],['EXPIRE','dl:'+today,259200]];
 if(dd!==today){const y=dayKey(d.now()-86400000);const n=dd===y?Number(ds||0)+1:1;cmds.push(['HSET',pk,'dd',today,'ds',n,'db',Math.max(n,Number(db||0))]);}
 await d.redis.pipe(cmds);}
async function record(d:Deps,sess:any,g:Game,score:number){const c=cfg(d.env);const h=sess.handle;
 if(!h||sess.mode!=='sealed'){await d.redis.cmd('HINCRBY','st2','f:'+g.id,1);return;}
await touch(d,h,sess.th);
 const lh=h.toLowerCase(),rk=`r:${sess.season}:${g.id}:${lh}`,pk=`pf:${sess.season}:${lh}`,slot=String(sess.slot??sess.idx);
 const [prev,bestRaw]=await d.redis.pipe([['HGET',rk,slot],['HGET',pk,'b:'+g.id]]);
 if(prev===null||score>Number(prev))await d.redis.cmd('HSET',rk,slot,score);
 const all=flat(await d.redis.cmd('HGETALL',rk));let sum=0;for(let i=1;i<=c.K;i++)sum+=Number(all[String(i)]||0);const mean=Math.round(sum/c.K*10)/10;
 const run={id:sess.id,handle:h,game:g.id,slot:Number(slot),attempt:sess.attempt??1,score,turns:(sess.state as State).turns,ts:d.now(),moves:sess.moves,final:sess.state,seed:sess.seed};
 const brief={id:sess.id,game:g.id,slot:run.slot,attempt:run.attempt,score,turns:run.turns,ts:run.ts};
 await d.redis.pipe([['ZADD',`lb:${sess.season}:${g.id}`,mean,h],['HSET',pk,'handle',h,'s:'+g.id,mean],['HINCRBY',pk,'n:'+g.id,1],['HINCRBY','st2','f:'+g.id,1],
  ...(bestRaw===null||score>Number(bestRaw)?[['HSET',pk,'b:'+g.id,score]]:[]),
  ['LPUSH',`hist:${sess.season}:${lh}`,JSON.stringify(brief)],['LTRIM',`hist:${sess.season}:${lh}`,0,49],['SET','run:'+sess.id,JSON.stringify(run),'EX',RUN_TTL],['LPUSH','feed',JSON.stringify({id:run.id,h,g:g.id,s:score,t:run.turns,ts:run.ts})],['LTRIM','feed',0,FEED_MAX-1]]);
 await daily(d,sess,g,h,pk,lh,score);
 const pf=flat(await d.redis.cmd('HGETALL',pk));let total=0;for(const [k,v] of Object.entries(pf))if(k.startsWith('s:'))total+=Number(v);
 await d.redis.cmd('ZADD',`ov:${sess.season}`,Math.round(total*10)/10,h);}

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
 return view(g,sess,{...(final?{final:true,recorded:true,finalScore:score,...(sess.handle&&sess.mode==='sealed'&&!sess.aborted?{rateIt:`How was ${g.name}? Rate it 1-10: POST /api/rate {"key":"<playKey>","game":"${g.id}","rating":8} (or GET /api/text/rate?key=KEY&game=${g.id}&rating=8). The average shows on the site.`}:{})}:{}),...(sess.aborted?{note:'Session ended: too many illegal moves. Score 0.'}:{})});}

async function session(d:Deps,req:Req){const sess=await load(d,req.query.session);return view(games.find(x=>x.id===sess.game)!,sess);}

async function me(d:Deps,req:Req){const c=cfg(d.env);const handle=await auth(d,req);const lh=handle.toLowerCase();
 const out=await d.redis.pipe(games.flatMap(g=>[['GET',`n:${c.season}:${lh}:${g.id}`],['HGETALL',`r:${c.season}:${g.id}:${lh}`]]));
 const prog:Record<string,unknown>={};games.forEach((g,i)=>{const used=Number(out[i*2]||0);const sl=flat(out[i*2+1]);const slots:Record<string,number>={};for(const [k,v] of Object.entries(sl))slots[k]=Number(v);
  prog[g.id]={runsUsed:Math.min(used,c.K*c.A),runsMax:c.K*c.A,slots,score:Math.round(Object.values(slots).reduce((a,b)=>a+b,0)/c.K*10)/10};});
 return {handle,season:c.season,slotsPerGame:c.K,attemptsPerSlot:c.A,ranked:prog};}

async function profile(d:Deps,req:Req){const c=cfg(d.env);const handle=String(req.query.handle||'');if(!HANDLE.test(handle))throw new HttpError(400,'handle=<name> required');const lh=handle.toLowerCase();
 let [pf,hist]=await d.redis.pipe([['HGETALL',`pf:${c.season}:${lh}`],['LRANGE',`hist:${c.season}:${lh}`,0,19]]) as any[];let rank:any=null;let f=flat(pf);const act=await d.redis.cmd('ZSCORE','act',lh);if(act!==null&&act!==undefined&&Number(act)<d.now()){await purge(d,handle);throw new HttpError(404,'No such handle (handles expire after '+c.idleDays+' days without play).');}
 if(Object.keys(f).length&&(act===null||act===undefined))await d.redis.cmd('ZADD','act','NX',d.now()+c.idleDays*86400000,lh);
 if(!Object.keys(f).length){const hh=await d.redis.cmd('GET','h:'+lh);if(!hh)throw new HttpError(404,'No such handle.');
  const zs=await d.redis.pipe(games.map(g=>['ZSCORE',`lb:${c.season}:${g.id}`,handle]));// lazy rebuild for handles that played before profiles existed
  const set:Arg[]=['handle',handle];zs.forEach((z,i)=>{if(z!==null&&z!==undefined)set.push('s:'+games[i].id,z as any);});if(set.length>2)await d.redis.cmd('HSET',`pf:${c.season}:${lh}`,...set);f=flat(set.length>2?await d.redis.cmd('HGETALL',`pf:${c.season}:${lh}`):[]);}
 rank=await d.redis.cmd('ZREVRANK',`ov:${c.season}`,f.handle||handle);
 const pb=await policyBoard(d);const gm:Record<string,unknown>={};let total=0;for(const g of games){const s=f['s:'+g.id];if(s===undefined)continue;total+=Number(s);gm[g.id]={score:Number(s),tier:tierOf(tierBounds(pb.games[g.id]),Number(s)),best:f['b:'+g.id]!==undefined?Number(f['b:'+g.id]):undefined,runs:f['n:'+g.id]!==undefined?Number(f['n:'+g.id]):undefined};}
 return {handle:f.handle||handle,season:c.season,total:Math.round(total*10)/10,overviewRank:typeof rank==='number'?rank+1:null,...streakOf(f,d.now()),games:gm,recent:(hist as string[]||[]).map(x=>JSON.parse(x))};}

function streakOf(f:Record<string,string>,now:number){const t=dayKey(now),y=dayKey(now-86400000);const live=f.dd===t||f.dd===y;return {streak:live?Number(f.ds||0):0,bestStreak:Number(f.db||0),dailyDoneToday:f.dd===t};}
async function runView(d:Deps,req:Req){const id=req.query.id;if(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))throw new HttpError(400,'id=<run id> required (from a profile\'s recent runs)');
 const raw=await d.redis.cmd('GET','run:'+id);if(!raw)throw new HttpError(404,'Run not found or expired (runs are kept 90 days).');const r=JSON.parse(raw);const g=games.find(x=>x.id===r.game)!;
 let frames:unknown[]|undefined;if(g&&typeof r.seed==='number'&&r.moves.length<=120){try{let st=g.init(r.seed);frames=[observe(g,st)];for(const m of r.moves){st=advance(g,st,m);frames.push(observe(g,st));}if(g.score(st)!==r.score)frames=undefined;}catch{frames=undefined;}}
 const pb=await policyBoard(d);
 return {id:r.id,handle:r.handle,game:r.game,slot:r.slot,attempt:r.attempt,score:r.score,turns:r.turns,ts:r.ts,tier:tierOf(tierBounds(pb.games[r.game]),r.score),moves:r.moves,final:g?observe(g,r.final):r.final,...(frames?{frames}:{})};}
async function feed(d:Deps){const raw=await d.redis.cmd('LRANGE','feed',0,19) as string[]||[];let rows=raw.map(x=>{const o=JSON.parse(x);return {id:o.id,handle:o.h,game:o.g,score:o.s,turns:o.t,ts:o.ts};});
 rows=(await liveRows(d,rows.map(r=>({...r})))).slice(0,20);return {note:'Latest finished ranked runs, newest first. Cached about a minute.',rows};}
async function dailyView(d:Deps){const t=dayKey(d.now());const g=dailyGame(d.now());const r=await d.redis.cmd('ZREVRANGE','dl:'+t,0,9,'WITHSCORES') as string[]||[];let rows:any[]=[];for(let i=0;i<r.length;i+=2)rows.push({handle:r[i],score:Number(r[i+1])});rows=(await liveRows(d,rows)).map((x,i)=>({rank:i+1,...x}));
 const next=new Date(d.now());next.setUTCHours(24,0,0,0);
 return {date:t,game:g.id,name:g.name,rules:g.description,moveFormat:moveFormat(g.id),nextResetUtc:next.toISOString(),howItWorks:'Finish any ranked run of today\'s game (UTC day) to keep your streak. Miss a whole UTC day and it resets to 1. Streaks expire with the handle after 14 idle days.',rows};}
function svg(body:string,maxAge:number,status=200):Res{return {status,headers:{'content-type':'image/svg+xml; charset=utf-8','cache-control':`public, max-age=300, s-maxage=${maxAge}, stale-while-revalidate=600`,...CORS},body};}
async function badgeView(d:Deps,req:Req):Promise<Res>{const h=String(req.query.handle||'').replace(/\.svg$/i,'');if(!HANDLE.test(h))return svg(badge('instinct','bad handle','#6b7280'),60,400);
 const game=String(req.query.game||'').replace(/\.svg$/i,'');let p:any;try{p=await profile(d,{...req,query:{handle:h}});}catch(e:any){if(e instanceof HttpError)return svg(badge('instinct','not found','#6b7280'),300,404);throw e;}
 if(game){const g=games.find(x=>x.id===game);const gs=g&&p.games[game];if(!g)return svg(badge('instinct','unknown game','#6b7280'),60,400);if(!gs)return svg(badge(g.name,'unplayed','#6b7280'),300);const t=gs.tier;return svg(badge(g.name,`${gs.score}${t&&t!=='none'?' '+t:''}`,TIER_COLOR[t||'none']),3600);}
 return svg(badge('instinct',`${p.total}${p.overviewRank?' #'+p.overviewRank:''}${p.streak>1?' '+p.streak+'d':''}`,'#6fae1a'),3600);}
async function runCard(d:Deps,req:Req):Promise<Res>{const r=await runView(d,{...req,query:{id:String(req.query.run||req.query.id||'')}});const g=games.find(x=>x.id===r.game);
 return svg(card({game:g?g.name:r.game,handle:r.handle,score:r.score,turns:r.turns,tier:r.tier,slot:r.slot}),86400);}
async function sharePage(d:Deps,req:Req,base:string):Promise<Res>{const id=String(req.query.run||req.query.id||'');const r=await runView(d,{...req,query:{id}});const g=games.find(x=>x.id===r.game);
 const title=`${r.handle} scored ${r.score} on ${g?g.name:r.game} | INSTINCT`;const desc=`${r.turns} moves, verified server-side${r.tier&&r.tier!=='none'?`, ${r.tier} tier`:''}. Agent arcade with public leaderboards.`;
 const html=`<!doctype html><html><head><meta charset="utf-8"><title>${xml(title)}</title><meta property="og:title" content="${xml(title)}"><meta property="og:description" content="${xml(desc)}"><meta property="og:image" content="${base}/api/card?run=${id}"><meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image"><meta http-equiv="refresh" content="0;url=/#/run/${id}"><link rel="canonical" href="${base}/r/${id}"></head><body><a href="/#/run/${id}">${xml(title)}</a></body></html>`;
 return {status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, s-maxage=86400',...CORS},body:html};}


async function overview(d:Deps){const c=cfg(d.env);const [r,p]=await Promise.all([d.redis.cmd('ZREVRANGE',`ov:${c.season}`,0,14,'WITHSCORES') as Promise<string[]>,policyBoard(d)]);
 let rows:any[]=[];for(let i=0;i<r.length;i+=2)rows.push({handle:r[i],score:Number(r[i+1])});
 await prune(d);rows=await liveRows(d,rows);
 const refs:Record<string,number>={};for(const g of games)for(const x of p.games[g.id]??[])refs[x.agent]=(refs[x.agent]||0)+x.mean;
 for(const [handle,score] of Object.entries(refs))rows.push({handle,score:Math.round(score*10)/10,reference:true});
 rows=rows.sort((a,b)=>b.score-a.score||a.handle.localeCompare(b.handle)).slice(0,10).map((x,i)=>({rank:i+1,...x}));
 return {season:c.season,games:games.length,note:'Total = sum of each agent\'s per-game ranked scores. Rows marked reference are CI policies on hidden seeds (the bar to beat).',rows};}

async function leaderboard(d:Deps,req:Req){const c=cfg(d.env);const gid=req.query.game;const g=games.find(x=>x.id===gid);if(!g)throw new HttpError(400,'game=<id> required',{games:games.map(x=>x.id)});
 const board=req.query.board==='policies'?'policies':'sealed';let key:string,meta:any;
 if(board==='policies'){const p=await policyBoard(d);const rows=(p.games[g.id]??[]).slice(0,25).map((r,i)=>({rank:i+1,handle:r.agent,score:r.mean}));
  return {game:g.id,board,season:p.season,seeds:p.seeds,commitment:p.commitment,note:`Submitted policies (policies/<handle>.mjs), mean over ${p.seeds} hidden seeds, evaluated in sandboxed CI.`,rows};}
 {key=`lb:${c.season}:${g.id}`;meta={board:'ranked',season:c.season,seeds:c.K,note:`Ranked: mean of your ${c.K} slot-best scores (each slot keeps its best of ${c.A} attempts on fresh hidden instances; empty slots count 0).`};}

 const r=await d.redis.cmd('ZREVRANGE',key,0,24,'WITHSCORES') as string[];let rows:any[]=[];for(let i=0;i<r.length;i+=2)rows.push({handle:r[i],score:Number(r[i+1])});
 await prune(d);rows=await liveRows(d,rows);
 {const p=await policyBoard(d);const refs=(p.games[g.id]??[]).map(x=>({handle:x.agent,score:x.mean,reference:true}));
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
 const n=await purge(d,handle);
 let cursor='0';const extra:Arg[][]=[];do{const r=await d.redis.cmd('SCAN',cursor,'MATCH','lbp:*','COUNT',1000) as [string,string[]];cursor=String(r[0]);for(const k of r[1])extra.push(['ZREM',k,handle]);}while(cursor!=='0');if(extra.length)await d.redis.pipe(extra);
 return {deleted:handle,commands:n+extra.length,note:'Handle, play key, ranked board entries, profile and history removed. Counters in /api/stats are not rewound.'};}

// ---------- ratings: a handle that has finished a ranked run of a game this season may rate it 1-10 (one per handle per game; re-rating replaces it) ----------
async function rate(d:Deps,req:Req){const c=cfg(d.env);const [handle,th]=await authFull(d,req);const lh=handle.toLowerCase();
 const gid=req.body?.game??req.query.game;const g=games.find(x=>x.id===gid);if(!g)throw new HttpError(400,'game=<id> required',{games:games.map(x=>x.id)});
 const rating=Number(req.body?.rating??req.query.rating);if(!Number.isInteger(rating)||rating<1||rating>10)throw new HttpError(400,'rating must be a whole number from 1 to 10');
 const played=Number(await d.redis.cmd('HLEN',`r:${c.season}:${g.id}:${lh}`))>0;if(!played)throw new HttpError(403,`Finish a ranked run of ${g.id} this season before rating it.`);
 await d.redis.cmd('HSET','rt:'+g.id,lh,rating);await touch(d,handle,th);
 return {handle,game:g.id,rating,...(await ratings(d))[g.id]};}
async function ratings(d:Deps):Promise<Record<string,{avg:number|null;count:number}>>{const vals=await d.redis.pipe(games.map(g=>['HVALS','rt:'+g.id])) as (string[]|null)[];
 return Object.fromEntries(games.map((g,i)=>{const v=(vals[i]||[]).map(Number).filter(x=>x>=1&&x<=10);return [g.id,{avg:v.length?Math.round(v.reduce((a,b)=>a+b,0)/v.length*10)/10:null,count:v.length}];}));}
function gamesList(){return {games:games.map(g=>({id:g.id,name:g.name,category:g.category,maxTurns:g.maxTurns,openBook:!!g.openBook,rules:g.description,moveFormat:moveFormat(g.id)}))};}
function moveFormat(id:string){return ({signal:'4 digits, each 0-3, e.g. "1020"',gridshift:'index (0-8) of the tile to slide into the gap, as a string',vault:'one of up, down, left, right, extract',handshake:'"C" (cooperate) or "D" (defect)',radar:'"row,col" with 0-7, e.g. "3,4"',heaps:'"heap:count", e.g. "2:3"',fourrows:'column 0-6 as a string',courier:'stop index 0-23 as a string',minefield:'"row,col" with 0-7, e.g. "3,4"',lights:'cell index 0-24 as a string',prospector:'claim index 0-5 as a string',nextterm:'a whole number 0-999 as a string, e.g. "42"'} as Record<string,string>)[id]??'see legalMoves';}

// ---------- plain-text mirror for fetch-only agents ----------
function text(base:string,action:string,r:any){const L:string[]=[];
 const mv=(r.legalMoves as string[]|null|undefined);
 if(action==='games'){L.push('INSTINCT games. Pick a game and play. No sign-up.','');for(const g of r.games)L.push(`- ${g.id}: ${g.rules}\n  moves: ${g.moveFormat}${g.rating?.count?`   rated ${g.rating.avg}/10 by ${g.rating.count}`:''}`);L.push('',`NEXT (ranked): GET ${base}/api/text/start?handle=YOUR-NAME&game=GAME&mode=ranked  (claims the handle, returns a play key)`,`Or casual, anonymous: GET ${base}/api/text/start?game=GAME`);}
 else if(action==='register'||action==='claim'){L.push(`Handle claimed: ${r.handle}`,`PLAY KEY: ${r.playKey}`,'Shown once.','',`NEXT: GET ${base}/api/text/start?key=${r.playKey}&game=signal&mode=ranked`);}
 else if(action==='start'||action==='move'||action==='session'){L.push(`game: ${r.game}   mode: ${r.mode}${r.slot?` (slot ${r.slot} of ${r.of}, attempt ${r.attempt})`:` seed ${r.seed}`}`,`turn: ${r.turn}   ${r.done?'FINISHED':'in progress'}   score: ${r.score}`);if(r.playKey)L.push('',`Handle claimed: ${r.handle}`,`PLAY KEY (shown once, keep it): ${r.playKey}`,`Next start as this handle: GET ${base}/api/text/start?key=${r.playKey}&game=GAME&mode=ranked`);if(r.note)L.push(r.note);L.push('',r.description,'','observation: '+JSON.stringify(r.observation));
  if(r.done)L.push('',r.recorded?`FINAL SCORE ${r.finalScore} recorded.`:'Finished.',`Board: GET ${base}/api/text/board?game=${r.game}   Top agents: GET ${base}/api/text/overview`);
  else{L.push('legal moves: '+(mv?mv.join(' '):`${r.legalMovesCount} options, e.g. ${(r.legalMovesSample||[]).join(' ')}. Rule: ${r.moveRule}`),'',`NEXT: GET ${base}/api/text/move?session=${r.session}&move=MOVE`);}}
 else if(action==='board'){L.push(`${r.game} leaderboard (${r.board})`,r.note,'');for(const x of r.rows)L.push(`${x.rank}. ${x.handle}  ${x.score}${x.reference?'  (reference policy)':''}`);if(!r.rows.length)L.push('(no entries yet)');}
 else if(action==='me'){L.push(`handle: ${r.handle}  season: ${r.season}  (${r.slotsPerGame} slots x ${r.attemptsPerSlot} attempts per game)`);for(const [g,p] of Object.entries<any>(r.ranked))L.push(`${g}: runs ${p.runsUsed}/${p.runsMax}, score ${p.score}, slot bests ${JSON.stringify(p.slots)}`);}
 else if(action==='overview'){L.push(`Top agents, season ${r.season} (sum of per-game ranked scores)`,'');for(const x of r.rows)L.push(`${x.rank}. ${x.handle}  ${x.score}${x.reference?'  (reference policy)':''}`);if(!r.rows.length)L.push('(no entries yet)');}
 else if(action==='profile'){L.push(`${r.handle}  total ${r.total}  overview rank ${r.overviewRank??'-'}`);for(const [g,p] of Object.entries<any>(r.games))L.push(`${g}: score ${p.score}${p.best!==undefined?`, best run ${p.best}`:''}${p.runs!==undefined?`, ${p.runs} runs`:''}`);L.push('','recent runs (GET '+base+'/api/text/run?id=ID):');for(const x of r.recent.slice(0,10))L.push(`${x.game} slot ${x.slot} attempt ${x.attempt}: ${x.score}  id ${x.id}`);}
 else if(action==='run'){L.push(`${r.handle} ${r.game} slot ${r.slot} attempt ${r.attempt}: ${r.score} in ${r.turns} moves`,'moves: '+(r.moves as string[]).join(' '));}
 else if(action==='rate'){L.push(`Rated ${r.game} ${r.rating}/10 as ${r.handle}. Average now ${r.avg} from ${r.count} rating${r.count===1?'':'s'}.`);}
 else if(action==='ratings'){L.push('Game ratings (1-10, from agents who finished a ranked run):','');for(const [g,v] of Object.entries<any>(r.ratings))L.push(`${g}: ${v.avg??'-'} (${v.count})`);}
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
  const cache={'cache-control':'public, s-maxage=300, stale-while-revalidate=600'};
  // Vercel rewrites keep the original path, so /agents.md and /llms.txt arrive here unchanged.
  if(path==='/agents'||path==='/agents.md'||path==='/llms.txt'||path==='/'&&!isText)return plain(200,agentsTemplate.replaceAll('{{BASE}}',base),{'cache-control':'public, s-maxage=300'});
  const post=req.method==='POST'||isText;
  let result:any,action=path.slice(1),headers:Record<string,string>={};
  switch(path){
   case '/games':{const rt=await ratings(d);result={games:gamesList().games.map(x=>({...x,rating:rt[x.id]}))};headers={'cache-control':'public, s-maxage=120, stale-while-revalidate=300'};break;}
   case '/ratings':result={ratings:await ratings(d),rule:'Agents rate games 1-10 after finishing a ranked run of them. One rating per handle per game.'};headers={'cache-control':'public, s-maxage=120, stale-while-revalidate=300'};break;
   case '/rate':if(!post)throw new HttpError(405,'POST {"key":"...","game":"...","rating":1-10}');result=await rate(d,req);break;
   case '/leaderboard':case '/board':action='board';result=await leaderboard(d,req);headers=cache;break;
   case '/policies':{const pb=await policyBoard(d);result={...pb,tiers:Object.fromEntries(games.map(g=>[g.id,tierBounds(pb.games[g.id])])),tierRule:'Gold >= best reference mean, Silver >= 75% of it, Bronze >= 50%.'};}headers=cache;break;
   case '/overview':result=await overview(d);headers={'cache-control':'public, s-maxage=120, stale-while-revalidate=300'};break;
   case '/profile':result=await profile(d,req);headers={'cache-control':'public, s-maxage=120, stale-while-revalidate=300'};break;
   case '/run':result=await runView(d,req);headers={'cache-control':'public, s-maxage=86400'};break;
   case '/feed':result=await feed(d);headers={'cache-control':'public, s-maxage=60, stale-while-revalidate=300'};break;
   case '/daily':result=await dailyView(d);headers={'cache-control':'public, s-maxage=120, stale-while-revalidate=300'};break;
   case '/badge':return await badgeView(d,req);
   case '/card':return await runCard(d,req);
   case '/share':return await sharePage(d,req,base);
   case '/stats':result=await stats(d);headers={'cache-control':'public, s-maxage=120, stale-while-revalidate=300'};break;
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
  const limited=!(e instanceof HttpError)&&/max (daily )?(request|command)|limit exceeded|quota/i.test(String(e?.message));
  const status=e instanceof HttpError?e.status:limited?503:500;const msg=e instanceof HttpError?e.message:limited?'Storage capacity reached for now. Reads of cached pages still work; try again later.':'Server error';
  if(!(e instanceof HttpError))console.error('instinct api error',e?.message);
  return isText?plain(status,`ERROR ${status}: ${msg}\n${e.extra?.legalMoves?`legal moves: ${(e.extra.legalMoves as string[]).join(' ')}\n`:e.extra?.moveRule?`move rule: ${e.extra.moveRule}\n`:''}`):json(status,{error:msg,...(e instanceof HttpError?e.extra:{})});}
}
