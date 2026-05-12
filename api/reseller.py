from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from services.auth_service import auth_service
from services.config import config
from services.log_service import log_service

from api.support import require_admin, require_identity, require_reseller


class ResellerCustomerCreateRequest(BaseModel):
    name: str = ""
    is_trial: bool = False
    tier: str = "100"
    valid_days: int = 30
    max_sessions: int = 4


class ResellerCustomerUpdateRequest(BaseModel):
    name: str | None = None
    enabled: bool | None = None
    key: str | None = None
    valid_days: int | None = None
    renew_days: int | None = None
    max_sessions: int | None = None
    tier: str | None = None


class ConvertTrialRequest(BaseModel):
    tier: str = "100"
    valid_days: int = 30


def _get_tier_limit(tier_name: str) -> int:
    for t in config.reseller_tiers:
        if t.get("name") == tier_name:
            return int(t.get("limit", 0))
    return 0


def _customer_stats_payload(stats: dict[str, int], max_trial_keys: object = 20, **extra: object) -> dict[str, object]:
    try:
        max_trial = max(0, int(max_trial_keys or 0))
    except (TypeError, ValueError):
        max_trial = 20
    trial = int(stats.get("trial", 0))
    return {
        "total_customers": int(stats.get("total", 0)),
        "active_customers": int(stats.get("active", 0)),
        "trial_customers": trial,
        "paid_customers": int(stats.get("paid", 0)),
        "max_trial_keys": max_trial,
        "trial_quota_remaining": max(0, max_trial - trial),
        **extra,
    }


def create_router() -> APIRouter:
    router = APIRouter()

    # ─── Reseller customer management ───

    @router.get("/api/reseller/customers")
    def list_customers(
        authorization: str | None = Header(None),
        session_id: str | None = Header(default=None, alias="x-session-id"),
    ):
        identity = require_reseller(authorization, session_id)
        owner_id = None if identity.get("role") == "admin" else str(identity.get("id"))
        items = auth_service.list_keys(role="user", owner_id=owner_id)
        return {"items": items}

    @router.post("/api/reseller/customers")
    def create_customer(
        body: ResellerCustomerCreateRequest,
        authorization: str | None = Header(None),
        session_id: str | None = Header(default=None, alias="x-session-id"),
    ):
        identity = require_reseller(authorization, session_id)
        reseller_id = str(identity.get("id"))
        is_trial = body.is_trial
        if is_trial:
            reseller = auth_service.list_keys(role="reseller")
            reseller_item = next((r for r in reseller if r.get("id") == reseller_id), None)
            max_trial = int((reseller_item or {}).get("max_trial_keys", 20)) if reseller_item else 20
            current_trial = auth_service.count_trial_keys(reseller_id)
            if current_trial >= max_trial:
                raise HTTPException(status_code=400, detail={"error": f"试用名额已满（{current_trial}/{max_trial}）"})
        tier_name = body.tier if not is_trial else ""
        monthly_limit = 10 if is_trial else _get_tier_limit(tier_name)
        valid_days = body.valid_days if not is_trial else 1
        try:
            public_item, raw_key = auth_service.create_key(
                role="user",
                name=body.name,
                valid_days=valid_days,
                max_sessions=body.max_sessions,
                owner_id=reseller_id,
                is_trial=is_trial,
                tier=tier_name,
                monthly_limit=monthly_limit,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        return {"item": public_item, "key": raw_key}

    @router.post("/api/reseller/customers/{customer_id}")
    def update_customer(
        customer_id: str,
        body: ResellerCustomerUpdateRequest,
        authorization: str | None = Header(None),
        session_id: str | None = Header(default=None, alias="x-session-id"),
    ):
        identity = require_reseller(authorization, session_id)
        updates = {}
        for field in ("name", "enabled", "key", "valid_days", "renew_days", "max_sessions"):
            value = getattr(body, field, None)
            if value is not None:
                updates[field] = value
        if body.tier is not None:
            updates["tier"] = body.tier
            updates["monthly_limit"] = _get_tier_limit(body.tier)
        if not updates:
            raise HTTPException(status_code=400, detail={"error": "没有需要更新的字段"})
        # reseller can only update own customers
        owner_id_filter = str(identity.get("id")) if identity.get("role") != "admin" else None
        # verify ownership before update
        if owner_id_filter:
            items = auth_service.list_keys(role="user", owner_id=owner_id_filter)
            if not any(i.get("id") == customer_id for i in items):
                raise HTTPException(status_code=404, detail={"error": "客户不存在"})
        try:
            result = auth_service.update_key(customer_id, updates, role="user")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        if result is None:
            raise HTTPException(status_code=404, detail={"error": "客户不存在"})
        return {"item": result}

    @router.delete("/api/reseller/customers/{customer_id}")
    def delete_customer(
        customer_id: str,
        authorization: str | None = Header(None),
        session_id: str | None = Header(default=None, alias="x-session-id"),
    ):
        identity = require_reseller(authorization, session_id)
        if identity.get("role") != "admin":
            # verify ownership before delete
            items = auth_service.list_keys(role="user", owner_id=str(identity.get("id")))
            if not any(i.get("id") == customer_id for i in items):
                raise HTTPException(status_code=404, detail={"error": "客户不存在"})
        deleted = auth_service.delete_key(customer_id, role="user")
        if not deleted:
            raise HTTPException(status_code=404, detail={"error": "客户不存在"})
        return {"ok": True}

    @router.post("/api/reseller/customers/{customer_id}/clear-sessions")
    def clear_customer_sessions(
        customer_id: str,
        authorization: str | None = Header(None),
        session_id: str | None = Header(default=None, alias="x-session-id"),
    ):
        identity = require_reseller(authorization, session_id)
        items = auth_service.list_keys(role="user")
        customer = next((i for i in items if i.get("id") == customer_id), None)
        if customer is None:
            raise HTTPException(status_code=404, detail={"error": "客户不存在"})
        if identity.get("role") != "admin" and customer.get("owner_id") != str(identity.get("id")):
            raise HTTPException(status_code=403, detail={"error": "无权操作此客户"})
        result = auth_service.clear_key_sessions(customer_id, role="user")
        if result is None:
            raise HTTPException(status_code=404, detail={"error": "客户不存在"})
        return {"item": result}

    @router.post("/api/reseller/customers/{customer_id}/convert-trial")
    def convert_trial(
        customer_id: str,
        body: ConvertTrialRequest,
        authorization: str | None = Header(None),
        session_id: str | None = Header(default=None, alias="x-session-id"),
    ):
        identity = require_reseller(authorization, session_id)
        items = auth_service.list_keys(role="user")
        customer = next((i for i in items if i.get("id") == customer_id), None)
        if customer is None:
            raise HTTPException(status_code=404, detail={"error": "客户不存在"})
        if identity.get("role") != "admin" and customer.get("owner_id") != str(identity.get("id")):
            raise HTTPException(status_code=403, detail={"error": "无权操作此客户"})
        if not customer.get("is_trial"):
            raise HTTPException(status_code=400, detail={"error": "该客户不是试用账号"})
        monthly_limit = _get_tier_limit(body.tier)
        try:
            result = auth_service.update_key(customer_id, {
                "is_trial": False,
                "tier": body.tier,
                "monthly_limit": monthly_limit,
                "valid_days": body.valid_days,
            }, role="user")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        return {"item": result}

    @router.get("/api/reseller/customers/usage")
    def customer_usage(
        authorization: str | None = Header(None),
        session_id: str | None = Header(default=None, alias="x-session-id"),
    ):
        identity = require_reseller(authorization, session_id)
        owner_id = None if identity.get("role") == "admin" else str(identity.get("id"))
        items = auth_service.list_keys(role="user", owner_id=owner_id)
        usage = log_service.user_usage(items)
        return usage

    @router.get("/api/reseller/stats")
    def reseller_stats(
        authorization: str | None = Header(None),
        session_id: str | None = Header(default=None, alias="x-session-id"),
    ):
        identity = require_reseller(authorization, session_id)
        reseller_id = str(identity.get("id"))
        if identity.get("role") == "admin":
            # admin sees summary of all resellers
            resellers = auth_service.list_keys(role="reseller")
            all_stats = []
            for r in resellers:
                stats = auth_service.count_customers(str(r.get("id")))
                all_stats.append(_customer_stats_payload(
                    stats,
                    r.get("max_trial_keys", 20),
                    reseller_id=r.get("id"),
                    reseller_name=r.get("name"),
                    cost_per_user=r.get("cost_per_user", 0),
                ))
            return {"role": "admin", "resellers": all_stats}
        stats = auth_service.count_customers(reseller_id)
        reseller_items = auth_service.list_keys(role="reseller")
        reseller_item = next((r for r in reseller_items if r.get("id") == reseller_id), None)
        return {
            "role": "reseller",
            **_customer_stats_payload(
                stats,
                (reseller_item or {}).get("max_trial_keys", 20),
                cost_per_user=(reseller_item or {}).get("cost_per_user", 0),
            ),
        }

    # ─── User self-service ───

    @router.get("/api/user/profile")
    def user_profile(
        authorization: str | None = Header(None),
        session_id: str | None = Header(default=None, alias="x-session-id"),
    ):
        identity = require_identity(authorization, session_id)
        if identity.get("role") != "user":
            raise HTTPException(status_code=403, detail={"error": "仅限用户访问"})
        profile = auth_service.get_user_profile(str(identity.get("id")))
        if profile is None:
            raise HTTPException(status_code=404, detail={"error": "用户不存在"})
        return {"item": profile}

    return router
