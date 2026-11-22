// Game constants (NORTH, KELP, ...) are singletons compared by identity, so
// `sense() == KELP` works without any string juggling in the interpreter.

export class Sym {
  constructor(name) { this.name = name; }
  toString() { return this.name; }
}

const registry = new Map();
export function sym(name) {
  if (!registry.has(name)) registry.set(name, new Sym(name));
  return registry.get(name);
}

export class UserFunction {
  constructor(name, params, body, closure) {
    this.name = name;
    this.params = params;
    this.body = body;
    this.closure = closure;
  }
}

/** Python-ish truthiness: 0, "", None and [] are all false. */
export function truthy(v) {
  if (v === null || v === undefined || v === false) return false;
  if (v === true) return true;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** How a value looks in print() and in the console. */
export function repr(v) {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    return String(Math.round(v * 1e6) / 1e6);
  }
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return `[${v.map(repr).join(', ')}]`;
  if (v instanceof Sym) return v.name;
  if (v instanceof UserFunction) return `<function ${v.name}>`;
  if (typeof v === 'function') return `<builtin ${v.reefName || 'function'}>`;
  return String(v);
}

export function valuesEqual(a, b) {
  if (a instanceof Sym || b instanceof Sym) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => valuesEqual(x, b[i]));
  }
  if (a === null || a === undefined) return b === null || b === undefined;
  return a === b;
}

/** Short name for a value's type, used in error messages. */
export function typeName(v) {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return 'a True/False value';
  if (typeof v === 'number') return 'a number';
  if (typeof v === 'string') return 'text';
  if (Array.isArray(v)) return 'a list';
  if (v instanceof Sym) return 'a constant';
  return 'a function';
}
