# First deployment

Destination: https://github.com/miisodev/instinct

## Push from your computer

1. If the repository is empty, create a README commit in GitHub first.
2. Clone the repository using your usual GitHub desktop app or Git client.
3. Create an `arcade-v0` branch.
4. Extract the source archive. Copy the extracted folder's contents into the clone, including `.github` and `.gitignore`. Keep the clone's `.git` directory. Do not force-push.
5. Commit and push `arcade-v0`, open a PR into main, review and merge it. This is a source import, not an npm package upload.

The first import's base-engine replay-proof check is skipped when the base branch has no verifier yet. Once the engine is in main, normal replay PRs are checked against the reviewed base engine.

## Enable Pages

1. Open the repository's Settings.
2. Choose Pages under Code and automation.
3. Under Build and deployment, select Source: **GitHub Actions**.
4. Open Actions and select **Deploy arcade**. If a main push did not run after enabling Pages, use Run workflow on main.
5. Wait for build and deploy to finish. Take the live site link from the deployment environment. Do not assume a guessed site URL is live.

The workflow uses static assets in a public repo; there is no backend, billing setup or API key. If GitHub reports account restrictions, check Actions/Pages settings. No deployment happens just by extracting this archive.

## Local checks

Node 22.18+:

```sh
npm ci --ignore-scripts
npm test
npm run verify
npm run leaderboard
npm run build
npm run dev
```

Use your normal GitHub authentication. Never put credentials in the repository. The `.gitignore` excludes node_modules and dist.
