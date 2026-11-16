# Commonroom demo

A browser-based high school study partner concept. Students can create a local demo profile or sign back in on the same device, explore subjects, find fictional partner matches by topic and study style, create sessions, enter a sample study room, preview their own camera, and save study notes locally.

## Run

Open `index.html` in a browser, or run `python3 -m http.server 8000` in this directory and visit `http://localhost:8000`.

## Demo boundaries

Demo profiles, sessions, and notes use browser local storage. No password is collected and there is no real authentication. The other student is a demo character. The mic control is a UI demo. Real calls, accounts, school verification, shared notes, and moderation would require a backend and live communications service before students could use it together.
