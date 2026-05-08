from __future__ import annotations

from urllib.parse import urlparse

import requests
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

REQUEST_TIMEOUT = 20
ALLOWED_IMAGE_HOSTS = {
    "cms-assets.youmind.com",
    "raw.githubusercontent.com",
}
FORWARDED_RESPONSE_HEADERS = (
    "Content-Type",
    "Content-Length",
    "ETag",
    "Last-Modified",
)


def create_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/image-proxy")
    async def proxy_image(
        url: str = Query(..., min_length=1),
    ):
        parsed = urlparse(url.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise HTTPException(status_code=400, detail="图片地址无效")
        if parsed.hostname not in ALLOWED_IMAGE_HOSTS:
            raise HTTPException(status_code=403, detail="该图片来源未被允许")

        try:
            upstream = requests.get(
                parsed.geturl(),
                stream=True,
                timeout=REQUEST_TIMEOUT,
                headers={
                    "User-Agent": "chatgpt2api image proxy",
                    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                },
            )
            upstream.raise_for_status()
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail="拉取远程图片失败") from exc

        headers = {
            key: value
            for key, value in upstream.headers.items()
            if key in FORWARDED_RESPONSE_HEADERS and value
        }
        headers["Cache-Control"] = "public, max-age=1800"

        return StreamingResponse(
            upstream.iter_content(chunk_size=64 * 1024),
            status_code=upstream.status_code,
            media_type=upstream.headers.get("Content-Type") or "image/jpeg",
            headers=headers,
        )

    return router
