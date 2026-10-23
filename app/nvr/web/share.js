// Trang xem một camera được chia sẻ bằng link (/s/<mã>): không cần tài khoản CamNAS,
// chỉ xem trực tiếp đúng camera trong link, có thể phải nhập mật khẩu của link.
import { h, iconButton, icon, logo, langSwitch, prefs, fmtDate } from './util.js';
import { t, lang } from './i18n.js';
import { loadPlayer } from './live.js';

const shareId = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
const base = `/api/share/${encodeURIComponent(shareId)}`;
const root = document.getElementById('app');
let stopViewer = null;

async function call(path = '', body) {
  const res = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Lang': lang, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || t('Lỗi {code}', { code: res.status })), { status: res.status });
  return data;
}

function untilText(expires) {
  if (!expires) return t('Không hết hạn');
  const [y, m, d] = expires.split('-').map(Number);
  return t('Xem được đến hết ngày {date}', { date: fmtDate(new Date(y, m - 1, d).getTime() / 1000) });
}

function showMessage(text) {
  stopViewer?.();
  root.replaceChildren(h('div.login-page', h('div.login-card',
    logo(), h('h1', 'CamNAS'), h('p.muted', text), langSwitch())));
}

function showPassword(info) {
  const input = h('input', { type: 'password', placeholder: t('Mật khẩu của link'), autocomplete: 'current-password', required: true });
  const err = h('div.form-error');
  const submit = h('button.btn.primary.block', { type: 'submit' }, t('Xem camera'));
  const form = h('form.login-card', {
    onsubmit: async e => {
      e.preventDefault();
      err.textContent = '';
      submit.disabled = true;
      try {
        await call('/login', { password: input.value });
        start();
      } catch (ex) {
        err.textContent = ex.message;
        input.select();
      } finally {
        submit.disabled = false;
      }
    },
  }, logo(), h('h1', info.camera), h('p.muted', t('Link này có mật khẩu. Hãy nhập mật khẩu người chia sẻ đã gửi cho bạn.')),
  input, err, submit, langSwitch());
  root.replaceChildren(h('div.login-page', form));
  input.focus();
}

async function showViewer(info) {
  await loadPlayer();
  const narrow = matchMedia('(max-width: 720px)').matches;
  let quality = info.sub ? prefs.get(`share.quality.${shareId}`, narrow ? 'sd' : 'hd') : 'hd';
  let player = null;
  let muted = true;
  const msg = h('div.tile-msg');
  const qBtn = h('button.q-chip', {
    type: 'button',
    disabled: !info.sub,
    title: info.sub ? t('Bấm để đổi giữa luồng chính (HD) và luồng phụ (SD)') : t('Camera này chỉ có luồng chính'),
    onclick: () => {
      quality = quality === 'sd' ? 'hd' : 'sd';
      prefs.set(`share.quality.${shareId}`, quality);
      attach();
    },
  });
  const muteBtn = iconButton('mute', t('Bật âm thanh'), {
    onclick: () => {
      if (!player?.video) return;
      muted = !player.video.muted;
      player.video.muted = muted;
      if (!muted) player.video.play().catch(() => {});
      muteBtn.replaceChildren(icon(muted ? 'mute' : 'volume', 20));
      muteBtn.title = muted ? t('Bật âm thanh') : t('Tắt âm thanh');
    },
  });
  const tile = h('div.tile.share-tile',
    h('div.tile-spinner'),
    msg,
    h('div.tile-top', h('span'), h('span.tile-tags', qBtn)),
    h('div.tile-actions', muteBtn, iconButton('maximize', t('Toàn màn hình'), {
      onclick: () => {
        if (tile.requestFullscreen) tile.requestFullscreen().catch(() => {});
        else player?.video?.webkitEnterFullscreen?.(); // iPhone
      },
    })));
  const observer = new MutationObserver(() => {
    const state = player.getAttribute('state');
    msg.textContent = state === 'lost' ? t('Mất kết nối, đang thử lại…')
      : state === 'error' ? t('Không lấy được hình từ camera') : '';
    if (state === 'lost') check();  // có thể link vừa bị thu hồi hoặc vừa hết hạn
  });

  function updateChip() {
    const v = player?.video;
    qBtn.textContent = (quality === 'sd' ? 'SD' : 'HD') + (v?.videoHeight ? ` ${v.videoHeight}p` : '');
  }

  function attach() {
    const old = player;
    player = document.createElement('cam-live');
    player.src = `${base}/ws?q=${quality}`;
    if (old) {
      old.replaceWith(player);
      old.close();
    } else {
      tile.prepend(player);
    }
    if (player.video) {
      player.video.muted = muted;
      player.video.addEventListener('resize', updateChip);
    }
    observer.disconnect();
    observer.observe(player, { attributes: true, attributeFilter: ['state'] });
    updateChip();
  }

  async function check() {
    try {
      await call();
    } catch (e) {
      if (e.status === 404 || e.status === 410 || e.status === 401) start();
    }
  }

  root.replaceChildren(h('div.share-page',
    h('header.share-top', logo(), h('div.share-title', h('strong', info.camera), h('span.muted', untilText(info.expires))), langSwitch()),
    tile));
  attach();
  const timer = setInterval(check, 60000);
  stopViewer = () => {
    clearInterval(timer);
    observer.disconnect();
    player?.close();
    stopViewer = null;
  };
}

async function start() {
  stopViewer?.();
  try {
    const info = await call();
    document.title = `${info.camera} - CamNAS`;
    if (info.password && !info.authorized) showPassword(info);
    else await showViewer(info);
  } catch (e) {
    showMessage(e.message);
  }
}

start();
