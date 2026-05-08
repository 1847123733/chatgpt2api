from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import re
from threading import Lock
from typing import Any
from urllib.parse import parse_qs, quote, urlparse

import requests

README_URL = "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/main/README.md"
REPO_URL = "https://github.com/YouMind-OpenLab/awesome-gpt-image-2"
GITHUB_COVER_URL = "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/main/public/images/gpt-image-2-prompts-cover-en.png"
CACHE_TTL = timedelta(minutes=30)
REQUEST_TIMEOUT = 20
DEFAULT_LIMIT = 120
MAX_LIMIT = 240

ENTRY_PATTERN = re.compile(
    r"### No\. (?P<rank>\d+): (?P<title>.*?)\n(?P<body>.*?)(?=\n---\n\n### No\. |\Z)",
    re.S,
)
DESCRIPTION_PATTERN = re.compile(r"#### 📖 Description\s*\n\s*(?P<value>.*?)(?=\n#### )", re.S)
PROMPT_PATTERN = re.compile(r"#### 📝 Prompt\s*\n\s*```(?:\w+)?\n(?P<value>.*?)\n```", re.S)
IMAGE_PATTERN = re.compile(r'<img src="(?P<url>[^"]+)"[^>]*alt="(?P<alt>[^"]*)"', re.S)
DETAILS_PATTERN = re.compile(r"#### 📌 Details\s*\n(?P<value>.*?)(?=\n\*\*\[👉 Try it now →\]|\n---|\Z)", re.S)
TRY_LINK_PATTERN = re.compile(r"\*\*\[👉 Try it now →\]\((?P<url>[^)]+)\)")
AUTHOR_PATTERN = re.compile(r"- \*\*Author:\*\* (?P<value>.+)")
SOURCE_PATTERN = re.compile(r"- \*\*Source:\*\* (?P<value>.+)")
PUBLISHED_PATTERN = re.compile(r"- \*\*Published:\*\* (?P<value>.+)")
LANGUAGES_PATTERN = re.compile(r"- \*\*Languages:\*\* (?P<value>.+)")
AUTHOR_LINK_PATTERN = re.compile(r"\[(?P<label>.*?)\]\((?P<url>[^)]+)\)")
BADGE_PATTERN = re.compile(r"!\[Language-(?P<language>[^\]]+)\].*?(?P<featured>!\[Featured\])?", re.S)


def _clean(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _strip_markdown_links(value: str) -> str:
    return AUTHOR_LINK_PATTERN.sub(lambda match: match.group("label").strip(), value).strip()


def _parse_markdown_link(value: str) -> dict[str, str] | None:
    matched = AUTHOR_LINK_PATTERN.search(value or "")
    if not matched:
        return None
    return {
        "label": matched.group("label").strip(),
        "url": matched.group("url").strip(),
    }


def _build_item_id(rank: int, title: str, try_link: str, index: int) -> str:
    if try_link:
        try:
            parsed = urlparse(try_link)
            prompt_id = (parse_qs(parsed.query).get("id") or [""])[0].strip()
            if prompt_id:
                return f"awesome-gpt-image-2-{prompt_id}"
        except Exception:
            pass
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return f"awesome-gpt-image-2-{rank}-{slug or index}"


@dataclass
class PromptSquareCache:
    fetched_at: datetime | None = None
    payload: dict[str, Any] | None = None


class PromptSquareService:
    def __init__(self) -> None:
        self._lock = Lock()
        self._cache = PromptSquareCache()

    def list_items(self, *, force_refresh: bool = False, limit: int = DEFAULT_LIMIT) -> dict[str, Any]:
        normalized_limit = max(1, min(MAX_LIMIT, int(limit or DEFAULT_LIMIT)))
        payload = self._get_payload(force_refresh=force_refresh)
        items = list(payload.get("items") or [])
        return {
            **payload,
            "items": items[:normalized_limit],
            "total": len(items),
            "limit": normalized_limit,
        }

    def _get_payload(self, *, force_refresh: bool) -> dict[str, Any]:
        with self._lock:
            now = datetime.now(UTC)
            if (
                not force_refresh
                and self._cache.payload is not None
                and self._cache.fetched_at is not None
                and now - self._cache.fetched_at < CACHE_TTL
            ):
                return self._cache.payload

            markdown = self._fetch_markdown()
            items = self._parse_markdown(markdown)
            payload = {
                "source": {
                    "repo_url": REPO_URL,
                    "readme_url": README_URL,
                    "cover_image_url": GITHUB_COVER_URL,
                },
                "fetched_at": now.isoformat(),
                "items": items,
            }
            self._cache = PromptSquareCache(fetched_at=now, payload=payload)
            return payload

    def _fetch_markdown(self) -> str:
        response = requests.get(
            README_URL,
            timeout=REQUEST_TIMEOUT,
            headers={"User-Agent": "chatgpt2api prompt square"},
        )
        response.raise_for_status()
        response.encoding = response.encoding or "utf-8"
        return response.text

    def _parse_markdown(self, markdown: str) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for index, matched in enumerate(ENTRY_PATTERN.finditer(markdown), start=1):
            rank = int(matched.group("rank"))
            title = _clean(matched.group("title"))
            body = matched.group("body")

            badge_match = BADGE_PATTERN.search(body)
            language = (badge_match.group("language").strip().lower() if badge_match else "") or "unknown"
            featured = "![Featured]" in body
            raycast_friendly = "![Raycast]" in body

            description_match = DESCRIPTION_PATTERN.search(body)
            description = _clean(description_match.group("value")) if description_match else ""

            prompt_match = PROMPT_PATTERN.search(body)
            prompt = (prompt_match.group("value").strip() if prompt_match else "").strip()

            image_urls = [match.group("url").strip() for match in IMAGE_PATTERN.finditer(body) if match.group("url").strip()]
            preview_image = image_urls[0] if image_urls else GITHUB_COVER_URL

            details_match = DETAILS_PATTERN.search(body)
            details = details_match.group("value").strip() if details_match else ""

            author_line = AUTHOR_PATTERN.search(details)
            author_link = _parse_markdown_link(author_line.group("value")) if author_line else None
            source_line = SOURCE_PATTERN.search(details)
            source_link = _parse_markdown_link(source_line.group("value")) if source_line else None
            published_line = PUBLISHED_PATTERN.search(details)
            published_at = _clean(published_line.group("value")) if published_line else ""
            languages_line = LANGUAGES_PATTERN.search(details)
            languages = [item.strip() for item in (languages_line.group("value").split(",") if languages_line else [language]) if item.strip()]

            try_link_match = TRY_LINK_PATTERN.search(body)
            try_link = try_link_match.group("url").strip() if try_link_match else ""
            item_id = _build_item_id(rank, title, try_link, index)

            items.append(
                {
                    "id": item_id,
                    "rank": rank,
                    "title": title,
                    "description": description,
                    "prompt": prompt,
                    "prompt_preview": _clean(prompt.replace("\n", " "))[:240],
                    "language": language,
                    "languages": languages,
                    "featured": featured,
                    "raycast_friendly": raycast_friendly,
                    "preview_image_url": preview_image,
                    "image_urls": image_urls,
                    "author_name": author_link["label"] if author_link else _strip_markdown_links(author_line.group("value")) if author_line else "",
                    "author_url": author_link["url"] if author_link else "",
                    "source_name": source_link["label"] if source_link else _strip_markdown_links(source_line.group("value")) if source_line else "",
                    "source_url": source_link["url"] if source_link else "",
                    "published_at": published_at,
                    "try_link": try_link,
                    "repo_entry_url": f"{REPO_URL}#{quote(title.lower().replace(' ', '-'))}",
                }
            )
        return items


prompt_square_service = PromptSquareService()
