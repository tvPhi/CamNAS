import { t } from './i18n.js';

// Phát nối tiếp các file mp4 đã ghi. Dùng 2 thẻ <video> luân phiên: trong khi phát
// đoạn hiện tại thì nạp sẵn đoạn sau, nên chuyển đoạn gần như không bị giật.

const once = (el, ev) => new Promise((resolve, reject) => {
  const ok = () => { el.removeEventListener('error', fail); resolve(); };
  const fail = () => { el.removeEventListener(ev, ok); reject(el.error); };
  el.addEventListener(ev, ok, { once: true });
  el.addEventListener('error', fail, { once: true });
});

export class SegmentPlayer {
  constructor(container, { onTime, onState, onEnd, onError }) {
    this.onTime = onTime;
    this.onState = onState;
    this.onEnd = onEnd;
    this.onError = onError;
    this.videos = [0, 1].map(() => {
      const v = document.createElement('video');
      v.playsInline = true;
      v.preload = 'auto';
      container.append(v);
      return v;
    });
    this.active = 0;
    this.camId = null;
    this.segs = [];
    this.idx = -1;
    this.preloaded = -1;
    this.rate = 1;
    this.muted = false;
    this.token = 0;

    for (const v of this.videos) {
      v.addEventListener('timeupdate', () => { if (v === this.cur) this._tick(); });
      v.addEventListener('ended', () => { if (v === this.cur) this._next(); });
      v.addEventListener('play', () => { if (v === this.cur) this.onState(true); });
      v.addEventListener('pause', () => { if (v === this.cur && !v.ended) this.onState(false); });
    }
    this._show();
  }

  get cur() { return this.videos[this.active]; }
  get other() { return this.videos[1 - this.active]; }
  get segment() { return this.segs[this.idx] || null; }
  get playing() { return !this.cur.paused && !this.cur.ended; }

  get time() {
    const s = this.segment;
    return s ? s.s + this.cur.currentTime : null;
  }

  _show() {
    this.videos.forEach((v, i) => v.classList.toggle('active', i === this.active));
  }

  _url(s) {
    return `/media/${this.camId}/${s.f}`;
  }

  setSegments(camId, segs) {
    this.camId = camId;
    this.segs = segs.filter(s => s.st !== 'bad');
    this.idx = -1;
    this.preloaded = -1;
    this.token++;
    for (const v of this.videos) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
    this.onState(false);
  }

  // Cập nhật danh sách đoạn (đoạn mới ghi xong) mà không làm gián đoạn đoạn đang phát
  updateSegments(segs) {
    const curFile = this.segment?.f;
    this.segs = segs.filter(s => s.st !== 'bad');
    if (curFile) this.idx = this.segs.findIndex(s => s.f === curFile);
    if (this.preloaded >= 0) this.preloaded = -1;
  }

  /** Trả về: 'ok' | 'jumped' (nhảy tới đoạn gần nhất) | 'latest' | 'recording' | 'none' */
  async seek(ts, play = true) {
    let result = 'ok';
    let idx = this.segs.findIndex(s => ts >= s.s && ts < s.e);
    if (idx < 0) {
      idx = this.segs.findIndex(s => s.s > ts);
      if (idx < 0) return 'none';
      ts = this.segs[idx].s;
      result = 'jumped';
    }
    if (this.segs[idx].st === 'rec') {
      // đoạn đang ghi dở chưa xem được: phát 1 phút cuối của đoạn đã ghi xong gần nhất
      let prev = idx - 1;
      while (prev >= 0 && this.segs[prev].st !== 'ok') prev--;
      if (prev < 0) return 'recording';
      idx = prev;
      ts = Math.max(this.segs[idx].s, this.segs[idx].e - 60);
      result = 'latest';
    }
    await this._load(idx, ts - this.segs[idx].s, play);
    return result;
  }

  async _load(idx, offset, play) {
    const token = ++this.token;
    const v = this.cur;
    if (idx === this.idx && v.currentSrc) {
      v.currentTime = offset;
      if (play) this._play(v);
      this.onTime(this.time);
      return;
    }
    this.idx = idx;
    this.preloaded = -1;
    this.other.pause();
    v.src = this._url(this.segs[idx]);
    try {
      await once(v, 'loadedmetadata');
    } catch {
      if (token === this.token) this.onError(t('Không phát được đoạn ghi này (trình duyệt không hỗ trợ định dạng, ví dụ H.265)'));
      return;
    }
    if (token !== this.token) return;
    v.currentTime = Math.max(0, Math.min(offset, (v.duration || offset + 1) - 0.3));
    v.playbackRate = this.rate;
    v.muted = this.muted;
    this.onTime(this.time);
    if (play) this._play(v);
  }

  _play(v) {
    v.play().catch(() => {
      // trình duyệt chặn tự phát có tiếng: phát không tiếng
      v.muted = true;
      v.play().catch(() => {});
    });
  }

  _tick() {
    this.onTime(this.time);
    const v = this.cur;
    const next = this.idx + 1;
    if (this.preloaded !== next && next < this.segs.length && this.segs[next].st === 'ok'
        && v.duration - v.currentTime < 20 * Math.max(1, this.rate)) {
      this.preloaded = next;
      const o = this.other;
      o.src = this._url(this.segs[next]);
      o.load();
    }
  }

  _next() {
    const next = this.idx + 1;
    if (next >= this.segs.length || this.segs[next].st !== 'ok') {
      this.onState(false);
      this.onEnd(next < this.segs.length && this.segs[next].st === 'rec' ? 'recording' : 'end');
      return;
    }
    if (this.preloaded === next && this.other.readyState >= 1) {
      const old = this.cur;
      this.active = 1 - this.active;
      this.idx = next;
      this.preloaded = -1;
      const v = this.cur;
      v.currentTime = 0;
      v.playbackRate = this.rate;
      v.muted = this.muted;
      this._show();
      this._play(v);
      old.pause();
    } else {
      this._load(next, 0, true);
    }
  }

  toggle() {
    if (!this.segment) return false;
    if (this.playing) this.cur.pause();
    else this._play(this.cur);
    return true;
  }

  pause() { this.cur.pause(); }

  step(seconds) {
    const t = this.time;
    if (t !== null) this.seek(t + seconds, this.playing);
  }

  prevSegment() {
    if (this.idx > 0) this._load(this.idx - 1, 0, true);
    else if (this.segment) this._load(this.idx, 0, true);
  }

  nextSegment() {
    if (this.idx >= 0 && this.idx + 1 < this.segs.length && this.segs[this.idx + 1].st === 'ok') this._load(this.idx + 1, 0, true);
  }

  setRate(rate) {
    this.rate = rate;
    for (const v of this.videos) v.playbackRate = rate;
  }

  setMuted(muted) {
    this.muted = muted;
    for (const v of this.videos) v.muted = muted;
  }

  snapshot() {
    const v = this.cur;
    if (!v.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  }

  stop() {
    this.token++;
    for (const v of this.videos) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
  }
}
