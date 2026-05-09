from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Literal

from services.config import config
from services.storage.base import StorageBackend

AuthRole = Literal["admin", "user"]

DEFAULT_USER_KEY_VALID_DAYS = 30
DEFAULT_USER_MAX_SESSIONS = 4
USER_SESSION_IDLE_DAYS = 7


class AuthError(Exception):
    def __init__(self, code: str, message: str, *, status_code: int = 401):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _parse_iso(value: object) -> datetime | None:
    candidate = str(value or "").strip()
    if not candidate:
        return None
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _hash_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class AuthService:
    def __init__(self, storage: StorageBackend):
        self.storage = storage
        self._lock = Lock()
        self._items = self._load()
        self._last_used_flush_at: dict[str, datetime] = {}

    @staticmethod
    def _clean(value: object) -> str:
        return str(value or "").strip()

    @staticmethod
    def _default_name(role: object) -> str:
        return "管理员密钥" if str(role or "").strip().lower() == "admin" else "普通用户"

    def _normalize_item(self, raw: object) -> dict[str, object] | None:
        if not isinstance(raw, dict):
            return None
        role = self._clean(raw.get("role")).lower()
        if role not in {"admin", "user"}:
            return None
        key_hash = self._clean(raw.get("key_hash"))
        if not key_hash:
            return None
        item_id = self._clean(raw.get("id")) or uuid.uuid4().hex[:12]
        name = self._clean(raw.get("name")) or self._default_name(role)
        created_at = self._clean(raw.get("created_at")) or _now_iso()
        last_used_at = self._clean(raw.get("last_used_at")) or None
        expires_at = self._clean(raw.get("expires_at")) or None
        try:
            max_sessions = int(raw.get("max_sessions", DEFAULT_USER_MAX_SESSIONS))
        except (TypeError, ValueError):
            max_sessions = DEFAULT_USER_MAX_SESSIONS
        normalized_sessions: list[dict[str, object]] = []
        for session in raw.get("sessions", []) if isinstance(raw.get("sessions"), list) else []:
            normalized = self._normalize_session(session)
            if normalized is not None:
                normalized_sessions.append(normalized)
        return {
            "id": item_id,
            "name": name,
            "role": role,
            "key_hash": key_hash,
            "enabled": bool(raw.get("enabled", True)),
            "created_at": created_at,
            "last_used_at": last_used_at,
            "expires_at": expires_at,
            "max_sessions": max(1, min(100, max_sessions)) if role == "user" else 1,
            "sessions": normalized_sessions if role == "user" else [],
        }

    def _normalize_session(self, raw: object) -> dict[str, object] | None:
        if not isinstance(raw, dict):
            return None
        session_id = self._clean(raw.get("id"))
        if not session_id:
            return None
        created_at = self._clean(raw.get("created_at")) or _now_iso()
        last_seen_at = self._clean(raw.get("last_seen_at")) or created_at
        expires_at = self._clean(raw.get("expires_at")) or None
        return {
            "id": session_id,
            "created_at": created_at,
            "last_seen_at": last_seen_at,
            "expires_at": expires_at,
        }

    def _load(self) -> list[dict[str, object]]:
        try:
            items = self.storage.load_auth_keys()
        except Exception:
            return []
        if not isinstance(items, list):
            return []
        return [normalized for item in items if (normalized := self._normalize_item(item)) is not None]

    def _save(self) -> None:
        self.storage.save_auth_keys(self._items)

    def _reload_locked(self) -> None:
        self._items = self._load()

    def _compute_remaining_days(self, item: dict[str, object], *, now: datetime | None = None) -> int | None:
        expires_at = _parse_iso(item.get("expires_at"))
        if expires_at is None:
            return None
        snapshot = now or datetime.now(timezone.utc)
        seconds = (expires_at - snapshot).total_seconds()
        if seconds <= 0:
            return 0
        # ceiling division to represent remaining "days"
        return int((seconds + 86400 - 1) // 86400)

    @staticmethod
    def _session_expiry(now: datetime | None = None) -> str:
        return ((now or datetime.now(timezone.utc)) + timedelta(days=USER_SESSION_IDLE_DAYS)).isoformat()

    def _prune_sessions_locked(self, item: dict[str, object], *, now: datetime | None = None) -> tuple[dict[str, object], bool]:
        if item.get("role") != "user":
            return item, False
        snapshot = now or datetime.now(timezone.utc)
        current_sessions = item.get("sessions")
        sessions = current_sessions if isinstance(current_sessions, list) else []
        active_sessions: list[dict[str, object]] = []
        changed = False
        for raw_session in sessions:
            normalized = self._normalize_session(raw_session)
            if normalized is None:
                changed = True
                continue
            expires_at = _parse_iso(normalized.get("expires_at"))
            last_seen_at = _parse_iso(normalized.get("last_seen_at"))
            reference = expires_at or (last_seen_at + timedelta(days=USER_SESSION_IDLE_DAYS) if last_seen_at else None)
            if reference is not None and reference <= snapshot:
                changed = True
                continue
            active_sessions.append(normalized)
        if not changed:
            return item, False
        next_item = dict(item)
        next_item["sessions"] = active_sessions
        return next_item, True

    @staticmethod
    def _public_item(item: dict[str, object], *, remaining_days: int | None = None) -> dict[str, object]:
        sessions = item.get("sessions")
        active_session_count = len(sessions) if isinstance(sessions, list) else 0
        return {
            "id": item.get("id"),
            "name": item.get("name"),
            "role": item.get("role"),
            "enabled": bool(item.get("enabled", True)),
            "created_at": item.get("created_at"),
            "last_used_at": item.get("last_used_at"),
            "expires_at": item.get("expires_at"),
            "remaining_days": remaining_days,
            "max_sessions": item.get("max_sessions") if item.get("role") == "user" else None,
            "active_sessions": active_session_count if item.get("role") == "user" else None,
        }

    def list_keys(self, role: AuthRole | None = None) -> list[dict[str, object]]:
        with self._lock:
            self._reload_locked()
            now = datetime.now(timezone.utc)
            changed = False
            next_items: list[dict[str, object]] = []
            for item in self._items:
                item, sessions_changed = self._prune_sessions_locked(item, now=now)
                if sessions_changed:
                    changed = True
                if role is not None and item.get("role") != role:
                    next_items.append(item)
                    continue
                remaining_days = self._compute_remaining_days(item, now=now)
                if remaining_days == 0 and bool(item.get("enabled", True)):
                    next_item = dict(item)
                    next_item["enabled"] = False
                    next_items.append(next_item)
                    changed = True
                else:
                    next_items.append(item)
            if changed:
                self._items = next_items
                try:
                    self._save()
                except Exception:
                    pass
            items = [item for item in self._items if role is None or item.get("role") == role]
            return [self._public_item(item, remaining_days=self._compute_remaining_days(item, now=now)) for item in items]

    def _has_key_hash_locked(self, key_hash: str, *, exclude_id: str = "") -> bool:
        for item in self._items:
            item_id = self._clean(item.get("id"))
            if exclude_id and item_id == exclude_id:
                continue
            stored_hash = self._clean(item.get("key_hash"))
            if stored_hash and hmac.compare_digest(stored_hash, key_hash):
                return True
        return False

    def _build_key_hash_locked(self, raw_key: str, *, exclude_id: str = "") -> str:
        candidate = self._clean(raw_key)
        if not candidate:
            raise ValueError("请输入新的专用密钥")
        admin_key = self._clean(config.auth_key)
        if admin_key and hmac.compare_digest(candidate, admin_key):
            raise ValueError("这个密钥和管理员密钥冲突了，请换一个新的密钥")
        key_hash = _hash_key(candidate)
        if self._has_key_hash_locked(key_hash, exclude_id=exclude_id):
            raise ValueError("这个专用密钥已经存在，请换一个新的密钥")
        return key_hash

    def _has_name_locked(self, name: str, *, role: AuthRole | None = None, exclude_id: str = "") -> bool:
        candidate = self._clean(name)
        if not candidate:
            return False
        for item in self._items:
            item_id = self._clean(item.get("id"))
            if exclude_id and item_id == exclude_id:
                continue
            if role is not None and item.get("role") != role:
                continue
            if self._clean(item.get("name")) == candidate:
                return True
        return False

    def _build_default_name_locked(self, role: AuthRole, *, exclude_id: str = "") -> str:
        base_name = self._default_name(role)
        if not self._has_name_locked(base_name, role=role, exclude_id=exclude_id):
            return base_name
        suffix = 2
        while True:
            candidate = f"{base_name} {suffix}"
            if not self._has_name_locked(candidate, role=role, exclude_id=exclude_id):
                return candidate
            suffix += 1

    def _build_name_locked(self, name: str, *, role: AuthRole, exclude_id: str = "") -> str:
        candidate = self._clean(name)
        if not candidate:
            return self._build_default_name_locked(role, exclude_id=exclude_id)
        if self._has_name_locked(candidate, role=role, exclude_id=exclude_id):
            raise ValueError("这个名称已经在使用中了，换一个更容易区分的名称吧")
        return candidate

    def create_key(
        self,
        *,
        role: AuthRole,
        name: str = "",
        valid_days: int | None = None,
        max_sessions: int | None = None,
    ) -> tuple[dict[str, object], str]:
        with self._lock:
            self._reload_locked()
            normalized_name = self._build_name_locked(name, role=role)
            normalized_days = None
            if role == "user":
                try:
                    candidate_days = int(valid_days) if valid_days is not None else DEFAULT_USER_KEY_VALID_DAYS
                except (TypeError, ValueError):
                    candidate_days = DEFAULT_USER_KEY_VALID_DAYS
                normalized_days = max(1, min(3650, candidate_days))
                try:
                    candidate_sessions = int(max_sessions) if max_sessions is not None else DEFAULT_USER_MAX_SESSIONS
                except (TypeError, ValueError):
                    candidate_sessions = DEFAULT_USER_MAX_SESSIONS
                normalized_max_sessions = max(1, min(100, candidate_sessions))
            else:
                normalized_max_sessions = 1
            while True:
                raw_key = f"sk-{secrets.token_urlsafe(24)}"
                try:
                    key_hash = self._build_key_hash_locked(raw_key)
                    break
                except ValueError:
                    continue
            expires_at = None
            if role == "user" and normalized_days is not None:
                expires_at = (datetime.now(timezone.utc) + timedelta(days=normalized_days)).isoformat()
            item = {
                "id": uuid.uuid4().hex[:12],
                "name": normalized_name,
                "role": role,
                "key_hash": key_hash,
                "enabled": True,
                "created_at": _now_iso(),
                "last_used_at": None,
                "expires_at": expires_at,
                "max_sessions": normalized_max_sessions,
                "sessions": [],
            }
            self._items.append(item)
            self._save()
            return self._public_item(item, remaining_days=self._compute_remaining_days(item)), raw_key

    def update_key(
        self,
        key_id: str,
        updates: dict[str, object],
        *,
        role: AuthRole | None = None,
    ) -> dict[str, object] | None:
        normalized_id = self._clean(key_id)
        if not normalized_id:
            return None
        with self._lock:
            self._reload_locked()
            for index, item in enumerate(self._items):
                if item.get("id") != normalized_id:
                    continue
                if role is not None and item.get("role") != role:
                    return None
                next_item = dict(item)
                next_role = "admin" if str(next_item.get("role") or "").strip().lower() == "admin" else "user"
                if "name" in updates and updates.get("name") is not None:
                    next_item["name"] = self._build_name_locked(
                        str(updates.get("name") or ""),
                        role=next_role,
                        exclude_id=normalized_id,
                    )
                if "enabled" in updates and updates.get("enabled") is not None:
                    next_item["enabled"] = bool(updates.get("enabled"))
                if "key" in updates and updates.get("key") is not None:
                    next_item["key_hash"] = self._build_key_hash_locked(str(updates.get("key") or ""), exclude_id=normalized_id)
                if "valid_days" in updates and updates.get("valid_days") is not None:
                    try:
                        days = int(updates.get("valid_days"))
                    except (TypeError, ValueError):
                        raise ValueError("有效期天数格式不正确") from None
                    days = max(1, min(3650, days))
                    next_item["expires_at"] = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
                    next_item["enabled"] = True
                if "renew_days" in updates and updates.get("renew_days") is not None:
                    try:
                        days = int(updates.get("renew_days"))
                    except (TypeError, ValueError):
                        raise ValueError("续期天数格式不正确") from None
                    days = max(1, min(3650, days))
                    now = datetime.now(timezone.utc)
                    current_expiry = _parse_iso(next_item.get("expires_at"))
                    base = current_expiry if current_expiry and current_expiry > now else now
                    next_item["expires_at"] = (base + timedelta(days=days)).isoformat()
                    next_item["enabled"] = True
                if next_role == "user" and "max_sessions" in updates and updates.get("max_sessions") is not None:
                    try:
                        max_sessions = int(updates.get("max_sessions"))
                    except (TypeError, ValueError):
                        raise ValueError("同时在线数格式不正确") from None
                    next_item["max_sessions"] = max(1, min(100, max_sessions))
                next_item, _ = self._prune_sessions_locked(next_item)
                self._items[index] = next_item
                self._save()
                return self._public_item(next_item, remaining_days=self._compute_remaining_days(next_item))
        return None

    def delete_key(self, key_id: str, *, role: AuthRole | None = None) -> bool:
        normalized_id = self._clean(key_id)
        if not normalized_id:
            return False
        with self._lock:
            self._reload_locked()
            before = len(self._items)
            self._items = [
                item
                for item in self._items
                if not (item.get("id") == normalized_id and (role is None or item.get("role") == role))
            ]
            if len(self._items) == before:
                return False
            self._save()
            return True

    def authenticate(self, raw_key: str, *, session_id: str | None = None, allow_create_session: bool = False) -> dict[str, object] | None:
        candidate = self._clean(raw_key)
        if not candidate:
            return None
        candidate_hash = _hash_key(candidate)
        with self._lock:
            for index, item in enumerate(self._items):
                item, sessions_changed = self._prune_sessions_locked(item)
                if sessions_changed:
                    self._items[index] = item
                stored_hash = self._clean(item.get("key_hash"))
                if not stored_hash or not hmac.compare_digest(stored_hash, candidate_hash):
                    continue
                now = datetime.now(timezone.utc)
                remaining_days = self._compute_remaining_days(item, now=now)
                if remaining_days == 0:
                    next_item = dict(item)
                    next_item["enabled"] = False
                    self._items[index] = next_item
                    try:
                        self._save()
                    except Exception:
                        pass
                    raise AuthError("key_expired", "密钥已过期，请联系管理员续期后再登录")
                if not bool(item.get("enabled", True)):
                    raise AuthError("key_disabled", "密钥已被禁用，请联系管理员")
                next_item = dict(item)
                next_item["last_used_at"] = now.isoformat()
                must_save = sessions_changed
                if next_item.get("role") == "user":
                    active_sessions = list(next_item.get("sessions") if isinstance(next_item.get("sessions"), list) else [])
                    normalized_session_id = self._clean(session_id)
                    matched = False
                    for session_index, raw_session in enumerate(active_sessions):
                        normalized_session = self._normalize_session(raw_session)
                        if normalized_session is None:
                            continue
                        if normalized_session.get("id") != normalized_session_id:
                            continue
                        matched = True
                        normalized_session["last_seen_at"] = now.isoformat()
                        normalized_session["expires_at"] = self._session_expiry(now)
                        active_sessions[session_index] = normalized_session
                        break
                    if normalized_session_id and not matched:
                        raise AuthError("session_invalid", "登录会话已失效，请重新登录")
                    if not normalized_session_id:
                        if not allow_create_session:
                            return None
                        max_sessions = max(1, int(next_item.get("max_sessions") or DEFAULT_USER_MAX_SESSIONS))
                        if len(active_sessions) >= max_sessions:
                            raise ValueError("该用户密钥已达到同时在线上限，请先退出其他设备后再登录")
                        active_sessions.append(
                            {
                                "id": uuid.uuid4().hex,
                                "created_at": now.isoformat(),
                                "last_seen_at": now.isoformat(),
                                "expires_at": self._session_expiry(now),
                            }
                        )
                        must_save = True
                    next_item["sessions"] = active_sessions
                self._items[index] = next_item
                item_id = self._clean(next_item.get("id"))
                last_flush_at = self._last_used_flush_at.get(item_id)
                if must_save or last_flush_at is None or (now - last_flush_at).total_seconds() >= 60:
                    try:
                        self._save()
                        self._last_used_flush_at[item_id] = now
                    except Exception:
                        pass
                public_item = self._public_item(next_item, remaining_days=self._compute_remaining_days(next_item, now=now))
                if next_item.get("role") == "user":
                    current_sessions = next_item.get("sessions")
                    if isinstance(current_sessions, list) and current_sessions:
                        public_item["session_id"] = str(current_sessions[-1].get("id")) if not session_id else self._clean(session_id)
                return public_item
        return None

    def logout_session(self, raw_key: str, session_id: str) -> bool:
        candidate = self._clean(raw_key)
        normalized_session_id = self._clean(session_id)
        if not candidate or not normalized_session_id:
            return False
        candidate_hash = _hash_key(candidate)
        with self._lock:
            self._reload_locked()
            for index, item in enumerate(self._items):
                stored_hash = self._clean(item.get("key_hash"))
                if not stored_hash or not hmac.compare_digest(stored_hash, candidate_hash):
                    continue
                if item.get("role") != "user":
                    return False
                sessions = item.get("sessions") if isinstance(item.get("sessions"), list) else []
                next_sessions = [
                    session
                    for session in sessions
                    if self._clean(session.get("id") if isinstance(session, dict) else "") != normalized_session_id
                ]
                if len(next_sessions) == len(sessions):
                    return False
                next_item = dict(item)
                next_item["sessions"] = next_sessions
                self._items[index] = next_item
                self._save()
                return True
        return False

    def clear_key_sessions(self, key_id: str, *, role: AuthRole | None = None) -> dict[str, object] | None:
        normalized_id = self._clean(key_id)
        if not normalized_id:
            return None
        with self._lock:
            self._reload_locked()
            for index, item in enumerate(self._items):
                if item.get("id") != normalized_id:
                    continue
                if role is not None and item.get("role") != role:
                    return None
                next_item = dict(item)
                next_item["sessions"] = []
                next_item, _ = self._prune_sessions_locked(next_item)
                self._items[index] = next_item
                self._save()
                return self._public_item(next_item, remaining_days=self._compute_remaining_days(next_item))
        return None


auth_service = AuthService(config.get_storage_backend())
