from __future__ import annotations

from fastapi import APIRouter, Header, Query

from api.support import require_identity
from services.prompt_square_service import prompt_square_service


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

    return router
