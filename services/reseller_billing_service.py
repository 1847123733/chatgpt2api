from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from services.config import config

BILLING_RECORD_TYPE = "billing_event"
SETTLEMENT_RECORD_TYPE = "settlement"
UNLIMITED_TIER = "unlimited"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(value: object) -> str:
    return str(value or "").strip()


def _period_from_iso(value: object) -> str:
    raw = _clean(value)
    if len(raw) >= 7:
        return raw[:7]
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _number(value: object, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _int(value: object, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _load_records() -> list[dict[str, Any]]:
    records = config.get_storage_backend().load_settlements()
    return records if isinstance(records, list) else []


def _save_records(records: list[dict[str, Any]]) -> None:
    config.get_storage_backend().save_settlements(records)


def _reseller_cost_per_user(reseller_id: str) -> float:
    from services.auth_service import auth_service

    reseller = next((item for item in auth_service.list_keys(role="reseller") if item.get("id") == reseller_id), None)
    return max(0.0, _number((reseller or {}).get("cost_per_user"), 0.0))


def record_customer_billing_event(
    *,
    reseller_id: str,
    customer: dict[str, Any],
    category: str,
    action: str,
    days: int = 0,
    occurred_at: str | None = None,
) -> dict[str, Any]:
    normalized_reseller_id = _clean(reseller_id)
    if not normalized_reseller_id:
        return {}
    event_time = occurred_at or _now_iso()
    tier = _clean(customer.get("tier"))
    unit_price = 0.0
    quantity = 1
    billable_days = max(0, _int(days, 0))
    if category == "package":
        unit_price = _reseller_cost_per_user(normalized_reseller_id)
    elif category == "trial":
        billable_days = 1
    elif category == "unlimited":
        quantity = billable_days
    event = {
        "id": uuid.uuid4().hex[:12],
        "record_type": BILLING_RECORD_TYPE,
        "reseller_id": normalized_reseller_id,
        "customer_id": _clean(customer.get("id")),
        "customer_name": _clean(customer.get("name")),
        "category": category,
        "action": action,
        "tier": tier,
        "quantity": quantity,
        "days": billable_days,
        "unit_price": unit_price,
        "amount": round(unit_price * quantity, 2),
        "period": _period_from_iso(event_time),
        "occurred_at": event_time,
        "settlement_id": None,
        "settled_at": None,
    }
    records = _load_records()
    records.append(event)
    _save_records(records)
    return event


def build_settlement_preview(
    *,
    reseller_id: str,
    period: str,
    trial_unit_price: float = 1.0,
    unlimited_daily_price: float = 2.0,
) -> dict[str, Any]:
    normalized_period = _clean(period) or datetime.now(timezone.utc).strftime("%Y-%m")
    trial_price = max(0.0, _number(trial_unit_price, 1.0))
    unlimited_price = max(0.0, _number(unlimited_daily_price, 2.0))
    records = _load_records()
    events = [
        record
        for record in records
        if record.get("record_type") == BILLING_RECORD_TYPE
        and record.get("reseller_id") == reseller_id
        and record.get("period") == normalized_period
    ]
    lines = []
    summary = {
        "package": {"label": "套餐账号", "count": 0, "quantity": 0, "amount": 0.0},
        "trial": {"label": "试用账号", "count": 0, "quantity": 0, "amount": 0.0},
        "unlimited": {"label": "不限制次数", "count": 0, "quantity": 0, "amount": 0.0},
    }
    total_amount = 0.0
    unsettled_count = 0
    for event in sorted(events, key=lambda item: _clean(item.get("occurred_at"))):
        category = _clean(event.get("category"))
        if category not in summary:
            continue
        quantity = max(0, _int(event.get("quantity"), 0))
        if category == "trial":
            unit_price = trial_price
            quantity = 1
        elif category == "unlimited":
            unit_price = unlimited_price
        else:
            unit_price = max(0.0, _number(event.get("unit_price"), 0.0))
            quantity = max(1, quantity)
        amount = round(unit_price * quantity, 2)
        settled = bool(event.get("settlement_id"))
        if not settled:
            unsettled_count += 1
            total_amount += amount
            summary[category]["count"] += 1
            summary[category]["quantity"] += quantity
            summary[category]["amount"] = round(float(summary[category]["amount"]) + amount, 2)
        line = dict(event)
        line.update({
            "quantity": quantity,
            "unit_price": unit_price,
            "amount": amount,
            "settled": settled,
        })
        lines.append(line)
    return {
        "period": normalized_period,
        "trial_unit_price": trial_price,
        "unlimited_daily_price": unlimited_price,
        "summary": summary,
        "total_amount": round(total_amount, 2),
        "unsettled_count": unsettled_count,
        "items": lines,
    }


def create_settlement_from_events(
    *,
    reseller_id: str,
    period: str,
    status: str = "paid",
    notes: str = "",
    trial_unit_price: float = 1.0,
    unlimited_daily_price: float = 2.0,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    preview = build_settlement_preview(
        reseller_id=reseller_id,
        period=period,
        trial_unit_price=trial_unit_price,
        unlimited_daily_price=unlimited_daily_price,
    )
    settlement_id = uuid.uuid4().hex[:12]
    settled_at = _now_iso()
    settled_lines = [line for line in preview["items"] if not line.get("settled")]
    if not settled_lines:
        raise ValueError("当前账期没有未结清明细")
    settlement = {
        "id": settlement_id,
        "record_type": SETTLEMENT_RECORD_TYPE,
        "reseller_id": reseller_id,
        "period": preview["period"],
        "customer_count": len({line.get("customer_id") for line in settled_lines if line.get("customer_id")}),
        "event_count": len(settled_lines),
        "amount": preview["total_amount"],
        "status": status if status in {"paid", "unpaid"} else "paid",
        "settled_at": settled_at,
        "notes": notes,
        "trial_unit_price": preview["trial_unit_price"],
        "unlimited_daily_price": preview["unlimited_daily_price"],
        "summary": preview["summary"],
        "items": settled_lines,
    }
    records = _load_records()
    settled_ids = {line.get("id") for line in settled_lines}
    next_records = []
    for record in records:
        if record.get("record_type") == BILLING_RECORD_TYPE and record.get("id") in settled_ids:
            next_record = dict(record)
            next_record["settlement_id"] = settlement_id
            next_record["settled_at"] = settled_at
            next_records.append(next_record)
        else:
            next_records.append(record)
    next_records.append(settlement)
    _save_records(next_records)
    return settlement, [record for record in next_records if record.get("record_type") == SETTLEMENT_RECORD_TYPE and record.get("reseller_id") == reseller_id]
