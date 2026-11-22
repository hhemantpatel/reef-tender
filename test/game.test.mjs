import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/game/session.js';
import { TECH_TREE } from '../src/game/techtree.js';
import { KELP, ANEMONE, CORAL, SHELL, EMPTY, ROCK, SAND, MATURITY } from '../src/game/world.js';

const ALL = new Set(TECH_TREE.map((t) => t.id));

function session(opts = {}) {
  const s = new Session({ size: opts.size ?? 4, seed: opts.seed ?? 7 });
  s.unlocked = new Set(opts.unlocked ?? ALL);
  s.world.wildKelp = !s.unlocked.has('seeding');
  if (opts.bleach) s.world.bleachEnabled = true;
  return s;
}

/** Run a script for a bounded number of ticks and fail loudly on script errors. */
function run(s, src, ticks) {
  assert.equal(s.start(src), true, s.error?.message);
  s.runTicks(ticks);
  if (s.error) assert.fail(`line ${s.error.line}: ${s.error.message}`);
  return s;
}

const fill = (s, entity, growth) => {
  for (const t of s.world.tiles) {
    t.entity = entity; t.growth = growth; t.bleach = 0;
  }
};

test('the grid wraps in every direction', () => {
  const s = session();
  run(s, 'move(WEST)\nmove(SOUTH)', 10);
  assert.equal(s.world.drones[0].x, 3);
  assert.equal(s.world.drones[0].y, 3);
});

test('harvesting mature kelp pays one kelp and clears the tile', () => {
  const s = session();
  const t = s.world.at(0, 0);
  t.entity = KELP; t.growth = MATURITY.KELP;
  run(s, 'harvest()', 5);
  assert.equal(s.resources.kelp, 1);
  assert.equal(t.entity, EMPTY);
});

test('harvesting immature kelp pays nothing but still costs a tick', () => {
  const s = session();
  const t = s.world.at(0, 0);
  t.entity = KELP; t.growth = 1;
  run(s, 'harvest()', 5);
  assert.equal(s.resources.kelp, 0);
  assert.equal(s.ticks, 1);
});

test('kelp cannot be planted on rock', () => {
  const s = session();
  const t = s.world.at(0, 0);
  t.ground = ROCK; t.entity = EMPTY;
  run(s, 'print(plant(KELP))', 5);
  assert.deepEqual(s.output.map((o) => o.text).filter((x) => x === 'False'), ['False']);
  assert.equal(t.entity, EMPTY);
});

test('adjacent anemones stall each other; a checkerboard does not', () => {
  const crowded = session();
  crowded.world.at(0, 0).entity = ANEMONE;
  crowded.world.at(1, 0).entity = ANEMONE;
  const spaced = session();
  spaced.world.at(0, 0).entity = ANEMONE;
  spaced.world.at(2, 0).entity = ANEMONE;
  for (let i = 0; i < 60; i++) { crowded.world.step(); spaced.world.step(); }
  assert.ok(crowded.world.at(0, 0).stung, 'crowded anemone should be stung');
  assert.ok(!spaced.world.at(0, 0).stung, 'spaced anemone should not be stung');
  assert.ok(spaced.world.isMature(spaced.world.at(0, 0)), 'spaced anemone should mature');
  assert.ok(!crowded.world.isMature(crowded.world.at(0, 0)), 'crowded anemone should not');
});

test('ground type changes growth rate', () => {
  const s = session();
  const silt = s.world.tiles.find((t) => t.ground.name === 'SILT');
  const sand = s.world.tiles.find((t) => t.ground.name === 'SAND');
  if (!silt) return; // seed-dependent; skip rather than assert on luck
  silt.entity = KELP; sand.entity = KELP;
  for (let i = 0; i < 8; i++) s.world.step();
  assert.ok(silt.growth > sand.growth, 'kelp should grow faster on silt');
});

test('bleaching freezes a tile, spreads, and scrubbing pays pearls', () => {
  const s = session({ bleach: true });
  const t = s.world.at(0, 0);
  t.bleach = 0.5;
  assert.equal(s.world.canHarvest(t), false);
  run(s, 'scrub()', 5);
  assert.equal(t.bleach, 0);
  assert.equal(s.resources.pearl, 22);
});

test('reef health scales growth, and bleach spreads over time', () => {
  const s = session({ bleach: true, size: 6 });
  assert.equal(s.world.health, 1);
  for (let i = 0; i < 6; i++) s.world.tiles[i].bleach = 1;
  assert.ok(s.world.health < 1);
  assert.ok(s.world.healthFactor < 1);
  const before = s.world.tiles.filter((t) => t.bleach > 0).length;
  for (let i = 0; i < 4000; i++) s.world.step();
  assert.ok(s.world.tiles.filter((t) => t.bleach > 0).length > before, 'bleach should spread');
});

test('one mature coral pays 1; a full reef blooms for size^2 * 4 and clears', () => {
  const single = session();
  single.world.at(0, 0).entity = CORAL;
  single.world.at(0, 0).growth = MATURITY.CORAL;
  run(single, 'harvest()', 5);
  assert.equal(single.resources.coral, 1);

  const bloom = session();
  fill(bloom, CORAL, MATURITY.CORAL);
  assert.ok(bloom.world.isBloomReady());
  run(bloom, 'harvest()', 5);
  assert.equal(bloom.resources.coral, 16 * 4);
  assert.ok(bloom.world.tiles.every((t) => t.entity === EMPTY));
});

test('planting shells draws distinct sizes and a sorted reef pays out', () => {
  const s = session();
  for (const t of s.world.tiles) { t.entity = EMPTY; t.growth = 0; }
  run(s, 'for i in range(4):\n    for j in range(4):\n        plant(SHELL)\n        move(EAST)\n    move(NORTH)', 200);
  assert.ok(s.world.tiles.every((t) => t.entity === SHELL), 'every tile should hold a shell');
  const values = s.world.tiles.map((t) => t.value);
  assert.equal(new Set(values).size, 16, 'every shell size should be distinct');
  assert.ok(!s.world.isSorted());

  // Lay them out in snake order by hand, then a single harvest should pay.
  let n = 1;
  for (const t of s.world.snakeOrder()) t.value = n++;
  assert.ok(s.world.isSorted());
  run(s, 'harvest()', 5);
  assert.equal(s.resources.nacre, 16 * 20);
  assert.ok(s.world.tiles.every((t) => t.entity === EMPTY));
});

test('swap exchanges the two tiles and costs one tick', () => {
  const s = session();
  const a = s.world.at(0, 0);
  const b = s.world.at(1, 0);
  a.entity = SHELL; a.value = 9;
  b.entity = SHELL; b.value = 2;
  run(s, 'swap(EAST)', 5);
  assert.equal(a.value, 2);
  assert.equal(b.value, 9);
  assert.equal(s.ticks, 1);
});

test('buying an unlock deducts the cost and applies its effect', () => {
  const s = session({ unlocked: [] });
  s.resources.kelp = 400;
  assert.ok(s.buy('loops'));
  assert.equal(s.resources.kelp, 390);
  assert.ok(s.unlocked.has('loops'));
  assert.equal(s.canAfford('loops'), false, 'already owned');

  s.resources.kelp = 1000;
  assert.ok(s.buy('seeding'));
  assert.ok(s.buy('branching'));
  assert.ok(s.buy('reef1'));
  assert.equal(s.world.size, 6);
  assert.equal(s.world.tiles.length, 36);
});

test('expanding the reef keeps what was already growing', () => {
  const s = session({ unlocked: [] });
  s.world.at(1, 1).entity = KELP;
  s.world.at(1, 1).growth = 5;
  s.resources.kelp = 10000;
  s.buy('loops'); s.buy('seeding'); s.buy('branching'); s.buy('reef1');
  assert.equal(s.world.at(1, 1).entity, KELP);
  assert.equal(s.world.at(1, 1).growth, 5);
});

test('the scrubber unlock is what turns bleaching on', () => {
  const s = session({ unlocked: ['loops', 'seeding', 'branching', 'reef1', 'counting', 'anemones', 'sensors', 'functions'] });
  assert.equal(s.world.bleachEnabled, false);
  s.resources.anemone = 5000;
  s.buy('scrubber');
  assert.equal(s.world.bleachEnabled, true);
});

test('two drones interleave and both act on the same reef', () => {
  const s = session();
  fill(s, KELP, MATURITY.KELP);
  const src = [
    'def helper():',
    '    for i in range(4):',
    '        harvest()',
    '        move(EAST)',
    'spawn_drone(helper)',
    'for i in range(4):',
    '    harvest()',
    '    move(NORTH)',
  ].join('\n');
  run(s, src, 200);
  assert.equal(s.world.drones.length <= 2, true);
  assert.ok(s.resources.kelp >= 6, `expected both drones to harvest, got ${s.resources.kelp}`);
});

test('spawn_drone rejects anything that is not a plain function', () => {
  const s = session();
  s.start('spawn_drone(5)');
  s.runTicks(10);
  assert.match(s.error.message, /needs the name of a function/);
});

test('a loop that never touches the reef is reported, not left to hang', () => {
  const s = session();
  s.start('x = 0\nwhile True:\n    x = x + 1');
  s.runTicks(50);
  assert.ok(s.error, 'expected a spin error');
  assert.match(s.error.message, /without touching the reef/);
});

test('a runtime error stops the program and names the line', () => {
  const s = session();
  s.start('harvest()\nmove(NORTH)\nmove(7)\n');
  s.runTicks(50);
  assert.equal(s.error.line, 3);
  assert.equal(s.running, false);
});

test('the world is deterministic for a given seed', () => {
  const a = session({ seed: 42 });
  const b = session({ seed: 42 });
  run(a, 'while True:\n    harvest()\n    plant(KELP)\n    move(EAST)', 800);
  run(b, 'while True:\n    harvest()\n    plant(KELP)\n    move(EAST)', 800);
  assert.equal(a.resources.kelp, b.resources.kelp);
});

test('a save round-trips through JSON with the reef intact', () => {
  const s = session({ unlocked: ['loops', 'seeding', 'branching', 'counting'] });
  run(s, 'while True:\n    harvest()\n    plant(KELP)\n    move(EAST)', 600);
  const copy = Session.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
  assert.equal(copy.resources.kelp, s.resources.kelp);
  assert.equal(copy.ticks, s.ticks);
  assert.deepEqual([...copy.unlocked], [...s.unlocked]);
  assert.deepEqual(
    copy.world.tiles.map((t) => [t.entity.name, t.growth, t.ground.name]),
    s.world.tiles.map((t) => [t.entity.name, Math.round(t.growth * 100) / 100, t.ground.name]),
  );
});

test('every tech tree entry is buyable in order from a clean start', () => {
  const s = session({ unlocked: [] });
  for (const tech of TECH_TREE) {
    for (const [res, n] of Object.entries(tech.cost)) s.resources[res] += n;
    assert.ok(s.buy(tech.id), `could not buy ${tech.id}`);
  }
  assert.equal(s.unlocked.size, TECH_TREE.length);
  assert.equal(s.world.size, 10);
  assert.equal(s.nextUnlock(), null);
});

test('every tech tree example parses under the unlocks it ships with', () => {
  for (const tech of TECH_TREE) {
    if (!tech.example) continue;
    const s = session({ unlocked: [] });
    for (const t of TECH_TREE) {
      s.unlocked.add(t.id);
      if (t.id === tech.id) break;
    }
    assert.doesNotThrow(() => s.compile(tech.example), `example for ${tech.id} does not parse`);
  }
});

test('validateSave accepts a real save and rejects tampered ones', () => {
  const good = () => JSON.parse(JSON.stringify(session({ unlocked: ['loops'] }).toJSON()));
  assert.doesNotThrow(() => Session.validateSave(good()));

  const mutate = (fn) => { const d = good(); fn(d); return d; };
  const cases = {
    'wrong version': (d) => { d.v = 2; },
    'bad size': (d) => { d.world.size = 99; },
    'tile count': (d) => { d.world.tiles.pop(); },
    'unknown entity': (d) => { d.world.tiles[0][0] = 'constructor'; },
    'unknown unlock': (d) => { d.unlocked.push('godmode'); },
    'unknown resource': (d) => { d.resources.gold = 5; },
    'negative resource': (d) => { d.resources.kelp = -1; },
    'non-numeric tick': (d) => { d.ticks = 'lots'; },
    'bad shell bag': (d) => { d.world.shellBag = 'x'; },
  };
  for (const [name, fn] of Object.entries(cases)) {
    assert.throws(() => Session.validateSave(mutate(fn)), /Not a Reef Tender save/, name);
  }
  assert.throws(() => Session.validateSave(null), /Not a Reef Tender save/);
});
