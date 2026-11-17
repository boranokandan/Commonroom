CREATE TABLE questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  photo_key TEXT UNIQUE,
  photo_type TEXT,
  created_at INTEGER NOT NULL,
  CHECK (length(content) > 0 OR photo_key IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX answers_by_question ON answers(question_id, id);
