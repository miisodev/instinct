import test from 'node:test';import assert from 'node:assert/strict';import {compute,parse} from '../scripts/demand-report.ts';import type {Snap} from '../scripts/demand-snapshot.ts';

const snap=(d:string,handles:number,started:number,finished:number,by:Record<string,number>={},fin:Record<string,number>={}):Snap=>({date:d,at:d,handles,gamesStarted:started,gamesFinished:finished,startedByGame:by,finishedByGame:fin});
const first=snap('2026-10-16',12,1000,900,{signal:100,vault:200},{signal:80,vault:150});
const last=snap('2026-10-31',20,1463,1401,{signal:180,vault:210},{signal:160,vault:175});

test('demand report computes the two-week window from differing snapshots',()=>{
  const r=compute([first,last]); // 2026-10-16 → 2026-10-31, 15 days apart
  assert.equal(r.snapshots,2);assert.equal(r.resets.length,0);
  assert.equal(r.covered,true);assert.equal(r.message,'window spans at least two weeks');
  const s=r.segments[0];
  assert.equal(s.started,463);assert.equal(s.finished,501);assert.equal(s.ratio,1.08);
  assert.equal(s.handlesFirst,12);assert.equal(s.handlesLast,20);
  assert.deepEqual(s.perGame.map(g=>g.id),['signal','vault']);
  assert.equal(s.perGame[0].started,80);assert.equal(s.perGame[0].finished,80);assert.equal(s.perGame[0].ratio,1);
  assert.equal(s.perGame[1].started,10);assert.equal(s.perGame[1].finished,25);assert.equal(s.perGame[1].ratio,2.5);
});

test('demand report covers at fourteen full days and not thirteen',()=>{
  assert.equal(compute([first,snap('2026-10-30',20,1400,1350)]).covered,true);
  assert.equal(compute([first,snap('2026-10-29',20,1400,1350)]).covered,false);
});

test('demand report splits the series at a season reset and reports each side',()=>{
  const r=compute([first,snap('2026-11-10',30,1500,1450),snap('2026-11-11',30,20,0),snap('2026-11-12',31,50,45)]);
  assert.deepEqual(r.resets,['2026-11-11']);
  assert.equal(r.segments.length,2);
  assert.equal(r.message,'season reset within the series — each segment reports separately');
  const s=r.segments[1];
  assert.equal(s.started,30);assert.equal(s.finished,45);assert.equal(s.ratio,1.5);
});

test('demand report tolerates bought records and parses strict json',()=>{
  const line=JSON.stringify(last);
  const p=parse(line+'\n'+line);
  assert.equal(p.length,2);assert.equal(p[0].startedByGame.signal,180);
  assert.throws(()=>parse('{"date":1}\n'));
});

test('demand report handles a game that started nothing and counter descent',()=>{
  const r=compute([first,snap('2026-10-31',20,1050,950,{signal:110,vault:210,heaps:0},{signal:85,vault:150})]);
  const s=r.segments[0];
  assert.equal(s.started,50);assert.equal(s.finished,50);assert.equal(s.ratio,1);
  const heaps=s.perGame.find(g=>g.id==='heaps')!;
  assert.equal(heaps.started,0);assert.equal(heaps.ratio,null);
});
