"""
Тесты для FeatureFlagManager сервиса.

Проверяет все CRUD операции, кэширование, обновление в массе,
environment variable fallback и инициализацию.
"""

import pytest
import pytest_asyncio
import os
from unittest.mock import patch, AsyncMock
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feature_flag import (
    FeatureFlag,
    FeatureFlagCategory,
    DEFAULT_FEATURE_FLAGS,
)
from app.services.feature_flag_manager import FeatureFlagManager


@pytest_asyncio.fixture
async def feature_flag_manager(db_session: AsyncSession) -> FeatureFlagManager:
    """Fixture для FeatureFlagManager с тестовой БД."""
    manager = FeatureFlagManager(db_session)
    await manager.initialize()
    return manager


@pytest_asyncio.fixture
async def clean_feature_flags(db_session: AsyncSession):
    """Очистить все feature flags перед тестом."""
    from sqlalchemy import delete

    await db_session.execute(delete(FeatureFlag))
    await db_session.commit()
    yield
    # Cleanup after test
    await db_session.execute(delete(FeatureFlag))
    await db_session.commit()


class TestFeatureFlagManagerInitialization:
    """Тесты инициализации FeatureFlagManager."""

    @pytest.mark.asyncio
    async def test_manager_initialization(self, db_session: AsyncSession):
        """Тест инициализации менеджера."""
        manager = FeatureFlagManager(db_session)

        assert manager.db is db_session
        assert manager._cache == {}
        assert manager._initialized is False

    @pytest.mark.asyncio
    async def test_initialize_creates_default_flags(
        self, db_session: AsyncSession, clean_feature_flags
    ):
        """Тест что initialize создает дефолтные флаги."""
        manager = FeatureFlagManager(db_session)

        # Флагов еще нет в БД
        from sqlalchemy import select

        result = await db_session.execute(select(FeatureFlag))
        assert len(result.scalars().all()) == 0

        # После инициализации должны быть все дефолтные флаги
        await manager.initialize()

        result = await db_session.execute(select(FeatureFlag))
        flags = result.scalars().all()
        assert len(flags) == len(DEFAULT_FEATURE_FLAGS)

    @pytest.mark.asyncio
    async def test_initialize_sets_initialized_flag(self, db_session: AsyncSession):
        """Тест что initialize устанавливает флаг _initialized."""
        manager = FeatureFlagManager(db_session)

        assert manager._initialized is False

        await manager.initialize()

        assert manager._initialized is True

    @pytest.mark.asyncio
    async def test_initialize_idempotent(
        self, db_session: AsyncSession, clean_feature_flags
    ):
        """Тест что initialize можно вызывать несколько раз без дубликатов."""
        manager = FeatureFlagManager(db_session)

        # Первый вызов
        await manager.initialize()

        from sqlalchemy import select

        result = await db_session.execute(select(FeatureFlag))
        count_after_first = len(result.scalars().all())

        # Второй вызов
        await manager.initialize()

        result = await db_session.execute(select(FeatureFlag))
        count_after_second = len(result.scalars().all())

        # Количество должно быть одинаковым
        assert count_after_first == count_after_second
        assert count_after_first == len(DEFAULT_FEATURE_FLAGS)

    @pytest.mark.asyncio
    async def test_initialize_with_existing_flags(
        self, db_session: AsyncSession, clean_feature_flags
    ):
        """Тест что initialize не перезаписывает существующие флаги."""
        # Создаем один флаг с другим значением
        custom_flag = FeatureFlag(
            name="USE_NEW_NLP_ARCHITECTURE",
            enabled=False,  # Отличается от дефолтного True
            category=FeatureFlagCategory.NLP.value,
        )
        db_session.add(custom_flag)
        await db_session.commit()

        manager = FeatureFlagManager(db_session)
        await manager.initialize()

        # Проверяем что наш флаг не изменился
        flag = await manager.get_flag("USE_NEW_NLP_ARCHITECTURE")
        assert flag.enabled is False  # Остался как мы установили


class TestFeatureFlagManagerIsEnabled:
    """Тесты метода is_enabled."""

    @pytest.mark.asyncio
    async def test_is_enabled_from_database(self, feature_flag_manager):
        """Тест проверки флага из БД."""
        is_enabled = await feature_flag_manager.is_enabled("USE_NEW_NLP_ARCHITECTURE")

        # По умолчанию это True
        assert is_enabled is True

    @pytest.mark.asyncio
    async def test_is_enabled_disabled_flag(self, feature_flag_manager):
        """Тест проверки отключенного флага."""
        is_enabled = await feature_flag_manager.is_enabled("USE_ADVANCED_PARSER")

        # По умолчанию это False
        assert is_enabled is False

    @pytest.mark.asyncio
    async def test_is_enabled_uses_cache(self, feature_flag_manager):
        """Тест что is_enabled использует кэш для производительности."""
        flag_name = "ENABLE_IMAGE_CACHING"

        # Первый вызов
        result1 = await feature_flag_manager.is_enabled(flag_name)
        assert flag_name in feature_flag_manager._cache

        # Второй вызов должен использовать кэш
        result2 = await feature_flag_manager.is_enabled(flag_name)
        assert result1 == result2

    @pytest.mark.asyncio
    async def test_is_enabled_default_value(self, feature_flag_manager):
        """Тест что is_enabled возвращает default если флаг не найден."""
        # Флаг с таким именем не существует
        result_false = await feature_flag_manager.is_enabled(
            "NONEXISTENT_FLAG", default=False
        )
        assert result_false is False

        result_true = await feature_flag_manager.is_enabled(
            "NONEXISTENT_FLAG", default=True
        )
        assert result_true is True

    @pytest.mark.asyncio
    async def test_is_enabled_env_var_fallback(self, feature_flag_manager):
        """Тест fallback на environment variable."""
        flag_name = "ENV_VAR_TEST_FLAG"

        # Устанавливаем env var
        with patch.dict(os.environ, {flag_name: "true"}):
            result = await feature_flag_manager.is_enabled(flag_name)
            assert result is True

        # Test false value
        with patch.dict(os.environ, {flag_name: "false"}):
            result = await feature_flag_manager.is_enabled(flag_name)
            assert result is False

    @pytest.mark.asyncio
    async def test_is_enabled_env_var_variations(self, feature_flag_manager):
        """Тест различные варианты true значений в env vars."""
        flag_name = "ENV_VAR_TEST_FLAG"

        for true_value in ["true", "True", "TRUE", "1", "yes", "on", "YES", "ON"]:
            with patch.dict(os.environ, {flag_name: true_value}):
                result = await feature_flag_manager.is_enabled(flag_name)
                assert result is True, f"Failed for value: {true_value}"

        for false_value in ["false", "False", "0", "no", "off"]:
            with patch.dict(os.environ, {flag_name: false_value}):
                result = await feature_flag_manager.is_enabled(flag_name)
                assert result is False, f"Failed for value: {false_value}"

    @pytest.mark.asyncio
    async def test_is_enabled_priority_database_over_env(self, feature_flag_manager):
        """Тест что БД имеет приоритет над env vars."""
        flag_name = "USE_NEW_NLP_ARCHITECTURE"

        # Флаг в БД = True
        # Env var = false
        with patch.dict(os.environ, {flag_name: "false"}):
            result = await feature_flag_manager.is_enabled(flag_name)
            # Должен вернуть значение из БД (True)
            assert result is True


class TestFeatureFlagManagerGetFlag:
    """Тесты метода get_flag."""

    @pytest.mark.asyncio
    async def test_get_flag_success(self, feature_flag_manager):
        """Тест получения существующего флага."""
        flag = await feature_flag_manager.get_flag("USE_NEW_NLP_ARCHITECTURE")

        assert flag is not None
        assert flag.name == "USE_NEW_NLP_ARCHITECTURE"
        assert flag.enabled is True

    @pytest.mark.asyncio
    async def test_get_flag_not_found(self, feature_flag_manager):
        """Тест получения несуществующего флага."""
        flag = await feature_flag_manager.get_flag("NONEXISTENT_FLAG")

        assert flag is None

    @pytest.mark.asyncio
    async def test_get_flag_returns_full_object(self, feature_flag_manager):
        """Тест что get_flag возвращает полный FeatureFlag объект."""
        flag = await feature_flag_manager.get_flag("ENABLE_ENSEMBLE_VOTING")

        assert isinstance(flag, FeatureFlag)
        assert hasattr(flag, "id")
        assert hasattr(flag, "name")
        assert hasattr(flag, "enabled")
        assert hasattr(flag, "category")
        assert hasattr(flag, "description")
        assert hasattr(flag, "default_value")
        assert hasattr(flag, "created_at")
        assert hasattr(flag, "updated_at")


class TestFeatureFlagManagerSetFlag:
    """Тесты метода set_flag."""

    @pytest.mark.asyncio
    async def test_set_flag_enable(self, feature_flag_manager):
        """Тест включения флага."""
        # USE_ADVANCED_PARSER по умолчанию disabled
        flag = await feature_flag_manager.get_flag("USE_ADVANCED_PARSER")
        assert flag.enabled is False

        # Включаем
        success = await feature_flag_manager.set_flag("USE_ADVANCED_PARSER", True)
        assert success is True

        # Проверяем что изменилось
        flag = await feature_flag_manager.get_flag("USE_ADVANCED_PARSER")
        assert flag.enabled is True

    @pytest.mark.asyncio
    async def test_set_flag_disable(self, feature_flag_manager):
        """Тест отключения флага."""
        # USE_NEW_NLP_ARCHITECTURE по умолчанию enabled
        flag = await feature_flag_manager.get_flag("USE_NEW_NLP_ARCHITECTURE")
        assert flag.enabled is True

        # Отключаем
        success = await feature_flag_manager.set_flag("USE_NEW_NLP_ARCHITECTURE", False)
        assert success is True

        # Проверяем что изменилось
        flag = await feature_flag_manager.get_flag("USE_NEW_NLP_ARCHITECTURE")
        assert flag.enabled is False

    @pytest.mark.asyncio
    async def test_set_flag_nonexistent_returns_false(self, feature_flag_manager):
        """Тест что set_flag возвращает False для несуществующего флага."""
        success = await feature_flag_manager.set_flag("NONEXISTENT_FLAG", True)

        assert success is False

    @pytest.mark.asyncio
    async def test_set_flag_invalidates_cache(self, feature_flag_manager):
        """Тест что set_flag инвалидирует кэш."""
        flag_name = "ENABLE_PARALLEL_PROCESSING"

        # Заполняем кэш
        await feature_flag_manager.is_enabled(flag_name)
        assert flag_name in feature_flag_manager._cache

        # Устанавливаем флаг - должен очистить кэш
        await feature_flag_manager.set_flag(flag_name, False, invalidate_cache=True)

        assert flag_name not in feature_flag_manager._cache

    @pytest.mark.asyncio
    async def test_set_flag_preserve_cache_option(self, feature_flag_manager):
        """Тест что можно сохранить кэш если invalidate_cache=False."""
        flag_name = "ENABLE_IMAGE_CACHING"

        # Заполняем кэш
        await feature_flag_manager.is_enabled(flag_name)
        original_value = feature_flag_manager._cache.get(flag_name)

        # Устанавливаем флаг БЕЗ инвалидации кэша
        await feature_flag_manager.set_flag(
            flag_name, not original_value, invalidate_cache=False
        )

        # Кэш все еще содержит старое значение
        assert feature_flag_manager._cache.get(flag_name) == original_value


class TestFeatureFlagManagerCreateFlag:
    """Тесты метода create_flag."""

    @pytest.mark.asyncio
    async def test_create_flag_success(self, feature_flag_manager):
        """Тест создания нового флага."""
        flag = await feature_flag_manager.create_flag(
            name="NEW_TEST_FLAG",
            enabled=True,
            category=FeatureFlagCategory.EXPERIMENTAL.value,
            description="Test flag creation",
            default_value=True,
        )

        assert flag is not None
        assert flag.name == "NEW_TEST_FLAG"
        assert flag.enabled is True
        assert flag.category == FeatureFlagCategory.EXPERIMENTAL.value
        assert flag.description == "Test flag creation"
        assert flag.default_value is True

    @pytest.mark.asyncio
    async def test_create_flag_defaults(self, feature_flag_manager):
        """Тест создания флага с default параметрами."""
        flag = await feature_flag_manager.create_flag(name="MINIMAL_FLAG")

        assert flag is not None
        assert flag.name == "MINIMAL_FLAG"
        assert flag.enabled is False
        assert flag.category == FeatureFlagCategory.SYSTEM.value
        assert flag.default_value is False

    @pytest.mark.asyncio
    async def test_create_flag_duplicate_fails(self, feature_flag_manager):
        """Тест что создание дубликата флага не удается (уникальное имя)."""
        # Пытаемся создать флаг с именем который уже существует
        # Manager ловит исключения и возвращает None вместо исключения
        result = await feature_flag_manager.create_flag(name="USE_NEW_NLP_ARCHITECTURE")
        assert result is None  # Ошибка БД обработана, возвращено None

    @pytest.mark.asyncio
    async def test_create_flag_persists_in_database(self, feature_flag_manager):
        """Тест что созданный флаг сохраняется в БД."""
        await feature_flag_manager.create_flag(
            name="PERSISTENT_FLAG",
            enabled=True,
            category=FeatureFlagCategory.SYSTEM.value,
        )

        # Проверяем что флаг в БД
        flag = await feature_flag_manager.get_flag("PERSISTENT_FLAG")
        assert flag is not None
        assert flag.enabled is True


class TestFeatureFlagManagerGetAllFlags:
    """Тесты метода get_all_flags."""

    @pytest.mark.asyncio
    async def test_get_all_flags(self, feature_flag_manager):
        """Тест получения всех флагов."""
        flags = await feature_flag_manager.get_all_flags()

        assert len(flags) == len(DEFAULT_FEATURE_FLAGS)
        flag_names = {f.name for f in flags}
        expected_names = {f["name"] for f in DEFAULT_FEATURE_FLAGS}
        assert flag_names == expected_names

    @pytest.mark.asyncio
    async def test_get_all_flags_by_category(self, feature_flag_manager):
        """Тест получения флагов по категории."""
        nlp_flags = await feature_flag_manager.get_all_flags(
            category=FeatureFlagCategory.NLP.value
        )

        # Должно быть 4 NLP флага
        assert len(nlp_flags) == 4

        # Все должны быть категории NLP
        for flag in nlp_flags:
            assert flag.category == FeatureFlagCategory.NLP.value

    @pytest.mark.asyncio
    async def test_get_all_flags_parser_category(self, feature_flag_manager):
        """Тест получения флагов категории PARSER."""
        parser_flags = await feature_flag_manager.get_all_flags(
            category=FeatureFlagCategory.PARSER.value
        )

        assert len(parser_flags) == 1
        assert parser_flags[0].name == "USE_ADVANCED_PARSER"

    @pytest.mark.asyncio
    async def test_get_all_flags_images_category(self, feature_flag_manager):
        """Тест получения флагов категории IMAGES."""
        image_flags = await feature_flag_manager.get_all_flags(
            category=FeatureFlagCategory.IMAGES.value
        )

        assert len(image_flags) == 1
        assert image_flags[0].name == "ENABLE_IMAGE_CACHING"

    @pytest.mark.asyncio
    async def test_get_all_flags_returns_list(self, feature_flag_manager):
        """Тест что get_all_flags возвращает список."""
        flags = await feature_flag_manager.get_all_flags()

        assert isinstance(flags, list)
        assert all(isinstance(f, FeatureFlag) for f in flags)


class TestFeatureFlagManagerGetEnabledFlags:
    """Тесты метода get_enabled_flags."""

    @pytest.mark.asyncio
    async def test_get_enabled_flags(self, feature_flag_manager):
        """Тест получения только включенных флагов."""
        enabled_flags = await feature_flag_manager.get_enabled_flags()

        # По умолчанию 4 флага включены
        assert len(enabled_flags) == 4

        # Все должны быть включены
        for flag in enabled_flags:
            assert flag.enabled is True

    @pytest.mark.asyncio
    async def test_get_enabled_flags_by_category(self, feature_flag_manager):
        """Тест получения включенных флагов по категории."""
        enabled_nlp = await feature_flag_manager.get_enabled_flags(
            category=FeatureFlagCategory.NLP.value
        )

        # Все должны быть NLP и включены
        assert all(f.category == FeatureFlagCategory.NLP.value for f in enabled_nlp)
        assert all(f.enabled is True for f in enabled_nlp)

    @pytest.mark.asyncio
    async def test_get_enabled_flags_empty_category(self, feature_flag_manager):
        """Тест что возвращаемся пусто для категории без включенных флагов."""
        # Сначала отключаем все PARSER флаги
        await feature_flag_manager.set_flag("USE_ADVANCED_PARSER", False)

        enabled_parser = await feature_flag_manager.get_enabled_flags(
            category=FeatureFlagCategory.PARSER.value
        )

        assert len(enabled_parser) == 0


class TestFeatureFlagManagerClear:
    """Тесты метода clear_cache."""

    @pytest.mark.asyncio
    async def test_clear_cache(self, feature_flag_manager):
        """Тест очистки кэша."""
        # Заполняем кэш
        await feature_flag_manager.is_enabled("USE_NEW_NLP_ARCHITECTURE")
        await feature_flag_manager.is_enabled("ENABLE_IMAGE_CACHING")

        assert len(feature_flag_manager._cache) > 0

        # Очищаем кэш
        feature_flag_manager.clear_cache()

        assert feature_flag_manager._cache == {}

    @pytest.mark.asyncio
    async def test_clear_cache_does_not_affect_database(self, feature_flag_manager):
        """Тест что очистка кэша не влияет на БД."""
        await feature_flag_manager.set_flag("ENABLE_PARALLEL_PROCESSING", False)

        feature_flag_manager.clear_cache()

        flag = await feature_flag_manager.get_flag("ENABLE_PARALLEL_PROCESSING")
        assert flag.enabled is False  # Значение в БД сохранилось


class TestFeatureFlagManagerBulkUpdate:
    """Тесты метода bulk_update."""

    @pytest.mark.asyncio
    async def test_bulk_update_success(self, feature_flag_manager):
        """Тест массового обновления флагов."""
        updates = {
            "USE_ADVANCED_PARSER": True,
            "USE_LLM_ENRICHMENT": True,
            "ENABLE_PARALLEL_PROCESSING": False,
        }

        results = await feature_flag_manager.bulk_update(updates)

        # Все операции должны быть успешны
        assert all(results.values())

        # Проверяем что флаги обновлены
        assert (await feature_flag_manager.is_enabled("USE_ADVANCED_PARSER")) is True
        assert (await feature_flag_manager.is_enabled("USE_LLM_ENRICHMENT")) is True
        assert (
            await feature_flag_manager.is_enabled("ENABLE_PARALLEL_PROCESSING")
        ) is False

    @pytest.mark.asyncio
    async def test_bulk_update_partial_failure(self, feature_flag_manager):
        """Тест bulk update с частичным отказом."""
        updates = {
            "USE_ADVANCED_PARSER": True,  # Существует
            "NONEXISTENT_FLAG": False,  # Не существует
            "ENABLE_IMAGE_CACHING": False,  # Существует
        }

        results = await feature_flag_manager.bulk_update(updates)

        # Проверяем результаты
        assert results["USE_ADVANCED_PARSER"] is True
        assert results["NONEXISTENT_FLAG"] is False  # Failed
        assert results["ENABLE_IMAGE_CACHING"] is True

    @pytest.mark.asyncio
    async def test_bulk_update_clears_cache(self, feature_flag_manager):
        """Тест что bulk_update очищает весь кэш."""
        # Заполняем кэш
        await feature_flag_manager.is_enabled("USE_NEW_NLP_ARCHITECTURE")
        assert len(feature_flag_manager._cache) > 0

        # Делаем bulk update
        await feature_flag_manager.bulk_update(
            {
                "USE_ADVANCED_PARSER": True,
                "ENABLE_IMAGE_CACHING": False,
            }
        )

        # Кэш должен быть очищен
        assert feature_flag_manager._cache == {}

    @pytest.mark.asyncio
    async def test_bulk_update_returns_results_dict(self, feature_flag_manager):
        """Тест что bulk_update возвращает словарь результатов."""
        updates = {
            "USE_ADVANCED_PARSER": True,
            "ENABLE_IMAGE_CACHING": False,
        }

        results = await feature_flag_manager.bulk_update(updates)

        assert isinstance(results, dict)
        assert set(results.keys()) == set(updates.keys())
        assert all(isinstance(v, bool) for v in results.values())


class TestFeatureFlagManagerGetFlagsByCategory:
    """Тесты метода get_flags_by_category."""

    @pytest.mark.asyncio
    async def test_get_flags_by_category_nlp(self, feature_flag_manager):
        """Тест получения NLP флагов как словаря."""
        nlp_flags = await feature_flag_manager.get_flags_by_category(
            FeatureFlagCategory.NLP
        )

        # Должно быть 4 NLP флага
        assert len(nlp_flags) == 4

        # Все ключи должны быть имена флагов
        assert all(isinstance(k, str) for k in nlp_flags.keys())
        assert all(isinstance(v, bool) for v in nlp_flags.values())

    @pytest.mark.asyncio
    async def test_get_flags_by_category_parser(self, feature_flag_manager):
        """Тест получения PARSER флагов."""
        parser_flags = await feature_flag_manager.get_flags_by_category(
            FeatureFlagCategory.PARSER
        )

        assert len(parser_flags) == 1
        assert "USE_ADVANCED_PARSER" in parser_flags
        assert parser_flags["USE_ADVANCED_PARSER"] is False

    @pytest.mark.asyncio
    async def test_get_flags_by_category_images(self, feature_flag_manager):
        """Тест получения IMAGE флагов."""
        image_flags = await feature_flag_manager.get_flags_by_category(
            FeatureFlagCategory.IMAGES
        )

        assert len(image_flags) == 1
        assert "ENABLE_IMAGE_CACHING" in image_flags
        assert image_flags["ENABLE_IMAGE_CACHING"] is True


class TestFeatureFlagManagerErrorHandling:
    """Тесты обработки ошибок."""

    @pytest.mark.asyncio
    async def test_is_enabled_handles_database_error(self, db_session: AsyncSession):
        """Тест что is_enabled обрабатывает ошибки БД."""
        manager = FeatureFlagManager(db_session)

        # Мокируем ошибку БД
        with patch.object(db_session, "execute", side_effect=Exception("DB error")):
            # Должен вернуть default значение вместо ошибки
            result = await manager.is_enabled("TEST_FLAG", default=False)
            assert result is False

    @pytest.mark.asyncio
    async def test_get_all_flags_handles_error(self, db_session: AsyncSession):
        """Тест что get_all_flags обрабатывает ошибки."""
        manager = FeatureFlagManager(db_session)

        # Мокируем ошибку БД
        with patch.object(db_session, "execute", side_effect=Exception("DB error")):
            result = await manager.get_all_flags()
            assert result == []

    @pytest.mark.asyncio
    async def test_get_enabled_flags_handles_error(self, db_session: AsyncSession):
        """Тест что get_enabled_flags обрабатывает ошибки."""
        manager = FeatureFlagManager(db_session)

        with patch.object(db_session, "execute", side_effect=Exception("DB error")):
            result = await manager.get_enabled_flags()
            assert result == []


class TestFeatureFlagManagerEdgeCases:
    """Тесты граничных случаев."""

    @pytest.mark.asyncio
    async def test_empty_bulk_update(self, feature_flag_manager):
        """Тест bulk_update с пустым словарем."""
        results = await feature_flag_manager.bulk_update({})

        assert results == {}

    @pytest.mark.asyncio
    async def test_is_enabled_same_name_as_env_var(self, feature_flag_manager):
        """Тест что флаг в БД имеет приоритет над env var с тем же именем."""
        flag_name = "USE_NEW_NLP_ARCHITECTURE"

        # Флаг в БД = True
        # Env var = false
        with patch.dict(os.environ, {flag_name: "false"}):
            # Должен вернуть True (из БД)
            result = await feature_flag_manager.is_enabled(flag_name)
            assert result is True

    @pytest.mark.asyncio
    async def test_cache_prevents_database_query(self, feature_flag_manager):
        """Тест что кэш действительно предотвращает запрос в БД."""
        # Заполняем кэш
        await feature_flag_manager.is_enabled("USE_NEW_NLP_ARCHITECTURE")

        # Мокируем execute чтобы увидеть если он был вызван
        execute_mock = AsyncMock()

        original_execute = feature_flag_manager.db.execute
        feature_flag_manager.db.execute = execute_mock

        # Второй вызов should use cache
        await feature_flag_manager.is_enabled("USE_NEW_NLP_ARCHITECTURE")

        # execute не должен быть вызван
        execute_mock.assert_not_called()

        # Восстанавливаем оригинальный метод
        feature_flag_manager.db.execute = original_execute
