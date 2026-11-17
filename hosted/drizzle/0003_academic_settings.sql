CREATE TABLE academic_settings (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id),
  curriculum TEXT NOT NULL,
  subjects TEXT NOT NULL DEFAULT '[]'
);
