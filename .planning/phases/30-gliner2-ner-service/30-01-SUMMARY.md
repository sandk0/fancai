---
phase: 30-gliner2-ner-service
plan: 01
subsystem: ai-pipeline
tags: [gliner2, ner, entity-extraction, chunking, razdel, deberta, prometheus]

requires:
  - phase: 29-docker-db
    provides: "Dockerfile.celery с PyTorch, Docker volume nlp_models, feature flag USE_GLINER_NER"
provides:
  - "NERService — lazy singleton для entity extraction через GLiNER2"
  - "TextChunker — sentence-level chunking с razdel для русского текста"
  - "NERAdapter — raw entities -> ExtractedEntity/ChapterAnalysisResult"
  - "Feature flag routing в book_tasks.py (USE_GLINER_NER)"
  - "NER Prometheus метрики (duration, entity count, chunks)"
  - "30 unit-тестов (chunker, adapter, service) с mock GLiNER2"
affects: [30-02, 31-classifier, consistency_manager]

tech-stack:
  added: [razdel==0.5.0]
  patterns: [lazy-singleton-ner, sentence-chunking-with-overlap, label-map-adapter]

key-files:
  created:
    - backend/app/services/ner_service.py
    - backend/tests/services/test_ner_chunker.py
    - backend/tests/services/test_ner_adapter.py
    - backend/tests/services/test_ner_service.py
  modified:
    - backend/app/monitoring/metrics.py
    - backend/app/tasks/book_tasks.py
    - backend/requirements.txt

key-decisions:
  - "SettingsManager API — get_setting (не get), инициализируется один раз перед циклом по главам"
  - "Метрики импортируются локально внутри extract_chapter для избежания circular imports"
  - "GLiNER2 predict_entities нормализуется: score->confidence, word->text для единого формата"
  - "organization маппится в object (EntityType enum не содержит organization)"

patterns-established:
  - "NER singleton: get_ner_service() с threading.Lock, паттерн аналогичен get_gemini_extractor()"
  - "Sentence-level chunking: razdel.sentenize() + DeBERTa tokenizer для точного token count"
  - "Label map adapter: LABEL_MAP dict для маппинга GLiNER2 labels -> EntityType values"
  - "Feature flag routing: snapshot use_gliner перед циклом, asyncio.to_thread для синхронного inference"

requirements-completed: [NER-01, NER-02, NER-03]

duration: 13min
completed: 2026-03-24
---

# Phase 30 Plan 01: NERService Summary

**NERService lazy singleton с GLiNER2 entity extraction, sentence-level chunking через razdel, adapter для backward compatibility с ConsistencyManager, feature flag routing в book_tasks.py**

## Производительность

- **Длительность:** 13 мин
- **Начало:** 2026-03-24T02:15:08Z
- **Завершение:** 2026-03-24T02:28:00Z
- **Задачи:** 3/3
- **Файлы изменены:** 7

## Результаты

- NERService извлекает entities из текста через GLiNER2 с корректными character offsets и lazy-loaded моделью
- TextChunker разбивает главы >384 DeBERTa-токенов на чанки с 2-предложенным sentence-level overlap
- NERAdapter конвертирует raw entities в ExtractedEntity/ChapterAnalysisResult, совместимый с ConsistencyManager
- Feature flag routing: при USE_GLINER_NER=true pipeline использует NERService, при false — LLM (Gemini)
- 30 unit-тестов проходят с mock GLiNER2 (9 chunker + 13 adapter + 8 service)

## Коммиты задач

1. **Task 1: NERService, TextChunker, NERAdapter + тесты chunker/adapter** — `c810ea9` (feat)
2. **Task 2: Интеграция NERService в pipeline через feature flag** — `207943a` (feat)
3. **Task 3: Unit-тесты NERService с mock GLiNER2** — `d0d302a` (test)

## Созданные/изменённые файлы

- `backend/app/services/ner_service.py` — NERService, TextChunker, NERAdapter, deduplicate_overlap_entities, get_ner_service singleton
- `backend/app/monitoring/metrics.py` — NER Prometheus метрики (ner_extraction_duration_seconds, ner_entities_extracted_total, ner_chunks_processed_total)
- `backend/app/tasks/book_tasks.py` — Feature flag routing USE_GLINER_NER, asyncio.to_thread для NER inference
- `backend/requirements.txt` — razdel==0.5.0
- `backend/tests/services/test_ner_chunker.py` — 9 тестов TextChunker
- `backend/tests/services/test_ner_adapter.py` — 13 тестов NERAdapter + deduplicate
- `backend/tests/services/test_ner_service.py` — 8 тестов NERService с mock

## Принятые решения

- **SettingsManager API**: метод `get_setting` (не `get` как в интерфейсе плана), инициализируется один раз перед циклом по главам, не внутри process_chapter_safe
- **Метрики (local import)**: `from app.monitoring.metrics import ...` внутри extract_chapter для избежания circular imports при загрузке модуля
- **GLiNER2 output normalization**: predict_entities возвращает `score`/`word`, нормализуем в `confidence`/`text` для единого формата
- **organization -> object**: EntityType enum не содержит organization, маппим в object согласно D-10

## Отклонения от плана

### Авто-исправленные проблемы

**1. [Rule 1 - Bug] SettingsManager API mismatch**
- **Обнаружено в:** Task 1 (реализация NERService)
- **Проблема:** План указывал `settings_manager.get("ner", "labels")`, реальный API — `settings_manager.get_setting("ner", "labels")`
- **Исправление:** Использован корректный метод `get_setting`
- **Файлы:** backend/app/services/ner_service.py
- **Коммит:** c810ea9

**2. [Rule 3 - Blocking] Тесты не запускались из-за security validation**
- **Обнаружено в:** Task 1 (запуск тестов)
- **Проблема:** conftest.py загружает app.main -> Settings() с security checks (SECRET_KEY, REDIS_URL, METRICS_PASSWORD)
- **Исправление:** Запуск тестов с CI=true для bypass security validation (стандартный подход проекта)
- **Файлы:** нет изменений (env variable)
- **Коммит:** —

**3. [Rule 1 - Bug] Patch path для mock метрик в тестах NERService**
- **Обнаружено в:** Task 3 (тесты NERService)
- **Проблема:** Метрики импортируются локально внутри extract_chapter, patch `app.services.ner_service.record_*` не работает
- **Исправление:** Patch на источнике: `app.monitoring.metrics.record_*`
- **Файлы:** backend/tests/services/test_ner_service.py
- **Коммит:** d0d302a

---

**Всего отклонений:** 3 авто-исправлено (2 bug, 1 blocking)
**Влияние на план:** Все исправления необходимы для корректности. Scope не изменён.

## Проблемы

- Coverage threshold (70%) не достигнут при запуске только NER-тестов — ожидаемо, это подмножество всех тестов

## Настройка пользователя

Не требуется — нет внешних сервисов для настройки.

## Готовность к следующей фазе

- NERService полностью реализован и интегрирован через feature flag
- Готово для Plan 02 (A/B тестирование NER vs LLM на fixture данных)
- ConsistencyManager работает без изменений с NER output

## Self-Check: PASSED

- Все 7 файлов существуют
- Все 3 коммита (c810ea9, 207943a, d0d302a) найдены в git log

---
*Phase: 30-gliner2-ner-service*
*Completed: 2026-03-24*
