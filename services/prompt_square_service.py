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

CATEGORY_GROUPS: dict[str, list[tuple[str, str]]] = {
    "use_cases": [
        ("profile-avatar", "Profile / Avatar"),
        ("social-media-post", "Social Media Post"),
        ("infographic-edu-visual", "Infographic / Edu Visual"),
        ("youtube-thumbnail", "YouTube Thumbnail"),
        ("comic-storyboard", "Comic / Storyboard"),
        ("product-marketing", "Product Marketing"),
        ("ecommerce-main-image", "E-commerce Main Image"),
        ("game-asset", "Game Asset"),
        ("poster-flyer", "Poster / Flyer"),
        ("app-web-design", "App / Web Design"),
    ],
    "style": [
        ("photography", "Photography"),
        ("cinematic-film-still", "Cinematic / Film Still"),
        ("anime-manga", "Anime / Manga"),
        ("illustration", "Illustration"),
        ("sketch-line-art", "Sketch / Line Art"),
        ("comic-graphic-novel", "Comic / Graphic Novel"),
        ("3d-render", "3D Render"),
        ("chibi-q-style", "Chibi / Q-Style"),
        ("isometric", "Isometric"),
        ("pixel-art", "Pixel Art"),
        ("oil-painting", "Oil Painting"),
        ("watercolor", "Watercolor"),
        ("ink-chinese-style", "Ink / Chinese Style"),
        ("retro-vintage", "Retro / Vintage"),
        ("cyberpunk-sci-fi", "Cyberpunk / Sci-Fi"),
        ("minimalism", "Minimalism"),
    ],
    "subjects": [
        ("portrait-selfie", "Portrait / Selfie"),
        ("influencer-model", "Influencer / Model"),
        ("character", "Character"),
        ("group-couple", "Group / Couple"),
        ("product", "Product"),
        ("food-drink", "Food / Drink"),
        ("fashion-item", "Fashion Item"),
        ("animal-creature", "Animal / Creature"),
        ("vehicle", "Vehicle"),
        ("architecture-interior", "Architecture / Interior"),
        ("landscape-nature", "Landscape / Nature"),
        ("cityscape-street", "Cityscape / Street"),
        ("diagram-chart", "Diagram / Chart"),
        ("text-typography", "Text / Typography"),
        ("abstract-background", "Abstract / Background"),
    ],
}

CATEGORY_LABELS = {
    slug: label
    for categories in CATEGORY_GROUPS.values()
    for slug, label in categories
}

CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "profile-avatar": ["avatar", "profile", "vtuber", "emblem logo", "badge"],
    "social-media-post": ["social media", "instagram", "post", "story", "feed"],
    "infographic-edu-visual": ["infographic", "explainer", "educational", "diagram", "slide"],
    "youtube-thumbnail": ["youtube", "thumbnail"],
    "comic-storyboard": ["storyboard", "comic panel", "manga panel"],
    "product-marketing": ["product marketing", "campaign", "advertising", "promotional"],
    "ecommerce-main-image": ["e-commerce", "ecommerce", "main image", "product card", "shopping"],
    "game-asset": ["game asset", "sprite", "game ui", "item icon"],
    "poster-flyer": ["poster", "flyer", "billboard", "key visual"],
    "app-web-design": ["app", "web design", "ui mockup", "interface"],
    "photography": ["photography", "photo", "photorealistic", "realistic"],
    "cinematic-film-still": ["cinematic", "film still", "movie still"],
    "anime-manga": ["anime", "manga"],
    "illustration": ["illustration", "illustrated"],
    "sketch-line-art": ["sketch", "line art", "pencil drawing"],
    "comic-graphic-novel": ["graphic novel", "comic"],
    "3d-render": ["3d render", "3d", "rendered"],
    "chibi-q-style": ["chibi", "q-style", "kawaii"],
    "isometric": ["isometric"],
    "pixel-art": ["pixel art"],
    "oil-painting": ["oil painting"],
    "watercolor": ["watercolor"],
    "ink-chinese-style": ["ink", "chinese style", "shuimo"],
    "retro-vintage": ["retro", "vintage"],
    "cyberpunk-sci-fi": ["cyberpunk", "sci-fi", "science fiction"],
    "minimalism": ["minimalist", "minimalism"],
    "portrait-selfie": ["portrait", "selfie", "headshot"],
    "influencer-model": ["influencer", "model", "fashion shoot"],
    "character": ["character", "mascot"],
    "group-couple": ["group", "couple", "friends"],
    "product": ["product", "packshot"],
    "food-drink": ["food", "drink", "beverage", "restaurant"],
    "fashion-item": ["fashion", "clothing", "sneaker", "handbag"],
    "animal-creature": ["animal", "creature"],
    "vehicle": ["vehicle", "car", "motorcycle", "spaceship"],
    "architecture-interior": ["architecture", "interior", "room", "building"],
    "landscape-nature": ["landscape", "nature", "mountain", "forest"],
    "cityscape-street": ["cityscape", "street", "urban"],
    "diagram-chart": ["diagram", "chart", "callout", "flowchart"],
    "text-typography": ["typography", "text rendering", "logo text", "lettering"],
    "abstract-background": ["abstract", "background", "wallpaper"],
}

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


def _slugify_category(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def _category_groups(categories: list[str]) -> dict[str, list[dict[str, str]]]:
    selected = set(categories)
    return {
        group: [{"slug": slug, "label": label} for slug, label in values if slug in selected]
        for group, values in CATEGORY_GROUPS.items()
    }


def _infer_categories(title: str, description: str, prompt: str) -> list[dict[str, str]]:
    found: list[str] = []
    prefix = title.split(" - ", 1)[0].strip() if " - " in title else ""
    if prefix:
        slug = _slugify_category(prefix)
        if slug in CATEGORY_LABELS:
            found.append(slug)

    text = f"{title} {description} {prompt}".lower()
    for slug, keywords in CATEGORY_KEYWORDS.items():
        if slug in found:
            continue
        if any(keyword in text for keyword in keywords):
            found.append(slug)

    return [{"slug": slug, "label": CATEGORY_LABELS[slug]} for slug in found if slug in CATEGORY_LABELS]


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
            categories = _infer_categories(title, description, prompt)
            category_slugs = [category["slug"] for category in categories]

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
                    "categories": categories,
                    "category_groups": _category_groups(category_slugs),
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
