// Trang nhật ký: mất kết nối, bắt đầu ghi, xoá bản ghi cũ, đăng nhập sai...
import { api, h, icon, fmtTime, fmtDate } from './util.js';
import { store } from './store.js';
import { t } from './i18n.js';

const LEVELS = [['', t('Tất cả')], ['error', t('Lỗi')], ['warn', t('Cảnh báo')], ['info', t('Thông tin')]];

export function LogsPage(main) {
  const camSel = h('select', { onchange: load }, h('option', { value: '' }, t('Tất cả camera')));
  const levelSel = h('select', { onchange: load }, LEVELS.map(([v, l]) => h('option', { value: v }, l)));
  const list = h('div.log-list');
  main.append(
    h('div.page-head', h('div', h('h1', t('Nhật ký')), h('p.muted', t('Các sự kiện ghi hình và hệ thống, mới nhất ở trên.'))),
      h('div.filters', camSel, levelSel)),
    list);

  const unsub = store.subscribe(cams => {
    const cur = camSel.value;
    camSel.replaceChildren(h('option', { value: '' }, t('Tất cả camera')), ...cams.map(c => h('option', { value: c.id }, c.name)));
    camSel.value = cur;
  });

  async function load() {
    const q = new URLSearchParams({ limit: 500 });
    if (camSel.value) q.set('camera', camSel.value);
    if (levelSel.value) q.set('level', levelSel.value);
    let items;
    try {
      items = await api(`/api/events?${q}`);
    } catch {
      return;
    }
    if (!items.length) {
      list.replaceChildren(h('div.empty', icon('list', 36), h('p', t('Chưa có sự kiện nào'))));
      return;
    }
    let lastDate = '';
    const rows = [];
    for (const e of items) {
      const d = fmtDate(e.ts);
      if (d !== lastDate) {
        rows.push(h('div.log-date', d));
        lastDate = d;
      }
      const cam = e.camera ? store.camera(e.camera)?.name || e.camera : t('Hệ thống');
      rows.push(h(`div.log-row.l-${e.level}`,
        h('span.log-time', fmtTime(e.ts)),
        h('span.log-level', icon(e.level === 'info' ? 'info' : 'alert', 16)),
        h('span.log-cam', cam),
        h('span.log-msg', e.message)));
    }
    list.replaceChildren(...rows);
  }

  load();
  const timer = setInterval(() => !document.hidden && load(), 10000);
  return {
    unmount() {
      unsub();
      clearInterval(timer);
    },
  };
}
