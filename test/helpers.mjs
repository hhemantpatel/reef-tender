import { parse } from '../src/lang/parser.js';
import { Interpreter } from '../src/lang/interp.js';
import { makeCoreBuiltins, CORE_LOCKED_NAMES } from '../src/lang/builtins.js';
import { FEATURE_LABELS } from '../src/lang/features.js';

export const ALL_FEATURES = new Set(Object.keys(FEATURE_LABELS));

/** Run a script to completion (or until maxSteps) and collect its printed output. */
export function runScript(src, opts = {}) {
  const output = [];
  const builtins = makeCoreBuiltins({ onPrint: (s) => output.push(s) });
  for (const [k, v] of Object.entries(opts.builtins || {})) {
    v.reefName = k;
    builtins.set(k, v);
  }
  const features = opts.features || ALL_FEATURES;
  const ast = parse(src, { features, lockedNames: CORE_LOCKED_NAMES });
  const interp = new Interpreter({ builtins });
  const gen = interp.run(ast);
  let steps = 0;
  const maxSteps = opts.maxSteps ?? 200000;
  for (const _ of gen) {
    if (++steps > maxSteps) throw new Error('step limit exceeded');
  }
  return { output, steps };
}

/** Capture the error a script raises, for assertions about messages and lines. */
export function catchError(src, opts = {}) {
  try {
    runScript(src, opts);
  } catch (e) {
    return e;
  }
  return null;
}
