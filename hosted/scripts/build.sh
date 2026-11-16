#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p dist/server dist/.openai
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const routes = {
  '/': ['index.html', 'text/html'],
  '/index.html': ['index.html', 'text/html'],
  '/style.css': ['style.css', 'text/css'],
  '/app.js': ['app.js', 'text/javascript'],
};
const assets = Object.fromEntries(Object.entries(routes).map(([route, [file, type]]) => [
  route, {body: readFileSync('client/' + file, 'utf8'), type: type + '; charset=utf-8'},
]));
const worker = readFileSync('worker/index.js', 'utf8');
writeFileSync('dist/server/index.js', worker.replace('__ASSETS__', () => JSON.stringify(assets)));
JS
cp .openai/hosting.json dist/.openai/hosting.json
