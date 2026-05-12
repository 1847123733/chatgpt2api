from __future__ import annotations

from datetime import UTC, datetime
import hashlib
from pathlib import PurePosixPath
import json
import re
from pathlib import Path
from threading import Lock
from typing import Any
from uuid import uuid4

from services.config import DATA_DIR, config
from services.prompt_square_service import CATEGORY_LABELS, _category_groups, _slugify_category

USER_PROMPTS_FILE = DATA_DIR / "user_prompt_square.json"
DEFAULT_PAGE_SIZE = 24
MAX_PAGE_SIZE = 60
MAX_IMAGE_BYTES = 8 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _clean(value: object, limit: int = 0) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit] if limit > 0 else text


def _clean_multiline(value: object, limit: int = 0) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    return text[:limit] if limit > 0 else text


def _category_slug(value: str) -> str:
    slug = _slugify_category(value)
    if slug:
        return slug
    digest = hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]
    return f"custom-{digest}"


def _normalize_categories(values: object) -> list[dict[str, str]]:
    if not isinstance(values, list):
        return []
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for value in values:
        if isinstance(value, dict):
            raw_label = value.get("label") or value.get("slug")
            raw_slug = _clean(value.get("slug"), 80)
        else:
            raw_label = value
            raw_slug = ""
        label = _clean(raw_label, 40)
        if not label:
            continue
        slug = raw_slug or _category_slug(label)
        if not slug or slug in seen:
            continue
        seen.add(slug)
        result.append({"slug": slug, "label": CATEGORY_LABELS.get(slug, label)})
    return result[:6]


def _identity_key(identity: dict[str, object]) -> str:
    role = _clean(identity.get("role")) or "unknown"
    subject_id = _clean(identity.get("id")) or _clean(identity.get("subject_id")) or "anonymous"
    return f"{role}:{subject_id}"


def _public_item(item: dict[str, Any], identity: dict[str, object] | None = None) -> dict[str, Any]:
    categories = _normalize_categories(item.get("categories"))
    category_slugs = [category["slug"] for category in categories]
    liked_by = [str(value) for value in item.get("liked_by", []) if str(value).strip()]
    viewer = _identity_key(identity) if identity else ""
    prompt = _clean_multiline(item.get("prompt"))
    created_by = item.get("created_by") if isinstance(item.get("created_by"), dict) else {}
    return {
        "id": _clean(item.get("id")),
        "rank": int(item.get("rank") or 0),
        "title": _clean(item.get("title"), 120),
        "description": _clean(item.get("description"), 500),
        "prompt": prompt,
        "prompt_preview": _clean(prompt.replace("\n", " "), 240),
        "language": _clean(item.get("language"), 24) or "zh",
        "languages": [_clean(item.get("language"), 24) or "zh"],
        "featured": False,
        "raycast_friendly": False,
        "categories": categories,
        "category_groups": _category_groups(category_slugs),
        "preview_image_url": _clean(item.get("preview_image_url"), 2000),
        "image_urls": [_clean(item.get("preview_image_url"), 2000)] if _clean(item.get("preview_image_url")) else [],
        "author_name": _clean(created_by.get("name")) or _clean(item.get("author_name")) or "社区用户",
        "author_url": "",
        "source_name": "用户 Prompt 广场",
        "source_url": "",
        "published_at": _clean(item.get("created_at")),
        "updated_at": _clean(item.get("updated_at")),
        "try_link": "",
        "repo_entry_url": "",
        "like_count": len(set(liked_by)),
        "liked_by_me": bool(viewer and viewer in liked_by),
        "created_by": {
            "id": _clean(created_by.get("id")),
            "name": _clean(created_by.get("name")) or "社区用户",
            "role": _clean(created_by.get("role")) or "user",
        },
    }


class UserPromptSquareService:
    def __init__(self, file_path: Path = USER_PROMPTS_FILE) -> None:
        self.file_path = file_path
        self._lock = Lock()

    def list_items(
        self,
        *,
        identity: dict[str, object],
        page: int = 1,
        page_size: int = DEFAULT_PAGE_SIZE,
        category: str = "",
        search: str = "",
    ) -> dict[str, Any]:
        normalized_page = max(1, int(page or 1))
        normalized_page_size = max(1, min(MAX_PAGE_SIZE, int(page_size or DEFAULT_PAGE_SIZE)))
        normalized_category = _category_slug(category) if category else ""
        keyword = _clean(search).lower()
        with self._lock:
            public_items = [_public_item(item, identity) for item in self._load_items_locked()]

        def matches(item: dict[str, Any]) -> bool:
            if normalized_category and not any(category["slug"] == normalized_category for category in item.get("categories", [])):
                return False
            if not keyword:
                return True
            haystack = " ".join(
                [
                    item.get("title", ""),
                    item.get("description", ""),
                    item.get("prompt", ""),
                    item.get("author_name", ""),
                    " ".join(category.get("label", "") for category in item.get("categories", [])),
                ]
            ).lower()
            return keyword in haystack

        filtered = [item for item in public_items if matches(item)]
        filtered.sort(key=lambda item: (int(item.get("like_count") or 0), item.get("published_at") or ""), reverse=True)
        for index, item in enumerate(filtered, start=1):
            item["rank"] = index
        start = (normalized_page - 1) * normalized_page_size
        end = start + normalized_page_size
        return {
            "source": {"name": "user", "repo_url": "", "readme_url": "", "cover_image_url": ""},
            "fetched_at": _now_iso(),
            "items": filtered[start:end],
            "total": len(filtered),
            "page": normalized_page,
            "page_size": normalized_page_size,
            "has_more": end < len(filtered),
        }

    def create_item(self, payload: dict[str, Any], *, identity: dict[str, object]) -> dict[str, Any]:
        title = _clean(payload.get("title"), 120)
        prompt = _clean_multiline(payload.get("prompt"), 8000)
        preview_image_url = _clean(payload.get("preview_image_url"), 2000)
        if not title:
            raise ValueError("标题不能为空")
        if not prompt:
            raise ValueError("Prompt 不能为空")
        if not preview_image_url:
            raise ValueError("请上传图片示例")
        now = _now_iso()
        item = {
            "id": uuid4().hex,
            "title": title,
            "description": _clean(payload.get("description"), 500),
            "prompt": prompt,
            "language": _clean(payload.get("language"), 24) or "zh",
            "preview_image_url": preview_image_url,
            "categories": _normalize_categories(payload.get("categories")),
            "created_by": {
                "id": _clean(identity.get("id")) or _clean(identity.get("subject_id")),
                "name": _clean(identity.get("name")) or "社区用户",
                "role": _clean(identity.get("role")) or "user",
            },
            "liked_by": [],
            "created_at": now,
            "updated_at": now,
        }
        with self._lock:
            items = self._load_items_locked()
            items.append(item)
            self._save_items_locked(items)
        return _public_item(item, identity)

    def update_item(self, item_id: str, payload: dict[str, Any], *, identity: dict[str, object]) -> dict[str, Any]:
        self._require_manager(identity)
        with self._lock:
            items = self._load_items_locked()
            item = self._find_item(items, item_id)
            for key, limit in {
                "title": 120,
                "description": 500,
                "language": 24,
                "preview_image_url": 2000,
            }.items():
                if key in payload:
                    item[key] = _clean(payload.get(key), limit)
            if "prompt" in payload:
                item["prompt"] = _clean_multiline(payload.get("prompt"), 8000)
            if "categories" in payload:
                item["categories"] = _normalize_categories(payload.get("categories"))
            if not _clean(item.get("title")) or not _clean_multiline(item.get("prompt")):
                raise ValueError("标题和 Prompt 不能为空")
            if not _clean(item.get("preview_image_url")):
                raise ValueError("请上传图片示例")
            item["updated_at"] = _now_iso()
            self._save_items_locked(items)
            return _public_item(item, identity)

    def delete_item(self, item_id: str, *, identity: dict[str, object]) -> list[dict[str, Any]]:
        self._require_manager(identity)
        with self._lock:
            items = self._load_items_locked()
            next_items = [item for item in items if item.get("id") != item_id]
            if len(next_items) == len(items):
                raise KeyError("Prompt 不存在")
            self._save_items_locked(next_items)
            return [_public_item(item, identity) for item in next_items]

    def toggle_like(self, item_id: str, *, identity: dict[str, object]) -> dict[str, Any]:
        viewer = _identity_key(identity)
        with self._lock:
            items = self._load_items_locked()
            item = self._find_item(items, item_id)
            liked_by = [str(value) for value in item.get("liked_by", []) if str(value).strip()]
            if viewer in liked_by:
                liked_by = [value for value in liked_by if value != viewer]
            else:
                liked_by.append(viewer)
            item["liked_by"] = liked_by
            item["updated_at"] = _now_iso()
            self._save_items_locked(items)
            return _public_item(item, identity)

    def save_image(self, *, filename: str, content_type: str, content: bytes, base_url: str) -> dict[str, str]:
        normalized_type = _clean(content_type).lower()
        extension = ALLOWED_IMAGE_TYPES.get(normalized_type)
        if not extension:
            raise ValueError("仅支持 JPG、PNG、WEBP、GIF 图片")
        if not content:
            raise ValueError("图片不能为空")
        if len(content) > MAX_IMAGE_BYTES:
            raise ValueError("图片不能超过 8MB")

        original_suffix = Path(filename or "").suffix.lower()
        if original_suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
            extension = ".jpg" if original_suffix == ".jpeg" else original_suffix
        image_name = f"{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}-{uuid4().hex}{extension}"
        target = config.prompt_square_images_dir / image_name
        target.write_bytes(content)
        path = PurePosixPath("/prompt-square-images") / image_name
        return {"url": f"{base_url.rstrip('/')}{path.as_posix()}", "path": path.as_posix()}

    def _load_items_locked(self) -> list[dict[str, Any]]:
        if not self.file_path.exists():
            return []
        try:
            data = json.loads(self.file_path.read_text(encoding="utf-8"))
        except Exception:
            return []
        if isinstance(data, dict):
            data = data.get("items")
        return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []

    def _save_items_locked(self, items: list[dict[str, Any]]) -> None:
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        self.file_path.write_text(json.dumps({"items": items}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    @staticmethod
    def _find_item(items: list[dict[str, Any]], item_id: str) -> dict[str, Any]:
        for item in items:
            if item.get("id") == item_id:
                return item
        raise KeyError("Prompt 不存在")

    @staticmethod
    def _require_manager(identity: dict[str, object]) -> None:
        if identity.get("role") not in ("admin", "reseller"):
            raise PermissionError("需要管理员或代理商权限")


user_prompt_square_service = UserPromptSquareService()
