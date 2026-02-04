"""
Settings Manager для управления настройками приложения.

Redis-backed persistent storage для настроек приложения.
Настройки сохраняются в Redis и персистентны между перезапусками.
"""

import logging
import json
from typing import Any, Dict, Optional
from dataclasses import dataclass
from app.core.json_utils import dump_json

try:
    from redis import asyncio as aioredis
except ImportError:
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
    redis_client: Optional[any] = None
    _settings: Dict[str, Dict[str, Any]] = None
    _initialized: bool = False
    _use_redis: bool = False

    def __post_init__(self):
        if self._settings is None:
            self._settings = {}

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
                self.redis_url,
                decode_responses=True,
                max_connections=50
            )
            # Test connection
            await self.redis_client.ping()
            self._use_redis = True
            logger.info("✅ Connected to Redis for settings persistence")
        except Exception as e:
            logger.warning(
                f"⚠️  Failed to connect to Redis: {e}. "
                f"Falling back to in-memory storage"
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

        # NLP Global settings
        self._settings["nlp_global"] = {
            "processing_mode": "single",
            "default_processor": "spacy",
            "max_parallel_processors": 3,
            "ensemble_voting_threshold": 0.6,
        }

        # SpaCy settings
        self._settings["nlp_spacy"] = {
            "enabled": True,
            "weight": 1.0,
            "confidence_threshold": 0.3,
            "model_name": "ru_core_news_lg",
            "literary_patterns": True,
            "character_detection_boost": 1.2,
            "location_detection_boost": 1.1,
            "atmosphere_keywords": [],
        }

        # Natasha settings
        self._settings["nlp_natasha"] = {
            "enabled": True,
            "weight": 1.2,
            "confidence_threshold": 0.4,
            "literary_boost": 1.3,
            "enable_morphology": True,
            "enable_syntax": True,
            "enable_ner": True,
            "person_patterns": [],
            "location_patterns": [],
            "atmosphere_indicators": [],
        }

        # Stanza settings
        self._settings["nlp_stanza"] = {
            "enabled": True,  # ✅ ACTIVATED (Session 6, 2025-11-23) - 4-processor ensemble
            "weight": 0.8,
            "confidence_threshold": 0.5,
            "model_name": "ru",
            "processors": "tokenize,pos,lemma,depparse,ner",
            "complex_syntax_analysis": True,
            "dependency_parsing": True,
        }

        # GLiNER settings (DeepPavlov replacement)
        self._settings["nlp_gliner"] = {
            "enabled": True,
            "weight": 1.0,
            "confidence_threshold": 0.3,
            "model_name": "urchade/gliner_medium-v2.1",
            "zero_shot_mode": True,
            "threshold": 0.3,
            "max_length": 384,
            "batch_size": 8,
            "entity_types": [
                "person",
                "location",
                "organization",
                "object",
                "building",
                "place",
                "character",
                "atmosphere",
            ],
        }

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
                        ex=None  # No expiration for settings
                    )
                logger.info(f"✅ Persisted {len(self._settings)} setting categories to Redis")
            except Exception as e:
                logger.error(f"Failed to persist settings to Redis: {e}")

        self._initialized = True
        logger.info(f"Initialized {len(self._settings)} setting categories")
        return True

    async def get_setting(self, category: str, key: str, default: Any = None) -> Any:
        """
        Получить значение настройки.

        Args:
            category: Категория настроек (например, 'nlp_spacy')
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
                logger.warning(f"Failed to get setting from Redis: {e}, using in-memory")

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
                    redis_key,
                    dump_json(self._settings[category]),
                    ex=None
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
                logger.warning(f"Failed to get category from Redis: {e}, using in-memory")

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
                await self.redis_client.set(
                    redis_key,
                    json.dumps(settings),
                    ex=None
                )
                logger.info(f"Updated {category} settings with {len(settings)} keys (persisted to Redis)")
            except Exception as e:
                logger.warning(f"Failed to persist category to Redis: {e}")
        else:
            logger.info(f"Updated {category} settings with {len(settings)} keys (in-memory only)")

        return True

    async def get_processor_config(self, processor_name: str) -> Dict[str, Any]:
        """
        Получить конфигурацию процессора.

        Args:
            processor_name: Название процессора (spacy, natasha, stanza)

        Returns:
            Конфигурация процессора
        """
        category = f"nlp_{processor_name}"
        return await self.get_category_settings(category)

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


# Global singleton instance - will be initialized with Redis URL from config
def get_settings_manager(redis_url: Optional[str] = None) -> SettingsManager:
    """
    Get or create SettingsManager instance.

    Args:
        redis_url: Redis connection URL (optional, will use from config if not provided)

    Returns:
        SettingsManager instance
    """
    global _settings_manager_instance

    if "_settings_manager_instance" not in globals():
        # Import here to avoid circular dependency
        try:
            from ..core.config import get_settings
            config = get_settings()
            redis_url = redis_url or config.REDIS_URL
        except Exception as e:
            logger.warning(f"Failed to load Redis URL from config: {e}")
            redis_url = None

        _settings_manager_instance = SettingsManager(redis_url=redis_url)

    return _settings_manager_instance


# Backward compatibility - direct singleton instance
settings_manager = SettingsManager()
