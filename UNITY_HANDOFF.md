# Unity Handoff

This is the short context file to read before porting the current HTML/Node game to Unity. Keep `UNITY_PORT_PLAN.md` and `BALANCE.md` as long history, but start here.

## Current Game Loop

- Entry: `index.html` is the single-player Canvas game and browser client. `server.js` serves files and runs the authoritative LAN multiplayer simulation. `balance.config.js` overrides both.
- Flow: choose character, difficulty, and mode, then start. The player only moves left/right or toward pointer; firing is automatic.
- Win/loss: timed modes win when time reaches 0. Infinite mode scores survival. Boss reaching the player area or player HP reaching 0 loses. Killing the Boss head 10 times also wins.
- Progression: front reward boxes and Boss reward segments grant cards. Normal growth cards raise attack, fire rate, shots, repel, etc. Rare cards are clone, pierce, and crit. Ultra rares are giant, split, and frost.

## Data Model To Port

- Player stats: `attack`, `baseFireRate`, `fireMult`, `shots`, `clones`, `pierce`, `crit`, `critDamage`, `giantLevel`, `splitLevel`, `frostLevel`, movement speed, bullet speed, and rare counters.
- Boss: one ordered segment list. Segment 0 is the head. Segments have `id`, `hp`, `maxHp`, `len`, `width`, `tier`, `reward`, `knockback`, `settle`, `hit`, and `tuned`.
- Boss path: a deterministic serpentine path from top center across lanes. Segment positions are derived from `boss.advance`, trail distance, knockback, and settle offsets.
- Rewards: two front boxes plus reward drops. Reward drops normally show two cards; ultra rare can appear as a third extra card and must not replace normal rare growth.
- Projectiles: ordinary bullets are separate from giant missiles. Ordinary bullets can hit reward boxes, Boss body, split, frost, pierce, and crit. Giant missiles only damage Boss in an area.
- Multiplayer: server owns Boss, rewards, bullets, missiles, damage, and win/loss. Clients send input and render server world frames with local player prediction.

## Unity Component Mapping

- `GameController`: mode/difficulty, timer, score, win/loss, start/restart, high-level update order.
- `BalanceConfig`: ScriptableObject or JSON-backed config mirroring `balance.config.js`; this should be the only tuning source.
- `PlayerController`: movement input, character start bonuses, automatic fire cadence, applying upgrades.
- `BossController`: segment spawning, path sampling, HP tuning, head promotion, segment removal, knockback/settle, touch loss.
- `ProjectileSystem`: object pools for bullets and giant missiles; ordinary bullet and giant missile code paths must stay separate.
- `RewardSystem`: front boxes, emergency box, reward card drops, rare/ultra pools, card application.
- `NetworkBridge`: later phase. Keep server authoritative. Sync player frames separately from lower-rate world frames.
- `RenderLayer`: Boss segment sprites, bullets, missiles, rewards, particles, floating text, HUD.

## Rules That Must Survive The Port

- Boss HP/DPS model must ignore all ultra rares by default (`bossDpsWeight: 0`). Ordinary attack, fire rate, shots, clones, pierce, crit, and crit damage still count.
- Clones have no hard stat cap. Visual shooters are capped only for rendering/performance; real clone count still affects output and ultra probability.
- Crit over 100% converts overflow into crit damage.
- Reward box hit demand resets every 5 minutes.
- Head is short and is always the front segment. When the head dies, the next segment becomes head. Ten head kills wins.
- Multiplayer difficulty should be above single-player, but scale gently with team size.

## Giant Missile Notes

- The ultra rare formerly called giant bullet should be treated as "giant cannon/missile" in Unity.
- It must not reuse ordinary bullet collision or reward-box logic.
- On trigger, spawn a missile object instead of an ordinary bullet.
- Missile does not hit reward boxes, does not consume pierce, does not split, and does not frost.
- On Boss hit, apply one area damage event. Each Boss segment can be damaged at most once by that missile.
- `areaMultiplier` means area multiplier. Radius is `baseRadius * sqrt(areaMultiplier)`, not `baseRadius * areaMultiplier`.

## Current Hotspots And Risks

- `index.html` is very large and mixes logic, rendering, networking, assets, and config. Avoid reading it end-to-end unless necessary.
- Key source anchors: `BALANCE`, `CHARACTERS`, `shoot`, `updateBullets`, `updateMissiles`, `damageSegment`, `makeBossSegment`, `applyWorldFrame`, and draw functions.
- Boss collision uses spatial buckets and candidate caps. In Unity, replace this with colliders or cached path segment hit tests, but keep ordinary bullets and giant missiles separate.
- LAN smoothing matters: clients should track server Boss target positions smoothly and only snap on authoritative structural revisions.

## Suggested Port Order

1. Single-player core without networking: GameController, PlayerController, BossController, RewardSystem, ProjectileSystem.
2. Bring over `balance.config.js` values into Unity config.
3. Implement Boss path/segments and ordinary bullets.
4. Add rewards, rare cards, crit overflow, and ultra rares.
5. Add giant missile as its own projectile type.
6. Add pooling and performance pass.
7. Add LAN multiplayer after single-player behavior matches.
