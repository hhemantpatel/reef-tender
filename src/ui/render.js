import { KELP, ANEMONE, CORAL, SHELL, EMPTY, SILT, ROCK } from '../game/world.js';

// Canvas renderer. The reef breathes whether or not a program is running:
// caustics wander over the seabed, kelp sways, marine snow drifts down. The
// static parts (ground texture) are baked once per resize so frames stay cheap.

const TOKENS = [
  'water-top', 'water-mid', 'water-deep', 'seabed', 'seabed-2', 'seabed-rock',
  'kelp', 'anemone', 'coral', 'pearl', 'nacre', 'bleach', 'lumen', 'caustic',
  'snow', 'ink', 'ink-3', 'surface',
];

/** Stable per-tile pseudo-random, so speckles don't crawl between frames. */
function hash(x, y, k = 0) {
  let h = x * 374761393 + y * 668265263 + k * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Seamless caustic tile: summed sine ridges, sharpened into bright filaments. */
function causticTile(n, rgb) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n;
      const v = y / n;
      const TAU = Math.PI * 2;
      let s = Math.sin(TAU * (3 * u + 2 * v))
        + Math.sin(TAU * (2 * u - 3 * v) + 1.7)
        + Math.sin(TAU * (5 * u + v) + 3.1)
        + Math.sin(TAU * (u - 4 * v) + 0.6);
      s /= 4;
      const a = Math.pow(Math.max(0, s), 3.4);
      const i = (y * n + x) * 4;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function parseRgb(color) {
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = '#000';
  c.fillStyle = color;
  const v = c.fillStyle;
  if (v.startsWith('#')) {
    const h = v.length === 4
      ? v.slice(1).split('').map((d) => parseInt(d + d, 16))
      : [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
    return h;
  }
  const m = v.match(/\d+/g) || [255, 255, 255];
  return m.slice(0, 3).map(Number);
}

export class ReefRenderer {
  constructor(canvas, session) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.session = session;
    this.colors = {};
    this.time = 0;
    this.snow = [];
    this.bed = null;
    this.bedSize = -1;
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.view = { x: 0, y: 0, size: 0, cell: 0 };
    this.dronePos = new Map();
    this.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.refreshTheme();
  }

  refreshTheme() {
    const cs = getComputedStyle(document.documentElement);
    for (const t of TOKENS) this.colors[t] = cs.getPropertyValue(`--${t}`).trim() || '#888';
    this.causticAlpha = parseFloat(cs.getPropertyValue('--caustic-alpha')) || 0.12;
    this.snowAlpha = parseFloat(cs.getPropertyValue('--snow-alpha')) || 0.3;
    this.caustic = causticTile(128, parseRgb(this.colors.caustic));
    this.bedSize = -1; // ground texture is theme-coloured, so rebake it
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const padL = 46;
    const pad = 16;
    const avail = Math.min(this.w - padL - pad, this.h - pad * 2);
    const size = Math.max(40, avail);
    this.view = {
      x: padL + (this.w - padL - pad - size) / 2,
      y: (this.h - size) / 2,
      size,
      cell: size / this.session.world.size,
    };
    this.bedSize = -1;

    if (!this.snow.length) {
      for (let i = 0; i < 46; i++) {
        this.snow.push({
          x: Math.random(), y: Math.random(),
          r: 0.4 + Math.random() * 1.3,
          v: 0.006 + Math.random() * 0.016,
          p: Math.random() * 7,
        });
      }
    }
  }

  // --- static seabed, baked once per size/theme ------------------------

  bakeBed() {
    const { size, cell } = this.view;
    const n = this.session.world.size;
    const c = document.createElement('canvas');
    c.width = Math.round(size * this.dpr);
    c.height = Math.round(size * this.dpr);
    const g = c.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    for (const tile of this.session.world.tiles) {
      const px = tile.x * cell;
      const py = (n - 1 - tile.y) * cell; // y counts north, the screen counts down

      g.fillStyle = tile.ground === ROCK ? this.colors['seabed-rock']
        : tile.ground === SILT ? this.colors['seabed-2']
        : this.colors.seabed;
      g.fillRect(px, py, cell + 0.5, cell + 0.5);

      g.save();
      g.beginPath();
      g.rect(px, py, cell, cell);
      g.clip();

      if (tile.ground === ROCK) {
        // Angular facets: rock reads as broken, not speckled.
        g.fillStyle = '#00000024';
        for (let i = 0; i < 3; i++) {
          const a = hash(tile.x, tile.y, i * 3) * Math.PI * 2;
          const cx = px + cell * (0.25 + hash(tile.x, tile.y, i) * 0.5);
          const cy = py + cell * (0.25 + hash(tile.x, tile.y, i + 9) * 0.5);
          const r = cell * (0.12 + hash(tile.x, tile.y, i + 5) * 0.16);
          g.beginPath();
          for (let k = 0; k < 5; k++) {
            const ang = a + (k / 5) * Math.PI * 2;
            const rr = r * (0.7 + hash(tile.x, tile.y, i * 7 + k) * 0.6);
            g[k ? 'lineTo' : 'moveTo'](cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
          }
          g.closePath();
          g.fill();
        }
      } else if (tile.ground === SILT) {
        // Bathymetric hairlines - the chart device, and it marks the rich ground.
        g.strokeStyle = '#ffffff1f';
        g.lineWidth = 0.9;
        for (let i = 0; i < 3; i++) {
          const yy = py + cell * (0.22 + i * 0.28);
          g.beginPath();
          for (let k = 0; k <= 10; k++) {
            const xx = px + (k / 10) * cell;
            const wob = Math.sin(k * 0.9 + i * 2.1 + tile.x) * cell * 0.035;
            g[k ? 'lineTo' : 'moveTo'](xx, yy + wob);
          }
          g.stroke();
        }
      } else {
        g.fillStyle = '#00000018';
        for (let i = 0; i < 9; i++) {
          const dx = hash(tile.x, tile.y, i) * cell;
          const dy = hash(tile.x, tile.y, i + 40) * cell;
          g.beginPath();
          g.arc(px + dx, py + dy, cell * 0.012 + 0.4, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.restore();

      g.strokeStyle = '#00000022';
      g.lineWidth = 1;
      g.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
    }

    this.bed = c;
    this.bedSize = n;
  }

  // --- frame ------------------------------------------------------------

  draw(dt) {
    if (!this.w) this.resize();
    if (!this.w) return;
    if (!this.reduceMotion) this.time += dt;
    const { ctx } = this;
    const n = this.session.world.size;
    if (this.bedSize !== n || !this.bed) {
      this.view.cell = this.view.size / n;
      this.bakeBed();
    }

    this.drawWater();
    this.drawCaustics();

    const { x, y, size, cell } = this.view;
    ctx.save();
    ctx.translate(x, y);

    ctx.drawImage(this.bed, 0, 0, size, size);

    for (const tile of this.session.world.tiles) {
      this.drawEntity(tile, tile.x * cell, (n - 1 - tile.y) * cell, cell);
    }
    for (const tile of this.session.world.tiles) {
      if (tile.bleach > 0) this.drawBleach(tile, tile.x * cell, (n - 1 - tile.y) * cell, cell);
    }

    for (const drone of this.session.world.drones) this.drawDrone(drone, cell, n, dt);
    ctx.restore();

    this.drawSnow(dt);
    this.drawVignette();
  }

  drawWater() {
    const { ctx, w, h } = this;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, this.colors['water-top']);
    g.addColorStop(0.55, this.colors['water-mid']);
    g.addColorStop(1, this.colors['water-deep']);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  drawCaustics() {
    const { ctx, w, h } = this;
    const t = this.time;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [scale, speed, alpha] of [[1.9, 0.011, 1], [3.1, -0.017, 0.62]]) {
      const pat = ctx.createPattern(this.caustic, 'repeat');
      if (!pat) continue;
      ctx.globalAlpha = this.causticAlpha * alpha;
      ctx.save();
      ctx.scale(scale, scale);
      const ox = (t * speed * 60) % 128;
      const oy = (t * speed * 34) % 128;
      ctx.translate(ox, oy);
      ctx.fillStyle = pat;
      ctx.fillRect(-ox, -oy, w / scale + 128, h / scale + 128);
      ctx.restore();
    }
    ctx.restore();
  }

  drawSnow(dt) {
    const { ctx, w, h } = this;
    ctx.save();
    ctx.fillStyle = this.colors.snow;
    for (const p of this.snow) {
      if (!this.reduceMotion) {
        p.y += p.v * dt;
        if (p.y > 1.05) { p.y = -0.05; p.x = Math.random(); }
      }
      const wob = Math.sin(this.time * 0.7 + p.p) * 0.006;
      ctx.globalAlpha = this.snowAlpha * (0.35 + p.r * 0.4);
      ctx.beginPath();
      ctx.arc((p.x + wob) * w, p.y * h, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawVignette() {
    const { ctx, w, h } = this;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.max(w, h) * 0.78);
    g.addColorStop(0, '#00000000');
    g.addColorStop(1, '#00000059');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // --- entities ---------------------------------------------------------

  drawEntity(tile, px, py, cell) {
    if (tile.entity === EMPTY) return;
    const { ctx } = this;
    const world = this.session.world;
    const g = tile.entity === SHELL ? 1 : Math.min(1, tile.growth / world.maturityOf(tile));
    const mature = g >= 1;
    const sway = this.reduceMotion ? 0 : Math.sin(this.time * 1.15 + tile.x * 0.8 + tile.y * 0.4);
    const cx = px + cell / 2;
    const base = py + cell * 0.84;

    ctx.save();
    if (tile.bleach > 0) ctx.globalAlpha = 0.45;

    if (tile.entity === KELP) {
      const h = cell * (0.2 + 0.6 * g);
      ctx.strokeStyle = this.colors.kelp;
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const off = (i - 1.5) * cell * 0.115;
        const lean = sway * cell * 0.085 * (0.5 + i * 0.25);
        ctx.globalAlpha *= 1;
        ctx.lineWidth = Math.min(4.2, Math.max(1.4, cell * (mature ? 0.05 : 0.038)));
        ctx.beginPath();
        ctx.moveTo(cx + off, base);
        ctx.quadraticCurveTo(cx + off + lean * 0.5, base - h * 0.55, cx + off + lean, base - h * (0.8 + i * 0.07));
        ctx.stroke();
      }
      if (mature) {
        ctx.fillStyle = this.colors.kelp;
        ctx.globalAlpha *= 0.85;
        ctx.beginPath();
        ctx.arc(cx + sway * cell * 0.09, base - h * 0.95, cell * 0.045, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (tile.entity === ANEMONE) {
      const stung = tile.stung;
      const r = cell * (0.07 + 0.11 * g) * (stung ? 0.62 : 1);
      const col = stung ? this.colors.bleach : this.colors.anemone;
      const cy = py + cell * 0.58;
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, cell * 0.032);
      ctx.lineCap = 'round';
      const arms = 11;
      for (let i = 0; i < arms; i++) {
        const a = (i / arms) * Math.PI * 2;
        const wob = stung ? 0 : Math.sin(this.time * 2.1 + i * 0.9) * 0.16;
        const len = r * (1.75 + wob) * (stung ? 1 : 1 + 0.35 * g);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r * 0.65, cy + Math.sin(a) * r * 0.65);
        ctx.lineTo(cx + Math.cos(a + wob * 0.5) * len, cy + Math.sin(a + wob * 0.5) * len);
        ctx.stroke();
      }
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      if (mature && !stung) {
        ctx.globalAlpha *= 0.5;
        ctx.strokeStyle = this.colors.lumen;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 2.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (tile.entity === CORAL) {
      ctx.strokeStyle = this.colors.coral;
      ctx.lineCap = 'round';
      const h = cell * (0.16 + 0.46 * g);
      const branch = (x0, y0, ang, len, depth) => {
        const x1 = x0 + Math.cos(ang) * len;
        const y1 = y0 + Math.sin(ang) * len;
        ctx.lineWidth = Math.max(1, cell * 0.055 * (depth / 3));
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        if (depth > 1) {
          const spread = 0.52 + sway * 0.05;
          branch(x1, y1, ang - spread, len * 0.68, depth - 1);
          branch(x1, y1, ang + spread, len * 0.68, depth - 1);
        } else if (mature) {
          ctx.fillStyle = this.colors.coral;
          ctx.beginPath();
          ctx.arc(x1, y1, cell * 0.035, 0, Math.PI * 2);
          ctx.fill();
        }
      };
      branch(cx, base, -Math.PI / 2 + sway * 0.04, h * 0.5, 3);
    } else if (tile.entity === SHELL) {
      const max = world.tiles.length;
      const frac = Math.min(1, tile.value / max);
      const r = cell * (0.15 + 0.15 * frac);
      const cy = py + cell * 0.46;
      ctx.strokeStyle = this.colors.nacre;
      ctx.lineWidth = Math.max(1, cell * 0.03);
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) {
        const a = (i / 60) * Math.PI * 3.6;
        const rr = r * (i / 60);
        const xx = cx + Math.cos(a) * rr;
        const yy = cy + Math.sin(a) * rr;
        ctx[i ? 'lineTo' : 'moveTo'](xx, yy);
      }
      ctx.stroke();
      if (cell > 26) {
        ctx.fillStyle = this.colors.ink;
        ctx.globalAlpha *= 0.85;
        ctx.font = `500 ${Math.round(cell * 0.2)}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(String(tile.value), cx, py + cell * 0.92);
      }
    }
    ctx.restore();
  }

  drawBleach(tile, px, py, cell) {
    const { ctx } = this;
    const a = Math.min(1, tile.bleach);
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, cell, cell);
    ctx.clip();
    ctx.fillStyle = this.colors.bleach;
    ctx.globalAlpha = 0.2 + 0.42 * a;
    // A chalky, irregular bloom rather than a flat square.
    for (let i = 0; i < 5; i++) {
      const dx = px + cell * (0.2 + hash(tile.x, tile.y, i) * 0.6);
      const dy = py + cell * (0.2 + hash(tile.x, tile.y, i + 20) * 0.6);
      ctx.beginPath();
      ctx.arc(dx, dy, cell * (0.22 + hash(tile.x, tile.y, i + 60) * 0.2) * (0.5 + a * 0.7), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 0.5 * a;
    ctx.strokeStyle = this.colors.bleach;
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 1, py + 1, cell - 2, cell - 2);
    ctx.restore();
  }

  drawDrone(drone, cell, n, dt) {
    const { ctx } = this;
    const key = drone;
    let pos = this.dronePos.get(key);
    const tx = drone.x * cell + cell / 2;
    const ty = (n - 1 - drone.y) * cell + cell / 2;
    if (!pos) { pos = { x: tx, y: ty }; this.dronePos.set(key, pos); }

    // Ease toward the target, but snap when the move wrapped across the reef.
    const far = Math.hypot(tx - pos.x, ty - pos.y) > cell * 1.6;
    if (far || this.reduceMotion) { pos.x = tx; pos.y = ty; }
    else {
      const k = Math.min(1, dt * 14);
      pos.x += (tx - pos.x) * k;
      pos.y += (ty - pos.y) * k;
    }

    const r = Math.max(5, cell * 0.2);

    ctx.save();
    for (let i = 0; i < drone.trail.length; i++) {
      const t = drone.trail[i];
      const a = ((i + 1) / drone.trail.length) * 0.16;
      ctx.globalAlpha = a;
      ctx.fillStyle = this.colors.lumen;
      ctx.beginPath();
      ctx.arc(t.x * cell + cell / 2, (n - 1 - t.y) * cell + cell / 2, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    const glow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, r * 3.4);
    glow.addColorStop(0, this.colors.lumen);
    glow.addColorStop(1, 'transparent');
    ctx.globalAlpha = 0.24 + (this.reduceMotion ? 0 : Math.sin(this.time * 3) * 0.05);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r * 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.fillStyle = this.colors.surface;
    ctx.strokeStyle = this.colors.lumen;
    ctx.lineWidth = Math.max(1.2, r * 0.16);
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = this.colors.lumen;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    // Rotor fins
    ctx.globalAlpha = 0.75;
    ctx.fillRect(-r * 1.25, -r * 0.16, r * 0.34, r * 0.32);
    ctx.fillRect(r * 0.9, -r * 0.16, r * 0.34, r * 0.32);
    ctx.restore();
  }
}
