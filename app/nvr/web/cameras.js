// Trang quản lý camera: thêm/sửa/xoá, bật tắt ghi hình, kiểm tra kết nối.
import { api, h, icon, iconButton, button, toast, modal, fmtDuration, STATE_LABEL } from './util.js';
import { store } from './store.js';
import { t } from './i18n.js';

const BRANDS = {
  ezviz: {
    label: 'EZVIZ / Hikvision', user: 'admin', port: 554,
    passLabel: t('Mã xác minh (6 chữ in hoa trên nhãn dưới đáy camera)'),
    main: '/h264/ch1/main/av_stream', sub: '/h264/ch1/sub/av_stream',
  },
  imou: {
    label: 'Imou / Dahua', user: 'admin', port: 554,
    passLabel: t('Mật khẩu thiết bị (Imou: Safety Code trên nhãn)'),
    main: '/cam/realmonitor?channel=1&subtype=0', sub: '/cam/realmonitor?channel=1&subtype=1',
  },
  tapo: {
    label: 'TP-Link Tapo', user: '', port: 554,
    passLabel: t('Mật khẩu của "Tài khoản camera" tạo trong app Tapo'),
    main: '/stream1', sub: '/stream2',
  },
  other: { label: t('Khác') },
};

const RTSP_RE = /^rtsp:\/\/(?:([^:@/]*)(?::([^@/]*))?@)?([^:/?#]+)(?::(\d+))?(\/.*)?$/i;

function parseUrl(url) {
  const m = RTSP_RE.exec(url || '');
  if (!m) return null;
  const path = m[5] || '';
  const brand = Object.keys(BRANDS).find(k => BRANDS[k].main && path === BRANDS[k].main) || 'other';
  const dec = s => { try { return decodeURIComponent(s || ''); } catch { return s || ''; } };
  return { brand, user: dec(m[1]), pass: dec(m[2]), ip: m[3], port: m[4] || '554' };
}

function statusText(cam) {
  const s = cam.status;
  if (!cam.record) return t('Chỉ xem trực tiếp, không ghi hình');
  if (s.state === 'recording') {
    const parts = [t('từ {dur} trước', { dur: fmtDuration(Date.now() / 1000 - s.since) })];
    if (s.fps) parts.push(t('{fps} khung/giây', { fps: s.fps }));
    if (s.kbps) parts.push(`${(s.kbps / 1000).toFixed(1)} Mbps`);
    return parts.join(' · ');
  }
  if (s.state === 'error') return s.error;
  return '';
}

export function CamerasPage(main, params) {
  const grid = h('div.cam-cards');
  const cards = new Map();
  main.append(
    h('div.page-head',
      h('div', h('h1', t('Camera')), h('p.muted', t('Thêm camera bằng địa chỉ RTSP. Mỗi camera được ghi liên tục 24/7 thành các file mp4.'))),
      button(t('Thêm camera'), 'plus', { class: 'primary', onclick: () => editCamera(null) })),
    grid);

  function render(cams) {
    if (!cams.length) {
      cards.clear();
      grid.replaceChildren(h('div.empty.wide',
        icon('video', 40),
        h('p', t('Chưa có camera nào. Bấm "Thêm camera" để bắt đầu.')),
        button(t('Thêm camera'), 'plus', { class: 'primary', onclick: () => editCamera(null) })));
      return;
    }
    const ids = new Set(cams.map(c => c.id));
    for (const [id, card] of cards) if (!ids.has(id)) { card.el.remove(); cards.delete(id); }
    grid.querySelector('.empty')?.remove();
    cams.forEach((cam, i) => {
      let card = cards.get(cam.id);
      if (!card) {
        card = makeCard(cam);
        cards.set(cam.id, card);
      }
      if (grid.children[i] !== card.el) grid.insertBefore(card.el, grid.children[i] || null);
      updateCard(card, cam);
    });
  }

  function makeCard(cam) {
    const img = h('img', { alt: '', loading: 'lazy' });
    img.onerror = () => img.classList.add('broken');
    img.onload = () => img.classList.remove('broken');
    const card = {
      cam,
      img,
      name: h('h3'),
      state: h('span.badge'),
      info: h('p.cam-info'),
      meta: h('p.cam-meta.muted'),
      toggle: h('input', { type: 'checkbox' }),
    };
    card.toggle.addEventListener('change', async () => {
      const record = card.toggle.checked;
      card.toggle.disabled = true;
      try {
        await api(`/api/cameras/${card.cam.id}`, { method: 'PUT', body: { record } });
        toast(t(record ? 'Đã bật ghi hình "{name}"' : 'Đã tắt ghi hình "{name}"', { name: card.cam.name }), 'ok');
        await store.refresh();
      } catch (e) {
        card.toggle.checked = !record;
        toast(e.message, 'error');
      } finally {
        card.toggle.disabled = false;
      }
    });
    card.el = h('div.cam-card',
      h('a.cam-thumb', { href: `#/live?cam=${cam.id}`, title: t('Xem trực tiếp') },
        img, h('span.thumb-empty', icon('video', 32), t('Chưa có hình')), card.state),
      h('div.cam-body',
        card.name, card.info, card.meta,
        h('div.cam-actions',
          h('label.switch', card.toggle, h('span.slider'), h('span', t('Ghi hình'))),
          h('div.spacer'),
          iconButton('history', t('Xem lại'), { onclick: () => { location.hash = `#/playback?cam=${card.cam.id}`; } }),
          iconButton('edit', t('Sửa'), { onclick: () => editCamera(card.cam) }),
          iconButton('trash', t('Xoá'), { class: 'danger', onclick: () => deleteCamera(card.cam) }))));
    loadThumb(card);
    return card;
  }

  function updateCard(card, cam) {
    card.cam = cam;
    card.name.textContent = cam.name;
    const st = cam.status.state;
    card.state.className = `badge s-${st}`;
    card.state.textContent = st === 'recording' ? '● REC' : STATE_LABEL[st] || st;
    card.info.textContent = statusText(cam);
    card.info.className = `cam-info ${st === 'error' ? 'err' : ''}`;
    card.meta.textContent = [
      cam.sub_url ? t('Có luồng phụ') : t('Không có luồng phụ'),
      t('Âm thanh: {v}', { v: cam.audio ? t('có') : t('không') }),
      t('Mã: {id}', { id: cam.id }),
    ].join(' · ');
    if (!card.toggle.disabled) card.toggle.checked = cam.record;
  }

  function loadThumb(card) {
    card.img.src = `/api/cameras/${card.cam.id}/snapshot?_=${Date.now()}`;
  }

  async function deleteCamera(cam) {
    const purge = h('input', { type: 'checkbox' });
    const ok = await modal(t('Xoá camera "{name}"?', { name: cam.name }), h('div',
      h('p', t('Camera sẽ ngừng ghi hình và bị xoá khỏi danh sách.')),
      h('label.check', purge, h('span', t('Xoá luôn toàn bộ bản ghi của camera này (không khôi phục được)')))), [
      { label: t('Huỷ'), value: false },
      { label: t('Xoá camera'), value: true, danger: true },
    ]);
    if (!ok) return;
    try {
      await api(`/api/cameras/${cam.id}?purge=${purge.checked}`, { method: 'DELETE' });
      toast(t('Đã xoá camera "{name}"', { name: cam.name }), 'ok');
      store.refresh();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const unsub = store.subscribe(render);
  const thumbTimer = setInterval(() => {
    if (!document.hidden) for (const card of cards.values()) loadThumb(card);
  }, 20000);
  if (params.add) {
    history.replaceState(null, '', '#/cameras');
    editCamera(null);
  }

  return {
    unmount() {
      unsub();
      clearInterval(thumbTimer);
    },
  };
}

export async function editCamera(cam) {
  const parsed = cam ? parseUrl(cam.url) : null;
  let brand = cam ? (parsed?.brand || 'other') : 'ezviz';

  const f = {
    name: h('input', { type: 'text', value: cam?.name || '', placeholder: t('Ví dụ: Cổng trước'), maxLength: 60, required: true }),
    ip: h('input', { type: 'text', value: parsed?.ip || '', placeholder: '192.168.1.20', inputMode: 'decimal' }),
    port: h('input', { type: 'number', value: parsed?.port || '554', min: 1, max: 65535 }),
    user: h('input', { type: 'text', value: parsed?.user ?? 'admin', autocomplete: 'off' }),
    pass: h('input', { type: 'text', value: parsed?.pass || '', autocomplete: 'off', spellcheck: false }),
    url: h('input', { type: 'text', value: cam?.url || '', placeholder: 'rtsp://user:pass@192.168.1.20:554/...', spellcheck: false }),
    sub: h('input', { type: 'text', value: cam?.sub_url || '', placeholder: t('(không bắt buộc) luồng chất lượng thấp cho lưới xem'), spellcheck: false }),
    record: h('input', { type: 'checkbox', checked: cam ? cam.record : true }),
    audio: h('input', { type: 'checkbox', checked: cam ? cam.audio : true }),
  };
  const passLabel = h('span');
  const brandFields = h('div.brand-fields',
    h('div.row2',
      h('label.field', h('span', t('Địa chỉ IP camera')), f.ip),
      h('label.field.narrow', h('span', t('Cổng RTSP')), f.port)),
    h('div.row2',
      h('label.field', h('span', t('Tên đăng nhập')), f.user),
      h('label.field', passLabel, f.pass)));
  const brandBtns = Object.entries(BRANDS).map(([k, b]) => h('button.chip', { type: 'button', 'data-brand': k, onclick: () => setBrand(k) }, b.label));
  const probeBox = h('div.probe');
  const hint = h('p.hint');

  function setBrand(k) {
    brand = k;
    const b = BRANDS[k];
    for (const btn of brandBtns) btn.classList.toggle('active', btn.dataset.brand === k);
    brandFields.hidden = k === 'other';
    passLabel.textContent = b.passLabel || t('Mật khẩu');
    if (b.main && !f.user.value && b.user) f.user.value = b.user;
    hint.replaceChildren(...brandHint(k));
    buildUrls();
  }

  function buildUrls() {
    const b = BRANDS[brand];
    if (!b.main || !f.ip.value.trim()) return;
    const enc = encodeURIComponent;
    const auth = f.user.value ? `${enc(f.user.value)}${f.pass.value ? ':' + enc(f.pass.value) : ''}@` : '';
    const base = `rtsp://${auth}${f.ip.value.trim()}:${f.port.value || 554}`;
    f.url.value = base + b.main;
    f.sub.value = base + b.sub;
  }

  for (const k of ['ip', 'port', 'user', 'pass']) f[k].addEventListener('input', buildUrls);

  async function probe() {
    const urls = [f.url.value.trim(), f.sub.value.trim()].filter(Boolean);
    if (!urls.length) return probeBox.replaceChildren(h('p.err', t('Hãy nhập địa chỉ camera trước')));
    probeBox.replaceChildren(h('p.muted', h('span.tile-spinner.inline'), ` ${t('Đang kết nối thử tới camera…')}`));
    const results = await Promise.all(urls.map(url => api('/api/probe', { method: 'POST', body: { url } }).catch(e => ({ ok: false, error: e.message }))));
    probeBox.replaceChildren(...results.map((r, i) => {
      const title = i === 0 ? t('Luồng chính') : t('Luồng phụ');
      if (!r.ok) return h('p.err', icon('alert', 16), ` ${title}: ${r.error}`);
      const v = r.video;
      const parts = v ? [`${(v.codec || '').toUpperCase().replace('HEVC', 'H.265').replace('H264', 'H.264')}`, `${v.width}×${v.height}`, v.fps ? t('{fps} khung/giây', { fps: v.fps }) : null] : [];
      if (r.audio) parts.push(t('âm thanh {codec}', { codec: r.audio.codec }));
      return h('div',
        h('p.ok', icon('check', 16), ` ${title}: ${parts.filter(Boolean).join(' · ')}`),
        ...r.warnings.map(w => h('p.warn', icon('alert', 16), ' ', w)));
    }));
  }

  const body = h('form.form', { onsubmit: e => e.preventDefault() },
    h('label.field', h('span', t('Tên camera')), f.name),
    h('div.field', h('span', t('Hãng camera')), h('div.chips.wrap', brandBtns)),
    hint,
    brandFields,
    h('label.field', h('span', t('Địa chỉ luồng chính (RTSP) - dùng để ghi hình')), f.url),
    h('label.field', h('span', t('Địa chỉ luồng phụ - dùng cho lưới xem trực tiếp, đỡ tốn băng thông')), f.sub),
    h('div.checks',
      h('label.check', f.record, h('span', t('Ghi hình liên tục 24/7'))),
      h('label.check', f.audio, h('span', t('Ghi cả âm thanh')))),
    h('div.probe-row', button(t('Kiểm tra kết nối'), 'refresh', { class: 'small', onclick: probe }), probeBox));

  setBrand(brand);

  return modal(cam ? t('Sửa camera "{name}"', { name: cam.name }) : t('Thêm camera'), body, [
    { label: t('Huỷ'), value: null },
    {
      label: cam ? t('Lưu') : t('Thêm camera'),
      primary: true,
      onClick: async () => {
        const payload = {
          name: f.name.value.trim(),
          url: f.url.value.trim(),
          sub_url: f.sub.value.trim(),
          record: f.record.checked,
          audio: f.audio.checked,
        };
        if (!payload.name) { f.name.focus(); toast(t('Hãy đặt tên cho camera'), 'error'); return false; }
        if (!payload.url) { toast(t('Hãy nhập IP/mật khẩu hoặc địa chỉ RTSP của camera'), 'error'); return false; }
        try {
          const saved = await api(cam ? `/api/cameras/${cam.id}` : '/api/cameras', { method: cam ? 'PUT' : 'POST', body: payload });
          toast(cam ? t('Đã lưu thay đổi') : t('Đã thêm camera "{name}"', { name: saved.name }), 'ok');
          store.refresh();
          return saved;
        } catch (e) {
          toast(e.message, 'error', 6000);
          return false;
        }
      },
    },
  ]);
}

function brandHint(k) {
  if (k === 'ezviz') {
    return [t('Camera EZVIZ: tên đăng nhập là admin, mật khẩu là mã xác minh in trên nhãn dưới đáy camera. Camera đã từng chạy với Surveillance Station thì RTSP đã bật sẵn; nếu không kết nối được, hãy kiểm tra RTSP trong cài đặt của ứng dụng EZVIZ hoặc phần mềm EZVIZ Studio (tuỳ đời camera).')];
  }
  if (k === 'tapo') return [t('Trong app Tapo: Cài đặt camera → Cài đặt nâng cao → Tài khoản camera, tạo tên đăng nhập và mật khẩu riêng.')];
  if (k === 'imou') return [t('Imou/Dahua: tên đăng nhập thường là admin, mật khẩu là Safety Code trên nhãn camera hoặc mật khẩu thiết bị bạn đã đặt.')];
  return [t('Nhập địa chỉ RTSP đầy đủ của camera. Có thể tìm trong tài liệu của hãng hoặc phần mềm ONVIF Device Manager.')];
}
