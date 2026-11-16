# Commonroom

Commonroom helps high school students find study partners and recognize classmates who help others learn.

- [`hosted/`](hosted/) contains the deployed app’s Worker backend, database migration, and web interface.
- [`app/`](app/) is a working Python and SQLite MVP with accounts, shared study sessions, and Help Tokens. On a Mac, double-click [`Start Commonroom.command`](Start%20Commonroom.command) to run it; keep the Terminal window open. See the app README for manual steps.
- [`demo/`](demo/) is the original browser-only design prototype.
- [`admin/`](admin/) is a visual admin dashboard prototype with fictional data.

The working MVP awards 1 Help Token to each participant when a host completes a session with at least two students. Afterward, a participant may thank one helper, awarding that student 3 more tokens and optionally leaving a private note. The app does not yet provide calls or chat; students arrange their conversation separately.

The GitHub repository stores the code but does not host the working app. `http://127.0.0.1:8000/` works only on the computer running the Python server, while it is running.
