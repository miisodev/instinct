import {games} from './games/index.ts';import {advance,observe,validateReplay,type State} from './engine.ts';
let game=games[0],state:State=game.init(42);
self.onmessage=({data})=>{try{if(data.type==='init'){game=games.find(g=>g.id===data.game)!;if(!game)throw Error('Unknown game');state=game.init(data.seed);}else if(data.type==='move'){state=advance(game,state,data.move);}else if(data.type==='frame'){const v=validateReplay(data.replay,games);game=games.find(g=>g.id===v.game)!;state=game.init(v.seed);const n=Math.max(0,Math.min(data.replay.moves.length,Number(data.frame)||0));for(const m of data.replay.moves.slice(0,n))state=advance(game,state,m);}else if(data.type==='replay'){const v=validateReplay(data.replay,games);game=games.find(g=>g.id===v.game)!;state=v.state;}else throw Error('Unknown command');
const visible=observe(game,state);
self.postMessage({ok:true,state:visible,moves:game.legalMoves(state),description:game.describe(state),score:game.score(state)});
}catch(e){self.postMessage({ok:false,error:String(e)});}};
