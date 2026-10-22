# CamNAS: ghi hình camera 24/7 trên NAS Synology, không cần license

[English](README.md) | **Tiếng Việt**

CamNAS là phần mềm ghi hình (NVR) miễn phí, chạy trong Docker trên NAS. Bản ghi được lưu thẳng vào ổ NAS, giao diện web tương tự Surveillance Station, và **không cần mua license camera**. Surveillance Station thường chỉ kèm 2 license camera miễn phí; CamNAS ghi bao nhiêu camera cũng được.

> CamNAS là dự án độc lập, không liên kết, không được Synology Inc. chứng nhận hay tài trợ. Synology, DSM, Surveillance Station và Package Center là nhãn hiệu của Synology Inc.; các tên này chỉ được nhắc tới để mô tả khả năng tương thích. Xem mục [Nhãn hiệu](#nhãn-hiệu).

![Xem trực tiếp](docs/screenshots/live.jpg)

| Xem lại theo dòng thời gian | Quản lý camera |
|---|---|
| ![Xem lại](docs/screenshots/playback.jpg) | ![Camera](docs/screenshots/cameras.jpg) |

## Tính năng

- **Trực tiếp**: xem nhiều camera dạng lưới (1, 1 lớn + 2 nhỏ, 2×2, 3×3), độ trễ khoảng 1 giây. Chọn chất lượng **Tự động / HD / SD**. Bấm đúp vào một camera để phóng to. Có chụp ảnh, toàn màn hình, bật/tắt tiếng.
- **Xem lại**: dòng thời gian 24 giờ, mỗi camera một hàng. Có thể kéo, cuộn chuột để phóng to, bấm vào một thời điểm để phát. Các đoạn tự phát nối tiếp nhau. Tua 0.5× đến 16×. Đánh dấu đầu/cuối để **xuất clip mp4**.
- **Camera**: thêm, sửa, xoá, bật/tắt ghi hình, kiểm tra kết nối. Có mẫu sẵn cho EZVIZ/Hikvision, Imou/Dahua, TP-Link Tapo, hoặc nhập địa chỉ RTSP bất kỳ.
- **Tự dọn ổ cứng**: xoá bản ghi quá hạn N ngày, hoặc xoá bản ghi cũ nhất khi ổ sắp đầy.
- **Chọn thư mục lưu** ngay trên giao diện, có ô duyệt thư mục trên NAS.
- **Nhật ký**: ghi lại lúc camera mất kết nối, kết nối lại, lúc xoá bản ghi và lúc đăng nhập sai.
- Dùng được trên điện thoại.
- **Có sẵn HTTPS** bằng chính chứng chỉ của NAS ở cổng 8443, để xem từ xa an toàn.
- Hai ngôn ngữ **Tiếng Việt / English**: bấm nút `VI | EN` trên thanh trên cùng hoặc ở màn hình đăng nhập.

Cách hoạt động: [go2rtc](https://github.com/AlexxIT/go2rtc) giữ **một** kết nối RTSP tới mỗi camera. `ffmpeg` sao chép nguyên luồng video (không mã hoá lại nên gần như không tốn CPU) và cắt thành file mp4 theo giờ đồng hồ. Trình duyệt xem trực tiếp qua cùng luồng đó.

```
<thư mục lưu>/<mã-camera>/2026-10-21/14-35-00.mp4
```

File là mp4 thông thường, có thể mở bằng VLC hoặc File Station mà không cần CamNAS.

## Yêu cầu

- NAS Synology có **Container Manager** (DSM 7.2 trở lên, đa số model "+" và một số model ARM64). Gói `.spk` cần DSM 7.2.1 trở lên và sẽ cài kèm **Web Station** (dùng cho HTTPS). Các NAS hoặc máy Linux khác có Docker cũng chạy được (dùng cách cài docker-compose).
- Camera có **RTSP**. Camera EZVIZ đã chạy được với Surveillance Station thì chắc chắn đã có RTSP.
- Camera nên được đặt **IP cố định**: trong router hoặc modem đang cấp IP cho camera, giữ IP (DHCP reservation) theo địa chỉ MAC của từng camera.

## Cài bằng gói .spk (khuyên dùng)

Giống hệt Surveillance Station: cài từ Package Center, mở từ menu chính của DSM, bật/tắt và cập nhật ngay trong Package Center. Phía sau, gói vẫn chạy CamNAS bằng Container Manager.

Yêu cầu: **DSM 7.2.1 trở lên** và đã cài **Container Manager**.

1. Tải file `CamNAS-x.y.z-NNNN.spk` mới nhất ở mục [Releases](https://github.com/tvPhi/CamNAS/releases).
2. **Package Center → Settings → General → Trust Level** → chọn **Any publisher** (bất kỳ nhà phát hành nào). Gói chưa được Synology ký nên nếu không chọn mục này, Package Center sẽ từ chối cài.
3. **Package Center → Manual Install** (cài đặt thủ công), chọn file `.spk` và làm theo trình hướng dẫn. Lần cài đầu sẽ tải image CamNAS về, mất khoảng một phút.
4. Mở **CamNAS** từ menu chính của DSM (hoặc `http://IP-NAS:8090`), đăng nhập bằng `admin` rồi đổi mật khẩu trong *Cài đặt*.

Cần biết:
- Bản ghi được lưu vào thư mục chia sẻ **camnas** do gói tự tạo trên volume1, giống cách Surveillance Station tạo thư mục `surveillance`. Gỡ gói không xoá thư mục này. Có thể chọn thư mục khác trong *Cài đặt → Thư mục lưu bản ghi*. Gói chạy bằng tài khoản hệ thống **CamNAS** của DSM chứ không phải root, nên muốn lưu vào thư mục chia sẻ khác thì cần cấp quyền trước: *Control Panel → Shared Folder → (thư mục) → Edit → Permissions → System internal user → CamNAS → Read/Write*.
- Cấu hình camera và nhật ký nằm trong thư mục riêng của gói và được giữ nguyên khi nâng cấp. Package Center cập nhật CamNAS được bằng một cú bấm, xem mục [Cập nhật](#cập-nhật--sao-lưu).
- Múi giờ tự lấy theo NAS.
- NAS không tải được image từ GitHub? Dùng file `-build-on-nas.spk`: gói sẽ tự build image ngay trên NAS (mất vài phút).
- Gói dùng cổng **8090** (HTTP). Muốn xem từ xa bằng HTTPS thì dùng Reverse Proxy của DSM (xem mục [Xem từ xa](#xem-từ-xa-ngoài-mạng-nhà)). Hãy dừng bản CamNAS cài theo cách khác trước khi cài gói (xem mục ngay dưới).

### Chuyển từ bản cài bằng docker-compose sang gói

1. Trong CamNAS đang chạy, vào *Cài đặt → Sao lưu & khôi phục → Tải bản sao lưu*. Nếu bản đang chạy cũ hơn 1.4.0 (chưa có nút này), dùng File Station tải file `data/config.json` trong thư mục dự án về máy.
2. *Container Manager → Project → camnas → Stop*, rồi *Delete*. Thao tác này chỉ xoá container; bản ghi vẫn nằm nguyên chỗ cũ.
3. Cài gói như hướng dẫn ở trên.
4. Trong CamNAS mới, vào *Cài đặt → Sao lưu & khôi phục → Khôi phục từ file…* và chọn file sao lưu. Camera, cài đặt và mật khẩu được lấy lại, và CamNAS tiếp tục ghi vào thư mục bản ghi cũ nên dòng thời gian vẫn đủ bản ghi cũ. Muốn dồn bản ghi về thư mục chia sẻ `camnas`, chọn nó trong *Cài đặt → Thư mục lưu bản ghi*; trên cùng volume thì việc chuyển diễn ra ngay lập tức. Nếu bản sao lưu lấy từ phiên bản cũ hơn 1.3.1 và không thấy bản ghi cũ, hãy chọn lại thư mục bản ghi cũ trong *Cài đặt → Thư mục lưu bản ghi*.

## Cài bằng Container Manager (docker-compose)

1. **Tải mã nguồn** (*Code → Download ZIP* trên GitHub, hoặc `git clone`) rồi chép lên NAS, ví dụ vào `/volume1/docker/camnas`. Có thể dùng File Station hoặc ổ mạng SMB. Sau khi chép xong, thư mục có dạng:
   ```
   camnas/
     docker-compose.yml
     app/   (Dockerfile, requirements.txt, nvr/...)
     data/  (cấu hình - CamNAS tự ghi vào đây)
   ```
   **Không cần tự tạo thư mục nào.**
2. **Container Manager → Project → Create**:
   - Project name: `camnas`
   - Path: `/volume1/docker/camnas`
   - Source: *Use existing docker-compose.yml*
   - Bấm *Next*, rồi *Done*. Lần đầu NAS sẽ build image, mất vài phút.
3. Mở **http://IP-của-NAS:8090** và đăng nhập bằng mật khẩu `admin`. Sau đó **đổi mật khẩu** ngay trong *Cài đặt*.
4. **Thư mục lưu bản ghi**: lần chạy đầu, bản ghi được lưu vào `/volume1/docker/camnas/recordings`. Muốn đổi, vào **Cài đặt → Thư mục lưu bản ghi**, bấm **Chọn…** để duyệt thư mục trên NAS, hoặc gõ đường dẫn như `/volume1/camera`.
   - Thư mục nên nằm trong một **thư mục chia sẻ** có sẵn trong DSM thì mới xem được bằng File Station.
   - Đổi sang thư mục khác trên cùng volume thì bản ghi cũ được chuyển theo ngay.
   - Không nên bật Snapshot cho thư mục lưu: snapshot giữ lại dữ liệu đã xoá nên ổ không được giải phóng.
5. Vào **Camera → Thêm camera**, chọn hãng, rồi nhập IP, tên đăng nhập, mật khẩu. Ví dụ với **EZVIZ**: tên đăng nhập `admin`, mật khẩu là **mã xác minh** (6 chữ in hoa trên nhãn dưới đáy camera). Bấm **Kiểm tra kết nối**. Nếu thấy độ phân giải hiện ra là đúng, bấm **Thêm camera**. Chỉ vài giây sau, camera bắt đầu ghi.

   ![Hộp thoại thêm camera với mẫu EZVIZ](docs/screenshots/add-camera.jpg)

> Nếu đang dùng Surveillance Station, hãy tắt nó hoặc xoá camera khỏi Surveillance Station khi CamNAS chạy ổn. Nhiều camera (nhất là EZVIZ) giới hạn số luồng RTSP đồng thời, nên hai phần mềm cùng kết nối dễ gây rớt hình.

Nếu NAS không ở múi giờ Việt Nam, đổi dòng `TZ: Asia/Ho_Chi_Minh` trong `docker-compose.yml` cho đúng nơi bạn ở.

### Cài bằng dòng lệnh (SSH)

```bash
cd /volume1/docker/camnas && sudo docker compose up -d --build
```

### Quyền truy cập ổ đĩa

Để chọn được thư mục lưu ngay trong giao diện, container được gắn cả `/volume1`. CamNAS chỉ ghi vào thư mục lưu bạn chọn. Nó chỉ tự dọn những thư mục camera do chính nó tạo (có file `.camnas` bên trong), không đụng tới dữ liệu khác trên NAS.

- **Muốn giới hạn chặt hơn**: thay dòng `/volume1:/volume1` trong `docker-compose.yml` bằng một thư mục chia sẻ cụ thể, ví dụ `/volume1/camera:/volume1/camera`. Khi đó chỉ chọn được thư mục bên trong thư mục đó.
- **NAS có nhiều volume**: bỏ dấu `#` ở dòng `/volume2:/volume2`.

## Địa chỉ RTSP theo hãng

| Hãng | Luồng chính | Luồng phụ |
|---|---|---|
| EZVIZ / Hikvision | `rtsp://admin:MÃXÁCMINH@IP:554/h264/ch1/main/av_stream` | `.../h264/ch1/sub/av_stream` |
| Imou / Dahua | `rtsp://admin:MẬTKHẨU@IP:554/cam/realmonitor?channel=1&subtype=0` | `...subtype=1` |
| TP-Link Tapo | `rtsp://TÊN:MẬTKHẨU@IP:554/stream1` | `.../stream2` |

Chọn hãng trong hộp thoại thêm camera thì CamNAS tự tạo các địa chỉ này.

**Lưu ý với EZVIZ**:
- **Mã hoá hình ảnh (Image/Video Encryption)** trong app EZVIZ phải **tắt**. Nếu bật, phần mềm khác không giải mã được hình.
- Nếu *Kiểm tra kết nối* báo **"Camera từ chối kết nối"**, có thể RTSP đang tắt. Cách bật: cho điện thoại bắt cùng wifi với camera, mở app EZVIZ, vào *Tôi → Cài đặt → LAN Live View*, chọn camera, đăng nhập bằng `admin` + mã xác minh, rồi vào *Cài đặt → Local Service Settings → RTSP*. Tên menu có thể khác một chút tuỳ phiên bản app.
- Nếu camera đang nén **H.265**: CamNAS vẫn ghi bình thường, nhưng một số trình duyệt không phát được, như Firefox hoặc Chrome trên máy không có giải mã phần cứng. Nếu gặp lỗi đó, hãy chuyển camera sang **H.264**.
- Nên điền **luồng phụ**: ô nhỏ trong lưới dùng luồng nhẹ hơn, đỡ tốn băng thông wifi. Bản ghi luôn dùng luồng chính.

## Dung lượng lưu trữ

Ước tính với 3 camera:

| Độ phân giải camera | Mỗi camera/ngày | 3 camera/ngày | Ổ 12 TB lưu được |
|---|---|---|---|
| 1080p (~2 Mbps) | ~21 GB | ~65 GB | ~5–6 tháng |
| 2K/3MP (~3–4 Mbps) | ~35–45 GB | ~105–130 GB | ~3 tháng |

Trong **Cài đặt** bạn có thể chỉnh:
- **Giữ bản ghi trong N ngày**: mặc định 30. Đặt `0` để giữ đến khi ổ gần đầy.
- **Dung lượng tối đa cho bản ghi**: nên đặt nếu ổ còn chứa dữ liệu khác.
- **Luôn chừa trống ít nhất X GB**: mặc định 50 GB. Khi ổ trống ít hơn mức này, file cũ nhất sẽ bị xoá. Bản ghi trong 24 giờ gần nhất không bao giờ bị xoá vì lý do thiếu chỗ.

Trang Cài đặt cũng hiển thị dung lượng trung bình mỗi ngày và số ngày ước tính lưu được.

## Xem từ xa (ngoài mạng nhà)

**Đừng** mở cổng HTTP 8090 thẳng ra Internet. Các cách an toàn:
- **Cài bằng gói .spk: dùng Web Station.** Gói không chạy bằng root nên không đọc được khoá riêng của chứng chỉ DSM; DSM sẽ lo phần HTTPS và tự gia hạn chứng chỉ. Gói tự đăng ký dịch vụ **CamNAS** trong Web Station (được cài kèm theo gói), có sẵn WebSocket.
  1. *Web Station → Web Portal → Create → Package service portal*, chọn **CamNAS**, chọn *Port-based* với HTTPS port **8443** (hoặc *Name-based* với tên miền riêng) rồi bấm *Create*. Chứng chỉ chọn trong *Control Panel → Security → Certificate → Settings*.
  2. Trên router mở cổng TCP **8443** trỏ về NAS (NAS nằm sau hai router thì mở ở cả hai), và xoá luật mở cổng 8090 nếu có.
  3. Nhập `https://tên-miền-của-bạn:8443` vào *Cài đặt → Truy cập từ xa (HTTPS)*. Từ đó mở CamNAS bằng `http://tên-miền-của-bạn:8090`, ví dụ từ menu chính của DSM, sẽ tự chuyển sang HTTPS.
  - Không dùng Web Station: *Control Panel → Login Portal → Advanced → Reverse Proxy → Create*, nguồn **HTTPS** cổng **8443**, đích **HTTP** `localhost` cổng **8090**, và thêm *Custom Header → Create → WebSocket*.
- **Cài bằng docker-compose: HTTPS có sẵn trong CamNAS.** Container chạy bằng root nên CamNAS mở thêm cổng **8443** dùng chính chứng chỉ của NAS (ví dụ Let's Encrypt trong *Control Panel → Security → Certificate*). Mở cổng TCP **8443** trỏ về NAS rồi vào `https://tên-miền-của-bạn:8443`. Muốn dùng chứng chỉ khác thì chọn trong *Cài đặt → Truy cập HTTPS*. Khi DSM gia hạn chứng chỉ, CamNAS tự nạp chứng chỉ mới.
- **Tailscale** (có trong Package Center): cài trên NAS và điện thoại, rồi mở `http://<IP-Tailscale-của-NAS>:8090`. Không cần mở cổng nào.

## Phím tắt

| Trang | Phím |
|---|---|
| Trực tiếp | `1`–`9`: phóng to camera tương ứng · `←`/`→`: chuyển camera · `Esc`: về lưới |
| Xem lại | `Space`: phát/dừng · `←`/`→`: lùi/tới 10 giây (`Shift` để nhảy 1 phút) · `PageUp`/`PageDown`: đoạn trước/sau · `[` `]`: đánh dấu đầu/cuối clip · `+`/`-`: phóng to/thu nhỏ dòng thời gian · `M`: tắt tiếng |

## Cập nhật / sao lưu

- **Dùng docker-compose**: tải bản mới rồi chép đè thư mục `app/`. **Giữ nguyên thư mục `data/`**. Chỉ chép `docker-compose.yml` khi bản mới có thay đổi file này, và nhớ giữ lại những chỗ bạn đã tự sửa. Trong *Container Manager → Project → camnas*, bấm *Stop*, rồi *Action → Build*. Chỉ bấm *Start* thì NAS vẫn chạy bản cũ đã build trước đó. Hoặc chạy lại lệnh `docker compose up -d --build`. *Cài đặt → Cập nhật* sẽ báo khi có bản mới. Sau khi cập nhật, bấm Ctrl+F5 trên trình duyệt rồi xem số phiên bản ở *Cài đặt → Hệ thống*.
- **Dùng gói .spk**: Package Center cập nhật CamNAS như mọi gói khác. Chỉ cần thiết lập một lần: *Package Center → Settings → Package Sources → Add*, Name `CamNAS`, Location `http://127.0.0.1:8090/pkgsrc`. CamNAS kiểm tra bản mới mỗi 6 giờ (hoặc ngay lập tức bằng *Cài đặt → Cập nhật → Kiểm tra ngay*) và báo khi có bản mới; Package Center sẽ hiện nút **Update**. Cấu hình camera và bản ghi được giữ nguyên. Tính năng này cần CamNAS 1.4.0 trở lên, nên cần cài bản đó một lần bằng *Manual Install*. Vẫn có thể *Manual Install* bằng file `.spk` mới hơn như trước.
- Bản mới được đọc từ package image công khai trên ghcr.io, cũng là nơi NAS tải image về, và CamNAS tự phát file `.spk` cho Package Center (Package Center tải file xong rồi mới dừng CamNAS để nâng cấp). Không cần tài khoản hay token GitHub. Đánh dấu *Báo cả bản thử nghiệm* trong *Cài đặt → Cập nhật* để nhận cả bản pre-release.
- **Sao lưu cấu hình**: *Cài đặt → Sao lưu & khôi phục → Tải bản sao lưu* lưu danh sách camera, cài đặt và mật khẩu vào một file; *Khôi phục từ file…* đưa chúng trở lại trên NAS này hoặc NAS khác. Với cách cài docker-compose, thư mục `data/` chứa `config.json` (danh sách camera, **mật khẩu camera**, thư mục lưu đã chọn) và nhật ký. Hãy giữ thư mục này cẩn thận và đừng chia sẻ nó.

## Xử lý sự cố

- Xem trang **Nhật ký** trong ứng dụng trước. Mọi lỗi kết nối camera đều được ghi ở đó.
- **Project không chạy, báo `Bind mount failed: '/volume1/...' does not exist`**: bạn đang dùng `docker-compose.yml` bản cũ. Hãy chép bản mới đè lên; bản mới chỉ gắn thư mục dự án và `/volume1`, là những chỗ luôn có sẵn.
- **Nhật ký báo "Thư mục lưu bản ghi ... chưa dùng được"**: vào *Cài đặt → Thư mục lưu bản ghi* và chọn một thư mục khác.
- **Camera báo "Không lấy được hình"**: kiểm tra IP camera có đổi không, mật khẩu có đúng không, và mục mã hoá hình ảnh (EZVIZ) đã tắt chưa. Dùng nút *Kiểm tra kết nối* trong trang sửa camera.
- **Xem lại bị trắng / không phát**: thường do camera dùng H.265 (xem mục EZVIZ ở trên).
- **Không xem được trực tiếp nhưng vẫn ghi bình thường**: thử trình duyệt Chrome/Edge/Safari bản mới.
- **Camera và NAS ở hai mạng khác nhau** (ví dụ camera bắt wifi modem nhà mạng, NAS cắm sau một router khác): NAS vẫn kết nối được tới camera, miễn là hai mạng khác dải địa chỉ.
- Xem log của container: *Container Manager → Container → camnas → Log*, hoặc chạy `sudo docker logs camnas`.

## Chạy thử trên máy tính (dành cho lập trình)

Cần Python 3.11+, `ffmpeg`/`ffprobe` và file chạy `go2rtc` ([tải tại đây](https://github.com/AlexxIT/go2rtc/releases)).

```bash
cd app && pip install -r requirements.txt && DATA_DIR=./_data RECORDINGS_DIR=./_rec GO2RTC_BIN=/đường/dẫn/go2rtc python -m nvr
```

Ứng dụng sẽ chạy ở http://localhost:8080. Các biến môi trường khác có thể đặt: `FFMPEG`, `FFPROBE`, `HTTP_PORT`, `ADMIN_PASSWORD`, và `STORAGE_ROOTS` (các thư mục gốc được phép chọn làm chỗ lưu, ngăn cách bằng `:`; trên Windows dùng `;`).

Bản dịch giao diện nằm trong `app/nvr/web/i18n.js`, bản dịch thông báo phía máy chủ nằm trong `app/nvr/i18n.py`.

## Phát hành bản mới (dành cho người duy trì)

1. Tăng `__version__` trong `app/nvr/__init__.py` rồi commit.
2. Gắn tag và đẩy lên: `git tag v1.4.0 && git push origin v1.4.0`. Tag có hậu tố như `v1.4.0-rc1` sẽ là bản thử nghiệm (pre-release).

GitHub Actions ([release.yml](.github/workflows/release.yml)) sẽ dựng image `ghcr.io/tvphi/camnas` cho amd64 và arm64, rồi đính kèm hai file `.spk` vào bản phát hành trên GitHub. Các file `.spk` cũng được đẩy lên cùng package với tag `<phiên bản>-spk`, là nơi CamNAS tìm bản mới. Package image phải để **Public** (*Package settings → Change visibility*); kho mã thì để riêng tư cũng được. Muốn tự dựng gói trên máy: `python spk/build.py` (NAS tự build image) hoặc `python spk/build.py --image ghcr.io/tvphi/camnas` (dùng image đã phát hành); file nằm trong thư mục `dist/`.

## Ghi công và giấy phép

- [go2rtc](https://github.com/AlexxIT/go2rtc) (MIT): nhận luồng camera và phát trực tiếp lên trình duyệt. Image Docker của CamNAS được dựng trên image chính thức của go2rtc.
- [FFmpeg](https://ffmpeg.org): ghi và cắt file video.
- CamNAS phát hành theo giấy phép [MIT](LICENSE).

### Nhãn hiệu

Synology, DSM, Surveillance Station, Package Center, Container Manager và Web Station là nhãn hiệu hoặc nhãn hiệu đã đăng ký của Synology Inc. EZVIZ và các hãng camera khác được nhắc tới là nhãn hiệu của chủ sở hữu tương ứng. CamNAS là dự án độc lập, không liên kết, không được các công ty này chứng nhận hay tài trợ; tên của họ chỉ dùng để mô tả khả năng tương thích. CamNAS không chứa mã nguồn, logo hay hình ảnh nào của Synology.
