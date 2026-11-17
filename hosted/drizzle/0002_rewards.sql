CREATE TABLE reward_preferences (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id),
  theme TEXT NOT NULL DEFAULT 'default',
  title TEXT NOT NULL DEFAULT ''
);
