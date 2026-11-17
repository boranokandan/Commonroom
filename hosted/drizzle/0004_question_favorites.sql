ALTER TABLE questions ADD COLUMN subject TEXT NOT NULL DEFAULT 'Other';
--> statement-breakpoint
CREATE TABLE question_favorites (
  user_id TEXT NOT NULL REFERENCES users(id),
  question_id INTEGER NOT NULL REFERENCES questions(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,question_id)
);
--> statement-breakpoint
CREATE TABLE answer_favorites (
  user_id TEXT NOT NULL REFERENCES users(id),
  answer_id INTEGER NOT NULL REFERENCES answers(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,answer_id)
);
--> statement-breakpoint
CREATE TABLE question_recognition (
  question_id INTEGER PRIMARY KEY NOT NULL REFERENCES questions(id),
  answer_id INTEGER UNIQUE NOT NULL REFERENCES answers(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  CHECK(user_id <> actor_id)
);
--> statement-breakpoint
CREATE VIEW token_activity AS
  SELECT user_id,session_id,NULL AS question_id,kind,amount,note,actor_id,created_at FROM token_events
  UNION ALL
  SELECT user_id,NULL AS session_id,question_id,'helped:question' AS kind,3 AS amount,note,actor_id,created_at FROM question_recognition;
