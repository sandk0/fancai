"""
Response schemas для Admin endpoints.

Содержит Pydantic модели для:
- Redis cache статистика
- Управление кэшем
- Очереди обработки
- Системные настройки парсинга

Version: Phase 1.3 Type Safety (2025-11-29)
"""

from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime


class CacheStatsResponse(BaseModel):
    """
    Статистика Redis cache.

    Используется в GET /api/v1/admin/cache/stats.

    Показывает текущее состояние Redis кэша:
    - Количество ключей
    - Использование памяти
    - Hit rate (процент попаданий в кэш)
    - Общая статистика обращений

    Attributes:
        total_keys: Общее количество ключей в Redis
        memory_usage_mb: Использование памяти в мегабайтах
        hit_rate: Процент попаданий в кэш (0-100%)
        total_hits: Всего успешных обращений к кэшу
        total_misses: Всего промахов (данных не было в кэше)
        uptime_seconds: Время работы Redis в секундах (опционально)
        cache_patterns: Паттерны используемых ключей (опционально)
        cache_ttl_config: Конфигурация TTL для разных типов данных (опционально)
    """

    total_keys: int = Field(
        ge=0,
        description="Total number of keys in Redis"
    )
    memory_usage_mb: float = Field(
        ge=0.0,
        description="Memory usage in megabytes"
    )
    hit_rate: float = Field(
        ge=0.0,
        le=100.0,
        description="Cache hit rate percentage (0-100%)"
    )
    total_hits: int = Field(
        ge=0,
        description="Total cache hits"
    )
    total_misses: int = Field(
        ge=0,
        description="Total cache misses"
    )
    uptime_seconds: Optional[int] = Field(
        None,
        ge=0,
        description="Redis uptime in seconds"
    )
    cache_patterns: Optional[Dict[str, str]] = Field(
        None,
        description="Cache key patterns in use"
    )
    cache_ttl_config: Optional[Dict[str, int]] = Field(
        None,
        description="TTL configuration for different data types (in seconds)"
    )


class CacheClearResponse(BaseModel):
    """
    Результат операции очистки кэша.

    Используется в:
    - DELETE /api/v1/admin/cache/clear (очистить весь кэш)
    - DELETE /api/v1/admin/cache/clear/{pattern} (очистить по паттерну)

    Attributes:
        success: Успешно ли выполнена операция
        keys_deleted: Количество удаленных ключей
        message: Человекочитаемое сообщение о результате
        timestamp: Время выполнения операции
        pattern: Паттерн удаления (опционально, для pattern-based clear)
        admin_email: Email администратора выполнившего операцию (опционально)
    """

    success: bool = Field(description="Whether the operation was successful")
    keys_deleted: int = Field(
        ge=0,
        description="Number of keys deleted from cache"
    )
    message: str = Field(description="Human-readable result message")
    timestamp: datetime = Field(
        default_factory=datetime.utcnow,
        description="Operation timestamp"
    )
    pattern: Optional[str] = Field(
        None,
        description="Redis key pattern used for deletion (if pattern-based clear)"
    )
    admin_email: Optional[str] = Field(
        None,
        description="Email of the admin who performed the operation"
    )


class QueueInfo(BaseModel):
    """
    Информация об одной очереди задач.

    Используется в QueueStatusResponse для показа состояния
    каждой очереди Celery.

    Attributes:
        name: Название очереди (e.g., 'default', 'parsing', 'image_generation')
        pending: Количество задач в ожидании
        active: Количество активных задач (выполняются сейчас)
        scheduled: Количество запланированных задач (отложенные)
    """

    name: str = Field(description="Queue name (e.g., 'default', 'parsing', 'image_generation')")
    pending: int = Field(
        ge=0,
        description="Number of pending tasks in queue"
    )
    active: int = Field(
        ge=0,
        description="Number of active tasks (currently processing)"
    )
    scheduled: int = Field(
        ge=0,
        description="Number of scheduled tasks (delayed execution)"
    )


class QueueStatusResponse(BaseModel):
    """
    Статус всех очередей задач.

    Используется в GET /api/v1/admin/queues/status (если такой endpoint существует).

    Показывает текущее состояние всех Celery очередей:
    - Количество задач в каждой очереди
    - Активность воркеров
    - Общая нагрузка системы

    Attributes:
        queues: Список информации о каждой очереди
        total_pending: Всего задач в ожидании (суммарно)
        total_active: Всего активных задач (суммарно)
        workers_online: Количество активных воркеров
        message: Человекочитаемое сообщение о статусе
    """

    queues: List[QueueInfo] = Field(
        default_factory=list,
        description="Information about each queue"
    )
    total_pending: int = Field(
        ge=0,
        description="Total pending tasks across all queues"
    )
    total_active: int = Field(
        ge=0,
        description="Total active tasks across all queues"
    )
    workers_online: int = Field(
        ge=0,
        description="Number of online Celery workers"
    )
    message: str = Field(
        default="Queue status retrieved successfully",
        description="Human-readable status message"
    )


class ParsingSettingsResponse(BaseModel):
    """
    Настройки парсинга книг.

    Используется в GET /api/v1/admin/parsing/settings (если такой endpoint существует).

    Показывает текущие настройки системы парсинга:
    - Ограничения по количеству одновременных парсингов
    - Приоритеты по умолчанию
    - Настройки автоматической генерации изображений
    - Режим работы NLP системы
    - Активные NLP процессоры

    Attributes:
        max_concurrent_parsings: Максимум одновременных парсингов
        default_priority: Приоритет по умолчанию (low | normal | high)
        auto_generate_images: Автоматически генерировать изображения после парсинга
        nlp_mode: Режим NLP (SINGLE | PARALLEL | SEQUENTIAL | ENSEMBLE | ADAPTIVE)
        enabled_processors: Список активных NLP процессоров
        ensemble_consensus_threshold: Порог консенсуса для ENSEMBLE режима (опционально)
    """

    max_concurrent_parsings: int = Field(
        ge=1,
        description="Maximum concurrent book parsing operations"
    )
    default_priority: str = Field(
        description="Default parsing priority: low | normal | high",
        pattern="^(low|normal|high)$"
    )
    auto_generate_images: bool = Field(
        description="Automatically generate images after parsing completion"
    )
    nlp_mode: str = Field(
        description="NLP processing mode: SINGLE | PARALLEL | SEQUENTIAL | ENSEMBLE | ADAPTIVE",
        pattern="^(SINGLE|PARALLEL|SEQUENTIAL|ENSEMBLE|ADAPTIVE)$"
    )
    enabled_processors: List[str] = Field(
        default_factory=list,
        description="List of enabled NLP processors (spacy, natasha, stanza, gliner)"
    )
    ensemble_consensus_threshold: Optional[float] = Field(
        None,
        ge=0.0,
        le=1.0,
        description="Consensus threshold for ENSEMBLE mode (0.0-1.0)"
    )


class CacheWarmResponse(BaseModel):
    """
    Результат операции прогрева кэша.

    Используется в POST /api/v1/admin/cache/warm.

    Attributes:
        success: Успешно ли выполнена операция
        message: Человекочитаемое сообщение о результате
        keys_cached: Количество прогретых ключей (опционально)
        cache_types: Типы данных загруженных в кэш (опционально)
    """

    success: bool = Field(description="Whether the operation was successful")
    message: str = Field(description="Human-readable result message")
    keys_cached: Optional[int] = Field(
        None,
        ge=0,
        description="Number of keys cached during warm-up"
    )
    cache_types: Optional[List[str]] = Field(
        None,
        description="Types of data loaded into cache (e.g., 'books', 'users')"
    )


class FeatureFlagBulkUpdateResponse(BaseModel):
    """
    Результат массового обновления feature flags.

    Используется в POST /api/v1/admin/feature-flags/bulk-update.

    Attributes:
        message: Человекочитаемое сообщение о результате
        results: Результаты обновления для каждого флага {flag_name: success}
        total: Всего флагов обновлено
        success_count: Количество успешных обновлений
        failed_count: Количество неудачных обновлений
        admin_email: Email администратора (опционально)
    """

    message: str = Field(description="Human-readable result message")
    results: Dict[str, bool] = Field(
        description="Update results for each flag {flag_name: success}"
    )
    total: int = Field(
        ge=0,
        description="Total flags processed"
    )
    success_count: int = Field(
        ge=0,
        description="Number of successful updates"
    )
    failed_count: int = Field(
        ge=0,
        description="Number of failed updates"
    )
    admin_email: Optional[str] = Field(
        None,
        description="Email of the admin who performed the operation"
    )


# ============================================================================
# NLP Settings Responses (NEW: Phase 1.4)
# ============================================================================


class MultiNLPSettingsUpdateResponse(BaseModel):
    """
    Response после обновления Multi-NLP настроек.

    Используется в PUT /api/v1/admin/multi-nlp-settings.

    Attributes:
        message: Сообщение об успешном обновлении
        settings: Обновленные настройки (MultiNLPSettings from router)
        processors_reloaded: Флаг перезагрузки процессоров
    """

    message: str = Field(
        default="Multi-NLP settings updated successfully",
        description="Success message"
    )
    settings: Dict[str, Any] = Field(
        description="Updated Multi-NLP settings"
    )
    processors_reloaded: bool = Field(
        default=True,
        description="Whether NLP processors were reloaded"
    )


class NLPProcessorStatusResponse(BaseModel):
    """
    Response с детальным статусом NLP процессоров.

    Используется в GET /api/v1/admin/nlp-processor-status.

    Attributes:
        status: Статус операции (success)
        data: Данные о статусе процессоров
        timestamp: Временная метка запроса
    """

    status: str = Field(
        default="success",
        description="Operation status"
    )
    data: Dict[str, Any] = Field(
        description="NLP processor status data"
    )
    timestamp: str = Field(
        description="Request timestamp (ISO 8601)"
    )


class NLPProcessorTestResponse(BaseModel):
    """
    Response с результатами тестирования NLP процессоров.

    Используется в POST /api/v1/admin/nlp-processor-test.

    Attributes:
        status: Статус операции (success)
        test_text: Тестовый текст (первые 200 символов)
        processing_mode: Режим обработки (parallel, ensemble, etc.)
        processors_used: Список использованных процессоров
        total_descriptions: Всего найдено описаний
        processing_time_seconds: Время обработки в секундах
        quality_metrics: Метрики качества
        recommendations: Рекомендации по улучшению
        processor_results: Результаты каждого процессора
        best_descriptions: Топ 5 лучших описаний
        timestamp: Временная метка запроса
    """

    status: str = Field(default="success")
    test_text: str = Field(description="Test text preview (first 200 chars)")
    processing_mode: str
    processors_used: List[str]
    total_descriptions: int = Field(ge=0)
    processing_time_seconds: float = Field(ge=0.0)
    quality_metrics: Dict[str, Any]
    recommendations: List[str]
    processor_results: Dict[str, Any]
    best_descriptions: List[Any]
    timestamp: str


class NLPProcessorInfoResponse(BaseModel):
    """
    Response с информацией о NLP процессоре.

    Используется в GET /api/v1/admin/nlp-processor-info.

    Attributes:
        processor_info: Информация о текущем процессоре
        available_models: Доступные модели для каждого процессора
    """

    processor_info: Dict[str, Any] = Field(
        description="Current NLP processor information"
    )
    available_models: Dict[str, List[str]] = Field(
        description="Available models for each processor type"
    )


# ============================================================================
# Parsing Queue Responses (NEW: Phase 1.4)
# ============================================================================


class ParsingSettingsUpdateResponse(BaseModel):
    """
    Response после обновления настроек парсинга.

    Используется в PUT /api/v1/admin/parsing-settings.

    Attributes:
        message: Сообщение об успешном обновлении
        settings: Обновленные настройки (ParsingSettings from router)
    """

    message: str = Field(
        default="Parsing settings updated successfully",
        description="Success message"
    )
    settings: Dict[str, Any] = Field(
        description="Updated parsing settings"
    )


class ParsingQueueStatusResponse(BaseModel):
    """
    Response с детальным статусом очереди парсинга.

    Используется в GET /api/v1/admin/queue-status.

    Attributes:
        is_parsing_active: Флаг активного парсинга
        current_parsing: Информация о текущем парсинге (опционально)
        queue_size: Размер очереди
        queue_items: Первые 10 элементов очереди
        error: Сообщение об ошибке (опционально)
    """

    is_parsing_active: bool = Field(
        description="Whether parsing is currently active"
    )
    current_parsing: Optional[Any] = Field(
        None,
        description="Information about current parsing job"
    )
    queue_size: int = Field(
        ge=0,
        description="Number of items in parsing queue"
    )
    queue_items: List[Any] = Field(
        default_factory=list,
        description="First 10 items in queue"
    )
    error: Optional[str] = Field(
        None,
        description="Error message if queue check failed"
    )


class ClearQueueResponse(BaseModel):
    """
    Response после очистки очереди парсинга.

    Используется в POST /api/v1/admin/clear-queue.

    Attributes:
        message: Сообщение об успешной очистке
    """

    message: str = Field(
        default="Parsing queue cleared successfully",
        description="Success message"
    )


class UnlockParsingResponse(BaseModel):
    """
    Response после разблокировки парсинга.

    Используется в POST /api/v1/admin/unlock-parsing.

    Attributes:
        message: Сообщение об успешной разблокировке
    """

    message: str = Field(
        default="Parsing lock removed successfully",
        description="Success message"
    )


# ============================================================================
# System Settings Responses (NEW: Phase 1.4)
# ============================================================================


class SystemSettingsUpdateResponse(BaseModel):
    """
    Response после обновления системных настроек.

    Используется в PUT /api/v1/admin/system-settings.

    Attributes:
        message: Сообщение об успешном обновлении
        settings: Обновленные настройки (SystemSettings from router)
    """

    message: str = Field(
        default="System settings saved successfully",
        description="Success message"
    )
    settings: Dict[str, Any] = Field(
        description="Updated system settings"
    )


class InitializeSettingsResponse(BaseModel):
    """
    Response после инициализации настроек по умолчанию.

    Используется в POST /api/v1/admin/initialize-settings.

    Attributes:
        message: Сообщение о результате инициализации
    """

    message: str = Field(
        description="Result message (initialized | already exist)"
    )


class ImageGenerationSettingsUpdateResponse(BaseModel):
    """
    Response после обновления настроек генерации изображений.

    Используется в PUT /api/v1/admin/image-generation-settings.

    Attributes:
        message: Сообщение об успешном обновлении
        settings: Обновленные настройки
    """

    message: str = Field(
        default="Image generation settings saved successfully",
        description="Success message"
    )
    settings: Dict[str, Any] = Field(
        description="Updated image generation settings"
    )


# ============================================================================
# Feature Flag Additional Responses (TD-P16-1c)
# ============================================================================


class FeatureFlagUpdateResponse(BaseModel):
    """Response for PUT /admin/feature-flags/{flag_name}."""

    message: str
    flag: Optional[Dict[str, Any]] = None
    admin: str


class FeatureFlagCacheClearResponse(BaseModel):
    """Response for DELETE /admin/feature-flags/cache."""

    message: str = Field(default="Feature flags cache cleared successfully")
    admin: str


class FeatureFlagInitializeResponse(BaseModel):
    """Response for POST /admin/feature-flags/initialize."""

    message: str = Field(default="Default feature flags initialized")
    total_flags: int = Field(ge=0)
    admin: str


class FeatureFlagCategoryItem(BaseModel):
    """Single category item in categories list."""

    value: str
    label: str
    description: str


class FeatureFlagCategoriesResponse(BaseModel):
    """Response for GET /admin/feature-flags/categories/list."""

    categories: List[FeatureFlagCategoryItem]
    total: int = Field(ge=0)


# ============================================================================
# EXPORTS
# ============================================================================

__all__ = [
    "CacheStatsResponse",
    "CacheClearResponse",
    "QueueInfo",
    "QueueStatusResponse",
    "ParsingSettingsResponse",
    "CacheWarmResponse",
    "FeatureFlagBulkUpdateResponse",
    # NLP Settings (Phase 1.4)
    "MultiNLPSettingsUpdateResponse",
    "NLPProcessorStatusResponse",
    "NLPProcessorTestResponse",
    "NLPProcessorInfoResponse",
    # Parsing Queue (Phase 1.4)
    "ParsingSettingsUpdateResponse",
    "ParsingQueueStatusResponse",
    "ClearQueueResponse",
    "UnlockParsingResponse",
    # System Settings (Phase 1.4)
    "SystemSettingsUpdateResponse",
    "InitializeSettingsResponse",
    # Image Generation Settings (Phase 1.4)
    "ImageGenerationSettingsUpdateResponse",
    # Feature Flags (TD-P16-1c)
    "FeatureFlagUpdateResponse",
    "FeatureFlagCacheClearResponse",
    "FeatureFlagInitializeResponse",
    "FeatureFlagCategoryItem",
    "FeatureFlagCategoriesResponse",
]
