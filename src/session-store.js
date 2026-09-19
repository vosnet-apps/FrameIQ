import session from 'express-session';
import { db } from './db.js';

// Sessions persisted in the app's own SQLite database, so admin logins survive a restart
// or redeploy (the default MemoryStore drops them all, and leaks memory over time).
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

const selectStmt = db.prepare('SELECT data, expires FROM sessions WHERE sid = ?');
const upsertStmt = db.prepare('INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)');
const deleteStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
const touchStmt = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
const purgeStmt = db.prepare('DELETE FROM sessions WHERE expires < ?');

const expiryOf = (sess) => (sess && sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + DEFAULT_TTL_MS);

export class SqliteSessionStore extends session.Store {
  constructor() {
    super();
    purgeStmt.run(Date.now());
    setInterval(() => purgeStmt.run(Date.now()), 60 * 60 * 1000).unref();
  }

  get(sid, cb) {
    try {
      const row = selectStmt.get(sid);
      if (!row) return cb(null, null);
      if (row.expires < Date.now()) {
        deleteStmt.run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.data));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      upsertStmt.run(sid, JSON.stringify(sess), expiryOf(sess));
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      touchStmt.run(expiryOf(sess), sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      deleteStmt.run(sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }
}
