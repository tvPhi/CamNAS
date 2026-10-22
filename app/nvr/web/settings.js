// Trang cài đặt: dung lượng ổ cứng, thời hạn lưu, mật khẩu, thông tin hệ thống.
import { api, h, icon, button, toast, modal, confirmBox, saveFile, fmtBytes, fmtDate, fmtDateTime, fmtDuration, dayLabel } from './util.js';
import { store } from './store.js';
import { t, lang, setLang, LANGS } from './i18n.js';

const GB = 1024 ** 3;

export function SettingsPage(main) {
  const dirCard = h('section.card.wide');
  const storageCard = h('section.card', h('div.tile-spinner.static'));
  const retentionCard = h('section.card');
  const passwordCard = h('section.card');
  const systemCard = h('section.card');
  const backupCard = h('section.card');
  const httpsCard = h('section.card');
  const updatesCard = h('section.card');
  main.append(
    h('div.page-head', h('div', h('h1', t('Cài đặt')), h('p.muted', t('Dung lượng lưu trữ, thời gian giữ bản ghi và bảo mật.')))),
    h('div.settings-grid', dirCard, storageCard, retentionCard, passwordCard, systemCard, updatesCard, httpsCard, backupCard));

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
    loadHttps();
    loadUpdates();
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
        h('div.per-cam-row', h('span', names[id] || t('{id} (đã xoá)', { id })), h('span.muted', fmtBytes(size))))) : '');
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
      sys.default_password ? h('p.warn', icon('alert', 16), ` ${t('Đang dùng mật khẩu mặc định "admin", hãy đổi ngay.')}`) : '',
      h('dl.stats',
        h('dt', t('Phiên bản')), h('dd', `CamNAS ${sys.version}`),
        h('dt', t('Đã chạy')), h('dd', fmtDuration(sys.uptime)),
        h('dt', t('Dịch vụ xem trực tiếp')), h('dd', sys.go2rtc ? h('span.ok', t('Đang chạy')) : h('span.err', t('Không chạy'))),
        sys.process_user ? [h('dt', t('Tài khoản chạy')), h('dd', sys.process_user)] : '',
        h('dt', t('Camera')), h('dd', t('{n} camera, {rec} đang ghi', {
          n: store.cameras.length,
          rec: store.cameras.filter(c => c.status.state === 'recording').length,
        })),
        h('dt', t('Ngôn ngữ')), h('dd', h('select', { onchange: e => setLang(e.target.value) },
          Object.entries(LANGS).map(([code, name]) => h('option', { value: code, selected: code === lang }, name))))));
  }

  // Cập nhật: báo phiên bản mới; gói .spk cập nhật bằng Package Center qua nguồn gói của chính CamNAS
  async function loadUpdates(check = false) {
    let st;
    try {
      st = await api(check ? '/api/updates/check' : '/api/updates', check ? { method: 'POST' } : undefined);
    } catch (e) {
      updatesCard.replaceChildren(h('h2', icon('refresh', 20), t('Cập nhật')), h('p.err', e.message));
      return;
    }
    const pre = h('input', {
      type: 'checkbox',
      checked: st.prerelease,
      onchange: async () => {
        try {
          await api('/api/updates', { method: 'PUT', body: { prerelease: pre.checked } });
          loadUpdates();
        } catch (e) {
          toast(e.message, 'error');
        }
      },
    });
    const checkBtn = button(t('Kiểm tra ngay'), 'refresh', {
      class: 'small',
      onclick: () => {
        checkBtn.disabled = true;
        loadUpdates(true);
      },
    });
    const latest = st.latest;
    const current = st.current_spk ? `${st.current} (${t('gói')} ${st.current_spk})` : st.current;
    const sourceUrl = 'http://127.0.0.1:8090/pkgsrc';
    updatesCard.replaceChildren(
      h('h2', icon('refresh', 20), t('Cập nhật')),
      h('dl.stats',
        h('dt', t('Đang dùng')), h('dd', `CamNAS ${current}`),
        h('dt', t('Mới nhất')), h('dd', latest ? latest.tag : '-'),
        h('dt', t('Kiểm tra lúc')), h('dd', st.checked_at ? fmtDateTime(st.checked_at) : t('Chưa kiểm tra'))),
      st.error ? h('p.err', icon('alert', 16), ' ', st.error)
        : st.update_available ? h('p.warn', icon('info', 16), ' ', t('Đã có phiên bản mới {version}', { version: latest.tag }))
          : latest ? h('p.ok', icon('check', 16), ' ', t('Bạn đang dùng bản mới nhất.'))
            : st.checked_at ? h('p.muted', st.prerelease ? t('Chưa có bản phát hành nào.')
              : t('Chưa có bản chính thức nào. Đánh dấu "Báo cả bản thử nghiệm" để thấy cả bản pre-release.')) : '',
      h('div.form',
        h('label.check', pre, h('span', t('Báo cả bản thử nghiệm (pre-release)'))),
        checkBtn),
      st.install === 'spk'
        ? h('div.hint',
          h('p', icon('info', 16), ' ', t('Cập nhật bằng Package Center (chỉ cần làm một lần): Package Center → Settings → Package Sources → Add, Name: CamNAS, Location:')),
          h('input.mono', { type: 'text', readOnly: true, value: sourceUrl, onfocus: e => e.target.select() }),
          h('p', t('Từ đó Package Center tự báo khi có bản mới và cập nhật bằng nút Update, giống các gói khác.')),
          st.source_seen
            ? h('p.ok', icon('check', 16), ' ', t('Package Center đã đọc nguồn gói lúc {time}.', { time: fmtDateTime(st.source_seen.at) }))
            : h('p.warn', icon('alert', 16), ' ', t('Package Center chưa đọc nguồn gói này kể từ khi CamNAS khởi động. Kiểm tra đã thêm đúng địa chỉ trên, rồi mở Package Center và bấm Refresh.')),
          packageLog())
        : h('p.hint', icon('info', 16), ' ',
          t('Bản cài bằng docker-compose: tải bản mới từ GitHub, chép đè thư mục app/ rồi Build lại Project. Nếu cài bằng gói .spk, Package Center cập nhật được bằng một cú bấm.')));
  }

  // nhật ký cài đặt gói của DSM: xem vì sao cập nhật bằng Package Center hỏng mà không cần SSH
  function packageLog() {
    const pre = h('pre.log', t('Đang tải…'));
    return h('details.pkglog', {
      ontoggle: async e => {
        if (!e.target.open) return;
        try {
          const files = await api('/api/updates/log');
          pre.textContent = files.map(f => `== ${f.name} ==\n${f.error
            ? t('Không đọc được: {error}', { error: f.error })
            : f.lines.join('\n') || t('(trống)')}`).join('\n\n');
        } catch (err) {
          pre.textContent = err.message;
        }
      },
    }, h('summary', t('Nhật ký cài đặt gói của DSM')), pre);
  }

  // HTTPS bằng chứng chỉ có sẵn của NAS: để xem từ xa an toàn mà không cần reverse proxy
  async function loadHttps() {
    let st;
    try {
      st = await api('/api/https');
    } catch (e) {
      httpsCard.replaceChildren(h('h2', icon('lock', 20), t('Truy cập HTTPS')), h('p.err', e.message));
      return;
    }
    if (!st.builtin) return proxyHttps(st);
    const enabled = h('input', { type: 'checkbox', checked: st.enabled });
    const certSel = h('select', {},
      h('option', { value: '' }, t('Chứng chỉ mặc định của NAS')),
      st.certs.map(c => h('option', { value: c.id, selected: c.id === st.cert_id }, certLabel(c))));
    const host = st.names.find(n => !n.startsWith('*')) || location.hostname;
    const url = `https://${host}:${st.port}`;
    const save = button(t('Lưu'), 'check', {
      class: 'primary',
      onclick: async () => {
        save.disabled = true;
        try {
          await api('/api/https', { method: 'PUT', body: { enabled: enabled.checked, cert_id: certSel.value } });
          toast(t('Đã lưu cài đặt HTTPS'), 'ok');
          loadHttps();
        } catch (e) {
          toast(e.message, 'error', 8000);
          save.disabled = false;
        }
      },
    });
    httpsCard.replaceChildren(
      h('h2', icon('lock', 20), t('Truy cập HTTPS')),
      st.running
        ? h('p.ok', icon('check', 16), ` ${t('Đang chạy')}: `, h('a', { href: url, target: '_blank', rel: 'noopener' }, url))
        : st.enabled ? h('p.err', icon('alert', 16), ' ', st.error || t('HTTPS chưa chạy')) : h('p.muted', t('HTTPS đang tắt')),
      st.running && st.names.length
        ? h('small.muted', t('Chứng chỉ: {names} · hết hạn {date}', { names: st.names.join(', '), date: st.expires ? fmtDate(st.expires) : '?' }))
        : '',
      h('div.form',
        h('label.check', enabled, h('span', t('Bật HTTPS bằng chứng chỉ của NAS'))),
        h('label.field', h('span', t('Chứng chỉ')), certSel),
        save),
      h('p.hint', icon('info', 16),
        ` ${t('Xem từ xa: trên router, mở cổng {port} (TCP) trỏ về NAS, rồi vào {url}. Sau đó nên xoá luật mở cổng HTTP 8090.', { port: st.port, url })}`));
  }

  // gói .spk không được đọc khoá chứng chỉ của DSM: HTTPS do Reverse Proxy của DSM đảm nhận
  function proxyHttps(st) {
    const host = /^[\d.]+$|^localhost$|^\[/.test(location.hostname) ? t('tên miền của NAS') : location.hostname;
    const urlInput = h('input', { type: 'text', value: st.public_url, placeholder: 'https://nas.example.com:8443', spellcheck: false });
    const save = button(t('Lưu'), 'check', {
      class: 'primary',
      onclick: async () => {
        save.disabled = true;
        try {
          await api('/api/https', { method: 'PUT', body: { public_url: urlInput.value } });
          toast(t('Đã lưu cài đặt HTTPS'), 'ok');
          loadHttps();
        } catch (e) {
          toast(e.message, 'error', 8000);
          save.disabled = false;
        }
      },
    });
    httpsCard.replaceChildren(
      h('h2', icon('lock', 20), t('Truy cập từ xa (HTTPS)')),
      st.public_url
        ? h('p.ok', icon('check', 16), ` ${t('Địa chỉ HTTPS')}: `, h('a', { href: st.public_url, target: '_blank', rel: 'noopener' }, st.public_url))
        : h('p.muted', t('Chưa thiết lập')),
      h('p.muted', t('Gói CamNAS không được đọc khoá chứng chỉ của DSM, nên HTTPS do Web Station của DSM đảm nhận. DSM tự dùng và tự gia hạn chứng chỉ.')),
      h('ol.steps',
        h('li', t('Web Station → Web Portal → Create → Package service portal, chọn dịch vụ CamNAS.')),
        h('li', t('Chọn Port-based, điền HTTPS port 8443 rồi Create. Chứng chỉ chọn trong Control Panel → Security → Certificate → Settings.')),
        h('li', t('Trên router mở cổng TCP 8443 trỏ về NAS (NAS nằm sau hai router thì mở ở cả hai), và xoá luật mở cổng 8090 nếu có.')),
        h('li', t('Nhập địa chỉ HTTPS vào ô dưới rồi bấm Lưu.'))),
      h('p.muted', t('Không dùng Web Station? Tạo Reverse Proxy trong Control Panel → Login Portal → Advanced: nguồn HTTPS cổng 8443, đích http://localhost:8090, và thêm Custom Header → WebSocket.')),
      h('div.form', h('label.field', h('span', t('Địa chỉ HTTPS')), urlInput), save),
      h('p.hint', icon('info', 16), ` ${t('Đã lưu địa chỉ thì mở CamNAS bằng http://{host}:8090 (ví dụ từ menu DSM) sẽ tự chuyển sang HTTPS.', { host })}`));
  }

  function certLabel(c) {
    const names = c.names.join(', ') || c.id;
    return (c.desc ? `${c.desc} - ` : '') + names + (c.default ? ` (${t('mặc định')})` : '');
  }

  // sao lưu / khôi phục: cũng là cách chuyển cấu hình sang gói .spk hoặc sang NAS khác
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: () => restore() });
  backupCard.append(
    h('h2', icon('download', 20), t('Sao lưu & khôi phục')),
    h('p.muted', t('File sao lưu chứa danh sách camera (kèm mật khẩu camera), cài đặt lưu trữ và mật khẩu đăng nhập. Hãy cất giữ cẩn thận.')),
    h('div.btn-row',
      button(t('Tải bản sao lưu'), 'download', { onclick: () => saveFile('/api/backup', '') }),
      button(t('Khôi phục từ file…'), 'refresh', { onclick: () => fileInput.click() })),
    fileInput);

  async function restore() {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return toast(t('File sao lưu không hợp lệ'), 'error');
    }
    const ok = await confirmBox(t('Khôi phục cấu hình?'),
      t('Toàn bộ camera và cài đặt hiện tại sẽ được thay bằng nội dung file "{name}". Mật khẩu đăng nhập cũng đổi theo bản sao lưu.', { name: file.name }),
      t('Khôi phục'), true);
    if (!ok) return;
    try {
      const r = await api('/api/restore', { method: 'POST', body: data });
      toast(t('Đã khôi phục {n} camera', { n: r.cameras }), 'ok');
      setTimeout(() => location.reload(), r.password_changed ? 1500 : 800);
    } catch (e) {
      toast(e.message, 'error', 8000);
    }
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
