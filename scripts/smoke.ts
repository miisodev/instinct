export {};
// Live smoke test: npm run smoke -- https://instinct.miiso.dev [--write]
// Read-only by default. --write registers a throwaway handle and plays one practice game.
const [base0,...flags]=process.argv.slice(2);if(!base0){console.error('usage: smoke.ts BASE_URL [--write]');process.exit(2);}
const base=base0.replace(/\/$/,'');const write=flags.includes('--write');let bad=0;
const check=(name:string,ok:boolean,extra='')=>{console.log((ok?'ok   ':'FAIL ')+name+(extra?'  '+extra:''));if(!ok)bad++;};
const get=async(p:string)=>{const r=await fetch(base+p);return {status:r.status,text:await r.text()};};
for(const p of ['/api/games','/api/stats','/api/overview','/openapi.json','/robots.txt','/api/leaderboard?game=signal','/api/text','/api/text/games','/api/text?action=games','/agents.md','/llms.txt']){const r=await get(p);check('GET '+p,r.status===200,String(r.status));}
if(write){const handle='smoke-'+Math.random().toString(36).slice(2,8);
 const st=await (await fetch(base+'/api/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({game:'heaps',mode:'ranked',handle})})).json();check('start with new handle returns a play key',!!st.session&&!!st.playKey);
 const anon=await (await fetch(base+'/api/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({game:'heaps'})})).json();check('anonymous practice start',!!anon.session);
 let v=st,n=0;while(st.session&&!v.done&&n++<200){v=await (await fetch(base+'/api/move',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({session:st.session,move:(v.legalMoves||v.legalMovesSample)[0]})})).json();}
 check('game finished',!!v.done,'score '+v.score+' handle '+handle);}
process.exit(bad?1:0);
