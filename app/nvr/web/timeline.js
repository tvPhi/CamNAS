// Dòng thời gian 24 giờ: mỗi camera một hàng, kéo để di chuyển, cuộn chuột để phóng to.
import { h, fmtTime } from './util.js';

const RULER = 28;
const ROW = 30;
const DAY = 86400;
const MIN_SPAN = 120;
// [bước có nhãn, bước vạch phụ] tính bằng giây
const STEPS = [[60, 10], [300, 60], [600, 120], [900, 300], [1800, 300], [3600, 900], [7200, 1800], [10800, 3600], [21600, 3600]];
const C = {
  bg: '#12151b',
  row: '#171b22',
  rowAlt: '#151920',
  rowSel: '#1d2633',
  grid: 'rgba(255,255,255,0.06)',
  tick: '#4b5568',
  text: '#8b93a7',
  label: '#c9cfdb',
  labelSel: '#ffffff',
  ok: '#2f7cf6',
  okDim: '#2a5bab',
  rec: '#ef4444',
  bad: '#5b6270',
  future: 'rgba(0,0,0,0.35)',
  range: 'rgba(250,204,21,0.18)',
  rangeEdge: '#facc15',
  playhead: '#f43f5e',
  hover: 'rgba(255,255,255,0.35)',
};

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

export class Timeline {
  constructor(container, { onSeek }) {
    this.onSeek = onSeek;
    this.canvas = h('canvas.timeline-canvas');
    container.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.cameras = [];
    this.segments = {};
    this.dayStart = 0;
    this.now = 0;
    this.selected = null;
    this.playhead = null;
    this.range = null;
    this.hover = null;
    this.viewStart = 0;
    this.span = DAY;
    this.width = 0;
    this.height = 0;
    this.followPausedUntil = 0;
    this._frame = 0;

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas);
    this._bindPointer();
  }

  destroy() {
    this.ro.disconnect();
    cancelAnimationFrame(this._frame);
  }

  get labelW() {
    return this.width < 600 ? 72 : 130;
  }

  setData(dayStart, cameras, segments, now) {
    if (dayStart !== this.dayStart) {
      this.dayStart = dayStart;
      this.viewStart = dayStart;
      this.span = DAY;
    }
    this.cameras = cameras;
    this.segments = segments;
    this.now = now;
    this.resize();
  }

  setSelected(id) { this.selected = id; this.draw(); }
  setRange(range) { this.range = range; this.draw(); }

  setPlayhead(ts) {
    this.playhead = ts;
    if (ts !== null && Date.now() > this.followPausedUntil && this.span < DAY) {
      const margin = this.span * 0.05;
      if (ts < this.viewStart + margin || ts > this.viewStart + this.span - margin) {
        this.viewStart = ts - this.span * 0.15;
        this._clamp();
      }
    }
    this.draw();
  }

  setSpan(span) {
    const center = this.playhead ?? this.viewStart + this.span / 2;
    this.span = clamp(span, MIN_SPAN, DAY);
    this.viewStart = center - this.span / 2;
    this._clamp();
    this.draw();
  }

  zoom(factor, centerTs) {
    const c = centerTs ?? this.playhead ?? this.viewStart + this.span / 2;
    const rel = (c - this.viewStart) / this.span;
    this.span = clamp(this.span * factor, MIN_SPAN, DAY);
    this.viewStart = c - rel * this.span;
    this._clamp();
    this.draw();
  }

  _clamp() {
    this.viewStart = clamp(this.viewStart, this.dayStart, this.dayStart + DAY - this.span);
  }

  resize() {
    const rows = Math.max(1, this.cameras.length);
    const cssH = RULER + rows * ROW + 6;
    this.canvas.style.height = `${cssH}px`;
    const w = this.canvas.clientWidth;
    if (!w) return;
    const dpr = window.devicePixelRatio || 1;
    this.width = w;
    this.height = cssH;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._draw();
  }

  tsToX(ts) {
    return this.labelW + (ts - this.viewStart) / this.span * (this.width - this.labelW);
  }

  xToTs(x) {
    return this.viewStart + (x - this.labelW) / (this.width - this.labelW) * this.span;
  }

  rowAt(y) {
    const i = Math.floor((y - RULER) / ROW);
    return y >= RULER && i >= 0 && i < this.cameras.length ? this.cameras[i] : null;
  }

  draw() {
    cancelAnimationFrame(this._frame);
    this._frame = requestAnimationFrame(() => this._draw());
  }

  _draw() {
    const { ctx, width: W, height: H } = this;
    if (!W) return;
    const L = this.labelW;
    const viewEnd = this.viewStart + this.span;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    // các hàng camera
    this.cameras.forEach((cam, i) => {
      const y = RULER + i * ROW;
      const sel = cam.id === this.selected;
      ctx.fillStyle = sel ? C.rowSel : i % 2 ? C.rowAlt : C.row;
      ctx.fillRect(0, y, W, ROW - 1);
      if (sel) {
        ctx.fillStyle = C.ok;
        ctx.fillRect(0, y, 3, ROW - 1);
      }
      ctx.font = `${sel ? 600 : 400} 12px system-ui, sans-serif`;
      ctx.fillStyle = sel ? C.labelSel : C.label;
      ctx.textBaseline = 'middle';
      ctx.fillText(this._fit(cam.name, L - 16), 10, y + ROW / 2);
    });

    // vạch chia giờ
    const pxPerSec = (W - L) / this.span;
    const [step, minor] = STEPS.find(([s]) => s * pxPerSec >= 70) || STEPS[STEPS.length - 1];
    const first = this.dayStart + Math.ceil((this.viewStart - this.dayStart) / minor) * minor;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    for (let t = first; t <= viewEnd; t += minor) {
      const x = Math.round(this.tsToX(t)) + 0.5;
      const major = Math.round(t - this.dayStart) % step === 0;
      ctx.strokeStyle = major ? C.tick : C.grid;
      ctx.beginPath();
      ctx.moveTo(x, major ? RULER - 10 : RULER - 5);
      ctx.lineTo(x, RULER);
      ctx.stroke();
      if (major) {
        ctx.strokeStyle = C.grid;
        ctx.beginPath();
        ctx.moveTo(x, RULER);
        ctx.lineTo(x, H);
        ctx.stroke();
        ctx.fillStyle = C.text;
        const label = t - this.dayStart >= DAY ? '24:00' : fmtTime(t, false);
        const tw = ctx.measureText(label).width;
        if (x - tw / 2 > L) ctx.fillText(label, x - tw / 2, RULER - 13);
      }
    }

    // các đoạn đã ghi
    ctx.save();
    ctx.beginPath();
    ctx.rect(L, 0, W - L, H);
    ctx.clip();
    this.cameras.forEach((cam, i) => {
      const y = RULER + i * ROW + 6;
      const sel = cam.id === this.selected;
      for (const s of this.segments[cam.id] || []) {
        if (s.e < this.viewStart || s.s > viewEnd) continue;
        const x1 = this.tsToX(s.s);
        const x2 = this.tsToX(s.e);
        ctx.fillStyle = s.st === 'ok' ? (sel ? C.ok : C.okDim) : s.st === 'rec' ? C.rec : C.bad;
        ctx.fillRect(x1, y, Math.max(1, x2 - x1), ROW - 13);
      }
    });

    // phần tương lai của hôm nay
    if (this.now < viewEnd && this.now > this.dayStart) {
      const x = Math.max(L, this.tsToX(this.now));
      ctx.fillStyle = C.future;
      ctx.fillRect(x, RULER, W - x, H - RULER);
    }

    // khoảng chọn để xuất clip
    if (this.range?.a != null && this.range?.b != null) {
      const x1 = this.tsToX(Math.min(this.range.a, this.range.b));
      const x2 = this.tsToX(Math.max(this.range.a, this.range.b));
      ctx.fillStyle = C.range;
      ctx.fillRect(x1, RULER, Math.max(2, x2 - x1), H - RULER);
      ctx.fillStyle = C.rangeEdge;
      ctx.fillRect(x1 - 1, RULER, 2, H - RULER);
      ctx.fillRect(x2 - 1, RULER, 2, H - RULER);
    } else if (this.range?.a != null) {
      ctx.fillStyle = C.rangeEdge;
      ctx.fillRect(this.tsToX(this.range.a) - 1, RULER, 2, H - RULER);
    }

    // con trỏ chuột
    if (this.hover !== null) {
      const x = Math.round(this.tsToX(this.hover)) + 0.5;
      ctx.strokeStyle = C.hover;
      ctx.beginPath();
      ctx.moveTo(x, RULER);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    // vị trí đang phát
    if (this.playhead !== null && this.playhead >= this.viewStart && this.playhead <= viewEnd) {
      const x = Math.round(this.tsToX(this.playhead));
      ctx.fillStyle = C.playhead;
      ctx.fillRect(x - 1, RULER - 4, 2, H - RULER + 4);
      ctx.beginPath();
      ctx.moveTo(x - 5, RULER - 9);
      ctx.lineTo(x + 5, RULER - 9);
      ctx.lineTo(x, RULER - 3);
      ctx.fill();
    }
    ctx.restore();

    // nhãn thời gian khi rê chuột
    if (this.hover !== null) {
      const label = fmtTime(this.hover);
      ctx.font = '600 11px system-ui, sans-serif';
      const tw = ctx.measureText(label).width + 10;
      const x = clamp(this.tsToX(this.hover) - tw / 2, L, W - tw);
      ctx.fillStyle = '#e6e8ee';
      ctx.fillRect(x, 1, tw, 16);
      ctx.fillStyle = '#0d0f13';
      ctx.fillText(label, x + 5, 13);
    }

    // cột tên camera (vẽ đè lên vạch chia)
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, L, RULER);
  }

  _fit(text, max) {
    if (this.ctx.measureText(text).width <= max) return text;
    while (text.length > 1 && this.ctx.measureText(text + '…').width > max) text = text.slice(0, -1);
    return text + '…';
  }

  _bindPointer() {
    const c = this.canvas;
    let down = null;
    const pos = e => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    c.addEventListener('pointerdown', e => {
      const p = pos(e);
      down = { ...p, viewStart: this.viewStart, dragging: false, id: e.pointerId };
    });
    c.addEventListener('pointermove', e => {
      const p = pos(e);
      if (down) {
        if (!down.dragging && Math.abs(p.x - down.x) > 5) {
          down.dragging = true;
          c.setPointerCapture(down.id);
        }
        if (down.dragging) {
          this.viewStart = down.viewStart - (p.x - down.x) * this.span / (this.width - this.labelW);
          this._clamp();
          this.followPausedUntil = Date.now() + 8000;
        }
      }
      this.hover = p.x > this.labelW && e.pointerType === 'mouse' ? this.xToTs(p.x) : null;
      this.draw();
    });
    c.addEventListener('pointerup', e => {
      const p = pos(e);
      if (down && !down.dragging) {
        const cam = this.rowAt(p.y);
        if (p.x < this.labelW) {
          if (cam) this.onSeek(cam.id, null);
        } else {
          this.onSeek(cam?.id ?? null, this.xToTs(p.x));
        }
      }
      down = null;
    });
    c.addEventListener('pointercancel', () => { down = null; });
    c.addEventListener('pointerleave', () => {
      this.hover = null;
      this.draw();
    });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const p = pos(e);
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        this.viewStart += (e.deltaX || e.deltaY) * this.span / 1000;
        this._clamp();
        this.draw();
      } else {
        this.zoom(e.deltaY > 0 ? 1.25 : 0.8, p.x > this.labelW ? this.xToTs(p.x) : undefined);
      }
      this.followPausedUntil = Date.now() + 8000;
    }, { passive: false });
  }
}
