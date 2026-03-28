# Финальный консолидированный аудит: Modal/vLLM batch processing — все отчёты

## Контекст

**Дата аудита**: 27 марта 2026 года
**Аудитор**: Claude Opus 4.6 (max effort) на основе веб-верификации
**Проект**: fancai.ru — Fiction reader с AI-иллюстрациями и интерактивным глоссарием

### Текущий production-стек

```
GPU: Modal L40S (48GB GDDR6X, 864 GB/s bandwidth)
Модель: Qwen/Qwen3.5-9B (гибридная: 24 GatedDeltaNet + 8 Full Attention)
vLLM: v0.18.0
Modal SDK: ~1.4.0
Backend: FastAPI + Celery + PostgreSQL + Redis
Текущее состояние: Modal pipeline включён в production, но работает в sequential mode (по 1 главе за .remote() вызов)
```

### Документы для аудита

Ты должен **тщательно прочитать все 5 документов** перед началом аудита (все файлы в `docs/research/`):

1. **`modal-parallel-batch-processing.md`** (~1500 строк) — Оригинальное исследование: vLLM batch API, Modal patterns, Qwen3.5, cold start, structured output, предложенный код, benchmarks.

2. **`modal-parallel-batch-processing-AUDIT.md`** (~420 строк) — Первый аудит (Claude Opus). Оценка: 7.5/10. Нашёл 3 критические ошибки: неверный синтаксис `backend="guidance"` в StructuredOutputsParams, незнание sleep mode в LLM class, `compilation_config` как dict.

3. **`parallel-batch-audit-final.md`** (~95 строк) — Второй аудит (Gemini). Оценка: 8.5/10. Утверждает, что Issue #16732 и #37121 уже исправлены в v0.18.0, упрощает error handling, даёт оптимистичные benchmarks.

4. **`parallel-batch-audit-final-AUDIT.md`** (~254 строки) — Аудит второго аудита (Claude Opus). Оценка Gemini-аудита: 4.5/10. Выявил, что Gemini-аудит выдаёт гипотезы за факты: Issues #16732 и #37121 НЕ исправлены, `finish_reason="error"` не доказан как механизм batch isolation.

5. **`modal-parallel-batch-consensus-report.md`** (~843 строки) — Итоговый consensus-отчёт. Включает проверку реального production кода и логов через SSH. Ключевой вывод: Modal уже в проде, но в sequential mode; structured JSON ломается; timeout 600s реально режет главы; книги маркируются как успешные при 10/23 failed chapters. Предлагает план из 9 приоритетов (P0-P9).

### Цель аудита

Провести **финальный, глубокий и исчерпывающий** аудит **всех пяти** документов как единого корпуса. Не просто перепроверить отдельные факты — а построить **одну консолидированную картину** того, что верно, что неверно, что упущено, и какой план действий на самом деле нужен.

Этот аудит — последний этап перед планированием имплементации. Его результат должен быть **ready for implementation planning** — без "нужно ещё исследовать".

---

## Задачи аудита

### Блок A: Перекрёстная верификация — разрешение противоречий между документами

Пять документов содержат **прямые противоречия**. Для каждого противоречия — определи, какой документ прав, с source verification через актуальные веб-источники.

#### A1. Issue #16732 (per-request error handling в batch)

- **Оригинал**: "закрыт как not planned" → ошибка одного запроса убивает batch
- **Первый аудит**: подтвердил — закрыт, not planned
- **Gemini-аудит**: "OUTDATED — в v0.18.0 добавлена изоляция, `finish_reason="error"`"
- **Аудит Gemini**: "INCORRECT — issue всё ещё открыт"
- **Consensus**: "не подтверждено, что исправлен"

**Задача**: Найти ТОЧНЫЙ статус Issue #16732 на март 2026. Если он действительно закрыт — найти PR/commit, который добавил batch error isolation. Проверить, есть ли `finish_reason="error"` в enum `FinishReason` в vLLM v0.18.0. Есть ли альтернативные механизмы per-request isolation (внутренний try/catch в scheduler)?

#### A2. Issue #37121 (7x KV cache overestimation для Qwen3.5)

- **Оригинал**: "Баг. Override=512 необходим. PR #37124 в review."
- **Первый аудит**: "PR #37124 закрыт, superseded #37429 (open)"
- **Gemini-аудит**: "FIXED в v0.18.0, layer-aware allocation"
- **Аудит Gemini**: "INCORRECT — issue открыт, fix не merged"
- **Consensus**: "не подтверждено как fixed"

**Задача**: Найти ТОЧНЫЙ статус #37121 и #37429 на 27 марта 2026. Проверить release notes vLLM 0.18.0 — включён ли fix? Есть ли "Hybrid KV Cache Manager" в 0.18.0? Нужен ли по-прежнему `num_gpu_blocks_override`?

#### A3. Sleep mode для vLLM LLM class

- **Оригинал**: "LLM class не имеет sleep/wake API"
- **Первый аудит**: "INCORRECT — `enable_sleep_mode=True` + `llm.sleep()/wake_up()` работают"
- **Gemini-аудит**: "Snapshot не требует server mode"
- **Consensus**: не затрагивает напрямую

**Задача**: Верифицировать, что `LLM(enable_sleep_mode=True)` + `llm.sleep(level=1)` действительно работает в vLLM v0.18.0. Проверить, совместимо ли это с `@modal.enter(snap=True)`. Найти конкретные примеры или issues. Есть ли ограничения для гибридных моделей (Mamba/DeltaNet)?

#### A4. Синтаксис backend для structured output

- **Оригинал**: `StructuredOutputsParams(json=schema_json, backend="guidance")`
- **Первый аудит**: "INCORRECT — `_backend` private field, используй `LLM(guided_decoding_backend="guidance")`"
- **Gemini-аудит**: "XGrammar лучше для batch с фиксированной схемой"
- **Consensus**: не затрагивает

**Задача**: Проверить исходный код `vllm/sampling_params.py` через GitHub на март 2026. Действительно ли `_backend` с `init=False`? Или в v0.18.0 появился публичный `backend` parameter? Может ли `GuidedDecodingParams` в `SamplingParams` задавать backend per-request? Проверить точный синтаксис для offline mode.

#### A5. `compilation_config` — dict vs CompilationConfig

- **Оригинал**: `compilation_config={"cudagraph_capture_sizes": [...]}`
- **Первый аудит**: "PARTIALLY INCORRECT — нужен CompilationConfig object"

**Задача**: Проверить через vLLM source code и docs — принимает ли `LLM()` конструктор plain dict для `compilation_config`? Есть ли автоконверсия? Или только `CompilationConfig`?

### Блок B: Верификация consensus-рекомендаций

Consensus-отчёт предлагает 10 приоритетов (P0-P9). Проверить каждый на полноту и корректность.

#### B1. P0 — Стабилизация production semantics

- Consensus говорит: не ставить `descriptions_extracted=True` при failed chapters.
- **Задача**: Прочитать текущий код `backend/app/tasks/book_tasks.py` и проверить, как именно устанавливается `descriptions_extracted`. Корректно ли описана проблема? Есть ли edge cases, которые consensus упустил?

#### B2. P2 — maxLength в schemas

- Все документы рекомендуют добавить `maxLength`.
- **Задача**: Проверить через vLLM docs/source — уважает ли xgrammar backend `maxLength` из JSON Schema? Или это только для guidance/LLGuidance? Не приведёт ли `maxLength` к некорректному truncation (модель обрежет описание на полуслове)? Какие значения оптимальны?

#### B3. P7 — Chunked sub-batch

- Consensus рекомендует sub-batch 4→8→12 вместо monolithic batch 23.
- **Задача**: Проверить, как vLLM scheduler обрабатывает несколько последовательных batch вызовов `llm.chat()`. Есть ли overhead? Сбрасывается ли KV cache между batch вызовами? Или prefix caching сохраняет system prompt?

#### B4. P8 — xgrammar vs guidance

- Consensus: "выбрать по benchmark'у".
- **Задача**: Найти актуальные сравнения xgrammar vs guidance/LLGuidance для vLLM v0.18.0 (март 2026). Throughput, reliability, schema compatibility. Что является default backend? Есть ли known issues с Qwen3.5?

#### B5. Celery time budgets

- Consensus упоминает `soft_time_limit=10500`, `time_limit=10800`.
- **Задача**: Прочитать текущий код `book_tasks.py` и проверить — согласуются ли эти лимиты с предложенным `LLM_TIMEOUT=1800`? При retry + cold start + sequential fallback — влезет ли всё в Celery budget? Может ли Celery task быть killed?

### Блок C: Поиск пробелов — что ВСЕ документы упустили

#### C1. Concurrent users

Ни один документ адекватно не рассматривает сценарий: два пользователя одновременно загружают книги. Что произойдёт? Два Modal контейнера? Очередь? Конфликт за GPU? Стоимость удваивается? Modal Starter plan: 10 concurrent GPUs.

#### C2. Книги с 100+ главами

Для эпик-фэнтези или сериалов. При max_model_len=32768 и sub-batch 8: сколько sub-batch'ей? Каков total inference time? Cost? KV cache pressure?

#### C3. Rollback plan

Ни один документ не описывает rollback. Что если batch mode ломает production хуже, чем sequential? Как откатиться? Feature flag достаточен? Нужна ли canary deployment стратегия?

#### C4. Observability для Modal

Consensus рекомендует метрики (P5), но не рассматривает: как собирать метрики из Modal контейнера? `modal.Queue`? Custom logging? Prometheus push gateway? Как мониторить latency и success rate в real-time?

#### C5. Data consistency при partial failures

При sub-batch: если sub-batch 1 (главы 1-8) успешен и сохранён в БД, а sub-batch 2 (главы 9-16) упал — что видит пользователь? Корректен ли entity graph (relationships между главами 1-8 и 9-16 broken)? Нужна ли транзакционная семантика?

#### C6. Reduce/synthesis после batch

Consensus упоминает `logger.opt` баг в reduce/synthesis. Но не рассматривает: как reduce/synthesis должен работать с batch результатами? Текущий reduce вызывается после ВСЕХ глав. С sub-batch — вызывается после каждого sub-batch? Или после всех? Как это влияет на entity consistency?

#### C7. Model update path

Что произойдёт при обновлении vLLM (0.18.0 → 0.19.0)? Или при смене модели (Qwen3.5-9B → другая)? `num_gpu_blocks_override`, `compilation_config`, `guided_decoding_backend` — всё это может сломаться. Нужна ли CI/CD проверка?

#### C8. Cold start variability

Все benchmarks используют point estimates (110s, 130s). Но Modal cold start — stochastic. Какова дисперсия? P50 vs P95 vs P99? Может ли cold start быть 5 минут при загруженном кластере?

### Блок D: Актуальная веб-верификация критических технологий

Для каждого пункта — искать через актуальные веб-источники (GitHub, docs, blogs) на март 2026.

#### D1. vLLM v0.18.0 release notes

Найти полные release notes. Что именно включено? Hybrid KV cache manager? Batch error isolation? Sleep mode improvements? Structured output changes?

#### D2. Modal GPU snapshots — текущий статус

Alpha? Beta? GA? Какие ограничения? Работает ли с `vllm.LLM`? Есть ли success stories для 9B+ models? Latency на восстановление?

#### D3. Qwen3.5-9B structured output — текущий статус

Есть ли открытые баги для Qwen3.5 + structured output в vLLM? Qwen3.5-9B конкретно? Работает ли xgrammar? Работает ли guidance?

#### D4. FlashInfer vs Triton backend

Что лучше для L40S + Qwen3.5-9B? Поддерживает ли Triton backend hybrid models (DeltaNet)? Есть ли performance comparison на Ada Lovelace GPUs (L40S)?

#### D5. Modal concurrent containers и billing

Как Modal тарифицирует idle контейнер в `scaledown_window`? Считается ли GPU time при scaledown? Есть ли способ pre-warm контейнер без оплаты?

### Блок E: Code review — текущий production код

Прочитать **текущий** код этих файлов и проверить, все ли проблемы из consensus-отчёта актуальны:

1. `modal/llm_extractor.py` — есть ли batch method? sleep mode? guided_decoding_backend?
2. `modal/config.py` — текущие значения LLM_TIMEOUT, MAX_MODEL_LEN, NUM_GPU_BLOCKS_OVERRIDE
3. `modal/schemas.py` — есть ли maxLength constraints?
4. `backend/app/tasks/book_tasks.py` — как устанавливается `descriptions_extracted`? Semaphore logic? Error handling?
5. `modal/app.py` — compile cache volume? GPU snapshot settings?

### Блок F: Финальная оценка плана действий

#### F1. Оценка приоритетов consensus (P0-P9)

Для каждого приоритета:

- Корректность: правильно ли описана проблема?
- Полнота: всё ли учтено?
- Порядок: правильная ли последовательность?
- Effort: реалистична ли оценка сложности?
- Пропущенные зависимости между шагами?

#### F2. Что добавить в план

На основе Блока C (пробелы) — какие новые пункты нужно добавить в план?

#### F3. Оценка рисков плана

- Какой шаг наиболее рискованный?
- Где highest blast radius?
- Нужен ли staging environment для тестирования batch mode?

---

## Формат ответа

Создай документ `docs/research/FINAL-consolidated-audit.md`:

### Обязательные разделы:

1. **Executive Summary** — 1 параграф: что верно, что неверно, что делать
2. **Разрешение противоречий** — для каждого из 5 противоречий (A1-A5): кто прав, с evidence
3. **Верификация consensus-рекомендаций** — для каждого из P0-P9: корректно/некорректно/неполно
4. **Пробелы всех документов** — что упущено ВСЕМИ (C1-C8+)
5. **Актуальное состояние технологий** — D1-D5 с source verification
6. **Code review текущего production** — E1-E5
7. **Скорректированный план действий** — финальный P0-PN с учётом всех находок
8. **Скорректированные benchmarks** — единая таблица: оригинал / первый аудит / Gemini / consensus / финальная оценка
9. **Risk matrix** — для каждого шага плана: probability × impact
10. **Definition of Done** — скорректированный из consensus + добавленное

### Требования:

- **Source verification**: Каждое утверждение проверяй через актуальные веб-источники. Не принимай на веру ни один из пяти документов — они могут быть все неправы в одном месте.
- **Code verification**: Читай текущий код, не полагайся на описания из отчётов — код мог измениться.
- **Конкретность**: Не "может быть проблема" — а "проблема X потому что Y, как видно из Z (файл:строка или URL)".
- **Actionable**: Каждый finding → конкретная рекомендация с файлами и изменениями.
- **Ready for planning**: Результат должен быть достаточен для создания GSD-фаз без дополнительных исследований.
- **На русском языке**: Весь аудит на русском. Технические термины, код, URL — в оригинале.
