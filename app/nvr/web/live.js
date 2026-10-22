// Trang xem trực tiếp: lưới camera, phóng to 1 camera, chụp ảnh, toàn màn hình.
import { h, icon, iconButton, button, toast, prefs, saveFile, safeName, stamp, STATE_LABEL } from './util.js';
import { store } from './store.js';
import { t } from './i18n.js';

let playerReady = null;

// go2rtc đặt tốc độ phát = số giây còn trong bộ đệm (0.1× tới 5×) để bám sát thời gian thực.
// Mạng điện thoại / wifi gửi dữ liệu từng đợt nên hình lúc như quay chậm, lúc tua nhanh.
// Ở đây chỉ cho lệch nhẹ quanh 1× để đệm dần về ~1 giây; trễ quá xa thì nhảy tới gần cuối đệm.
const LIVE_BUFFER = 1;
function smoothLiveRate(video) {
  const native = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
  Object.defineProperty(video, 'playbackRate', {
    configurable: true,
    get() { return native.get.call(this); },
    set(gap) {
      if (gap > 3 && !this.paused) {
        this.currentTime += gap - LIVE_BUFFER;
        gap = LIVE_BUFFER;
      }
      const rate = Math.min(1.15, Math.max(0.85, 1 + (gap - LIVE_BUFFER) * 0.25));
      if (Math.abs(rate - native.get.call(this)) > 0.01) native.set.call(this, rate);
    },
  });
}

// Trình phát của go2rtc (MSE, độ trễ thấp ~1 giây). Được nạp qua máy chủ CamNAS.
export function loadPlayer() {
  if (!playerReady) {
    playerReady = import('/live/video-rtc.js').then(({ VideoRTC }) => {
      if (customElements.get('cam-live')) return;
      class CamLive extends VideoRTC {
        constructor() {
          super();
          this.mode = 'mse,hls,mjpeg';
          // ô cuộn ra khỏi màn hình (điện thoại xếp các ô theo cột) thì ngắt luồng sau 5 giây
          this.visibilityThreshold = 0.01;
        }

        oninit() {
          super.oninit();
          this.video.controls = false;
          this.video.muted = true;
          this.video.addEventListener('playing', () => this.setAttribute('state', 'playing'));
          smoothLiveRate(this.video);
        }

        // Bỏ qua khi chưa có luồng: play() lỗi sẽ khiến go2rtc tự tắt tiếng ô đang bật âm thanh
        play() {
          if (this.video.src || this.video.srcObject) super.play();
        }

        onconnect() {
          const started = super.onconnect();
          if (started && this.getAttribute('state') !== 'playing') this.setAttribute('state', 'loading');
          return started;
        }

        onopen() {
          const modes = super.onopen();
          this.onmessage.camnas = msg => {
            if (msg.type === 'error' && !String(msg.value).startsWith('mse')) {
              this.dataset.error = msg.value;
              this.setAttribute('state', 'error');
            }
          };
          return modes;
        }

        onclose() {
          const reconnecting = super.onclose();
          if (reconnecting && this.getAttribute('state') !== 'error') this.setAttribute('state', 'lost');
          return reconnecting;
        }

        // go2rtc tự chuyển sang MJPEG khi trình duyệt không giải mã được luồng (thường là H.265):
        // NAS phải mã hoá lại từng khung thành ảnh JPEG nên hình rất giật
        onmjpeg() {
          super.onmjpeg();
          this.dataset.mode = 'mjpeg';
          this.dispatchEvent(new Event('mjpeg'));
          const draw = this.ondata;
          this.ondata = data => {
            draw(data);
            this.setAttribute('state', 'playing');
          };
        }

        close() {
          clearTimeout(this.reconnectTID);
          clearTimeout(this.disconnectTID);
          this.reconnectTID = this.disconnectTID = 0;
          this.ondisconnect();
        }

        // Như của go2rtc nhưng gỡ src thay vì đặt src='' (cách đó sinh lỗi "Empty src" trong console)
        ondisconnect() {
          this.wsState = WebSocket.CLOSED;
          this.ws?.close();
          this.ws = null;
          this.pcState = WebSocket.CLOSED;
          this.pc?.close();
          this.pc = null;
          if (this.video) {
            this.video.removeAttribute('src');
            this.video.srcObject = null;
            this.video.load();
          }
          // kết nối lại (cuộn tới / mở lại ứng dụng) thì hiện vòng chờ thay vì ô đen
          this.setAttribute('state', 'loading');
        }
      }
      customElements.define('cam-live', CamLive);
    }).catch(err => {
      playerReady = null;
      throw err;
    });
  }
  return playerReady;
}

const LAYOUTS = [
  { id: 'auto', label: t('Tự động'), icon: 'grid' },
  { id: 1, label: t('1 camera'), icon: 'layout1' },
  { id: 3, label: t('1 lớn + 2 nhỏ'), icon: 'layout3' },
  { id: 4, label: '2 × 2', icon: 'layout4' },
  { id: 9, label: '3 × 3', icon: 'layout9' },
];

const QUALITIES = [
  ['auto', t('Tự động'), t('Ô nhỏ xem luồng phụ cho nhẹ, ô lớn / toàn màn hình xem luồng chính cho nét')],
  ['hd', 'HD', t('Luôn xem luồng chính (nét nhất, tốn băng thông hơn)')],
  ['sd', 'SD', t('Luôn xem luồng phụ (nhẹ, hợp khi xem bằng 4G)')],
];
// Ô rộng hơn ngần này điểm ảnh thì luồng phụ (thường chỉ 640×360) bị phóng to, trông mờ
const AUTO_HD_WIDTH = 800;
// camera mà trình duyệt này không giải mã được luồng chính (nhớ đến khi tải lại trang)
const mainUnsupported = new Set();

function autoLayout(n) {
  return n <= 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : n === 4 ? 4 : 9;
}

export function LivePage(main, params) {
  let layout = params.cam ? 1 : prefs.get('live.layout', 'auto');
  let focusId = params.cam || prefs.get('live.focus', null);
  let quality = prefs.get('live.quality', 'auto');
  let players = [];
  let cleanups = [];
  let tiles = new Map();
  let signature = null;

  const layoutButtons = LAYOUTS.map(l => iconButton(l.icon, l.label, {
    'data-layout': l.id,
    onclick: () => setLayout(l.id),
  }));
  const qualityButtons = QUALITIES.map(([id, label, title]) => h('button.chip.small', {
    type: 'button',
    'data-q': id,
    title,
    onclick: () => setQuality(id),
  }, label));
  const grid = h('div.live-grid');
  const switcher = h('div.cam-switcher');
  main.append(
    h('div.toolbar',
      h('div.seg', layoutButtons),
      h('div.seg.quality', { title: t('Chất lượng hình') }, qualityButtons),
      h('div.spacer'),
      button(t('Toàn màn hình'), 'maximize', { class: 'hide-mobile', onclick: () => fullscreen(grid) })),
    grid,
    switcher);

  function setLayout(id, cam) {
    layout = id;
    if (cam) focusId = cam;
    prefs.set('live.layout', id);
    if (focusId) prefs.set('live.focus', focusId);
    render();
  }

  function setQuality(q) {
    quality = q;
    prefs.set('live.quality', q);
    // chọn chung thì bỏ các lựa chọn riêng từng camera
    for (const c of store.cameras) prefs.set(`live.quality.${c.id}`, null);
    render();
  }

  function closePlayers() {
    for (const fn of cleanups) fn();
    for (const p of players) p.close?.();
    players = [];
    cleanups = [];
  }

  function render() {
    const cams = store.cameras;
    closePlayers();
    tiles = new Map();
    for (const b of layoutButtons) b.classList.toggle('active', String(b.dataset.layout) === String(layout));
    for (const b of qualityButtons) b.classList.toggle('active', b.dataset.q === quality);
    if (!cams.length) {
      grid.className = 'live-grid';
      switcher.replaceChildren();
      grid.replaceChildren(h('div.empty',
        icon('video', 40), h('p', t('Chưa có camera nào')),
        h('a.btn.primary', { href: '#/cameras?add=1' }, t('Thêm camera'))));
      return;
    }
    const n = layout === 'auto' ? autoLayout(cams.length) : layout;
    let shown;
    if (n === 1) {
      const cam = store.camera(focusId) || cams[0];
      focusId = cam.id;
      shown = [cam];
    } else {
      const slots = n === 3 ? 3 : n;
      shown = cams.slice(0, slots);
      while (shown.length < slots && n >= 4) shown.push(null);
    }
    grid.className = `live-grid l${n}`;
    grid.replaceChildren(...shown.map(cam => cam ? tile(cam, n === 1) : h('div.tile.empty-slot', h('span', t('Trống')))));

    switcher.replaceChildren(...(n === 1 && cams.length > 1 ? cams.map((c, i) =>
      h('button.chip', {
        type: 'button',
        class: c.id === focusId ? 'active' : '',
        onclick: () => setLayout(1, c.id),
        title: t('Phím {n}', { n: i + 1 }),
      }, h(`span.dot.s-${c.status.state}`), c.name)) : []));
    updateBadges(cams);
  }

  function tile(cam, single) {
    let player = null;
    let stream = null;
    let muted = true;
    const badge = h('span.badge');
    const msg = h('div.tile-msg');
    const qBtn = h('button.q-chip', { type: 'button', onclick: e => { e.stopPropagation(); toggleQuality(); } });
    const muteBtn = iconButton('mute', t('Bật âm thanh'), {
      onclick: e => {
        e.stopPropagation();
        if (!player?.video) return;
        muted = !player.video.muted;
        player.video.muted = muted;
        if (!muted) player.video.play().catch(() => {});
        muteBtn.replaceChildren(icon(muted ? 'mute' : 'volume', 20));
        muteBtn.title = muted ? t('Bật âm thanh') : t('Tắt âm thanh');
      },
    });
    const el = h('div.tile', {
      'data-cam': cam.id,
      ondblclick: () => setLayout(single ? 'auto' : 1, cam.id),
    },
    h('div.tile-spinner'),
    msg,
    h('div.tile-top', h('span.tile-name', cam.name), h('span.tile-tags', qBtn, badge)),
    h('div.tile-actions',
      single ? null : iconButton('maximize', t('Phóng to camera này'), { onclick: e => { e.stopPropagation(); setLayout(1, cam.id); } }),
      muteBtn,
      iconButton('snapshot', t('Chụp ảnh'), { onclick: e => { e.stopPropagation(); snapshot(cam); } }),
      iconButton('history', t('Xem lại'), { onclick: e => { e.stopPropagation(); location.hash = `#/playback?cam=${cam.id}`; } }),
      iconButton(single ? 'layout4' : 'maximize', single ? t('Về lưới camera') : t('Toàn màn hình'), {
        class: single ? '' : 'hide-mobile',
        onclick: e => { e.stopPropagation(); single ? setLayout('auto') : fullscreen(el, player); },
      })));
    // Trên điện thoại: chạm vào ô để phóng to
    el.addEventListener('click', () => {
      if (!single && matchMedia('(max-width: 720px)').matches) setLayout(1, cam.id);
    });
    const stateObserver = new MutationObserver(() => {
      const state = player.getAttribute('state');
      msg.textContent = state === 'lost' ? t('Mất kết nối, đang thử lại…')
        : state === 'error' ? t('Không lấy được hình từ camera') : '';
    });

    // Chọn luồng: chính (nét, nặng) hoặc phụ (nhẹ, mờ hơn)
    function wanted() {
      if (!cam.sub_url) return cam.id;
      const pick = prefs.get(`live.quality.${cam.id}`, null) || quality;
      if (pick === 'hd') return cam.id;
      if (pick === 'sd' || mainUnsupported.has(cam.id)) return `${cam.id}_sub`;
      if (single || document.fullscreenElement === el) return cam.id;
      // điện thoại: các ô xếp thành cột, giải mã nhiều luồng chính cùng lúc rất giật; chạm vào ô để xem nét
      if (matchMedia('(max-width: 720px)').matches) return `${cam.id}_sub`;
      // tự động: ô đủ lớn thì luồng phụ bị phóng to sẽ nhoè, nên dùng luồng chính
      const px = el.clientWidth * Math.min(window.devicePixelRatio || 1, 2);
      return px >= AUTO_HD_WIDTH ? cam.id : `${cam.id}_sub`;
    }

    // Đổi luồng bằng cách thay hẳn trình phát: đơn giản và không bị kẹt kết nối cũ
    function attach() {
      const next = wanted();
      if (next === stream) return;
      stream = next;
      const old = player;
      player = document.createElement('cam-live');
      player.src = `/api/live/ws?src=${encodeURIComponent(stream)}`;
      if (old) {
        old.replaceWith(player);
        old.close();
        players.splice(players.indexOf(old), 1);
      } else {
        el.prepend(player);
      }
      players.push(player);
      if (player.video) {
        player.video.muted = muted;
        player.video.addEventListener('resize', updateChip);
      }
      player.addEventListener('mjpeg', () => {
        // luồng chính phải chạy MJPEG: thử luồng phụ (thường nhẹ hơn hoặc là H.264)
        if (cam.sub_url && !stream.endsWith('_sub')) {
          mainUnsupported.add(cam.id);
          attach();
        }
        updateChip();
      });
      stateObserver.disconnect();
      stateObserver.observe(player, { attributes: true, attributeFilter: ['state'] });
      updateChip();
    }

    function updateChip() {
      const sd = stream.endsWith('_sub');
      const v = player?.video;
      const mjpeg = player?.dataset.mode === 'mjpeg';
      qBtn.textContent = (sd ? 'SD' : 'HD') + (mjpeg ? ' JPEG' : v?.videoHeight ? ` ${v.videoHeight}p` : '');
      qBtn.classList.toggle('warn', mjpeg);
      qBtn.disabled = !cam.sub_url;
      qBtn.title = mjpeg ? t('Trình duyệt này không giải mã được luồng video của camera (thường do chuẩn nén H.265), đang hiện từng ảnh JPEG nên rất giật. Hãy đặt camera dùng H.264.')
        : !cam.sub_url ? t('Camera này chỉ có luồng chính')
        : sd ? t('Đang xem luồng phụ (nhẹ, mờ hơn) - bấm để đổi') : t('Đang xem luồng chính (nét nhất) - bấm để đổi');
    }

    function toggleQuality() {
      if (!cam.sub_url) return;
      prefs.set(`live.quality.${cam.id}`, stream.endsWith('_sub') ? 'hd' : 'sd');
      attach();
    }

    // Gắn trình phát khi ô đã có kích thước thật; đổi kích thước (toàn màn hình...) thì chọn lại luồng
    let first = true;
    let timer = 0;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        attach();
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(attach, 700);
    });
    ro.observe(el);
    cleanups.push(() => {
      ro.disconnect();
      clearTimeout(timer);
      stateObserver.disconnect();
    });
    tiles.set(cam.id, { badge });
    return el;
  }

  function updateBadges(cams) {
    for (const cam of cams) {
      const entry = tiles.get(cam.id);
      if (!entry) continue;
      const st = cam.status.state;
      entry.badge.className = `badge s-${st}`;
      entry.badge.textContent = st === 'recording' ? 'REC' : STATE_LABEL[st] || st;
      entry.badge.title = cam.status.error || '';
    }
  }

  async function snapshot(cam) {
    try {
      const res = await fetch(`/api/cameras/${cam.id}/snapshot?hq=1`);
      if (!res.ok) throw new Error();
      saveFile(await res.blob(), `${safeName(cam.name)}_${stamp(Date.now() / 1000)}.jpg`);
    } catch {
      toast(t('Không chụp được ảnh từ camera'), 'error');
    }
  }

  function fullscreen(el, player) {
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else player?.video?.webkitEnterFullscreen?.(); // iPhone
  }

  function onKey(e) {
    if (e.target.closest('input,select,textarea')) return;
    const cams = store.cameras;
    const n = Number(e.key);
    if (n >= 1 && n <= 9 && cams[n - 1]) setLayout(1, cams[n - 1].id);
    else if (e.key === 'Escape' || e.key === '0') setLayout('auto');
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && layout === 1 && cams.length > 1) {
      const i = cams.findIndex(c => c.id === focusId);
      const next = cams[(i + (e.key === 'ArrowRight' ? 1 : cams.length - 1)) % cams.length];
      setLayout(1, next.id);
    }
  }

  let playerLoaded = false;
  const unsub = store.subscribe(cams => {
    const sig = cams.map(c => `${c.id}|${c.name}|${c.sub_url}`).join(';');
    if (sig !== signature && playerLoaded) {
      signature = sig;
      render();
    } else {
      updateBadges(cams);
    }
  });

  grid.replaceChildren(h('div.empty', h('div.tile-spinner.static'), h('p', t('Đang tải trình phát…'))));
  loadPlayer().then(() => {
    playerLoaded = true;
    if (store.loaded) {
      signature = store.cameras.map(c => `${c.id}|${c.name}|${c.sub_url}`).join(';');
      render();
    }
  }).catch(() => {
    grid.replaceChildren(h('div.empty', icon('alert', 40),
      h('p', t('Không tải được trình phát trực tiếp: dịch vụ go2rtc chưa chạy.')),
      h('p.muted', t('Xem Nhật ký để biết chi tiết, hoặc khởi động lại container.'))));
  });
  document.addEventListener('keydown', onKey);

  return {
    unmount() {
      unsub();
      document.removeEventListener('keydown', onKey);
      closePlayers();
    },
  };
}
