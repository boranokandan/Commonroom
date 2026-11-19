ALTER TABLE answers ADD COLUMN photo_key TEXT;
--> statement-breakpoint
ALTER TABLE answers ADD COLUMN photo_type TEXT;
--> statement-breakpoint
CREATE TABLE answer_votes (
  answer_id INTEGER NOT NULL REFERENCES answers(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  vote INTEGER NOT NULL CHECK(vote IN (-1,1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(answer_id,user_id)
);
--> statement-breakpoint
CREATE TABLE answer_reports (
  answer_id INTEGER NOT NULL REFERENCES answers(id),
  reporter_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK(reason IN ('inappropriate','harassment','spam','other')),
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  PRIMARY KEY(answer_id,reporter_id)
);
