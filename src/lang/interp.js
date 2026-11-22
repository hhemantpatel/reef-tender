import { runtimeError } from './errors.js';
import { Sym, UserFunction, truthy, repr, valuesEqual, typeName } from './values.js';

// Tree-walking evaluator built entirely out of generators. Every statement
// yields before it runs, and every world action yields again after it lands.
// That single decision is what buys us pause, step, speed control and the live
// line marker in the editor -- the runner just decides how many yields to pull.

const MAX_CALL_DEPTH = 120;

class BreakSignal { }
class ContinueSignal { }
class ReturnSignal { constructor(value) { this.value = value; } }

class Scope {
  constructor(parent = null) {
    this.vars = new Map();
    this.parent = parent;
  }
  lookup(name) {
    let s = this;
    while (s) {
      if (s.vars.has(name)) return s.vars.get(name);
      s = s.parent;
    }
    return undefined;
  }
  has(name) {
    let s = this;
    while (s) {
      if (s.vars.has(name)) return true;
      s = s.parent;
    }
    return false;
  }
  set(name, value) { this.vars.set(name, value); }
}

export class Interpreter {
  /**
   * @param {{builtins: Map<string, Function>, onPrint?: (s: string) => void}} host
   */
  constructor(host) {
    this.host = host;
    this.globals = new Scope();
    this.depth = 0;
  }

  /** Hoists `def`s so a function can be called from a line above its definition. */
  *run(ast) {
    for (const stmt of ast.body) {
      if (stmt.type === 'FunctionDef') {
        this.globals.set(stmt.name, new UserFunction(stmt.name, stmt.params, stmt.body, this.globals));
      }
    }
    yield* this.execBlock(ast.body, this.globals);
  }

  /** Used by spawn_drone(): run a user function as an independent context. */
  *callValue(fn, args, node) {
    yield* this.callFunction(fn, args, node || { line: 0, col: 0 });
  }

  *execBlock(stmts, scope) {
    for (const stmt of stmts) {
      yield* this.execStatement(stmt, scope);
    }
  }

  *execStatement(node, scope) {
    yield { type: 'stmt', line: node.line };

    switch (node.type) {
      case 'ExprStmt':
        yield* this.evalExpr(node.expr, scope);
        return;

      case 'Assign': {
        const value = yield* this.evalExpr(node.value, scope);
        if (node.target.type === 'Name') {
          scope.set(node.target.id, value);
        } else {
          const obj = yield* this.evalExpr(node.target.obj, scope);
          const idx = yield* this.evalExpr(node.target.index, scope);
          this.setIndex(obj, idx, value, node);
        }
        return;
      }

      case 'If': {
        for (const branch of node.tests) {
          if (truthy(yield* this.evalExpr(branch.test, scope))) {
            yield* this.execBlock(branch.body, scope);
            return;
          }
        }
        if (node.orelse) yield* this.execBlock(node.orelse, scope);
        return;
      }

      case 'While': {
        for (;;) {
          if (!truthy(yield* this.evalExpr(node.test, scope))) return;
          try {
            yield* this.execBlock(node.body, scope);
          } catch (e) {
            if (e instanceof BreakSignal) return;
            if (!(e instanceof ContinueSignal)) throw e;
          }
        }
      }

      case 'For': {
        const iterable = yield* this.evalExpr(node.iter, scope);
        if (!Array.isArray(iterable)) {
          throw runtimeError(
            `"for" needs a list or range() to walk through, but got ${typeName(iterable)}.`,
            node.line, node.col,
          );
        }
        for (const item of iterable) {
          scope.set(node.name, item);
          try {
            yield* this.execBlock(node.body, scope);
          } catch (e) {
            if (e instanceof BreakSignal) return;
            if (!(e instanceof ContinueSignal)) throw e;
          }
        }
        return;
      }

      case 'FunctionDef':
        scope.set(node.name, new UserFunction(node.name, node.params, node.body, scope));
        return;

      case 'Return':
        throw new ReturnSignal(node.value ? yield* this.evalExpr(node.value, scope) : null);

      case 'Break': throw new BreakSignal();
      case 'Continue': throw new ContinueSignal();

      default:
        throw runtimeError(`I don't know how to run a ${node.type}.`, node.line, node.col);
    }
  }

  *evalExpr(node, scope) {
    switch (node.type) {
      case 'Num':
      case 'Str':
      case 'Const':
        return node.value;

      case 'Name': {
        if (scope.has(node.id)) return scope.lookup(node.id);
        if (this.host.builtins.has(node.id)) return this.host.builtins.get(node.id);
        throw runtimeError(
          `I don't know what "${node.id}" is. Check the spelling, or look it up in the Manual.`,
          node.line, node.col,
        );
      }

      case 'ListLit': {
        const out = [];
        for (const e of node.elts) out.push(yield* this.evalExpr(e, scope));
        return out;
      }

      case 'BoolOp': {
        const left = yield* this.evalExpr(node.left, scope);
        if (node.op === 'and') return truthy(left) ? yield* this.evalExpr(node.right, scope) : left;
        return truthy(left) ? left : yield* this.evalExpr(node.right, scope);
      }

      case 'UnaryOp': {
        const v = yield* this.evalExpr(node.operand, scope);
        if (node.op === 'not') return !truthy(v);
        if (node.op === '-') return -this.asNumber(v, node);
        return this.asNumber(v, node);
      }

      case 'Compare': {
        const a = yield* this.evalExpr(node.left, scope);
        const b = yield* this.evalExpr(node.right, scope);
        switch (node.op) {
          case '==': return valuesEqual(a, b);
          case '!=': return !valuesEqual(a, b);
          case '<': return this.asNumber(a, node) < this.asNumber(b, node);
          case '<=': return this.asNumber(a, node) <= this.asNumber(b, node);
          case '>': return this.asNumber(a, node) > this.asNumber(b, node);
          case '>=': return this.asNumber(a, node) >= this.asNumber(b, node);
        }
        return false;
      }

      case 'BinOp': {
        const a = yield* this.evalExpr(node.left, scope);
        const b = yield* this.evalExpr(node.right, scope);
        if (node.op === '+' && (typeof a === 'string' || typeof b === 'string')) {
          return repr(a) + repr(b);
        }
        if (node.op === '+' && Array.isArray(a) && Array.isArray(b)) return a.concat(b);
        const x = this.asNumber(a, node);
        const y = this.asNumber(b, node);
        switch (node.op) {
          case '+': return x + y;
          case '-': return x - y;
          case '*': return x * y;
          case '/':
            if (y === 0) throw runtimeError('You can\'t divide by zero.', node.line, node.col);
            return x / y;
          case '//':
            if (y === 0) throw runtimeError('You can\'t divide by zero.', node.line, node.col);
            return Math.floor(x / y);
          case '%':
            if (y === 0) throw runtimeError('You can\'t divide by zero.', node.line, node.col);
            return ((x % y) + y) % y; // Python-style: result takes the sign of y
        }
        return 0;
      }

      case 'Subscript': {
        const obj = yield* this.evalExpr(node.obj, scope);
        const idx = yield* this.evalExpr(node.index, scope);
        return this.getIndex(obj, idx, node);
      }

      case 'Attribute': {
        const obj = yield* this.evalExpr(node.obj, scope);
        return this.getAttribute(obj, node.attr, node);
      }

      case 'Call':
        return yield* this.evalCall(node, scope);

      default:
        throw runtimeError(`I don't know how to evaluate a ${node.type}.`, node.line, node.col);
    }
  }

  *evalCall(node, scope) {
    const callee = yield* this.evalExpr(node.func, scope);
    const args = [];
    for (const a of node.args) args.push(yield* this.evalExpr(a, scope));

    if (typeof callee === 'function') {
      const result = callee(args, this, node);
      // A builtin may itself be a generator (world actions are), in which case
      // its yields flow straight through to the runner and cost ticks.
      if (result && typeof result.next === 'function' && typeof result[Symbol.iterator] === 'function') {
        return yield* result;
      }
      return result === undefined ? null : result;
    }

    if (callee instanceof UserFunction) {
      return yield* this.callFunction(callee, args, node);
    }

    const name = node.func.type === 'Name' ? `"${node.func.id}"` : 'that';
    throw runtimeError(`${name} isn't something you can call.`, node.line, node.col);
  }

  *callFunction(fn, args, node) {
    if (fn.params.length !== args.length) {
      throw runtimeError(
        `"${fn.name}" takes ${fn.params.length} value${fn.params.length === 1 ? '' : 's'}, but you gave it ${args.length}.`,
        node.line, node.col,
      );
    }
    if (++this.depth > MAX_CALL_DEPTH) {
      this.depth--;
      throw runtimeError(
        `"${fn.name}" called itself too many times without stopping.`,
        node.line, node.col,
      );
    }
    const local = new Scope(fn.closure);
    fn.params.forEach((p, i) => local.set(p, args[i]));
    try {
      yield* this.execBlock(fn.body, local);
      return null;
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      throw e;
    } finally {
      this.depth--;
    }
  }

  // --- helpers ----------------------------------------------------------

  asNumber(v, node) {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    throw runtimeError(`I need a number here, but got ${typeName(v)}.`, node.line, node.col);
  }

  getIndex(obj, idx, node) {
    if (!Array.isArray(obj)) {
      throw runtimeError(`Only lists can be indexed with [ ], but this is ${typeName(obj)}.`, node.line, node.col);
    }
    if (typeof idx !== 'number') {
      throw runtimeError(`A list index has to be a number, but got ${typeName(idx)}.`, node.line, node.col);
    }
    const i = idx < 0 ? obj.length + idx : idx;
    if (!Number.isInteger(i) || i < 0 || i >= obj.length) {
      throw runtimeError(
        `This list has ${obj.length} item${obj.length === 1 ? '' : 's'}, so index ${repr(idx)} is out of range.`,
        node.line, node.col,
      );
    }
    return obj[i];
  }

  setIndex(obj, idx, value, node) {
    if (!Array.isArray(obj)) {
      throw runtimeError(`Only lists can be indexed with [ ], but this is ${typeName(obj)}.`, node.line, node.col);
    }
    const i = idx < 0 ? obj.length + idx : idx;
    if (!Number.isInteger(i) || i < 0 || i >= obj.length) {
      throw runtimeError(
        `This list has ${obj.length} item${obj.length === 1 ? '' : 's'}, so index ${repr(idx)} is out of range.`,
        node.line, node.col,
      );
    }
    obj[i] = value;
  }

  getAttribute(obj, attr, node) {
    if (Array.isArray(obj)) {
      if (attr === 'append') {
        const f = (args) => { obj.push(args[0] === undefined ? null : args[0]); return null; };
        f.reefName = 'append';
        return f;
      }
      if (attr === 'pop') {
        const f = (args) => {
          if (!obj.length) throw runtimeError('There is nothing left to pop off this list.', node.line, node.col);
          return args.length ? obj.splice(args[0] < 0 ? obj.length + args[0] : args[0], 1)[0] : obj.pop();
        };
        f.reefName = 'pop';
        return f;
      }
    }
    throw runtimeError(`${typeName(obj)} has no "${attr}".`, node.line, node.col);
  }
}

export { Sym, UserFunction, repr, truthy };
