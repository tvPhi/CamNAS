// Trang xem lại: chọn ngày + camera, dòng thời gian, phát nối tiếp, tua nhanh, chụp ảnh, xuất clip.
import {
  api, h, icon, iconButton, button, toast, prefs, saveFile, safeName, stamp,
  fmtTime, fmtDate, dayKey, dayLabel, fmtDuration, fmtBytes,
} from './util.js';
import { store } from './store.js';
import { Timeline } from './timeline.js';
import { SegmentPlayer } from './player.js';
import { t, lang } from './i18n.js';

const RATES = [0.5, 1, 2, 4, 8, 16];
const SPANS = [[86400, t('24 giờ')], [6 * 3600, t('6 giờ')], [3600, t('1 giờ')], [900, t('15 phút')]];

export function PlaybackPage(main, params) {
  const startTs = params.t ? Number(params.t) : null;
  let day = params.day || dayKey(startTs ? new Date(startTs * 1000) : new Date());
  let camId = params.cam || prefs.get('pb.cam', null);
  let data = null;
  let days = [];
  let range = { a: null, b: null };
  let refreshTimer = null;
  let destroyed = false;

  // ----- thanh chọn ngày + camera -----
  const dateInput = h('input.date-input', { type: 'date', value: day, max: dayKey(new Date()), onchange: () => dateInput.value && setDay(dateInput.value) });
  const dayText = h('span.day-text');
  const camChips = h('div.chips');
  const header = h('div.pb-head',
    h('div.day-nav',
      iconButton('left', t('Ngày trước'), { onclick: () => shiftDay(-1) }),
      h('label.date-pick', icon('calendar', 18), dayText, dateInput),
      iconButton('right', t('Ngày sau'), { onclick: () => shiftDay(1) }),
      button(t('Hôm nay'), null, { class: 'small', onclick: () => setDay(dayKey(new Date())) })),
    camChips);

  // ----- khung video -----
  const stage = h('div.pb-stage');
  const overlay = h('div.pb-overlay');
  const camLabel = h('div.pb-cam-label');
  stage.append(overlay, camLabel);

  const playBtn = iconButton('play', t('Phát / Tạm dừng (Space)'), { class: 'big', onclick: () => togglePlay() });
  const clock = h('div.pb-clock', h('strong', '--:--:--'), h('span', ''));
  const rateSel = h('select.rate', { title: t('Tốc độ phát'), onchange: () => setRate(Number(rateSel.value)) },
    RATES.map(r => h('option', { value: r }, `${r}×`)));
  const muteBtn = iconButton('volume', t('Tắt/bật tiếng'), { onclick: () => setMuted(!player.muted) });
  const rangeText = h('span.range-text');
  const exportBtn = button(t('Xuất clip'), 'scissors', { class: 'small', disabled: true, onclick: () => exportClip() });
  const controls = h('div.pb-controls',
    h('div.ctrl-group',
      iconButton('prev', t('Đoạn trước (PageUp)'), { onclick: () => player.prevSegment() }),
      iconButton('back10', t('Lùi 10 giây (←)'), { onclick: () => player.step(-10) }),
      playBtn,
      iconButton('fwd10', t('Tới 10 giây (→)'), { onclick: () => player.step(10) }),
      iconButton('next', t('Đoạn sau (PageDown)'), { onclick: () => player.nextSegment() })),
    clock,
    h('div.ctrl-group', rateSel, muteBtn,
      iconButton('snapshot', t('Chụp ảnh khung hình'), { onclick: () => snapshot() }),
      iconButton('download', t('Tải đoạn ghi này'), { onclick: () => downloadSegment() })),
    h('div.ctrl-group.export',
      iconButton('bracketL', t('Đánh dấu điểm đầu ( [ )'), { onclick: () => mark('a') }),
      iconButton('bracketR', t('Đánh dấu điểm cuối ( ] )'), { onclick: () => mark('b') }),
      rangeText, exportBtn));

  // ----- dòng thời gian -----
  const spanBtns = SPANS.map(([s, label]) => h('button.chip.small', { type: 'button', onclick: () => { timeline.setSpan(s); markSpan(s); } }, label));
  const tlWrap = h('div.timeline-wrap');
  const tlBar = h('div.tl-bar',
    h('div.tl-legend', h('span.lg.ok'), t('Đã ghi'), h('span.lg.rec'), t('Đang ghi'), h('span.lg.bad'), t('File lỗi')),
    h('div.spacer'),
    iconButton('zoomout', t('Thu nhỏ'), { onclick: () => timeline.zoom(1.6) }),
    h('div.seg', spanBtns),
    iconButton('zoomin', t('Phóng to'), { onclick: () => timeline.zoom(0.6) }));
  main.append(header, stage, controls, h('div.pb-timeline', tlBar, tlWrap));

  const timeline = new Timeline(tlWrap, { onSeek });
  const player = new SegmentPlayer(stage, {
    onTime: ts => {
      if (ts === null) return;
      timeline.setPlayhead(ts);
      clock.firstChild.textContent = fmtTime(ts);
      clock.lastChild.textContent = fmtDate(ts);
    },
    onState: playing => {
      playBtn.replaceChildren(icon(playing ? 'pause' : 'play', 22));
      if (playing) showOverlay(null);
    },
    onEnd: why => showOverlay(why === 'recording'
      ? h('div', h('p', t('Đã tới đoạn đang ghi.')), h('a.btn.primary', { href: `#/live?cam=${camId}` }, icon('live', 18), t('Xem trực tiếp')))
      : h('p', t('Hết bản ghi của ngày này'))),
    onError: msg => showOverlay(h('p', msg)),
  });

  rateSel.value = String(prefs.get('pb.rate', 1));
  player.setRate(Number(rateSel.value));
  setMuted(prefs.get('pb.muted', false));
  markSpan(86400);

  function showOverlay(content) {
    overlay.replaceChildren(...(content ? [content] : []));
    overlay.classList.toggle('show', !!content);
  }

  function markSpan(s) {
    spanBtns.forEach((b, i) => b.classList.toggle('active', SPANS[i][0] === s));
  }

  function setRate(r) {
    player.setRate(r);
    prefs.set('pb.rate', r);
  }

  function setMuted(m) {
    player.setMuted(m);
    prefs.set('pb.muted', m);
    muteBtn.replaceChildren(icon(m ? 'mute' : 'volume', 20));
  }

  function togglePlay() {
    if (!player.toggle()) {
      // chưa chọn đoạn nào: phát từ đoạn đầu tiên trong ngày
      const first = (data?.cameras[camId] || []).find(s => s.st === 'ok');
      if (first) seekTo(first.s, true);
    }
  }

  function updateUrl() {
    const now = player.time;
    history.replaceState(null, '', `#/playback?cam=${camId}&day=${day}${now ? `&t=${Math.floor(now)}` : ''}`);
  }

  // ----- dữ liệu -----
  async function loadDays() {
    try {
      days = (await api('/api/days')).days;
    } catch { days = []; }
    if (days.length) dateInput.min = days[0];
  }

  async function loadTimeline() {
    const res = await api(`/api/timeline?day=${day}`);
    if (destroyed || res.day !== day) return null;
    return res;
  }

  function camsInOrder() {
    return store.cameras.map(c => ({ id: c.id, name: c.name }));
  }

  function renderChips() {
    camChips.replaceChildren(...store.cameras.map(c => {
      const segs = data?.cameras[c.id] || [];
      return h('button.chip', {
        type: 'button',
        class: c.id === camId ? 'active' : '',
        onclick: () => selectCamera(c.id),
      }, h(`span.dot.s-${c.status.state}`), c.name, segs.length ? null : h('span.muted', ` ${t('(trống)')}`));
    }));
  }

  async function setDay(newDay, seekTs = null) {
    day = newDay;
    dateInput.value = day;
    dayText.textContent = dayLabel(day);
    player.setSegments(camId, []);
    showOverlay(h('div.tile-spinner.static'));
    try {
      data = await loadTimeline();
    } catch (e) {
      showOverlay(h('p', e.message));
      return;
    }
    if (!data) return;
    timeline.setData(data.start, camsInOrder(), data.cameras, data.now);
    renderChips();
    selectCamera(camId, seekTs ?? 'auto');
  }

  function shiftDay(delta) {
    const [y, m, d] = day.split('-').map(Number);
    const next = dayKey(new Date(y, m - 1, d + delta));
    if (next > dayKey(new Date())) return;
    setDay(next);
  }

  function selectCamera(id, seekTs) {
    const cams = store.cameras;
    if (!cams.length) {
      showOverlay(h('div', h('p', t('Chưa có camera nào')), h('a.btn.primary', { href: '#/cameras?add=1' }, t('Thêm camera'))));
      return;
    }
    if (!cams.some(c => c.id === id)) id = cams[0].id;
    const keepTs = seekTs === undefined ? player.time : seekTs;
    const wasPlaying = player.playing;
    camId = id;
    prefs.set('pb.cam', id);
    timeline.setSelected(id);
    renderChips();
    camLabel.textContent = store.camera(id)?.name || '';
    const segs = data?.cameras[id] || [];
    player.setSegments(id, segs);
    if (!segs.length) {
      showOverlay(h('p', t('Không có bản ghi của camera này vào {day}', { day: lang === 'vi' ? dayLabel(day).toLowerCase() : dayLabel(day) })));
      return;
    }
    showOverlay(null);
    if (keepTs === 'auto' || keepTs === null || keepTs === undefined) {
      // mặc định: đoạn đã ghi xong mới nhất trong ngày
      const okSegs = segs.filter(s => s.st === 'ok');
      const last = okSegs[okSegs.length - 1];
      if (last) seekTo(last.s, false);
      else showOverlay(h('p', t('Đoạn ghi đầu tiên chưa ghi xong, vui lòng đợi vài phút hoặc xem trực tiếp')));
    } else {
      seekTo(keepTs, wasPlaying || seekTs !== undefined);
    }
  }

  async function seekTo(ts, play = true) {
    const r = await player.seek(ts, play);
    if (r === 'jumped') toast(t('Không có ghi hình lúc {from} - chuyển tới {to}', { from: fmtTime(ts), to: fmtTime(player.time) }));
    else if (r === 'latest') toast(t('Đoạn này đang được ghi, phát đoạn gần nhất đã ghi xong'));
    else if (r === 'recording') toast(t('Đoạn này đang được ghi, chưa xem lại được. Hãy xem trực tiếp.'));
    else if (r === 'none') toast(t('Không có bản ghi sau thời điểm này'));
    if (r !== 'none' && r !== 'recording') showOverlay(null);
    updateUrl();
  }

  function onSeek(id, ts) {
    if (id && id !== camId) selectCamera(id, ts ?? player.time ?? 'auto');
    else if (ts !== null) seekTo(ts, true);
  }

  async function refresh() {
    if (day !== dayKey(new Date())) return;
    try {
      const res = await loadTimeline();
      if (!res) return;
      data = res;
      timeline.setData(data.start, camsInOrder(), data.cameras, data.now);
      player.updateSegments(data.cameras[camId] || []);
    } catch { /* thử lại lần sau */ }
  }

  // ----- công cụ -----
  async function snapshot() {
    const blob = await player.snapshot();
    if (!blob) return toast(t('Chưa có khung hình để chụp'), 'error');
    saveFile(blob, `${safeName(store.camera(camId)?.name || camId)}_${stamp(player.time)}.jpg`);
  }

  function downloadSegment() {
    const s = player.segment;
    if (!s) return toast(t('Hãy chọn một đoạn ghi trước'), 'error');
    saveFile(`/media/${camId}/${s.f}?download=1`, '');
  }

  function mark(which) {
    const now = player.time;
    if (now === null) return toast(t('Hãy phát tới thời điểm cần đánh dấu trước'), 'error');
    range[which] = now;
    if (range.a !== null && range.b !== null && range.b < range.a) [range.a, range.b] = [range.b, range.a];
    renderRange();
  }

  function renderRange() {
    timeline.setRange(range);
    const { a, b } = range;
    rangeText.replaceChildren();
    if (a !== null || b !== null) {
      rangeText.append(
        `${a !== null ? fmtTime(a) : '…'} → ${b !== null ? fmtTime(b) : '…'}`,
        a !== null && b !== null ? h('span.muted', ` (${fmtDuration(b - a)})`) : '',
        iconButton('close', t('Bỏ chọn'), { class: 'tiny', onclick: () => { range = { a: null, b: null }; renderRange(); } }));
    }
    exportBtn.disabled = !(a !== null && b !== null && b - a >= 1);
  }

  async function exportClip() {
    exportBtn.disabled = true;
    toast(t('Đang ghép clip, vui lòng đợi…'));
    try {
      const res = await api('/api/export', { method: 'POST', body: { cam: camId, start: range.a, end: range.b } });
      saveFile(`/api/export/${res.token}`, res.name);
      toast(t('Đã xuất clip {size}', { size: fmtBytes(res.size) }), 'ok');
    } catch (e) {
      toast(e.message, 'error', 6000);
    } finally {
      exportBtn.disabled = false;
    }
  }

  function onKey(e) {
    if (e.target.closest('input,select,textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === ' ' || k === 'k') togglePlay();
    else if (k === 'ArrowLeft') player.step(e.shiftKey ? -60 : -10);
    else if (k === 'ArrowRight') player.step(e.shiftKey ? 60 : 10);
    else if (k === 'PageUp') player.prevSegment();
    else if (k === 'PageDown') player.nextSegment();
    else if (k === '[') mark('a');
    else if (k === ']') mark('b');
    else if (k === '+' || k === '=') timeline.zoom(0.6);
    else if (k === '-') timeline.zoom(1.6);
    else if (k === 'm') setMuted(!player.muted);
    else return;
    e.preventDefault();
  }

  document.addEventListener('keydown', onKey);
  const urlTimer = setInterval(() => player.playing && updateUrl(), 5000);
  let initialized = false;
  const unsub = store.subscribe(() => {
    if (!initialized) {
      initialized = true;
      loadDays();
      setDay(day, startTs);
    } else {
      renderChips();
    }
  });
  refreshTimer = setInterval(refresh, 30000);
  dayText.textContent = dayLabel(day);

  return {
    unmount() {
      destroyed = true;
      unsub();
      clearInterval(refreshTimer);
      clearInterval(urlTimer);
      document.removeEventListener('keydown', onKey);
      timeline.destroy();
      player.stop();
    },
  };
}
