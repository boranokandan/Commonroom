#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
dist_root="$project_root/dist"

rm -rf "$dist_root"
mkdir -p "$dist_root/server" "$dist_root/.openai"
cd "$project_root"
node --input-type=module <<'JS'
import {readFileSync, writeFileSync} from 'node:fs';
const assets = {};
for (const [route, file, type] of [
  ['/', 'index.html', 'text/html'],
  ['/index.html', 'index.html', 'text/html'],
  ['/style.css', 'style.css', 'text/css'],
  ['/app.js', 'app.js', 'text/javascript'],
  ['/questions.js', 'questions.js', 'text/javascript'],
  ['/rewards.js', 'rewards.js', 'text/javascript'],
  ['/account.js', 'account.js', 'text/javascript'],
]) {
  assets[route] = {body: readFileSync('client/' + file, 'utf8'), type: type + '; charset=utf-8'};
}
const worker = readFileSync('worker/academics.js', 'utf8').replaceAll('export ', '') + '\n' + readFileSync('worker/rewards.js', 'utf8').replaceAll('export ', '') + '\n' + readFileSync('worker/index.js', 'utf8').replace("import {curriculumCatalog, sessionSubjects, validateAcademics, academicSettings} from './academics.js';", '').replace("import {rewardState, rewardApi} from './rewards.js';", '');
writeFileSync('dist/server/index.js', worker.replace('__ASSETS__', () => JSON.stringify(assets)));
JS
cp "$project_root/.openai/hosting.json" "$dist_root/.openai/hosting.json"

echo "Built $dist_root"
