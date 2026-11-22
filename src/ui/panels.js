import { TECH_TREE, TECH_BY_ID, RESOURCES } from '../game/techtree.js';
import { MANUAL } from '../docs/api.js';
import { CORAL, SHELL } from '../game/world.js';

// Everything that is DOM rather than canvas: the ledger, the instrument
// readouts, the objective card, the Lab and the Manual.

const RES_BY_ID = new Map(RESOURCES.map((r) => [r.id, r]));
const fmt = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(Math.floor(n)));
const escHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function renderLedger(el, session) {
  const next = session.nextUnlock();
  const needed = new Set(next ? Object.keys(next.cost) : []);
  const rows = RESOURCES.filter((r) => session.earned[r.id] > 0 || session.resources[r.id] > 0 || needed.has(r.id));
  if (!rows.length) rows.push(RES_BY_ID.get('kelp'));

  el.innerHTML = rows.map((r) => `
    <div class="chip" style="--tint:${r.color}">
      <span class="dot"></span>
      <span class="n">${fmt(session.resources[r.id])}</span>
      <span class="k">${r.name}</span>
    </div>`).join('');
}

export function renderReadouts(el, session) {
  const w = session.world;
  const d = w.drones[0];
  const cards = [];

  cards.push(`<div class="rd"><span class="k">Ticks</span><span class="v">${fmt(session.ticks)}</span></div>`);
  cards.push(`<div class="rd"><span class="k">Drone</span><span class="v">${d.x}, ${d.y}${
    w.drones.length > 1 ? ' <small>+1</small>' : ''}</span></div>`);

  const rate = throughput(session);
  cards.push(`<div class="rd"><span class="k">Yield / 1k</span><span class="v">${
    rate ? `${fmt(rate.n)} <small>${rate.name}</small>` : '<small>idle</small>'}</span></div>`);

  if (w.bleachEnabled) {
    const h = Math.round(w.health * 100);
    const cls = h < 45 ? ' is-bad' : h < 80 ? ' is-warn' : '';
    cards.push(`<div class="rd${cls}" style="--tint:${h < 45 ? 'var(--bad)' : h < 80 ? 'var(--warn)' : 'var(--good)'}">
      <span class="k">Reef health</span><span class="v">${h}%</span>
      <span class="bar"><i style="width:${h}%"></i></span></div>`);
  }

  // Puzzle-specific gauges, so the player can see how close they are instead of
  // guessing - and knows not to harvest a coral reef one polyp short of a bloom.
  const coral = w.tiles.filter((t) => t.entity === CORAL).length;
  if (coral > 0) {
    const ready = w.tiles.filter((t) => t.entity === CORAL && w.isMature(t) && t.bleach === 0).length;
    const total = w.tiles.length;
    cards.push(`<div class="rd" style="--tint:var(--coral)">
      <span class="k">Bloom</span><span class="v">${ready} <small>/ ${total}</small></span>
      <span class="bar"><i style="width:${(ready / total) * 100}%"></i></span></div>`);
  }

  const shells = w.tiles.filter((t) => t.entity === SHELL).length;
  if (shells > 0) {
    const seq = [...w.snakeOrder()];
    let inOrder = 0;
    for (let i = 1; i < seq.length; i++) {
      if (seq[i].entity === SHELL && seq[i - 1].entity === SHELL && seq[i].value >= seq[i - 1].value) inOrder++;
    }
    const pairs = seq.length - 1;
    const done = w.isSorted();
    cards.push(`<div class="rd" style="--tint:var(--nacre)">
      <span class="k">Sort order</span><span class="v">${done ? 'SORTED' : `${inOrder} <small>/ ${pairs}</small>`}</span>
      <span class="bar"><i style="width:${(inOrder / pairs) * 100}%"></i></span></div>`);
  }

  el.innerHTML = cards.join('');
}

/** Best-earning resource over the recent history window. */
function throughput(session) {
  const h = session.history;
  if (h.length < 2) return null;
  const a = h[Math.max(0, h.length - 21)];
  const b = h[h.length - 1];
  const span = b.tick - a.tick;
  if (span <= 0) return null;
  let best = null;
  for (const r of RESOURCES) {
    const n = ((b[r.id] - a[r.id]) / span) * 1000;
    if (n > 0 && (!best || n > best.n)) best = { n, name: r.name };
  }
  return best;
}

export function renderObjective(el, session) {
  const next = session.nextUnlock();
  if (!next) {
    el.innerHTML = `<div class="goal">
      <p class="eyebrow">Survey complete</p>
      <p class="what">Every unlock is yours. The reef is only as good as your code now.</p>
    </div>`;
    return;
  }
  const costs = Object.entries(next.cost).map(([res, n]) => {
    const have = session.resources[res];
    const met = have >= n;
    return `<span class="cost${met ? ' is-met' : ''}"><b>${fmt(have)}</b> / ${fmt(n)} ${RES_BY_ID.get(res).name}</span>`;
  }).join('');
  el.innerHTML = `<div class="goal">
    <p class="eyebrow">Next in the Lab &middot; ${session.unlocked.size} of ${TECH_TREE.length}</p>
    <p class="what">${escHtml(next.name)}</p>
    <div class="costs">${costs}</div>
  </div>`;
}

export function renderLab(el, session, actions) {
  const nextId = session.nextUnlock()?.id;
  const owned = session.unlocked;
  el.innerHTML = TECH_TREE.map((tech, i) => {
    const has = owned.has(tech.id);
    const isNext = tech.id === nextId;
    const far = !has && !isNext;
    const price = Object.entries(tech.cost).map(([res, n]) => {
      const ok = session.resources[res] >= n;
      return `<span class="${ok ? 'ok' : ''}"><i>${fmt(n)}</i> ${RES_BY_ID.get(res).name}</span>`;
    }).join('');
    const can = session.canAfford(tech.id) && isNext;
    return `<article class="tech ${has ? 'is-owned' : ''} ${isNext ? 'is-next' : ''} ${far ? 'is-far' : ''}">
      <div class="tech-head">
        <span class="step">${String(i + 1).padStart(2, '0')}</span>
        <h3>${escHtml(tech.name)}</h3>
        <span class="spacer"></span>
        ${has ? '<span class="owned">Installed</span>' : ''}
      </div>
      <p class="blurb">${escHtml(tech.blurb)}</p>
      <div class="grants">${tech.grants.map((g) => `<code>${escHtml(g)}</code>`).join('')}</div>
      ${has ? '' : `<div class="tech-buy">
        <div class="price">${price}</div>
        <button class="btn ${can ? 'btn-run' : ''}" data-buy="${tech.id}" ${can ? '' : 'disabled'} type="button">
          ${isNext ? 'Install' : 'Locked'}
        </button>
      </div>`}
      ${tech.example ? `<pre class="eg">${escHtml(tech.example)}</pre>
        ${has ? `<button class="btn btn-slim" data-load="${tech.id}" type="button">Load into editor</button>` : ''}` : ''}
    </article>`;
  }).join('') + `<section class="savebar">
    <h3>Save file</h3>
    <p>Progress is kept in this browser. Export it to back it up or move it to another device.</p>
    <div class="row">
      <button class="btn" data-act="export" type="button">Export</button>
      <button class="btn" data-act="import" type="button">Import</button>
      <button class="btn" data-act="reset" type="button">Reset progress</button>
    </div>
    <p class="save-msg" id="save-msg" role="status"></p>
  </section>`;

  el.querySelectorAll('[data-buy]').forEach((btn) => {
    btn.addEventListener('click', () => actions.buy(btn.dataset.buy));
  });
  el.querySelectorAll('[data-load]').forEach((btn) => {
    btn.addEventListener('click', () => actions.load(TECH_BY_ID.get(btn.dataset.load).example, btn));
  });
  el.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => actions[btn.dataset.act](btn));
  });
}

export function renderManual(el, session) {
  el.innerHTML = MANUAL.map((sec) => {
    const locked = sec.id && !session.unlocked.has(sec.id);
    return `<section class="man-sec ${locked ? 'is-locked' : ''}">
      <h3>${escHtml(sec.title)}${locked ? ' &middot; locked' : ''}</h3>
      ${sec.lede ? `<p class="lede">${sec.lede}</p>` : ''}
      ${sec.entries.map((e) => `<div class="entry">
        <div class="sig">${e.sig}${
          e.cost === 'tick' ? '<span class="tick">1 tick</span>' : e.cost === undefined && /\(\)/.test(e.sig) ? '<span class="free">free</span>' : ''
        }</div>
        <p>${e.text}</p>
      </div>`).join('')}
    </section>`;
  }).join('');
}

export function renderConsole(el, session) {
  if (!session.output.length) {
    el.innerHTML = '<div class="empty">Nothing yet. print() writes here.</div>';
    return;
  }
  el.innerHTML = session.output.map((o) => `<div class="row ${o.kind}">
      <span class="t">${String(o.tick).padStart(5, ' ')}</span>
      <span class="msg">${escHtml(o.text)}</span>
    </div>`).join('');
  el.scrollTop = el.scrollHeight;
}

export function renderDepthScale(el) {
  const marks = [];
  for (let i = 0; i <= 20; i++) {
    const maj = i % 5 === 0;
    marks.push(`<i class="${maj ? 'maj' : ''}" style="top:${(i / 20) * 100}%">${
      maj ? `<span>${12 + i * 2}m</span>` : ''}</i>`);
  }
  el.innerHTML = marks.join('');
}
