// ====== 棋子库 ======
const CHESS_POOL = [
  // 名称, 费用, 生命, 攻击, 速度, 种族, 职业, 技能
  { id: 'knight', name: '骑士', cost: 1, hp: 5, atk: 2, spd: 3, race: '人族', job: '战士', skill: 'shield' },
  { id: 'archer', name: '弓箭手', cost: 1, hp: 3, atk: 3, spd: 5, race: '人族', job: '射手', skill: 'crit' },
  { id: 'mage', name: '法师', cost: 2, hp: 3, atk: 4, spd: 4, race: '精灵', job: '法师', skill: 'fireball' },
  { id: 'assassin', name: '刺客', cost: 2, hp: 2, atk: 5, spd: 7, race: '精灵', job: '刺客', skill: 'backstab' },
  { id: 'tank', name: '铁卫', cost: 2, hp: 8, atk: 1, spd: 2, race: '人族', job: '战士', skill: 'taunt' },
  { id: 'healer', name: '祭司', cost: 3, hp: 4, atk: 2, spd: 3, race: '精灵', job: '法师', skill: 'heal' },
  { id: 'necromancer', name: '死灵', cost: 3, hp: 4, atk: 4, spd: 3, race: '亡灵', job: '法师', skill: 'drain' },
  { id: 'paladin', name: '圣骑', cost: 4, hp: 7, atk: 3, spd: 3, race: '人族', job: '战士', skill: 'holy' },
  { id: 'dragon', name: '幼龙', cost: 4, hp: 8, atk: 5, spd: 4, race: '龙族', job: '战士', skill: 'breath' },
  { id: 'phoenix', name: '凤凰', cost: 5, hp: 6, atk: 6, spd: 6, race: '龙族', job: '法师', skill: 'rebirth' },
];

// ====== 技能实现 ======
const SKILLS = {
  shield: (unit, allies, enemies) => {
    if (unit.hp <= 2) { unit.shielded = true; unit.hp += 2; return '💫 圣盾触发 +2护盾'; }
    return '';
  },
  crit: (unit, allies, enemies) => {
    if (Math.random() < 0.25) { unit.atk *= 2; return '⚡ 暴击！攻击翻倍'; }
    return '';
  },
  fireball: (unit, allies, enemies) => {
    if (enemies.length > 0) {
      const target = enemies[0];
      target.hp -= 3;
      return `🔥 火球术攻击 ${target.name} (-3)`;
    }
    return '';
  },
  backstab: (unit, allies, enemies) => {
    if (enemies.length > 0) {
      const target = enemies[enemies.length - 1];
      target.hp -= 4;
      return `🗡️ 背刺 ${target.name} (-4)`;
    }
    return '';
  },
  taunt: (unit, allies, enemies) => {
    unit.taunting = true;
    return '🛡️ 嘲讽！吸引攻击';
  },
  heal: (unit, allies, enemies) => {
    const injured = allies.filter(u => u.hp < u.maxHp && u.hp > 0);
    if (injured.length > 0) {
      const target = injured.sort((a, b) => a.hp - b.hp)[0];
      target.hp = Math.min(target.maxHp, target.hp + 3);
      return `💚 治疗 ${target.name} (+3)`;
    }
    return '';
  },
  drain: (unit, allies, enemies) => {
    if (enemies.length > 0) {
      const target = enemies.sort((a, b) => a.atk - b.atk)[0];
      target.hp -= 2;
      unit.hp += 1;
      return `💀 吸魂 ${target.name} (-1 hp, 回+1)`;
    }
    return '';
  },
  holy: (unit, allies, enemies) => {
    unit.atk += 1; unit.hp += 1;
    return '✨ 圣光祝福 ATK+1 HP+1';
  },
  breath: (unit, allies, enemies) => {
    enemies.forEach(e => { e.hp -= 2; });
    return `🐉 龙息！全体敌方 -2`;
  },
  rebirth: (unit, allies, enemies) => {
    unit.rebirthReady = true;
    return '🔥 涅槃准备中...';
  },
};

// ====== 创建单位实例 ======
function createUnit(chessDef, star = 1, ownerId = 0) {
  const mult = star;
  return {
    id: `${chessDef.id}_${Math.random().toString(36).slice(2, 6)}`,
    name: chessDef.name,
    maxHp: chessDef.hp * mult,
    hp: chessDef.hp * mult,
    atk: chessDef.atk * mult,
    spd: chessDef.spd,
    race: chessDef.race,
    job: chessDef.job,
    skill: chessDef.skill,
    cost: chessDef.cost,
    star,
    ownerId,
    shielded: false,
    taunting: false,
    rebirthReady: false,
  };
}

// ====== 商店系统 ======
function rollShop(excludeIds = []) {
  const pool = CHESS_POOL.filter(c => !excludeIds.includes(c.id));
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

// ====== 自动战斗 ======
function autoBattle(unitsA, unitsB) {
  const logs = [];

  const teamA = unitsA.map(u => ({ ...u }));
  const teamB = unitsB.map(u => ({ ...u }));

  function getAlive(team) { return team.filter(u => u.hp > 0); }
  function getTargets(attacker, allies, enemies) {
    const alive = getAlive(enemies);
    if (!alive.length) return [];
    const taunting = alive.filter(u => u.taunting);
    if (taunting.length) return [taunting[0]];
    // Sort by speed desc, then hp asc (attack lowest hp first)
    return alive.sort((a, b) => b.spd - a.spd || a.hp - b.hp);
  }

  let round = 0;
  while (round < 30) { // max 30 rounds
    round++;
    const aliveA = getAlive(teamA);
    const aliveB = getAlive(teamB);
    if (!aliveA.length || !aliveB.length) break;

    // All units act by speed (both teams)
    const allUnits = [
      ...aliveA.map(u => ({ ...u, team: 'A' })),
      ...aliveB.map(u => ({ ...u, team: 'B' })),
    ].sort((a, b) => b.spd - a.spd);

    const roundLog = { round, actions: [] };

    for (const unit of allUnits) {
      const currentA = teamA.filter(u => u.hp > 0);
      const currentB = teamB.filter(u => u.hp > 0);
      if (!currentA.length || !currentB.length) break;

      const isA = unit.team === 'A';
      const allies = isA ? currentA : currentB;
      const enemies = isA ? currentB : currentA;
      const actor = allies.find(u => u.id === unit.id);
      if (!actor || actor.hp <= 0) continue;

      // Skill activation
      const skillFn = SKILLS[actor.skill];
      let skillLog = '';
      if (skillFn) {
        skillLog = skillFn(actor, allies, enemies);
      }

      // Normal attack
      const targets = getTargets(actor, allies, enemies);
      if (targets.length > 0) {
        const target = targets[0];
        const actualTarget = (isA ? teamB : teamA).find(u => u.id === target.id);
        if (actualTarget && actualTarget.hp > 0) {
          actualTarget.hp -= actor.atk;
          const actionStr = `[${unit.team}] ${actor.name} ⚔️ ${actualTarget.name} (-${actor.atk})`;
          roundLog.actions.push(skillLog ? `${actionStr} | ${skillLog}` : actionStr);
          // Rebirth check
          if (actor.rebirthReady && actor.hp <= 0) {
            actor.hp = Math.floor(actor.maxHp / 2);
            actor.rebirthReady = false;
            roundLog.actions.push(`🔥 ${actor.name} 涅槃重生！HP=${actor.hp}`);
          }
        }
      } else if (skillLog) {
        roundLog.actions.push(skillLog);
      }
    }

    if (roundLog.actions.length > 0) {
      logs.push(roundLog);
    }
  }

  const resultA = getAlive(teamA);
  const resultB = getAlive(teamB);

  return {
    winner: resultA.length > 0 ? 'A' : 'B',
    survivorA: resultA.length,
    survivorB: resultB.length,
    remainingHpA: resultA.reduce((s, u) => s + u.hp, 0),
    remainingHpB: resultB.reduce((s, u) => s + u.hp, 0),
    logs,
  };
}

// ====== 完整的游戏房间 ======
class GameRoom {
  constructor(id) {
    this.id = id;
    this.players = [];
    this.state = 'waiting'; // waiting | picking | fighting | ended
    this.round = 0;
    this.maxRounds = 8;
    this.battleLogs = [];
  }

  addPlayer(userId, username) {
    if (this.players.length >= 4) return false;
    if (this.players.find(p => p.userId === userId)) return false;
    this.players.push({
      userId, username,
      hp: 20,
      gold: 3,
      bench: [],
      board: [],
      starMap: {},
      eliminated: false,
    });
    return true;
  }

  startGame() {
    if (this.players.length < 2) return false;
    this.state = 'picking';
    this.round = 1;
    return true;
  }

  getPlayerState(userId) {
    return this.players.find(p => p.userId === userId);
  }

  rollShopForPlayer(userId) {
    const player = this.getPlayerState(userId);
    if (!player || player.gold < 1) return null;
    player.gold--;
    const onBoard = [...player.board, ...player.bench].map(u => {
      const def = CHESS_POOL.find(c => c.id === u.chessId);
      return def ? def.id : null;
    }).filter(Boolean);
    const shop = rollShop(onBoard);
    player.currentShop = shop;
    return shop;
  }

  buyChess(userId, shopIndex) {
    const player = this.getPlayerState(userId);
    if (!player || !player.currentShop) return null;
    const chess = player.currentShop[shopIndex];
    if (!chess) return null;
    if (player.gold < chess.cost) return null;

    player.gold -= chess.cost;
    const unit = createUnit(chess, 1, userId);
    unit.chessId = chess.id;

    // Try to merge stars
    const sameType = [...player.board, ...player.bench].filter(u => u.chessId === chess.id && !u.merged);
    if (sameType.length >= 2) {
      // Merge to 2-star
      const toMerge = sameType.slice(0, 2);
      toMerge.forEach(u => { u.merged = true; });
      const star2 = createUnit(chess, 2, userId);
      star2.chessId = chess.id;
      player.bench.push(star2);
    } else {
      player.bench.push(unit);
    }

    player.currentShop = null;
    return unit;
  }

  placeOnBoard(userId, benchIndex) {
    const player = this.getPlayerState(userId);
    if (!player) return false;
    const unit = player.bench[benchIndex];
    if (!unit) return false;
    if (player.board.length >= 6) return false;
    player.bench.splice(benchIndex, 1);
    player.board.push(unit);
    return true;
  }

  removeFromBoard(userId, boardIndex) {
    const player = this.getPlayerState(userId);
    if (!player) return false;
    const unit = player.board[boardIndex];
    if (!unit) return false;
    player.board.splice(boardIndex, 1);
    player.bench.push(unit);
    return true;
  }

  endPickPhase() {
    // All players lock in, start fighting
    this.state = 'fighting';
    // Generate battles (each player fights another)
    const activePlayers = this.players.filter(p => !p.eliminated);
    const results = [];

    for (let i = 0; i < activePlayers.length; i += 2) {
      if (i + 1 < activePlayers.length) {
        const pA = activePlayers[i];
        const pB = activePlayers[i + 1];
        const result = autoBattle(pA.board, pB.board);
        result.playerA = pA.userId;
        result.playerB = pB.userId;
        result.round = this.round;
        results.push(result);

        if (result.winner === 'A') {
          pB.hp -= Math.max(1, Math.floor(result.remainingHpA / 2));
          this.battleLogs.push(`R${this.round}: ${pA.username} 击败 ${pB.username}`);
        } else {
          pA.hp -= Math.max(1, Math.floor(result.remainingHpB / 2));
          this.battleLogs.push(`R${this.round}: ${pB.username} 击败 ${pA.username}`);
        }
      } else {
        // Odd player out, fights a ghost (half strength copy)
        const ghostBoard = activePlayers[i].board.map(u => ({
          ...u, hp: Math.max(1, Math.floor(u.hp / 2)),
          ownerId: -1,
        }));
        if (ghostBoard.length > 0) {
          const result = autoBattle(activePlayers[i].board, ghostBoard);
          result.playerA = activePlayers[i].userId;
          result.playerB = -1;
          result.round = this.round;
          results.push(result);
          if (result.winner === 'B') {
            activePlayers[i].hp -= Math.max(1, Math.floor(result.remainingHpB / 2));
          }
          this.battleLogs.push(`R${this.round}: ${activePlayers[i].username} 与幽灵战斗`);
        }
      }
    }

    // Eliminate players with 0 hp
    this.players.forEach(p => {
      if (p.hp <= 0) p.eliminated = true;
    });

    this.round++;

    // Check end condition
    const alive = this.players.filter(p => !p.eliminated);
    if (alive.length <= 1 || this.round > this.maxRounds) {
      this.state = 'ended';
    } else {
      // Start next pick phase with rewards
      this.state = 'picking';
      alive.forEach(p => {
        p.gold += 3 + Math.floor(p.hp / 5); // bonus gold
      });
    }

    return results;
  }

  getStandings() {
    return [...this.players]
      .sort((a, b) => {
        if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
        return b.hp - a.hp;
      })
      .map((p, i) => ({ rank: i + 1, ...p }));
  }
}

module.exports = { GameRoom, CHESS_POOL, createUnit, autoBattle, rollShop };
