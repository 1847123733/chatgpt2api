from __future__ import annotations

import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

os.environ.setdefault("CHATGPT2API_AUTH_KEY", "test-auth")

from services.account_service import AccountService
from services.auth_service import AuthError, AuthService
from services.storage.json_storage import JSONStorageBackend
from utils.helper import anonymize_token


class AccountCapabilityTests(unittest.TestCase):
    def test_unknown_quota_accounts_are_available_only_when_not_throttled(self) -> None:
        self.assertFalse(
            AccountService._is_image_account_available(
                {"status": "限流", "image_quota_unknown": True, "quota": 0}
            )
        )
        self.assertTrue(
            AccountService._is_image_account_available(
                {"status": "正常", "image_quota_unknown": True, "quota": 0}
            )
        )

    def test_prolite_variants_are_normalized(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            self.assertEqual(service._normalize_account_type("prolite"), "ProLite")
            self.assertEqual(service._normalize_account_type("pro_lite"), "ProLite")

    def test_search_account_type_ignores_unrelated_scalar_values(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            self.assertIsNone(
                service._search_account_type(
                    {
                        "amr": ["pwd", "otp", "mfa"],
                        "chatgpt_compute_residency": "no_constraint",
                        "chatgpt_data_residency": "no_constraint",
                        "user_id": "user-I52GFfLGFM0dokFk2dBiKEBn",
                    }
                )
            )

    def test_mark_image_result_does_not_consume_unknown_quota(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            service.add_accounts(["token-1"])
            service.update_account(
                "token-1",
                {
                    "status": "正常",
                    "quota": 0,
                    "image_quota_unknown": True,
                },
            )

            updated = service.mark_image_result("token-1", success=True)

            self.assertIsNotNone(updated)
            self.assertEqual(updated["quota"], 0)
            self.assertEqual(updated["status"], "正常")
            self.assertTrue(updated["image_quota_unknown"])


class TokenLogTests(unittest.TestCase):
    def test_anonymize_token_hides_raw_value(self) -> None:
        token = "super-secret-token"
        token_ref = anonymize_token(token)

        self.assertTrue(token_ref.startswith("token:"))
        self.assertNotIn(token, token_ref)


class AuthServiceTests(unittest.TestCase):
    def test_create_authenticate_disable_and_delete_user_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))

            item, raw_key = service.create_key(role="user", name="Alice")

            self.assertEqual(item["role"], "user")
            self.assertEqual(item["name"], "Alice")
            self.assertTrue(item["enabled"])
            self.assertTrue(raw_key.startswith("sk-"))

            authed = service.authenticate(raw_key, allow_create_session=True)
            self.assertIsNotNone(authed)
            self.assertEqual(authed["id"], item["id"])
            self.assertEqual(authed["role"], "user")
            self.assertIsNotNone(authed["last_used_at"])
            self.assertTrue(str(authed.get("session_id") or "").strip())

            updated = service.update_key(item["id"], {"enabled": False}, role="user")
            self.assertIsNotNone(updated)
            self.assertFalse(updated["enabled"])
            self.assertIsNone(service.authenticate(raw_key))

            self.assertTrue(service.delete_key(item["id"], role="user"))
            self.assertFalse(service.delete_key(item["id"], role="user"))
            self.assertEqual(service.list_keys(role="user"), [])

    def test_authenticate_ignores_last_used_save_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            item, raw_key = service.create_key(role="user", name="Alice")

            def fail_save() -> None:
                raise OSError("disk unavailable")

            service._save = fail_save

            authed = service.authenticate(raw_key, allow_create_session=True)

            self.assertIsNotNone(authed)
            self.assertEqual(authed["id"], item["id"])
            self.assertIsNotNone(authed["last_used_at"])

    def test_update_user_key_replaces_raw_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            item, raw_key = service.create_key(role="user", name="Alice")

            updated = service.update_key(item["id"], {"key": "sk-user-custom-key"}, role="user")

            self.assertIsNotNone(updated)
            self.assertIsNone(service.authenticate(raw_key, allow_create_session=True))

            authed = service.authenticate("sk-user-custom-key", allow_create_session=True)
            self.assertIsNotNone(authed)
            self.assertEqual(authed["id"], item["id"])

    def test_user_key_name_must_be_unique(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            first, _ = service.create_key(role="user", name="Alice")
            second, _ = service.create_key(role="user", name="Bob")

            with self.assertRaisesRegex(ValueError, "这个名称已经在使用中了"):
                service.create_key(role="user", name="Alice")

            with self.assertRaisesRegex(ValueError, "这个名称已经在使用中了"):
                service.update_key(second["id"], {"name": "Alice"}, role="user")

            updated = service.update_key(first["id"], {"name": "Alice"}, role="user")
            self.assertIsNotNone(updated)
            self.assertEqual(updated["name"], "Alice")

    def test_user_key_enforces_max_sessions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            item, raw_key = service.create_key(role="user", name="Alice", max_sessions=2)

            first = service.authenticate(raw_key, allow_create_session=True)
            second = service.authenticate(raw_key, allow_create_session=True)

            self.assertIsNotNone(first)
            self.assertIsNotNone(second)
            self.assertEqual(item["max_sessions"], 2)

            with self.assertRaisesRegex(ValueError, "同时在线上限"):
                service.authenticate(raw_key, allow_create_session=True)

            self.assertTrue(service.logout_session(raw_key, str(first["session_id"])))
            third = service.authenticate(raw_key, allow_create_session=True)
            self.assertIsNotNone(third)

    def test_user_session_must_match_after_login(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            _, raw_key = service.create_key(role="user", name="Alice")

            first = service.authenticate(raw_key, allow_create_session=True)

            self.assertIsNotNone(first)
            session_id = str(first["session_id"])
            with self.assertRaises(AuthError) as context:
                service.authenticate(raw_key, session_id="wrong-session")
            self.assertEqual(context.exception.code, "session_invalid")

            validated = service.authenticate(raw_key, session_id=session_id)
            self.assertIsNotNone(validated)
            self.assertEqual(validated["session_id"], session_id)

    def test_admin_can_clear_all_user_sessions_for_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            item, raw_key = service.create_key(role="user", name="Alice", max_sessions=2)

            first = service.authenticate(raw_key, allow_create_session=True)
            second = service.authenticate(raw_key, allow_create_session=True)

            self.assertIsNotNone(first)
            self.assertIsNotNone(second)
            cleared = service.clear_key_sessions(item["id"], role="user")
            self.assertIsNotNone(cleared)
            self.assertEqual(cleared["active_sessions"], 0)

            with self.assertRaises(AuthError) as context:
                service.authenticate(raw_key, session_id=str(first["session_id"]))
            self.assertEqual(context.exception.code, "session_revoked")

            relogin = service.authenticate(raw_key, allow_create_session=True)
            self.assertIsNotNone(relogin)

    def test_user_key_only_expires_at_actual_expiry_time(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            item, raw_key = service.create_key(role="user", name="Alice")

            future_expiry = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
            updated = service.update_key(item["id"], {"enabled": True}, role="user")
            self.assertIsNotNone(updated)
            service._items[0]["expires_at"] = future_expiry

            authed = service.authenticate(raw_key, allow_create_session=True)
            self.assertIsNotNone(authed)
            self.assertGreaterEqual(int(authed["remaining_days"] or 0), 1)

            service._items[0]["expires_at"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
            with self.assertRaises(AuthError) as context:
                service.authenticate(raw_key, allow_create_session=True)
            self.assertEqual(context.exception.code, "key_expired")


if __name__ == "__main__":
    unittest.main()
