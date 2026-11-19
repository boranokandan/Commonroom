import {curriculumCatalog, sessionSubjects, validateAcademics, academicSettings} from './academics.js';
import {rewardState, rewardApi} from './rewards.js';
// Commonroom hosted backend. Client files are embedded by the build.
const ASSETS = __ASSETS__;
const SUBJECTS = sessionSubjects;
const json = (value, status=200) => new Response(JSON.stringify(value), {status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const fail = (status,message) => json({error:message},status);
const now = () => Math.floor(Date.now()/1000);
const identity = request => {const id=request.headers.get('oai-authenticated-user-id');return id?{id,email:request.headers.get('oai-authenticated-user-email')||''}:null};
const one = (db,sql,...args) => db.prepare(sql).bind(...args).first();
const all = async (db,sql,...args) => (await db.prepare(sql).bind(...args).all()).results;
const run = (db,sql,...args) => db.prepare(sql).bind(...args).run();
async function profile(db,auth){if(!auth)return null;const p=await one(db,'SELECT id,email,name FROM users WHERE id=?',auth.id);if(!p)return null;const b=await one(db,'SELECT COALESCE(SUM(amount),0) balance FROM token_activity WHERE user_id=?',auth.id);return {...p,balance:b.balance,rewards:await rewardState(db,auth.id),academics:await academicSettings(db,auth.id)}}
async function body(request){if(!request.headers.get('content-type')?.startsWith('application/json'))throw [415,'Send JSON.'];const raw=await request.text();if(raw.length>10000)throw [413,'Request too large.'];try{const x=JSON.parse(raw);if(x&&typeof x==='object'&&!Array.isArray(x))return x}catch{}throw [400,'Invalid request body.']}
function need(auth,p){if(!auth)throw [401,'Sign in with ChatGPT to continue.'];if(!p)throw [401,'Create your student profile to continue.']}
async function api(request,env,url){
  if(!env.DB)return fail(503,'The database is not ready.');
  const db=env.DB,path=url.pathname,auth=identity(request),p=await profile(db,auth),method=request.method;
  if (method === 'GET' && path === '/api/curricula') return json({curricula: curriculumCatalog});
  if (method === 'GET' && path === '/api/account') {
    need(auth, p);
    return json({academics: p.academics});
  }
  if (path === '/api/rewards') {
    need(auth, p);
    return rewardApi(request, db, p);
  }
  if (path === '/api/saved' || path === '/api/questions' || path.startsWith('/api/questions/')) {
    need(auth, p);
    return questions(request, env, url, p);
  }
  if(method==='GET'&&path==='/api/me')return json({authenticated:!!auth,user:p});
  if(method==='GET'&&path==='/api/sessions'){
    need(auth, p);
    const id=p?.id||'';
    const sessions=await all(db,`SELECT s.id,s.subject,s.topic,s.status,s.host_id,u.name host_name,s.created_at,s.completed_at,
      (SELECT COUNT(*) FROM members m WHERE m.session_id=s.id) member_count,
      EXISTS(SELECT 1 FROM members m WHERE m.session_id=s.id AND m.user_id=?) joined,
      EXISTS(SELECT 1 FROM thanks t WHERE t.session_id=s.id AND t.from_user=?) thanked
      FROM study_sessions s JOIN users u ON u.id=s.host_id ORDER BY s.id DESC LIMIT 100`,id,id);
    return json({sessions});
  }
  if(method==='GET'&&path==='/api/ledger'){
    need(auth,p);
    const events=await all(db,`SELECT e.amount,e.kind,e.note,e.created_at,
      COALESCE(s.topic,NULLIF(q.content,''),'Photo question') topic,
      COALESCE(s.subject,q.subject) subject,u.name actor_name
      FROM token_activity e LEFT JOIN study_sessions s ON s.id=e.session_id
      LEFT JOIN questions q ON q.id=e.question_id LEFT JOIN users u ON u.id=e.actor_id
      WHERE e.user_id=? ORDER BY e.created_at DESC LIMIT 50`,p.id);
    return json({events});
  }
  let match=path.match(/^\/api\/sessions\/(\d+)\/participants$/);
  if(method==='GET'&&match){need(auth,p);const sid=Number(match[1]);const mine=await one(db,'SELECT 1 present FROM members WHERE session_id=? AND user_id=?',sid,p.id);if(!mine)throw [403,'Join the session first.'];return json({participants:await all(db,'SELECT u.id,u.name FROM members m JOIN users u ON u.id=m.user_id WHERE m.session_id=? ORDER BY m.joined_at',sid)});}
  if(method!=='POST')return fail(404,'Not found.');
  const origin=request.headers.get('Origin');if(origin!==url.origin)throw [403,'Cross-site request blocked.'];
  const data=await body(request);
  if(path==='/api/profile'){
    if(!auth)throw [401,'Sign in with ChatGPT first.'];
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (name.length < 2 || name.length > 60) throw [400, 'Name must be 2–60 characters.'];
    const academics = validateAcademics(data);
    if (!academics.subjects.length) throw [400, 'Select at least one subject to get started.'];
    await db.batch([
      db.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email')
        .bind(auth.id,auth.email,name,now()),
      db.prepare('INSERT INTO academic_settings(user_id,curriculum,subjects) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET curriculum=excluded.curriculum,subjects=excluded.subjects')
        .bind(auth.id,academics.curriculum,JSON.stringify(academics.subjects)),
    ]);
    return json({ok:true});
  }
  need(auth,p);
  if (path === '/api/account') {
    const academics = validateAcademics(data);
    await run(db, 'INSERT INTO academic_settings(user_id,curriculum,subjects) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET curriculum=excluded.curriculum,subjects=excluded.subjects',
      p.id, academics.curriculum, JSON.stringify(academics.subjects));
    return json({academics});
  }
  if(path==='/api/sessions'){
    const subject=String(data.subject||''),topic=String(data.topic||'').trim();if((!SUBJECTS.has(subject)&&!p.academics?.subjects.includes(subject))||topic.length<3||topic.length>80)throw [400,'Choose a subject and a topic of 3–80 characters.'];
    const timestamp = now();
    const [created] = await db.batch([
      db.prepare('INSERT INTO study_sessions(host_id,subject,topic,created_at) VALUES(?,?,?,?)').bind(p.id,subject,topic,timestamp),
      db.prepare('INSERT INTO members(session_id,user_id,joined_at) VALUES(last_insert_rowid(),?,?)').bind(p.id,timestamp),
    ]);
    return json({id:created.meta.last_row_id},201);
  }
  match=path.match(/^\/api\/sessions\/(\d+)\/(join|complete|thank)$/);if(!match)return fail(404,'Not found.');
  const sid=Number(match[1]),action=match[2],s=await one(db,'SELECT host_id,status FROM study_sessions WHERE id=?',sid);if(!s)throw [404,'Session not found.'];
  if(action==='join'){
    if (s.status !== 'open') throw [409, 'This session is complete.'];
    await run(db, `INSERT OR IGNORE INTO members(session_id,user_id,joined_at)
      SELECT id,?,? FROM study_sessions WHERE id=? AND status='open'`, p.id, now(), sid);
    const membership = await one(db, 'SELECT 1 present FROM members WHERE session_id=? AND user_id=?', sid, p.id);
    if (!membership) throw [409, 'This session is complete.'];
    return json({ok: true});
  }
  if (action === 'complete') {
    if (s.host_id !== p.id) throw [403, 'Only the host can finish a session.'];
    if (s.status !== 'open') throw [409, 'This session is already complete.'];
    const timestamp = now();
    const [, completed] = await db.batch([
      db.prepare(`INSERT INTO token_events(user_id,session_id,kind,amount,created_at)
        SELECT user_id,session_id,'participated',1,? FROM members WHERE session_id=?
        AND EXISTS (SELECT 1 FROM study_sessions WHERE id=? AND status='open')
        AND (SELECT COUNT(*) FROM members WHERE session_id=?) >= 2`).bind(timestamp,sid,sid,sid),
      db.prepare(`UPDATE study_sessions SET status='completed',completed_at=?
        WHERE id=? AND status='open' AND (SELECT COUNT(*) FROM members WHERE session_id=?) >= 2`)
        .bind(timestamp,sid,sid),
    ]);
    if (!completed.meta.changes) {
      const latest = await one(db, 'SELECT status FROM study_sessions WHERE id=?', sid);
      if (latest.status !== 'open') throw [409, 'This session is already complete.'];
      throw [409, 'At least two students must join before the session can finish.'];
    }
    return json({ok: true});
  }
  const recipient=String(data.recipient_id||''),note=data.note===undefined?'':data.note;
  if(typeof note!=='string'||note.trim().length>240)throw [400,'Your note must be 240 characters or fewer.'];
  if(recipient===p.id)throw [400,'You cannot thank yourself.'];if(s.status!=='completed')throw [409,'Finish the session before thanking a helper.'];
  const members=await all(db,'SELECT user_id FROM members WHERE session_id=? AND user_id IN (?,?)',sid,p.id,recipient);if(members.length!==2)throw [403,'Both students must have joined this session.'];
  const t=now();await db.batch([db.prepare('INSERT INTO thanks(session_id,from_user,to_user,note,created_at) VALUES(?,?,?,?,?)').bind(sid,p.id,recipient,note.trim(),t),db.prepare('INSERT INTO token_events(user_id,session_id,kind,amount,note,actor_id,created_at) VALUES(?,?,?,3,?,?,?)').bind(recipient,sid,`helped:${p.id}`,note.trim(),p.id,t)]);return json({ok:true});
}
const PHOTO_LIMIT = 5 * 1024 * 1024;
function checkedText(value, limit, field) {
  if (typeof value !== 'string' || value.trim().length > limit) {
    throw [400, field + ' must be ' + limit + ' characters or fewer.'];
  }
  return value.trim();
}

async function readQuestionForm(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.startsWith('multipart/form-data;')) throw [415, 'Submit the question form.'];
  const reader = request.body?.getReader();
  if (!reader) throw [400, 'The question form is empty.'];
  const chunks = [];
  let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > PHOTO_LIMIT + 32768) {
      await reader.cancel();
      throw [413, 'Choose a photo smaller than 5 MB.'];
    }
    chunks.push(value);
  }
  try {
    return await new Response(new Blob(chunks), {headers: {'content-type': type}}).formData();
  } catch {
    throw [400, 'The question form could not be read. Please try again.'];
  }
}

function photoType(bytes) {
  const matches = (offset, signature) => signature.every((byte, i) => bytes[offset + i] === byte);
  if (matches(0, [255, 216, 255])) return 'image/jpeg';
  if (matches(0, [137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
  if (matches(0, [82, 73, 70, 70]) && matches(8, [87, 69, 66, 80])) return 'image/webp';
  throw [400, 'Choose a JPEG, PNG, or WebP photo.'];
}

async function questions(request, {DB: db, BUCKET: bucket}, url, profile) {
  const {pathname: path, searchParams} = url;
  const method = request.method;
  if (method === 'POST' && request.headers.get('Origin') !== url.origin) {
    throw [403, 'Cross-site request blocked.'];
  }

  if (path === '/api/saved' && method === 'GET') {
    const savedQuestions = await all(db, `SELECT q.id,q.content,q.subject,q.created_at,u.name author,
      q.photo_key IS NOT NULL has_photo,1 saved,
      (SELECT COUNT(*) FROM answers a WHERE a.question_id=q.id) answer_count
      FROM question_favorites f JOIN questions q ON q.id=f.question_id
      JOIN users u ON u.id=q.author_id WHERE f.user_id=? ORDER BY f.created_at DESC`, profile.id);
    const explanations = await all(db, `SELECT a.id,a.question_id,a.content,a.created_at,a.photo_key IS NOT NULL has_photo,u.name author,
      q.content question_content,q.subject
      FROM answer_favorites f JOIN answers a ON a.id=f.answer_id
      JOIN questions q ON q.id=a.question_id JOIN users u ON u.id=a.author_id
      WHERE f.user_id=? ORDER BY f.created_at DESC`, profile.id);
    return json({questions: savedQuestions, explanations});
  }

  if (path === '/api/questions' && method === 'GET') {
    const before = Number(searchParams.get('before') ?? Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(before) || before < 1) throw [400, 'Invalid page.'];
    const subject = searchParams.get('subject') ?? '';
    if (subject.length > 60) throw [400, 'Invalid subject.'];
    const rows = await all(db, `SELECT q.id,q.content,q.subject,q.created_at,u.name author,
      q.photo_key IS NOT NULL has_photo,
      EXISTS(SELECT 1 FROM question_favorites f WHERE f.user_id=? AND f.question_id=q.id) saved,
      (SELECT COUNT(*) FROM answers a WHERE a.question_id=q.id) answer_count
      FROM questions q JOIN users u ON u.id=q.author_id
      WHERE q.id < ? AND (?='' OR q.subject=?) ORDER BY q.id DESC LIMIT 21`,
      profile.id,before,subject,subject);
    return json({questions: rows.slice(0,20),next: rows.length > 20 ? rows[19].id : null});
  }

  if (path === '/api/questions' && method === 'POST') {
    const form = await readQuestionForm(request);
    const content = checkedText(form.get('question') ?? '', 2000, 'Question');
    const subject = checkedText(form.get('subject') ?? 'Other',60,'Subject');
    if (!sessionSubjects.has(subject) && !profile.academics?.subjects.includes(subject)) {
      throw [400, 'Choose a subject from your courses.'];
    }
    const photo = form.get('photo');
    if (photo !== null && !(photo instanceof File)) throw [400, 'Choose a photo file.'];
    const hasPhoto = Boolean(photo?.size);
    if (!content && !hasPhoto) throw [400, 'Write a question or attach a photo.'];
    if (hasPhoto && photo.size > PHOTO_LIMIT) throw [413, 'Choose a photo smaller than 5 MB.'];

    let key = null;
    let type = null;
    if (hasPhoto) {
      if (!bucket) throw [503, 'Photo uploads are temporarily unavailable.'];
      type = photoType(new Uint8Array(await photo.slice(0, 12).arrayBuffer()));
      key = 'questions/' + crypto.randomUUID();
      await bucket.put(key, await photo.arrayBuffer(), {httpMetadata: {contentType: type}});
    }
    const result = await run(db, `INSERT INTO questions(author_id,content,subject,photo_key,photo_type,created_at)
      VALUES(?,?,?,?,?,?)`, profile.id, content, subject, key, type, now());
    return json({id: result.meta.last_row_id}, 201);
  }

  const questionPage = path.match(/^\/api\/questions\/(\d+)$/);
  if (questionPage && method === 'GET') {
    const row = await one(db,`SELECT q.id,q.content,q.subject,q.created_at,u.name author,
      q.photo_key IS NOT NULL has_photo,
      EXISTS(SELECT 1 FROM question_favorites f WHERE f.user_id=? AND f.question_id=q.id) saved,
      (SELECT COUNT(*) FROM answers a WHERE a.question_id=q.id) answer_count
      FROM questions q JOIN users u ON u.id=q.author_id WHERE q.id=?`,profile.id,Number(questionPage[1]));
    if (!row) return fail(404,'Question not found.');
    return json({question:row});
  }

  const route = path.match(/^\/api\/questions\/(\d+)\/(answers|photo|favorite)(?:\/(\d+)\/(favorite|thank|vote|report|photo))?$/);
  if (!route) return fail(404, 'Not found.');
  const id = Number(route[1]);
  if (!Number.isSafeInteger(id)) return fail(404, 'Question not found.');
  const question = await one(db, 'SELECT author_id,photo_key,photo_type FROM questions WHERE id=?', id);
  if (!question) return fail(404, 'Question not found.');

  if (route[2] === 'photo' && !route[3] && method === 'GET') {
    const photo = question.photo_key && bucket && await bucket.get(question.photo_key);
    if (!photo) return fail(404, 'Photo not found.');
    return new Response(photo.body, {headers: {
      'content-type': question.photo_type,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    }});
  }
  if (route[2] === 'favorite' && !route[3] && method === 'POST') {
    const data = await body(request);
    if (typeof data.saved !== 'boolean') throw [400, 'Choose whether to save the question.'];
    if (data.saved) await run(db, 'INSERT OR IGNORE INTO question_favorites(user_id,question_id,created_at) VALUES(?,?,?)',profile.id,id,now());
    else await run(db, 'DELETE FROM question_favorites WHERE user_id=? AND question_id=?',profile.id,id);
    return json({saved:data.saved});
  }
  if (route[2] !== 'answers') return fail(405,'Method not allowed.');
  if (route[3]) {
    const answerId = Number(route[3]);
    const answer = await one(db,'SELECT author_id,photo_key,photo_type FROM answers WHERE id=? AND question_id=?',answerId,id);
    if (!answer) return fail(404,'Answer not found.');
    if (route[4] === 'photo' && method === 'GET') {
      const photo = answer.photo_key && bucket && await bucket.get(answer.photo_key);
      if (!photo) return fail(404,'Photo not found.');
      return new Response(photo.body,{headers:{
        'content-type':answer.photo_type,
        'cache-control':'private, no-store',
        'x-content-type-options':'nosniff',
      }});
    }
    if (method !== 'POST') return fail(405,'Method not allowed.');
    const data = await body(request);
    if (route[4] === 'vote') {
      if (answer.author_id === profile.id) throw [400,'You cannot vote on your own answer.'];
      if (!Number.isInteger(data.vote) || ![-1,0,1].includes(data.vote)) throw [400,'Choose thumbs up or thumbs down.'];
      if (data.vote === 0) await run(db,'DELETE FROM answer_votes WHERE answer_id=? AND user_id=?',answerId,profile.id);
      else await run(db,`INSERT INTO answer_votes(answer_id,user_id,vote,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(answer_id,user_id) DO UPDATE SET vote=excluded.vote,updated_at=excluded.updated_at`,
        answerId,profile.id,data.vote,now());
      return json({ok:true});
    }
    if (route[4] === 'report') {
      if (!['inappropriate','harassment','spam','other'].includes(data.reason)) throw [400,'Choose a report reason.'];
      const details = checkedText(data.details ?? '',500,'Report details');
      await run(db,`INSERT OR IGNORE INTO answer_reports(answer_id,reporter_id,reason,details,created_at)
        VALUES(?,?,?,?,?)`,answerId,profile.id,data.reason,details,now());
      return json({ok:true});
    }

    if (route[4] === 'favorite') {
      if (typeof data.saved !== 'boolean') throw [400,'Choose whether to save the explanation.'];
      if (data.saved) await run(db,'INSERT OR IGNORE INTO answer_favorites(user_id,answer_id,created_at) VALUES(?,?,?)',profile.id,answerId,now());
      else await run(db,'DELETE FROM answer_favorites WHERE user_id=? AND answer_id=?',profile.id,answerId);
      return json({saved:data.saved});
    }
    if (route[4] !== 'thank') return fail(405,'Method not allowed.');
    if (question.author_id !== profile.id) throw [403,'Only the student who asked can thank an explanation.'];
    if (answer.author_id === profile.id) throw [400,'You cannot award yourself Help Tokens.'];
    const note = checkedText(data.note ?? '',240,'Note');
    await run(db,'INSERT INTO question_recognition(question_id,answer_id,user_id,actor_id,note,created_at) VALUES(?,?,?,?,?,?)',
      id,answerId,answer.author_id,profile.id,note,now());
    return json({ok:true});
  }
  if (method === 'GET') {
    const recognized = await one(db,'SELECT answer_id FROM question_recognition WHERE question_id=?',id);
    return json({
      can_thank: question.author_id === profile.id && !recognized,
      answers: await all(db,`SELECT a.id,a.content,a.created_at,u.name author,a.author_id=? mine,
        a.photo_key IS NOT NULL has_photo,
        EXISTS(SELECT 1 FROM answer_favorites f WHERE f.user_id=? AND f.answer_id=a.id) saved,
        COALESCE((SELECT vote FROM answer_votes v WHERE v.answer_id=a.id AND v.user_id=?),0) my_vote,
        (SELECT COUNT(*) FROM answer_votes v WHERE v.answer_id=a.id AND v.vote=1) up_votes,
        (SELECT COUNT(*) FROM answer_votes v WHERE v.answer_id=a.id AND v.vote=-1) down_votes,
        EXISTS(SELECT 1 FROM answer_reports r WHERE r.answer_id=a.id AND r.reporter_id=?) reported
        FROM answers a JOIN users u ON u.id=a.author_id WHERE a.question_id=?
        ORDER BY up_votes DESC,down_votes ASC,a.created_at ASC,a.id ASC`,
        profile.id,profile.id,profile.id,profile.id,id),
    });
  }
  if (method === 'POST') {
    let content;
    let attachment = null;
    if (request.headers.get('content-type')?.startsWith('multipart/form-data;')) {
      const form = await readQuestionForm(request);
      content = checkedText(form.get('answer') ?? '',2000,'Answer');
      attachment = form.get('photo');
      if (attachment !== null && !(attachment instanceof File)) throw [400,'Choose a photo file.'];
    } else {
      const data = await body(request);
      content = checkedText(data.answer ?? '',2000,'Answer');
    }
    const hasPhoto = Boolean(attachment?.size);
    if (!content && !hasPhoto) throw [400,'Write an answer or attach a photo.'];
    if (hasPhoto && attachment.size > PHOTO_LIMIT) throw [413,'Choose a photo smaller than 5 MB.'];
    let key = null;
    let type = null;
    if (hasPhoto) {
      if (!bucket) throw [503,'Photo uploads are temporarily unavailable.'];
      type = photoType(new Uint8Array(await attachment.slice(0,12).arrayBuffer()));
      key = 'answers/' + crypto.randomUUID();
      await bucket.put(key,await attachment.arrayBuffer(),{httpMetadata:{contentType:type}});
    }
    try {
      await run(db,`INSERT INTO answers(question_id,author_id,content,photo_key,photo_type,created_at)
        VALUES(?,?,?,?,?,?)`,id,profile.id,content || 'Photo explanation',key,type,now());
    } catch (error) {
      if (key) await bucket.delete(key).catch(() => {});
      throw error;
    }
    return json({ok:true},201);
  }
  return fail(405, 'Method not allowed.');
}

export default {async fetch(request,env){const url=new URL(request.url);try{if(url.pathname.startsWith('/api/'))return await api(request,env,url);if(request.method!=='GET')return fail(405,'Method not allowed.');const asset=ASSETS[url.pathname];if(!asset)return new Response('Not found.',{status:404});return new Response(asset.body,{headers:{'content-type':asset.type,'cache-control':'no-cache','x-content-type-options':'nosniff'}})}catch(e){if(Array.isArray(e))return fail(e[0],e[1]);if(String(e).includes('UNIQUE constraint failed'))return fail(409,'This action was already completed.');return fail(500,'Unexpected server error.')}}};
