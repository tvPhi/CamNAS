Thư mục cấu hình của CamNAS - ĐỪNG XOÁ.

CamNAS tự tạo và ghi các file sau vào đây:
  config.json   danh sách camera (kèm mật khẩu camera), cài đặt lưu trữ, thư mục lưu đã chọn,
                mật khẩu đăng nhập (đã băm)
  secret.key    khoá ký phiên đăng nhập
  events.jsonl  nhật ký sự kiện
  go2rtc.yaml   cấu hình go2rtc, tạo tự động từ danh sách camera
  tmp/          file tạm khi xuất clip

- Khi cập nhật CamNAS: chỉ chép đè thư mục app/ và docker-compose.yml, giữ nguyên thư mục này.
- Sao lưu cấu hình: chép cả thư mục này ra chỗ khác.
- Thư mục này chứa mật khẩu camera: đừng chia sẻ hay đưa lên GitHub (.gitignore đã chặn sẵn).
- Video ghi hình KHÔNG nằm ở đây mà ở thư mục lưu bản ghi (Cài đặt → Thư mục lưu bản ghi).

(EN) CamNAS config folder - do not delete. It holds the camera list (including camera passwords),
settings, the login signing key and the event log. Keep it when updating, never commit it.
Recordings are stored elsewhere (Settings → Recordings folder).
