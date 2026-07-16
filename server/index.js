const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const auth = require('./auth');
const { GameRoom } = require('./game');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ====== REST API ======
app.post('/api/register', (req, res) => {
  const { username, password, nickname } = req.body;
  if (!username || !password) return res.status(400).json({ error: '需要用户名和密码' });
  if (username.length < 2 || password.length < 4) return res.status(400).json({ error: '用户名至少2字符，密码至少4字符' });
  const result = auth.register(username, password, nickname);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '需要用户名和密码' });
  const result = auth.login(username, password);
  if (result.error) return res.status(401).json(result);
  res.json(result);
});

app.get('/api/leaderboard', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  res.json(auth.getLeaderboard(limit));
});

app.get('/api/stats/:userId', (req, res) => {
  const stats = auth.getUserStats(parseInt(req.params.userId));
  if (!stats) return res.status(404).json({ error: '用户不存在' });
  res.json(stats);
});

// ====== WebSocket 游戏服务 ======
const waitingPlayers = []; // [{ ws, userId, username }]
const activeRooms = new Map();

function sendTo(ws, type, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...data, ts: Date.now() }));
  }
}

function broadcastToRoom(room, type, data, excludeWs = null) {
  room.players.forEach(p => {
    if (p.ws && p.ws !== excludeWs) sendTo(p.ws, type, data);
  });
}

wss.on('connection', (ws) => {
  let currentUser = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'auth') {
      const payload = auth.verifyToken(msg.token);
      if (!payload) return sendTo(ws, 'error', { message: '认证失败，请重新登录' });
      currentUser = { userId: payload.userId, username: payload.username };
      ws.userId = payload.userId;
      ws.username = payload.username;
      return sendTo(ws, 'auth_ok', { userId: payload.userId, username: payload.username });
    }

    if (!currentUser) return sendTo(ws, 'error', { message: '请先认证' });

    switch (msg.type) {
      case 'join_queue': {
        // Remove from any previous waiting
        const idx = waitingPlayers.findIndex(p => p.userId === currentUser.userId);
        if (idx >= 0) waitingPlayers.splice(idx, 1);

        waitingPlayers.push({ ws, userId: currentUser.userId, username: currentUser.username });
        sendTo(ws, 'queue_status', { position: waitingPlayers.length });
        broadcastToWaiting(`排队中${waitingPlayers.length}人...`);

        // Auto-start when 4 players ready
        if (waitingPlayers.length >= 4) {
          startMatch(waitingPlayers.splice(0, 4));
        }
        break;
      }

      case 'leave_queue': {
        const idx2 = waitingPlayers.findIndex(p => p.userId === currentUser.userId);
        if (idx2 >= 0) waitingPlayers.splice(idx2, 1);
        sendTo(ws, 'queue_left');
        break;
      }

      case 'roll_shop': {
        const room = findPlayerRoom(currentUser.userId);
        if (!room) return sendTo(ws, 'error', { message: '不在游戏中' });
        const shop = room.rollShopForPlayer(currentUser.userId);
        if (shop === null) return sendTo(ws, 'error', { message: '金币不足' });
        sendTo(ws, 'shop_rolled', { shop, gold: room.getPlayerState(currentUser.userId).gold });
        break;
      }

      case 'buy_chess': {
        const room = findPlayerRoom(currentUser.userId);
        if (!room) return sendTo(ws, 'error', { message: '不在游戏中' });
        const unit = room.buyChess(currentUser.userId, msg.shopIndex);
        if (!unit) return sendTo(ws, 'error', { message: '购买失败' });
        const player = room.getPlayerState(currentUser.userId);
        sendTo(ws, 'bought', { unit: { ...unit, merged: undefined }, bench: player.bench.map(u => ({ ...u, merged: undefined })), gold: player.gold });
        break;
      }

      case 'place_board': {
        const room = findPlayerRoom(currentUser.userId);
        if (!room) return sendTo(ws, 'error', { message: '不在游戏中' });
        room.placeOnBoard(currentUser.userId, msg.benchIndex);
        const player = room.getPlayerState(currentUser.userId);
        sendTo(ws, 'board_updated', { board: player.board, bench: player.bench });
        break;
      }

      case 'remove_board': {
        const room = findPlayerRoom(currentUser.userId);
        if (!room) return sendTo(ws, 'error', { message: '不在游戏中' });
        room.removeFromBoard(currentUser.userId, msg.boardIndex);
        const player = room.getPlayerState(currentUser.userId);
        sendTo(ws, 'board_updated', { board: player.board, bench: player.bench });
        break;
      }

      case 'ready_fight': {
        const room = findPlayerRoom(currentUser.userId);
        if (!room) return sendTo(ws, 'error', { message: '不在游戏中' });
        const player = room.getPlayerState(currentUser.userId);
        player.ready = true;
        // Check if all ready
        const alive = room.players.filter(p => !p.eliminated);
        if (alive.every(p => p.ready) && alive.length >= 2) {
          const results = room.endPickPhase();
          // Broadcast fight results to room
          broadcastToRoom(room, 'fight_results', { results, round: room.round - 1, battleLogs: room.battleLogs });
          // Send standings
          broadcastToRoom(room, 'standings', { standings: room.getStandings(), state: room.state });

          if (room.state === 'ended') {
            finalizeMatch(room);
          } else {
            // New pick phase, reset ready
            room.players.forEach(p => { p.ready = false; });
            // Give new shop
            room.players.forEach(p => {
              if (!p.eliminated) {
                p.currentShop = null;
                sendTo(p.ws, 'new_round', { round: room.round, gold: p.gold, hp: p.hp });
              }
            });
          }
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    // Remove from waiting
    const idx = waitingPlayers.findIndex(p => p.userId === currentUser?.userId);
    if (idx >= 0) waitingPlayers.splice(idx, 1);
    broadcastToWaiting('更新排队人数...');
  });
});

function broadcastToWaiting(message) {
  waitingPlayers.forEach(p => {
    sendTo(p.ws, 'queue_update', { count: waitingPlayers.length, message });
  });
}

function startMatch(players) {
  const roomId = uuidv4().slice(0, 8);
  const room = new GameRoom(roomId);
  activeRooms.set(roomId, room);

  players.forEach(p => {
    room.players.push({
      ws: p.ws,
      userId: p.userId,
      username: p.username,
      hp: 20,
      gold: 3,
      bench: [],
      board: [],
      starMap: {},
      eliminated: false,
      ready: false,
    });
  });

  room.state = 'picking';
  room.round = 1;

  // Assign ws.playerRoom for quick lookup
  players.forEach(p => { p.ws.playerRoom = roomId; });

  // Notify all players match found
  broadcastToRoom(room, 'match_start', {
    roomId,
    players: room.players.map(p => ({ userId: p.userId, username: p.username, hp: p.hp })),
    round: 1,
  });

  // Give initial shop
  room.players.forEach(p => {
    p.currentShop = null;
    setTimeout(() => {
      sendTo(p.ws, 'new_round', { round: 1, gold: p.gold, hp: p.hp });
    }, 500);
  });
}

function findPlayerRoom(userId) {
  for (const [id, room] of activeRooms) {
    if (room.players.find(p => p.userId === userId)) return room;
  }
  return null;
}

function finalizeMatch(room) {
  const standings = room.getStandings();
  const matchId = uuidv4();

  const matchLog = JSON.stringify({
    id: matchId,
    rounds: room.battleLogs,
    standings: standings.map(p => ({ userId: p.userId, username: p.username, rank: p.rank, hp: p.hp })),
  });

  const activePlayers = room.players.filter(p => p.userId > 0);
  const results = activePlayers.map(p => ({
    userId: p.userId,
    rank: standings.find(s => s.userId === p.userId)?.rank || activePlayers.length,
    playerCount: activePlayers.length,
  }));

  // Save match
  db.prepare('INSERT OR IGNORE INTO matches (id, duration_seconds, match_log) VALUES (?, ?, ?)').run(matchId, 0, matchLog);

  auth.updateRatings(matchId, results);

  // Send final to players
  broadcastToRoom(room, 'match_end', {
    matchId,
    standings: standings.map(p => ({ userId: p.userId, username: p.username, rank: p.rank, hp: p.hp })),
  });

  // Cleanup
  room.players.forEach(p => {
    if (p.ws) { p.ws.playerRoom = null; }
  });
  activeRooms.delete(room.id);
}

server.listen(PORT, () => {
  console.log(`AutoChest Battle 服务器启动在端口 ${PORT}`);
});
