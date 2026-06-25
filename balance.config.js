(function (root, factory) {
  const config = factory();
  if (typeof module === "object" && module.exports) module.exports = config;
  root.GAME_BALANCE_CONFIG = config;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  return {
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
      particleCap: 260,
      floatTextCap: 90,
      shockwaveCap: 18,
      lowPriorityParticleHeadroom: 36
    }
  };
});
