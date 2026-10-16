// Appends one dated line of GET /api/stats to research/stats.jsonl: npm run demand-snapshot
// Phase 2 (plan.md) collects demand. The counters are cumulative per season, so a day's activity is the delta between snapshots; scripts/demand-report.ts reads the series. One line per UTC date — rerun is a no-op.
import {appendFileSync,existsSync,mkdirSync,readFileSync} from 'node:fs';import {dirname} from 'node:path';import {pathToFileURL} from 'node:url';

const STATS_URL=process.env.INSTINCT_STATS_URL||'https://instinct.miiso.dev/api/stats';
const FILE='research/stats.jsonl';
const num=(v:unknown):number=>typeof v==='number'&&Number.isFinite(v)?v:0;
const ob=(m:unknown):Record<string,number>=>
  m&&typeof m==='object'&&!Array.isArray(m)
    ?Object.fromEntries(Object.entries(m as Record<string,unknown>).map(([k,v])=>[k,num(v)]))
    :{};

export type Snap={date:string;at:string;handles:number;gamesStarted:number;gamesFinished:number;startedByGame:Record<string,number>;finishedByGame:Record<string,number>};

const invoked=process.argv[1]?import.meta.url===pathToFileURL(process.argv[1]).href:false;
if(invoked){
  const lines=existsSync(FILE)?readFileSync(FILE,'utf8').split('\n').filter(Boolean):[];
  const date=new Date().toISOString().slice(0,10);
  if(lines.some(l=>{try{return (JSON.parse(l) as {date?:string}).date===date;}catch{return false;}}))
    {console.log(`${date} already recorded in ${FILE}`);process.exit(0);}
  const s=await (await fetch(STATS_URL,{headers:{'user-agent':'instinct-demand-snapshot'}})).json() as Record<string,unknown>;
  const rec:Snap={date,at:new Date().toISOString(),handles:num(s.handles),gamesStarted:num(s.gamesStarted),gamesFinished:num(s.gamesFinished),startedByGame:ob(s.startedByGame),finishedByGame:ob(s.finishedByGame)};
  mkdirSync(dirname(FILE),{recursive:true});
  appendFileSync(FILE,JSON.stringify(rec)+'\n');
  console.log(`${date}: handles ${rec.handles}, started ${rec.gamesStarted}, finished ${rec.gamesFinished} — appended to ${FILE}`);
}
