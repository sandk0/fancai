"""
SQLAlchemy 2.0 type annotations for fancai models.

Provides reusable Annotated types for consistent column definitions across all models.
"""

import uuid
from datetime import datetime
from typing import Annotated, Any, Awaitable
from uuid import UUID

from sqlalchemy import String, Text, Integer, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB
from sqlalchemy.orm import mapped_column

uuid_pk = Annotated[
    UUID,
    mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True
    ),
]

uuid_fk = Annotated[
    UUID, mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
]

uuid_fk_nullable = Annotated[
    UUID | None, mapped_column(PG_UUID(as_uuid=True), nullable=True, index=True)
]

timestamp_created = Annotated[
    datetime, mapped_column(nullable=False, server_default=func.now())
]

timestamp_updated = Annotated[
    datetime,
    mapped_column(nullable=False, server_default=func.now(), onupdate=func.now()),
]

timestamp_nullable = Annotated[datetime | None, mapped_column(nullable=True)]

str_255 = Annotated[str, mapped_column(String(255), nullable=False)]
str_255_nullable = Annotated[str | None, mapped_column(String(255), nullable=True)]

str_500 = Annotated[str, mapped_column(String(500), nullable=False)]
str_500_nullable = Annotated[str | None, mapped_column(String(500), nullable=True)]

str_1000 = Annotated[str, mapped_column(String(1000), nullable=False)]
str_1000_nullable = Annotated[str | None, mapped_column(String(1000), nullable=True)]

text_required = Annotated[str, mapped_column(Text, nullable=False)]
text_nullable = Annotated[str | None, mapped_column(Text, nullable=True)]

int_default_0 = Annotated[int, mapped_column(Integer, default=0, nullable=False)]
int_nullable = Annotated[int | None, mapped_column(Integer, nullable=True)]

bool_default_false = Annotated[bool, mapped_column(default=False, nullable=False)]
bool_default_true = Annotated[bool, mapped_column(default=True, nullable=False)]
bool_nullable = Annotated[bool | None, mapped_column(nullable=True)]

jsonb_default_dict = Annotated[
    dict[str, Any], mapped_column(JSONB, default={}, nullable=False)
]
jsonb_default_list = Annotated[
    list[Any], mapped_column(JSONB, default=[], nullable=True)
]
jsonb_nullable = Annotated[dict[str, Any] | None, mapped_column(JSONB, nullable=True)]

# redis-py типизирует async-команды как `Awaitable[T] | T`: `redis.asyncio.Redis`
# наследует сигнатуры от синхронных mixin'ов, и `await` над таким объединением
# отвергается. Async-клиент всегда возвращает awaitable, поэтому `cast` к этим
# псевдонимам — no-op в рантайме и держит сужение в одном месте.
RedisInt = Awaitable[int]
RedisBool = Awaitable[bool]
RedisList = Awaitable[list[Any]]
