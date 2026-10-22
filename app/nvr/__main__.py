import asyncio
import logging

import uvicorn

from .config import HTTP_PORT


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    config = uvicorn.Config("nvr.server:app", host="0.0.0.0", port=HTTP_PORT, log_level="warning", proxy_headers=True)
    # asyncio.run dùng vòng lặp mặc định (trên Windows là Proactor) để chạy được tiến trình con ffmpeg/go2rtc
    asyncio.run(uvicorn.Server(config).serve())


if __name__ == "__main__":
    main()
