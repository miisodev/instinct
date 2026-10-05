// Runs inside a locked-down child process (node --permission: no fs writes, no network, no child processes, no workers, empty env).
// Protocol: one JSON observation per stdin line -> one move string per stdout line.
import {createInterface} from 'node:readline';
const policy=(await import(process.argv[2])).default;
const rl=createInterface({input:process.stdin});
for await(const line of rl){let m;try{m=String(await policy(JSON.parse(line)));}catch(e){m='__error__';}process.stdout.write(JSON.stringify(m)+'\n');}
