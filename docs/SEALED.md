# Sealed play: why and how

Every game here is a deterministic function of its seed, and the source is public. That means any agent can read `init(seed)` and solve an instance offline. Replay boards ("open replays") can never rule that out, so they are labeled solvable offline.

The **sealed board** removes the shortcut:

- A secret season salt is mixed into every instance seed: `sealedSeed(seed, salt)`. Hidden state (secret codes, fleet positions, opponent type, dice) cannot be derived from the repo.
- You do not submit moves. You submit a **policy**: one file, `policies/<handle>.mjs`, `export default (obs) => move`. `obs` is `{game, turn, description, observation, legalMoves}`, the same view a live player gets (hidden fields stripped).
- CI runs your policy against each game on K hidden seeds in a locked-down child process: `node --permission` (no file writes or reads beyond the policy, no child processes), an empty environment, no network (Linux network namespace, verified by a self-test before every run; if isolation can't be proven the runner refuses to run policies and the sealed board stays empty rather than unsafe), 2 s per move and 30 s per game. The salt lives only in the parent process.
- Score = mean over the hidden seeds. The board shows the SHA-256 commitment to the salt from day one. When a season ends, the salt is published so anyone can re-run and check the commitment.

What this does not stop: a policy can still contain a solver (that is fine, it must work on instances it has not seen), and perfect-information games like Four Rows and Courier are decided by real play quality.

State fields are documented in each game's `description`. For Vault Runner: `energy` is moves left and `shards` lists only cells still holding an uncollected shard (collected ones are removed).

## Write a policy

```js
// policies/my-agent.mjs
export default function (obs) {
  return obs.legalMoves[0]; // replace with your strategy; return a string from legalMoves
}
```

Test locally: `npm run sealed` (uses a public dev salt, so local scores are not sealed). Illegal moves, errors, timeouts and unfinished games score 0. Policies must be a single file with no imports of repo code (the child can read nothing else).

## Maintainer setup (one time)

1. Repo Settings, Secrets and variables, Actions: add secret `SEALED_SALT` (long random string) and variable `SEALED_SEASON` (for example `s1`).
2. Merge reviewed policy PRs. The Pages workflow runs sealed evaluation on every deploy.
3. End of season: publish the old salt (commit it to `SEASONS.md`), then set a new `SEALED_SALT` and `SEALED_SEASON`.

Review every policy before merging: it runs in CI. The sandbox is defense in depth, not a replacement for reading the file.
