// Tiện ích dùng chung: gọi API, tạo DOM, icon, thông báo, hộp thoại, định dạng.
import { t, lang } from './i18n.js';

export class AuthError extends Error {}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'X-Lang': lang, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    window.dispatchEvent(new Event('camnas:logout'));
    throw new AuthError(t('Chưa đăng nhập'));
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    let msg = data?.error || data?.detail || t('Lỗi {code}', { code: res.status });
    if (Array.isArray(msg)) msg = msg.map(d => d.msg).join(', ');
    throw new Error(msg);
  }
  return data;
}

// h('div.card', {onclick}, child1, child2...)
export function h(tag, attrs, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  video: '<path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" fill="currentColor"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>',
  prev: '<path d="M19 20 9 12l10-8v16Z"/><path d="M5 19V5"/>',
  next: '<path d="m5 4 10 8-10 8V4Z"/><path d="M19 5v14"/>',
  back10: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><text x="12" y="15.5" font-size="8" text-anchor="middle" fill="currentColor" stroke="none" font-weight="700">10</text>',
  fwd10: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/><text x="12" y="15.5" font-size="8" text-anchor="middle" fill="currentColor" stroke="none" font-weight="700">10</text>',
  snapshot: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m23 9-6 6M17 9l6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  layout1: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
  layout4: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18M12 3v18"/>',
  layout9: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  layout3: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M14 3v18M14 12h7"/>',
  zoomin: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35M11 8v6M8 11h6"/>',
  zoomout: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35M8 11h6"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
  disk: '<path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M6 16h.01M10 16h.01"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  live: '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  refresh: '<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>',
  server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
  bracketL: '<path d="M9 4H6v16h3"/><path d="M14 12h6"/>',
  bracketR: '<path d="M15 4h3v16h-3"/><path d="M4 12h6"/>',
};

export function icon(name, size = 20) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span;
}

export function button(label, iconName, attrs = {}) {
  return h('button', { type: 'button', ...attrs, class: `btn ${attrs.class || ''}`.trim() },
    iconName && icon(iconName, 18), label && h('span', label));
}

export function iconButton(iconName, title, attrs = {}) {
  return h('button', { type: 'button', title, 'aria-label': title, ...attrs, class: `icon-btn ${attrs.class || ''}`.trim() }, icon(iconName, 20));
}

export function toast(message, type = 'info', ms = 3500) {
  const box = document.getElementById('toasts');
  const el = h(`div.toast.${type}`, icon(type === 'error' ? 'alert' : type === 'ok' ? 'check' : 'info', 18), h('span', message));
  box.append(el);
  setTimeout(() => el.classList.add('hide'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

export function modal(title, body, actions = []) {
  return new Promise(resolve => {
    const close = value => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = e => { if (e.key === 'Escape') close(null); };
    const footer = h('div.modal-actions', actions.map(a =>
      button(a.label, a.icon, {
        class: a.primary ? 'primary' : a.danger ? 'danger' : '',
        onclick: async () => {
          if (a.onClick) {
            const r = await a.onClick();
            if (r === false) return;
            close(r ?? a.value);
          } else close(a.value);
        },
      })));
    const overlay = h('div.modal-overlay', { onmousedown: e => { if (e.target === overlay) close(null); } },
      h('div.modal', { role: 'dialog', 'aria-modal': 'true' },
        h('div.modal-head', h('h2', title), iconButton('close', t('Đóng'), { onclick: () => close(null) })),
        h('div.modal-body', body),
        actions.length ? footer : null));
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    overlay.querySelector('input,select,textarea')?.focus();
  });
}

export function confirmBox(title, message, okLabel = t('Đồng ý'), danger = false) {
  return modal(title, h('p', message), [
    { label: t('Huỷ'), value: false },
    { label: okLabel, value: true, primary: !danger, danger },
  ]);
}

const pad = n => String(n).padStart(2, '0');

export function fmtTime(ts, withSeconds = true) {
  const d = new Date(ts * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}${withSeconds ? ':' + pad(d.getSeconds()) : ''}`;
}

export function fmtDate(ts) {
  return formatDay(new Date(ts * 1000));
}

function formatDay(d) {
  if (lang === 'en') return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function fmtDateTime(ts) {
  return `${fmtTime(ts)} ${fmtDate(ts)}`;
}

export function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dayLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86400000));
  const weekdays = lang === 'en' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const prefix = key === today ? t('Hôm nay') : key === yesterday ? t('Hôm qua') : weekdays[date.getDay()];
  return `${prefix}, ${formatDay(date)}`;
}

export function fmtBytes(n) {
  if (n === null || n === undefined) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400), hh = Math.floor(sec % 86400 / 3600), mm = Math.floor(sec % 3600 / 60);
  if (d) return t('{d} ngày {h} giờ', { d, h: hh });
  if (hh) return t('{h} giờ {m} phút', { h: hh, m: mm });
  if (mm) return t('{m} phút', { m: mm });
  return t('{s} giây', { s: sec });
}

export function saveFile(blobOrUrl, filename) {
  const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function safeName(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^\w-]+/g, '_');
}

export function stamp(ts) {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Lưu tuỳ chọn nhỏ của người xem (bố cục, tốc độ...) - không bắt buộc
export const prefs = {
  get(key, fallback) {
    try { const v = localStorage.getItem('camnas.' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('camnas.' + key, JSON.stringify(value)); } catch { /* bỏ qua */ }
  },
};

export const STATE_LABEL = {
  recording: t('Đang ghi'),
  connecting: t('Đang kết nối'),
  error: t('Lỗi'),
  off: t('Không ghi'),
  stopped: t('Đã dừng'),
};
