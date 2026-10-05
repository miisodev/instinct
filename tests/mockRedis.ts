// In-memory Redis implementing exactly the commands server/core.ts uses (including the one CAS script, matched by text).
import {CAS_SCRIPT} from '../server/core.ts';
export function mockRedis(){
 const kv=new Map<string,any>();const exp=new Map<string,number>();let cmds=0;
 const get=(k:string)=>kv.get(k);
 const z=(k:string)=>{if(!kv.has(k))kv.set(k,new Map<string,number>());return kv.get(k) as Map<string,number>;};
 const h=(k:string)=>{if(!kv.has(k))kv.set(k,new Map<string,string>());return kv.get(k) as Map<string,string>;};
 async function cmd(...a:(string|number)[]):Promise<any>{cmds++;const [c,...r]=a.map((x,i)=>i===0?String(x).toUpperCase():x);const s=r.map(String);
  switch(c){
   case 'GET':return get(s[0])??null;
   case 'SET':{if(s.includes('NX')&&kv.has(s[0]))return null;kv.set(s[0],s[1]);return 'OK';}
   case 'INCR':{const n=Number(get(s[0])??0)+1;kv.set(s[0],String(n));return n;}
   case 'DEL':{let n=0;for(const k of s)if(kv.delete(k))n++;return n;}
   case 'ZREM':{const m=kv.get(s[0]) as Map<string,number>|undefined;return m?.delete(s[1])?1:0;}
   case 'SCAN':{const pre=s[2].replace('*','');return ['0',[...kv.keys()].filter(k=>k.startsWith(pre))];}
   case 'LPUSH':{const l=(kv.get(s[0]) as string[]|undefined)??[];l.unshift(s[1]);kv.set(s[0],l);return l.length;}
   case 'LTRIM':{const l=kv.get(s[0]) as string[]|undefined;if(l)kv.set(s[0],l.slice(Number(s[1]),Number(s[2])+1));return 'OK';}
   case 'LRANGE':{const l=(kv.get(s[0]) as string[]|undefined)??[];return l.slice(Number(s[1]),Number(s[2])+1);}
   case 'ZSCORE':{const v=(kv.get(s[0]) as Map<string,number>|undefined)?.get(s[1]);return v===undefined?null:String(v);}
   case 'ZREVRANK':{const m=kv.get(s[0]) as Map<string,number>|undefined;if(!m||!m.has(s[1]))return null;const rows=[...m.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));return rows.findIndex(x=>x[0]===s[1]);}
   case 'EXPIRE':exp.set(s[0],Number(s[1]));return 1;
   case 'HSET':{const m=h(s[0]);for(let i=1;i<s.length;i+=2)m.set(s[i],s[i+1]);return 1;}
   case 'HGET':return (kv.get(s[0]) as Map<string,string>|undefined)?.get(s[1])??null;
   case 'HVALS':return [...((kv.get(s[0]) as Map<string,string>|undefined)?.values()??[])];
   case 'HGETALL':return [...((kv.get(s[0]) as Map<string,string>|undefined)?.entries()??[])].flat();
   case 'HINCRBY':{const m=h(s[0]);const n=Number(m.get(s[1])??0)+Number(s[2]);m.set(s[1],String(n));return n;}
   case 'ZADD':{const m=z(s[0]);let i=1,gt=false,nx=false;while(s[i]==='GT'||s[i]==='NX'){if(s[i]==='GT')gt=true;else nx=true;i++;}const score=Number(s[i]),mem=s[i+1];if(nx&&m.has(mem))return 0;if(!gt||!m.has(mem)||score>m.get(mem)!)m.set(mem,score);return 1;}
   case 'ZMSCORE':{const m=kv.get(s[0]) as Map<string,number>|undefined;return s.slice(1).map(x=>m?.has(x)?String(m.get(x)):null);}
   case 'ZRANGEBYSCORE':{const m=(kv.get(s[0]) as Map<string,number>|undefined)??new Map();const hi=Number(s[2]);const lim=s[3]==='LIMIT'?Number(s[5]):1e9;return [...m.entries()].filter(x=>x[1]<=hi).sort((a,b)=>a[1]-b[1]).slice(0,lim).map(x=>x[0]);}
   case 'ZREVRANGE':{const m=(kv.get(s[0]) as Map<string,number>|undefined)??new Map();const rows=[...m.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(Number(s[1]),Number(s[2])+1);return rows.flatMap(([k,v])=>[k,String(v)]);}
   case 'EVAL':{if(s[0]!==CAS_SCRIPT)throw new Error('unexpected script');const key=s[2];const m=kv.get(key) as Map<string,string>|undefined;if(m&&m.get('step')===s[3]){m.set('step',s[4]);m.set('json',s[5]);exp.set(key,Number(s[6]));return 1;}return 0;}
   default:throw new Error('mock: unsupported '+c);}}
 return {cmd,pipe:async(cs:(string|number)[][])=>{const out=[];for(const c of cs)out.push(await cmd(...c));return out;},kv,exp,count:()=>cmds};
}
