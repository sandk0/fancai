"""
Admin API routes for user management.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from ...core.database import get_database_session
from ...core.auth import get_current_admin_user
from ...models.user import User

router = APIRouter()


@router.get("/users")
async def get_users_list(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    admin_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_database_session),
):
    """Get paginated list of users for admin management."""

    result = await db.execute(
        select(User)
        .options(selectinload(User.subscription))
        .offset(skip)
        .limit(limit)
        .order_by(User.created_at.desc())
    )
    users = result.scalars().all()

    # Get total count
    count_result = await db.execute(select(func.count(User.id)))
    total = count_result.scalar()

    return {
        "users": [
            {
                "id": str(user.id),
                "email": user.email,
                "username": user.full_name or "Unknown",
                "subscription_plan": (
                    user.subscription.plan.value if user.subscription else "free"
                ),
                "is_active": user.is_active,
                "is_admin": user.is_admin,
                "created_at": user.created_at.isoformat(),
                "last_login": user.last_login.isoformat() if user.last_login else None,
            }
            for user in users
        ],
        "total": total,
        "skip": skip,
        "limit": limit,
    }
