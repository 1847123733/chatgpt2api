from __future__ import annotations

import io
import json
import re
import zipfile
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, Field

from services.auth_service import auth_service
from services.config import config
from services.log_service import log_service
from services.reseller_billing_service import build_settlement_preview, create_settlement_from_events

from api.support import (
    require_admin,
    sanitize_cpa_pool,
    sanitize_cpa_pools,
    sanitize_sub2api_server,
    sanitize_sub2api_servers,
)
from services.account_service import account_service
from services.cpa_service import cpa_config, cpa_import_service, list_remote_files
from services.sub2api_service import (
    list_remote_accounts as sub2api_list_remote_accounts,
    list_remote_groups as sub2api_list_remote_groups,
    sub2api_config,
    sub2api_import_service,
)



class UserKeyCreateRequest(BaseModel):
    name: str = ""
    valid_days: int = 30
    max_sessions: int = 4


class ResellerKeyCreateRequest(BaseModel):
    name: str = ""
    valid_days: int = 365
    max_sessions: int = 4
    max_trial_keys: int = 20
    cost_per_user: float = 0.0


class ResellerKeyUpdateRequest(BaseModel):
    name: str | None = None
    enabled: bool | None = None
    key: str | None = None
    valid_days: int | None = None
    renew_days: int | None = None
    max_sessions: int | None = None
    max_trial_keys: int | None = None
    cost_per_user: float | None = None


class SettlementCreateRequest(BaseModel):
    period: str = ""
    customer_count: int = 0
    amount: float = 0.0
    status: str = "unpaid"
    notes: str = ""
    trial_unit_price: float = 1.0
    unlimited_daily_price: float = 2.0


class UserKeyUpdateRequest(BaseModel):
    name: str | None = None
    enabled: bool | None = None
    key: str | None = None
    valid_days: int | None = None
    renew_days: int | None = None
    max_sessions: int | None = None


class AccountCreateRequest(BaseModel):
    tokens: list[str] = Field(default_factory=list)
    accounts: list[dict[str, Any]] = Field(default_factory=list)


class AccountDeleteRequest(BaseModel):
    tokens: list[str] = Field(default_factory=list)


class AccountRefreshRequest(BaseModel):
    access_tokens: list[str] = Field(default_factory=list)


class AccountExportRequest(BaseModel):
    access_tokens: list[str] = Field(default_factory=list)
    format: Literal["json", "zip"] = "json"


class AccountUpdateRequest(BaseModel):
    access_token: str = ""
    type: str | None = None
    status: str | None = None
    quota: int | None = None


class CPAPoolCreateRequest(BaseModel):
    name: str = ""
    base_url: str = ""
    secret_key: str = ""


class CPAPoolUpdateRequest(BaseModel):
    name: str | None = None
    base_url: str | None = None
    secret_key: str | None = None


class CPAImportRequest(BaseModel):
    names: list[str] = Field(default_factory=list)


class Sub2APIServerCreateRequest(BaseModel):
    name: str = ""
    base_url: str = ""
    email: str = ""
    password: str = ""
    api_key: str = ""
    group_id: str = ""


class Sub2APIServerUpdateRequest(BaseModel):
    name: str | None = None
    base_url: str | None = None
    email: str | None = None
    password: str | None = None
    api_key: str | None = None
    group_id: str | None = None


class Sub2APIImportRequest(BaseModel):
    account_ids: list[str] = Field(default_factory=list)


def _with_user_owner_names(items: list[dict[str, object]]) -> list[dict[str, object]]:
    resellers = auth_service.list_keys(role="reseller")
    reseller_names = {
        str(item.get("id")): str(item.get("name") or "未命名代理")
        for item in resellers
    }
    result = []
    for item in items:
        next_item = dict(item)
        owner_id = str(next_item.get("owner_id") or "").strip()
        if owner_id:
            next_item["owner_name"] = reseller_names.get(owner_id, "代理已删除")
        else:
            next_item["owner_name"] = "管理员"
        result.append(next_item)
    return result


def _account_payload_token(item: dict[str, Any]) -> str:
    return str(item.get("access_token") or item.get("accessToken") or "").strip()


def _unique_tokens(tokens: list[str]) -> list[str]:
    return list(dict.fromkeys(str(token or "").strip() for token in tokens if str(token or "").strip()))


def _download_timestamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def _safe_export_name(value: str, fallback: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-._")
    return (clean or fallback)[:80]


def _account_zip_bytes(items: list[dict[str, str]]) -> bytes:
    buf = io.BytesIO()
    used_names: set[str] = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as archive:
        for index, item in enumerate(items, start=1):
            raw_name = item.get("email") or item.get("account_id") or f"account-{index:03d}"
            base_name = _safe_export_name(raw_name, f"account-{index:03d}")
            name = base_name
            suffix = 2
            while name in used_names:
                name = f"{base_name}-{suffix}"
                suffix += 1
            used_names.add(name)
            archive.writestr(
                f"{name}.json",
                json.dumps(item, ensure_ascii=False, indent=2) + "\n",
            )
    return buf.getvalue()


def create_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/auth/users")
    async def list_user_keys(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"items": _with_user_owner_names(auth_service.list_keys(role="user"))}

    @router.get("/api/auth/users/usage")
    async def get_user_key_usage(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return log_service.user_usage(auth_service.list_keys(role="user"))

    @router.post("/api/auth/users")
    async def create_user_key(body: UserKeyCreateRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            item, raw_key = auth_service.create_key(
                role="user",
                name=body.name,
                valid_days=body.valid_days,
                max_sessions=body.max_sessions,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        return {"item": item, "key": raw_key, "items": _with_user_owner_names(auth_service.list_keys(role="user"))}

    @router.post("/api/auth/users/{key_id}")
    async def update_user_key(
            key_id: str,
            body: UserKeyUpdateRequest,
            authorization: str | None = Header(default=None),
    ):
        require_admin(authorization)
        updates = {
            key: value
            for key, value in {
                "name": body.name,
                "enabled": body.enabled,
                "key": body.key,
                "valid_days": body.valid_days,
                "renew_days": body.renew_days,
                "max_sessions": body.max_sessions,
            }.items()
            if value is not None
        }
        if not updates:
            raise HTTPException(status_code=400, detail={"error": "还没有检测到改动，请修改后再保存"})
        try:
            item = auth_service.update_key(key_id, updates, role="user")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        if item is None:
            raise HTTPException(status_code=404, detail={"error": "这条用户密钥不存在，可能已经被删除"})
        return {"item": item, "items": _with_user_owner_names(auth_service.list_keys(role="user"))}

    @router.post("/api/auth/users/{key_id}/clear-sessions")
    async def clear_user_key_sessions(key_id: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        item = auth_service.clear_key_sessions(key_id, role="user")
        if item is None:
            raise HTTPException(status_code=404, detail={"error": "这条用户密钥不存在，可能已经被删除"})
        return {"item": item, "items": _with_user_owner_names(auth_service.list_keys(role="user"))}

    @router.delete("/api/auth/users/{key_id}")
    async def delete_user_key(key_id: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        if not auth_service.delete_key(key_id, role="user"):
            raise HTTPException(status_code=404, detail={"error": "这条用户密钥不存在，可能已经被删除"})
        return {"items": _with_user_owner_names(auth_service.list_keys(role="user"))}

    # ─── Reseller management (admin only) ───

    @router.get("/api/auth/resellers")
    async def list_resellers(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        items = auth_service.list_keys(role="reseller")
        # enrich with customer counts
        for item in items:
            stats = auth_service.count_customers(str(item.get("id")))
            item["total_customers"] = stats["total"]
            item["active_customers"] = stats["active"]
            item["trial_customers"] = stats["trial"]
            item["paid_customers"] = stats["paid"]
        return {"items": items}

    @router.post("/api/auth/resellers")
    async def create_reseller(body: ResellerKeyCreateRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            item, raw_key = auth_service.create_key(
                role="reseller",
                name=body.name,
                valid_days=body.valid_days,
                max_sessions=body.max_sessions,
                max_trial_keys=body.max_trial_keys,
                cost_per_user=body.cost_per_user,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        return {"item": item, "key": raw_key, "items": auth_service.list_keys(role="reseller")}

    @router.post("/api/auth/resellers/{key_id}")
    async def update_reseller(key_id: str, body: ResellerKeyUpdateRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        updates = {
            key: value
            for key, value in {
                "name": body.name,
                "enabled": body.enabled,
                "key": body.key,
                "valid_days": body.valid_days,
                "renew_days": body.renew_days,
                "max_sessions": body.max_sessions,
                "max_trial_keys": body.max_trial_keys,
                "cost_per_user": body.cost_per_user,
            }.items()
            if value is not None
        }
        if not updates:
            raise HTTPException(status_code=400, detail={"error": "还没有检测到改动，请修改后再保存"})
        try:
            item = auth_service.update_key(key_id, updates, role="reseller")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        if item is None:
            raise HTTPException(status_code=404, detail={"error": "这条代理商密钥不存在，可能已经被删除"})
        return {"item": item, "items": auth_service.list_keys(role="reseller")}

    @router.delete("/api/auth/resellers/{key_id}")
    async def delete_reseller(key_id: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        if not auth_service.delete_key(key_id, role="reseller"):
            raise HTTPException(status_code=404, detail={"error": "这条代理商密钥不存在，可能已经被删除"})
        return {"items": auth_service.list_keys(role="reseller")}

    @router.post("/api/auth/resellers/{key_id}/clear-sessions")
    async def clear_reseller_sessions(key_id: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        result = auth_service.clear_key_sessions(key_id, role="reseller")
        if result is None:
            raise HTTPException(status_code=404, detail={"error": "代理商不存在"})
        return {"item": result}

    @router.get("/api/auth/resellers/usage")
    async def get_reseller_usage(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        resellers = auth_service.list_keys(role="reseller")
        result = []
        for r in resellers:
            rid = str(r.get("id"))
            customers = auth_service.list_keys(role="user", owner_id=rid)
            usage = log_service.user_usage(customers)
            result.append({
                "reseller": r,
                "customer_count": len(customers),
                "usage": usage,
            })
        return {"items": result}

    @router.post("/api/auth/resellers/{key_id}/settlement")
    async def create_settlement(key_id: str, body: SettlementCreateRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        # verify reseller exists
        resellers = auth_service.list_keys(role="reseller")
        if not any(r.get("id") == key_id for r in resellers):
            raise HTTPException(status_code=404, detail={"error": "代理商不存在"})
        try:
            settlement, items = create_settlement_from_events(
                reseller_id=key_id,
                period=body.period,
                status=body.status,
                notes=body.notes,
                trial_unit_price=body.trial_unit_price,
                unlimited_daily_price=body.unlimited_daily_price,
            )
            return {"item": settlement, "items": items}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail={"error": f"保存结算记录失败: {exc}"}) from exc

    @router.get("/api/auth/resellers/{key_id}/settlement-preview")
    async def preview_settlement(
        key_id: str,
        period: str,
        trial_unit_price: float = 1.0,
        unlimited_daily_price: float = 2.0,
        authorization: str | None = Header(default=None),
    ):
        require_admin(authorization)
        resellers = auth_service.list_keys(role="reseller")
        if not any(r.get("id") == key_id for r in resellers):
            raise HTTPException(status_code=404, detail={"error": "代理商不存在"})
        try:
            return build_settlement_preview(
                reseller_id=key_id,
                period=period,
                trial_unit_price=trial_unit_price,
                unlimited_daily_price=unlimited_daily_price,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail={"error": f"生成结算清单失败: {exc}"}) from exc

    @router.get("/api/auth/resellers/{key_id}/settlements")
    async def list_settlements(key_id: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            storage = config.get_storage_backend()
            settlements = storage.load_settlements()
            if not isinstance(settlements, list):
                settlements = []
            items = [
                s
                for s in settlements
                if s.get("reseller_id") == key_id and s.get("record_type", "settlement") == "settlement"
            ]
            return {"items": items}
        except Exception as exc:
            raise HTTPException(status_code=500, detail={"error": f"加载结算记录失败: {exc}"}) from exc

    @router.get("/api/accounts")
    async def get_accounts(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"items": account_service.list_accounts()}

    @router.post("/api/accounts")
    async def create_accounts(body: AccountCreateRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        account_payloads = [item for item in body.accounts if isinstance(item, dict)]
        payload_tokens = [_account_payload_token(item) for item in account_payloads]
        tokens = _unique_tokens([*body.tokens, *payload_tokens])
        if not tokens:
            raise HTTPException(status_code=400, detail={"error": "tokens is required"})
        if account_payloads:
            result = account_service.add_account_items(account_payloads)
            payload_token_set = set(_unique_tokens(payload_tokens))
            extra_tokens = [token for token in tokens if token not in payload_token_set]
            if extra_tokens:
                extra_result = account_service.add_accounts(extra_tokens)
                result["added"] = int(result.get("added") or 0) + int(extra_result.get("added") or 0)
                result["skipped"] = int(result.get("skipped") or 0) + int(extra_result.get("skipped") or 0)
        else:
            result = account_service.add_accounts(tokens)
        refresh_result = account_service.refresh_accounts(tokens)
        return {
            **result,
            "refreshed": refresh_result.get("refreshed", 0),
            "errors": refresh_result.get("errors", []),
            "items": refresh_result.get("items", result.get("items", [])),
        }

    @router.delete("/api/accounts")
    async def delete_accounts(body: AccountDeleteRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        tokens = [str(token or "").strip() for token in body.tokens if str(token or "").strip()]
        if not tokens:
            raise HTTPException(status_code=400, detail={"error": "tokens is required"})
        return account_service.delete_accounts(tokens)

    @router.post("/api/accounts/refresh")
    async def refresh_accounts(body: AccountRefreshRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        access_tokens = [str(token or "").strip() for token in body.access_tokens if str(token or "").strip()]
        if not access_tokens:
            access_tokens = account_service.list_tokens()
        if not access_tokens:
            raise HTTPException(status_code=400, detail={"error": "access_tokens is required"})
        return account_service.refresh_accounts(access_tokens)

    @router.post("/api/accounts/export")
    async def export_accounts(body: AccountExportRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        access_tokens = _unique_tokens(body.access_tokens)
        items = account_service.build_export_items(access_tokens)
        if not items:
            raise HTTPException(
                status_code=400,
                detail={"error": "没有可导出的完整账号，需要同时有 access_token、refresh_token 和 id_token"},
            )

        timestamp = _download_timestamp()
        if body.format == "zip":
            content = _account_zip_bytes(items)
            return Response(
                content,
                media_type="application/zip",
                headers={"Content-Disposition": f'attachment; filename="codex-accounts-{timestamp}.zip"'},
            )

        payload: dict[str, str] | list[dict[str, str]] = items[0] if len(items) == 1 else items
        return Response(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="codex-accounts-{timestamp}.json"'},
        )

    @router.post("/api/accounts/update")
    async def update_account(body: AccountUpdateRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        access_token = str(body.access_token or "").strip()
        if not access_token:
            raise HTTPException(status_code=400, detail={"error": "access_token is required"})
        updates = {key: value for key, value in {"type": body.type, "status": body.status, "quota": body.quota}.items() if value is not None}
        if not updates:
            raise HTTPException(status_code=400, detail={"error": "还没有检测到改动，请修改后再保存"})
        account = account_service.update_account(access_token, updates)
        if account is None:
            raise HTTPException(status_code=404, detail={"error": "account not found"})
        return {"item": account, "items": account_service.list_accounts()}

    @router.get("/api/cpa/pools")
    async def list_cpa_pools(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"pools": sanitize_cpa_pools(cpa_config.list_pools())}

    @router.post("/api/cpa/pools")
    async def create_cpa_pool(body: CPAPoolCreateRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        if not body.base_url.strip():
            raise HTTPException(status_code=400, detail={"error": "base_url is required"})
        if not body.secret_key.strip():
            raise HTTPException(status_code=400, detail={"error": "secret_key is required"})
        pool = cpa_config.add_pool(name=body.name, base_url=body.base_url, secret_key=body.secret_key)
        return {"pool": sanitize_cpa_pool(pool), "pools": sanitize_cpa_pools(cpa_config.list_pools())}

    @router.post("/api/cpa/pools/{pool_id}")
    async def update_cpa_pool(pool_id: str, body: CPAPoolUpdateRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        pool = cpa_config.update_pool(pool_id, body.model_dump(exclude_none=True))
        if pool is None:
            raise HTTPException(status_code=404, detail={"error": "pool not found"})
        return {"pool": sanitize_cpa_pool(pool), "pools": sanitize_cpa_pools(cpa_config.list_pools())}

    @router.delete("/api/cpa/pools/{pool_id}")
    async def delete_cpa_pool(pool_id: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        if not cpa_config.delete_pool(pool_id):
            raise HTTPException(status_code=404, detail={"error": "pool not found"})
        return {"pools": sanitize_cpa_pools(cpa_config.list_pools())}

    @router.get("/api/cpa/pools/{pool_id}/files")
    async def cpa_pool_files(pool_id: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        pool = cpa_config.get_pool(pool_id)
        if pool is None:
            raise HTTPException(status_code=404, detail={"error": "pool not found"})
        return {"pool_id": pool_id, "files": await run_in_threadpool(list_remote_files, pool)}

    @router.post("/api/cpa/pools/{pool_id}/import")
    async def cpa_pool_import(pool_id: str, body: CPAImportRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        pool = cpa_config.get_pool(pool_id)
        if pool is None:
            raise HTTPException(status_code=404, detail={"error": "pool not found"})
        try:
            job = cpa_import_service.start_import(pool, body.names)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        return {"import_job": job}

    @router.get("/api/cpa/pools/{pool_id}/import")
    async def cpa_pool_import_progress(pool_id: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        pool = cpa_config.get_pool(pool_id)
        if pool is None:
            raise HTTPException(status_code=404, detail={"error": "pool not found"})
        return {"import_job": pool.get("import_job")}

    @router.get("/api/sub2api/servers")
    async def list_sub2api_servers(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"servers": sanitize_sub2api_servers(sub2api_config.list_servers())}

    @router.post("/api/sub2api/servers")
    async def create_sub2api_server(body: Sub2APIServerCreateRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        if not body.base_url.strip():
            raise HTTPException(status_code=400, detail={"error": "base_url is required"})
        has_login = body.email.strip() and body.password.strip()
        has_api_key = bool(body.api_key.strip())
        if not has_login and not has_api_key:
            raise HTTPException(status_code=400, detail={"error": "email+password or api_key is required"})
        server = sub2api_config.add_server(
            name=body.name,
            base_url=body.base_url,
            email=body.email,
            password=body.password,
            api_key=body.api_key,
            group_id=body.group_id,
        )
        return {"server": sanitize_sub2api_server(server), "servers": sanitize_sub2api_servers(sub2api_config.list_servers())}

    @router.post("/api/sub2api/servers/{server_id}")
    async def update_sub2api_server(server_id: str, body: Sub2APIServerUpdateRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        server = sub2api_config.update_server(server_id, body.model_dump(exclude_none=True))
        if server is None:
            raise HTTPException(status_code=404, detail={"error": "server not found"})
        return {"server": sanitize_sub2api_server(server), "servers": sanitize_sub2api_servers(sub2api_config.list_servers())}

    @router.delete("/api/sub2api/servers/{server_id}")
    async def delete_sub2api_server(server_id: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        if not sub2api_config.delete_server(server_id):
            raise HTTPException(status_code=404, detail={"error": "server not found"})
        return {"servers": sanitize_sub2api_servers(sub2api_config.list_servers())}

    @router.get("/api/sub2api/servers/{server_id}/groups")
    async def sub2api_server_groups(server_id: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        server = sub2api_config.get_server(server_id)
        if server is None:
            raise HTTPException(status_code=404, detail={"error": "server not found"})
        try:
            groups = await run_in_threadpool(sub2api_list_remote_groups, server)
        except Exception as exc:
            raise HTTPException(status_code=502, detail={"error": str(exc)}) from exc
        return {"server_id": server_id, "groups": groups}

    @router.get("/api/sub2api/servers/{server_id}/accounts")
    async def sub2api_server_accounts(server_id: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        server = sub2api_config.get_server(server_id)
        if server is None:
            raise HTTPException(status_code=404, detail={"error": "server not found"})
        try:
            accounts = await run_in_threadpool(sub2api_list_remote_accounts, server)
        except Exception as exc:
            raise HTTPException(status_code=502, detail={"error": str(exc)}) from exc
        return {"server_id": server_id, "accounts": accounts}

    @router.post("/api/sub2api/servers/{server_id}/import")
    async def sub2api_server_import(server_id: str, body: Sub2APIImportRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        server = sub2api_config.get_server(server_id)
        if server is None:
            raise HTTPException(status_code=404, detail={"error": "server not found"})
        try:
            job = sub2api_import_service.start_import(server, body.account_ids)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        return {"import_job": job}

    @router.get("/api/sub2api/servers/{server_id}/import")
    async def sub2api_server_import_progress(server_id: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        server = sub2api_config.get_server(server_id)
        if server is None:
            raise HTTPException(status_code=404, detail={"error": "server not found"})
        return {"import_job": server.get("import_job")}

    return router
