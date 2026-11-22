import { tokenize } from './lexer.js';
import { syntaxError, lockedError } from './errors.js';
import { featureLabel } from './features.js';

// Recursive-descent parser producing a small AST. It also enforces the unlock
// tree: syntax the player hasn't bought yet fails here, at parse time, with a
// message that says where to buy it -- never as a baffling runtime error.

const COMPARE_OPS = new Set(['==', '!=', '<', '<=', '>', '>=']);
const ADD_OPS = new Set(['+', '-']);
const MUL_OPS = new Set(['*', '/', '//', '%']);

class Parser {
  constructor(src, opts) {
    this.tokens = tokenize(src);
    this.pos = 0;
    this.features = opts.features || new Set();
    this.lockedNames = opts.lockedNames || new Map();
    this.depth = 0;
  }

  peek(offset = 0) { return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]; }
  get current() { return this.peek(); }

  at(type, value) {
    const t = this.current;
    return t.type === type && (value === undefined || t.value === value);
  }

  next() { return this.tokens[this.pos++]; }

  expect(type, value, what) {
    if (!this.at(type, value)) {
      const t = this.current;
      const got = t.type === 'NEWLINE' ? 'the end of the line'
        : t.type === 'EOF' ? 'the end of your script'
        : t.type === 'INDENT' ? 'an indented line'
        : t.type === 'DEDENT' ? 'a line with less indentation'
        : `"${t.value}"`;
      throw syntaxError(`Expected ${what || `"${value}"`} but found ${got}.`, t.line, t.col);
    }
    return this.next();
  }

  requireFeature(id, what) {
    if (!this.features.has(id)) {
      const t = this.current;
      throw lockedError(
        `${what} isn't unlocked yet - buy ${featureLabel(id)} in the Lab.`,
        t.line, t.col,
      );
    }
  }

  skipNewlines() { while (this.at('NEWLINE')) this.next(); }

  // --- statements -------------------------------------------------------

  parseModule() {
    const body = [];
    this.skipNewlines();
    while (!this.at('EOF')) {
      body.push(...this.parseStatement());
      this.skipNewlines();
    }
    return { type: 'Module', body, line: 1, col: 1 };
  }

  parseBlock() {
    this.expect('OP', ':', 'a ":" here');
    // Inline form: `if x: harvest()`
    if (!this.at('NEWLINE')) return this.parseSimpleLine();
    this.next();
    if (!this.at('INDENT')) {
      const t = this.current;
      throw syntaxError(
        'This block is empty - the lines inside it need to be indented.',
        t.line, t.col,
      );
    }
    this.next();
    const body = [];
    this.skipNewlines();
    while (!this.at('DEDENT') && !this.at('EOF')) {
      body.push(...this.parseStatement());
      this.skipNewlines();
    }
    if (this.at('DEDENT')) this.next();
    return body;
  }

  parseSimpleLine() {
    const stmts = [this.parseSimpleStatement()];
    if (!this.at('EOF')) this.expect('NEWLINE', undefined, 'the end of the line');
    return stmts;
  }

  parseStatement() {
    const t = this.current;
    if (t.type === 'KEYWORD') {
      switch (t.value) {
        case 'if': return [this.parseIf()];
        case 'while': return [this.parseWhile()];
        case 'for': return [this.parseFor()];
        case 'def': return [this.parseDef()];
        case 'elif':
        case 'else':
          throw syntaxError(
            `"${t.value}" has to line up with an "if" above it.`, t.line, t.col,
          );
      }
    }
    return this.parseSimpleLine();
  }

  parseIf() {
    this.requireFeature('branching', '"if"');
    const start = this.next(); // if
    const tests = [];
    tests.push({ test: this.parseExpr(), body: this.parseBlock() });
    let orelse = null;
    this.skipNewlines();
    while (this.at('KEYWORD', 'elif')) {
      this.next();
      tests.push({ test: this.parseExpr(), body: this.parseBlock() });
      this.skipNewlines();
    }
    if (this.at('KEYWORD', 'else')) {
      this.next();
      orelse = this.parseBlock();
    }
    return { type: 'If', tests, orelse, line: start.line, col: start.col };
  }

  parseWhile() {
    this.requireFeature('loops', '"while"');
    const start = this.next();
    const test = this.parseExpr();
    const body = this.parseBlock();
    return { type: 'While', test, body, line: start.line, col: start.col };
  }

  parseFor() {
    this.requireFeature('counting', '"for"');
    const start = this.next();
    const name = this.expect('NAME', undefined, 'a variable name').value;
    this.expect('KEYWORD', 'in', '"in"');
    const iter = this.parseExpr();
    const body = this.parseBlock();
    return { type: 'For', name, iter, body, line: start.line, col: start.col };
  }

  parseDef() {
    this.requireFeature('functions', '"def"');
    const start = this.next();
    const name = this.expect('NAME', undefined, 'a function name').value;
    this.expect('OP', '(', 'a "(" after the function name');
    const params = [];
    while (!this.at('OP', ')')) {
      params.push(this.expect('NAME', undefined, 'a parameter name').value);
      if (this.at('OP', ',')) this.next();
      else break;
    }
    this.expect('OP', ')', 'a ")"');
    const body = this.parseBlock();
    return { type: 'FunctionDef', name, params, body, line: start.line, col: start.col };
  }

  parseSimpleStatement() {
    const t = this.current;
    if (t.type === 'KEYWORD') {
      if (t.value === 'return') {
        this.requireFeature('functions', '"return"');
        this.next();
        const value = this.at('NEWLINE') || this.at('EOF') ? null : this.parseExpr();
        return { type: 'Return', value, line: t.line, col: t.col };
      }
      if (t.value === 'break' || t.value === 'continue') {
        this.requireFeature('loops', `"${t.value}"`);
        this.next();
        return { type: t.value === 'break' ? 'Break' : 'Continue', line: t.line, col: t.col };
      }
    }

    const expr = this.parseExpr();

    if (this.at('OP', '=')) {
      this.requireFeature('counting', 'Storing values in variables');
      const op = this.next();
      const value = this.parseExpr();
      if (expr.type !== 'Name' && expr.type !== 'Subscript') {
        throw syntaxError('You can only assign to a variable or a list slot.', op.line, op.col);
      }
      return { type: 'Assign', target: expr, value, line: t.line, col: t.col };
    }
    if (this.at('OP', '+=') || this.at('OP', '-=')) {
      this.requireFeature('counting', 'Storing values in variables');
      const op = this.next();
      const value = this.parseExpr();
      if (expr.type !== 'Name' && expr.type !== 'Subscript') {
        throw syntaxError('You can only assign to a variable or a list slot.', op.line, op.col);
      }
      return {
        type: 'Assign',
        target: expr,
        value: { type: 'BinOp', op: op.value[0], left: expr, right: value, line: op.line, col: op.col },
        line: t.line, col: t.col,
      };
    }
    return { type: 'ExprStmt', expr, line: t.line, col: t.col };
  }

  // --- expressions ------------------------------------------------------

  parseExpr() { return this.parseOr(); }

  parseOr() {
    let left = this.parseAnd();
    while (this.at('KEYWORD', 'or')) {
      this.requireFeature('branching', '"or"');
      const t = this.next();
      left = { type: 'BoolOp', op: 'or', left, right: this.parseAnd(), line: t.line, col: t.col };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseNot();
    while (this.at('KEYWORD', 'and')) {
      this.requireFeature('branching', '"and"');
      const t = this.next();
      left = { type: 'BoolOp', op: 'and', left, right: this.parseNot(), line: t.line, col: t.col };
    }
    return left;
  }

  parseNot() {
    if (this.at('KEYWORD', 'not')) {
      this.requireFeature('branching', '"not"');
      const t = this.next();
      return { type: 'UnaryOp', op: 'not', operand: this.parseNot(), line: t.line, col: t.col };
    }
    return this.parseCompare();
  }

  parseCompare() {
    let left = this.parseAdditive();
    while (this.current.type === 'OP' && COMPARE_OPS.has(this.current.value)) {
      this.requireFeature('branching', 'Comparing values');
      const t = this.next();
      left = { type: 'Compare', op: t.value, left, right: this.parseAdditive(), line: t.line, col: t.col };
    }
    return left;
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.current.type === 'OP' && ADD_OPS.has(this.current.value)) {
      this.requireFeature('counting', 'Arithmetic');
      const t = this.next();
      left = { type: 'BinOp', op: t.value, left, right: this.parseMultiplicative(), line: t.line, col: t.col };
    }
    return left;
  }

  parseMultiplicative() {
    let left = this.parseUnary();
    while (this.current.type === 'OP' && MUL_OPS.has(this.current.value)) {
      this.requireFeature('counting', 'Arithmetic');
      const t = this.next();
      left = { type: 'BinOp', op: t.value, left, right: this.parseUnary(), line: t.line, col: t.col };
    }
    return left;
  }

  parseUnary() {
    if (this.at('OP', '-') || this.at('OP', '+')) {
      const t = this.next();
      return { type: 'UnaryOp', op: t.value, operand: this.parseUnary(), line: t.line, col: t.col };
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let node = this.parsePrimary();
    for (;;) {
      if (this.at('OP', '(')) {
        const t = this.next();
        const args = [];
        while (!this.at('OP', ')')) {
          args.push(this.parseExpr());
          if (this.at('OP', ',')) this.next();
          else break;
        }
        this.expect('OP', ')', 'a ")" to close the call');
        node = { type: 'Call', func: node, args, line: node.line, col: node.col };
      } else if (this.at('OP', '[')) {
        this.requireFeature('lists', 'Indexing with [ ]');
        const t = this.next();
        const index = this.parseExpr();
        this.expect('OP', ']', 'a "]"');
        node = { type: 'Subscript', obj: node, index, line: t.line, col: t.col };
      } else if (this.at('OP', '.')) {
        const t = this.next();
        const attr = this.expect('NAME', undefined, 'a name after the "."').value;
        node = { type: 'Attribute', obj: node, attr, line: t.line, col: t.col };
      } else {
        return node;
      }
    }
  }

  parsePrimary() {
    const t = this.current;

    if (t.type === 'NUMBER') { this.next(); return { type: 'Num', value: t.value, line: t.line, col: t.col }; }
    if (t.type === 'STRING') { this.next(); return { type: 'Str', value: t.value, line: t.line, col: t.col }; }

    if (t.type === 'KEYWORD' && (t.value === 'True' || t.value === 'False')) {
      this.requireFeature('loops', 'True / False');
      this.next();
      return { type: 'Const', value: t.value === 'True', line: t.line, col: t.col };
    }
    if (t.type === 'KEYWORD' && t.value === 'None') {
      this.next();
      return { type: 'Const', value: null, line: t.line, col: t.col };
    }

    if (t.type === 'NAME') {
      const locked = this.lockedNames.get(t.value);
      if (locked && !this.features.has(locked)) {
        throw lockedError(
          `"${t.value}" isn't unlocked yet - buy ${featureLabel(locked)} in the Lab.`,
          t.line, t.col,
        );
      }
      this.next();
      return { type: 'Name', id: t.value, line: t.line, col: t.col };
    }

    if (t.type === 'OP' && t.value === '(') {
      this.next();
      const inner = this.parseExpr();
      this.expect('OP', ')', 'a ")"');
      return inner;
    }

    if (t.type === 'OP' && t.value === '[') {
      this.requireFeature('lists', 'Lists');
      this.next();
      const elts = [];
      this.skipNewlines();
      while (!this.at('OP', ']')) {
        elts.push(this.parseExpr());
        this.skipNewlines();
        if (this.at('OP', ',')) { this.next(); this.skipNewlines(); }
        else break;
      }
      this.expect('OP', ']', 'a "]" to close the list');
      return { type: 'ListLit', elts, line: t.line, col: t.col };
    }

    const got = t.type === 'NEWLINE' ? 'the end of the line'
      : t.type === 'EOF' ? 'the end of your script'
      : `"${t.value}"`;
    throw syntaxError(`I expected a value here, but found ${got}.`, t.line, t.col);
  }
}

export function parse(src, opts = {}) {
  return new Parser(src, opts).parseModule();
}
