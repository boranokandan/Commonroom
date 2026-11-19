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
  const uploads = new Map();
  const BUCKET = {
    async put(key, value) { uploads.set(key, value); },
    async get(key) { return uploads.has(key) ? {body: uploads.get(key)} : null; },
    async delete(key) { uploads.delete(key); },
  };
  async function request(path, {user = 'alice', data, status = 200, origin = 'https://commonroom.test', raw = false} = {}) {
    const headers = new Headers(data instanceof FormData ? {} : {'content-type': 'application/json'});
    if (origin) headers.set('origin', origin);
    if (user) headers.set('oai-authenticated-user-id', user);
    const response = await worker.fetch(new Request('https://commonroom.test/api' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers,
      body: data instanceof FormData ? data : data === undefined ? undefined : JSON.stringify(data),
    }), {DB, BUCKET});
    const result = raw ? response : await response.json();
    assert.equal(response.status, status, raw ? '' : JSON.stringify(result));
    return result;
  }
  return {database, request, uploads};
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

test('answer photos allow photo-only and mixed answers, enforce file rules, and remain authenticated', async () => {
  const {database, request, uploads} = setup();
  try {
    await request('/profile', {data: account});
    await request('/profile', {user: 'bob', data: {...account, name: 'Bob'}});
    const question = new FormData();
    question.set('question','Explain this diagram.');
    const {id} = await request('/questions',{data:question,status:201});
    const path='/questions/'+id+'/answers';
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHTsAAAAASUVORK5CYII=','base64');
    const photo = new FormData();
    photo.set('photo', new Blob([png],{type:'image/png'}), 'diagram.png');
    await request(path,{user:'bob',data:photo,status:201});
    const mixed = new FormData();
    mixed.set('answer','Here is a worked example.');
    mixed.set('photo', new Blob([png],{type:'image/png'}), 'worked.png');
    await request(path,{user:'bob',data:mixed,status:201});
    const {answers}=await request(path);
    assert.equal(answers.length,2);
    assert.equal(answers[0].has_photo,1);
    const imagePath=path+'/'+answers[0].id+'/photo';
    const image=await request(imagePath,{raw:true});
    assert.equal(image.headers.get('content-type'),'image/png');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
    await request(imagePath,{user:null,status:401});
    await request(path,{data:new FormData(),status:400});
    const invalid = new FormData();
    invalid.set('photo',new Blob(['<script>bad</script>'],{type:'image/png'}),'fake.png');
    await request(path,{data:invalid,status:400});
    const oversized = new FormData();
    oversized.set('photo',new Blob([new Uint8Array(5*1024*1024+1)],{type:'image/png'}),'large.png');
    await request(path,{data:oversized,status:413});
    assert.equal(uploads.size,2);
    await request(path+'/'+answers[0].id+'/favorite',{data:{saved:true}});
    assert.equal((await request('/saved')).explanations[0].has_photo,1);
    assert.equal((await request('/me')).user.balance,0);
  } finally {database.close();}
});

test('answer votes are unique, switchable, removable, and ordered by thumbs-up first', async () => {
  const {database, request} = setup();
  try {
    for (const user of ['alice','bob','carol','v1','v2','v3','v4']) {
      await request('/profile',{user,data:{...account,name:user}});
    }
    const question=new FormData();question.set('question','Which explanation is clearer?');
    const {id}=await request('/questions',{data:question,status:201});
    const path='/questions/'+id+'/answers';
    await request(path,{user:'bob',data:{answer:'First explanation'},status:201});
    await request(path,{user:'carol',data:{answer:'Second explanation'},status:201});
    const initial=(await request(path)).answers;
    const first=path+'/'+initial[0].id+'/vote',second=path+'/'+initial[1].id+'/vote';
    await request(first,{user:'bob',data:{vote:1},status:400});
    await request(first,{user:'v1',data:{vote:1}});
    await request(first,{user:'v1',data:{vote:1}});
    assert.equal((await request(path)).answers[0].up_votes,1);
    await request(first,{user:'v1',data:{vote:-1}});
    let answer=(await request(path,{user:'v1'})).answers.find(a=>a.id===initial[0].id);
    assert.equal(answer.my_vote,-1);
    assert.equal(answer.up_votes,0);
    assert.equal(answer.down_votes,1);
    await request(first,{user:'v1',data:{vote:0}});
    await request(first,{data:{vote:1}});
    for (const user of ['alice','v1']) await request(second,{user,data:{vote:1}});
    for (const user of ['v2','v3','v4']) await request(second,{user,data:{vote:-1}});
    const sorted=(await request(path)).answers;
    assert.equal(sorted[0].id,initial[1].id);
    assert.equal(sorted[0].up_votes,2);
    assert.equal(sorted[0].down_votes,3);
    assert.equal(database.prepare('SELECT COUNT(*) n FROM answer_votes WHERE answer_id=? AND user_id=?').get(initial[1].id,'v1').n,1);
    await request(first,{data:{vote:2},status:400});
    await request(first,{user:null,data:{vote:1},status:401});
    await request(first,{origin:'https://other.test',data:{vote:1},status:403});
    assert.equal((await request('/me',{user:'carol'})).user.balance,0);
  } finally {database.close();}
});

test('answer reports are private, persistent, validated, and deduplicated', async () => {
  const {database, request} = setup();
  try {
    for (const user of ['alice','bob','carol']) await request('/profile',{user,data:{...account,name:user}});
    const question=new FormData();question.set('question','An example question.');
    const {id}=await request('/questions',{data:question,status:201});
    const path='/questions/'+id+'/answers';
    await request(path,{user:'bob',data:{answer:'An explanation'},status:201});
    const answer=(await request(path)).answers[0];
    const report=path+'/'+answer.id+'/report';
    await request(report,{data:{reason:'unknown'},status:400});
    await request(report,{data:{reason:'spam',details:'x'.repeat(501)},status:400});
    await request(report,{data:{reason:'inappropriate',details:'Please review this content.'}});
    await request(report,{data:{reason:'spam'}});
    assert.equal(database.prepare('SELECT COUNT(*) n FROM answer_reports').get().n,1);
    const mine=(await request(path)).answers[0];
    assert.equal(mine.reported,1);
    assert.equal(mine.details,undefined);
    assert.equal(mine.reporter_id,undefined);
    assert.equal((await request(path,{user:'carol'})).answers[0].reported,0);
    await request(report,{user:null,data:{reason:'spam'},status:401});
    await request('/questions/999/answers/'+answer.id+'/report',{data:{reason:'spam'},status:404});
  } finally {database.close();}
});
