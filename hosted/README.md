# Hosted Commonroom

The Sites version uses a Worker backend in `worker/`, the D1 migration in `drizzle/`, and the web interface in `client/`. The backend uses the identity provided by the Sites gateway. Deploy it behind that gateway with the `DB` binding. Do not expose this Worker directly.

The backend owns profiles, study sessions, membership, completion, token awards and balances, and access to private thank-you notes. Browser code displays that data and submits actions. Help Tokens are awarded by the server and have no leaderboard.

Run `npm run build` using Node.js to bundle the frontend into the Worker. Run `node scripts/validate-artifact.mjs` to check the result. For a Sites deployment, configure the target Site ID in `.openai/hosting.json` and package the Worker with the D1 migration. Hosted and local Python databases are separate.
