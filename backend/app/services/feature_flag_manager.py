"""
Feature Flag Manager для fancai.

Управляет feature flags для безопасного rollout новых функций,
A/B тестирования и управления экспериментальной функциональностью.
"""

import os
from typing import Optional, Dict, List
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import logging

from ..models.feature_flag import (
    FeatureFlag,
    FeatureFlagCategory,
    DEFAULT_FEATURE_FLAGS,
)
from ..core.database import get_database_session

logger = logging.getLogger(__name__)


class FeatureFlagManager:
    """
    Менеджер для управления feature flags.

    Поддерживает:
    - Database-based flags (приоритет)
    - Environment variable fallback
    - In-memory caching для производительности
    - Безопасные defaults

    Example:
        >>> async with get_database_session() as db:
        ...     flag_manager = FeatureFlagManager(db)
        ...     is_enabled = await flag_manager.is_enabled("ENABLE_BACKGROUND_EXTRACTION")
        ...     if is_enabled:
        ...         # Use background extraction
        ...         pass
    """

    def __init__(self, db: AsyncSession):
        """
        Инициализация менеджера.

        Args:
            db: AsyncSession для работы с базой данных
        """
        self.db = db
        self._cache: Dict[str, bool] = {}
        self._initialized = False

    async def initialize(self) -> None:
        """
        Инициализация feature flags.

        Создает дефолтные флаги если их нет в БД.
        """
        if self._initialized:
            return

        try:
            # Проверяем существующие флаги
            result = await self.db.execute(select(FeatureFlag))
            existing_flags = {flag.name for flag in result.scalars().all()}

            # Создаем недостающие дефолтные флаги
            for default_flag in DEFAULT_FEATURE_FLAGS:
                if default_flag["name"] not in existing_flags:
                    flag = FeatureFlag(**default_flag)
                    self.db.add(flag)

            await self.db.commit()
            self._initialized = True

            logger.info(
                f"FeatureFlagManager initialized. "
                f"Total flags: {len(existing_flags) + (len(DEFAULT_FEATURE_FLAGS) - len(existing_flags))}"
            )

        except Exception as e:
            logger.error(f"Failed to initialize feature flags: {e}")
            await self.db.rollback()
            raise

    async def is_enabled(self, flag_name: str, default: bool = False) -> bool:
        """
        Проверить включен ли feature flag.

        Порядок проверки:
        1. In-memory cache
        2. Database
        3. Environment variable
        4. Default value

        Args:
            flag_name: Название флага
            default: Значение по умолчанию если флаг не найден

        Returns:
            True если флаг включен, False иначе

        Example:
            >>> is_enabled = await flag_manager.is_enabled("USE_NEW_NLP_ARCHITECTURE")
        """
        # 1. Check cache
        if flag_name in self._cache:
            return self._cache[flag_name]

        try:
            # 2. Check database
            result = await self.db.execute(
                select(FeatureFlag).where(FeatureFlag.name == flag_name)
            )
            flag = result.scalar_one_or_none()

            if flag:
                enabled = flag.enabled
                self._cache[flag_name] = enabled
                return enabled

            # 3. Check environment variable
            env_value = os.getenv(flag_name)
            if env_value is not None:
                enabled = env_value.lower() in ("true", "1", "yes", "on")
                logger.info(f"Feature flag '{flag_name}' from env: {enabled}")
                return enabled

            # 4. Return default
            logger.warning(
                f"Feature flag '{flag_name}' not found. Using default: {default}"
            )
            return default

        except Exception as e:
            logger.error(f"Error checking feature flag '{flag_name}': {e}")
            return default

    async def get_flag(self, flag_name: str) -> Optional[FeatureFlag]:
        """
        Получить feature flag объект.

        Args:
            flag_name: Название флага

        Returns:
            FeatureFlag объект или None если не найден
        """
        try:
            result = await self.db.execute(
                select(FeatureFlag).where(FeatureFlag.name == flag_name)
            )
            return result.scalar_one_or_none()

        except Exception as e:
            logger.error(f"Error getting feature flag '{flag_name}': {e}")
            return None

    async def set_flag(
        self, flag_name: str, enabled: bool, invalidate_cache: bool = True
    ) -> bool:
        """
        Установить значение feature flag.

        Args:
            flag_name: Название флага
            enabled: Новое значение
            invalidate_cache: Очистить кэш после изменения

        Returns:
            True если успешно, False если флаг не найден

        Example:
            >>> success = await flag_manager.set_flag("USE_ADVANCED_PARSER", True)
        """
        try:
            result = await self.db.execute(
                select(FeatureFlag).where(FeatureFlag.name == flag_name)
            )
            flag = result.scalar_one_or_none()

            if not flag:
                logger.warning(f"Feature flag '{flag_name}' not found")
                return False

            flag.enabled = enabled
            await self.db.commit()

            if invalidate_cache:
                self._cache.pop(flag_name, None)

            logger.info(f"Feature flag '{flag_name}' set to {enabled}")
            return True

        except Exception as e:
            logger.error(f"Error setting feature flag '{flag_name}': {e}")
            await self.db.rollback()
            return False

    async def create_flag(
        self,
        name: str,
        enabled: bool = False,
        category: str = FeatureFlagCategory.SYSTEM.value,
        description: Optional[str] = None,
        default_value: bool = False,
    ) -> Optional[FeatureFlag]:
        """
        Создать новый feature flag.

        Args:
            name: Название флага
            enabled: Начальное значение
            category: Категория флага
            description: Описание
            default_value: Значение по умолчанию

        Returns:
            Созданный FeatureFlag или None при ошибке
        """
        try:
            flag = FeatureFlag(
                name=name,
                enabled=enabled,
                category=category,
                description=description,
                default_value=default_value,
            )

            self.db.add(flag)
            await self.db.commit()
            await self.db.refresh(flag)

            logger.info(f"Feature flag '{name}' created")
            return flag

        except Exception as e:
            logger.error(f"Error creating feature flag '{name}': {e}")
            await self.db.rollback()
            return None

    async def get_all_flags(self, category: Optional[str] = None) -> List[FeatureFlag]:
        """
        Получить все feature flags.

        Args:
            category: Фильтр по категории (опционально)

        Returns:
            Список feature flags
        """
        try:
            query = select(FeatureFlag)

            if category:
                query = query.where(FeatureFlag.category == category)

            result = await self.db.execute(query)
            return list(result.scalars().all())

        except Exception as e:
            logger.error(f"Error getting all feature flags: {e}")
            return []

    async def get_enabled_flags(
        self, category: Optional[str] = None
    ) -> List[FeatureFlag]:
        """
        Получить все включенные feature flags.

        Args:
            category: Фильтр по категории (опционально)

        Returns:
            Список включенных feature flags
        """
        try:
            query = select(FeatureFlag).where(FeatureFlag.enabled.is_(True))

            if category:
                query = query.where(FeatureFlag.category == category)

            result = await self.db.execute(query)
            return list(result.scalars().all())

        except Exception as e:
            logger.error(f"Error getting enabled feature flags: {e}")
            return []

    def clear_cache(self) -> None:
        """Очистить кэш feature flags."""
        self._cache.clear()
        logger.info("Feature flags cache cleared")

    async def bulk_update(self, updates: Dict[str, bool]) -> Dict[str, bool]:
        """
        Массовое обновление feature flags.

        Args:
            updates: Словарь {flag_name: enabled}

        Returns:
            Словарь {flag_name: success}

        Example:
            >>> results = await flag_manager.bulk_update({
            ...     "USE_ADVANCED_PARSER": True,
            ...     "USE_LLM_ENRICHMENT": False,
            ... })
        """
        results = {}

        for flag_name, enabled in updates.items():
            success = await self.set_flag(flag_name, enabled, invalidate_cache=False)
            results[flag_name] = success

        # Clear cache once after all updates
        self.clear_cache()

        logger.info(f"Bulk update completed: {len(results)} flags")
        return results

    async def get_flags_by_category(
        self, category: FeatureFlagCategory
    ) -> Dict[str, bool]:
        """
        Получить все флаги категории как словарь {name: enabled}.

        Args:
            category: Категория флагов

        Returns:
            Словарь {flag_name: enabled}

        Example:
            >>> nlp_flags = await flag_manager.get_flags_by_category(
            ...     FeatureFlagCategory.NLP
            ... )
        """
        flags = await self.get_all_flags(category=category.value)
        return {flag.name: flag.enabled for flag in flags}


# Singleton instance (опционально, для удобства)
_feature_flag_manager_instance: Optional[FeatureFlagManager] = None


async def get_feature_flag_manager(
    db: Optional[AsyncSession] = None,
) -> FeatureFlagManager:
    """
    Получить instance FeatureFlagManager.

    Args:
        db: AsyncSession (если None, создается новая)

    Returns:
        FeatureFlagManager instance

    Example:
        >>> flag_manager = await get_feature_flag_manager()
        >>> is_enabled = await flag_manager.is_enabled("USE_NEW_NLP_ARCHITECTURE")
    """
    global _feature_flag_manager_instance

    if db is None:
        # Create new session if not provided
        async for session in get_database_session():
            manager = FeatureFlagManager(session)
            await manager.initialize()
            return manager
        raise RuntimeError("get_database_session() не выдал ни одной сессии")

    # Use provided session
    if _feature_flag_manager_instance is None:
        _feature_flag_manager_instance = FeatureFlagManager(db)
        await _feature_flag_manager_instance.initialize()

    return _feature_flag_manager_instance
