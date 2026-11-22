import { parse } from '../lang/parser.js';
import { Interpreter } from '../lang/interp.js';
import { makeCoreBuiltins, CORE_LOCKED_NAMES } from '../lang/builtins.js';
import { repr, sym } from '../lang/values.js';
import { runtimeError } from '../lang/errors.js';
import { World, ENTITIES, GROUNDS } from './world.js';
import { createGameBuiltins } from './api.js';
import { TECH_TREE, TECH_BY_ID, GAME_LOCKED_NAMES, RESOURCES } from './techtree.js';

// One save file's worth of game: the reef, the ledger, the unlock set, and the
// running program. The UI drives it through start/stop/advance and never
// touches the interpreter directly.

const SPIN_LIMIT = 150000; // stmt yields with no world action before we call it a spin

export class Session {
  constructor(opts = {}) {
    this.seed = opts.seed ?? 20260901;
    this.world = new World(opts.size ?? 4, this.seed);
    this.resources = Object.fromEntries(RESOURCES.map((r) => [r.id, 0]));
    this.earned = Object.fromEntries(RESOURCES.map((r) => [r.id, 0]));
    this.unlocked = new Set();
    this.ticks = 0;
    this.output = [];
    this.error = null;
    this.currentLine = 0;
    this.running = false;
    this.contexts = [];
    this.ci = 0;
    this.interp = null;
    this.activeDrone = this.world.drones[0];
    this.spinCounter = 0;
    this.pendingEvents = [];
    this.history = [];
    this.maxOutput = opts.maxOutput ?? 300;
  }

  // --- unlocks ----------------------------------------------------------

  features() { return this.unlocked; }

  lockedNames() {
    return new Map([...CORE_LOCKED_NAMES, ...GAME_LOCKED_NAMES]);
  }

  nextUnlock() { return TECH_TREE.find((t) => !this.unlocked.has(t.id)) || null; }

  canAfford(id) {
    const tech = TECH_BY_ID.get(id);
    if (!tech || this.unlocked.has(id)) return false;
    return Object.entries(tech.cost).every(([res, n]) => this.resources[res] >= n);
  }

  buy(id) {
    if (!this.canAfford(id)) return false;
    const tech = TECH_BY_ID.get(id);
    for (const [res, n] of Object.entries(tech.cost)) this.resources[res] -= n;
    this.unlocked.add(id);
    this.applyEffect(tech);
    this.event('unlock', tech);
    return true;
  }

  applyEffect(tech) {
    if (tech.effect?.resize) this.world.resize(tech.effect.resize);
    if (tech.id === 'scrubber') this.world.bleachEnabled = true;
    if (tech.id === 'seeding') this.world.wildKelp = false;
  }

  credit(resource, amount) {
    this.resources[resource] += amount;
    this.earned[resource] += amount;
  }

  event(name, payload) { this.pendingEvents.push({ name, payload }); }

  drainEvents() {
    const e = this.pendingEvents;
    this.pendingEvents = [];
    return e;
  }

  // --- console ----------------------------------------------------------

  print(text) {
    this.output.push({ text, tick: this.ticks, kind: 'log' });
    if (this.output.length > this.maxOutput) this.output.shift();
  }

  note(text, kind = 'note') {
    this.output.push({ text, tick: this.ticks, kind });
    if (this.output.length > this.maxOutput) this.output.shift();
  }

  clearOutput() { this.output = []; }

  // --- program ----------------------------------------------------------

  /** Parse only. Throws a ReefError the editor can point at. */
  compile(src) {
    return parse(src, { features: this.features(), lockedNames: this.lockedNames() });
  }

  start(src) {
    this.stop();
    this.error = null;
    let ast;
    try {
      ast = this.compile(src);
    } catch (e) {
      this.error = e;
      this.note(`Line ${e.line}: ${e.message}`, 'error');
      return false;
    }

    const builtins = makeCoreBuiltins({ onPrint: (s) => this.print(s) });
    for (const [k, v] of createGameBuiltins(this)) builtins.set(k, v);

    // Run parks the drone back at the reef's origin. Without this the program
    // starts wherever the last one stopped, so a script that walks the grid by
    // row index would silently work on an offset grid.
    this.world.drones.length = 1;
    this.world.drones[0].x = 0;
    this.world.drones[0].y = 0;
    this.world.drones[0].trail = [];
    this.interp = new Interpreter({ builtins });
    this.contexts = [{ drone: this.world.drones[0], gen: this.interp.run(ast) }];
    this.ci = 0;
    this.activeDrone = this.world.drones[0];
    this.spinCounter = 0;
    this.running = true;
    return true;
  }

  stop() {
    this.running = false;
    this.contexts = [];
    this.ci = 0;
    this.currentLine = 0;
  }

  spawnDrone(fn, interp, node) {
    if (this.world.drones.length >= 2) {
      throw runtimeError('You only have one spare drone.', node.line, node.col);
    }
    const lead = this.world.drones[0];
    const drone = { x: lead.x, y: lead.y, trail: [] };
    this.world.drones.push(drone);
    this.contexts.push({ drone, gen: interp.callValue(fn, [], node) });
    return null;
  }

  /** One tick of world time, charged to whichever drone is acting. */
  *spendTick(node) {
    this.ticks++;
    this.spinCounter = 0;
    this.world.step();
    if (this.ticks % 100 === 0) {
      this.history.push({ tick: this.ticks, ...this.earned });
      if (this.history.length > 400) this.history.shift();
    }
    yield { type: 'tick', line: node?.line ?? this.currentLine };
  }

  /**
   * Pull one yield from the running program.
   * @returns {'tick'|'stmt'|'done'|'error'}
   */
  advance() {
    if (!this.running || !this.contexts.length) return 'done';
    const ctx = this.contexts[this.ci % this.contexts.length];
    this.activeDrone = ctx.drone;

    let r;
    try {
      r = ctx.gen.next();
    } catch (e) {
      this.fail(e);
      return 'error';
    }

    if (r.done) {
      this.contexts.splice(this.contexts.indexOf(ctx), 1);
      if (ctx.drone !== this.world.drones[0]) {
        const i = this.world.drones.indexOf(ctx.drone);
        if (i > 0) this.world.drones.splice(i, 1);
      }
      if (!this.contexts.length) {
        this.running = false;
        this.note('Program finished.', 'system');
        return 'done';
      }
      this.ci %= this.contexts.length;
      return 'stmt';
    }

    this.currentLine = r.value.line || this.currentLine;
    if (r.value.type === 'tick') {
      this.ci = (this.ci + 1) % this.contexts.length; // round-robin between drones
      return 'tick';
    }

    if (++this.spinCounter > SPIN_LIMIT) {
      this.fail(runtimeError(
        'Your program has been computing for a long time without touching the reef. Is a loop missing a move() or harvest()?',
        this.currentLine, 1,
      ));
      return 'error';
    }
    return 'stmt';
  }

  fail(e) {
    this.error = e;
    this.running = false;
    const line = e.line ? `Line ${e.line}: ` : '';
    this.note(`${line}${e.message}`, 'error');
  }

  /**
   * Advance until `ticks` world ticks have passed or the program ends.
   * `maxYields` keeps a single frame bounded no matter what the script does.
   */
  runTicks(ticks, maxYields = 400000) {
    let used = 0;
    let yields = 0;
    while (this.running && used < ticks && yields < maxYields) {
      const r = this.advance();
      yields++;
      if (r === 'tick') used++;
      else if (r === 'done' || r === 'error') break;
    }
    return used;
  }

  // --- persistence ------------------------------------------------------

  toJSON() {
    return {
      v: 1,
      seed: this.seed,
      ticks: this.ticks,
      resources: this.resources,
      earned: this.earned,
      unlocked: [...this.unlocked],
      world: {
        size: this.world.size,
        tick: this.world.tick,
        bleachEnabled: this.world.bleachEnabled,
        wildKelp: this.world.wildKelp,
        shellBag: this.world.shellBag || [],
        drone: { x: this.world.drones[0].x, y: this.world.drones[0].y },
        tiles: this.world.tiles.map((t) => [
          t.entity.name, Math.round(t.growth * 100) / 100, t.value,
          Math.round(t.bleach * 100) / 100, t.ground.name,
        ]),
      },
    };
  }

  /**
   * Check a parsed save before fromJSON trusts it. Saves come from a file the
   * player picked, so every field fromJSON reads is checked here.
   * Throws an Error whose message is safe to show the player.
   */
  static validateSave(data) {
    const bad = (why) => { throw new Error(`Not a Reef Tender save: ${why}.`); };
    const ledger = new Set(RESOURCES.map((r) => r.id));
    const isLedger = (o) => o && typeof o === 'object'
      && Object.keys(o).every((k) => ledger.has(k) && Number.isFinite(o[k]) && o[k] >= 0);

    if (!data || typeof data !== 'object' || data.v !== 1 || !data.world) bad('wrong format or version');
    if (!Number.isFinite(data.seed) || !Number.isFinite(data.ticks)) bad('missing seed or tick count');
    if (!isLedger(data.resources) || !isLedger(data.earned)) bad('bad resource ledger');
    if (!Array.isArray(data.unlocked) || !data.unlocked.every((id) => TECH_BY_ID.has(id))) bad('unknown unlock');

    const w = data.world;
    const maxSize = Math.max(...TECH_TREE.map((t) => t.effect?.resize ?? 0));
    if (!Number.isInteger(w.size) || w.size < 1 || w.size > maxSize) bad('bad reef size');
    if (!Array.isArray(w.tiles) || w.tiles.length !== w.size * w.size) bad('tile count does not match reef size');
    const tileOk = (t) => Array.isArray(t) && Object.hasOwn(ENTITIES, t[0]) && Object.hasOwn(GROUNDS, t[4])
      && [t[1], t[2], t[3]].every(Number.isFinite);
    if (!w.tiles.every(tileOk)) bad('corrupt tile');
    if (w.shellBag !== undefined && !(Array.isArray(w.shellBag) && w.shellBag.every(Number.isFinite))) bad('corrupt shell bag');
    return data;
  }

  static fromJSON(data) {
    const s = new Session({ seed: data.seed, size: data.world.size });
    s.ticks = data.ticks || 0;
    Object.assign(s.resources, data.resources || {});
    Object.assign(s.earned, data.earned || {});
    s.unlocked = new Set(data.unlocked || []);
    s.world.tick = data.world.tick || 0;
    s.world.bleachEnabled = !!data.world.bleachEnabled;
    s.world.wildKelp = !s.unlocked.has('seeding');
    s.world.shellBag = data.world.shellBag || [];
    data.world.tiles.forEach(([entity, growth, value, bleach, ground], i) => {
      const t = s.world.tiles[i];
      if (!t) return;
      t.entity = sym(entity);
      t.growth = growth;
      t.value = value;
      t.bleach = bleach;
      t.ground = sym(ground);
    });
    s.world.drones[0].x = data.world.drone?.x ?? 0;
    s.world.drones[0].y = data.world.drone?.y ?? 0;
    s.activeDrone = s.world.drones[0];
    return s;
  }
}

export { repr };
