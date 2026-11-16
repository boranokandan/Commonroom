# Commonroom working MVP

This is a small, dependency-free web app using Python's standard library and SQLite. It supports accounts, persistent shared study sessions, and Help Tokens. The `demo/` and `admin/` folders are design prototypes; this `app/` folder contains the working server.

## Run

From this folder:

```sh
python3 server.py
```

Then open `http://127.0.0.1:8000`. The default server listens only on your computer. For use across devices, deploy behind HTTPS with proper hosting and security controls; do not expose this development server directly to the internet.

The SQLite database is created as `commonroom.sqlite3` beside `server.py` and is ignored by Git. Back it up if you want to keep accounts and sessions.

## Help Token rules

- The host can complete a session only when at least two distinct students have joined.
- Completing a session awards **1 token** to each participant, once.
- After completion, each participant may thank one other participant for helping and add an optional note of up to 240 characters. The recipient earns **3 tokens**. Several classmates may thank the same helper. Notes appear only in the recipient’s private impact history.
- Tokens have no cash value or spending feature.

## Current limits

There is no built-in video call, messaging, school verification, email recovery, or production admin system. Students arrange their study conversation separately. Before a public school launch, add HTTPS, deployment-grade session protection, abuse controls, moderation, and a school privacy review. The separate `admin/` page contains only fictional sample data.
