const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);
const W = 1440;
const H = 1280;
const MAX_PLAYERS = 4;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString("hex");

const CHARACTERS = {
  classic: { label: "原版", attack: 0, fireMult: 0, shots: 0, pierce: 0 },
  zhouxian: { label: "周贤", attack: 0, fireMult: 2, shots: 0, pierce: 0 },
  luo: { label: "罗", attack: 0, fireMult: 0, shots: 1, pierce: 0 },
  yang: { label: "扬", attack: 200, fireMult: 0, shots: 0, pierce: 0 },
  laoyu: { label: "老玉", attack: 0, fireMult: 0, shots: 0, pierce: 1 }
};

const BALANCE = {
  player: { startAttack: 240, baseFireRate: 4.3, maxShots: 7, maxVisualShooters: 5 },
  difficulties: {
    easy: { demand: 0.56, speed: 1.1, ramp: 0.92, emergencyY: H - 420 },
    normal: { demand: 0.62, speed: 1.18, ramp: 0.96, emergencyY: H - 390 },
    hard: { demand: 1.05, speed: 1.5, ramp: 1.28, emergencyY: H - 270 }
  },
  modes: {
    "3min": { duration: 180, hp: 0.86, speed: 1.1 },
    "5min": { duration: 300, hp: 1, speed: 1 },
    infinite: { duration: Infinity, hp: 1.18, speed: 1.15 }
  },
  boss: {
    speedBase: 34,
    speedRamp: 0.5,
    speedRampTime: 120,
    headLen: 225,
    headWidth: 150,
    normalLen: [132, 420],
    rewardLen: [150, 260],
    armoredLen: [210, 360],
    normalWidth: [104, 132],
    rewardWidth: [100, 122],
    armoredWidth: [128, 150],
    minHp: 12000,
    weakMinHp: 6200,
    rewardMinHp: 8200,
    rewardChance: 0.16,
    wallChance: 0.12,
    toughChance: 0.24,
    weakChance: 0.24,
    crackChanceStart: 95,
    crackChanceMax: 0.12,
    normalKillTime: [4.8, 7.6],
    weakKillTime: [3.4, 5.2],
    crackKillTime: [1.8, 3.4],
    toughKillTime: [10, 17],
    wallKillTime: [28, 54],
    rewardKillTime: [2.8, 6.8],
    armoredKillTime: [9, 15],
    headKillTime: [8, 14],
    normalLenHpBonus: 8,
    activateDistance: -160,
    demandRatio: 0.44,
    timeHpRamp: 0.34
  },
  rewardBox: {
    startCosts: [34, 40],
    startScale: 0.9,
    scaleGrowth: 0.18,
    maxScale: 3.8,
    speedDemandScale: 0.13,
    speedProgressDecay: 0.46,
    respawnDelay: 7,
    frontRareChance: 0.035,
    jointRareChanceStart: 0.16,
    jointRareChanceDecay: 0.06,
    jointRareChanceMin: 0.07,
    emergencyCooldown: 18
  },
  upgrades: [
    { type: "attack", title: "攻击 +120", cost: 20, color: "#ffb547", score: 2, amount: 120 },
    { type: "attack", title: "攻击 +320", cost: 30, color: "#ffe05a", score: 5, amount: 320 },
    { type: "attack", title: "攻击 +760", cost: 48, color: "#71f6d1", score: 8, amount: 760 },
    { type: "speed", title: "攻速 x2", cost: 36, color: "#ffd65c", score: 6, amount: 2 },
    { type: "speed", title: "攻速 x3", cost: 52, color: "#ff8f3f", score: 8, amount: 3 },
    { type: "shot", title: "多一弹道", cost: 68, color: "#8fe3ff", score: 10, amount: 1 },
    { type: "repel", title: "击退 +180", cost: 24, color: "#63e26f", score: 3, amount: 180 },
    { type: "clone", title: "影分身", cost: 82, color: "#c9a3ff", score: 14, amount: 1, rare: true, rareWeight: 0.25 },
    { type: "pierce", title: "穿透 +1", cost: 64, color: "#9ff0ff", score: 11, amount: 1, rare: true, rareWeight: 0.45 },
    { type: "crit", title: "暴击 +25%", cost: 58, color: "#ff72b8", score: 10, amount: 0.25, rare: true, rareWeight: 1.6 }
  ]
};

const game = {
  started: false,
  over: false,
  win: false,
  difficulty: "easy",
  mode: "3min",
  duration: 180,
  infinite: false,
  time: 180,
  score: 0,
  fireTimer: 0,
  spawnTimer: 0,
  emergencyTimer: 0,
  boss: { advance: 0, spawned: 0, segments: [] },
  bullets: [],
  blocks: [],
  rewards: [],
  floating: [],
  particles: [],
  shockwaves: [],
  players: new Map(),
  clients: new Map()
};

function makePlayer(id, slot = 0, character = "classic") {
  const c = CHARACTERS[character] || CHARACTERS.classic;
  return {
    id,
    name: `P${slot + 1}`,
    slot,
    character,
    x: W / 2 + (slot - 1.5) * 88,
    y: H - 126,
    r: 34,
    hp: 1,
    input: { pointerDown: false, pointerX: W / 2, dir: 0 },
    stats: {
      attack: BALANCE.player.startAttack + c.attack,
      baseFireRate: BALANCE.player.baseFireRate,
      fireMult: c.fireMult,
      shots: 1 + c.shots,
      clones: 0,
      pierce: c.pierce,
      crit: 0,
      rareCount: 0,
      speed: 560,
      bulletSpeed: 840
    }
  };
}

function activePlayers() {
  return [...game.players.values()];
}

function elapsedTime() {
  return game.infinite ? game.time : game.duration - game.time;
}

function displayedFireMult(p) {
  return Math.max(1, p.stats.fireMult);
}

function applyUpgrade(player, upgrade) {
  if (upgrade.rare) player.stats.rareCount += 1;
  if (upgrade.type === "attack") player.stats.attack += upgrade.amount;
  if (upgrade.type === "speed") player.stats.fireMult += upgrade.amount;
  if (upgrade.type === "shot") player.stats.shots = Math.min(BALANCE.player.maxShots, player.stats.shots + upgrade.amount);
  if (upgrade.type === "clone") player.stats.clones += upgrade.amount;
  if (upgrade.type === "pierce") player.stats.pierce += upgrade.amount;
  if (upgrade.type === "crit") player.stats.crit += upgrade.amount;
  if (upgrade.type === "repel") game.boss.advance -= upgrade.amount;
}

function weightedPick(pool) {
  const total = pool.reduce((sum, item) => sum + (item.rareWeight || 1), 0);
  let roll = Math.random() * total;
  for (const item of pool) {
    roll -= item.rareWeight || 1;
    if (roll <= 0) return item;
  }
  return pool[pool.length - 1];
}

function chooseUpgrade(preferGood, preferRare, rareCount = 0) {
  const rareChance = Math.max(
    BALANCE.rewardBox.jointRareChanceMin,
    BALANCE.rewardBox.jointRareChanceStart - rareCount * BALANCE.rewardBox.jointRareChanceDecay
  );
  if (preferRare && Math.random() < rareChance) return weightedPick(BALANCE.upgrades.filter(u => u.rare));
  const pool = preferGood ? BALANCE.upgrades.filter(u => u.score >= 6) : BALANCE.upgrades.filter(u => u.score <= 4);
  return pool[Math.floor(Math.random() * pool.length)];
}

function makeRewardPair(preferRare = false, rareCount = 0) {
  const good = chooseUpgrade(true, preferRare, rareCount);
  let weak = chooseUpgrade(false, false, rareCount);
  if (weak.title === good.title) weak = chooseUpgrade(false, false, rareCount);
  return Math.random() < 0.5 ? [good, weak] : [weak, good];
}

function coopScale() {
  return Math.pow(Math.max(1, activePlayers().length), 0.75);
}

function bossTargetDps() {
  const players = activePlayers();
  const base = players.reduce((sum, p) => {
    const s = p.stats;
    return sum + s.attack * s.baseFireRate * Math.max(1, s.fireMult) * s.shots * (1 + s.clones) * (1 + s.crit) * (1 + s.pierce * 0.32);
  }, BALANCE.player.startAttack * BALANCE.player.baseFireRate);
  const difficulty = BALANCE.difficulties[game.difficulty];
  const mode = BALANCE.modes[game.mode];
  return base * BALANCE.boss.demandRatio * difficulty.demand * mode.hp * (1 + clamp(elapsedTime() / 180, 0, 1) * BALANCE.boss.timeHpRamp * difficulty.ramp) * coopScale();
}

function makeBossSegment(index) {
  const head = index === 0;
  const armored = index > 0 && index % 9 === 0;
  const reward = index > 4 && (index % 13 === 0 || Math.random() < BALANCE.boss.rewardChance);
  const elapsed = elapsedTime();
  const crackChance = elapsed < BALANCE.boss.crackChanceStart ? 0
    : Math.min(BALANCE.boss.crackChanceMax, (elapsed - BALANCE.boss.crackChanceStart) / 180 * BALANCE.boss.crackChanceMax);
  let tier = "normal";
  let killTime = rand(...BALANCE.boss.normalKillTime);
  if (head) {
    tier = "head";
    killTime = rand(...BALANCE.boss.headKillTime);
  } else if (reward) {
    tier = "reward";
    killTime = rand(...BALANCE.boss.rewardKillTime);
  } else if (!armored && Math.random() < crackChance) {
    tier = "crack";
    killTime = rand(...BALANCE.boss.crackKillTime);
  } else if (armored) {
    tier = "armored";
    killTime = rand(...BALANCE.boss.armoredKillTime);
  } else {
    const roll = Math.random();
    if (roll < BALANCE.boss.wallChance) {
      tier = "wall";
      killTime = rand(...BALANCE.boss.wallKillTime);
    } else if (roll < BALANCE.boss.wallChance + BALANCE.boss.toughChance) {
      tier = "tough";
      killTime = rand(...BALANCE.boss.toughKillTime);
    } else if (roll < BALANCE.boss.wallChance + BALANCE.boss.toughChance + BALANCE.boss.weakChance) {
      tier = "weak";
      killTime = rand(...BALANCE.boss.weakKillTime);
    }
  }
  const len = head ? BALANCE.boss.headLen
    : armored ? rand(...BALANCE.boss.armoredLen)
      : reward ? rand(...BALANCE.boss.rewardLen)
        : rand(...BALANCE.boss.normalLen) + Math.min(killTime, 8) * BALANCE.boss.normalLenHpBonus;
  const width = head ? BALANCE.boss.headWidth
    : armored ? rand(...BALANCE.boss.armoredWidth)
      : reward ? rand(...BALANCE.boss.rewardWidth)
        : rand(...BALANCE.boss.normalWidth);
  const minHp = tier === "crack" || tier === "weak" ? BALANCE.boss.weakMinHp
    : tier === "reward" ? BALANCE.boss.rewardMinHp : BALANCE.boss.minHp;
  const hp = Math.max(minHp, bossTargetDps() * killTime);
  return {
    id: uuid(),
    hp: Math.round(hp),
    maxHp: Math.round(hp),
    reward,
    armored,
    tier,
    killTime,
    tuned: true,
    hue: reward ? "#30d8ff" : head || armored || tier === "wall" ? "#ef3e38" : tier === "tough" ? "#d87930" : tier === "weak" || tier === "crack" ? "#8ee052" : "#f3cf31",
    len,
    width,
    knockback: 0,
    settle: 0,
    hit: 0
  };
}

function initBoss() {
  game.boss = { advance: 0, spawned: 0, segments: [] };
  for (let i = 0; i < 104; i++) appendBossSegment();
}

function appendBossSegment() {
  game.boss.segments.push(makeBossSegment(game.boss.spawned));
  game.boss.spawned += 1;
}

function keepBossEndless() {
  while (game.boss.segments.length < 112) appendBossSegment();
}

function bossPathPoint(distance) {
  const left = 64;
  const right = W - 64;
  const startX = W / 2;
  const topY = 34;
  const laneH = 118;
  const horizontal = right - left;
  const firstRun = right - startX;
  let d = distance;
  if (d < 0) return { x: startX, y: topY + d };
  if (d < firstRun) return { x: startX + d, y: topY + (d / firstRun) * laneH };
  d -= firstRun;
  let lane = 1;
  while (true) {
    const dir = lane % 2 === 1 ? -1 : 1;
    if (d <= horizontal) {
      const t = d / horizontal;
      return { x: dir < 0 ? right - d : left + d, y: topY + lane * laneH + t * laneH };
    }
    d -= horizontal;
    lane += 1;
  }
}

function segmentDelay(seg) {
  return (seg.knockback || 0) + (seg.settle || 0);
}

function bossSegmentPathPoint(index, local, trails) {
  const seg = game.boss.segments[index];
  const next = game.boss.segments[index + 1] || seg;
  const gap = seg.len * 0.72;
  const t = clamp(local, 0, 1);
  const delay = segmentDelay(seg) * (1 - t) + segmentDelay(next) * t;
  return bossPathPoint(game.boss.advance - trails[index] - gap * t - delay);
}

function buildBossFrameCache() {
  const segments = game.boss.segments;
  const trails = [];
  const pts = [];
  const hitboxes = [];
  let trail = 0;
  for (let i = 0; i < segments.length; i++) {
    trails[i] = trail;
    pts[i] = bossPathPoint(game.boss.advance - trail - segmentDelay(segments[i]));
    trail += segments[i].len * 0.72;
  }
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const next = segments[i + 1];
    const start = bossSegmentPathPoint(i, 0.02, trails);
    const mid = bossSegmentPathPoint(i, 0.5, trails);
    const end = bossSegmentPathPoint(i, 0.98, trails);
    const radius = ((seg.width + next.width) * 0.5) * 0.44;
    const maxRadius = radius + 16;
    hitboxes[i] = {
      seg, start, mid, end, radius,
      minX: Math.min(start.x, mid.x, end.x) - maxRadius,
      maxX: Math.max(start.x, mid.x, end.x) + maxRadius,
      minY: Math.min(start.y, mid.y, end.y) - maxRadius,
      maxY: Math.max(start.y, mid.y, end.y) + maxRadius
    };
  }
  return { pts, hitboxes };
}

function pointToSegmentDistance(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const lenSq = abx * abx + aby * aby || 1;
  const t = clamp((apx * abx + apy * aby) / lenSq, 0, 1);
  const x = a.x + abx * t;
  const y = a.y + aby * t;
  return { d: Math.hypot(p.x - x, p.y - y), x, y };
}

function bulletHitsBody(b, cache) {
  for (const box of cache.hitboxes) {
    if (!box) continue;
    const seg = box.seg;
    if (b.hitIds && b.hitIds.includes(seg.id)) continue;
    if (b.x < box.minX - b.r || b.x > box.maxX + b.r || b.y < box.minY - b.r || b.y > box.maxY + b.r) continue;
    const radius = box.radius + b.r;
    const hitA = pointToSegmentDistance(b, box.start, box.mid);
    if (hitA.d < radius) return { seg, x: hitA.x, y: hitA.y };
    const hitB = pointToSegmentDistance(b, box.mid, box.end);
    if (hitB.d < radius) return { seg, x: hitB.x, y: hitB.y };
  }
  return null;
}

function pushFloat(text, x, y, color, style = "normal") {
  if (game.floating.length > 70) game.floating.shift();
  const max = style === "crit" ? 0.9 : 0.8;
  game.floating.push({ text, x, y, color, style, life: max, max, vx: style === "damage" ? rand(-22, 22) : 0 });
}

function setupBlock(block, keepCost) {
  let pool = Math.random() < BALANCE.rewardBox.frontRareChance ? BALANCE.upgrades.filter(u => u.rare) : BALANCE.upgrades.filter(u => !u.rare);
  const other = game.blocks.find(candidate => candidate !== block);
  if (other && other.type) {
    const typedPool = pool.filter(u => u.type !== other.type);
    if (typedPool.length) pool = typedPool;
  }
  const upgrade = pool[0] && pool[0].rare ? weightedPick(pool) : pool[Math.floor(Math.random() * pool.length)];
  const nextCost = keepCost || Math.ceil(upgrade.cost * block.scale);
  Object.assign(block, { hp: nextCost, maxHp: nextCost, type: upgrade.type, title: upgrade.title, color: upgrade.color, upgrade, active: true, cooldown: 0, flash: 0 });
}

function spawnBlocks() {
  game.blocks = [0, 1].map(slot => {
    const block = {
      slot,
      x: W / 2 + (slot === 0 ? -178 : 178),
      y: H - 420,
      w: 178,
      h: 86,
      scale: BALANCE.rewardBox.startScale,
      baseCost: BALANCE.rewardBox.startCosts[slot],
      hp: 1,
      maxHp: 1,
      active: true,
      cooldown: 0,
      flash: 0
    };
    setupBlock(block, block.baseCost);
    return block;
  });
}

function resetBlock(block, player) {
  applyUpgrade(player, block.upgrade);
  pushFloat(block.title, block.x, block.y - 52, block.color);
  block.scale = Math.min(BALANCE.rewardBox.maxScale, block.scale + BALANCE.rewardBox.scaleGrowth);
  block.active = false;
  block.cooldown = BALANCE.rewardBox.respawnDelay;
  block.hp = 0;
  block.maxHp = 1;
}

function spawnRewardChoices(x, y, preferRare = false) {
  const group = uuid();
  const pair = makeRewardPair(preferRare, Math.max(0, ...activePlayers().map(p => p.stats.rareCount)));
  pair.forEach((u, i) => game.rewards.push({
    group,
    x: x + (i === 0 ? -122 : 122),
    y,
    w: 238,
    h: 128,
    vy: 125,
    title: u.title,
    color: u.color,
    upgrade: u,
    life: 8
  }));
}

function damageSegment(seg, amount, x, y, crit) {
  seg.hp -= amount;
  seg.hit = 0.28;
  pushFloat(`-${Math.round(amount)}`, x, y - (crit ? 18 : 0), crit ? "#ff5fb5" : "#fffdf2", crit ? "crit" : "damage");
  if (seg.hp > 0) return false;
  const idx = game.boss.segments.indexOf(seg);
  const wasHead = idx === 0;
  const removedTrail = seg.len * 0.72;
  game.boss.segments.splice(idx, 1);
  if (!wasHead) {
    for (let i = 0; i < idx; i++) game.boss.segments[i].knockback = (game.boss.segments[i].knockback || 0) + removedTrail;
    for (let i = idx; i < game.boss.segments.length; i++) game.boss.segments[i].settle = (game.boss.segments[i].settle || 0) + removedTrail;
  }
  keepBossEndless();
  game.score += Math.round(seg.maxHp);
  if (wasHead) game.boss.advance -= 220 + removedTrail;
  pushFloat(wasHead ? "头部击退!" : "断节!", x, y - 28, wasHead ? "#59f0ff" : "#7b2cff", "repel");
  if (seg.reward) spawnRewardChoices(x, y, true);
  return true;
}

function shootPlayer(player) {
  const p = player.stats;
  const spread = 22;
  const totalShooters = 1 + p.clones;
  const visualShooters = Math.min(totalShooters, BALANCE.player.maxVisualShooters);
  const shooterDamageScale = totalShooters / visualShooters;
  for (let s = 0; s < visualShooters; s++) {
    const shooterOffset = (s - (visualShooters - 1) / 2) * 46;
    for (let i = 0; i < p.shots; i++) {
      const offset = (i - (p.shots - 1) / 2) * spread;
      const crit = Math.random() < p.crit;
      game.bullets.push({
        x: player.x + shooterOffset + offset,
        y: player.y - 42,
        r: crit ? 10 : 8,
        vx: offset * 0.52,
        vy: -p.bulletSpeed,
        damage: p.attack * shooterDamageScale * (crit ? 2 : 1),
        crit,
        pierce: p.pierce,
        hitIds: [],
        color: crit ? "#ff72b8" : i % 2 ? "#59f0ff" : "#ffd357"
      });
    }
  }
}

function startGame(difficulty = "easy", mode = "3min") {
  game.started = true;
  game.over = false;
  game.win = false;
  game.difficulty = difficulty;
  game.mode = mode;
  game.duration = BALANCE.modes[mode].duration;
  game.infinite = mode === "infinite";
  game.time = game.infinite ? 0 : game.duration;
  game.score = 0;
  game.fireTimer = 0;
  game.spawnTimer = 0;
  game.emergencyTimer = 0;
  game.bullets = [];
  game.rewards = [];
  game.floating = [];
  game.particles = [];
  game.shockwaves = [];
  activePlayers().forEach((p, i) => {
    const fresh = makePlayer(p.id, i, p.character);
    fresh.input = p.input;
    game.players.set(p.id, fresh);
  });
  initBoss();
  spawnBlocks();
}

function update(dt) {
  if (!game.started || game.over) return;
  if (game.infinite) game.time += dt;
  else {
    game.time -= dt;
    if (game.time <= 0) {
      game.win = true;
      game.over = true;
    }
  }

  const players = activePlayers();
  for (const player of players) {
    const input = player.input || {};
    if (input.pointerDown) player.x += (input.pointerX - player.x) * Math.min(1, dt * 12);
    else player.x += (input.dir || 0) * player.stats.speed * dt;
    player.x = clamp(player.x, 58, W - 58);
  }

  game.fireTimer -= dt;
  if (game.fireTimer <= 0) {
    players.forEach(shootPlayer);
    const fastest = Math.max(1, ...players.map(p => p.stats.baseFireRate * Math.max(1, p.stats.fireMult)));
    game.fireTimer = 1 / fastest;
  }

  const difficulty = BALANCE.difficulties[game.difficulty];
  const mode = BALANCE.modes[game.mode];
  game.boss.advance += dt * (BALANCE.boss.speedBase * difficulty.speed * mode.speed * (1 + (players.length - 1) * 0.06)
    + Math.min(BALANCE.boss.speedRampTime, elapsedTime()) * BALANCE.boss.speedRamp * difficulty.ramp * mode.speed);

  updateBlocks(dt);
  updateBullets(dt);
  updateRewards(dt);
  updateEffects(dt);
  updateBossTouch();
}

function updateBlocks(dt) {
  for (const block of game.blocks) {
    block.flash = Math.max(0, block.flash - dt);
    if (!block.active) {
      block.cooldown = Math.max(0, block.cooldown - dt);
      if (block.cooldown <= 0) setupBlock(block);
    }
  }
}

function bulletReservedForBlock(b) {
  return game.blocks.some(block => block.active && b.y > block.y - block.h / 2 && b.x > block.x - block.w / 2 - b.r && b.x < block.x + block.w / 2 + b.r);
}

function updateBullets(dt) {
  let cache = null;
  for (let i = game.bullets.length - 1; i >= 0; i--) {
    const b = game.bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    let consumed = false;
    for (const block of game.blocks) {
      if (!block.active) continue;
      if (b.x > block.x - block.w / 2 && b.x < block.x + block.w / 2 && b.y > block.y - block.h / 2 && b.y < block.y + block.h / 2) {
        const player = activePlayers().sort((a, z) => Math.abs(a.x - block.x) - Math.abs(z.x - block.x))[0];
        consumed = true;
        block.hp -= 1 / Math.pow(displayedFireMult(player), BALANCE.rewardBox.speedProgressDecay);
        block.flash = 0.08;
        if (block.hp <= 0) resetBlock(block, player);
        break;
      }
    }
    if (!consumed && !bulletReservedForBlock(b)) {
      cache = cache || buildBossFrameCache();
      const hit = bulletHitsBody(b, cache);
      if (hit) {
        damageSegment(hit.seg, b.damage, hit.x, hit.y, b.crit);
        b.hitIds.push(hit.seg.id);
        if (b.pierce > 0) b.pierce -= 1;
        else consumed = true;
      }
    }
    if (consumed || b.y < -30 || b.x < -40 || b.x > W + 40) game.bullets.splice(i, 1);
  }
  for (const seg of game.boss.segments) seg.hit = Math.max(0, seg.hit - dt);
}

function updateRewards(dt) {
  for (let i = game.rewards.length - 1; i >= 0; i--) {
    const r = game.rewards[i];
    r.y += r.vy * dt;
    r.life -= dt;
    const player = activePlayers().find(p => p.x > r.x - r.w / 2 - p.r && p.x < r.x + r.w / 2 + p.r && p.y > r.y - r.h / 2 - p.r && p.y < r.y + r.h / 2 + p.r);
    if (player) {
      applyUpgrade(player, r.upgrade);
      pushFloat(r.title, player.x, player.y - 80, r.color);
      game.rewards = game.rewards.filter(other => other.group !== r.group);
      break;
    }
    if (r.life <= 0 || r.y > H - 70) game.rewards.splice(i, 1);
  }
}

function updateEffects(dt) {
  for (let i = game.floating.length - 1; i >= 0; i--) {
    const f = game.floating[i];
    f.x += (f.vx || 0) * dt;
    f.y -= 72 * dt;
    f.life -= dt;
    if (f.life <= 0) game.floating.splice(i, 1);
  }
}

function updateBossTouch() {
  const cache = buildBossFrameCache();
  const threat = cache.pts.some(p => p && p.y > H - 170);
  if (!threat) return;
  for (const player of activePlayers()) player.hp = 0;
  game.win = false;
  game.over = true;
}

function publicBlock(block) {
  const { upgrade, ...rest } = block;
  return rest;
}

function publicReward(reward) {
  const { upgrade, ...rest } = reward;
  return rest;
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    slot: player.slot,
    character: player.character,
    x: Math.round(player.x),
    y: player.y,
    r: player.r,
    hp: player.hp,
    stats: player.stats
  };
}

function snapshot() {
  return {
    started: game.started,
    over: game.over,
    win: game.win,
    difficulty: game.difficulty,
    mode: game.mode,
    duration: game.duration === Infinity ? 0 : game.duration,
    infinite: game.infinite,
    time: game.time === Infinity ? 0 : game.time,
    score: game.score,
    boss: game.boss,
    bullets: game.bullets,
    blocks: game.blocks.map(publicBlock),
    rewards: game.rewards.map(publicReward),
    floating: game.floating,
    particles: game.particles,
    shockwaves: game.shockwaves,
    players: activePlayers()
  };
}

function sendFrame(socket, data) {
  if (socket.destroyed) return;
  const payload = Buffer.from(data);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

function sendJson(socket, message) {
  sendFrame(socket, JSON.stringify(message));
}

function parseFrames(socket, chunk) {
  socket.buffer = Buffer.concat([socket.buffer || Buffer.alloc(0), chunk]);
  while (socket.buffer.length >= 2) {
    const first = socket.buffer[0];
    const second = socket.buffer[1];
    const opcode = first & 0x0f;
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (socket.buffer.length < 4) return;
      length = socket.buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (socket.buffer.length < 10) return;
      length = Number(socket.buffer.readBigUInt64BE(2));
      offset = 10;
    }
    const masked = (second & 0x80) !== 0;
    if (!masked || socket.buffer.length < offset + 4 + length) return;
    const mask = socket.buffer.slice(offset, offset + 4);
    offset += 4;
    const payload = socket.buffer.slice(offset, offset + length);
    socket.buffer = socket.buffer.slice(offset + length);
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    if (opcode === 8) return socket.end();
    if (opcode === 1) handleMessage(socket, payload.toString("utf8"));
  }
}

function handleMessage(socket, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  const player = game.players.get(socket.playerId);
  if (!player) return;
  if (msg.character && CHARACTERS[msg.character]) player.character = msg.character;
  if (msg.type === "start") {
    if (msg.character && CHARACTERS[msg.character]) player.character = msg.character;
    startGame(msg.difficulty || "easy", msg.mode || "3min");
  }
  if (msg.type === "select" && msg.character && CHARACTERS[msg.character]) {
    player.character = msg.character;
  }
  if (msg.type === "input") {
    player.input = {
      pointerDown: !!msg.pointerDown,
      pointerX: clamp(Number(msg.pointerX) || W / 2, 0, W),
      dir: clamp(Number(msg.dir) || 0, -1, 1)
    };
  }
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  if (file.endsWith(".webp")) return "image/webp";
  if (file.endsWith(".md")) return "text/markdown; charset=utf-8";
  return "application/octet-stream";
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const safePath = path.normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safePath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
    res.end(data);
  });
});

server.on("upgrade", (req, socket) => {
  if (req.url !== "/ws" || game.clients.size >= MAX_PLAYERS) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }
  const key = req.headers["sec-websocket-key"];
  const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "\r\n"
  ].join("\r\n"));
  const id = uuid();
  socket.playerId = id;
  const slot = game.clients.size;
  game.clients.set(id, socket);
  game.players.set(id, makePlayer(id, slot));
  sendJson(socket, { type: "welcome", id });
  socket.on("data", chunk => parseFrames(socket, chunk));
  socket.on("close", () => {
    game.clients.delete(id);
    game.players.delete(id);
  });
  socket.on("error", () => {});
});

setInterval(() => update(1 / 30), 1000 / 30);
setInterval(() => {
  const message = JSON.stringify({ type: "snapshot", state: snapshot() });
  for (const socket of game.clients.values()) sendFrame(socket, message);
}, 1000 / 20);

server.listen(PORT, "0.0.0.0", () => {
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === "IPv4" && !item.internal) addresses.push(item.address);
    }
  }
  console.log(`局域网联机服务器已启动: http://localhost:${PORT}`);
  for (const address of addresses) console.log(`手机访问: http://${address}:${PORT}`);
});
