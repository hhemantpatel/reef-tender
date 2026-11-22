// Balance harness. Runs each tier's reference solution and reports throughput,
// then plays the whole tech tree start to finish to check every unlock is
// reachable without grinding. Run with: node test/balance.mjs
import { Session } from '../src/game/session.js';
import { TECH_TREE, TECH_BY_ID } from '../src/game/techtree.js';
import * as S from './solutions.mjs';

const upTo = (id) => {
  const out = [];
  for (const t of TECH_TREE) { out.push(t.id); if (t.id === id) break; }
  return out;
};

function measure(label, unlocks, src, ticks) {
  const s = new Session({ seed: 20260901 });
  for (const id of unlocks) {
    const tech = TECH_BY_ID.get(id);
    for (const [res, n] of Object.entries(tech.cost)) s.resources[res] += n;
    if (!s.buy(id)) throw new Error(`could not buy ${id}`);
  }
  const before = { ...s.earned };
  if (!s.start(src)) return { label, error: `${s.error.line}: ${s.error.message}` };
  s.runTicks(ticks);
  if (s.error) return { label, error: `${s.error.line}: ${s.error.message}` };
  const per1k = {};
  for (const [k, v] of Object.entries(s.earned)) {
    const d = v - before[k];
    if (d > 0) per1k[k] = Math.round((d / s.ticks) * 1000);
  }
  return { label, size: s.world.size, ticks: s.ticks, per1k, health: s.world.health };
}

const rows = [
  measure('tier 0  no unlocks', [], S.TIER0, 4000),
  measure('1  loops', upTo('loops'), S.LOOPS, 4000),
  measure('2  seeding', upTo('seeding'), S.SEEDING, 4000),
  measure('3  branching', upTo('branching'), S.BRANCHING, 4000),
  measure('5  counting', upTo('counting'), S.COUNTING, 6000),
  measure('6  anemones', upTo('anemones'), S.ANEMONES, 8000),
  measure('7  sensors', upTo('sensors'), S.SENSORS, 8000),
  measure('8  functions', upTo('functions'), S.FUNCTIONS, 8000),
  measure('9  scrubber', upTo('scrubber'), S.SCRUBBER, 20000),
  measure('12 coral bloom', upTo('coral'), S.CORAL, 60000),
  measure('13 shell sort', upTo('shells'), S.SHELLS, 120000),
  measure('15 two drones', upTo('drones'), S.DRONES, 20000),
];

console.log('\nThroughput per 1000 ticks\n' + '-'.repeat(62));
for (const r of rows) {
  if (r.error) { console.log(`${r.label.padEnd(20)} ERROR ${r.error}`); continue; }
  const yields = Object.entries(r.per1k).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing';
  console.log(`${r.label.padEnd(20)} ${String(r.size + 'x' + r.size).padEnd(7)} ${yields}`
    + (r.health < 1 ? `   health ${Math.round(r.health * 100)}%` : ''));
}

// --- full playthrough --------------------------------------------------
// Play the tree in order with the best solution available at each step, and
// report how many ticks each unlock actually costs.

const SCRIPT_FOR = {
  loops: S.TIER0, seeding: S.LOOPS, branching: S.SEEDING, reef1: S.BRANCHING,
  counting: S.BRANCHING, anemones: S.COUNTING, sensors: S.ANEMONES,
  functions: S.SENSORS, scrubber: S.FUNCTIONS, lists: S.SCRUBBER,
  reef2: S.SCRUBBER, coral: S.SCRUBBER, shells: S.CORAL, reef3: S.CORAL,
  drones: S.SHELLS,
};

const s = new Session({ seed: 20260901 });
let total = 0;
console.log('\nFull playthrough\n' + '-'.repeat(62));
for (const tech of TECH_TREE) {
  const src = SCRIPT_FOR[tech.id];
  const start = s.ticks;
  let guard = 0;
  while (!s.canAfford(tech.id) && guard < 400) {
    if (!s.running) {
      if (!s.start(src)) { console.log(`  start failed: ${s.error.message}`); break; }
    }
    s.runTicks(2000);
    if (s.error) { console.log(`  ${tech.id}: ${s.error.line}: ${s.error.message}`); break; }
    guard++;
  }
  if (!s.buy(tech.id)) { console.log(`${tech.name.padEnd(18)} NOT REACHED after ${guard * 2000} ticks`); break; }
  s.stop();
  const spent = s.ticks - start;
  total += spent;
  const cost = Object.entries(tech.cost).map(([k, v]) => `${v} ${k}`).join(' + ');
  console.log(`${tech.name.padEnd(18)} ${String(spent).padStart(7)} ticks   (${cost})`);
}
console.log('-'.repeat(62));
console.log(`total ${total} ticks to finish the tree`);
console.log(`at 20x that is about ${Math.round(total / 20 / 60)} min of play, at MAX far less`);
