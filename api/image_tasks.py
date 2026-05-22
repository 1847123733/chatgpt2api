from __future__ import annotations

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from api.support import require_identity, resolve_image_base_url
from services.auth_service import auth_service
from services.content_filter import check_request, find_sensitive_words
from services.image_task_service import ImageTaskQuotaError, image_task_service
from services.log_service import LoggedCall


class ImageGenerationTaskRequest(BaseModel):
    client_task_id: str = Field(..., min_length=1)
    prompt: str = Field(..., min_length=1)
    model: str = "gpt-image-2"
    size: str | None = None


def _parse_task_ids(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


async def filter_or_log(call: LoggedCall, text: str, identity: dict[str, object] | None = None) -> None:
    try:
        await run_in_threadpool(check_request, text)
    except HTTPException as exc:
        call.log("调用失败", status="failed", error=str(exc.detail))
        if identity and identity.get("role") == "user":
            matched = find_sensitive_words(text)
            if matched:
                result = auth_service.record_health_violation(str(identity.get("id")), matched, text)
                if result:
                    remaining = result.get("remaining", -1)
                    disabled = result.get("disabled", False)
                    violations = result.get("violations", 0)
                    health_limit = result.get("health_limit", 5)
                    msg = f"检测到敏感词，拒绝本次任务。健康检测：{violations}/{health_limit}"
                    if disabled:
                        msg += "，账号已被禁用，请联系管理员"
                    elif remaining >= 0:
                        msg += f"，剩余 {remaining} 次机会"
                    raise HTTPException(status_code=400, detail={
                        "error": msg,
                        "code": "health_violation",
                        "health_violations": violations,
                        "health_limit": health_limit,
                        "health_remaining": remaining,
                        "health_disabled": disabled,
                    })
        raise


def create_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/image-tasks")
    async def list_image_tasks(
        ids: str = Query(default=""),
        authorization: str | None = Header(default=None),
        x_session_id: str | None = Header(default=None, alias="x-session-id"),
    ):
        identity = require_identity(authorization, x_session_id)
        return await run_in_threadpool(image_task_service.list_tasks, identity, _parse_task_ids(ids))

    @router.post("/api/image-tasks/generations")
    async def create_generation_task(
        body: ImageGenerationTaskRequest,
        request: Request,
        authorization: str | None = Header(default=None),
        x_session_id: str | None = Header(default=None, alias="x-session-id"),
    ):
        identity = require_identity(authorization, x_session_id)
        if identity.get("role") == "user":
            ok, _ = auth_service.check_monthly_usage_available(str(identity.get("id")))
            if not ok:
                raise HTTPException(status_code=429, detail={"error": "本月图片生成额度已用完", "code": "monthly_limit_exceeded"})
        await filter_or_log(LoggedCall(identity, "/api/image-tasks/generations", body.model, "文生图任务", request_text=body.prompt), body.prompt, identity)
        try:
            return await run_in_threadpool(
                image_task_service.submit_generation,
                identity,
                client_task_id=body.client_task_id,
                prompt=body.prompt,
                model=body.model,
                size=body.size,
                base_url=resolve_image_base_url(request),
            )
        except ImageTaskQuotaError as exc:
            raise HTTPException(status_code=429, detail={"error": str(exc), "code": "monthly_limit_exceeded"}) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/image-tasks/edits")
    async def create_edit_task(
        request: Request,
        authorization: str | None = Header(default=None),
        x_session_id: str | None = Header(default=None, alias="x-session-id"),
        image: list[UploadFile] | None = File(default=None),
        image_list: list[UploadFile] | None = File(default=None, alias="image[]"),
        client_task_id: str = Form(...),
        prompt: str = Form(...),
        model: str = Form(default="gpt-image-2"),
        size: str | None = Form(default=None),
    ):
        identity = require_identity(authorization, x_session_id)
        if identity.get("role") == "user":
            ok, _ = auth_service.check_monthly_usage_available(str(identity.get("id")))
            if not ok:
                raise HTTPException(status_code=429, detail={"error": "本月图片生成额度已用完", "code": "monthly_limit_exceeded"})
        await filter_or_log(LoggedCall(identity, "/api/image-tasks/edits", model, "图生图任务", request_text=prompt), prompt, identity)
        uploads = [*(image or []), *(image_list or [])]
        if not uploads:
            raise HTTPException(status_code=400, detail={"error": "image file is required"})
        images: list[tuple[bytes, str, str]] = []
        for upload in uploads:
            image_data = await upload.read()
            if not image_data:
                raise HTTPException(status_code=400, detail={"error": "image file is empty"})
            images.append((image_data, upload.filename or "image.png", upload.content_type or "image/png"))
        try:
            return await run_in_threadpool(
                image_task_service.submit_edit,
                identity,
                client_task_id=client_task_id,
                prompt=prompt,
                model=model,
                size=size,
                base_url=resolve_image_base_url(request),
                images=images,
            )
        except ImageTaskQuotaError as exc:
            raise HTTPException(status_code=429, detail={"error": str(exc), "code": "monthly_limit_exceeded"}) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    return router
