// Commonroom hosted backend. The build embeds the client assets.
const ASSETS = __ASSETS__;
const SUBJECTS = new Set(['Mathematics','Science','English','History','Languages','Other']);
const json = (value, status=200) => new Response(JSON.stringify(value), {status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const fail = (status,message) => json({error:message},status);
const now = () => Math.floor(Date.now()/1000);
const identity = request => {const id=request.headers.get('oai-authenticated-user-id');return id?{id,email:request.headers.get('oai-authenticated-user-email')||''}:null};
const one = (db,sql,...args) => db.prepare(sql).bind(...args).first();
const all = async (db,sql,...args) => (await db.prepare(sql).bind(...args).all()).results;
const run = (db,sql,...args) => db.prepare(sql).bind(...args).run();
async function profile(db,auth){if(!auth)return null;const p=await one(db,'SELECT id,email,name FROM users WHERE id=?',auth.id);if(!p)return null;const b=await one(db,'SELECT COALESCE(SUM(amount),0) balance FROM token_events WHERE user_id=?',auth.id);return {...p,balance:b.balance}}
async function body(request){if(!request.headers.get('content-type')?.startsWith('application/json'))throw [415,'Send JSON.'];const raw=await request.text();if(raw.length>10000)throw [413,'Request too large.'];try{const x=JSON.parse(raw);if(x&&typeof x==='object'&&!Array.isArray(x))return x}catch{}throw [400,'Invalid request body.']}
function need(auth,p){if(!auth)throw [401,'Sign in with ChatGPT to continue.'];if(!p)throw [401,'Create your student profile to continue.']}
async function api(request,env,url){
  if(!env.DB)return fail(503,'The database is not ready.');
  const db=env.DB,path=url.pathname,auth=identity(request),p=await profile(db,auth),method=request.method;
  if(method==='GET'&&path==='/api/me')return json({authenticated:!!auth,user:p});
  if(method==='GET'&&path==='/api/sessions'){
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
    const events=await all(db,`SELECT e.amount,e.kind,e.note,e.created_at,s.topic,s.subject,u.name actor_name
      FROM token_events e JOIN study_sessions s ON s.id=e.session_id LEFT JOIN users u ON u.id=e.actor_id
      WHERE e.user_id=? ORDER BY e.id DESC LIMIT 50`,p.id);
    return json({events});
  }
  let match=path.match(/^\/api\/sessions\/(\d+)\/participants$/);
  if(method==='GET'&&match){need(auth,p);const sid=Number(match[1]);const mine=await one(db,'SELECT 1 present FROM members WHERE session_id=? AND user_id=?',sid,p.id);if(!mine)throw [403,'Join the session first.'];return json({participants:await all(db,'SELECT u.id,u.name FROM members m JOIN users u ON u.id=m.user_id WHERE m.session_id=? ORDER BY m.joined_at',sid)});}
  if(method!=='POST')return fail(404,'Not found.');
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) throw [403, 'Cross-site request blocked.'];
  const data=await body(request);
  if(path==='/api/profile'){
    if(!auth)throw [401,'Sign in with ChatGPT first.'];
    const name=String(data.name||'').trim();if(name.length<2||name.length>60)throw [400,'Name must be 2–60 characters.'];
    await run(db,'INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email',auth.id,auth.email,name,now());
    return json({ok:true});
  }
  need(auth,p);
  if(path==='/api/sessions'){
    const subject=String(data.subject||''),topic=String(data.topic||'').trim();if(!SUBJECTS.has(subject)||topic.length<3||topic.length>80)throw [400,'Choose a subject and a topic of 3–80 characters.'];
    const timestamp = now();
    const [created] = await db.batch([
      db.prepare('INSERT INTO study_sessions(host_id,subject,topic,created_at) VALUES(?,?,?,?)')
        .bind(p.id, subject, topic, timestamp),
      db.prepare('INSERT INTO members(session_id,user_id,joined_at) VALUES(last_insert_rowid(),?,?)')
        .bind(p.id, timestamp),
    ]);
    return json({id: created.meta.last_row_id}, 201);
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
    // The two statements share a transaction. No join can interleave with the award.
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
export default {async fetch(request,env){const url=new URL(request.url);try{if(url.pathname.startsWith('/api/'))return await api(request,env,url);if(request.method!=='GET')return fail(405,'Method not allowed.');const asset=ASSETS[url.pathname];if(!asset)return new Response('Not found.',{status:404});return new Response(asset.body,{headers:{'content-type':asset.type,'cache-control':'no-cache','x-content-type-options':'nosniff'}})}catch(e){if(Array.isArray(e))return fail(e[0],e[1]);if(String(e).includes('UNIQUE constraint failed'))return fail(409,'This action was already completed.');return fail(500,'Unexpected server error.')}}};
