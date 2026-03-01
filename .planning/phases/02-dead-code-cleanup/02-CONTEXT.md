# Phase 2: Очистка мертвого кода - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Удалить все остатки NLP-системы (удалена в декабре 2025), исправить TODO-заглушки в sync.py, удалить мертвые конфиги. После этой фазы каждое поле конфигурации используется, каждый endpoint делает то, что заявляет, и никаких артефактов NLP, которые могут запутать будущую разработку.

</domain>

<decisions>
## Implementation Decisions

### Глубина очистки
- **Глубокая зачистка** — удалить ВСЕ NLP-артефакты во всей кодовой базе (~18 файлов, ~1400+ строк мертвого кода), а не только 5 пунктов из CLEAN-01..05
- Включает: тестовые файлы, конфиги, скрипты, ссылки в сервисах, схемы, закомментированные импорты

### Тестовые файлы в корне backend/
- Удалить ВСЕ осиротевшие тестовые файлы из корня backend/ — не только NLP-тесты
- Если файл — тест, он должен быть в backend/tests/, а не в корне
- Список: test_nlp_processors.py, test_gliner_integration.py и любые другие root-level test_*.py

### Скрипты
- Claude's Discretion: проверить все скрипты в backend/scripts/ на живучесть, удалить явно мертвые (nlp_rollback.py, benchmark_nlp_refactoring.py), оставить неоднозначные

### Миграции базы данных
- **Не удалять миграции** — файлы миграций (2025_11_23_add_nlp_rollout_config.py, 2025_12_16_remove_nlp_system.py) остаются навсегда. Цепочка миграций должна быть целостной для свежих установок

### NLPAnalysisResult в API-схемах
- Claude's Discretion: удалить NLPAnalysisResult из схем описаний (descriptions.py) и исправить всё, что сломается на обеих сторонах (бэкенд + фронтенд)

### Админ-панель
- Удалить все NLP-специфичные поля из админ-схем ответов (nlp_mode и др.) — админ-панель должна отражать реальность
- Claude's Discretion: удалить NLP-настройки из settings_manager.py, починить админ-UI если это просто, пропустить если сложно

### Sync endpoint (CLEAN-04)
- Не обсуждалось детально — используются дефолты из требований: возвращать 501 Not Implemented с понятным сообщением вместо тихого сбоя

### Celery config (CLEAN-03)
- Не обсуждалось детально — используются дефолты из требований: удалить мертвый celery_config.py, убедиться что ничто его не импортирует

### Claude's Discretion
- Подход к скриптам в backend/scripts/ (удалить явно мертвые, оставить неоднозначные)
- Глубина починки фронтенда при удалении NLPAnalysisResult из API-ответов
- Сложность починки админ-UI при удалении NLP-настроек из settings_manager.py
- Стратегия верификации: как убедиться, что ничего не сломалось после удаления
- Порядок удаления (что удалять первым)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- Существующие тесты в backend/tests/ могут служить образцом для верификации после очистки
- backend/app/core/celery_app.py — живая конфигурация Celery (в отличие от мертвого celery_config.py)

### Established Patterns
- NLP-система была удалена в декабре 2025, но очистка была неполной
- config.py использует Pydantic Settings с валидаторами — удаление NLP-полей и validate_nlp_weights() безопасно
- settings_manager.py инициализирует настройки при первом запуске — NLP-секции никогда не используются
- Описания используют Dict-based формат (после удаления NLP), но NLPAnalysisResult всё ещё в схемах

### Integration Points
- backend/app/schemas/responses/descriptions.py → NLPAnalysisResult используется в ответах описаний → фронтенд types/api.ts может иметь соответствующие типы
- backend/app/services/description_extraction_service.py → создает NLPAnalysisResult объекты
- backend/app/routers/books/processing.py → закомментированный NLP import
- backend/app/routers/books/validation.py → nlp_available=True hardcoded
- backend/app/schemas/responses/admin.py → nlp_mode в системном статусе
- backend/app/services/settings_manager.py → 5 NLP-секций настроек + get_processor_config()
- backend/app/core/celery_config.py → NLP_CACHE_CONFIG + возможно живые Celery настройки
- backend/app/services/feature_flag_manager.py → docstring упоминает NLP flags

### Найденные NLP-артефакты (полный перечень)
**Тесты (корень backend/):**
- test_nlp_processors.py (128 строк)
- test_gliner_integration.py (277 строк)

**Конфиги:**
- config.py: строки 79-90 (7 NLP-полей), строки 193-214 (validate_nlp_weights)
- settings_manager.py: строки 100-165 (5 NLP-секций), строка 357 (get_processor_config)
- celery_config.py: строки 139-146 (NLP_CACHE_CONFIG)

**Схемы:**
- descriptions.py: NLPAnalysisResult класс (строка 40), ссылки на строках 90, 135, 227
- books_validation.py: nlp_available (строка 208)
- admin.py: nlp_mode поле

**Сервисы:**
- description_extraction_service.py: создает NLPAnalysisResult
- feature_flag_manager.py: docstring ссылки
- book/book_parsing_service.py: комментарий про удаление NLP

**Роутеры:**
- books/processing.py: закомментированный import (строка 120)
- books/validation.py: nlp_available=True (строка 43)

**Скрипты:**
- scripts/nlp_rollback.py (471 строка)
- scripts/benchmark_nlp_refactoring.py (176 строк)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-dead-code-cleanup*
*Context gathered: 2026-03-01*
