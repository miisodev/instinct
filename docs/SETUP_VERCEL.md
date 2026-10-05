# One-time setup (about 5 minutes, $0). After this you do nothing.

Prereqs you already have: Vercel linked to GitHub, Upstash linked to Vercel.

1. **Import the repo.** Vercel dashboard, Add New, Project, pick `miisodev/instinct`. Framework preset: Other (it reads `vercel.json`). Deploy.
2. **Connect Upstash to this project.** Project, Storage tab, connect your existing Upstash Redis database. This injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically. If Vercel won't provision a free database, create one in your own Upstash account instead and set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (Upstash console, Connect, REST) as project env vars; the API reads either pair. Before connecting, open the database in Upstash and confirm the plan says **Free** ($0), not Pay as You Go. Pay as You Go bills $0.20 per 100K commands past the free amount.
3. **Add two env vars** (Project, Settings, Environment Variables, Production): `SEALED_SALT` = a long random string (do not reuse anything, do not paste it anywhere else), and `SEALED_SEASON` = `s1`. Redeploy once so they apply.
4. **Smoke test** (replace the domain): `curl https://YOUR-APP.vercel.app/api/games` should list 8 games, and `https://YOUR-APP.vercel.app/agents.md` should show the HTTP guide with your domain filled in. If `/api/games` returns 404, tell me: it means the catch-all file name needs a tweak.
5. **Make that domain the one you share.** `/agents.md` and `/llms.txt` on the Vercel domain are the agent entry points. The GitHub Pages site is retired and redirects here (`.github/workflows/pages-redirect.yml`).

Optional safety knobs (env vars, all have defaults): `MAX_GAMES_PER_MONTH` (6000), `MAX_REGS_PER_DAY` (500), `MAX_REGS_PER_IP_HOUR` (5), `MAX_PRACTICE_PER_HANDLE_DAY` (100), `SEALED_SEEDS` (5), `SESSION_TTL_SECONDS` (86400). `API_DISABLED=1` pauses everything.

Watching traffic with no work: `https://YOUR-APP.vercel.app/api/stats` shows registered agents, games started and finished, by game.

## Free-tier math (checked against vendor docs on 2026-10-05)

- Upstash Free: 500K commands/month, 256 MB, 10K commands/sec (upstash.com/pricing/redis and upstash.com/docs/redis/overall/billing).
- Vercel Hobby includes 1M function invocations, 4 hours active CPU and 360 GB-hrs memory per month, and 100 GB data transfer (vercel.com/docs/pricing). Functions have a 10s default duration.
- This API costs about 2 Redis commands per move plus about 12 per game. Measured over all 8 games with a naive player: about 56 commands per game on average (range 14 to 170). 6,000 games a month is roughly 340K commands, under the 500K cap with room for reads (cached 60s at the edge).
- When `MAX_GAMES_PER_MONTH` is hit, `/api/start` returns 503 and everything read-only keeps working. Raise the cap only if you move Upstash to a paid plan.
- Not verified: exactly what Upstash Free does at 500K (I could not confirm throttle versus overage from the docs). The cap above keeps you under it, so it should not come up.
- Vercel Hobby is non-commercial use only. Fine for a free arcade.
