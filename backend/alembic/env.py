"""Alembic environment configuration для fancai."""

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

# Import all models to ensure they are registered with SQLAlchemy
from app.core.database import Base
from app.models.book import Book, ReadingProgress  # noqa: F401
from app.models.chapter import Chapter  # noqa: F401
# NLP REMOVAL: Description model removed
# from app.models.description import Description  # noqa: F401
from app.models.image import GeneratedImage  # noqa: F401
from app.models.user import Subscription, User  # noqa: F401
from app.models.reading_session import ReadingSession  # noqa: F401
from app.models.password_reset import PasswordResetToken  # noqa: F401

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata

target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def get_database_url() -> str:
    """Получить URL базы данных из переменных окружения."""
    database_url = os.getenv(
        "DATABASE_URL",
        "postgresql://bookreader_user:bookreader_pass@localhost:5433/bookreader"
    )
    
    # Для Alembic нужен синхронный драйвер
    if database_url.startswith("postgresql+asyncpg://"):
        database_url = database_url.replace("postgresql+asyncpg://", "postgresql://")
    
    return database_url


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.
    """
    url = get_database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        render_as_batch=False,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    """Run migrations with provided connection."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
        render_as_batch=False,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Run migrations in async mode."""
    database_url = get_database_url()
    
    # Для async миграций используем asyncpg
    if not database_url.startswith("postgresql+asyncpg://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://")
    
    connectable = create_async_engine(
        database_url,
        poolclass=pool.NullPool,
        echo=False,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    # Try to run async migrations
    try:
        asyncio.run(run_async_migrations())
    except Exception as e:
        print(f"Async migration failed: {e}")
        print("Falling back to sync migrations...")
        
        # Fallback to sync migrations
        database_url = get_database_url()
        connectable = create_engine(
            database_url,
            poolclass=pool.NullPool,
        )

        with connectable.connect() as connection:
            do_run_migrations(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()