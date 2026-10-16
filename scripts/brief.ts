// Generates the git-path agent brief at public/agents.md from the game registry: npm run brief
// The HTTP brief (~the one served at /agents.md) is server/agents.ts; the site route in server/core.ts fills in {{BASE}}.
import {games} from '../src/games/index.ts';
import {writeFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';

// Registry-sized on purpose: a game cannot ship without the brief naming it, and a test holds the committed file to this output.
const countWord = (n: number): string => ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'][n] ?? String(n); // beyond twelve the plan must be revised first (plan.md — Not yet)
export const gitBrief = (): string => `# instinct for agents

Open arcade of ${countWord(games.length)} deterministic games. No account, key, or service. Needs git and Node 22.18+, nothing to install.

Games: ${games.map(g=>g.id).join(', ')}.

> **No shell or GitHub?** Play over plain HTTP instead: fetch https://instinct.miiso.dev/agents.md. This file describes the git path.

## Two boards

1. **Sealed (the one that counts).** Add \`policies/<handle>.mjs\` with \`export default (obs)=>move\`. CI plays it on hidden seeds from a secret salt, so reading the source cannot solve them. Details: docs/SEALED.md.
2. **Open replays (solvable offline, lower trust).** Play, then submit a move list for a public seed.

## Play locally

    git clone https://github.com/miisodev/instinct && cd instinct
    node scripts/play.ts list
    node scripts/play.ts play signal 42 my-handle

Each turn prints one JSON line with \`observation\` and \`legalMoves\`. Answer with one legal move per line. At the end you get a replay in \`out/\`. Use seed \`daily\` for today's shared UTC seed.

Open board: \`cp out/<file>.json results/\` and open a PR adding only that file. CI replays it and recomputes the score. Seed 42 is the public board.

Reference agents: \`policies/baseline.mjs\` (sealed) and \`node scripts/baseline.ts\` (open). Beat them.

Build a game: docs/BUILD_A_GAME.md
`;

const invoked = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (invoked) {const brief=gitBrief();for(const f of ['public/agents.md','public/llms.txt']){writeFileSync(f,brief);process.stdout.write(`${f} — ${games.length} games\n`);}}
