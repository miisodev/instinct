// Reads research/stats.jsonl into the figures Phase 2 exits on (plan.md): handles, starts and finishes per game, and the ratio of finishes to starts, over at least two weeks: npm run demand-report
// Snapshots are cumulative per season, so every figure comes from deltas between them. A negative starts delta means a season reset — the series splits there and each side reports separately.
import {existsSync,readFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';
import type {Snap} from './demand-snapshot.ts';

export const parse=(text:string):Snap[]=>text.split('\n').filter(Boolean).map((l,i)=>{
  const r=JSON.parse(l) as Partial<Snap>;
  if(typeof r.date!=='string')throw new Error(`research/stats.jsonl line ${i+1}: missing date`);
  const ob=(m:unknown):Record<string,number>=>m&&typeof m==='object'&&!Array.isArray(m)?m as Record<string,number>:{};
  return {date:r.date,at:typeof r.at==='string'?r.at:'',handles:+r.handles!||0,gamesStarted:+r.gamesStarted!||0,gamesFinished:+r.gamesFinished!||0,startedByGame:ob(r.startedByGame),finishedByGame:ob(r.finishedByGame)};
});

export type Segment={from:string;to:string;snapshots:number;handlesFirst:number;handlesLast:number;started:number;finished:number;ratio:number|null;perGame:{id:string;started:number;finished:number;ratio:number|null}[]};
export type Report={snapshots:number;resets:string[];segments:Segment[];covered:boolean;message:string};

const ratio=(a:number,b:number):number|null=>a>0?+(b/a).toFixed(2):null;

export const compute=(xs:Snap[]):Report=>{
  const ys=[...xs].sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
  const resets:string[]=[],bounds:number[]=[0];
  for(let i=1;i<ys.length;i++)  // a season reset makes the cumulative counters shrink
    if(ys[i].gamesStarted<ys[i-1].gamesStarted||ys[i].gamesFinished<ys[i-1].gamesFinished){resets.push(ys[i].date);bounds.push(i);} // handles shrinking is ordinary expiry, not a reset
  bounds.push(ys.length);
  const segments:Segment[]=bounds.slice(0,-1).map((b,i)=>{
    const first=ys[b],last=ys[bounds[i+1]-1];
    const started=last.gamesStarted-first.gamesStarted,finished=last.gamesFinished-first.gamesFinished;
    const ids=[...new Set([...Object.keys(first.startedByGame),...Object.keys(last.startedByGame),...Object.keys(first.finishedByGame),...Object.keys(last.finishedByGame)])];
    const perGame=ids.map(id=>{
      const s=last.startedByGame[id]-(first.startedByGame[id]??0),f=last.finishedByGame[id]-(first.finishedByGame[id]??0);
      return {id,started:s,finished:f,ratio:ratio(s,f)};
    }).sort((a,b)=>b.started-a.started);
    return {from:first.date,to:last.date,snapshots:bounds[i+1]-b,handlesFirst:first.handles,handlesLast:last.handles,started,finished,ratio:ratio(started,finished),perGame};
  });
  const covered=ys.length>1?(new Date(ys[ys.length-1].date).getTime()-new Date(ys[0].date).getTime())/86400000>=14:false;
  const message=resets.length?`season reset${resets.length>1?'s':''} within the series — each segment reports separately`:covered?'window spans at least two weeks':'window is under two weeks';
  return {snapshots:ys.length,resets,segments,covered,message};
};

const print=(r:Report):void=>{
  console.log(`${r.snapshots} snapshot${r.snapshots===1?'':'s'} — ${r.message}.`);
  for(const s of r.segments){
    console.log(`\n${s.from} → ${s.to} (${s.snapshots} snapshots):`);
    console.log(`  handles ${s.handlesFirst} → ${s.handlesLast} · started +${s.started} · finished +${s.finished} · finish/start ${s.ratio===null?'—':s.ratio}`);
    for(const g of s.perGame)console.log(`  ${g.id}: started +${g.started}, finished +${g.finished}, finish/start ${g.ratio===null?'— (nothing started)':g.ratio}`);
  }
};

const invoked=process.argv[1]?import.meta.url===pathToFileURL(process.argv[1]).href:false;
if(invoked){
  const FILE=process.argv[2]||'research/stats.jsonl';
  if(!existsSync(FILE)){console.log(`${FILE} does not exist yet — run npm run demand-snapshot first.`);process.exit(1);}
  print(compute(parse(readFileSync(FILE,'utf8'))));
}
