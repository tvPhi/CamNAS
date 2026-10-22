"""Vẽ biểu tượng CamNAS (giống logo trong giao diện) ở các kích thước DSM cần.

Chỉ cần chạy lại khi đổi logo:  pip install pillow && python spk/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).parent / "icons"
SIZES = (16, 24, 32, 48, 64, 72, 256)  # kích thước DSM dùng cho biểu tượng ứng dụng
BIG = 1024
U = BIG / 32  # logo gốc vẽ trên lưới 32×32


def p(x: float, y: float) -> tuple[float, float]:
    return x * U, y * U


def draw() -> Image.Image:
    img = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, BIG - 1, BIG - 1), radius=8 * U, fill="#2563eb")
    d.rounded_rectangle((*p(8, 9), *p(21, 23)), radius=2.5 * U, fill="white")
    d.polygon([p(21, 14), p(25.2, 11.4), p(26, 11.85), p(26, 20.15), p(25.2, 20.6), p(21, 18)], fill="white")
    d.ellipse((*p(12.5 - 1.7, 13.5 - 1.7), *p(12.5 + 1.7, 13.5 + 1.7)), fill="#ef4444")
    return img


def main() -> None:
    OUT.mkdir(exist_ok=True)
    big = draw()
    for size in SIZES:
        big.resize((size, size), Image.LANCZOS).save(OUT / f"camnas_{size}.png", optimize=True)
    print("đã tạo", ", ".join(f"camnas_{s}.png" for s in SIZES))


if __name__ == "__main__":
    main()
