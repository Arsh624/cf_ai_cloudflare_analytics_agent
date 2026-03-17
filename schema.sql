CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT,
  signup_date TEXT
);

CREATE TABLE IF NOT EXISTS logins (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  login_time TEXT
);

INSERT OR IGNORE INTO users (id, name, signup_date) VALUES
  (1, 'Alice', '2026-03-16'),
  (2, 'Bob', '2026-03-16');

INSERT OR IGNORE INTO logins (id, user_id, login_time) VALUES
  (1, 1, '2026-03-16'),
  (2, 2, '2026-03-16');

CREATE INDEX IF NOT EXISTS idx_signup_date ON users(signup_date);
CREATE INDEX IF NOT EXISTS idx_logins_user_id ON logins(user_id);
