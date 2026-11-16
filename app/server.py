"""Commonroom MVP: a small, dependency-free, SQLite-backed web app."""
from __future__ import annotations
import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
SUBJECTS = {"Mathematics", "Science", "English", "History", "Languages", "Other"}
COOKIE = "commonroom_session"

class AppError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message
        super().__init__(message)

class Store:
    def __init__(self, path):
        self.path = str(path)
        self.init()

    def db(self):
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def init(self):
        with self.db() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS study_sessions (id INTEGER PRIMARY KEY, host_id INTEGER NOT NULL REFERENCES users(id), subject TEXT NOT NULL, topic TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, completed_at INTEGER);
            CREATE TABLE IF NOT EXISTS members (session_id INTEGER NOT NULL REFERENCES study_sessions(id), user_id INTEGER NOT NULL REFERENCES users(id), joined_at INTEGER NOT NULL, PRIMARY KEY(session_id,user_id));
            CREATE TABLE IF NOT EXISTS token_events (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), session_id INTEGER NOT NULL REFERENCES study_sessions(id), kind TEXT NOT NULL, amount INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE(user_id,session_id,kind));
            CREATE TABLE IF NOT EXISTS thanks (session_id INTEGER NOT NULL REFERENCES study_sessions(id), from_user INTEGER NOT NULL REFERENCES users(id), to_user INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, PRIMARY KEY(session_id,from_user));
            """)
            # Existing MVP databases gain note fields without losing token history.
            event_columns = {r[1] for r in db.execute("PRAGMA table_info(token_events)")}
            if "note" not in event_columns:
                db.execute("ALTER TABLE token_events ADD COLUMN note TEXT NOT NULL DEFAULT ''")
            if "actor_id" not in event_columns:
                db.execute("ALTER TABLE token_events ADD COLUMN actor_id INTEGER REFERENCES users(id)")
            thanks_columns = {r[1] for r in db.execute("PRAGMA table_info(thanks)")}
            if "note" not in thanks_columns:
                db.execute("ALTER TABLE thanks ADD COLUMN note TEXT NOT NULL DEFAULT ''")

    @staticmethod
    def hash_password(password, salt):
        return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 310000).hex()

    def register(self, email, name, password):
        email = str(email).strip().lower(); name = str(name).strip()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(name) < 2 or len(name) > 60 or len(password) < 10:
            raise AppError(400, "Enter a valid email, a name of 2–60 characters, and a password of at least 10 characters.")
        salt = secrets.token_hex(16); now = int(time.time())
        try:
            with self.db() as db:
                cur = db.execute("INSERT INTO users(email,name,salt,password_hash,created_at) VALUES(?,?,?,?,?)", (email,name,salt,self.hash_password(password,salt),now))
                user_id = cur.lastrowid
        except sqlite3.IntegrityError:
            raise AppError(409, "That email is already registered.")
        return self.new_auth(user_id)

    def login(self, email, password):
        with self.db() as db:
            user = db.execute("SELECT * FROM users WHERE email=?", (str(email).strip().lower(),)).fetchone()
        if not user or not hmac.compare_digest(user['password_hash'], self.hash_password(str(password), user['salt'])):
            raise AppError(401, "Incorrect email or password.")
        return self.new_auth(user['id'])

    def new_auth(self, user_id):
        token = secrets.token_urlsafe(32)
        with self.db() as db:
            db.execute("INSERT INTO auth_sessions VALUES(?,?,?)", (hashlib.sha256(token.encode()).hexdigest(),user_id,int(time.time())+604800))
        return token

    def user_for_token(self, token):
        if not token: return None
        with self.db() as db:
            row = db.execute("SELECT u.id,u.name,u.email FROM auth_sessions a JOIN users u ON u.id=a.user_id WHERE a.token_hash=? AND a.expires_at>?", (hashlib.sha256(token.encode()).hexdigest(),int(time.time()))).fetchone()
        return dict(row) if row else None

    def logout(self, token):
        if token:
            with self.db() as db:
                db.execute("DELETE FROM auth_sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))

    def balance(self, user_id):
        with self.db() as db:
            return db.execute("SELECT COALESCE(SUM(amount),0) FROM token_events WHERE user_id=?", (user_id,)).fetchone()[0]

    def ledger(self, user_id):
        with self.db() as db:
            rows = db.execute("SELECT e.amount,e.kind,e.note,e.created_at,s.topic,s.subject,u.name actor_name FROM token_events e JOIN study_sessions s ON s.id=e.session_id LEFT JOIN users u ON u.id=e.actor_id WHERE e.user_id=? ORDER BY e.id DESC LIMIT 50", (user_id,)).fetchall()
        return [dict(r) for r in rows]

    def sessions(self, user_id):
        with self.db() as db:
            rows = db.execute("""SELECT s.id,s.subject,s.topic,s.status,s.host_id,u.name host_name,s.created_at,s.completed_at,
                (SELECT COUNT(*) FROM members m WHERE m.session_id=s.id) member_count,
                EXISTS(SELECT 1 FROM members m WHERE m.session_id=s.id AND m.user_id=?) joined,
                EXISTS(SELECT 1 FROM thanks t WHERE t.session_id=s.id AND t.from_user=?) thanked
                FROM study_sessions s JOIN users u ON u.id=s.host_id ORDER BY s.id DESC LIMIT 100""", (user_id or -1,user_id or -1)).fetchall()
        return [dict(r) for r in rows]

    def create_session(self, user_id, subject, topic):
        subject = str(subject); topic = str(topic).strip()
        if subject not in SUBJECTS or not 3 <= len(topic) <= 80:
            raise AppError(400, "Choose a subject and a topic of 3–80 characters.")
        now = int(time.time())
        with self.db() as db:
            cur = db.execute("INSERT INTO study_sessions(host_id,subject,topic,created_at) VALUES(?,?,?,?)",(user_id,subject,topic,now))
            db.execute("INSERT INTO members VALUES(?,?,?)",(cur.lastrowid,user_id,now))
            return cur.lastrowid

    def join(self, user_id, session_id):
        with self.db() as db:
            s = db.execute("SELECT status FROM study_sessions WHERE id=?",(session_id,)).fetchone()
            if not s: raise AppError(404,"Session not found.")
            if s['status'] != 'open': raise AppError(409,"This session is complete.")
            db.execute("INSERT OR IGNORE INTO members VALUES(?,?,?)",(session_id,user_id,int(time.time())))

    def complete(self, user_id, session_id):
        with self.db() as db:
            s = db.execute("SELECT host_id,status FROM study_sessions WHERE id=?",(session_id,)).fetchone()
            if not s: raise AppError(404,"Session not found.")
            if s['host_id'] != user_id: raise AppError(403,"Only the host can finish a session.")
            if s['status'] != 'open': raise AppError(409,"This session is already complete.")
            members = db.execute("SELECT user_id FROM members WHERE session_id=?",(session_id,)).fetchall()
            if len(members) < 2: raise AppError(409,"At least two students must join before the session can finish.")
            now = int(time.time())
            db.execute("UPDATE study_sessions SET status='completed',completed_at=? WHERE id=?",(now,session_id))
            for m in members:
                db.execute("INSERT INTO token_events(user_id,session_id,kind,amount,created_at) VALUES(?,?,?,?,?)",(m['user_id'],session_id,'participated',1,now))

    def participants(self, user_id, session_id):
        with self.db() as db:
            mine=db.execute("SELECT 1 FROM members WHERE session_id=? AND user_id=?",(session_id,user_id)).fetchone()
            if not mine: raise AppError(403,"Join the session first.")
            rows=db.execute("SELECT u.id,u.name FROM members m JOIN users u ON u.id=m.user_id WHERE m.session_id=? ORDER BY m.joined_at",(session_id,)).fetchall()
        return [dict(r) for r in rows]

    def thank(self, user_id, session_id, recipient_id, note=""):
        if user_id == recipient_id: raise AppError(400,"You cannot thank yourself.")
        if not isinstance(note, str) or len(note.strip()) > 240:
            raise AppError(400,"Your note must be 240 characters or fewer.")
        note = note.strip()
        with self.db() as db:
            s=db.execute("SELECT status FROM study_sessions WHERE id=?",(session_id,)).fetchone()
            if not s: raise AppError(404,"Session not found.")
            if s['status'] != 'completed': raise AppError(409,"Finish the session before thanking a helper.")
            members=db.execute("SELECT user_id FROM members WHERE session_id=? AND user_id IN (?,?)",(session_id,user_id,recipient_id)).fetchall()
            if len(members)!=2: raise AppError(403,"Both students must have joined this session.")
            now=int(time.time())
            try:
                db.execute("INSERT INTO thanks(session_id,from_user,to_user,created_at,note) VALUES(?,?,?,?,?)",(session_id,user_id,recipient_id,now,note))
            except sqlite3.IntegrityError:
                raise AppError(409,"You have already thanked someone in this session.")
            db.execute("INSERT INTO token_events(user_id,session_id,kind,amount,created_at,note,actor_id) VALUES(?,?,?,?,?,?,?)",(recipient_id,session_id,f'helped:{user_id}',3,now,note,user_id))

class Handler(BaseHTTPRequestHandler):
    store = None
    def log_message(self, fmt, *args): pass
    def token(self):
        c=SimpleCookie()
        try: c.load(self.headers.get('Cookie',''))
        except Exception: return None
        return c[COOKIE].value if COOKIE in c else None
    def user(self):
        u=self.store.user_for_token(self.token())
        if not u: raise AppError(401,"Sign in to continue.")
        return u
    def send_json(self, data, status=200, cookie=None):
        body=json.dumps(data).encode()
        self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store')
        if cookie is not None: self.send_header('Set-Cookie',f'{COOKIE}={cookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age={604800 if cookie else 0}')
        self.end_headers();self.wfile.write(body)
    def body(self):
        if self.headers.get('Content-Type','').split(';')[0] != 'application/json': raise AppError(415,"Send JSON.")
        try:
            n=int(self.headers.get('Content-Length','0'))
            if n<0 or n>10000: raise ValueError()
            value=json.loads(self.rfile.read(n))
            if not isinstance(value,dict): raise ValueError()
            return value
        except (ValueError, json.JSONDecodeError): raise AppError(400,"Invalid request body.")
    def handle_api(self):
        path=urlparse(self.path).path
        if self.command=='POST':
            origin=self.headers.get('Origin')
            host=self.headers.get('Host')
            if origin and urlparse(origin).netloc != host: raise AppError(403,"Cross-site request blocked.")
            data=self.body()
            if path=='/api/register':
                token=self.store.register(data.get('email',''),data.get('name',''),str(data.get('password','')))
                return self.send_json({'ok':True},201,token)
            if path=='/api/login':
                token=self.store.login(data.get('email',''),str(data.get('password','')))
                return self.send_json({'ok':True},200,token)
            if path=='/api/logout':
                self.store.logout(self.token());return self.send_json({'ok':True},200,'')
            user=self.user()
            if path=='/api/sessions':
                sid=self.store.create_session(user['id'],data.get('subject',''),data.get('topic',''))
                return self.send_json({'id':sid},201)
            match=re.fullmatch(r'/api/sessions/(\d+)/(join|complete|thank)',path)
            if match:
                sid=int(match.group(1));action=match.group(2)
                if action=='join': self.store.join(user['id'],sid)
                elif action=='complete': self.store.complete(user['id'],sid)
                else:
                    try: recipient=int(data.get('recipient_id'))
                    except (TypeError,ValueError): raise AppError(400,"Choose a helper.")
                    self.store.thank(user['id'],sid,recipient,data.get('note',''))
                return self.send_json({'ok':True})
            raise AppError(404,"Not found.")
        if path=='/api/me':
            user=self.store.user_for_token(self.token())
            if user: user={**user,'balance':self.store.balance(user['id'])}
            return self.send_json({'user':user})
        user=self.store.user_for_token(self.token())
        if path=='/api/sessions': return self.send_json({'sessions':self.store.sessions(user['id'] if user else None)})
        if path=='/api/ledger':
            user=self.user();return self.send_json({'events':self.store.ledger(user['id'])})
        match=re.fullmatch(r'/api/sessions/(\d+)/participants',path)
        if match:
            user=self.user();return self.send_json({'participants':self.store.participants(user['id'],int(match.group(1)))})
        raise AppError(404,"Not found.")
    def do_GET(self): self.dispatch()
    def do_POST(self): self.dispatch()
    def dispatch(self):
        try:
            if urlparse(self.path).path.startswith('/api/'): return self.handle_api()
            if self.command!='GET': raise AppError(405,"Method not allowed.")
            path=urlparse(self.path).path
            files={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js'}
            if path not in files: raise AppError(404,"Not found.")
            target=STATIC/files[path];body=target.read_bytes()
            self.send_response(200);self.send_header('Content-Type',{'html':'text/html','css':'text/css','js':'text/javascript'}[target.suffix[1:]]+'; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(body)
        except AppError as e: self.send_json({'error':e.message},e.status)
        except Exception:
            self.send_json({'error':'Unexpected server error.'},500)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--host',default='127.0.0.1');parser.add_argument('--port',type=int,default=8000);parser.add_argument('--db',default=str(ROOT/'commonroom.sqlite3'));args=parser.parse_args()
    Handler.store=Store(args.db)
    server=ThreadingHTTPServer((args.host,args.port),Handler)
    print(f'Commonroom running at http://{args.host}:{args.port}',flush=True)
    server.serve_forever()
if __name__=='__main__': main()
