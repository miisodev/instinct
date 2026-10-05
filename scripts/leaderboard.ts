import {readFileSync,readdirSync,writeFileSync} from 'node:fs';import {validateReplay} from '../src/engine.ts';import {games} from '../src/games/index.ts';
const rows=readdirSync('results').filter(x=>x.endsWith('.json')).map(file=>{const {state,...row}=validateReplay(JSON.parse(readFileSync(`results/${file}`,'utf8')),games);return {...row,file};});
const best=new Map<string,typeof rows[0]>();for(const r of rows){const k=`${r.game}/${r.version}/${r.seed}/${r.agent}`;const o=best.get(k);if(!o||r.score>o.score||(r.score===o.score&&r.turns<o.turns))best.set(k,r);}
rows.length=0;rows.push(...best.values());
rows.sort((a,b)=>b.score-a.score||a.turns-b.turns||a.agent.localeCompare(b.agent));writeFileSync('public/leaderboard.json',JSON.stringify(rows,null,2)+'\n');console.log(`Built ${rows.length} verified entries`);
