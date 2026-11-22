import { syntaxError } from './errors.js';

// Indentation-scoped tokenizer. Emits INDENT/DEDENT so the language nests by
// indentation the way Python does, and carries source offsets on every token so
// the same pass can drive the editor's syntax highlighting.

export const KEYWORDS = new Set([
  'if', 'elif', 'else', 'while', 'for', 'in', 'def', 'return',
  'break', 'continue', 'and', 'or', 'not', 'True', 'False', 'None',
]);

// Longest first: '//' must win over '/', '==' over '='.
const OPERATORS = [
  '//', '==', '!=', '<=', '>=', '+=', '-=',
  '+', '-', '*', '/', '%', '<', '>', '=',
  '(', ')', '[', ']', '{', '}', ',', ':', '.',
];

const TAB_WIDTH = 4;

const isDigit = (c) => c >= '0' && c <= '9';
const isNameStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isNameChar = (c) => isNameStart(c) || isDigit(c);

/**
 * @param {string} src
 * @param {{keepTrivia?: boolean}} [opts] keepTrivia keeps comments in the stream
 *   (the highlighter wants them; the parser does not).
 * @returns {Array<{type:string,value:any,line:number,col:number,start:number,end:number}>}
 */
export function tokenize(src, opts = {}) {
  const keepTrivia = !!opts.keepTrivia;
  const tokens = [];
  const indents = [0];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  let bracketDepth = 0;
  let atLineStart = true;

  const push = (type, value, start, end, ln = line) => {
    tokens.push({ type, value, line: ln, col: start - lineStart + 1, start, end });
  };

  while (i < src.length) {
    // --- start of a logical line: measure indentation -------------------
    if (atLineStart && bracketDepth === 0) {
      let width = 0;
      const indentStart = i;
      while (i < src.length && (src[i] === ' ' || src[i] === '\t')) {
        width += src[i] === '\t' ? TAB_WIDTH - (width % TAB_WIDTH) : 1;
        i++;
      }
      // A blank or comment-only line carries no indentation information.
      if (i >= src.length || src[i] === '\n' || src[i] === '\r' || src[i] === '#') {
        if (keepTrivia && src[i] === '#') {
          const s = i;
          while (i < src.length && src[i] !== '\n') i++;
          push('COMMENT', src.slice(s, i), s, i);
        } else {
          while (i < src.length && src[i] !== '\n') i++;
        }
        if (i < src.length) { i++; line++; lineStart = i; }
        continue;
      }
      const top = indents[indents.length - 1];
      if (width > top) {
        indents.push(width);
        push('INDENT', width, indentStart, i);
      } else if (width < top) {
        while (indents.length && indents[indents.length - 1] > width) {
          indents.pop();
          push('DEDENT', width, indentStart, i);
        }
        if (indents[indents.length - 1] !== width) {
          throw syntaxError(
            'This line is indented to a level that does not line up with any block above it.',
            line, width + 1,
          );
        }
      }
      atLineStart = false;
      continue;
    }

    const c = src[i];

    // --- newline --------------------------------------------------------
    if (c === '\n' || c === '\r') {
      const s = i;
      if (c === '\r' && src[i + 1] === '\n') i++;
      i++;
      if (bracketDepth === 0) {
        push('NEWLINE', '\n', s, i);
        atLineStart = true;
      }
      line++;
      lineStart = i;
      continue;
    }

    if (c === ' ' || c === '\t') { i++; continue; }

    // --- comment --------------------------------------------------------
    if (c === '#') {
      const s = i;
      while (i < src.length && src[i] !== '\n') i++;
      if (keepTrivia) push('COMMENT', src.slice(s, i), s, i);
      continue;
    }

    // --- number ---------------------------------------------------------
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      const s = i;
      while (i < src.length && isDigit(src[i])) i++;
      if (src[i] === '.' && isDigit(src[i + 1])) {
        i++;
        while (i < src.length && isDigit(src[i])) i++;
      }
      push('NUMBER', parseFloat(src.slice(s, i)), s, i);
      continue;
    }

    // --- string ---------------------------------------------------------
    if (c === '"' || c === "'") {
      const s = i;
      const quote = c;
      i++;
      let value = '';
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\n') {
          throw syntaxError('This text is missing its closing quote.', line, s - lineStart + 1);
        }
        if (src[i] === '\\' && i + 1 < src.length) {
          const esc = src[i + 1];
          value += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
          i += 2;
        } else {
          value += src[i];
          i++;
        }
      }
      if (i >= src.length) {
        throw syntaxError('This text is missing its closing quote.', line, s - lineStart + 1);
      }
      i++;
      push('STRING', value, s, i);
      continue;
    }

    // --- name / keyword -------------------------------------------------
    if (isNameStart(c)) {
      const s = i;
      while (i < src.length && isNameChar(src[i])) i++;
      const word = src.slice(s, i);
      push(KEYWORDS.has(word) ? 'KEYWORD' : 'NAME', word, s, i);
      continue;
    }

    // --- operator -------------------------------------------------------
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      if (op === '(' || op === '[' || op === '{') bracketDepth++;
      if (op === ')' || op === ']' || op === '}') bracketDepth = Math.max(0, bracketDepth - 1);
      push('OP', op, i, i + op.length);
      i += op.length;
      continue;
    }

    throw syntaxError(`I don't know what to do with the character "${c}".`, line, i - lineStart + 1);
  }

  if (tokens.length && tokens[tokens.length - 1].type !== 'NEWLINE') {
    push('NEWLINE', '\n', src.length, src.length);
  }
  while (indents.length > 1) {
    indents.pop();
    push('DEDENT', 0, src.length, src.length);
  }
  push('EOF', null, src.length, src.length);
  return tokens;
}
