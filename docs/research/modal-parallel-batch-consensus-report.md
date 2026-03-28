# Итоговый consensus-отчёт по Modal/vLLM batch processing

> Дата: 27 марта 2026  
> Основание:  
> - `docs/research/modal-parallel-batch-processing-AUDIT.md`  
> - `docs/research/parallel-batch-audit-final-AUDIT.md`  
> - текущая кодовая база на commit `e5b430b`  
> - фактическое состояние production через `ssh fancai`  
> - production DB / feature flags  
> - логи Celery и прямые логи Modal app `fancai-pipeline`

## 1. Executive Summary

### Главный вывод

**Реальная система сейчас уже использует Modal в production, но не в batch-архитектуре из исследований.**  
На проде включён `USE_MODAL_PIPELINE`, однако код по-прежнему вызывает Modal **по одной главе за раз**, с `timeout=600s`, без batch API, без chunked sub-batch, без `maxLength` в schema и без устойчивой post-processing логики для structured JSON.

Именно поэтому обе исследовательские линии сходятся в одном важном месте, и production это уже подтверждает:

- текущий per-chapter Modal-path **слишком хрупкий**;
- structured JSON **реально ломается**;
- `600s` timeout **реально выбивает главы**;
- система может завершить книгу как “успешно обработанную”, даже если значительная часть глав не обработалась.

### Итоговая оценка текущего состояния

**Стратегическое направление “уйти от sequential Modal calls к batch/sub-batch vLLM” подтверждается.**  
**Текущее продовое исполнение требует срочной стабилизации до любых дальнейших rollout’ов.**

Если говорить жёстко и по делу:

- проблема уже не исследовательская;
- проблема уже production-grade;
- и она не в том, “стоит ли пробовать batching”, а в том, что **текущий Modal path уже включён, но реализован в архитектурно промежуточном и ненадёжном состоянии**.

## 2. Что было проверено

### 2.1. Локальная кодовая база

Проверены ключевые файлы:

- `modal/llm_extractor.py`
- `modal/config.py`
- `modal/schemas.py`
- `backend/app/tasks/book_tasks.py`
- `backend/app/services/modal_client.py`
- `backend/app/services/consistency_manager.py`
- `backend/app/services/feature_flag_manager.py`
- тесты `backend/tests/services/test_modal_client.py`
- тесты `backend/tests/tasks/test_modal_integration.py`

### 2.2. Production через `ssh fancai`

Подтверждено:

- хост `fancai-prod`, uptime 26 дней;
- deploy path: `/opt/fancai/app`;
- production commit совпадает с локальным: `e5b430b`;
- контейнеры backend/celery/postgres/redis живы и healthy;
- Modal app `fancai-pipeline` задеплоен;
- feature flag `USE_MODAL_PIPELINE = true`;
- в backend-контейнере есть `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`;
- Modal SDK установлен в продовом backend-контейнере.

### 2.3. Логи

Проверены:

- `docker logs fancai_celery`
- `docker logs fancai_backend`
- `python -m modal app logs fancai-pipeline` из продового backend-контейнера

## 3. Реальное состояние кода

### 3.1. Batch processing в коде сейчас отсутствует

Несмотря на исследования, текущий Modal-код всё ещё **строго per-chapter**:

- в `modal/llm_extractor.py` есть только:
  - `extract_chapter(...)`
  - `reduce_entities(...)`
- метода `extract_chapters_batch(...)` нет;
- `llm.chat()` вызывается на одну conversation;
- `book_tasks.py` использует `extractor.extract_chapter.remote(...)` для каждой главы по отдельности.

Это означает, что текущий production **не реализует исследуемую batch-архитектуру**.

### 3.2. “Parallel chapter processing” в коде фактически не параллельный для Modal

В `backend/app/tasks/book_tasks.py` стоит:

- `chapter_semaphore = asyncio.Semaphore(1 if use_modal else 10)`

Следствие:

- при `use_modal=True` система намеренно сериализует обработку;
- то есть 23 главы идут **не параллельно**, а по одной;
- это идеально совпадает с production временем выполнения порядка `~107 минут` на книгу из 23 глав.

То есть проблема не “GPU плохо батчит”, а проще:

- **батчинг вообще не используется**;
- вместо него в проде включён **последовательный Modal path**.

### 3.3. Таймауты всё ещё настроены под старую схему

В `modal/config.py`:

- `LLM_TIMEOUT = 600`
- `MAX_MODEL_LEN = 65536`
- `KV_CACHE_DTYPE = "fp8"`

При этом production-логи уже показывают, что `600s` недостаточно для части глав.  
Значит, исследовательская критика timeout’ов не гипотетическая, а уже подтверждённая фактами.

### 3.4. Structured schema остаётся неограниченной

В `modal/schemas.py` сейчас нет `max_length`/`maxLength` ограничений на длинные текстовые поля:

- `visual_summary`
- `chapter_event_action`
- `chapter_event_inner`
- `content`
- `image_prompt_en`
- `context`

Это важно, потому что production Modal-логи показывают реальные `JSONDecodeError` на длинных ответах:

- `Unterminated string ...`
- `Expecting property name enclosed in double quotes ...`

То есть одно из лучших предложений из первого аудита подтверждается production:  
**схему надо ужимать через `maxLength`, иначе structured output остаётся хрупким.**

### 3.5. Самый опасный логический баг: книга помечается как успешно обработанная даже при падении глав

В `backend/app/tasks/book_tasks.py` после основного pipeline выполняется:

- `book.descriptions_extracted = True`
- `book.descriptions_processing_error = None`

и только потом формируется result со статусом:

- `"completed"` или `"completed_with_errors"`

То есть код хранит одновременно две правды:

- в result задача может быть `completed_with_errors`;
- в самой книге `descriptions_extracted=True` и `descriptions_processing_error=None`.

Это уже видно в production DB.

## 4. Реальное состояние production

### 4.1. Modal в production включён

Production DB показала:

- `USE_MODAL_PIPELINE = true`
- updated_at: `2026-03-27 01:18:10+00`

То есть Modal path не просто “подготовлен”, а **реально активирован в проде**.

### 4.2. Продовый пример проблемной книги

По книге `23e990fc-ee8f-4679-81de-a2ebfeeb779f`:

- 23 главы
- обработано: 13
- упало: 10
- итог Celery task: `completed_with_errors`
- длительность задачи: `6462s` ≈ **107.7 минут**

Это практически идеально совпадает с исследовательской оценкой порядка `~107 минут` для последовательной схемы.

### 4.3. По-главные production ошибки уже очень показательны

Для этой книги по главам зафиксированы две доминирующие группы ошибок:

#### Таймауты

- `Task's current input ... hit its timeout of 600s`

#### Structured JSON parse failures

- `Unterminated string starting at ...`
- `Expecting property name enclosed in double quotes ...`

Распределение выглядит не случайным, а системным: часть глав падает по timeout, часть по broken JSON.

### 4.4. Состояние БД уже расходится с фактическим качеством результата

Для этой же книги в `books`:

- `descriptions_extracted = true`
- `descriptions_processing_error = NULL`

Но в `chapters`:

- только 13/23 имеют `is_description_parsed = true`
- 10/23 имеют `parsing_error`

Это значит, что пользовательские и административные статусы книги уже сейчас **могут лгать** о фактической полноте обработки.

### 4.5. Успешный кейс не доказывает стабильность Modal

В production есть книга `6d9501eb-5ae3-4f19-b0ea-4877551964fa` с `50/50 parsed`, но по времени обновления видно, что это произошло **до включения `USE_MODAL_PIPELINE`**.

Следовательно:

- этот успех нельзя считать доказательством стабильности Modal-path;
- он, вероятнее всего, относится к предыдущему extraction path.

## 5. Что показали прямые Modal-логи

### 5.1. Проблема не только в Celery-клиенте, но и внутри Modal контейнера

Прямые логи `fancai-pipeline` подтверждают, что ошибки возникают **внутри самого Modal-контейнера**, а не только на стороне клиента:

- `json.decoder.JSONDecodeError` в `/root/llm_extractor.py`, строка `return json.loads(result[0].outputs[0].text)`
- аналогичный `JSONDecodeError` в `reduce_entities`

Это важный момент:  
**ошибка не сводится к сетевому клиенту или обвязке Celery. Сама функция Modal сейчас возвращает текст, который код пытается парсить как полноценный JSON и регулярно не может.**

### 5.2. Таймауты подтверждены и со стороны Modal

Modal app logs показывают:

- input cancellation exactly at `600s`
- `Received a cancellation signal`
- `Successfully canceled input`

То есть в текущей архитектуре таймаут не “где-то рядом”, а реально режет запросы на стороне Modal runtime.

### 5.3. Throughput и latency очень неровные

По логам `Processed prompts`:

- output speed часто держится около `~43 tok/s`
- input speed гуляет очень сильно:
  - `84.16 toks/s`
  - `46.46 toks/s`
  - `34.28 toks/s`
  - `14.92 toks/s`
  - `6.33 toks/s`

Есть запросы длительностью:

- `41s`
- `62s`
- `79s`
- `101s`
- `291s`
- `584s`

То есть даже в текущем sequential режиме некоторые главы почти полностью съедают `600s` budget.

Это ещё один аргумент против тезиса из Gemini-аудита, что “в 10 минут на 23 главы практически невозможно упереться”. Production уже показывает, что на отдельных главах это реально происходит.

### 5.4. Есть дополнительные признаки нестабильности xgrammar/engine shutdown path

В логах Modal app есть:

- `nanobind: leaked ... xgrammar ...`
- `Engine core proc EngineCore died unexpectedly`
- `destroy_process_group() was not called before program exit`

Это не обязательно главный корень бизнес-проблемы, но это явный сигнал:

- structured decoding backend и/или shutdown path сейчас не выглядят чисто;
- к рекомендациям “просто оставьте xgrammar как default и всё будет хорошо” надо относиться осторожно.

## 6. Сводный вердикт по двум аудитам

## 6.1. Что подтверждено и теорией, и production

### Подтверждено

- `vLLM.LLM.chat()` batch API существует и должен быть основной осью оптимизации.
- Текущий sequential Modal path слишком медленный и хрупкий.
- `600s` timeout недостаточен для части глав.
- Structured JSON output реально ломается в production.
- `maxLength`/schema constraints нужны не “для красоты”, а как practical mitigation.
- Жёсткий `num_gpu_blocks_override=512` нельзя принимать без profiling sweep.
- GPU snapshots перспективны, но сами по себе не чинят broken JSON и логические баги статусов.

### Не подтверждено

- что `Issue #16732` уже исправлен достаточно, чтобы упростить error handling;
- что `Issue #37121` уже fixed и автоматическая memory planning надёжна;
- что snapshots гарантированно дадут `15-20s`;
- что speculative decoding безопасно подходит для structured output в вашем кейсе.

## 6.2. Как оценивать два аудита после сопоставления с production

### Первый аудит

Сильнее по осторожности и инженерной надёжности.

Он лучше угадал реальные production pain points:

- timeout
- truncation / malformed JSON
- необходимость fallback/retry
- риск переоценки benchmark’ов

### Gemini-аудит

Полезен как corrective voice по двум точкам:

- snapshots действительно стали сильнее;
- безусловный `num_gpu_blocks_override=512` действительно нельзя считать догмой.

Но он переоценил зрелость экосистемы в критически важных местах:

- batch error isolation
- Qwen3.5 memory fix
- прогнозы по latency/cold start
- безопасность упрощения error handling

## 7. Корневые проблемы системы на сегодня

### 7.1. Архитектурный разрыв между исследованиями и реальным кодом

Исследования обсуждают batch/sub-batch архитектуру.  
Прод сейчас работает в совершенно другом режиме:

- sequential per-chapter `.remote()`
- timeout per chapter
- no batch aggregation

### 7.2. Хрупкая обработка structured output

Сейчас код делает:

- `return json.loads(result[0].outputs[0].text)`

без:

- проверки `finish_reason`
- попытки recovery при truncation
- fallback на raw capture
- `maxLength`-ограничений
- безопасного partial parsing

Это слишком хрупко для production.

### 7.3. Ошибка продуктовой семантики статуса

Книга может быть:

- `descriptions_extracted=True`
- без `descriptions_processing_error`
- при наличии 10 failed chapters

Это уже не инфраструктурная, а продуктовая целостностная ошибка.

### 7.4. Non-critical фазы падают на кодовых дефектах

В логах production уже зафиксировано:

- `Reduce phase failed: 'Logger' object has no attribute 'opt'`

Локальный код подтверждает источник риска:

- `backend/app/services/consistency_manager.py`
- `backend/app/services/entity_synthesis_service.py`
- и другие модули используют `logging.getLogger(__name__)`, но дальше вызывают `logger.opt(...)`, что является API Loguru, а не stdlib logging.

### 7.5. Покрытие тестами слабое именно там, где сейчас реальные продовые падения

В репозитории есть:

- тесты конвертера `modal_response_to_chapter_result`
- smoke-level integration test на shape данных

Но нет адекватного покрытия на:

- `FunctionTimeoutError`
- `RemoteError`
- malformed JSON из Modal
- partial chapter failures
- `completed_with_errors` vs `descriptions_extracted=True`
- reduce/synthesis ошибки в Modal path
- batch/sub-batch orchestration

## 8. Приоритетный план действий

## Priority 0: стабилизация production semantics

### Сделать немедленно

1. Не выставлять `book.descriptions_extracted = True`, если есть failed chapters.
2. Не сбрасывать `book.descriptions_processing_error` в `None`, если есть partial failures.
3. Явно сохранять состояние:
   - `completed`
   - `completed_with_errors`
   - `failed`
4. Отдавать это состояние и в API, и в UI.

Без этого система уже сейчас вводит в заблуждение.

## Priority 1: остановить bleeding в текущем Modal path

### Минимальные правки до batch-рефактора

1. Добавить `maxLength` в `modal/schemas.py`.
2. Ловить `JSONDecodeError`, `FunctionTimeoutError`, `RemoteError` отдельно.
3. Сохранять raw response / diagnostics по главе для дебага.
4. Поднять `LLM_TIMEOUT` выше `600s` только как временную меру, а не как финальное решение.
5. Починить `logger.opt(...)` в stdlib-логгерах.

## Priority 2: выключить или ограничить rollout, если качество критично

С учётом текущего состояния есть сильный аргумент за один из двух путей:

- либо временно выключить `USE_MODAL_PIPELINE` для общего production traffic;
- либо оставить только на узкой тестовой группе/внутреннем rollout.

Причина проста: система уже доказывает, что может завершить книгу с серьёзными потерями данных и при этом маркировать её как успешно обработанную.

## Priority 3: переход не к “full batch 23”, а к chunked sub-batch

Наиболее зрелый следующий шаг:

- `sub-batch = 4/8/12`
- pre-validation длины на стороне backend
- checkpointing после каждого sub-batch
- retry только failed sub-batches / failed chapters

Это лучше, чем:

- оставить всё sequential;
- и безопаснее, чем сразу monolithic batch 23.

## Priority 4: после стабилизации сделать benchmark matrix

Измерять на реальном стеке:

1. sequential current path
2. sub-batch 4
3. sub-batch 8
4. sub-batch 12
5. xgrammar vs guidance
6. with / without snapshots
7. with / without `num_gpu_blocks_override`

Метрики:

- success rate
- malformed JSON rate
- timeout rate
- chapters/book fully parsed
- wall-clock
- cost/book
- p95 chapter latency

## 9. Финальный вердикт

### Что является правдой на сегодня

1. **Batching нужен.**
2. **Текущий production Modal path не batch, а sequential.**
3. **Structured output уже ломается в production.**
4. **Timeout 600s уже ломает production.**
5. **Статусы книги сейчас могут быть логически неверны.**
6. **Gemini-аудит переоценил зрелость нескольких ключевых fix’ов.**
7. **Первый аудит ближе к реальности по risk profile, но и он нужно приземлять на реальный код и логи.**

### Самый важный практический вывод

Следующий шаг для проекта — **не писать ещё один исследовательский документ**, а:

- стабилизировать текущий продовый Modal path;
- исправить state semantics;
- перейти на chunked sub-batch архитектуру;
- и только после этого принимать решение о полном batch rollout.

Пока этого нет, реальная система находится в состоянии:

**“Modal уже в проде, но ещё не в production-ready архитектуре.”**

## 10. Конкретный технический план работ

Ниже не исследовательские идеи, а **практический план внедрения**, основанный на текущем коде и production-фактах.

### P0. Срочная стабилизация production semantics

Цель: перестать маркировать частично сломанную обработку как успешную.

#### Что изменить

1. В `backend/app/tasks/book_tasks.py` изменить финальную логику статуса книги:
   - `descriptions_extracted=True` только если `failed_chapters == 0`
   - `descriptions_processing_error` не сбрасывать в `None`, если были ошибки
   - сохранить агрегированную ошибку вида:
     - `Partial processing failure: 10/23 chapters failed`
2. В result payload и progress events явно различать:
   - `completed`
   - `completed_with_errors`
   - `failed`
3. Убедиться, что UI и API используют именно это состояние, а не только `parsing_progress=100`.

#### Файлы

- `backend/app/tasks/book_tasks.py`
- возможно `backend/app/routers/books/crud.py`
- возможно `backend/app/schemas/...` и frontend, если статус уже отображается

#### Критерии завершения

- книга с 10 failed chapters не получает `descriptions_extracted=true`
- в БД остаётся понятная агрегированная ошибка
- API/WS отдают `completed_with_errors`, а не “успех без оговорок”

### P1. Убрать известные кодовые дефекты, уже подтверждённые логами

Цель: погасить текущие падения, не меняя пока архитектуру на batch.

#### Что изменить

1. Починить все места, где используется `logger.opt(...)` при `logging.getLogger(...)`.
2. Заменить на stdlib-совместимый вызов:
   - `logger.error(..., exc_info=True)`
   - `logger.warning(..., exc_info=True)` там, где нужен traceback
3. Прицельно пройтись минимум по модулям, уже попавшим в логи:
   - `backend/app/services/consistency_manager.py`
   - `backend/app/services/entity_synthesis_service.py`
   - `backend/app/core/pubsub.py`
   - `backend/app/tasks/book_tasks.py`
   - `backend/app/tasks/reading_sessions_tasks.py`
   - `backend/app/routers/books/crud.py`

#### Файлы

- `backend/app/services/consistency_manager.py`
- `backend/app/services/entity_synthesis_service.py`
- `backend/app/core/pubsub.py`
- `backend/app/tasks/book_tasks.py`
- остальные найденные через `rg "logger\\.opt\\("`

#### Критерии завершения

- в celery-логах больше нет `'Logger' object has no attribute 'opt'`
- reduce/synthesis path хотя бы не падают на logging layer

### P2. Сделать structured output менее хрупким

Цель: снизить число `JSONDecodeError` и недостроенных JSON.

#### Что изменить

1. Добавить ограничения длины в `modal/schemas.py`:
   - `ModalDescriptionSchema.content`
   - `ModalDescriptionSchema.image_prompt_en`
   - `ModalEntitySchema.visual_summary`
   - `ModalEntitySchema.chapter_event_action`
   - `ModalEntitySchema.chapter_event_inner`
   - `ModalRelationshipSchema.context`
2. По возможности ограничить также:
   - `name`
   - `aliases`
   - любые поля, склонные к разрастанию
3. В `modal/llm_extractor.py` перестать слепо делать `json.loads(...)` без защиты:
   - сначала сохранить `raw_text`
   - отдельно ловить `JSONDecodeError`
   - логировать `finish_reason`, если доступен
   - логировать размер ответа и, при необходимости, хвост ответа для отладки

#### Файлы

- `modal/schemas.py`
- `modal/llm_extractor.py`

#### Критерии завершения

- malformed JSON rate заметно снижается на тестовой книге
- в логах видно, где truncation, а где реально broken output

### P3. Развести таймауты и ошибки по классам

Цель: перестать складывать timeout, cancellation и broken JSON в одну корзину.

#### Что изменить

1. В `backend/app/tasks/book_tasks.py` отдельно обрабатывать:
   - `modal.exception.FunctionTimeoutError`
   - `modal.exception.RemoteError`
   - `json.JSONDecodeError`
   - остальные `Exception`
2. Сохранять в `chapter.parsing_error` нормализованный тип ошибки:
   - `modal_timeout`
   - `modal_remote_cancelled`
   - `modal_invalid_json`
   - `modal_unknown_error`
3. При необходимости расширить сохранение diagnostics:
   - `parsing_error_type`
   - `last_modal_request_id`
   - `last_finish_reason`

#### Файлы

- `backend/app/tasks/book_tasks.py`
- опционально миграции/модели, если вводятся новые поля

#### Критерии завершения

- по БД и логам можно быстро увидеть распределение failure modes
- не нужно вручную вычитывать traceback, чтобы понять природу падения

### P4. Временная стабилизация текущего sequential Modal path

Цель: уменьшить production pain до перехода на sub-batch.

#### Что изменить

1. Поднять `LLM_TIMEOUT` выше `600` только как временную меру.
   Рекомендуемый старт: `1200` или `1800`, но только после проверки Celery budget.
2. Проверить согласованность с:
   - `soft_time_limit=10500`
   - `time_limit=10800`
3. Добавить защиту от late sequential fallback:
   - не запускать fallback, если remaining task budget слишком мал

#### Файлы

- `modal/config.py`
- `backend/app/tasks/book_tasks.py`

#### Критерии завершения

- timeout rate падает
- Celery task не умирает из-за каскада late retries

### P5. Сделать нормальную наблюдаемость по Modal-path

Цель: перевести debugging из “чтения сырых логов” в нормальные операционные метрики.

#### Что изменить

1. Логировать для каждой главы:
   - `chapter_id`
   - `chapter_number`
   - `modal_call_started_at`
   - `modal_call_duration_ms`
   - `input_size_chars`
   - по возможности `input_tokens_estimate`
   - `result_type`
   - `error_type`
2. Логировать отдельно:
   - successes
   - timeouts
   - invalid JSON
   - cancellations
3. Добавить агрегируемые счётчики/метрики:
   - `modal_chapter_success_total`
   - `modal_chapter_timeout_total`
   - `modal_chapter_invalid_json_total`
   - `modal_chapter_duration_seconds`

#### Файлы

- `backend/app/tasks/book_tasks.py`
- `backend/app/monitoring/...`
- возможно `backend/app/monitoring/metrics.py`

#### Критерии завершения

- можно построить failure breakdown без ручного grep по логам
- видно p50/p95 chapter latency

### P6. Перед batch-сценарием добавить pre-validation длины главы

Цель: не отправлять в Modal заведомо рискованные входы без контроля.

#### Что изменить

1. На стороне backend оценивать размер главы до отправки в Modal.
2. Минимальный вариант:
   - chars-based heuristic
3. Лучший вариант:
   - tokenizer-based estimate на стороне backend worker
4. Если глава слишком длинная:
   - пометить как `needs_chunking`
   - не отправлять по обычному path

#### Файлы

- `backend/app/tasks/book_tasks.py`
- возможно новый helper/service для token estimation

#### Критерии завершения

- oversized chapters перестают бить Modal path вслепую
- длинные главы изначально попадают в отдельный handling

### P7. Переход на chunked sub-batch вместо full-book sequential

Цель: получить реальный выигрыш от batching без чрезмерного blast radius.

#### Целевая архитектура

- книга разбивается на sub-batches:
  - сначала `4`
  - затем `8`
  - затем `12`, если стабильно
- один Modal call на sub-batch
- checkpoint в БД после каждого sub-batch
- retry только failed sub-batch или отдельных глав внутри него

#### Что изменить

1. Добавить в `modal/llm_extractor.py` новый метод:
   - `extract_chapters_batch(...)`
2. Использовать batch-вызов `llm.chat(messages=[...])`
3. Возвращать список результатов с явной структурой:
   - `success`
   - `data`
   - `error_type`
   - `error_message`
4. В `book_tasks.py` заменить per-chapter loop для Modal path на orchestration по sub-batches.

#### Файлы

- `modal/llm_extractor.py`
- `backend/app/tasks/book_tasks.py`
- возможно `backend/app/services/modal_client.py`

#### Критерии завершения

- число `.remote()` вызовов на книгу резко уменьшается
- partial progress сохраняется после каждого sub-batch
- failure одной главы не портит всю книгу

### P8. После стабилизации проверить backend structured decoding

Цель: понять, остаёмся на xgrammar или нужен controlled fallback.

#### Что проверить

1. `xgrammar` на текущей схеме
2. `guidance` на той же схеме
3. Сравнить:
   - invalid JSON rate
   - timeout rate
   - latency
   - entity/description quality

#### Файлы

- `modal/llm_extractor.py`
- возможно `modal/config.py`

#### Критерии завершения

- backend выбирается по benchmark’у вашего кейса, а не по общим словам из отчётов

### P9. Snapshots и более глубокая инфраструктурная оптимизация только после стабилизации

Цель: не оптимизировать холодный старт раньше, чем исправлена correctness.

#### Что делать

1. Не начинать с snapshots как с первого шага.
2. Сначала:
   - статусы
   - invalid JSON
   - timeouts
   - sub-batch orchestration
3. Только потом тестировать:
   - `enable_memory_snapshot`
   - GPU snapshots
   - compile cache
   - `VLLM_TORCH_COMPILE_LEVEL`

#### Почему

Сейчас главный bottleneck не только cold start.  
Главные production defects уже в correctness и reliability.

## 11. Предлагаемый порядок внедрения

### Этап 1. За 1 рабочий цикл

- P0
- P1
- P2
- P3

Результат:

- честные статусы
- меньше ложных “успехов”
- меньше broken JSON
- лучше diagnostics

### Этап 2. Следующий цикл

- P4
- P5
- P6

Результат:

- более стабильный текущий path
- лучше observability
- подготовка к batching

### Этап 3. Основной архитектурный переход

- P7
- P8

Результат:

- реальный отказ от sequential Modal path
- controlled rollout sub-batch режима

### Этап 4. Инфраструктурный тюнинг

- P9

Результат:

- ускорение cold start и снижение cost после того, как correctness уже обеспечен

## 12. Definition of Done

Можно считать migration успешной только если одновременно выполнены все условия:

1. Книга не получает `descriptions_extracted=true`, если есть failed chapters.
2. В production нет массовых `JSONDecodeError` по Modal path.
3. Timeout rate по главам становится редким исключением, а не нормой.
4. Reduce/synthesis path не падают на `logger.opt`.
5. Обработка книги на 20+ главах идёт через sub-batch, а не через 20+ sequential `.remote()`.
6. Есть метрики и логи, по которым видно:
   - success rate
   - invalid JSON rate
   - timeout rate
   - p95 latency
7. Только после этого имеет смысл обсуждать aggressive performance claims про `7-8 мин`, snapshots и дальнейшую оптимизацию стоимости.
