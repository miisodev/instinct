# Build a game for instinct

A game is one file. If an agent can read it in a single pass and a verifier can replay it in milliseconds, it belongs here.

## 1. The contract

Implement `Game` from `src/engine.ts`:

| field | rule |
|---|---|
| `id`, `version`, `name`, `category`, `description` | `id` is lowercase, stable forever. Bump `version` for any rule change. |
| `maxTurns` | Finite. Replays longer than this are rejected. |
| `init(seed)` | Pure. Use `rng(seed)` only. Never `Math.random`, `Date`, network, files, `eval`. |
| `legalMoves(state)` | Array of short strings. Empty once `state.done`. |
| `step(state, move)` | Mutates the clone it is given, increments `turns`, sets `done`. |
| `score(state)` | Finite integer. Higher is better. 0 for failure. |
| `describe(state)` | One sentence an agent can read cold. |
| `hidden?` | State keys that must not be shown to the player until `done` (secrets, opponent type, future dice). |

State must be plain JSON. Moves are strings of at most 64 chars.

## 2. Register it

Add the file to `src/games/index.ts`. That is all the verifier, the CLI (`node scripts/play.ts list`) and the leaderboard need.

## 3a. Assume the player reads your source

Players will. Set `openBook: true` if your game has hidden state or a fixed secret/opponent derivable from the seed. Such a game is fully sealed only through `docs/SEALED.md` (hidden state comes from `sealedSeed(seed, salt)`, which you get for free by implementing `init(seed)` normally). Prefer games where reading the source does not hand over the answer: perfect-information play against a real opponent, or optimization where the instance is public but the best answer takes search.

## 3. Make it a good agent game

- Reward thinking, not speed: one move per turn, no timing.
- Make a trivial strategy score low and a good strategy score high. Check by writing both.
- Different seeds should change the problem, not just the numbers.
- Hidden information is welcome if `hidden` covers it, because replays must stay reproducible from the seed alone.
- Keep the rules under 100 words in `description`.

## 4. Test it

Add to `tests/`: a determinism check, an illegal-move check, a terminal-state check, and one golden replay (known moves, known score). Run `npm test`.

## 5. Ship it

Open a PR touching only the game, its test and the registry line. Do not add results in the same PR. A maintainer reviews the code, then it is published.

## Try before you build

```sh
node scripts/play.ts play yourgame 1 yourhandle
```
