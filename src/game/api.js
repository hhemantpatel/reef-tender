import { runtimeError } from '../lang/errors.js';
import { Sym, UserFunction, typeName } from '../lang/values.js';
import {
  DIRECTIONS, ENTITIES, GROUNDS, EMPTY, KELP, ANEMONE, CORAL, SHELL, ROCK,
} from './world.js';

// The drone's own vocabulary. Anything that touches the reef is a generator:
// it changes the world, then yields a tick so the runner can advance time and
// the renderer can draw the result.

const PEARLS_PER_SCRUB = 22;
const BLOOM_MULTIPLIER = 4;
const SORT_MULTIPLIER = 20;

const DIR_DELTA = { NORTH: [0, 1], EAST: [1, 0], SOUTH: [0, -1], WEST: [-1, 0] };

export function createGameBuiltins(session) {
  const b = new Map();
  const world = () => session.world;
  const drone = () => session.activeDrone;
  const tile = () => world().tileOf(drone());

  const asDirection = (v, name, node) => {
    if (!(v instanceof Sym) || !DIR_DELTA[v.name]) {
      throw runtimeError(
        `"${name}" needs a direction: NORTH, EAST, SOUTH or WEST. Got ${typeName(v)}.`,
        node.line, node.col,
      );
    }
    return DIR_DELTA[v.name];
  };
  const arity = (args, n, name, node) => {
    if (args.length !== n) {
      throw runtimeError(
        `"${name}" takes ${n} value${n === 1 ? '' : 's'}, but you gave it ${args.length}.`,
        node.line, node.col,
      );
    }
  };

  // --- constants --------------------------------------------------------
  for (const [name, value] of Object.entries({ ...DIRECTIONS, ...ENTITIES, ...GROUNDS })) {
    b.set(name, value);
  }

  // --- actions (cost a tick) -------------------------------------------

  b.set('move', function* (args, _i, node) {
    arity(args, 1, 'move', node);
    const [dx, dy] = asDirection(args[0], 'move', node);
    const d = drone();
    d.trail.push({ x: d.x, y: d.y, t: session.ticks });
    if (d.trail.length > 12) d.trail.shift();
    d.x = world().wrap(d.x + dx);
    d.y = world().wrap(d.y + dy);
    yield* session.spendTick(node);
    return null;
  });

  b.set('wait', function* (args, _i, node) {
    arity(args, 0, 'wait', node);
    yield* session.spendTick(node);
    return null;
  });

  b.set('harvest', function* (args, _i, node) {
    arity(args, 0, 'harvest', node);
    const t = tile();
    const w = world();
    let got = false;

    if (w.canHarvest(t)) {
      if (t.entity === CORAL && w.isBloomReady()) {
        const payout = w.tiles.length * BLOOM_MULTIPLIER;
        session.credit('coral', payout);
        for (const cell of w.tiles) { cell.entity = EMPTY; cell.growth = 0; }
        session.event('bloom', payout);
        got = true;
      } else if (t.entity === SHELL && w.isSorted()) {
        const payout = w.tiles.length * SORT_MULTIPLIER;
        session.credit('nacre', payout);
        for (const cell of w.tiles) { cell.entity = EMPTY; cell.value = 0; }
        w.shellBag = [];
        session.event('sorted', payout);
        got = true;
      } else {
        const single = {
          KELP: ['kelp', 1], ANEMONE: ['anemone', 1],
          CORAL: ['coral', 1], SHELL: ['nacre', 1],
        }[t.entity.name];
        if (single) {
          session.credit(single[0], single[1]);
          t.entity = EMPTY;
          t.growth = 0;
          t.value = 0;
          got = true;
        }
      }
    }
    yield* session.spendTick(node);
    return got;
  });

  b.set('plant', function* (args, _i, node) {
    arity(args, 1, 'plant', node);
    const kind = args[0];
    if (!(kind instanceof Sym) || !['KELP', 'ANEMONE', 'CORAL', 'SHELL'].includes(kind.name)) {
      throw runtimeError(
        `"plant" needs KELP, ANEMONE, CORAL or SHELL. Got ${typeName(kind)}.`,
        node.line, node.col,
      );
    }
    const t = tile();
    const w = world();
    let ok = false;
    if (t.entity === EMPTY && t.bleach === 0 && !(kind === KELP && t.ground === ROCK)) {
      t.entity = kind;
      t.growth = 0;
      if (kind === SHELL) {
        if (!w.shellBag || !w.shellBag.length) w.shellBag = shuffledSizes(w);
        t.value = w.shellBag.pop();
      }
      ok = true;
    }
    yield* session.spendTick(node);
    return ok;
  });

  b.set('scrub', function* (args, _i, node) {
    arity(args, 0, 'scrub', node);
    const t = tile();
    let ok = false;
    if (t.bleach > 0) {
      t.bleach = 0;
      session.credit('pearl', PEARLS_PER_SCRUB);
      ok = true;
    }
    yield* session.spendTick(node);
    return ok;
  });

  b.set('swap', function* (args, _i, node) {
    arity(args, 1, 'swap', node);
    const [dx, dy] = asDirection(args[0], 'swap', node);
    const d = drone();
    const a = tile();
    const c = world().at(d.x + dx, d.y + dy);
    const keys = ['entity', 'growth', 'value'];
    for (const k of keys) { const tmp = a[k]; a[k] = c[k]; c[k] = tmp; }
    yield* session.spendTick(node);
    return null;
  });

  // --- sensors and utilities (free) ------------------------------------

  b.set('can_harvest', (args, _i, node) => {
    arity(args, 0, 'can_harvest', node);
    return world().canHarvest(tile());
  });
  b.set('sense', (args, _i, node) => { arity(args, 0, 'sense', node); return tile().entity; });
  b.set('measure', (args, _i, node) => { arity(args, 0, 'measure', node); return world().measure(tile()); });
  b.set('get_ground', (args, _i, node) => { arity(args, 0, 'get_ground', node); return tile().ground; });
  b.set('is_bleached', (args, _i, node) => { arity(args, 0, 'is_bleached', node); return tile().bleach > 0; });
  b.set('get_pos_x', (args, _i, node) => { arity(args, 0, 'get_pos_x', node); return drone().x; });
  b.set('get_pos_y', (args, _i, node) => { arity(args, 0, 'get_pos_y', node); return drone().y; });
  b.set('get_world_size', (args, _i, node) => { arity(args, 0, 'get_world_size', node); return world().size; });
  b.set('num_drones', (args, _i, node) => { arity(args, 0, 'num_drones', node); return world().drones.length; });

  b.set('spawn_drone', (args, interp, node) => {
    arity(args, 1, 'spawn_drone', node);
    const fn = args[0];
    if (!(fn instanceof UserFunction)) {
      throw runtimeError(
        '"spawn_drone" needs the name of a function you defined, with no parentheses after it.',
        node.line, node.col,
      );
    }
    if (fn.params.length) {
      throw runtimeError('The function given to "spawn_drone" must take no parameters.', node.line, node.col);
    }
    return session.spawnDrone(fn, interp, node);
  });

  for (const [name, fn] of b) if (typeof fn === 'function') fn.reefName = name;
  return b;
}

/**
 * Distinct shell sizes drawn without replacement. Sizes already sitting on the
 * reef are excluded, so a refilled bag can never create a duplicate and leave
 * the player with a reef that cannot be sorted.
 */
function shuffledSizes(world) {
  const taken = new Set(world.tiles.filter((t) => t.entity === SHELL).map((t) => t.value));
  const sizes = [];
  for (let i = 1; sizes.length < world.tiles.length && i <= world.tiles.length * 2; i++) {
    if (!taken.has(i)) sizes.push(i);
  }
  for (let i = sizes.length - 1; i > 0; i--) {
    const j = Math.floor(world.rng() * (i + 1));
    [sizes[i], sizes[j]] = [sizes[j], sizes[i]];
  }
  return sizes;
}
