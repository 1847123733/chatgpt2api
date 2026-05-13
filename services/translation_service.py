from __future__ import annotations

import base64
import json
import threading
import time
from typing import Any

from curl_cffi import requests


USER_AGENT = (
    "Mozilla/5.0 (Windows; U; Windows NT 6.3; WOW64; en-US) "
    "AppleWebKit/603.43 (KHTML, like Gecko) Chrome/47.0.2805.119 Safari/603"
)
AUTH_URL = "https://edge.microsoft.com/translate/auth"
TRANSLATE_URL = "https://api.cognitive.microsofttranslator.com/translate"


class TranslationService:
    def __init__(self) -> None:
        self._token = ""
        self._token_expires_at = 0.0
        self._lock = threading.Lock()
        self._cache: dict[str, str] = {}

    def translate_to_zh(self, texts: list[str]) -> list[dict[str, str]]:
        normalized = [self._normalize_text(text) for text in texts]
        filtered = [text for text in normalized if text]
        if not filtered:
            return []

        unique_texts: list[str] = []
        for text in filtered:
            if text not in unique_texts:
                unique_texts.append(text)

        pending = [text for text in unique_texts if text not in self._cache]
        if pending:
            try:
                translated = self._translate_batch(pending)
            except Exception:
                translated = {}
            self._cache.update(translated)
            for text in pending:
                self._cache.setdefault(text, "")

        return [{"text": text, "translated_text": self._cache.get(text, "")} for text in filtered]

    def _normalize_text(self, value: str) -> str:
        return str(value or "").strip()[:4000]

    def _translate_batch(self, texts: list[str]) -> dict[str, str]:
        token = self._ensure_token()
        response = requests.post(
            TRANSLATE_URL,
            params={
                "api-version": "3.0",
                "to": "zh-Hans",
            },
            headers={
                "User-Agent": USER_AGENT,
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            },
            json=[{"Text": text} for text in texts],
            timeout=20,
        )
        response.raise_for_status()
        payload = response.json()
        result: dict[str, str] = {}
        for text, item in zip(texts, payload, strict=False):
            translated = ""
            if isinstance(item, dict):
                translations = item.get("translations")
                if isinstance(translations, list) and translations:
                    first = translations[0]
                    if isinstance(first, dict):
                        translated = str(first.get("text") or "").strip()
            result[text] = translated
        return result

    def _ensure_token(self) -> str:
        with self._lock:
            if self._token and self._token_expires_at - time.time() > 60:
                return self._token

            response = requests.get(
                AUTH_URL,
                headers={"User-Agent": USER_AGENT},
                timeout=15,
            )
            response.raise_for_status()
            token = response.text.strip()
            payload = self._decode_jwt_payload(token)
            expires_at = float(payload.get("exp") or 0)
            self._token = token
            self._token_expires_at = expires_at
            return self._token

    def _decode_jwt_payload(self, token: str) -> dict[str, Any]:
        parts = token.split(".")
        if len(parts) < 2:
            return {}
        payload = parts[1]
        padding = "=" * (-len(payload) % 4)
        decoded = base64.urlsafe_b64decode(payload + padding)
        data = json.loads(decoded.decode("utf-8"))
        return data if isinstance(data, dict) else {}


translation_service = TranslationService()
