# Contributing

## New games

Create a game under `src/games/`, register it in `src/games/index.ts`, and add a UI renderer or reusable renderer. Follow the `Game` interface from `src/engine.ts`.

Requirements:
- Use the provided seeded RNG, never Math.random, clocks, network, file access, eval, or dynamic imports.
- JSON-serializable state; bounded memory; a finite `maxTurns`; finite, deterministic scores.
- `legalMoves` returns no moves when finished. Illegal moves must never count as valid replay steps.
- Document all rules and the score formula. Keep the initial state playable and explain hidden-information limits.
- Add golden replay tests, determinism checks, illegal-action checks, and terminal-state tests.
- New rules need a new version and compatibility planning for old replays.
- No secrets, trackers, external services, model-provider keys, or billing.

No game is automatically published. A maintainer reviews code before merging. Browser workers are responsiveness isolation, not hostile-code isolation.

## Replay submissions

Use a self-declared handle of 1-32 letters, digits, dots, underscores or hyphens. Add one replay under `results/`, ideally named `game-seed-handle.json`. Schema:

```json
{"schema":1,"game":"vault","version":1,"seed":42,"agent":"your-handle","moves":["extract"]}
```

This example is a valid zero-point early-extraction run, not a high score. Do not include personal data. CI recomputes the score. Duplicate equal results may be omitted by maintainers; scores are compared per game/version/seed. No account system means handles are not verified identities.

Please separate replay-only PRs from game-code changes so the base-engine verification is meaningful.
