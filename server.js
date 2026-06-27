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
const MAX_WS_MESSAGE_BYTES = 4096;
const bulletPool = [];
const missilePool = [];
const serverPointHitResult = { x: 0, y: 0 };
const serverBodyHitResult = { seg: null, x: 0, y: 0 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString("hex");
const externalBalance = (() => {
  try {
    return require("./balance.config.js");
  } catch {
    return null;
  }
})();

function mergeBalance(target, source) {
  if (!source || typeof source !== "object") return target;
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (Array.isArray(value)) {
      target[key] = value.slice();
    } else if (value && typeof value === "object") {
      const current = target[key];
      target[key] = mergeBalance(current && typeof current === "object" && !Array.isArray(current) ? current : {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function normalizeBalanceConfig(source) {
  const giantSource = source && source.ultraRareBalance && source.ultraRareBalance.giant;
  if (giantSource
    && Object.prototype.hasOwnProperty.call(giantSource, "radiusMultiplier")
    && !Object.prototype.hasOwnProperty.call(giantSource, "areaMultiplier")) {
    delete BALANCE.ultraRareBalance.giant.areaMultiplier;
  }
}

const CHARACTERS = {
  classic: { label: "原版", attack: 0, fireMult: 0, shots: 0, pierce: 0 },
  zhouxian: { label: "周贤", attack: 0, fireMult: 2, shots: 0, pierce: 0 },
  luo: { label: "罗", attack: 0, fireMult: 0, shots: 1, pierce: 0 },
  yang: { label: "扬", attack: 200, fireMult: 0, shots: 0, pierce: 0 },
  laoyu: { label: "老玉", attack: 0, fireMult: 0, shots: 0, pierce: 1 }
};

// 平衡参数默认值：服务端启动时先用这里；完整项目运行时 balance.config.js 会覆盖同名字段。
// 主要分组：玩家基础、联机倍率、超稀有概率、难度/模式、Boss血量与关节、奖励砖、词条、无限模式、性能。
const BALANCE = {
  player: { startAttack: 240, baseFireRate: 4.3, keyboardMoveSpeed: 560, pointerFollowRate: 8, maxShots: 7, maxClones: Infinity, maxPierce: Infinity, maxCrit: Infinity, maxVisualShooters: 5 },
  multiplayer: { hp: 1.08, speed: 1.02, extraHpPerPlayer: 0.035, extraSpeedPerPlayer: 0.015, rewardShareExponent: 0.46, rewardShareBossWeight: 0.65, expectedDpsWeight: 0.82 },
  network: { inputIntervalMs: 16, playerSnapshotHz: 60, worldSnapshotHz: 30, remoteInterpolationMs: 50, selfCorrectionRate: 28, bossCorrectionRate: 12 },
  // 超稀有词条参数：默认不参与Boss血量/DPS成长，只影响实际发射或命中时的偶发效果。
  ultraRareBalance: {
    bossDpsWeight: 0,
    basePerBulletChance: 0.0012,
    referenceThroughput: 43,
    throughputSoftness: 0.83,
    levelScale: 1,
    minPerBulletChance: 0.00000001,
    maxPerBulletChance: 0.02,
    giant: { areaMultiplier: 200, radiusMultiplier: 100, missileSpeed: 760, damageMultiplier: 100, chanceMultiplier: 1, color: "#ff6b3d" },
    split: { chanceMultiplier: 1.6, count: 5, damageMultiplier: 0.22, speed: 680, spread: 0.72, color: "#8ff7ff" },
    frost: { chanceMultiplier: 0.45, slowMultiplier: 0.36, duration: 0.48, color: "#9fe8ff" }
  },
  difficulties: {
    easy: { demand: 0.56, speed: 1.1, ramp: 0.92, emergencyY: H - 420 },
    normal: { demand: 0.62, speed: 1.18, ramp: 0.96, emergencyY: H - 390 },
    hard: { demand: 1.05, speed: 1.3, ramp: 1.28, emergencyY: H - 270 }
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
    headLen: 96,
    headWidth: 150,
    normalLen: [160, 340],
    rewardLen: [260, 420],
    armoredLen: [360, 540],
    normalWidth: [128, 166],
    rewardWidth: [144, 186],
    armoredWidth: [156, 198],
    minHp: 12000,
    weakMinHp: 6200,
    rewardMinHp: 8200,
    rewardChance: 0.36,
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
    headKillTime: [50, 78],
    normalLenHpBonus: 52,
    activateDistance: -160,
    demandRatio: 0.44,
    expectedRewardQuality: 0.66,
    actualDpsWeightLow: 0.32,
    actualDpsWeightHigh: 0,
    actualDpsClamp: [0.42, 1],
    timeHpRamp: 0.34
  },
  rewardBox: {
    startCosts: [34, 40],
    startScale: 0.9,
    scaleGrowth: 0.18,
    maxScale: 3.8,
    speedDemandScale: 0.13,
    speedProgressDecay: 0.46,
    modelAttention: 0.72,
    rewardJointModelInterval: 32,
    respawnDelay: 4.5,
    teammateShareRatio: 0.5,
    rareTeammateShareRatio: 0.5,
    ultraTeammateShareRatio: 0.3,
    jointDropSpeed: 170,
    frontRareChance: 0.035,
    jointRareChanceStart: 0.16,
    jointRareChanceDecay: 0.06,
    jointRareChanceMin: 0.07,
    ultraDropChance: 0.08,
    emergencyCooldown: 18,
    resetInterval: 300
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
    { type: "crit", title: "暴击 +25%", cost: 58, color: "#ff72b8", score: 10, amount: 0.25, rare: true, rareWeight: 1.6 },
    { type: "giant", title: "巨神炮", cost: 118, color: "#ff6b3d", score: 20, amount: 1, ultra: true, ultraWeight: 0.34, bossDpsWeight: 0 },
    { type: "split", title: "超稀有: 裂变弹", cost: 106, color: "#8ff7ff", score: 19, amount: 1, ultra: true, ultraWeight: 0.42, bossDpsWeight: 0 },
    { type: "frost", title: "超稀有: 霜冻弹", cost: 112, color: "#9fe8ff", score: 18, amount: 1, ultra: true, ultraWeight: 0.24, bossDpsWeight: 0 }
  ],
  infinite: {
    afterSeconds: 300,
    hpLateGrowth: 0.08,
    hpSoftCapMultiplier: 1.18,
    speedLateMultiplier: 0.82
  },
  performance: {
    collisionBucketSize: 180,
    collisionActiveMargin: 260,
    maxHitTestsPerBullet: 18,
    maxGiantHitTestsPerBullet: 48,
    blockReserveRadiusCap: 48,
    particleCap: 260,
    floatTextCap: 70,
    shockwaveCap: 18,
    lowPriorityParticleHeadroom: 36
  }
};

mergeBalance(BALANCE, externalBalance);
normalizeBalanceConfig(externalBalance);

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
  headKills: 0,
  headKillGoal: 10,
  nextBlockResetAt: 300,
  fireTimer: 0,
  spawnTimer: 0,
  emergencyTimer: 0,
  lateHpSoftCap: 0,
  boss: { advance: 0, spawned: 0, segments: [], revision: 0, freezeTimer: 0 },
  bullets: [],
  missiles: [],
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
    lastInputSeq: 0,
    lastClientXAt: 0,
    stats: {
      attack: BALANCE.player.startAttack + c.attack,
      baseFireRate: BALANCE.player.baseFireRate,
      fireMult: c.fireMult,
      shots: 1 + c.shots,
      clones: 0,
      pierce: c.pierce,
      crit: 0,
      critDamage: 0,
      giantLevel: 0,
      splitLevel: 0,
      frostLevel: 0,
      rareCount: 0,
      speed: BALANCE.player.keyboardMoveSpeed,
      bulletSpeed: 840
    }
  };
}

function activePlayers() {
  return [...game.players.values()];
}

function isValidPlayer(player) {
  return !!(player && player.stats);
}

function validPlayers() {
  return activePlayers().filter(isValidPlayer);
}

function validDifficulty(value, fallback = game.difficulty || "easy") {
  return BALANCE.difficulties[value] ? value : (BALANCE.difficulties[fallback] ? fallback : "easy");
}

function validMode(value, fallback = game.mode || "3min") {
  return BALANCE.modes[value] ? value : (BALANCE.modes[fallback] ? fallback : "3min");
}

function lobbyOpen() {
  return !game.started || game.over;
}

function elapsedTime() {
  return game.infinite ? game.time : game.duration - game.time;
}

function displayedFireMult(p) {
  return Math.max(1, isValidPlayer(p) ? p.stats.fireMult : 1);
}

function bumpBossRevision() {
  if (!game.boss) return;
  game.boss.revision = (game.boss.revision || 0) + 1;
}

function scaledUpgrade(upgrade, ratio) {
  if (!upgrade || ratio === 1) return upgrade;
  return { ...upgrade, amount: upgrade.amount * ratio };
}

function applyUpgrade(player, upgrade, ratio = 1) {
  if (!isValidPlayer(player) || !upgrade) return false;
  const scaled = scaledUpgrade(upgrade, ratio);
  if (scaled.rare) player.stats.rareCount += ratio;
  if (scaled.type === "attack") player.stats.attack += scaled.amount;
  if (scaled.type === "speed") player.stats.fireMult += scaled.amount;
  if (scaled.type === "shot") player.stats.shots = Math.min(BALANCE.player.maxShots, player.stats.shots + scaled.amount);
  if (scaled.type === "clone") player.stats.clones += scaled.amount;
  if (scaled.type === "pierce") player.stats.pierce += scaled.amount;
  if (scaled.type === "crit") {
    const nextCrit = player.stats.crit + scaled.amount;
    player.stats.crit = Math.min(1, nextCrit);
    player.stats.critDamage = (player.stats.critDamage || 0) + Math.max(0, nextCrit - 1);
  }
  if (scaled.type === "giant") player.stats.giantLevel = (player.stats.giantLevel || 0) + scaled.amount;
  if (scaled.type === "split") player.stats.splitLevel = (player.stats.splitLevel || 0) + scaled.amount;
  if (scaled.type === "frost") player.stats.frostLevel = (player.stats.frostLevel || 0) + scaled.amount;
  if (scaled.type === "repel") {
    game.boss.advance -= scaled.amount;
    bumpBossRevision();
  }
  return true;
}

function teammateShareRatio(upgrade, fallback = 0) {
  if (!upgrade) return 0;
  if (upgrade.ultra) return BALANCE.rewardBox.ultraTeammateShareRatio ?? fallback;
  if (upgrade.rare) return BALANCE.rewardBox.rareTeammateShareRatio ?? fallback;
  return BALANCE.rewardBox.teammateShareRatio ?? fallback;
}

function shareUpgradeToTeammates(owner, upgrade, fallbackRatio = 0) {
  const ratio = teammateShareRatio(upgrade, fallbackRatio);
  if (!ratio) return;
  for (const teammate of validPlayers()) {
    if (teammate === owner) continue;
    applyUpgrade(teammate, upgrade, ratio);
    pushFloat(`${upgrade.title} x${ratio}`, teammate.x, teammate.y - 104, upgrade.color);
  }
}

function weightedPick(pool, weightKey = "rareWeight") {
  const total = pool.reduce((sum, item) => sum + (item[weightKey] || 1), 0);
  let roll = Math.random() * total;
  for (const item of pool) {
    roll -= item[weightKey] || 1;
    if (roll <= 0) return item;
  }
  return pool[pool.length - 1];
}

function chooseUpgrade(preferGood, preferRare, rareCount = 0) {
  const rareChance = Math.max(
    BALANCE.rewardBox.jointRareChanceMin,
    BALANCE.rewardBox.jointRareChanceStart - rareCount * BALANCE.rewardBox.jointRareChanceDecay
  );
  if (preferRare && Math.random() < rareChance) {
    const rare = BALANCE.upgrades.filter(u => u.rare && !u.ultra);
    if (rare.length) return weightedPick(rare);
  }
  const pool = preferGood
    ? BALANCE.upgrades.filter(u => !u.ultra && u.score >= 6)
    : BALANCE.upgrades.filter(u => !u.ultra && u.score <= 4);
  return pool[Math.floor(Math.random() * pool.length)];
}

function chooseUltraUpgrade() {
  const pool = BALANCE.upgrades.filter(u => u.ultra);
  return pool.length ? weightedPick(pool, "ultraWeight") : null;
}

function makeRewardPair(preferRare = false, rareCount = 0) {
  const good = chooseUpgrade(true, preferRare, rareCount);
  let weak = chooseUpgrade(false, false, rareCount);
  if (weak.title === good.title) weak = chooseUpgrade(false, false, rareCount);
  const pair = Math.random() < 0.5 ? [good, weak] : [weak, good];
  if (preferRare && Math.random() < (BALANCE.rewardBox.ultraDropChance || 0)) {
    const ultra = chooseUltraUpgrade();
    if (ultra) pair.push(ultra);
  }
  return pair;
}

function coopScale() {
  return 1 + Math.max(0, validPlayers().length - 1) * BALANCE.multiplayer.extraHpPerPlayer;
}

function playerStartStats(characterKey = "classic") {
  const character = CHARACTERS[characterKey] || CHARACTERS.classic;
  return {
    attack: BALANCE.player.startAttack + character.attack,
    baseFireRate: BALANCE.player.baseFireRate,
    fireMult: character.fireMult,
    shots: 1 + character.shots,
    clones: 0,
    pierce: character.pierce,
    crit: 0,
    critDamage: 0,
    giantLevel: 0,
    splitLevel: 0,
    frostLevel: 0
  };
}

function applyUpgradeStats(stats, upgrade) {
  if (!upgrade) return;
  if (upgrade.type === "attack") stats.attack += upgrade.amount;
  if (upgrade.type === "speed") stats.fireMult += upgrade.amount;
  if (upgrade.type === "shot") stats.shots = Math.min(BALANCE.player.maxShots, stats.shots + upgrade.amount);
  if (upgrade.type === "clone") stats.clones = Math.min(BALANCE.player.maxClones, stats.clones + upgrade.amount);
  if (upgrade.type === "pierce") stats.pierce = Math.min(BALANCE.player.maxPierce, stats.pierce + upgrade.amount);
  if (upgrade.type === "crit") {
    const nextCrit = stats.crit + upgrade.amount;
    stats.crit = Math.min(1, nextCrit);
    stats.critDamage = (stats.critDamage || 0) + Math.max(0, nextCrit - 1);
  }
  if (upgrade.type === "giant") stats.giantLevel = (stats.giantLevel || 0) + upgrade.amount;
  if (upgrade.type === "split") stats.splitLevel = (stats.splitLevel || 0) + upgrade.amount;
  if (upgrade.type === "frost") stats.frostLevel = (stats.frostLevel || 0) + upgrade.amount;
}

function statsDps(stats) {
  const critMult = 1 + Math.min(1, stats.crit) * (1 + (stats.critDamage || 0));
  return stats.attack * stats.baseFireRate * Math.max(1, stats.fireMult) * Math.max(1, Math.floor(stats.shots))
    * (1 + Math.max(0, Math.floor(stats.clones))) * critMult * (1 + Math.max(0, Math.floor(stats.pierce)) * 0.32);
}

function playerDps(player) {
  return isValidPlayer(player) ? statsDps(player.stats) : statsDps(playerStartStats());
}

function simulatedFullRewardDps(characterKey, seconds, rewardEfficiency = 1) {
  const stats = playerStartStats(characterKey);
  const modelUpgrades = BALANCE.upgrades.filter(u => !u.rare && !u.ultra);
  const strong = modelUpgrades.filter(u => u.score >= 5);
  const fallback = modelUpgrades;
  const slots = BALANCE.rewardBox.startCosts.map((cost, i) => ({
    readyAt: 0,
    scale: BALANCE.rewardBox.startScale,
    baseCost: cost,
    index: i
  }));
  let time = 0;
  let rewardCount = 0;
  let nextJointReward = BALANCE.rewardBox.rewardJointModelInterval;

  while (time < seconds) {
    const slot = slots.reduce((best, item) => item.readyAt < best.readyAt ? item : best, slots[0]);
    time = Math.max(time, slot.readyAt);
    if (time >= seconds) break;
    const useStrong = (rewardCount / Math.max(1, rewardCount + 6)) < BALANCE.boss.expectedRewardQuality;
    const pool = useStrong ? strong : fallback;
    const upgrade = pool[rewardCount % pool.length];
    const speed = Math.max(1, stats.fireMult);
    const demand = Math.ceil(upgrade.cost * slot.scale * (1 + Math.max(0, speed - 1) * BALANCE.rewardBox.speedDemandScale));
    const hitsPerSecond = BALANCE.player.baseFireRate * speed * Math.max(1, Math.floor(stats.shots)) * (1 + Math.max(0, Math.floor(stats.clones)));
    const progressPerSecond = hitsPerSecond
      * (1 / Math.pow(speed, BALANCE.rewardBox.speedProgressDecay))
      * BALANCE.rewardBox.modelAttention
      * rewardEfficiency;
    time += demand / Math.max(1, progressPerSecond);
    if (time > nextJointReward) {
      const jointPool = modelUpgrades.filter(u => u.score >= 5);
      applyUpgradeStats(stats, jointPool[rewardCount % jointPool.length]);
      nextJointReward += BALANCE.rewardBox.rewardJointModelInterval;
    }
    applyUpgradeStats(stats, upgrade);
    slot.scale = Math.min(BALANCE.rewardBox.maxScale, slot.scale + BALANCE.rewardBox.scaleGrowth);
    slot.readyAt = time + BALANCE.rewardBox.respawnDelay;
    rewardCount += 1;
  }

  return statsDps(stats);
}

function expectedTeamDps(sampleElapsed = elapsedTime()) {
  const players = validPlayers();
  const team = players.length ? players : [makePlayer("model", 0, "classic")];
  const difficulty = BALANCE.difficulties[game.difficulty];
  const playerCount = Math.max(1, team.length);
  const shareRatio = Math.max(
    BALANCE.rewardBox.teammateShareRatio || 0,
    BALANCE.rewardBox.rareTeammateShareRatio || 0,
    BALANCE.rewardBox.ultraTeammateShareRatio || 0
  );
  const shareBossScale = 1 + Math.max(0, playerCount - 1) * shareRatio * (BALANCE.multiplayer.rewardShareBossWeight || 0);
  const rewardEfficiency = Math.pow(playerCount, -BALANCE.multiplayer.rewardShareExponent) * shareBossScale;
  const expected = team.reduce((sum, player) => {
    const startStats = playerStartStats(player.character);
    const floor = statsDps(startStats) * 7;
    const modeled = simulatedFullRewardDps(player.character, sampleElapsed, rewardEfficiency)
      * BALANCE.boss.demandRatio
      * difficulty.demand;
    return sum + Math.max(floor, modeled);
  }, 0);
  const startFloor = team.reduce((sum, player) => sum + statsDps(playerStartStats(player.character)) * 7, 0);
  return Math.max(startFloor, expected * BALANCE.multiplayer.expectedDpsWeight);
}

function actualTeamDps() {
  const players = validPlayers();
  return players.length ? players.reduce((sum, player) => sum + playerDps(player), 0) : statsDps(playerStartStats());
}

function applyInfiniteHpBalance(target, sampleElapsed = elapsedTime()) {
  if (game.mode !== "infinite") return target;
  const late = Math.max(0, sampleElapsed - BALANCE.infinite.afterSeconds);
  if (late <= 0) return target;
  const targetAtSoftCap = expectedTeamDps(BALANCE.infinite.afterSeconds)
    * BALANCE.modes.infinite.hp
    * (1 + clamp(BALANCE.infinite.afterSeconds / 180, 0, 1) * BALANCE.boss.timeHpRamp * BALANCE.difficulties[game.difficulty].ramp)
    * coopScale()
    * BALANCE.multiplayer.hp;
  const cap = targetAtSoftCap * BALANCE.infinite.hpSoftCapMultiplier;
  const lateGrowth = 1 + (late / 180) * BALANCE.infinite.hpLateGrowth;
  return Math.min(target, cap * lateGrowth);
}

function bossTargetDps() {
  const nowElapsed = elapsedTime();
  const expected = expectedTeamDps(nowElapsed);
  const actual = actualTeamDps();
  const [minRatio, maxRatio] = BALANCE.boss.actualDpsClamp;
  const clampedActual = clamp(actual, expected * minRatio, expected * maxRatio);
  const weight = actual > expected ? BALANCE.boss.actualDpsWeightHigh : BALANCE.boss.actualDpsWeightLow;
  const blended = expected * (1 - weight) + clampedActual * weight;
  const difficulty = BALANCE.difficulties[game.difficulty];
  const mode = BALANCE.modes[game.mode];
  const target = blended * mode.hp
    * (1 + clamp(nowElapsed / 180, 0, 1) * BALANCE.boss.timeHpRamp * difficulty.ramp) * coopScale() * BALANCE.multiplayer.hp;
  return applyInfiniteHpBalance(target, nowElapsed);
}

function bossAdvanceSpeed() {
  const players = validPlayers();
  const difficulty = BALANCE.difficulties[game.difficulty];
  const mode = BALANCE.modes[game.mode];
  const nowElapsed = elapsedTime();
  let speed = BALANCE.boss.speedBase * difficulty.speed * mode.speed * BALANCE.multiplayer.speed * (1 + Math.max(0, players.length - 1) * BALANCE.multiplayer.extraSpeedPerPlayer)
    + Math.min(BALANCE.boss.speedRampTime, nowElapsed) * BALANCE.boss.speedRamp * difficulty.ramp * mode.speed;
  if (game.mode === "infinite" && nowElapsed > BALANCE.infinite.afterSeconds) {
    speed *= BALANCE.infinite.speedLateMultiplier;
  }
  if (game.boss.freezeTimer > 0) speed *= BALANCE.ultraRareBalance.frost.slowMultiplier;
  return speed;
}

function makeBossSegment(index) {
  const head = index === 0;
  const armored = index > 0 && index % 9 === 0;
  const reward = head || (index > 4 && (index % 13 === 0 || Math.random() < BALANCE.boss.rewardChance));
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
    tuned: false,
    hue: reward ? "#30d8ff" : head || armored || tier === "wall" ? "#ef3e38" : tier === "tough" ? "#d87930" : tier === "weak" || tier === "crack" ? "#8ee052" : "#f3cf31",
    len,
    width,
    knockback: 0,
    settle: 0,
    hit: 0
  };
}

function promoteFrontSegmentToHead() {
  const seg = game.boss.segments[0];
  if (!seg) return;
  seg.reward = true;
  seg.armored = true;
  seg.tier = "head";
  seg.killTime = rand(...BALANCE.boss.headKillTime);
  seg.len = BALANCE.boss.headLen;
  seg.width = Math.min(seg.width || BALANCE.boss.headWidth, BALANCE.boss.headWidth);
  seg.hue = "#ef3e38";
  seg.tuned = false;
}

function initBoss() {
  game.boss = { advance: 0, spawned: 0, segments: [], revision: 0, freezeTimer: 0 };
  for (let i = 0; i < 104; i++) appendBossSegment();
  promoteFrontSegmentToHead();
}

function appendBossSegment() {
  game.boss.segments.push(makeBossSegment(game.boss.spawned));
  game.boss.spawned += 1;
}

function keepBossEndless() {
  while (game.boss.segments.length < 112) appendBossSegment();
}

function tuneIncomingBossSegments() {
  const dps = bossTargetDps();
  let trail = 0;
  for (let i = 0; i < game.boss.segments.length; i++) {
    const seg = game.boss.segments[i];
    if (!seg) continue;
    if (!seg.tuned && game.boss.advance - trail - segmentDelay(seg) >= BALANCE.boss.activateDistance) {
      const minHp = seg.tier === "crack" || seg.tier === "weak" ? BALANCE.boss.weakMinHp
        : seg.tier === "reward" ? BALANCE.boss.rewardMinHp : BALANCE.boss.minHp;
      const hp = Math.max(minHp, dps * seg.killTime);
      seg.hp = Math.round(hp);
      seg.maxHp = seg.hp;
      seg.tuned = true;
    }
    trail += seg.len * 0.72;
  }
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
  const cache = { pts, hitboxes, collisionBuckets: null, collisionToken: 0, candidates: [] };
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
      index: i, seg, start, mid, end, radius,
      minX: Math.min(start.x, mid.x, end.x) - maxRadius,
      maxX: Math.max(start.x, mid.x, end.x) + maxRadius,
      minY: Math.min(start.y, mid.y, end.y) - maxRadius,
      maxY: Math.max(start.y, mid.y, end.y) + maxRadius
    };
  }
  return cache;
}

function collisionCell(value) {
  return Math.floor(value / BALANCE.performance.collisionBucketSize);
}

function collisionKey(x, y) {
  return `${x},${y}`;
}

function buildCollisionBuckets(cache) {
  cache.collisionBuckets = new Map();
  const margin = BALANCE.performance.collisionActiveMargin;
  for (const box of cache.hitboxes) {
    if (!box || box.maxY < -margin || box.minY > H + margin) continue;
    const minX = collisionCell(box.minX);
    const maxX = collisionCell(box.maxX);
    const minY = collisionCell(box.minY);
    const maxY = collisionCell(box.maxY);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const key = collisionKey(x, y);
        let bucket = cache.collisionBuckets.get(key);
        if (!bucket) {
          bucket = [];
          cache.collisionBuckets.set(key, bucket);
        }
        bucket.push(box);
      }
    }
  }
}

function ensureCollisionBuckets(cache) {
  if (!cache.collisionBuckets) buildCollisionBuckets(cache);
}

function boxDistanceSq(p, box) {
  const x = p.x < box.minX ? box.minX : p.x > box.maxX ? box.maxX : p.x;
  const y = p.y < box.minY ? box.minY : p.y > box.maxY ? box.maxY : p.y;
  const dx = p.x - x;
  const dy = p.y - y;
  return dx * dx + dy * dy;
}

function collisionCandidates(b, cache) {
  ensureCollisionBuckets(cache);
  const minX = collisionCell(b.x - b.r);
  const maxX = collisionCell(b.x + b.r);
  const minY = collisionCell(b.y - b.r);
  const maxY = collisionCell(b.y + b.r);
  const token = ++cache.collisionToken;
  const candidates = cache.candidates || (cache.candidates = []);
  candidates.length = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const bucket = cache.collisionBuckets.get(collisionKey(x, y));
      if (!bucket) continue;
      for (const box of bucket) {
        if (box.seenToken === token) continue;
        box.seenToken = token;
        candidates.push(box);
      }
    }
  }
  const maxCandidates = b.giant
    ? (BALANCE.performance.maxGiantHitTestsPerBullet || BALANCE.performance.maxHitTestsPerBullet)
    : BALANCE.performance.maxHitTestsPerBullet;
  if (candidates.length > maxCandidates) {
    candidates.sort((a, z) => boxDistanceSq(b, a) - boxDistanceSq(b, z) || a.index - z.index);
    candidates.length = maxCandidates;
  }
  return candidates;
}

function bulletAlreadyHit(b, id) {
  return b.hitIds && b.hitIds[id];
}

function markBulletHit(b, id) {
  if (!b.hitIds) b.hitIds = Object.create(null);
  b.hitIds[id] = true;
}

function pointToSegmentHit(p, a, b, radius, out) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const lenSq = abx * abx + aby * aby || 1;
  const t = clamp((apx * abx + apy * aby) / lenSq, 0, 1);
  const x = a.x + abx * t;
  const y = a.y + aby * t;
  const dx = p.x - x;
  const dy = p.y - y;
  if (dx * dx + dy * dy >= radius * radius) return false;
  out.x = x;
  out.y = y;
  return true;
}

function bulletHitsBody(b, cache) {
  for (const box of collisionCandidates(b, cache)) {
    if (!box) continue;
    const seg = box.seg;
    if (bulletAlreadyHit(b, seg.id)) continue;
    if (b.x < box.minX - b.r || b.x > box.maxX + b.r || b.y < box.minY - b.r || b.y > box.maxY + b.r) continue;
    const radius = box.radius + b.r;
    if (pointToSegmentHit(b, box.start, box.mid, radius, serverPointHitResult)) {
      serverBodyHitResult.seg = seg;
      serverBodyHitResult.x = serverPointHitResult.x;
      serverBodyHitResult.y = serverPointHitResult.y;
      return serverBodyHitResult;
    }
    if (pointToSegmentHit(b, box.mid, box.end, radius, serverPointHitResult)) {
      serverBodyHitResult.seg = seg;
      serverBodyHitResult.x = serverPointHitResult.x;
      serverBodyHitResult.y = serverPointHitResult.y;
      return serverBodyHitResult;
    }
  }
  return null;
}

function pushFloat(text, x, y, color, style = "normal") {
  if (game.floating.length > BALANCE.performance.floatTextCap) game.floating.shift();
  const max = style === "crit" ? 0.9 : 0.8;
  game.floating.push({ text, x, y, color, style, life: max, max, vx: style === "damage" ? rand(-22, 22) : 0 });
}

function setupBlock(block, keepCost) {
  let pool = Math.random() < BALANCE.rewardBox.frontRareChance
    ? BALANCE.upgrades.filter(u => u.rare && !u.ultra)
    : BALANCE.upgrades.filter(u => !u.rare && !u.ultra);
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

function resetBlockDemandGrowth() {
  for (const block of game.blocks) {
    if (!block || block.emergency) continue;
    block.scale = BALANCE.rewardBox.startScale;
    const resetCost = block.baseCost || BALANCE.rewardBox.startCosts[block.slot] || BALANCE.rewardBox.startCosts[0];
    if (block.active) {
      block.hp = Math.min(block.hp, resetCost);
      block.maxHp = resetCost;
    }
  }
  pushFloat("砖头需求重置", W / 2, H - 500, "#8ff7ff");
}

function updateBlockDemandReset() {
  const interval = BALANCE.rewardBox.resetInterval;
  if (!interval) return;
  const elapsed = elapsedTime();
  while (elapsed >= game.nextBlockResetAt) {
    resetBlockDemandGrowth();
    game.nextBlockResetAt += interval;
  }
}

function resetBlock(block, player) {
  if (!applyUpgrade(player, block.upgrade)) return false;
  shareUpgradeToTeammates(player, block.upgrade, BALANCE.rewardBox.teammateShareRatio);
  pushFloat(block.title, block.x, block.y - 52, block.color);
  block.scale = Math.min(BALANCE.rewardBox.maxScale, block.scale + BALANCE.rewardBox.scaleGrowth);
  block.active = false;
  block.cooldown = BALANCE.rewardBox.respawnDelay;
  block.hp = 0;
  block.maxHp = 1;
  return true;
}

function spawnRewardChoices(x, y, preferRare = false) {
  const group = uuid();
  const pair = makeRewardPair(preferRare, Math.max(0, ...validPlayers().map(p => p.stats.rareCount)));
  const center = clamp(x, 250, W - 250);
  const gap = pair.length === 3 ? 184 : 244;
  pair.forEach((u, i) => game.rewards.push({
    id: uuid(),
    group,
    x: center + (i - (pair.length - 1) / 2) * gap,
    y,
    w: 238,
    h: 128,
    vy: BALANCE.rewardBox.jointDropSpeed,
    title: u.title,
    color: u.color,
    upgrade: u,
    life: 8
  }));
}

function damageSegment(seg, amount, x, y, crit) {
  if (!seg) return false;
  const idx = game.boss.segments.indexOf(seg);
  if (idx < 0) return false;
  seg.hp -= amount;
  seg.hit = Math.max(seg.hit || 0, 0.28);
  pushFloat(`-${Math.round(amount)}`, x, y - (crit ? 18 : 0), crit ? "#ff5fb5" : "#fffdf2", crit ? "crit" : "damage");
  if (seg.hp > 0) return false;
  const wasHead = idx === 0;
  const removedTrail = seg.len * 0.72;
  game.boss.segments.splice(idx, 1);
  bumpBossRevision();
  if (!wasHead) {
    for (let i = 0; i < idx; i++) {
      const item = game.boss.segments[i];
      if (item) item.knockback = (item.knockback || 0) + removedTrail;
    }
    for (let i = idx; i < game.boss.segments.length; i++) {
      const item = game.boss.segments[i];
      if (item) item.settle = (item.settle || 0) + removedTrail;
    }
  }
  keepBossEndless();
  game.score += Math.round(seg.maxHp);
  if (wasHead) {
    game.headKills += 1;
    game.boss.advance -= 220 + removedTrail;
    spawnRewardChoices(x, y, true);
    if (game.headKills >= game.headKillGoal) {
      game.win = true;
      game.over = true;
    } else {
      promoteFrontSegmentToHead();
    }
  }
  pushFloat(wasHead ? "头部击退!" : "断节!", x, y - 28, wasHead ? "#59f0ff" : "#7b2cff", "repel");
  if (seg.reward && !wasHead) spawnRewardChoices(x, y, true);
  return true;
}

function shootPlayer(player) {
  if (!isValidPlayer(player)) return;
  const p = player.stats;
  const spread = 22;
  const shots = Math.max(1, Math.floor(p.shots));
  const totalShooters = 1 + Math.max(0, Math.floor(p.clones));
  const visualShooters = Math.min(totalShooters, BALANCE.player.maxVisualShooters);
  const shooterDamageScale = totalShooters / visualShooters;
  const shotMid = (shots - 1) / 2;
  const critChance = Math.min(1, p.crit);
  const critDamage = 2 + (p.critDamage || 0);
  const baseDamage = p.attack * shooterDamageScale;
  const ultra = ultraChances(p);
  const ultraCfg = BALANCE.ultraRareBalance;
  for (let s = 0; s < visualShooters; s++) {
    const shooterOffset = (s - (visualShooters - 1) / 2) * 46;
    for (let i = 0; i < shots; i++) {
      const offset = (i - shotMid) * spread;
      const crit = Math.random() < critChance;
      const giant = Math.random() < ultra.giant;
      const split = Math.random() < ultra.split;
      const frost = Math.random() < ultra.frost;
      const critMult = crit ? critDamage : 1;
      if (giant) {
        game.missiles.push(makeGiantMissile(
          player.id,
          player.x + shooterOffset + offset,
          player.y - 42,
          offset * 0.36,
          -Math.max(p.bulletSpeed, ultraCfg.giant.missileSpeed || p.bulletSpeed),
          baseDamage * critMult * ultraCfg.giant.damageMultiplier
        ));
        continue;
      }
      game.bullets.push(makeBullet(
        player.id,
        player.x + shooterOffset + offset,
        player.y - 42,
        crit ? 10 : 8,
        offset * 0.52,
        -p.bulletSpeed,
        baseDamage * critMult,
        crit,
        Math.max(0, Math.floor(p.pierce)),
        frost ? ultraCfg.frost.color : split ? ultraCfg.split.color : crit ? "#ff72b8" : i % 2 ? "#59f0ff" : "#ffd357",
        split,
        frost,
        false
      ));
    }
  }
}

function ultraChances(stats) {
  const cfg = BALANCE.ultraRareBalance;
  const fireRate = stats.baseFireRate * Math.max(1, stats.fireMult);
  const throughput = Math.max(1, fireRate * Math.max(1, Math.floor(stats.shots)) * Math.max(1, 1 + Math.max(0, Math.floor(stats.clones || 0))));
  const reference = Math.max(1, cfg.referenceThroughput);
  const throughputScale = Math.pow(throughput / reference, cfg.throughputSoftness);
  const chanceFor = (kind, level) => {
    if (!level) return 0;
    const k = cfg[kind];
    const levelScale = 1 + (level - 1) * cfg.levelScale;
    return clamp(cfg.basePerBulletChance * k.chanceMultiplier * levelScale / throughputScale, cfg.minPerBulletChance, cfg.maxPerBulletChance);
  };
  return {
    giant: chanceFor("giant", stats.giantLevel || 0),
    split: chanceFor("split", stats.splitLevel || 0),
    frost: chanceFor("frost", stats.frostLevel || 0)
  };
}

function giantBulletRadius(baseRadius = 8) {
  const cfg = BALANCE.ultraRareBalance.giant;
  if (Number.isFinite(cfg.areaMultiplier)) return baseRadius * Math.sqrt(Math.max(1, cfg.areaMultiplier));
  return baseRadius * Math.max(1, cfg.radiusMultiplier || 1);
}

function bulletReserveRadius(radius) {
  return Math.min(radius, BALANCE.performance.blockReserveRadiusCap || radius);
}

function makeBullet(ownerId, x, y, r, vx, vy, damage, crit, pierce, color, split = false, frost = false, giant = false) {
  const b = bulletPool.pop() || { hitIds: Object.create(null) };
  b.id = uuid();
  b.ownerId = ownerId;
  b.x = x;
  b.y = y;
  b.r = r;
  b.vx = vx;
  b.vy = vy;
  b.damage = damage;
  b.crit = crit;
  b.pierce = pierce;
  b.reserveR = bulletReserveRadius(r);
  b.color = color;
  b.split = split;
  b.frost = frost;
  b.giant = giant;
  if (!b.hitIds) b.hitIds = Object.create(null);
  else {
    for (const id in b.hitIds) delete b.hitIds[id];
  }
  return b;
}

function releaseBullet(b) {
  if (b && bulletPool.length < 1200) bulletPool.push(b);
}

function makeGiantMissile(ownerId, x, y, vx, vy, damage) {
  const cfg = BALANCE.ultraRareBalance.giant;
  const m = missilePool.pop() || {};
  m.id = uuid();
  m.ownerId = ownerId;
  m.x = x;
  m.y = y;
  m.vx = vx;
  m.vy = vy;
  m.r = Math.max(14, giantBulletRadius(8) * 0.28);
  m.impactRadius = giantBulletRadius(8);
  m.damage = damage;
  m.color = cfg.color;
  m.life = 3;
  return m;
}

function releaseMissile(m) {
  if (m && missilePool.length < 240) missilePool.push(m);
}

function triggerSplitBullet(b, x, y) {
  if (!b.split) return;
  const cfg = BALANCE.ultraRareBalance.split;
  const count = Math.max(1, cfg.count);
  const baseAngle = -Math.PI / 2;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i / (count - 1) - 0.5);
    const angle = baseAngle + t * cfg.spread;
    game.bullets.push(makeBullet(
      b.ownerId,
      x,
      y,
      6,
      Math.cos(angle) * cfg.speed,
      Math.sin(angle) * cfg.speed,
      b.damage * cfg.damageMultiplier,
      false,
      0,
      cfg.color
    ));
  }
}

function triggerFrostHit(b, x, y) {
  if (!b.frost) return;
  const cfg = BALANCE.ultraRareBalance.frost;
  game.boss.freezeTimer = Math.max(game.boss.freezeTimer || 0, cfg.duration);
  pushFloat("霜冻!", x, y - 34, cfg.color, "repel");
  bumpBossRevision();
}

function startGame(difficulty = "easy", mode = "3min") {
  game.started = true;
  game.over = false;
  game.win = false;
  game.difficulty = validDifficulty(difficulty);
  game.mode = validMode(mode);
  game.duration = BALANCE.modes[game.mode].duration;
  game.infinite = game.mode === "infinite";
  game.time = game.infinite ? 0 : game.duration;
  game.score = 0;
  game.headKills = 0;
  game.nextBlockResetAt = BALANCE.rewardBox.resetInterval;
  game.fireTimer = 0;
  game.spawnTimer = 0;
  game.emergencyTimer = 0;
  game.lateHpSoftCap = 0;
  for (const b of game.bullets) releaseBullet(b);
  for (const m of game.missiles) releaseMissile(m);
  game.bullets = [];
  game.missiles = [];
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

  const players = validPlayers();
  game.boss.freezeTimer = Math.max(0, (game.boss.freezeTimer || 0) - dt);
  for (const player of players) {
    const input = player.input || {};
    if (Date.now() - (player.lastClientXAt || 0) > 80) {
      if (input.pointerDown) player.x += (input.pointerX - player.x) * Math.min(1, dt * BALANCE.player.pointerFollowRate);
      else player.x += (input.dir || 0) * player.stats.speed * dt;
    }
    player.x = clamp(player.x, 58, W - 58);
  }

  game.fireTimer -= dt;
  if (game.fireTimer <= 0) {
    players.forEach(shootPlayer);
    const fastest = Math.max(1, ...players.map(p => p.stats.baseFireRate * Math.max(1, p.stats.fireMult)));
    game.fireTimer = 1 / fastest;
  }

  game.boss.advance += dt * bossAdvanceSpeed();

  updateBlockDemandReset();
  tuneIncomingBossSegments();
  updateBlocks(dt);
  updateBullets(dt);
  updateMissiles(dt);
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
  const reserveR = b.reserveR == null ? bulletReserveRadius(b.r) : b.reserveR;
  return game.blocks.some(block => block.active && b.y > block.y - block.h / 2 && b.x > block.x - block.w / 2 - reserveR && b.x < block.x + block.w / 2 + reserveR);
}

function nearestPlayerToBlock(players, block) {
  let best = players[0];
  let bestDx = best ? Math.abs(best.x - block.x) : Infinity;
  for (let i = 1; i < players.length; i++) {
    const dx = Math.abs(players[i].x - block.x);
    if (dx < bestDx) {
      best = players[i];
      bestDx = dx;
    }
  }
  return best;
}

function updateBullets(dt) {
  let cache = null;
  const players = validPlayers();
  let write = 0;
  for (let i = 0; i < game.bullets.length; i++) {
    const b = game.bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    let consumed = false;
    for (const block of game.blocks) {
      if (!block.active) continue;
      if (b.x > block.x - block.w / 2 && b.x < block.x + block.w / 2 && b.y > block.y - block.h / 2 && b.y < block.y + block.h / 2) {
        const owner = isValidPlayer(game.players.get(b.ownerId)) ? game.players.get(b.ownerId) : null;
        const player = owner || nearestPlayerToBlock(players, block);
        consumed = true;
        if (!player) break;
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
        const destroyed = damageSegment(hit.seg, b.damage, hit.x, hit.y, b.crit);
        triggerSplitBullet(b, hit.x, hit.y);
        triggerFrostHit(b, hit.x, hit.y);
        if (destroyed) cache = buildBossFrameCache();
        markBulletHit(b, hit.seg.id);
        if (b.pierce > 0) b.pierce -= 1;
        else consumed = true;
      }
    }
    if (consumed || b.y < -30 || b.x < -40 || b.x > W + 40) releaseBullet(b);
    else game.bullets[write++] = b;
  }
  game.bullets.length = write;
  for (const seg of game.boss.segments) seg.hit = Math.max(0, seg.hit - dt);
}

function missileHitsBoss(m, cache) {
  return bulletHitsBody({
    x: m.x,
    y: m.y,
    r: m.r,
    giant: true,
    hitIds: null
  }, cache);
}

function explodeGiantMissile(m, x, y, cache) {
  const seen = Object.create(null);
  const probe = { x, y, r: m.impactRadius, giant: true };
  const candidates = collisionCandidates(probe, cache);
  let hitCount = 0;
  for (const box of candidates) {
    if (!box || !box.seg || seen[box.seg.id]) continue;
    const radius = (m.impactRadius || 0) + box.radius;
    if (!pointToSegmentHit(probe, box.start, box.mid, radius, serverPointHitResult)
      && !pointToSegmentHit(probe, box.mid, box.end, radius, serverPointHitResult)) continue;
    seen[box.seg.id] = true;
    const destroyed = damageSegment(box.seg, m.damage, x, y, true);
    hitCount += 1;
    if (destroyed) cache = buildBossFrameCache();
  }
  if (hitCount) pushFloat(`巨神炮 x${hitCount}`, x, y - 44, BALANCE.ultraRareBalance.giant.color, "repel");
}

function updateMissiles(dt) {
  let cache = null;
  let write = 0;
  for (let i = 0; i < game.missiles.length; i++) {
    const m = game.missiles[i];
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    m.life -= dt;
    cache = cache || buildBossFrameCache();
    const hit = missileHitsBoss(m, cache);
    if (hit) {
      explodeGiantMissile(m, hit.x, hit.y, cache);
      releaseMissile(m);
      cache = buildBossFrameCache();
      continue;
    }
    if (m.life <= 0 || m.y < -m.impactRadius || m.x < -m.impactRadius || m.x > W + m.impactRadius) releaseMissile(m);
    else game.missiles[write++] = m;
  }
  game.missiles.length = write;
}

function updateRewards(dt) {
  let write = 0;
  let collectedGroup = "";
  const players = validPlayers();
  for (let i = 0; i < game.rewards.length; i++) {
    const r = game.rewards[i];
    r.y += r.vy * dt;
    r.life -= dt;
    const player = !collectedGroup && players.find(p => p.x > r.x - r.w / 2 - p.r && p.x < r.x + r.w / 2 + p.r && p.y > r.y - r.h / 2 - p.r && p.y < r.y + r.h / 2 + p.r);
    if (player) {
      applyUpgrade(player, r.upgrade);
      shareUpgradeToTeammates(player, r.upgrade);
      pushFloat(r.title, player.x, player.y - 80, r.color);
      collectedGroup = r.group;
    }
    if (!collectedGroup && r.life > 0 && r.y <= H - 70) game.rewards[write++] = r;
  }
  if (collectedGroup) {
    write = 0;
    for (let i = 0; i < game.rewards.length; i++) {
      const r = game.rewards[i];
      if (r.group !== collectedGroup && r.life > 0 && r.y <= H - 70) game.rewards[write++] = r;
    }
  }
  game.rewards.length = write;
}

function updateEffects(dt) {
  let write = 0;
  for (let i = 0; i < game.floating.length; i++) {
    const f = game.floating[i];
    f.x += (f.vx || 0) * dt;
    f.y -= 72 * dt;
    f.life -= dt;
    if (f.life > 0) game.floating[write++] = f;
  }
  game.floating.length = write;
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

function publicBullet(bullet) {
  const { hitIds, ownerId, ...rest } = bullet;
  return rest;
}

function publicMissile(missile) {
  const { ownerId, ...rest } = missile;
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
    lastInputSeq: player.lastInputSeq || 0,
    stats: player.stats
  };
}

function worldSnapshot() {
  return {
    serverTime: Date.now(),
    started: game.started,
    over: game.over,
    win: game.win,
    difficulty: game.difficulty,
    mode: game.mode,
    duration: game.duration === Infinity ? 0 : game.duration,
    infinite: game.infinite,
    time: game.time === Infinity ? 0 : game.time,
    score: game.score,
    headKills: game.headKills,
    headKillGoal: game.headKillGoal,
    boss: game.boss,
    bullets: game.bullets.map(publicBullet),
    missiles: game.missiles.map(publicMissile),
    blocks: game.blocks.map(publicBlock),
    rewards: game.rewards.map(publicReward),
    floating: game.floating.slice(-36),
    particles: game.particles.slice(-80),
    shockwaves: game.shockwaves.slice(-8)
  };
}

function playerSnapshot() {
  return {
    serverTime: Date.now(),
    started: game.started,
    over: game.over,
    players: validPlayers().map(publicPlayer)
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
    if (length > MAX_WS_MESSAGE_BYTES) {
      socket.end();
      return;
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
  if (msg.type === "hello") {
    if (msg.character && CHARACTERS[msg.character] && lobbyOpen()) player.character = msg.character;
    return;
  }
  if (msg.type === "menu" && game.over) {
    game.started = false;
    game.over = false;
    game.win = false;
    for (const b of game.bullets) releaseBullet(b);
    game.bullets = [];
    game.rewards = [];
    game.floating = [];
    game.particles = [];
    game.shockwaves = [];
    return;
  }
  if (msg.type === "lobby") {
    if (!lobbyOpen()) return;
    if (msg.character && CHARACTERS[msg.character] && lobbyOpen()) player.character = msg.character;
    game.difficulty = validDifficulty(msg.difficulty);
    game.mode = validMode(msg.mode);
    game.duration = BALANCE.modes[game.mode].duration;
    game.infinite = game.mode === "infinite";
    if (!game.started) game.time = game.infinite ? 0 : game.duration;
    return;
  }
  if (msg.type === "start") {
    if (msg.character && CHARACTERS[msg.character]) player.character = msg.character;
    game.difficulty = validDifficulty(msg.difficulty);
    game.mode = validMode(msg.mode);
    startGame(game.difficulty, game.mode);
  }
  if (msg.type === "select" && msg.character && CHARACTERS[msg.character] && lobbyOpen()) {
    player.character = msg.character;
  }
  if (msg.type === "input") {
    const clientX = Number(msg.x);
    if (Number.isFinite(clientX)) {
      player.x = clamp(clientX, 58, W - 58);
      player.lastClientXAt = Date.now();
    }
    player.lastInputSeq = Math.max(player.lastInputSeq || 0, Number(msg.seq) || 0);
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
  socket.setNoDelay(true);
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

setInterval(() => update(1 / 60), 1000 / 60);
setInterval(() => {
  const message = JSON.stringify({ type: "players", state: playerSnapshot() });
  for (const socket of game.clients.values()) sendFrame(socket, message);
}, 1000 / Math.max(1, BALANCE.network.playerSnapshotHz || 60));

setInterval(() => {
  const message = JSON.stringify({ type: "world", state: worldSnapshot() });
  for (const socket of game.clients.values()) sendFrame(socket, message);
}, 1000 / Math.max(1, BALANCE.network.worldSnapshotHz || 30));

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
