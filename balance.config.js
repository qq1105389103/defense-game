(function (root, factory) {
  const config = factory();
  if (typeof module === "object" && module.exports) module.exports = config;
  root.GAME_BALANCE_CONFIG = config;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  return {
    // 玩家基础：攻击、基础攻速、弹道/分身/穿透上限。
    player: {
      startAttack: 240,
      baseFireRate: 4.3,
      // 键盘/按键水平移动速度，单位：像素/秒。
      keyboardMoveSpeed: 560,
      // 鼠标/触屏按住时追随指针的速度；越大越贴手，越小越接近键盘速度。
      pointerFollowRate: 3,
      maxShots: 8,
      maxClones: Infinity,
      maxPierce: Infinity,
      maxCrit: Infinity,
      maxVisualShooters: 5
    },

    // 联机倍率：只服务端使用；调多人血量、速度、总DPS权重。
    multiplayer: {
      hp: 1.25,
      speed: 1.02,
      extraHpPerPlayer: 0.055,
      extraSpeedPerPlayer: 0.005,
      rewardShareExponent: 0.46,
      // 奖励分润会提升全队成长，这个权重决定 Boss 血量模型吃进多少分润收益。
      rewardShareBossWeight: 0.55,
      expectedDpsWeight: 0.79
    },

    // 超稀有：独立额外奖励，不挤占普通稀有；默认 bossDpsWeight=0，不参与Boss血量/DPS成长。
    // 概率使用真实吞吐量软压缩：基础攻速 * 攻速倍率 * 弹道 * (1 + 真实分身数)，不使用硬冷却。
    // 联机同步：数值越高越丝滑，也越吃服务器和网络。
    network: {
      inputIntervalMs: 16,
      playerSnapshotHz: 60,
      worldSnapshotHz: 30,
      remoteInterpolationMs: 50,
      selfCorrectionRate: 28,
      bossCorrectionRate: 12
    },

    ultraRareBalance: {
      bossDpsWeight: 0,
      basePerBulletChance: 0.0072,
      referenceThroughput: 43,
      throughputSoftness: 0.83,
      levelScale: 1,
      minPerBulletChance: 0.0001,
      maxPerBulletChance: 0.02,
      giant: {
        // areaMultiplier 是面积倍数；半径会使用 sqrt(areaMultiplier)。旧 radiusMultiplier 仅兼容旧配置。
        areaMultiplier: 1000,
        radiusMultiplier: 1500,
        missileSpeed: 360,
        damageMultiplier: 100,
        chanceMultiplier: 1,
        color: "#ff6b3d"
      },
      split: {
        chanceMultiplier: 1.6,
        count: 5,
        damageMultiplier: 2.22,
        speed: 680,
        spread: 0.72,
        color: "#8ff7ff"
      },
      frost: {
        chanceMultiplier: 0.65,
        slowMultiplier: 0.36,
        duration: 0.28,
        color: "#9fe8ff"
      }
    },

    // 难度：demand影响Boss目标血量，speed/ramp影响推进速度。
    difficulties: {
      easy: { label: "简单", demand: 0.56, speed: 1.1, ramp: 0.92, emergencyY: 860 },
      normal: { label: "普通", demand: 0.62, speed: 1.18, ramp: 0.96, emergencyY: 890 },
      hard: { label: "困难", demand: 1.05, speed: 1.2, ramp: 1.0, emergencyY: 1010 }
    },

    // 模式：duration为秒；hp/speed是该模式倍率。
    modes: {
      "3min": { label: "3分钟", duration: 180, hp: 1, speed: 1 },
      "5min": { label: "5分钟", duration: 300, hp: 1.35, speed: 1.08 },
      infinite: { label: "无限", duration: Infinity, hp: 1.15, speed: 1.03 }
    },

    // Boss血量、关节、成长与奖励段概率。
    boss: {
      demandRatio: 0.44,
      weakChance: 0.28,
      toughChance: 0.16,
      wallChance: 0.06,
      rewardChance: 0.36,
      activateDistance: -260,
      fullRewardInterval: 8,
      expectedRewardQuality: 0.66,
      actualDpsWeightLow: 0.32,
      actualDpsWeightHigh: 0,
      actualDpsClamp: [0.42, 1],
      timeHpRamp: 0.34,
      weakKillTime: [3.4, 5.2],
      crackKillTime: [1.8, 3.4],
      crackChanceStart: 55,
      crackChanceMax: 0.16,
      normalKillTime: [4.8, 7.6],
      toughKillTime: [10, 17],
      wallKillTime: [28, 54],
      rewardKillTime: [2.8, 6.8],
      armoredKillTime: [9, 15],
      headKillTime: [25, 40],
      headKillGoal: 8,
      minHp: 12000,
      weakMinHp: 6200,
      rewardMinHp: 8200,
      headLen: 96,
      normalLen: [170, 330],
      normalLenHpBonus: 72,
      rewardLen: [300, 500],
      armoredLen: [420, 640],
      headWidth: 190,
      normalWidth: [136, 176],
      rewardWidth: [152, 196],
      armoredWidth: [164, 210],
      speedBase: 34,
      speedRamp: 0.5,
      speedRampTime: 120
    },

    // 奖励砖：成本、成长、稀有概率、5分钟重置等。
    rewardBox: {
      startCosts: [34, 40],
      startScale: 0.9,
      scaleGrowth: 0.18,
      maxScale: 3.8,
      speedDemandScale: 0.13,
      speedProgressDecay: 0.46,
      modelAttention: 0.72,
      rewardJointModelInterval: 32,
      frontRareChance: 0.045,
      jointRareChanceStart: 0.26,
      jointRareChanceDecay: 0.06,
      jointRareChanceMin: 0.08,
      // 超稀有单独作为第三张额外卡出现，不替换前两张普通/稀有成长卡。
      ultraDropChance: 0.15,
      // 面前奖励砖被打掉后的刷新冷却，单位：秒。
      respawnDelay: 5.5,
      // 面前奖励砖：队友获得的分润比例，0.5 = 一半效果。
      teammateShareRatio: 0.5,
      // 关节掉落的稀有奖励：队友获得的分润比例。
      rareTeammateShareRatio: 0.5,
      // 关节掉落的超稀有奖励：队友获得的分润比例。
      ultraTeammateShareRatio: 0.3,
      // 关节奖励卡片下降速度，单位：像素/秒；越大越需要抢。
      jointDropSpeed: 250,
      resetInterval: 300,
      emergencyCooldown: 18
    },

    // 词条池：rareWeight越低越稀有；超稀有默认 bossDpsWeight=0。
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
      { type: "giant", title: "巨神炮", cost: 118, color: "#ff6b3d", score: 20, amount: 1, ultra: true, ultraWeight: 0.35, bossDpsWeight: 0 },
      { type: "split", title: "裂变弹", cost: 106, color: "#8ff7ff", score: 19, amount: 1, ultra: true, ultraWeight: 0.001, bossDpsWeight: 0 },
      { type: "frost", title: "霜冻弹", cost: 112, color: "#9fe8ff", score: 18, amount: 1, ultra: true, ultraWeight: 0.35, bossDpsWeight: 0 }
    ],

    // 无限模式后期成长。
    infinite: {
      afterSeconds: 300,
      hpLateGrowth: 0.08,
      hpSoftCapMultiplier: 1.18,
      speedLateMultiplier: 0.82
    },

    // 性能参数：碰撞桶、粒子/浮字/震波上限。
    performance: {
      collisionBucketSize: 180,
      collisionActiveMargin: 260,
      maxHitTestsPerBullet: 18,
      maxGiantHitTestsPerBullet: 48,
      blockReserveRadiusCap: 48,
      particleCap: 260,
      floatTextCap: 90,
      shockwaveCap: 18,
      lowPriorityParticleHeadroom: 36
    }
  };
});
