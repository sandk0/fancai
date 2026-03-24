# Phase 30: GLiNER2 NER Service - Context

**Gathered:** 2026-03-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Локальная entity extraction через GLiNER2, заменяющая LLM для NER. Chunking текста глав, adapter для backward compatibility с ConsistencyManager, A/B тест на 5 книгах vs LLM baseline. Description extraction и relationships остаются на LLM (Phase 31+).

</domain>

<decisions>
## Implementation Decisions

### Точка интеграции NER
- **D-01:** NERService — отдельный этап, запускается ДО LLM extraction. При `USE_GLINER_NER=true` entity extraction идёт через GLiNER2, LLM потом извлекает только descriptions/relationships. Совместимо с Phase 31 classifier.
- **D-02:** Один Celery task: process_book_task вызывает NERService и LLM последовательно. concurrency=1 уже сериализует.
- **D-03:** NERService — lazy singleton на worker. Модель загружается при первом вызове, персистит между книгами (~800MB RAM). Паттерн как D-07 из Phase 29.
- **D-04:** Entity labels настраиваемые, хранятся в Settings таблице. Меняются через admin API без редеплоя. Default: `['person', 'location', 'artifact', 'organization']`.
- **D-05:** Метрики: latency на chunk, entities на главу, общее время на книгу, количество chunks. Через существующий `metrics.py`.

### Chunking стратегия
- **D-06:** Sentence splitting через `razdel.sentenize()` — лёгкая Python-библиотека для русского текста (~50KB, без тяжёлых зависимостей).
- **D-07:** Sentence overlap: последние 2-3 предложения предыдущего chunk повторяются в начале следующего. Entity spans в overlap zone дедуплицируются по character offset exact match (оставляем entity с большим confidence).
- **D-08:** Подсчёт токенов через DeBERTa tokenizer (AutoTokenizer от модели GLiNER2). Точный подсчёт вместо приближённого.
- **D-09:** Короткие главы (< max_tokens) обрабатываются как один chunk без split.

### Маппинг entity types
- **D-10:** GLiNER2 labels → EntityType маппинг: person→character, location→location, artifact→object, organization→organization.
- **D-11:** Поля visual_summary, aliases, importance, chapter_event_action, chapter_event_inner — пустые defaults. Phase 33 (LLM Synthesis) обогатит за один batch вызов.
- **D-12:** Минимальная длина entity имени ≥ 2 символов. Однобуквенные токены отфильтровываются.
- **D-13:** Adapter агрегирует множественные mentions одного entity в главе: один ExtractedEntity с first_mention_offset = минимальный offset, confidence = среднее.
- **D-14:** Backward compatibility: adapter создаёт ChapterAnalysisResult(entities=[...], descriptions=[], relationships=[]). ConsistencyManager работает без изменений.

### A/B тестирование
- **D-15:** LLM baseline берётся из production DB — entities уже извлечены для существующих книг.
- **D-16:** Совпадение определяется fuzzy matching как в ConsistencyManager: casefold + SequenceMatcher(>0.75) + token overlap(>=0.5).
- **D-17:** Формат — pytest с fixture. test_ner_ab_comparison.py, `assert recall >= 0.80`.
- **D-18:** Test data: экспорт chapter.content из production DB для 5 книг как fixture файлы. Тест работает offline без DB.

### Claude's Discretion
- Chunk size в токенах (ориентир: 384-448 из 512 max)
- Количество предложений в overlap (2-3)
- Структура NERService класса (инициализация, warm-up, error handling)
- Выбор конкретных 5 книг для A/B теста
- Формат fixture файлов для тестовых данных
- Обработка пустых полей в adapter (visual_summary='', aliases=[], importance=5, events=None)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Текущий pipeline
- `backend/app/services/gemini_extractor.py` — ExtractedEntity dataclass (строка 114), ChapterAnalysisResult, текущая LLM extraction
- `backend/app/services/consistency_manager.py` — process_chapter_analysis(), entity resolution алгоритм (fuzzy, aliases, token overlap)
- `backend/app/tasks/book_tasks.py` — process_book_task, _process_book_async, текущий flow обработки книги

### Infrastructure (из Phase 29)
- `docker-compose.prod.yml` — Celery worker с 4GB RAM, volume nlp_models
- `backend/Dockerfile.celery` — образ с PyTorch CPU-only
- `backend/app/core/celery_app.py` — heavy queue, task routing

### Feature flags и модели
- `backend/scripts/initialize_feature_flags.py` — USE_GLINER_NER flag
- `backend/app/services/feature_flag_manager.py` — FeatureFlagManager API
- `backend/app/models/entity.py` — Entity модель с extraction_source, pipeline_version
- `backend/app/models/description.py` — Description модель

### Метрики
- `backend/app/monitoring/metrics.py` — существующие LLM метрики (паттерн для NER метрик)

### Research
- `docs/research/rag-nlp-optimization-research.md` — исследование GLiNER2, стоимостная модель, benchmarks
- `.planning/research/PITFALLS.md` — риски NER на русском

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ConsistencyManager` — batch entity resolution с fuzzy matching, advisory locks. Работает без изменений через adapter.
- `ExtractedEntity` dataclass — целевой формат для adapter. Все поля задокументированы.
- `ChapterAnalysisResult` — контейнер для entities/descriptions/relationships.
- `FeatureFlagManager` — routing через `USE_GLINER_NER` flag.
- `metrics.py` — record_* функции для Prometheus метрик.

### Established Patterns
- Lazy singleton: `get_gemini_extractor()` — паттерн для NERService singleton.
- Docker volume: `nlp_models` volume с HF_HOME=/models для кэширования моделей.
- Celery task: process_book_task → asyncio.run(task_wrapper()) с Redis lock.

### Integration Points
- `book_tasks.py` `_process_book_async()` — точка вставки NERService вызова перед LLM extraction.
- `backend/requirements.txt` — добавить gliner, razdel.
- `backend/app/services/` — новый файл ner_service.py.
- `backend/tests/services/` — тесты для NERService, chunker, adapter.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — стандартные ML engineering паттерны.

</specifics>

<deferred>
## Deferred Ideas

None — обсуждение осталось в рамках Phase 30.

</deferred>

---

*Phase: 30-gliner2-ner-service*
*Context gathered: 2026-03-24*
