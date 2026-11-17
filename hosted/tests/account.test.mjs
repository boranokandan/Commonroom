import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../dist/server/index.js';

function setup() {
  const database = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(file => file.endsWith('.sql')).sort()) {
    database.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  }
  const DB = {
    prepare(sql) {
      return {bind(...args) {
        const statement = database.prepare(sql);
        return {
          first: () => statement.get(...args),
          all: () => ({results: statement.all(...args)}),
          run: () => {
            const result = statement.run(...args);
            return {meta: {last_row_id: result.lastInsertRowid, changes: result.changes}};
          },
        };
      }};
    },
    batch(statements) {
      database.exec('BEGIN');
      try {
        const results = statements.map(statement => statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
  async function request(path, {user = 'alice', data, status = 200, origin = 'https://commonroom.test'} = {}) {
    const headers = new Headers({'content-type': 'application/json'});
    if (origin) headers.set('origin', origin);
    if (user) headers.set('oai-authenticated-user-id', user);
    const response = await worker.fetch(new Request('https://commonroom.test/api' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers,
      body: data === undefined ? undefined : JSON.stringify(data),
    }), {DB});
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  }
  return {database, request};
}
const account = {name: 'Alice', curriculum: 'ib-dp', subjects: ['Mathematics', 'Biology']};

test('onboarding validates and persists curriculum, subjects, and custom courses', async () => {
  const {database, request} = setup();
  try {
    await request('/profile', {data: {...account, curriculum: 'unknown'}, status: 400});
    await request('/profile', {data: {...account, subjects: []}, status: 400});
    await request('/profile', {data: account});
    assert.deepEqual((await request('/me')).user.academics.subjects, account.subjects);
    await request('/account', {data: {curriculum: 'other', subjects: ['Robotics', 'Art & Design']}});
    assert.deepEqual((await request('/account')).academics.subjects, ['Robotics', 'Art & Design']);
    const {id} = await request('/sessions', {data: {subject: 'Robotics', topic: 'Design a robot'}, status: 201});
    const {participants} = await request('/sessions/' + id + '/participants');
    assert.equal(participants.length, 1);
    await request('/account', {data: {curriculum: 'other', subjects: []}});
    assert.equal((await request('/sessions')).sessions[0].subject, 'Robotics');
    assert.deepEqual((await request('/me')).user.academics.subjects, []);
  } finally {database.close();}
});

test('settings are private and caller-supplied IDs or reward fields cannot change another account', async () => {
  const {database, request} = setup();
  try {
    await request('/profile', {data: account});
    await request('/profile', {user: 'bob', data: {...account, name: 'Bob', curriculum: 'us', subjects: ['Physics']}});
    await request('/account', {data: {user_id: 'bob', balance: 999, title: 'peer-teacher', curriculum: 'other', subjects: ['Robotics']}});
    assert.deepEqual((await request('/account', {user: 'bob'})).academics, {curriculum: 'us', subjects: ['Physics']});
    assert.equal((await request('/me')).user.balance, 0);
    await request('/rewards', {data: {kind: 'title', id: 'peer-teacher'}, status: 403});
    for (const path of ['/account', '/sessions', '/ledger', '/rewards']) {
      await request(path, {user: null, status: 401});
    }
    await request('/account', {data: account, origin: null, status: 403});
    await request('/account', {data: account, origin: 'https://other.test', status: 403});
  } finally {database.close();}
});

test('invalid subjects are rejected and existing profiles can finish onboarding without losing rewards', async () => {
  const {database, request} = setup();
  try {
    database.prepare("INSERT INTO users(id,email,name,created_at) VALUES('alice','','Existing',1)").run();
    assert.equal((await request('/me')).user.academics, null);
    await request('/profile', {data: account});
    await request('/account', {data: {...account, subjects: ['Math', 'math']}, status: 400});
    await request('/account', {data: {...account, subjects: ['x'.repeat(61)]}, status: 400});
    await request('/account', {data: {...account, subjects: Array.from({length: 31}, (_, i) => 'Course ' + i)}, status: 400});
    await request('/sessions', {data: {subject: 'Invalid course', topic: 'Some topic'}, status: 400});
    assert.deepEqual((await request('/me')).user.academics, {curriculum: account.curriculum, subjects: account.subjects});
  } finally {database.close();}
});

test('reward selections preserve token history and remain private', async () => {
  const {database, request} = setup();
  try {
    await request('/profile', {data: account});
    database.prepare("INSERT INTO study_sessions(id,host_id,subject,topic,created_at) VALUES(1,'alice','Biology','Cells',1)").run();
    database.prepare("INSERT INTO token_events(user_id,session_id,kind,amount,created_at) VALUES('alice',1,'participated',5,1)").run();
    await request('/rewards', {data: {kind: 'theme', id: 'sage'}});
    assert.equal((await request('/me')).user.rewards.theme, 'sage');
    assert.equal((await request('/me')).user.balance, 5);
    await request('/rewards', {data: {kind: 'theme', id: 'sunrise'}, status: 403});
    assert.equal((await request('/me')).user.balance, 5);
  } finally {database.close();}
});
