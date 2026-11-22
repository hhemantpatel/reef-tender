import { runtimeError } from './errors.js';
import { repr, typeName } from './values.js';

// Language-level builtins (the game's own actions live in game/api.js).
// Each takes (args, interp, node) so it can raise errors that point at a line.

export function makeCoreBuiltins({ onPrint }) {
  const need = (args, n, name, node) => {
    if (args.length !== n) {
      throw runtimeError(
        `"${name}" takes ${n} value${n === 1 ? '' : 's'}, but you gave it ${args.length}.`,
        node.line, node.col,
      );
    }
  };
  const num = (v, name, node) => {
    if (typeof v !== 'number') {
      throw runtimeError(`"${name}" needs a number, but got ${typeName(v)}.`, node.line, node.col);
    }
    return v;
  };

  const b = new Map();

  b.set('print', (args) => {
    onPrint(args.map(repr).join(' '));
    return null;
  });

  b.set('range', (args, _i, node) => {
    if (args.length < 1 || args.length > 3) {
      throw runtimeError('"range" takes 1 to 3 numbers, like range(5) or range(1, 10, 2).', node.line, node.col);
    }
    const nums = args.map((a) => num(a, 'range', node));
    const [start, stop, step] = nums.length === 1
      ? [0, nums[0], 1]
      : [nums[0], nums[1], nums[2] === undefined ? 1 : nums[2]];
    if (step === 0) throw runtimeError('"range" can\'t step by zero.', node.line, node.col);
    const out = [];
    // Capped so range(1e9) reports a mistake instead of freezing the tab.
    const count = Math.ceil((stop - start) / step);
    if (count > 100000) {
      throw runtimeError('That range is too big - keep it under 100000 items.', node.line, node.col);
    }
    for (let v = start; step > 0 ? v < stop : v > stop; v += step) out.push(v);
    return out;
  });

  b.set('len', (args, _i, node) => {
    need(args, 1, 'len', node);
    const v = args[0];
    if (Array.isArray(v) || typeof v === 'string') return v.length;
    throw runtimeError(`"len" works on lists and text, but got ${typeName(v)}.`, node.line, node.col);
  });

  b.set('str', (args, _i, node) => { need(args, 1, 'str', node); return repr(args[0]); });

  b.set('int', (args, _i, node) => {
    need(args, 1, 'int', node);
    const v = args[0];
    if (typeof v === 'number') return Math.trunc(v);
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Math.trunc(Number(v));
    throw runtimeError(`"int" can't turn ${typeName(v)} into a number.`, node.line, node.col);
  });

  b.set('abs', (args, _i, node) => { need(args, 1, 'abs', node); return Math.abs(num(args[0], 'abs', node)); });

  const spread = (args, node, name) => {
    const list = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    if (!list.length) throw runtimeError(`"${name}" needs at least one number.`, node.line, node.col);
    return list.map((v) => num(v, name, node));
  };
  b.set('min', (args, _i, node) => Math.min(...spread(args, node, 'min')));
  b.set('max', (args, _i, node) => Math.max(...spread(args, node, 'max')));

  for (const [name, fn] of b) fn.reefName = name;
  return b;
}

/** Names the parser should reject early, with the unlock that grants them. */
export const CORE_LOCKED_NAMES = new Map([
  ['range', 'counting'],
  ['len', 'lists'],
]);
