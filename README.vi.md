# CamNAS: ghi hình camera 24/7 trên NAS Synology, không cần license

[English](README.md) | **Tiếng Việt**

CamNAS là phần mềm ghi hình (NVR) miễn phí, chạy trong Docker trên NAS. Bản ghi được lưu thẳng vào ổ NAS, giao diện web tương tự Surveillance Station, và **không cần mua license camera**. Surveillance Station thường chỉ kèm 2 license camera miễn phí; CamNAS ghi bao nhiêu camera cũng được.

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
- Hai ngôn ngữ **Tiếng Việt / English**: bấm nút `VI | EN` trên thanh trên cùng hoặc ở màn hình đăng nhập.

Cách hoạt động: [go2rtc](https://github.com/AlexxIT/go2rtc) giữ **một** kết nối RTSP tới mỗi camera. `ffmpeg` sao chép nguyên luồng video (không mã hoá lại nên gần như không tốn CPU) và cắt thành file mp4 theo giờ đồng hồ. Trình duyệt xem trực tiếp qua cùng luồng đó.

```
<thư mục lưu>/<mã-camera>/2026-10-21/14-35-00.mp4
```

File là mp4 thông thường, có thể mở bằng VLC hoặc File Station mà không cần CamNAS.

## Yêu cầu

- NAS Synology có **Container Manager** (DSM 7.2 trở lên, đa số model "+" và một số model ARM64). Các NAS hoặc máy Linux khác có Docker cũng chạy được.
- Camera có **RTSP**. Camera EZVIZ đã chạy được với Surveillance Station thì chắc chắn đã có RTSP.
- Camera nên được đặt **IP cố định**: trong router hoặc modem đang cấp IP cho camera, giữ IP (DHCP reservation) theo địa chỉ MAC của từng camera.

## Cài đặt trên Synology

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

**Đừng** mở cổng 8090 thẳng ra Internet. Có hai cách an toàn:
- **Tailscale** (có trong Package Center): cài trên NAS và điện thoại, rồi mở `http://<IP-Tailscale-của-NAS>:8090`. Đây là cách đơn giản và an toàn nhất.
- **Reverse proxy của DSM** (*Control Panel → Login Portal → Advanced → Reverse Proxy*) kèm chứng chỉ HTTPS Let's Encrypt và tên miền DDNS. Phải bật mục WebSocket (*Custom Header → Create → WebSocket*) để xem trực tiếp hoạt động.

## Phím tắt

| Trang | Phím |
|---|---|
| Trực tiếp | `1`–`9`: phóng to camera tương ứng · `←`/`→`: chuyển camera · `Esc`: về lưới |
| Xem lại | `Space`: phát/dừng · `←`/`→`: lùi/tới 10 giây (`Shift` để nhảy 1 phút) · `PageUp`/`PageDown`: đoạn trước/sau · `[` `]`: đánh dấu đầu/cuối clip · `+`/`-`: phóng to/thu nhỏ dòng thời gian · `M`: tắt tiếng |

## Cập nhật / sao lưu

- **Cập nhật**: tải bản mới rồi chép đè thư mục `app/`. **Giữ nguyên thư mục `data/`**. Chỉ chép `docker-compose.yml` khi bản mới có thay đổi file này, và nhớ giữ lại những chỗ bạn đã tự sửa. Trong *Container Manager → Project → camnas*, bấm *Stop*, rồi *Action → Build*. Chỉ bấm *Start* thì NAS vẫn chạy bản cũ đã build trước đó. Hoặc chạy lại lệnh `docker compose up -d --build`. Sau khi cập nhật, bấm Ctrl+F5 trên trình duyệt rồi xem số phiên bản ở *Cài đặt → Hệ thống*.
- **Sao lưu cấu hình**: thư mục `data/` chứa `config.json` (danh sách camera, **mật khẩu camera**, thư mục lưu đã chọn) và nhật ký. Hãy giữ thư mục này cẩn thận và đừng chia sẻ nó.

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

## Ghi công và giấy phép

- [go2rtc](https://github.com/AlexxIT/go2rtc) (MIT): nhận luồng camera và phát trực tiếp lên trình duyệt. Image Docker của CamNAS được dựng trên image chính thức của go2rtc.
- [FFmpeg](https://ffmpeg.org): ghi và cắt file video.
- CamNAS phát hành theo giấy phép [MIT](LICENSE).

CamNAS không liên quan gì tới Synology, EZVIZ hay các hãng camera được nhắc tới. Các tên này chỉ dùng để mô tả khả năng tương thích.
