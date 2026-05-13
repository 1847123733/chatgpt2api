from __future__ import annotations

from fastapi import APIRouter, File, Header, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field

from api.support import require_identity, resolve_image_base_url
from services.prompt_square_service import prompt_square_service
from services.translation_service import translation_service
from services.user_prompt_square_service import user_prompt_square_service


class UserPromptSquareRequest(BaseModel):
    title: str
    prompt: str
    description: str = ""
    preview_image_url: str = ""
    categories: list[str] = Field(default_factory=list)
    language: str = "zh"


class PromptSquareTranslateRequest(BaseModel):
    texts: list[str] = Field(default_factory=list, max_length=24)


def create_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/prompt-square")
    async def get_prompt_square(
        authorization: str | None = Header(default=None),
        x_session_id: str | None = Header(default=None, alias="x-session-id"),
        refresh: bool = Query(default=False),
        limit: int = Query(default=120, ge=1, le=240),
    ):
        require_identity(authorization, x_session_id)
        return prompt_square_service.list_items(force_refresh=refresh, limit=limit)

    @router.get("/api/user-prompt-square")
    async def get_user_prompt_square(
        authorization: str | None = Header(default=None),
        x_session_id: str | None = Header(default=None, alias="x-session-id"),
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=24, ge=1, le=60),
        category: str = Query(default=""),
        search: str = Query(default=""),
    ):
        identity = require_identity(authorization, x_session_id)
        return user_prompt_square_service.list_items(
            identity=identity,
            page=page,
            page_size=page_size,
            category=category,
            search=search,
        )

    @router.post("/api/prompt-square/translate")
    async def translate_prompt_square_descriptions(
        body: PromptSquareTranslateRequest,
        authorization: str | None = Header(default=None),
        x_session_id: str | None = Header(default=None, alias="x-session-id"),
    ):
        require_identity(authorization, x_session_id)
        try:
            return {"items": translation_service.translate_to_zh(body.texts)}
        except Exception as exc:
            raise HTTPException(status_code=502, detail={"error": f"翻译服务不可用: {exc}"}) from exc

    @router.post("/api/user-prompt-square")
    async def create_user_prompt_square_item(
        body: UserPromptSquareRequest,
        authorization: str | None = Header(default=None),
        x_session_id: str | None = Header(default=None, alias="x-session-id"),
    ):
        identity = require_identity(authorization, x_session_id)
        try:
            item = user_prompt_square_service.create_item(body.model_dump(), identity=identity)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        return {"item": item}

    @router.post("/api/user-prompt-square/images")
    async def upload_user_prompt_square_image(
        request: Request,
        image: UploadFile = File(...),
        authorization: str | None = Header(default=None),
        x_session_id: str | None = Header(default=None, alias="x-session-id"),
    ):
        require_identity(authorization, x_session_id)
        content = await image.read()
        try:
            return user_prompt_square_service.save_image(
                filename=image.filename or "",
                content_type=image.content_type or "",
                content=content,
                base_url=resolve_image_base_url(request),
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/user-prompt-square/{item_id}")
    async def update_user_prompt_square_item(
        item_id: str,
        body: UserPromptSquareRequest,
        authorization: str | None = Header(default=None),
        x_session_id: str | None = Header(default=None, alias="x-session-id"),
    ):
        identity = require_identity(authorization, x_session_id)
        try:
            item = user_prompt_square_service.update_item(item_id, body.model_dump(), identity=identity)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail={"error": str(exc)}) from exc
        except KeyError as exc:
            raise HTTPException(status_code=404, detail={"error": str(exc)}) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        return {"item": item}

    @router.delete("/api/user-prompt-square/{item_id}")
    async def delete_user_prompt_square_item(
        item_id: str,
        authorization: str | None = Header(default=None),
        x_session_id: str | None = Header(default=None, alias="x-session-id"),
    ):
        identity = require_identity(authorization, x_session_id)
        try:
            items = user_prompt_square_service.delete_item(item_id, identity=identity)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail={"error": str(exc)}) from exc
        except KeyError as exc:
            raise HTTPException(status_code=404, detail={"error": str(exc)}) from exc
        return {"items": items}

    @router.post("/api/user-prompt-square/{item_id}/like")
    async def like_user_prompt_square_item(
        item_id: str,
        authorization: str | None = Header(default=None),
        x_session_id: str | None = Header(default=None, alias="x-session-id"),
    ):
        identity = require_identity(authorization, x_session_id)
        try:
            item = user_prompt_square_service.toggle_like(item_id, identity=identity)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail={"error": str(exc)}) from exc
        return {"item": item}

    return router
