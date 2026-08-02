"""
Settings Manager для управления настройками приложения.

Redis-backed persistent storage для настроек приложения.
Настройки сохраняются в Redis и персистентны между перезапусками.
"""

import logging
import json
from typing import Any, Dict, Optional
from dataclasses import dataclass, field
from app.core.json_utils import dump_json

# Клиент и модуль redis намеренно `Any`: библиотека опциональна на импорте,
# а до `connect_redis()` поля пусты — точная аннотация свелась бы к Optional
# и потребовала бы narrowing в каждом месте, где guard уже сделан по `_use_redis`.
aioredis: Any
try:
    from redis import asyncio as _redis_asyncio

    aioredis = _redis_asyncio
except ImportError:  # pragma: no cover — redis есть в зависимостях
    aioredis = None

logger = logging.getLogger(__name__)


@dataclass
class SettingsManager:
    """
    Менеджер настроек приложения (Redis-backed implementation).

    Хранит настройки в Redis. Настройки персистентны между перезапусками.
    Fallback к in-memory storage если Redis недоступен.
    """

    redis_url: Optional[str] = None
    redis_client: Any = None
    _settings: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    _initialized: bool = False
    _use_redis: bool = False

    async def connect_redis(self):
        """Connect to Redis if available."""
        if aioredis is None:
            logger.warning(
                "⚠️  redis library not available - falling back to in-memory storage. "
                "Install with: pip install redis[hiredis]"
            )
            self._use_redis = False
            return

        if not self.redis_url:
            logger.warning("⚠️  REDIS_URL not configured - using in-memory storage")
            self._use_redis = False
            return

        try:
            self.redis_client = await aioredis.from_url(
                self.redis_url, decode_responses=True, max_connections=50
            )
            # Test connection
            await self.redis_client.ping()
            self._use_redis = True
            logger.info("✅ Connected to Redis for settings persistence")
        except Exception as e:
            logger.warning(
                f"⚠️  Failed to connect to Redis: {e}. Falling back to in-memory storage"
            )
            self._use_redis = False
            self.redis_client = None

    async def disconnect_redis(self):
        """Disconnect from Redis."""
        if self.redis_client:
            try:
                await self.redis_client.close()
                logger.info("Redis connection closed")
            except Exception as e:
                logger.error(f"Error closing Redis connection: {e}")

    async def initialize_default_settings(self, force: bool = False) -> bool:
        """
        Инициализирует настройки по умолчанию.

        Args:
            force: Принудительная переинициализация

        Returns:
            True если успешно
        """
        if self._initialized and not force:
            logger.info("Settings already initialized, skipping")
            return True

        # Connect to Redis
        await self.connect_redis()

        storage_type = "Redis" if self._use_redis else "in-memory"
        logger.info(f"Initializing default settings ({storage_type})")

        # Parsing settings
        self._settings["parsing"] = {
            "max_concurrent_parsing": 1,
            "priority_free": 1,
            "priority_premium": 5,
            "priority_ultimate": 10,
            "timeout_minutes": 30,
            "retry_attempts": 3,
        }

        # Image generation settings
        self._settings["image_generation"] = {
            "primary_service": "imagen",
            "fallback_services": [],
            "enable_caching": True,
            "image_quality": "high",
            "max_generation_time": 60,
        }

        # Advanced Parser settings
        self._settings["advanced_parser"] = {
            "enabled": False,  # Disabled by default, enable via USE_ADVANCED_PARSER flag
            "min_text_length": 500,  # Minimum text length for Advanced Parser
            "enable_enrichment": False,  # Enable LLM enrichment (requires API key)
            "min_confidence": 0.6,  # Minimum confidence threshold
            "min_char_length": 500,  # Minimum description length
            "max_char_length": 4000,  # Maximum description length
            "optimal_range_min": 1000,  # Optimal range start
            "optimal_range_max": 2500,  # Optimal range end
        }

        # System settings
        self._settings["system"] = {
            "maintenance_mode": False,
            "max_upload_size_mb": 50,
            "supported_book_formats": ["epub", "fb2"],
            "enable_debug_mode": False,
        }

        # Persist default settings to Redis if using it
        if self._use_redis:
            try:
                for category, settings in self._settings.items():
                    redis_key = f"settings:{category}"
                    await self.redis_client.set(
                        redis_key,
                        json.dumps(settings),
                        ex=None,  # No expiration for settings
                    )
                logger.info(
                    f"✅ Persisted {len(self._settings)} setting categories to Redis"
                )
            except Exception as e:
                logger.error(f"Failed to persist settings to Redis: {e}")

        self._initialized = True
        logger.info(f"Initialized {len(self._settings)} setting categories")
        return True

    async def get_setting(self, category: str, key: str, default: Any = None) -> Any:
        """
        Получить значение настройки.

        Args:
            category: Категория настроек (например, 'parsing', 'image_generation')
            key: Ключ настройки
            default: Значение по умолчанию

        Returns:
            Значение настройки или default
        """
        if not self._initialized:
            await self.initialize_default_settings()

        # Try Redis first if available
        if self._use_redis and self.redis_client:
            try:
                redis_key = f"settings:{category}"
                data = await self.redis_client.get(redis_key)
                if data:
                    category_settings = json.loads(data)
                    return category_settings.get(key, default)
            except Exception as e:
                logger.warning(
                    f"Failed to get setting from Redis: {e}, using in-memory"
                )

        # Fallback to in-memory
        category_settings = self._settings.get(category, {})
        return category_settings.get(key, default)

    async def set_setting(self, category: str, key: str, value: Any) -> bool:
        """
        Установить значение настройки.

        Args:
            category: Категория настроек
            key: Ключ настройки
            value: Новое значение

        Returns:
            True если успешно
        """
        if not self._initialized:
            await self.initialize_default_settings()

        # Update in-memory first
        if category not in self._settings:
            self._settings[category] = {}
        self._settings[category][key] = value

        # Persist to Redis if available
        if self._use_redis and self.redis_client:
            try:
                redis_key = f"settings:{category}"
                await self.redis_client.set(
                    redis_key, dump_json(self._settings[category]), ex=None
                )
                logger.debug(f"Set {category}.{key} = {value} (persisted to Redis)")
            except Exception as e:
                logger.warning(f"Failed to persist setting to Redis: {e}")
        else:
            logger.debug(f"Set {category}.{key} = {value} (in-memory only)")

        return True

    async def get_category_settings(self, category: str) -> Dict[str, Any]:
        """
        Получить все настройки категории.

        Args:
            category: Категория настроек

        Returns:
            Словарь с настройками категории
        """
        if not self._initialized:
            await self.initialize_default_settings()

        # Try Redis first if available
        if self._use_redis and self.redis_client:
            try:
                redis_key = f"settings:{category}"
                data = await self.redis_client.get(redis_key)
                if data:
                    return json.loads(data)
            except Exception as e:
                logger.warning(
                    f"Failed to get category from Redis: {e}, using in-memory"
                )

        # Fallback to in-memory
        return self._settings.get(category, {}).copy()

    async def set_category_settings(
        self, category: str, settings: Dict[str, Any]
    ) -> bool:
        """
        Установить все настройки категории.

        Args:
            category: Категория настроек
            settings: Словарь с настройками

        Returns:
            True если успешно
        """
        if not self._initialized:
            await self.initialize_default_settings()

        # Update in-memory
        self._settings[category] = settings.copy()

        # Persist to Redis if available
        if self._use_redis and self.redis_client:
            try:
                redis_key = f"settings:{category}"
                await self.redis_client.set(redis_key, json.dumps(settings), ex=None)
                logger.info(
                    f"Updated {category} settings with {len(settings)} keys (persisted to Redis)"
                )
            except Exception as e:
                logger.warning(f"Failed to persist category to Redis: {e}")
        else:
            logger.info(
                f"Updated {category} settings with {len(settings)} keys (in-memory only)"
            )

        return True

    async def reset_to_defaults(self) -> bool:
        """
        Сбросить все настройки к значениям по умолчанию.

        Returns:
            True если успешно
        """
        # Clear Redis if using it
        if self._use_redis and self.redis_client:
            try:
                # Get all settings keys
                keys = await self.redis_client.keys("settings:*")
                if keys:
                    await self.redis_client.delete(*keys)
                logger.info(f"Cleared {len(keys)} setting categories from Redis")
            except Exception as e:
                logger.error(f"Failed to clear Redis settings: {e}")

        # Clear in-memory
        self._settings.clear()
        self._initialized = False
        return await self.initialize_default_settings(force=True)


# Единственный экземпляр на процесс. Фабрика `get_settings_manager()` удалена:
# её никто не вызывал, а внутри она обращалась к несуществующему
# `config.get_settings` и к необъявленному глобальному имени — оба отказа
# гасились `except Exception` и оставались невидимыми.
settings_manager = SettingsManager()
