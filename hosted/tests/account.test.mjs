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
    const headers = new Headers(data instanceof FormData ? {} : {'content-type': 'application/json'});
    if (origin) headers.set('origin', origin);
    if (user) headers.set('oai-authenticated-user-id', user);
    const response = await worker.fetch(new Request('https://commonroom.test/api' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers,
      body: data instanceof FormData ? data : data === undefined ? undefined : JSON.stringify(data),
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

test('coded subjects keep qualification, level, and leading zeros through account and session storage', async () => {
  const {database, request} = setup();
  try {
    const {curricula} = await request('/curricula', {user: null});
    for (const curriculum of curricula) {
      assert.equal(new Set(curriculum.subjects).size, curriculum.subjects.length);
      for (const value of curriculum.subjects) assert.ok(value.length <= 60, value);
    }
    const cambridge = curricula.find(item => item.id === 'cambridge');
    const further = cambridge.courses.find(course => course.code === '9231');
    const igcseMath = cambridge.courses.find(course => course.code === '0580');
    assert.equal(further.name, 'Further Mathematics');
    assert.equal(igcseMath.qualification, 'IGCSE');
    await request('/profile', {data: {...account, curriculum: 'cambridge', subjects: [further.value, igcseMath.value]}});
    assert.deepEqual((await request('/me')).user.academics.subjects, [further.value, igcseMath.value]);
    await request('/sessions', {data: {subject: further.value, topic: 'Complex numbers'}, status: 201});
    assert.equal((await request('/sessions')).sessions[0].subject, further.value);
    const apHistory = curricula.find(item => item.id === 'us').courses.find(course => course.code === '07');
    assert.equal(apHistory.code, '07');
    const ib = curricula.find(item => item.id === 'ib-dp');
    const ibMath = ib.courses.filter(course => course.code === '166711');
    assert.deepEqual(ibMath.map(course => course.qualification), ['SL', 'HL']);
    assert.notEqual(ibMath[0].value, ibMath[1].value);
    await request('/account', {data: {curriculum: 'ib-dp', subjects: [ibMath[1].value, 'Biology', 'My school course']}});
    assert.deepEqual((await request('/me')).user.academics.subjects, [ibMath[1].value, 'Biology', 'My school course']);
  } finally {database.close();}
});

test('subject tags and private favorites persist with idempotent save and removal', async () => {
  const {database, request} = setup();
  try {
    await request('/profile', {data: account});
    await request('/profile', {user: 'bob', data: {...account, name: 'Bob'}});
    const form = new FormData();
    form.set('question', 'How do cells divide?');
    form.set('subject', 'Biology');
    const {id} = await request('/questions', {data: form, status: 201});
    await request('/questions/' + id + '/answers', {user: 'bob', data: {answer: 'During mitosis.'}, status: 201});
    const {answers} = await request('/questions/' + id + '/answers');
    const answer = answers[0];
    const favoriteQuestion = '/questions/' + id + '/favorite';
    const favoriteAnswer = '/questions/' + id + '/answers/' + answer.id + '/favorite';
    await request(favoriteQuestion, {data: {saved: true}});
    await request(favoriteQuestion, {data: {saved: true}});
    await request(favoriteAnswer, {data: {saved: true}});
    await request(favoriteAnswer, {data: {saved: true}});
    const saved = await request('/saved');
    assert.equal(saved.questions.length, 1);
    assert.equal(saved.explanations.length, 1);
    assert.equal(saved.explanations[0].content, 'During mitosis.');
    assert.equal((await request('/saved', {user: 'bob'})).questions.length, 0);
    assert.equal((await request('/saved', {user: 'bob'})).explanations.length, 0);
    await request(favoriteQuestion, {user: 'bob', data: {saved: false, user_id: 'alice'}});
    assert.equal((await request('/saved')).questions.length, 1);
    assert.equal((await request('/questions?subject=Biology')).questions.length, 1);
    assert.equal((await request('/questions?subject=Physics')).questions.length, 0);
    assert.equal((await request('/questions/' + id)).question.subject, 'Biology');
    await request(favoriteQuestion, {data: {saved: false}});
    await request(favoriteAnswer, {data: {saved: false}});
    assert.deepEqual(await request('/saved'), {questions: [], explanations: []});
    await request('/saved', {user: null, status: 401});
    await request(favoriteAnswer, {data: {saved: true}, origin: 'https://other.test', status: 403});
  } finally {database.close();}
});

test('question recognition awards once to another helper and appears only in their private history', async () => {
  const {database, request} = setup();
  try {
    await request('/profile', {data: account});
    for (const user of ['bob', 'outsider']) {
      await request('/profile', {user, data: {...account, name: user}});
    }
    const form = new FormData();
    form.set('question', 'What is a cell?');
    const {id} = await request('/questions', {data: form, status: 201});
    await request('/questions/' + id + '/answers', {user: 'bob', data: {answer: 'The basic unit of life.'}, status: 201});
    await request('/questions/' + id + '/answers', {data: {answer: 'My own explanation'}, status: 201});
    const {answers} = await request('/questions/' + id + '/answers');
    const path = '/questions/' + id + '/answers/' + answers[0].id + '/thank';
    const ownPath = '/questions/' + id + '/answers/' + answers[1].id + '/thank';
    await request(path, {user: 'outsider', data: {note: 'test'}, status: 403});
    await request(ownPath, {data: {note: 'test'}, status: 400});
    await request(path, {data: {note: 'x'.repeat(241)}, status: 400});
    await request(path, {data: {note: 'Your example made it clear.'}});
    await request(path, {data: {note: 'Retry'}, status: 409});
    assert.equal((await request('/questions/' + id + '/answers')).can_thank, false);
    const helper = (await request('/me', {user: 'bob'})).user;
    assert.equal(helper.balance, 3);
    assert.equal(helper.rewards.stats.thanks, 1);
    assert.equal(helper.rewards.rewards.find(reward => reward.id === 'helping-hand').unlocked, true);
    const helperHistory = (await request('/ledger', {user: 'bob'})).events;
    assert.equal(helperHistory.length, 1);
    assert.equal(helperHistory[0].note, 'Your example made it clear.');
    assert.equal(helperHistory[0].topic, 'What is a cell?');
    assert.equal(helperHistory[0].actor_name, 'Alice');
    assert.deepEqual((await request('/ledger', {user: 'outsider'})).events, []);
    assert.equal((await request('/me')).user.balance, 0);
  } finally {database.close();}
});
