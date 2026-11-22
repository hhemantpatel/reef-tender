import { sym } from '../lang/values.js';

// The reef itself: a wrapping grid, its growth rules, and the bleaching sim.
// Deliberately free of any DOM or rendering concern so the whole thing can be
// stepped headlessly in tests and in the balance harness.

export const NORTH = sym('NORTH');
export const EAST = sym('EAST');
export const SOUTH = sym('SOUTH');
export const WEST = sym('WEST');
export const DIRECTIONS = { NORTH, EAST, SOUTH, WEST };

export const EMPTY = sym('EMPTY');
export const KELP = sym('KELP');
export const ANEMONE = sym('ANEMONE');
export const CORAL = sym('CORAL');
export const SHELL = sym('SHELL');
export const ENTITIES = { EMPTY, KELP, ANEMONE, CORAL, SHELL };

export const SAND = sym('SAND');
export const SILT = sym('SILT');
export const ROCK = sym('ROCK');
export const GROUNDS = { SAND, SILT, ROCK };

/** Ticks of accumulated growth needed to mature, per entity. */
export const MATURITY = {
  KELP: 14,
  ANEMONE: 30,
  CORAL: 70,
};

/** Ground either suits a species or it doesn't - this is what get_ground() is for. */
const GROUND_FACTOR = {
  KELP: { SAND: 1, SILT: 1.6, ROCK: 0 },
  ANEMONE: { SAND: 1, SILT: 0.8, ROCK: 1.2 },
  CORAL: { SAND: 0.9, SILT: 0.7, ROCK: 1.4 },
};

const STUNG_FACTOR = 0.12;       // anemones crowding each other barely grow
// Dieback is tuned so a tight sweep can just about hold a full reef of mature
// coral together long enough to bloom. Raise it and the bloom becomes unreachable.
const CORAL_DIEBACK = 0.00008;   // per mature coral, per tick
const WILD_KELP_CHANCE = 0.02;   // free income before Seeding is unlocked
const BLEACH_ONSET = 160;        // ticks between outbreaks; must exceed a full sweep
const BLEACH_SPREAD = 0.005;     // per bleached tile, per tick
const MIN_HEALTH_FACTOR = 0.15;

/** Deterministic RNG so a reef can be replayed exactly in tests. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTile(x, y, r) {
  return {
    x, y,
    ground: r < 0.18 ? SILT : r < 0.32 ? ROCK : SAND,
    entity: EMPTY,
    growth: 0,
    value: 0,
    bleach: 0,
    stung: false,
  };
}

export class World {
  constructor(size = 4, seed = 1) {
    this.size = size;
    this.seed = seed;
    this.rng = makeRng(seed);
    this.tick = 0;
    this.bleachEnabled = false;
    // Free kelp drifts in only until the player can seed the reef themselves;
    // after that it would just fight whatever they are trying to lay out.
    this.wildKelp = true;
    this.tiles = [];
    this.buildTiles();
    this.drones = [{ x: 0, y: 0, trail: [] }];
    this.seedStartingKelp();
  }

  buildTiles() {
    const groundRng = makeRng(this.seed * 7919 + 13);
    this.tiles = [];
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        this.tiles.push(makeTile(x, y, groundRng()));
      }
    }
  }

  /** A handful of ready kelp so the player's first harvest() actually pays. */
  seedStartingKelp() {
    const spots = this.tiles.filter((t) => t.ground !== ROCK);
    for (let i = 0; i < Math.min(6, spots.length); i++) {
      const t = spots[Math.floor(this.rng() * spots.length)];
      t.entity = KELP;
      t.growth = MATURITY.KELP;
    }
  }

  /** Grid coordinates wrap, which is what makes simple sweep loops work at all. */
  wrap(v) { return ((v % this.size) + this.size) % this.size; }

  at(x, y) { return this.tiles[this.wrap(y) * this.size + this.wrap(x)]; }

  tileOf(drone) { return this.at(drone.x, drone.y); }

  neighbours(x, y) {
    return [
      this.at(x, y + 1), this.at(x + 1, y),
      this.at(x, y - 1), this.at(x - 1, y),
    ];
  }

  resize(size) {
    const old = this.tiles;
    const oldSize = this.size;
    this.size = size;
    const groundRng = makeRng(this.seed * 7919 + 13 + size);
    const next = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (x < oldSize && y < oldSize) {
          next.push(old[y * oldSize + x]);
        } else {
          next.push(makeTile(x, y, groundRng()));
        }
      }
    }
    this.tiles = next;
    for (const d of this.drones) { d.x = this.wrap(d.x); d.y = this.wrap(d.y); }
  }

  get health() {
    const bleached = this.tiles.reduce((n, t) => n + (t.bleach > 0 ? 1 : 0), 0);
    return 1 - bleached / this.tiles.length;
  }

  get healthFactor() {
    return Math.max(MIN_HEALTH_FACTOR, this.health);
  }

  maturityOf(tile) {
    return MATURITY[tile.entity.name] ?? Infinity;
  }

  isMature(tile) {
    return tile.entity !== EMPTY && tile.growth >= this.maturityOf(tile);
  }

  canHarvest(tile) {
    if (tile.bleach > 0) return false;
    if (tile.entity === SHELL) return true;
    return this.isMature(tile);
  }

  /** Growth fraction 0..1, or the shell's size for SHELL. */
  measure(tile) {
    if (tile.entity === SHELL) return tile.value;
    if (tile.entity === EMPTY) return 0;
    return Math.min(1, Math.round((tile.growth / this.maturityOf(tile)) * 1000) / 1000);
  }

  /** True when every tile holds mature coral - the bloom condition. */
  isBloomReady() {
    return this.tiles.every((t) => t.entity === CORAL && this.isMature(t) && t.bleach === 0);
  }

  /** True when every tile holds a shell and the sizes ascend along a snake path. */
  isSorted() {
    if (!this.tiles.every((t) => t.entity === SHELL)) return false;
    let prev = -Infinity;
    for (const t of this.snakeOrder()) {
      if (t.value < prev) return false;
      prev = t.value;
    }
    return true;
  }

  /** Row 0 left-to-right, row 1 right-to-left, and so on. */
  *snakeOrder() {
    for (let y = 0; y < this.size; y++) {
      for (let i = 0; i < this.size; i++) {
        const x = y % 2 === 0 ? i : this.size - 1 - i;
        yield this.at(x, y);
      }
    }
  }

  step() {
    this.tick++;
    const factor = this.healthFactor;

    // Crowded anemones stall: recomputed each tick so the player sees a plant
    // start moving again the moment its neighbour is harvested.
    for (const t of this.tiles) {
      t.stung = t.entity === ANEMONE
        && this.neighbours(t.x, t.y).some((n) => n.entity === ANEMONE);
    }

    for (const t of this.tiles) {
      if (t.bleach > 0) {
        t.bleach = Math.min(1, t.bleach + 0.02);
        continue;
      }
      if (t.entity === EMPTY) {
        if (this.wildKelp && t.ground !== ROCK && this.rng() < WILD_KELP_CHANCE * factor) {
          t.entity = KELP;
          t.growth = 0;
        }
        continue;
      }
      if (t.entity === SHELL) continue;

      const ground = GROUND_FACTOR[t.entity.name]?.[t.ground.name] ?? 1;
      const stung = t.stung ? STUNG_FACTOR : 1;
      const mature = this.isMature(t);
      if (!mature) {
        t.growth += factor * ground * stung;
      } else if (t.entity === CORAL && this.rng() < CORAL_DIEBACK) {
        t.entity = EMPTY;
        t.growth = 0;
      }
    }

    if (this.bleachEnabled) this.stepBleach();
  }

  stepBleach() {
    const clean = this.tiles.filter((t) => t.bleach === 0);
    if (clean.length && this.tick % BLEACH_ONSET === 0) {
      clean[Math.floor(this.rng() * clean.length)].bleach = 0.35;
    }
    for (const t of this.tiles) {
      if (t.bleach <= 0) continue;
      if (this.rng() >= BLEACH_SPREAD) continue;
      const targets = this.neighbours(t.x, t.y).filter((n) => n.bleach === 0);
      if (!targets.length) continue;
      targets[Math.floor(this.rng() * targets.length)].bleach = 0.3;
    }
  }
}
