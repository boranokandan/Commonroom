#!/bin/zsh
set -u

project_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$project_dir/app" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required to run Commonroom."
  echo "Press Return to close this window."
  read
  exit 1
fi

if curl -fsS --max-time 1 http://127.0.0.1:8000/api/me >/dev/null 2>&1; then
  echo "Commonroom is already running at http://127.0.0.1:8000/"
  open http://127.0.0.1:8000/
  echo "Press Return to close this window."
  read
  exit 0
fi

python3 server.py --host 127.0.0.1 --port 8000 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null' EXIT INT TERM

ready=0
for attempt in {1..30}; do
  if curl -fsS --max-time 1 http://127.0.0.1:8000/api/me >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    break
  fi
  sleep 0.2
done

if [ "$ready" -ne 1 ]; then
  echo "Commonroom could not start. Port 8000 may be in use."
  echo "Press Return to close this window."
  read
  exit 1
fi

open http://127.0.0.1:8000/
echo "Commonroom is running at http://127.0.0.1:8000/"
echo "Keep this Terminal window open while using the app."
wait "$server_pid"
