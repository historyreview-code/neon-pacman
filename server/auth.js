const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'autochest-secret-key-change-in-production';

function register(username, password, nickname) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return { error: '用户名已存在' };

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)').run(username, hash, nickname || username);
  db.prepare('INSERT INTO player_stats (user_id) VALUES (?)').run(result.lastInsertRowid);
  const token = jwt.sign({ userId: result.lastInsertRowid, username }, JWT_SECRET, { expiresIn: '7d' });
  return { token, user: { id: result.lastInsertRowid, username, nickname: nickname || username } };
}

function login(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return { error: '用户不存在' };
  if (!bcrypt.compareSync(password, user.password_hash)) return { error: '密码错误' };

  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  return { token, user: { id: user.id, username: user.username, nickname: user.nickname } };
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch { return null; }
}

function getLeaderboard(limit = 20) {
  return db.prepare(`
    SELECT u.id, u.username, u.nickname,
           ps.rating, ps.total_matches, ps.wins, ps.top3
    FROM player_stats ps
    JOIN users u ON u.id = ps.user_id
    ORDER BY ps.rating DESC
    LIMIT ?
  `).all(limit);
}

function getUserStats(userId) {
  return db.prepare(`
    SELECT ps.*, u.username, u.nickname
    FROM player_stats ps
    JOIN users u ON u.id = ps.user_id
    WHERE ps.user_id = ?
  `).get(userId);
}

function updateRatings(matchId, results) {
  // results: [{ userId, rank, playerCount }]
  const updateStmt = db.prepare('UPDATE player_stats SET rating = rating + ?, total_matches = total_matches + 1, wins = CASE WHEN ? = 1 THEN wins + 1 ELSE wins END, top3 = CASE WHEN ? <= 3 THEN top3 + 1 ELSE top3 END, highest_rating = MAX(highest_rating, rating + ?), updated_at = datetime(\'now\') WHERE user_id = ?');
  const insertMatchPlayer = db.prepare('INSERT OR REPLACE INTO match_players (match_id, user_id, rank, rating_change) VALUES (?, ?, ?, ?)');

  const transaction = db.transaction(() => {
    for (const r of results) {
      // Simple ELO-ish: top 2 gain, bottom lose
      const n = r.playerCount;
      const expected = (n - r.rank) / (n * (n - 1) / 2);
      const change = Math.round((expected - 0.2) * 40);
      updateStmt.run(change, r.rank, r.rank, change, r.userId);
      insertMatchPlayer.run(matchId, r.userId, r.rank, change);
    }
  });

  transaction();
}

module.exports = { register, login, verifyToken, getLeaderboard, getUserStats, updateRatings, JWT_SECRET };
