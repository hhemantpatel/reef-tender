import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript, catchError, ALL_FEATURES } from './helpers.mjs';

const out = (src, opts) => runScript(src, opts).output;

test('literals and print', () => {
  assert.deepEqual(out('print(1)\nprint("hi")\nprint(True)\nprint(None)\n'), ['1', 'hi', 'True', 'None']);
});

test('arithmetic follows precedence', () => {
  assert.deepEqual(out('print(2 + 3 * 4)\nprint((2 + 3) * 4)\nprint(7 // 2)\nprint(7 / 2)'), ['14', '20', '3', '3.5']);
});

test('modulo takes the sign of the divisor, like Python', () => {
  assert.deepEqual(out('print(-1 % 4)\nprint(5 % 3)'), ['3', '2']);
});

test('comparison and boolean operators', () => {
  assert.deepEqual(out('print(1 < 2 and 2 < 3)\nprint(not 0)\nprint(1 == 2 or 3 != 4)'), ['True', 'True', 'True']);
});

test('and/or short-circuit and return operands', () => {
  assert.deepEqual(out('print(0 or 5)\nprint(3 and 7)'), ['5', '7']);
});

test('if / elif / else picks one branch', () => {
  const src = 'x = 5\nif x > 10:\n    print("big")\nelif x > 3:\n    print("mid")\nelse:\n    print("small")\n';
  assert.deepEqual(out(src), ['mid']);
});

test('while loop with break and continue', () => {
  const src = [
    'i = 0',
    'while True:',
    '    i = i + 1',
    '    if i == 2:',
    '        continue',
    '    if i > 4:',
    '        break',
    '    print(i)',
  ].join('\n');
  assert.deepEqual(out(src), ['1', '3', '4']);
});

test('for over range and over a list', () => {
  assert.deepEqual(out('for i in range(3):\n    print(i)'), ['0', '1', '2']);
  assert.deepEqual(out('for v in [7, 8]:\n    print(v)'), ['7', '8']);
  assert.deepEqual(out('for i in range(1, 6, 2):\n    print(i)'), ['1', '3', '5']);
});

test('nested blocks keep their indentation levels', () => {
  const src = [
    'for i in range(3):',
    '    for j in range(2):',
    '        if i == j:',
    '            print(i)',
    '    print("row")',
  ].join('\n');
  assert.deepEqual(out(src), ['0', 'row', '1', 'row', 'row']);
});

test('functions take parameters, return values, and recurse', () => {
  const src = [
    'def add(a, b):',
    '    return a + b',
    'def fact(n):',
    '    if n <= 1:',
    '        return 1',
    '    return n * fact(n - 1)',
    'print(add(2, 3))',
    'print(fact(5))',
  ].join('\n');
  assert.deepEqual(out(src), ['5', '120']);
});

test('a function can be called from a line above its definition', () => {
  assert.deepEqual(out('go()\ndef go():\n    print("ok")'), ['ok']);
});

test('function locals do not leak into globals', () => {
  const src = 'x = 1\ndef f():\n    x = 99\n    return x\nprint(f())\nprint(x)';
  assert.deepEqual(out(src), ['99', '1']);
});

test('lists index, assign, append, pop and report length', () => {
  const src = [
    'xs = [3, 1, 2]',
    'xs.append(9)',
    'xs[0] = 10',
    'print(xs)',
    'print(len(xs))',
    'print(xs[-1])',
    'print(xs.pop())',
    'print(xs)',
  ].join('\n');
  assert.deepEqual(out(src), ['[10, 1, 2, 9]', '4', '9', '9', '[10, 1, 2]']);
});

test('a real sorting algorithm runs correctly', () => {
  const src = [
    'xs = [5, 2, 9, 1, 7]',
    'n = len(xs)',
    'for i in range(n):',
    '    for j in range(n - 1 - i):',
    '        if xs[j] > xs[j + 1]:',
    '            t = xs[j]',
    '            xs[j] = xs[j + 1]',
    '            xs[j + 1] = t',
    'print(xs)',
  ].join('\n');
  assert.deepEqual(out(src), ['[1, 2, 5, 7, 9]']);
});

test('comments, blank lines and inline blocks are all accepted', () => {
  const src = '# lead comment\n\nx = 1  # trailing\n\nif x: print("yes")\n\n# trailing comment';
  assert.deepEqual(out(src), ['yes']);
});

test('string concatenation coerces the other operand', () => {
  assert.deepEqual(out('print("n=" + 3)'), ['n=3']);
});

// --- errors ------------------------------------------------------------

test('errors carry the line they happened on', () => {
  const e = catchError('x = 1\nprint(2)\nprint(nope)\n');
  assert.equal(e.line, 3);
  assert.match(e.message, /don't know what "nope" is/);
});

test('unclosed bracket is a syntax error, not a crash', () => {
  const e = catchError('print(1\n');
  assert.equal(e.kind, 'syntax');
});

test('bad indentation is reported clearly', () => {
  const e = catchError('if True:\n        print(1)\n      print(2)\n');
  assert.equal(e.kind, 'syntax');
  assert.match(e.message, /does not line up/);
});

test('division by zero is caught', () => {
  assert.match(catchError('print(1 / 0)').message, /divide by zero/);
});

test('index out of range names the list length', () => {
  const e = catchError('xs = [1, 2]\nprint(xs[5])');
  assert.equal(e.line, 2);
  assert.match(e.message, /2 items/);
});

test('runaway recursion is stopped', () => {
  assert.match(catchError('def f():\n    return f()\nf()').message, /too many times/);
});

test('wrong argument count is reported', () => {
  assert.match(catchError('def f(a):\n    return a\nf(1, 2)').message, /takes 1 value/);
});

// --- unlock gating -----------------------------------------------------

const gated = (src, features) => catchError(src, { features: new Set(features) });

test('locked syntax fails at parse time and names the unlock', () => {
  assert.match(gated('while True:\n    harvest()', []).message, /buy Loops in the Lab/);
  assert.match(gated('if 1:\n    print(1)', ['loops']).message, /buy Branching/);
  assert.match(gated('for i in range(2):\n    print(i)', ['loops', 'branching']).message, /buy Counting/);
  assert.match(gated('def f():\n    print(1)', ['loops', 'branching', 'counting']).message, /buy Functions/);
  assert.match(gated('xs = [1]', ['loops', 'branching', 'counting']).message, /buy Lists/);
});

test('assignment is gated behind Counting', () => {
  assert.match(gated('x = 1', ['loops', 'branching']).message, /buy Counting/);
});

test('a locked builtin name is caught before the program runs', () => {
  const e = gated('print(len("ab"))', ['loops', 'branching', 'counting']);
  assert.match(e.message, /"len" isn't unlocked yet/);
  assert.equal(e.kind, 'locked');
});

test('everything unlocked parses the full language', () => {
  assert.doesNotThrow(() => runScript('x = [1]\nfor i in x:\n    print(i)', { features: ALL_FEATURES }));
});

// --- generator plumbing -------------------------------------------------

test('builtin generators can yield ticks mid-expression', () => {
  let ticks = 0;
  const src = 'x = act() + act()\nprint(x)';
  const res = runScript(src, {
    builtins: {
      act: function* () { ticks++; yield { type: 'tick', line: 0 }; return 5; },
    },
  });
  assert.equal(ticks, 2);
  assert.deepEqual(res.output, ['10']);
});
