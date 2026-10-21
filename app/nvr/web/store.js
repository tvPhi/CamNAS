// Danh sách camera + trạng thái ghi, tự làm mới mỗi 5 giây cho mọi trang.
import { api } from './util.js';

export const store = {
  cameras: [],
  loaded: false,
  listeners: new Set(),
  timer: null,

  async refresh() {
    try {
      this.cameras = await api('/api/cameras');
      this.loaded = true;
      for (const fn of this.listeners) fn(this.cameras);
    } catch { /* lỗi mạng tạm thời: lần sau thử lại */ }
  },

  subscribe(fn) {
    this.listeners.add(fn);
    if (this.loaded) fn(this.cameras);
    return () => this.listeners.delete(fn);
  },

  start() {
    this.stop();
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 5000);
  },

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  },

  camera(id) {
    return this.cameras.find(c => c.id === id);
  },
};
