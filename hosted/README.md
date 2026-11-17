# Hosted Commonroom

The deployed app uses three source folders.

- `worker/` contains the backend, including account validation, curriculum and subject persistence, session permissions, photo access, token awards, and reward eligibility.
- `drizzle/` contains append-only database migrations.
- `client/` contains the frontend, including Help Token displays, reward and title selection, Questions, onboarding, and Account Settings → My Subjects.

Sites provides ChatGPT sign-in. The backend accepts identity only through the Sites gateway and derives the account from that identity on each request. Deploy the Worker behind that gateway with the `DB` and `BUCKET` bindings. Account settings and token history are returned only to their owner. Token awards and unlock thresholds are enforced by the backend.

Students choose a curriculum and at least one subject during onboarding. Existing accounts can complete this step without losing token history. Students can then add custom course names, remove subjects, or change curriculum under Account Settings. Curriculum lists are starting suggestions, rather than official course requirements. Subject changes preserve earlier study sessions.

Build with `npm run build`. Run `npm test` for account isolation, onboarding validation, custom subjects, and reward protection checks. Tests require a Node.js version with `node:sqlite` support. Run `npm run validate` to validate the built Worker.

For deployment, set the target Site ID in `.openai/hosting.json` and package the Worker with its migrations through Sites. Production records, photos, cookies, credentials, local databases, and generated build files belong outside Git. Hosted and local Python databases are separate.
