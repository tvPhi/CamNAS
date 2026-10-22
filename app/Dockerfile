# Ảnh go2rtc chính thức đã có sẵn Python 3.13, ffmpeg và go2rtc - chỉ cần thêm ứng dụng CamNAS.
FROM alexxit/go2rtc:1.9.14

RUN apk add --no-cache tzdata

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY nvr ./nvr

# Múi giờ: đặt biến TZ (docker-compose.yml), hoặc gắn /etc/localtime của NAS vào container (gói .spk)
ENV DATA_DIR=/data \
    RECORDINGS_DIR=/recordings \
    PYTHONUNBUFFERED=1

EXPOSE 8080 8443
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s CMD curl -fs http://127.0.0.1:8080/api/me >/dev/null || exit 1

# ENTRYPOINT của ảnh gốc là tini: chuyển tín hiệu dừng để ffmpeg kịp đóng file đang ghi
CMD ["python", "-m", "nvr"]
