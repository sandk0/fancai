---
phase: 02-dead-code-cleanup
plan: 01
subsystem: infra
tags: [nlp, celery, settings, cleanup, dead-code]

# Dependency graph
requires:
  - phase: 01-production-safety
    provides: "Phase 1 уже удалила NLP-поля из config.py (SPACY_MODEL, NLTK_DATA_PATH, MULTI_NLP_MODE, validate_nlp_weights)"
provides:
  - "Чистый корень backend/ без осиротевших test_*.py файлов"
  - "celery_config.py удалён, все ссылки проверены"
  - "settings_manager.py без 5 NLP-секций и get_processor_config()"
  - "ParserStatusResponse без поля nlp_available"
  - "validation.py без nlp_available=True"
affects: [02-dead-code-cleanup, 03-openrouter-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Разделение git rm (tracked) и rm (untracked) при удалении осиротевших файлов"

key-files:
  created: []
  modified:
    - "backend/app/services/settings_manager.py"
    - "backend/app/routers/books/validation.py"
    - "backend/app/schemas/responses/books_validation.py"

key-decisions:
  - "nlp_available убрано из ParserStatusResponse схемы полностью — поле больше не нужно, LLM-based extraction не требует флага наличия NLP"
  - "10 untracked test files (test_advanced_parser*.py и др.) существовали на диске но не в git — удалены через rm, не git rm"
  - "Предсуществующие тестовые ошибки (test_gemini_extractor.py, test_langextract_processor.py) не из области этого плана — задокументированы как deferred"

patterns-established:
  - "Перед удалением — grep-проверка на импорты/ссылки (использован для celery_config)"
  - "Проверять git ls-tree перед git rm для файлов, которые могут быть untracked"

requirements-completed:
  - CLEAN-01
  - CLEAN-02
  - CLEAN-03

# Metrics
duration: 11min
completed: 2026-03-01
---

# Phase 2, Plan 01: Удаление мёртвого кода — осиротевшие файлы и NLP-конфиги

**Удалено ~1400 строк мёртвого кода: 14 test_*.py из корня backend/, celery_config.py, 2 NLP-скрипта, 5 NLP-секций из settings_manager.py и поле nlp_available из схемы ParserStatusResponse**

## Производительность

- **Длительность:** 11 мин
- **Начало:** 2026-03-01T16:32:29Z
- **Завершение:** 2026-03-01T16:43:59Z
- **Задачи:** 2 из 2
- **Файлов изменено:** 10 (7 удалено через git, 10 удалено через rm, 3 модифицировано)

## Достижения

- Удалены 14 осиротевших тестовых файлов из корня `backend/` (NLP-эра, декабрь 2025)
- Удалены `celery_config.py`, `nlp_rollback.py`, `benchmark_nlp_refactoring.py` — мёртвые файлы без живых импортов
- `settings_manager.py` очищен от 5 NLP-секций (nlp_global, nlp_spacy, nlp_natasha, nlp_stanza, nlp_gliner) и метода `get_processor_config()`
- `ParserStatusResponse` схема обновлена: удалено поле `nlp_available` — NLP больше не является отдельным компонентом, используется LLM-based extraction
- `config.py` подтверждённо чист от NLP-полей (CLEAN-02 закрыт для обоих файлов)

## Коммиты задач

1. **Task 1: Удалить осиротевшие файлы без зависимостей** — `a23d5a8` (chore)
2. **Task 2: Очистить NLP-конфигурацию из settings_manager.py и validation.py** — `54543c9` (chore)

## Изменённые файлы

### Удалены (git rm — tracked)
- `backend/test_api_flow.py` — осиротевший тест API
- `backend/test_api_image_generation.py` — осиротевший тест генерации изображений
- `backend/test_image_generation.py` — осиротевший тест генерации изображений
- `backend/test_nlp_processors.py` — осиротевший тест NLP-процессоров
- `backend/app/core/celery_config.py` — мёртвый конфиг Celery (функциональность перенесена в celery_app.py)
- `backend/scripts/nlp_rollback.py` — мёртвый NLP-скрипт
- `backend/scripts/benchmark_nlp_refactoring.py` — мёртвый NLP-скрипт

### Удалены (rm — untracked, не были в git)
- `backend/test_advanced_parser_adapter_simple.py`
- `backend/test_advanced_parser_integration.py`
- `backend/test_advanced_parser_simple.py`
- `backend/test_advanced_parser.py`
- `backend/test_deeppavlov_integration.py`
- `backend/test_dependency_parsing.py`
- `backend/test_enrichment_integration.py`
- `backend/test_gliner_integration.py`
- `backend/test_llm_enricher.py`
- `backend/test_week1_integration.py`

### Модифицированы
- `backend/app/services/settings_manager.py` — удалены 5 NLP-секций и get_processor_config()
- `backend/app/routers/books/validation.py` — удалено nlp_available=True из endpoint
- `backend/app/schemas/responses/books_validation.py` — удалено поле nlp_available из ParserStatusResponse

## Принятые решения

- **nlp_available убрано полностью из схемы** — поле было Legacy NLP-артефактом. LLM-based extraction (Gemini) не требует флага "NLP доступен". Схема API упрощена.
- **10 untracked файлов** — test_advanced_parser*.py и другие не были добавлены в git (работали вне VCS). Удалены через `rm`.
- **Предсуществующие тестовые ошибки** — `test_gemini_extractor.py` (missing JSONResponseParser) и `test_langextract_processor.py` (missing module) существуют до этого плана. Подтверждено git stash. Задокументированы в deferred-items, не исправлялись.

## Отклонения от плана

### Авто-исправленные проблемы

**1. [Rule 1 - Bug] Удалён комментарий с nlp_spacy в docstring settings_manager.py**
- **Найдено во время:** Task 2 (grep-верификация)
- **Проблема:** docstring метода `get_setting()` содержал `'nlp_spacy'` как пример — grep-верификация показала 1 оставшуюся ссылку
- **Исправление:** Заменён пример на `'parsing', 'image_generation'` — актуальные категории
- **Файлы:** `backend/app/services/settings_manager.py`
- **Коммит:** `54543c9`

---

**Всего отклонений:** 1 авто-исправлено (Rule 1 — комментарий в docstring)
**Влияние:** Минимальное — исправление документационного артефакта. Scope не расширялся.

## Обнаруженные проблемы

Предсуществующие тестовые ошибки (не из области этого плана):
- `tests/services/test_gemini_extractor.py` — `ImportError: cannot import name 'JSONResponseParser'` (удалён в Phase 1)
- `tests/services/test_langextract_processor.py` — `ModuleNotFoundError: No module named 'app.services.langextract_processor'` (удалён в Phase 1)

Эти ошибки подтверждены как предсуществующие через `git stash`. Задокументированы в `deferred-items.md` для будущей очистки.

## Настройка пользователем

Не требуется — никаких внешних сервисов не затронуто.

## Готовность к следующему плану

- Корень `backend/` чист — больше нет test_*.py файлов, мешающих навигации
- `settings_manager.py` готов к дальнейшей очистке (план 02-02)
- CLEAN-01, CLEAN-02, CLEAN-03 закрыты
- Следующий план: 02-02 (очистка мёртвых роутеров и сервисов NLP)

---
*Phase: 02-dead-code-cleanup*
*Completed: 2026-03-01*
