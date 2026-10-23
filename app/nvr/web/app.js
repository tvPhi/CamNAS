import { api, h, icon, iconButton, toast, prefs, logo, langSwitch } from './util.js';
import { t, lang } from './i18n.js';
import { store } from './store.js';
import { LivePage } from './live.js';
import { PlaybackPage } from './playback.js';
import { CamerasPage } from './cameras.js';
import { LogsPage } from './logs.js';
import { SettingsPage } from './settings.js';

const PAGES = [
  { id: 'live', label: t('Trực tiếp'), icon: 'grid', page: LivePage },
  { id: 'playback', label: t('Xem lại'), icon: 'history', page: PlaybackPage },
  { id: 'cameras', label: t('Camera'), icon: 'video', page: CamerasPage },
  { id: 'logs', label: t('Nhật ký'), icon: 'list', page: LogsPage },
  { id: 'settings', label: t('Cài đặt'), icon: 'sliders', page: SettingsPage },
];

const root = document.getElementById('app');
let current = null;
let shell = null;
let unsubStatus = null;

async function boot() {
  let me = {};
  try {
    me = await (await fetch('/api/me')).json();
  } catch { /* máy chủ chưa sẵn sàng */ }
  if (me.authenticated) showShell(me);
  else showLogin();
}

function showLogin() {
  store.stop();
  current?.unmount();
  current = null;
  shell = null;
  window.onhashchange = null;
  const input = h('input', { type: 'password', placeholder: t('Mật khẩu'), autocomplete: 'current-password', required: true });
  const err = h('div.form-error');
  const submit = h('button.btn.primary.block', { type: 'submit' }, t('Đăng nhập'));
  const form = h('form.login-card', {
    onsubmit: async e => {
      e.preventDefault();
      err.textContent = '';
      submit.disabled = true;
      try {
        const res = await fetch('/api/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lang': lang }, body: JSON.stringify({ password: input.value }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t('Đăng nhập thất bại'));
        boot();
      } catch (ex) {
        err.textContent = ex.message;
        input.select();
      } finally {
        submit.disabled = false;
      }
    },
  }, logo(), h('h1', 'CamNAS'), h('p.muted', t('Ghi hình camera trên NAS')), input, err, submit, langSwitch());
  root.replaceChildren(h('div.login-page', form));
  input.focus();
}

function showShell(me) {
  const navItems = PAGES.map(p => h('a.nav-item', { href: `#/${p.id}`, 'data-page': p.id, title: p.label }, icon(p.icon, 20), h('span', p.label)));
  const status = h('a.rec-status', { href: '#/cameras', title: t('Trạng thái ghi hình') });
  const main = h('main.main');
  root.replaceChildren(h('div.shell',
    h('header.topbar',
      h('a.brand', { href: '#/live' }, logo(), h('span', 'CamNAS')),
      h('nav.nav', navItems),
      h('div.top-right', status, langSwitch(), iconButton('logout', t('Đăng xuất'), { onclick: logout }))),
    main));
  shell = { main, navItems, status };

  unsubStatus?.();
  unsubStatus = store.subscribe(updateStatus);
  store.start();
  window.onhashchange = route;
  route();
  if (me.default_password) {
    toast(t('Bạn đang dùng mật khẩu mặc định "admin" - hãy đổi trong Cài đặt'), 'error', 8000);
  }
  // báo một lần cho mỗi phiên bản mới
  api('/api/updates').then(st => {
    if (st.update_available && prefs.get('update.seen', '') !== st.latest.tag) {
      prefs.set('update.seen', st.latest.tag);
      toast(t('Đã có CamNAS {version}, xem trong Cài đặt → Cập nhật', { version: st.latest.tag }), 'info', 8000);
    }
  }).catch(() => {});
}

function updateStatus(cams) {
  if (!shell) return;
  const recording = cams.filter(c => c.record);
  const ok = recording.filter(c => c.status.state === 'recording').length;
  const el = shell.status;
  el.className = 'rec-status ' + (!cams.length ? 'idle' : ok === recording.length && ok ? 'ok' : ok ? 'warn' : 'bad');
  el.replaceChildren(h('span.dot'), h('span', !cams.length ? t('Chưa có camera')
    : recording.length ? t('{ok}/{total} đang ghi', { ok, total: recording.length }) : t('Không ghi')));
}

// Nút đổi ngôn ngữ VI / EN (đổi xong tải lại trang)
function parseHash() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  return { id: path || 'live', params: Object.fromEntries(new URLSearchParams(query || '')) };
}

function route() {
  if (!shell) return;
  const { id, params } = parseHash();
  const page = PAGES.find(p => p.id === id) || PAGES[0];
  current?.unmount();
  shell.main.replaceChildren();
  shell.main.className = `main page-${page.id}`;
  for (const a of shell.navItems) a.classList.toggle('active', a.dataset.page === page.id);
  current = page.page(shell.main, params);
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  showLogin();
}

window.addEventListener('camnas:logout', () => { if (shell) showLogin(); });
boot();
