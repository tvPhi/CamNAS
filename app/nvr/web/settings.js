// Trang cài đặt: dung lượng ổ cứng, thời hạn lưu, mật khẩu, thông tin hệ thống.
import { api, h, icon, button, toast, modal, confirmBox, fmtBytes, fmtDuration, dayLabel } from './util.js';
import { store } from './store.js';
import { t, lang, setLang, LANGS } from './i18n.js';

const GB = 1024 ** 3;

export function SettingsPage(main) {
  const dirCard = h('section.card.wide');
  const storageCard = h('section.card', h('div.tile-spinner.static'));
  const retentionCard = h('section.card');
  const passwordCard = h('section.card');
  const systemCard = h('section.card');
  main.append(
    h('div.page-head', h('div', h('h1', t('Cài đặt')), h('p.muted', t('Dung lượng lưu trữ, thời gian giữ bản ghi và bảo mật.')))),
    h('div.settings-grid', dirCard, storageCard, retentionCard, passwordCard, systemCard));

  let sys = null;

  async function load() {
    try {
      sys = await api('/api/system');
    } catch (e) {
      storageCard.replaceChildren(h('p.err', e.message));
      return;
    }
    renderDir();
    renderStorage();
    renderSystem();
  }

  function renderDir() {
    const editable = sys.storage_roots.length > 0;
    const input = h('input', { type: 'text', value: sys.recordings_dir, spellcheck: false, disabled: !editable });
    const save = button(t('Lưu thư mục'), 'check', { class: 'primary', disabled: !editable });
    const pick = button(t('Chọn…'), 'folder', {
      disabled: !editable,
      onclick: async () => {
        const path = await pickFolder(input.value);
        if (path) input.value = path;
      },
    });
    save.addEventListener('click', async () => {
      const path = input.value.trim();
      if (path === sys.recordings_dir) return toast(t('Thư mục lưu không thay đổi'));
      const ok = await confirmBox(t('Đổi thư mục lưu bản ghi?'),
        t('Bản ghi mới sẽ được lưu vào {path}. Ghi hình tạm dừng vài giây. Nếu thư mục mới cùng ổ đĩa, bản ghi cũ được chuyển sang luôn.', { path }),
        t('Đổi thư mục'));
      if (!ok) return;
      save.disabled = true;
      try {
        const r = await api('/api/storage-path', { method: 'PUT', body: { path } });
        toast(t('Đã đổi thư mục lưu sang {path}', { path: r.path }), 'ok');
        if (r.notice) toast(r.notice, 'info', 9000);
        load();
      } catch (e) {
        toast(e.message, 'error', 9000);
      } finally {
        save.disabled = false;
      }
    });
    dirCard.replaceChildren(
      h('h2', icon('folder', 20), t('Thư mục lưu bản ghi')),
      h('div.dir-row', input, pick, save),
      editable
        ? h('small.muted', t('CamNAS tự tạo thư mục nếu chưa có. Nên đặt trong một thư mục chia sẻ (ví dụ {example}) để xem được bằng File Station.', { example: `${sys.storage_roots[0]}/camera` }))
        : h('p.warn', icon('alert', 16), ` ${t('Container chưa được cấp quyền vào ổ NAS nên chưa đổi được ở đây. Hãy dùng docker-compose.yml bản mới (có dòng /volume1:/volume1) rồi build lại Project.')}`));
  }

  function renderStorage() {
    const s = sys.storage;
    const other = Math.max(0, s.disk_used - s.recordings);
    const pct = v => `${(v / s.disk_total * 100).toFixed(2)}%`;
    const names = Object.fromEntries(store.cameras.map(c => [c.id, c.name]));
    const perCam = Object.entries(s.per_camera).sort((a, b) => b[1] - a[1]);
    storageCard.replaceChildren(
      h('h2', icon('disk', 20), t('Dung lượng ổ cứng')),
      h('div.usage-bar',
        h('span.u-rec', { style: { width: pct(s.recordings) }, title: t('Bản ghi camera: {size}', { size: fmtBytes(s.recordings) }) }),
        h('span.u-other', { style: { width: pct(other) }, title: t('Dữ liệu khác: {size}', { size: fmtBytes(other) }) })),
      h('div.usage-legend',
        h('span', h('i.u-rec'), t('Bản ghi: {size}', { size: fmtBytes(s.recordings) })),
        h('span', h('i.u-other'), t('Dữ liệu khác: {size}', { size: fmtBytes(other) })),
        h('span', h('i.u-free'), t('Còn trống: {free} / {total}', { free: fmtBytes(s.disk_free), total: fmtBytes(s.disk_total) }))),
      h('dl.stats',
        h('dt', t('Bản ghi cũ nhất')), h('dd', s.oldest_day ? dayLabel(s.oldest_day) : t('Chưa có')),
        h('dt', t('Trung bình mỗi ngày')), h('dd', s.avg_daily ? fmtBytes(s.avg_daily) : t('Chưa đủ dữ liệu')),
        h('dt', t('Ước tính lưu được')), h('dd', s.est_days ? t('khoảng {n} ngày', { n: Math.floor(s.est_days) }) : '-')),
      perCam.length ? h('div.per-cam', perCam.map(([id, size]) =>
        h('div.per-cam-row', h('span', names[id] || t('{id} (đã xoá)', { id })), h('span.muted', fmtBytes(size))))) : null);
    renderRetention();
  }

  function renderRetention() {
    const st = sys.settings;
    const f = {
      retention_days: h('input', { type: 'number', min: 0, max: 3650, value: st.retention_days }),
      max_storage_gb: h('input', { type: 'number', min: 0, value: st.max_storage_gb }),
      min_free_gb: h('input', { type: 'number', min: 0, value: st.min_free_gb }),
      segment_minutes: h('input', { type: 'number', min: 1, max: 60, value: st.segment_minutes }),
    };
    const save = button(t('Lưu cài đặt'), 'check', { type: 'submit', class: 'primary' });
    retentionCard.replaceChildren(
      h('h2', icon('history', 20), t('Lưu trữ bản ghi')),
      h('form.form', {
        onsubmit: async e => {
          e.preventDefault();
          const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, Number(el.value) || 0]));
          if (body.segment_minutes < 1) body.segment_minutes = 1;
          save.disabled = true;
          try {
            await api('/api/settings', { method: 'PUT', body });
            toast(t('Đã lưu cài đặt lưu trữ'), 'ok');
            load();
          } catch (ex) {
            toast(ex.message, 'error');
          } finally {
            save.disabled = false;
          }
        },
      },
      field(t('Giữ bản ghi trong (ngày)'), f.retention_days, t('Bản ghi cũ hơn sẽ tự xoá. 0 = giữ đến khi ổ gần đầy.')),
      field(t('Dung lượng tối đa cho bản ghi (GB)'), f.max_storage_gb, t('0 = không giới hạn. Ổ của bạn: {size}.', { size: fmtBytes(sys.storage.disk_total) })),
      field(t('Luôn chừa trống ổ cứng ít nhất (GB)'), f.min_free_gb, t('Khi ổ còn trống ít hơn mức này, bản ghi cũ nhất sẽ bị xoá để nhường chỗ.')),
      field(t('Độ dài mỗi file ghi (phút)'), f.segment_minutes, t('File ngắn thì mất ít dữ liệu hơn khi mất điện; mặc định 5 phút.')),
      save));
    const ref = sys.storage.avg_daily;
    if (ref) {
      retentionCard.append(h('p.hint', icon('info', 16),
        ` ${t('Với tốc độ ghi hiện tại (~{size}/ngày), 1 TB lưu được khoảng {days} ngày.', { size: fmtBytes(ref), days: Math.floor(1024 * GB / ref) })}`));
    }
  }

  function field(label, input, hint) {
    return h('label.field', h('span', label), input, hint ? h('small.muted', hint) : null);
  }

  // mật khẩu
  const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const pw1 = h('input', { type: 'password', autocomplete: 'new-password', minLength: 6, required: true });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password', minLength: 6, required: true });
  passwordCard.append(
    h('h2', icon('lock', 20), t('Đổi mật khẩu')),
    h('form.form', {
      onsubmit: async e => {
        e.preventDefault();
        if (pw1.value !== pw2.value) return toast(t('Hai lần nhập mật khẩu mới không khớp'), 'error');
        try {
          await api('/api/password', { method: 'POST', body: { current: cur.value, new: pw1.value } });
          toast(t('Đã đổi mật khẩu'), 'ok');
          cur.value = pw1.value = pw2.value = '';
          load();
        } catch (ex) {
          toast(ex.message, 'error');
        }
      },
    },
    field(t('Mật khẩu hiện tại'), cur),
    field(t('Mật khẩu mới (ít nhất 6 ký tự)'), pw1),
    field(t('Nhập lại mật khẩu mới'), pw2),
    button(t('Đổi mật khẩu'), 'lock', { type: 'submit', class: 'primary' })));

  function renderSystem() {
    systemCard.replaceChildren(
      h('h2', icon('server', 20), t('Hệ thống')),
      sys.default_password ? h('p.warn', icon('alert', 16), ` ${t('Đang dùng mật khẩu mặc định "admin", hãy đổi ngay.')}`) : null,
      h('dl.stats',
        h('dt', t('Phiên bản')), h('dd', `CamNAS ${sys.version}`),
        h('dt', t('Đã chạy')), h('dd', fmtDuration(sys.uptime)),
        h('dt', t('Dịch vụ xem trực tiếp')), h('dd', sys.go2rtc ? h('span.ok', t('Đang chạy')) : h('span.err', t('Không chạy'))),
        h('dt', t('Camera')), h('dd', t('{n} camera, {rec} đang ghi', {
          n: store.cameras.length,
          rec: store.cameras.filter(c => c.status.state === 'recording').length,
        })),
        h('dt', t('Ngôn ngữ')), h('dd', h('select', { onchange: e => setLang(e.target.value) },
          Object.entries(LANGS).map(([code, name]) => h('option', { value: code, selected: code === lang }, name))))));
  }

  load();
  return { unmount() {} };
}

// Hộp thoại duyệt thư mục trên NAS để chọn chỗ lưu bản ghi
async function pickFolder(start) {
  let current = '';
  const pathText = h('div.dir-path');
  const list = h('div.dir-list');
  const newName = h('input', { type: 'text', placeholder: t('ví dụ: camera'), spellcheck: false });

  async function open(path) {
    let r;
    try {
      r = await api(`/api/fs/dirs?path=${encodeURIComponent(path)}`);
    } catch (e) {
      if (path) return open('');
      list.replaceChildren(h('p.err', e.message));
      return;
    }
    current = r.path;
    pathText.textContent = r.path || t('Chọn ổ đĩa');
    list.replaceChildren(...[
      r.parent !== null && h('button.dir-item.up', { type: 'button', onclick: () => open(r.parent) }, icon('left', 16), t('Lên thư mục trên')),
      ...r.dirs.map(d => h('button.dir-item', { type: 'button', onclick: () => open(d.path) }, icon('folder', 18), d.name)),
      !r.dirs.length && h('p.muted.dir-empty', t('Không có thư mục con')),
    ].filter(Boolean));
  }

  open(start || '');
  return modal(t('Chọn thư mục lưu bản ghi'), h('div',
    pathText,
    list,
    h('label.field.new-dir', h('span', t('Tạo thư mục con mới bên trong (không bắt buộc)')), newName)), [
    { label: t('Huỷ'), value: null },
    {
      label: t('Chọn thư mục này'),
      primary: true,
      onClick: () => {
        if (!current) {
          toast(t('Hãy mở một ổ đĩa hoặc thư mục trước'), 'error');
          return false;
        }
        const name = newName.value.trim();
        if (/[\\/]/.test(name)) {
          toast(t('Tên thư mục mới không được chứa dấu / hoặc \\'), 'error');
          return false;
        }
        const sep = current.includes('\\') && !current.includes('/') ? '\\' : '/'; // '\\' khi chạy thử trên Windows
        return name ? current.replace(/[\\/]+$/, '') + sep + name : current;
      },
    },
  ]);
}
