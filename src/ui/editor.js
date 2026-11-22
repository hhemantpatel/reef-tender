import { tokenize } from '../lang/lexer.js';

// A small code editor: a transparent <textarea> over a highlighted <pre>, which
// keeps native editing (selection, undo, IME, mobile keyboards) and still lets
// us paint syntax colours, a run marker and an error marker underneath.

const LINE_HEIGHT = 21;
const INDENT = '    ';

const escCode = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export class Editor {
  /**
   * @param {object} refs {root, textarea, hl, gutter, markers}
   * @param {(name: string) => 'fn'|'const'|'locked'|null} classify names the editor
   *   cannot know about on its own: which identifiers are builtins, and which of
   *   those the player has not unlocked yet.
   */
  constructor(refs, classify, onRun) {
    this.refs = refs;
    this.classify = classify;
    this.onRun = onRun;
    this.marker = null;
    this.errorLine = 0;
    this.onChange = () => {};

    const { textarea } = refs;
    textarea.addEventListener('input', () => { this.render(); this.onChange(); });
    textarea.addEventListener('scroll', () => this.syncScroll());
    textarea.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('resize', () => this.render());
  }

  get value() { return this.refs.textarea.value; }
  set value(v) { this.refs.textarea.value = v; this.render(); }

  focus() { this.refs.textarea.focus(); }

  onKeyDown(e) {
    const ta = this.refs.textarea;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.onRun();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) this.dedentSelection();
      else this.insert(INDENT);
      return;
    }
    if (e.key === 'Enter') {
      // Keep the current indentation, and step in one level after a ":".
      const before = ta.value.slice(0, ta.selectionStart);
      const line = before.slice(before.lastIndexOf('\n') + 1);
      const indent = (line.match(/^[ \t]*/) || [''])[0];
      const deeper = /:\s*$/.test(line) ? INDENT : '';
      e.preventDefault();
      this.insert('\n' + indent + deeper);
    }
  }

  insert(text) {
    const ta = this.refs.textarea;
    const { selectionStart: s, selectionEnd: e } = ta;
    ta.setRangeText(text, s, e, 'end');
    this.render();
    this.onChange();
  }

  dedentSelection() {
    const ta = this.refs.textarea;
    const start = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    const chunk = ta.value.slice(start, ta.selectionEnd);
    const dedented = chunk.replace(/^ {1,4}/gm, '');
    if (dedented === chunk) return;
    const caret = ta.selectionStart;
    ta.setRangeText(dedented, start, ta.selectionEnd, 'end');
    ta.selectionStart = ta.selectionEnd = Math.max(start, caret - (chunk.length - dedented.length));
    this.render();
    this.onChange();
  }

  setMarker(line) {
    if (this.marker === line) return;
    this.marker = line;
    this.paintMarkers();
  }

  setError(line) {
    this.errorLine = line || 0;
    this.paintMarkers();
  }

  syncScroll() {
    const ta = this.refs.textarea;
    this.refs.hl.scrollTop = ta.scrollTop;
    this.refs.hl.scrollLeft = ta.scrollLeft;
    this.refs.gutter.scrollTop = ta.scrollTop;
    this.paintMarkers();
  }

  paintMarkers() {
    const top = this.refs.textarea.scrollTop;
    const parts = [];
    if (this.marker > 0) {
      parts.push(`<div class="m here" style="top:${(this.marker - 1) * LINE_HEIGHT - top}px"></div>`);
    }
    if (this.errorLine > 0) {
      parts.push(`<div class="m bad" style="top:${(this.errorLine - 1) * LINE_HEIGHT - top}px"></div>`);
    }
    this.refs.markers.innerHTML = parts.join('');

    for (const [i, el] of [...this.refs.gutter.children].entries()) {
      el.classList.toggle('is-here', i + 1 === this.marker);
      el.classList.toggle('is-bad', i + 1 === this.errorLine);
    }
  }

  render() {
    const src = this.refs.textarea.value;
    const lines = src.split('\n').length;
    if (this.refs.gutter.children.length !== lines) {
      this.refs.gutter.innerHTML = Array.from({ length: lines }, (_, i) => `<div>${i + 1}</div>`).join('');
    }
    this.refs.hl.innerHTML = this.highlight(src);
    this.syncScroll();
  }

  highlight(src) {
    let tokens;
    try {
      tokens = tokenize(src, { keepTrivia: true });
    } catch {
      // Mid-keystroke the source is often not tokenizable (an open quote, say).
      // Plain text for a moment beats a flash of broken markup.
      return escCode(src) + '\n';
    }
    let out = '';
    let last = 0;
    for (const tok of tokens) {
      if (tok.type === 'NEWLINE' || tok.type === 'INDENT' || tok.type === 'DEDENT' || tok.type === 'EOF') continue;
      if (tok.start < last) continue;
      out += escCode(src.slice(last, tok.start));
      const cls = this.classOf(tok);
      const text = escCode(src.slice(tok.start, tok.end));
      out += cls ? `<span class="${cls}">${text}</span>` : text;
      last = tok.end;
    }
    out += escCode(src.slice(last));
    return out + '\n';
  }

  classOf(tok) {
    switch (tok.type) {
      case 'COMMENT': return 't-com';
      case 'STRING': return 't-str';
      case 'NUMBER': return 't-num';
      case 'KEYWORD': return 't-key';
      case 'OP': return 't-op';
      case 'NAME': {
        const kind = this.classify(tok.value);
        return kind === 'locked' ? 't-locked' : kind === 'const' ? 't-const' : kind === 'fn' ? 't-fn' : null;
      }
      default: return null;
    }
  }
}
