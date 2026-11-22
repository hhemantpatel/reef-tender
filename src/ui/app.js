import { Session } from '../game/session.js';
import { TECH_BY_ID } from '../game/techtree.js';
import { makeCoreBuiltins, CORE_LOCKED_NAMES } from '../lang/builtins.js';
import { createGameBuiltins } from '../game/api.js';
import { GAME_LOCKED_NAMES } from '../game/techtree.js';
import { Editor } from './editor.js';
import { ReefRenderer } from './render.js';
import { Reef3DRenderer } from './reef3d.js';
import {
  renderLedger, renderReadouts, renderObjective, renderLab,
  renderManual, renderConsole, renderDepthScale,
} from './panels.js';

const SAVE_KEY = 'reef-tender/save-v1';

const SPEEDS = [
  { label: '1x', tps: 4 },
  { label: '4x', tps: 16 },
  { label: '20x', tps: 80 },
  { label: 'MAX', tps: Infinity },
];

const STARTER_SCRIPT = `# Your drone is parked on the reef.
# No loops yet - just a few lines and
# whatever you can reach from here.
#
# Press Run, then buy Loops in the Lab.

harvest()
move(EAST)
harvest()
move(EAST)
harvest()
`;

const $ = (id) => document.getElementById(id);

const MAX_SCRIPT_CHARS = 100000;
const SAVE_FILE_NAME = 'reef-tender-save.json';

/** First click arms the button, a second click within 4s runs it. */
function confirmTwice(btn, armedLabel, run) {
  if (btn.dataset.armed) { run(); return; }
  const label = btn.textContent;
  btn.dataset.armed = '1';
  btn.textContent = armedLabel;
  setTimeout(() => {
    if (!btn.isConnected) return;
    delete btn.dataset.armed;
    btn.textContent = label;
  }, 4000);
}

class App {
  constructor() {
    this.saved = this.loadSave();
    this.session = this.saved?.game ? Session.fromJSON(this.saved.game) : new Session();
    this.speed = this.saved?.speed ?? 1;
    this.dirty = false;
    this.lastOutputLen = -1;
    this.uiClock = 0;

    this.buildNameTables();

    this.editor = new Editor(
      { textarea: $('code'), hl: $('hl'), gutter: $('gutter'), markers: $('markers') },
      (name) => this.classify(name),
      () => this.toggleRun(),
    );
    this.editor.value = this.saved?.code ?? STARTER_SCRIPT;
    this.editor.onChange = () => {
      this.markDirty();
      clearTimeout(this.checkTimer);
      this.checkTimer = setTimeout(() => this.checkSyntax(), 400);
    };

    this.renderer = this.makeRenderer();

    this.wireControls();
    this.wireTabs();
    this.renderAll();
    this.checkSyntax();

    new ResizeObserver(() => this.renderer.resize()).observe($('reef').parentElement);

    if (!this.saved) $('intro').hidden = false;
    $('intro-go').addEventListener('click', () => {
      $('intro').hidden = true;
      this.editor.focus();
      this.markDirty();
    });

    addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });

    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** The 3D diorama when WebGL works; the flat 2D reef otherwise, so the game always runs. */
  makeRenderer() {
    try {
      const r = new Reef3DRenderer($('reef'), this.session);
      $('depth').hidden = true;
      $('reef').parentElement.classList.add('is-3d');
      return r;
    } catch (e) {
      console.warn('3D view unavailable, using the 2D reef:', e);
      const canvas = $('reef');
      const fresh = canvas.cloneNode(false); // a canvas that tried WebGL cannot give a 2D context
      canvas.replaceWith(fresh);
      renderDepthScale($('depth'));
      return new ReefRenderer(fresh, this.session);
    }
  }

  // --- names ------------------------------------------------------------

  buildNameTables() {
    const core = makeCoreBuiltins({ onPrint: () => {} });
    const game = createGameBuiltins(this.session);
    this.allNames = new Set([...core.keys(), ...game.keys()]);
    this.constNames = new Set([...game.keys()].filter((k) => k === k.toUpperCase()));
    this.lockedNames = new Map([...CORE_LOCKED_NAMES, ...GAME_LOCKED_NAMES]);
  }

  classify(name) {
    const gate = this.lockedNames.get(name);
    if (gate && !this.session.unlocked.has(gate)) return 'locked';
    if (this.constNames.has(name)) return 'const';
    if (this.allNames.has(name)) return 'fn';
    return null;
  }

  // --- controls ---------------------------------------------------------

  wireControls() {
    $('run').addEventListener('click', () => this.toggleRun());
    $('step').addEventListener('click', () => this.stepOnce());
    $('clear-console').addEventListener('click', () => {
      this.session.clearOutput();
      renderConsole($('console'), this.session);
    });
    $('import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) this.importSave(file);
    });

    $('speeds').innerHTML = SPEEDS.map((s, i) =>
      `<button type="button" data-speed="${i}" class="${i === this.speed ? 'is-on' : ''}">${s.label}</button>`).join('');
    $('speeds').addEventListener('click', (e) => {
      const b = e.target.closest('[data-speed]');
      if (!b) return;
      this.speed = Number(b.dataset.speed);
      [...$('speeds').children].forEach((c, i) => c.classList.toggle('is-on', i === this.speed));
      this.markDirty();
    });
  }

  wireTabs() {
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-on', t === tab));
        document.querySelectorAll('.panel').forEach((p) => {
          p.classList.toggle('is-on', p.dataset.panel === tab.dataset.tab);
        });
        if (tab.dataset.tab === 'lab') {
          $('lab-pip').hidden = true;
          renderLab($('lab'), this.session, this.labActions());
        }
        if (tab.dataset.tab === 'manual') renderManual($('manual'), this.session);
      });
    });
  }

  toggleRun() {
    const s = this.session;
    if (s.running) {
      s.stop();
      s.note('Stopped.', 'system');
    } else {
      s.error = null;
      this.editor.setError(0);
      s.start(this.editor.value);
      if (s.error) this.editor.setError(s.error.line);
    }
    this.syncRunButton();
    this.renderConsoleIfChanged(true);
  }

  stepOnce() {
    const s = this.session;
    if (!s.running) {
      s.error = null;
      this.editor.setError(0);
      if (!s.start(this.editor.value)) {
        this.editor.setError(s.error.line);
        this.syncRunButton();
        this.renderConsoleIfChanged(true);
        return;
      }
    }
    s.advance();
    if (s.error) this.editor.setError(s.error.line);
    this.editor.setMarker(s.currentLine);
    this.syncRunButton();
    this.renderAll();
  }

  syncRunButton() {
    const on = this.session.running;
    $('run').classList.toggle('is-running', on);
    $('run-label').textContent = on ? 'Stop' : 'Run';
  }

  buy(id) {
    if (!this.session.buy(id)) return;
    const tech = TECH_BY_ID.get(id);
    this.session.note(`Installed ${tech.name}: ${tech.grants.join(', ')}.`, 'win');
    this.afterUnlock();
  }

  afterUnlock() {
    this.renderer.bedSize = -1;
    this.renderer.resize();
    this.editor.render();
    this.checkSyntax();
    this.renderAll();
    renderLab($('lab'), this.session, this.labActions());
    renderManual($('manual'), this.session);
    this.markDirty();
  }

  checkSyntax() {
    const el = $('syntax');
    try {
      this.session.compile(this.editor.value);
      el.textContent = '';
      el.className = 'syntax';
      if (!this.session.error) this.editor.setError(0);
    } catch (e) {
      el.textContent = `Line ${e.line}: ${e.message}`;
      el.className = `syntax${e.kind === 'locked' ? ' is-locked' : ''}`;
      this.editor.setError(e.line);
    }
  }

  // --- lab actions ------------------------------------------------------

  labActions() {
    return {
      buy: (id) => this.buy(id),
      load: (code, btn) => this.loadExample(code, btn),
      export: () => this.exportSave(),
      import: () => $('import-file').click(),
      reset: (btn) => confirmTwice(btn, 'Click again to erase everything', () => this.resetProgress()),
    };
  }

  /** Replacing a script the player wrote needs a second click. */
  loadExample(code, btn) {
    const cur = this.editor.value.trim();
    const replace = () => {
      this.editor.value = `${code}\n`;
      this.markDirty();
      this.checkSyntax();
      document.querySelector('.tab[data-tab="script"]').click();
      this.editor.focus();
    };
    if (!cur || cur === STARTER_SCRIPT.trim() || btn.dataset.armed) replace();
    else confirmTwice(btn, 'Replace your script?', replace);
  }

  saveMessage(text, isError = false) {
    const el = $('save-msg');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-error', isError);
  }

  exportSave() {
    this.dirty = true;
    const blob = new Blob([JSON.stringify(this.snapshot(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = SAVE_FILE_NAME;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.saveMessage('Exported.');
  }

  /** Read the picked file, check it, store it, and reload so the app boots from it. */
  async importSave(file) {
    try {
      if (file.size > 2_000_000) throw new Error('Not a Reef Tender save: file is too large.');
      let data;
      try { data = JSON.parse(await file.text()); } catch { throw new Error('Not a Reef Tender save: not valid JSON.'); }
      const game = Session.validateSave(data?.game);
      const code = typeof data.code === 'string' && data.code.length <= MAX_SCRIPT_CHARS ? data.code : STARTER_SCRIPT;
      const speed = Number.isInteger(data.speed) && data.speed >= 0 && data.speed < SPEEDS.length ? data.speed : 1;
      localStorage.setItem(SAVE_KEY, JSON.stringify({ game, code, speed }));
    } catch (e) {
      this.saveMessage(e.message, true);
      return;
    }
    this.dirty = false; // otherwise pagehide would overwrite the import
    location.reload();
  }

  resetProgress() {
    this.dirty = false;
    try { localStorage.removeItem(SAVE_KEY); } catch { /* blocked storage: reload still gives a fresh game */ }
    location.reload();
  }

  // --- persistence ------------------------------------------------------

  loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null; // private windows and blocked storage both land here
    }
  }

  markDirty() { this.dirty = true; }

  snapshot() {
    return {
      game: this.session.toJSON(),
      code: this.editor.value,
      speed: this.speed,
    };
  }

  save() {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.snapshot()));
    } catch {
      // Storage can be full or blocked; the game keeps playing either way.
    }
  }

  // --- frame ------------------------------------------------------------

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const s = this.session;

    if (s.running) {
      const { tps } = SPEEDS[this.speed];
      if (tps === Infinity) {
        const t0 = performance.now();
        while (s.running && performance.now() - t0 < 8) s.runTicks(400, 60000);
      } else {
        this.acc = (this.acc || 0) + dt * tps;
        const n = Math.floor(this.acc);
        if (n > 0) { this.acc -= n; s.runTicks(n); }
      }
      this.editor.setMarker(s.currentLine);
      if (s.error) this.editor.setError(s.error.line);
      if (!s.running) this.syncRunButton();
      this.markDirty();
    } else if (this.editor.marker) {
      this.editor.setMarker(0);
    }

    this.drainEvents();
    this.renderer.draw(dt);

    this.uiClock += dt;
    if (this.uiClock > 0.12) {
      this.uiClock = 0;
      renderLedger($('ledger'), s);
      renderReadouts($('readouts'), s);
      renderObjective($('objective'), s);
      $('reef-size').textContent = `${s.world.size} \u00d7 ${s.world.size}`;
      this.renderConsoleIfChanged();
      const next = s.nextUnlock();
      if (next && s.canAfford(next.id) && !document.querySelector('.tab[data-tab="lab"]').classList.contains('is-on')) {
        $('lab-pip').hidden = false;
      }
    }

    this.saveClock = (this.saveClock || 0) + dt;
    if (this.saveClock > 4) { this.saveClock = 0; this.save(); }

    requestAnimationFrame((t) => this.frame(t));
  }

  drainEvents() {
    for (const ev of this.session.drainEvents()) {
      if (ev.name === 'bloom') this.session.note(`The reef bloomed. +${ev.payload} coral.`, 'win');
      if (ev.name === 'sorted') this.session.note(`Shells sorted. +${ev.payload} nacre.`, 'win');
    }
  }

  renderConsoleIfChanged(force) {
    if (!force && this.session.output.length === this.lastOutputLen) return;
    this.lastOutputLen = this.session.output.length;
    renderConsole($('console'), this.session);
  }

  renderAll() {
    const s = this.session;
    renderLedger($('ledger'), s);
    renderReadouts($('readouts'), s);
    renderObjective($('objective'), s);
    renderLab($('lab'), s, this.labActions());
    renderManual($('manual'), s);
    this.renderConsoleIfChanged(true);
    $('reef-size').textContent = `${s.world.size} \u00d7 ${s.world.size}`;
    this.syncRunButton();
  }
}

new App();
