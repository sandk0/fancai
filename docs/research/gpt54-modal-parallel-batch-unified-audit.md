# Объединенный аудит отчетов по Modal/vLLM batch processing

## Executive Summary

Аудит выполнен 27 марта 2026 года по корпусу из пяти основных документов и двух вспомогательных файлов, напрямую связанных с темой Modal/vLLM/Qwen/batch. Проверка велась по локальному репозиторию на коммите `e5b430bbbe7f2d301d95bc9170abf1accefec3ee`, по первичным источникам vLLM, Modal, Hugging Face и публичным GitHub issues/PR.

Главный вывод: ни один из существующих отчетов нельзя брать в planning как authoritative source без разминирования. Базовая стратегия "уйти от per-chapter sequential Modal calls к batch/sub-batch" выглядит инженерно разумной, но исходное исследование `modal-parallel-batch-processing.md` содержит несколько фактически неверных API-утверждений и много недоказанных performance/cost claims. Оба последующих аудита исправляют эти ошибки лишь частично и сами содержат source drift.

Подтверждено, что текущая кодовая база не реализует обсуждаемую batch-архитектуру. В репозитории нет `extract_chapters_batch(...)` в `modal/llm_extractor.py`, Modal path идет через `extractor.extract_chapter.remote` по одной главе за раз, а `book_tasks.py` использует `asyncio.Semaphore(1 if use_modal else 10)` и при этом имеет противоречивую status-семантику: выставляет `descriptions_extracted=True`, даже если часть глав упала и итоговый результат возвращается как `completed_with_errors`.

Подтверждено, что `vllm.LLM.chat()` batch input официально поддерживает на 27 марта 2026 года, а offline `vllm.LLM` имеет `enable_sleep_mode=True`, `llm.sleep()` и `llm.wake_up()`. Это делает неверными тезисы исходного исследования о том, что batch-chat отсутствует или что sleep/wake требует server-mode refactor. Одновременно не подтверждено, что issue `#16732` "фактически исправлен", что `finish_reason="error"` дает user-facing per-request isolation, что `#37121` уже fixed в `v0.18.0`, или что snapshots гарантированно дадут `15-20s` cold start для данного стека.

`modal-parallel-batch-processing-AUDIT.md` оказался наиболее полезным corrective документом, но тоже не является чисто authoritative: он правильно ломает тезис `StructuredOutputsParams(..., backend="guidance")`, но сам предлагает API-форму `guided_decoding_backend="guidance"`, которая уже не соответствует текущей документации `v0.18.0`, где structured backend задается через `structured_outputs_config.backend`. Этот же аудит ошибочно атакует `compilation_config` как plain dict, хотя текущая документация `LLM` явно допускает `int | dict | CompilationConfig`.

`parallel-batch-audit-final.md` является самым слабым документом корпуса. Он выдает за факты неподтвержденные тезисы про "исправленную" batch isolation в `v0.18.0`, про "fixed" статус `#37121`, про гарантированные `15-20s` snapshot cold starts и про точные latency/cost improvements без релевантного benchmark'а именно для `Qwen3.5-9B + structured output + L40S + Modal`.

Вывод аудитора: planning-ready основа существует, но она должна строиться не на одном из текущих документов целиком, а на пересечении четырех типов фактов:

1. Подтвержденное состояние локального кода.
2. Подтвержденные upstream API/issue statuses на 27 марта 2026 года.
3. Явно помеченные гипотезы, требующие POC.
4. Явно запрещенные к принятию без дополнительной проверки optimistic claims.

## Корпус аудита

В аудит вошли следующие документы.

1. `docs/research/modal-parallel-batch-consensus-report.md`
Роль: итоговый synthesis-документ, важен для сопоставления локального кода, production-утверждений и planning-рекомендаций.

2. `docs/research/modal-parallel-batch-processing-AUDIT.md`
Роль: прямой технический аудит исходного research-документа; полезен для поиска API/source ошибок.

3. `docs/research/parallel-batch-audit-final-AUDIT.md`
Роль: аудит второго аудита; полезен как skeptical counterweight к чрезмерно уверенным исправлениям.

4. `docs/research/modal-parallel-batch-processing.md`
Роль: исходный research-документ с основными архитектурными рекомендациями и proposed code changes.

5. `docs/research/parallel-batch-audit-final.md`
Роль: альтернативный audit/final-review исходного research-документа; содержит сильные утверждения про fixes, performance и cost.

6. `docs/research/PROMPT-modal-parallel-processing-research.md`
Роль: вспомогательный файл. Не использовался как authoritative research source, но использовался как вспомогательное подтверждение того, что часть production/log-утверждений в корпусе имеет следы реальных логов, а не только вторичный пересказ.

7. `docs/research/modal-gpu-migration-plan.md`
Роль: вспомогательный файл. Использовался только ограниченно как дополнительная проверка production-контекста Modal rollout; не использовался как источник upstream API-фактов или benchmark'ов.

Не включен как доказательство:

`docs/research/PROMPT-modal-parallel-batch-processing-AUDIT.md`
Причина: это audit prompt/specification, а не исследовательский или доказательный документ.

## Методология и стандарт доказательности

Базовый принцип: ни один отчет из корпуса не использовался как доказательство для другого отчета.

Иерархия доказательности:

1. Локальный код репозитория на коммите `e5b430bbbe7f2d301d95bc9170abf1accefec3ee`.
2. Официальная документация и исходный код vLLM и Modal.
3. Публичные GitHub issues/PR/release-related pages.
4. Hugging Face model card и официальная pricing page.
5. Вспомогательные локальные документы и логи.

Статусы в матрице:

- `CONFIRMED`: утверждение прямо подтверждается первичным источником или локальным кодом.
- `PARTIALLY_CONFIRMED`: ядро тезиса верное, но формулировка, scope или уверенность завышены.
- `OUTDATED`: утверждение или "исправление" основано на старой версии API/issue state.
- `INCORRECT`: утверждение противоречит первичному источнику или локальному коду.
- `UNVERIFIABLE`: первичного подтверждения для конкретного числа/гарантии/behavior не найдено.

Правила интерпретации:

- "Факт" в этом документе означает подтверждение первичным источником.
- "Вывод аудитора" означает инженерный вывод на основе нескольких подтвержденных фактов.
- "Рекомендация" означает practical next step, а не доказанный факт.

## Матрица верификации ключевых утверждений

| ID | Документ-источник | Утверждение | Статус | Доказательство | Влияние | Что исправить |
|---|---|---|---|---|---|---|
| V1 | `modal-parallel-batch-processing.md`, `modal-parallel-batch-consensus-report.md` | `vllm.LLM.chat()` поддерживает batch input | CONFIRMED | Документация `v0.18.0` описывает `messages: list[...] | Sequence[list[...]]` для `LLM.chat()`; историческое добавление batch-chat связано с [PR #8648](https://github.com/vllm-project/vllm/pull/8648) и текущей docs [`LLM`](https://docs.vllm.ai/en/v0.18.0/api/vllm/entrypoints/llm/) | Это разрешает сам класс оптимизации через batch/sub-batch | Оставить как факт, но не экстраполировать отсюда graceful failure semantics |
| V2 | `modal-parallel-batch-processing.md` | `StructuredOutputsParams(json=schema_json, backend="guidance")` является корректным request-level API | INCORRECT | В текущем исходном коде vLLM `StructuredOutputsParams` использует приватное `_backend` с `init=False`; request-level `backend=` не является публичным аргументом: [sampling_params.py](https://raw.githubusercontent.com/vllm-project/vllm/main/vllm/sampling_params.py) | Proposed code из исследования в таком виде не должен идти в implementation | Убрать этот синтаксис из плана и кода |
| V3 | `modal-parallel-batch-processing-AUDIT.md` | Правильное исправление: `LLM(guided_decoding_backend="guidance")` | OUTDATED | Аудит верно ломает `backend=` на request-level, но текущая docs `v0.18.0` конфигурирует structured backend через [`structured_outputs_config.backend`](https://docs.vllm.ai/en/v0.18.0/api/vllm/config/structured_outputs/) и `LLM(..., structured_outputs_config=...)`, а не через описанный в документе параметр | Если копировать "исправление" из аудита без перепроверки, можно снова попасть в API drift | Обновить рекомендацию под актуальный `v0.18.0` API |
| V4 | `modal-parallel-batch-processing.md` | Offline `vllm.LLM` не имеет sleep/wake API; нужен server mode | INCORRECT | Официальная docs `Sleep Mode` на 27 марта 2026 года показывает `LLM(..., enable_sleep_mode=True)`, `llm.sleep(level=1)`, `llm.wake_up()`: [Sleep Mode](https://docs.vllm.ai/en/v0.18.0/features/sleep_mode/) | Исходное исследование переоценивает effort server-mode refactor | Убрать server-mode как "обязательный" путь для sleep/wake |
| V5 | `modal-parallel-batch-processing-AUDIT.md` | `compilation_config` как plain dict некорректен; нужен только `CompilationConfig` | INCORRECT | Документация `LLM` на 27 марта 2026 года допускает `compilation_config: int | dict | CompilationConfig`: [LLM API](https://docs.vllm.ai/en/v0.18.0/api/vllm/entrypoints/llm/) | Этот false positive ухудшает качество аудита и может породить ненужный refactor | Исправить статус на "dict допустим, но конкретные capture sizes требуют profiling" |
| V6 | `modal-parallel-batch-processing-AUDIT.md`, `modal-parallel-batch-processing.md` | Issue `#16732` закрыт как `not planned` | CONFIRMED | На 27 марта 2026 года публичная страница issue показывает closed state; сам вопрос per-request batch validation не объявлен исправленным: [Issue #16732](https://github.com/vllm-project/vllm/issues/16732) | Важно не путать "issue closed" с "problem solved" | Оставить только как issue-state, не как доказательство исправления |
| V7 | `parallel-batch-audit-final.md` | В `v0.18.0` добавлена error isolation, и один плохой prompt больше не убивает весь batch | INCORRECT | Ни issue `#16732`, ни docs по `finish_reason` не дают такой user-facing гарантии; `finish_reason="error"` описан как retryable internal request-level error, а не как общий контракт input isolation: [engine source](https://raw.githubusercontent.com/vllm-project/vllm/main/vllm/v1/engine/__init__.py), [Issue #16732](https://github.com/vllm-project/vllm/issues/16732) | Это самый опасный optimistic claim для planning и recovery semantics | Не убирать fallback/validation на основании этого тезиса |
| V8 | `parallel-batch-audit-final-AUDIT.md` | Issue `#16732` на март 2026 года все еще открыт | INCORRECT | На 27 марта 2026 года issue публично closed, а не open: [Issue #16732](https://github.com/vllm-project/vllm/issues/16732) | Документ правильно критикует чрезмерную уверенность, но ошибается в факте issue-state | Исправить на "closed, but not evidence of fix" |
| V9 | `parallel-batch-audit-final.md` | `finish_reason="error"` можно использовать как простой механизм per-request isolation | INCORRECT | Исходник vLLM описывает `error` как "retryable request-level internal error"; это не пользовательская гарантия graceful handling любых invalid/oversized inputs внутри batch: [engine source](https://raw.githubusercontent.com/vllm-project/vllm/main/vllm/v1/engine/__init__.py) | Упрощение error handling на этом основании опасно | Держать pre-validation, sub-batch, retry и checkpointing |
| V10 | `parallel-batch-audit-final.md` | Qwen3.5 issue `#37121` fixed в `v0.18.0` | INCORRECT | На 27 марта 2026 года issue `#37121` публично open: [Issue #37121](https://github.com/vllm-project/vllm/issues/37121) | Нельзя планировать rollout, исходя из того, что memory planning полностью исправлен | Считать automatic allocation недоказанным для этого стека |
| V11 | `modal-parallel-batch-processing-AUDIT.md` | PR `#37124` устарел, superseded PR `#37429` является актуальным | CONFIRMED | `PR #37429` открыт 18 марта 2026 года и прямо помечает, что supersedes `#37124`, closed due to rebase notification issue: [PR #37429](https://github.com/vllm-project/vllm/pull/37429) | Это важный fix-path signal, но не "already shipped" факт | В планировании учитывать как pending upstream work, а не завершенный fix |
| V12 | `modal-parallel-batch-processing.md`, `modal-parallel-batch-processing-AUDIT.md` | `num_gpu_blocks_override=512` допустим как engine arg, но число 512 не доказано как универсальный оптимум | PARTIALLY_CONFIRMED | Сам параметр реален, но ни docs, ни public benchmark не доказывают именно `512` для `Qwen3.5-9B + L40S + ваш schema load`; audit справедливо называет число arbitrary; upstream hybrid-Mamba work все еще в движении: [Issue #37121](https://github.com/vllm-project/vllm/issues/37121), [PR #37429](https://github.com/vllm-project/vllm/pull/37429) | Hardcode без sweep может ухудшить capacity или stability | Использовать только через benchmark matrix и профилирование |
| V13 | `modal-parallel-batch-processing.md` | `Issue #18819` является достаточным доказательством риска structured output для Qwen3.5 | PARTIALLY_CONFIRMED | `#18819` относится к Qwen3 structured output path, а не автоматически ко всем Qwen3.5 конфигурациям; перенос риска на Qwen3.5 plausible, но не доказывает конкретное поведение вашей модели: [Issue #18819](https://github.com/vllm-project/vllm/issues/18819) | Риск real, но его нельзя использовать как точное доказательство конкретного failure mode | Помечать как model-family risk, а не как доказанный current bug |
| V14 | `modal-parallel-batch-processing-AUDIT.md` | NCCL/destroy_process_group issue `#19196` закрыт | INCORRECT | На 27 марта 2026 года issue `#19196` публично open: [Issue #19196](https://github.com/vllm-project/vllm/issues/19196) | Это еще один factual drift внутри аудита | Исправить issue-state |
| V15 | `modal-parallel-batch-processing.md`, `parallel-batch-audit-final.md` | `15-20s` cold start через snapshots для данного стека можно считать рабочей оценкой | UNVERIFIABLE | Modal docs обещают ускорение порядка `3-10x`, но не гарантируют число именно для `vllm.LLM + Qwen3.5 + L40S + structured output`: [Memory Snapshots](https://modal.com/docs/guide/memory-snapshots), [Cold start guide](https://modal.com/docs/guide/cold-start) | Эти цифры опасно закладывать в cost/latency plan | Оставить только как гипотезу для benchmark |
| V16 | `parallel-batch-audit-final.md` | XGrammar в batch будет быстрее Guidance на `15-20%` для вашего pipeline | UNVERIFIABLE | Документ не приводит первичный benchmark именно для вашей схемы, модели и Modal stack; даже если backend trend возможен, универсальная цифра не доказана | Нельзя закладывать в planning/ROI конкретный speedup | Свести выбор backend к POC, а не к paper claim |
| V17 | `modal-parallel-batch-processing-AUDIT.md` | `@modal.batched()` несовместим с другими methods внутри того же class | CONFIRMED | Modal docs прямо это запрещает: [Dynamic batching](https://modal.com/docs/guide/dynamic-batching) | Правильное ограничение; влияет на class design | Оставить как факт |
| V18 | `modal-parallel-batch-processing-AUDIT.md` | `Function.map(..., return_exceptions=True)` существует и может дать per-item exception surface | CONFIRMED | Подтверждается reference docs: [modal.Function](https://modal.com/docs/reference/modal.Function) | Это real alternative to monolithic `.remote()` | Учитывать как один из design вариантов |
| V19 | `modal-parallel-batch-processing.md` | Modal timeout для batch можно безопасно поднять до `1800s`, и это укладывается в platform limits | PARTIALLY_CONFIRMED | Platform limits это допускают: default 300s, max 24h: [Timeouts](https://modal.com/docs/guide/timeouts). Но "безопасно" зависит от Celery time limits и recovery path в вашем коде | Нельзя рассматривать timeout bump изолированно от orchestration | Перепланировать вместе с Celery soft/hard limits и retry budget |
| V20 | `modal-parallel-batch-processing.md` | `scaledown_window=60` для batch логичнее текущего `120` | PARTIALLY_CONFIRMED | Modal default действительно 60s, допустимый диапазон 2s..20min: [Cold start guide](https://modal.com/docs/guide/cold-start). Но оптимум зависит от traffic burst и retry profile | Изменение возможно, но это tuning, не стратегический fix | Делать после cost/latency measurements |
| V21 | `modal-parallel-batch-consensus-report.md` | Текущий production/repo path не batch, а sequential Modal calls | CONFIRMED | В локальном коде `modal/llm_extractor.py:41-78` нет batch-method; `backend/app/tasks/book_tasks.py:354,441-447` использует semaphore `1` и `extractor.extract_chapter.remote`; `backend/app/services/modal_client.py:56-98` содержит только single-response converter | Это центральный planning факт | Оставить как базовую констатацию текущего состояния |
| V22 | `modal-parallel-batch-consensus-report.md` | В schema отсутствуют длиновые ограничения, что повышает риск malformed/truncated JSON | CONFIRMED | `modal/schemas.py:1-38` не содержит `max_length`; локальная проверка Pydantic 2.12.5 показывает, что `Field(max_length=...)` порождает `maxLength` в JSON Schema | Это реальный low-effort mitigation на текущем path и перед batch rollout | Добавить length guards и schema caps до batch migration |
| V23 | `modal-parallel-batch-consensus-report.md` | `book_tasks.py` имеет противоречивую partial-failure status semantics | CONFIRMED | `backend/app/tasks/book_tasks.py:918-919` выставляет `descriptions_extracted=True` и очищает error, а `:969` возвращает `completed_with_errors` при failed chapters | Это planning-critical, потому что влияет на idempotency, retry и UI truthfulness | Исправить status model до любых throughput-оптимизаций |
| V24 | `modal-parallel-batch-consensus-report.md` | В коде есть сломанные `logger.opt(...)` вызовы на stdlib logger | CONFIRMED | Подтверждается в `backend/app/tasks/book_tasks.py:162,642,658,668,704`, `backend/app/services/consistency_manager.py:787`, `backend/app/services/entity_synthesis_service.py:232`; при этом logger создается через `logging.getLogger(__name__)` | Это реальный bug path в error handling, а не косметика | Заменить на корректный logging API |
| V25 | `modal-parallel-batch-consensus-report.md` | Тесты не покрывают batch orchestration и важные failure modes | CONFIRMED | `backend/tests/services/test_modal_client.py` и `backend/tests/tasks/test_modal_integration.py` покрывают только single-response conversion shape; нет тестов на batch parsing, timeout, partial retry, malformed JSON, status mismatch | Без этого rollout batch/sub-batch будет плохо защищен | Добавить failure-oriented tests до migration |
| V26 | `modal-parallel-batch-consensus-report.md` | На проде уже включен `USE_MODAL_PIPELINE` и были реальные partially failed books | PARTIALLY_CONFIRMED | Локальный код содержит feature-flag check `is_modal_enabled()` и Modal class lookup, а вспомогательные локальные документы содержат косвенные подтверждения production rollout/log excerpts. Но из текущей среды нельзя independently подтвердить runtime flag state и полноту статистики по book IDs | Это нельзя использовать как hard fact о production state без артефактов окружения | Пометить production-runtime часть как требующую прямых артефактов из БД/логов |

## Противоречия между отчетами

### 1. Статус и значение issue `#16732`

- `modal-parallel-batch-processing.md` и `modal-parallel-batch-processing-AUDIT.md` трактуют `#16732` как closed/not planned.
- `parallel-batch-audit-final.md` делает противоположный вывод: проблема якобы исправлена в `v0.18.0`.
- `parallel-batch-audit-final-AUDIT.md` тоже ошибается, но в другую сторону: утверждает, что issue по состоянию на март 2026 года все еще open.

Приоритет источника: первична публичная страница issue и текущий source/API, а не вторичные выводы. Корректное состояние на 27 марта 2026 года: issue closed, но это не подтверждает user-facing graceful batch isolation.

Вывод аудитора: обе крайности неверны. Нельзя ни считать проблему "исправленной", ни ссылаться на "issue все еще открыт" как на факт. Нужна более узкая и честная формулировка: batch isolation для problematic inputs не доказана как надежная гарантия, поэтому monolithic all-or-nothing batch остается рискованным.

### 2. Sleep mode и snapshots

- `modal-parallel-batch-processing.md` утверждает, что offline `LLM` не имеет sleep/wake API и что фактически нужен `vllm serve`.
- `modal-parallel-batch-processing-AUDIT.md` это исправляет и здесь по сути прав.
- `parallel-batch-audit-final.md` идет дальше и превращает наличие snapshots в гарантированные `15-20s`.

Приоритет источника: официальная docs vLLM и Modal. Факт существования sleep/wake подтвержден. Конкретное cold-start число для вашего стека не подтверждено.

Вывод аудитора: исходный research-документ завышает effort, а `parallel-batch-audit-final.md` завышает outcome. Planning должен опираться на середину: API существует, но профит требует bench.

### 3. Structured output backend syntax

- `modal-parallel-batch-processing.md` предлагает request-level `backend="guidance"` внутри `StructuredOutputsParams`, что неверно.
- `modal-parallel-batch-processing-AUDIT.md` справедливо ломает этот синтаксис, но предлагает другое "исправление", которое уже расходится с текущей docs `v0.18.0`.

Приоритет источника: исходный код и актуальная docs vLLM. Оба документа не дают planning-safe final syntax.

Вывод аудитора: нельзя копировать ни исходный синтаксис, ни audit-fix без повторной сверки с версией vLLM, которая реально будет установлена в контейнере.

### 4. `compilation_config`

- `modal-parallel-batch-processing.md` использует plain dict.
- `modal-parallel-batch-processing-AUDIT.md` объявляет это критической ошибкой и требует `CompilationConfig`.

Приоритет источника: docs `LLM` на 27 марта 2026 года. Они допускают `dict`.

Вывод аудитора: audit-поправка здесь сама стала false positive.

### 5. `#37121` и `num_gpu_blocks_override`

- `modal-parallel-batch-processing.md` считает override необходимым до мерджа upstream fix.
- `parallel-batch-audit-final.md` утверждает, что fix уже есть в `v0.18.0` и override нужно убирать.
- `parallel-batch-audit-final-AUDIT.md` справедливо критикует вторую крайность, но ошибается в части общего уровня уверенности по issue statuses в корпусе.

Приоритет источника: публичный status issue/PR. На 27 марта 2026 года `#37121` open, `#37429` open и supersedes `#37124`.

Вывод аудитора: жесткий override нельзя объявлять ни обязательным навсегда, ни ненужным уже сейчас. Это tuning variable для benchmark matrix.

### Dangerous Consensus

Повторяющиеся слабые тезисы, которые встречаются в нескольких документах, но от этого не становятся истинными:

1. "Batch processing в целом доказан как безопасный replacement для текущего path".
2. "Если batch-chat API существует, то blast radius batch failure уже решен".
3. "Snapshots почти наверняка дадут cold start порядка 12-20 секунд".
4. "Можно перейти сразу к large full-book batch, а fallback потом упростить".
5. "Проблемы structured output в основном сводятся только к xgrammar vs guidance".

## Критические ошибки

### K1. Исходное исследование использует неверный structured output API

Серьезность: Critical  
Уверенность: High  
Почему это важно для планирования: proposed implementation в `modal-parallel-batch-processing.md` не является safe copy-paste base. Если команда пойдет в реализацию по этому коду, она упрется в API drift до начала реального бенчмаркинга.  
Что делать practically: убрать из planning все code snippets с `StructuredOutputsParams(..., backend="guidance")`; зафиксировать точную vLLM version target и переписать конфигурацию structured backend под актуальный API.

### K2. `parallel-batch-audit-final.md` выдает за факт исправленную batch isolation

Серьезность: Critical  
Уверенность: High  
Почему это важно для планирования: это directly толкает к опасному решению упростить error handling, убрать fallback и недооценить blast radius одного bad input внутри batch.  
Что делать practically: считать per-request isolation недоказанной для problematic inputs; строить план через pre-validation, sub-batch, checkpointing и targeted retry.

### K3. `parallel-batch-audit-final.md` выдает за факт fixed status issue `#37121`

Серьезность: Critical  
Уверенность: High  
Почему это важно для планирования: на этой ошибке строится совет убрать `num_gpu_blocks_override` и довериться автоматике памяти. Это может сломать feasibility batch size уже на первом POC.  
Что делать practically: оставить `num_gpu_blocks_override` как экспериментальный параметр в benchmark matrix, а не как default и не как taboo.

### K4. Корпус документов систематически путает "наличие API" и "наличие production-гарантии"

Серьезность: Critical  
Уверенность: High  
Почему это важно для планирования: наличие `LLM.chat()` batch input, sleep mode или `Function.map(return_exceptions=True)` не означает, что текущий pipeline автоматически готов к правильной partial recovery semantics, idempotency и accurate status reporting.  
Что делать practically: перед throughput-оптимизацией исправить текущую truthfulness/status/idempotency основу в локальном коде.

### K5. Текущая локальная система уже имеет semantic corruption в partial-failure path

Серьезность: Critical  
Уверенность: High  
Почему это важно для планирования: `book_tasks.py` одновременно сигнализирует успех и наличие ошибок. Это ломает retry policy, UI interpretation и основу для batch migration.  
Что делать practically: сначала нормализовать book/chapter status model, затем строить sub-batch orchestration поверх уже корректной recovery semantics.

## Существенные недочеты и пробелы

### S1. Benchmark-числа в корпусе не имеют достаточной первичной опоры

Серьезность: High  
Уверенность: High  
Почему это важно для планирования: числа вроде `7-8 мин E2E`, `15x speedup`, `15-20s cold start`, `+15-20% batch size`, `40-50 tok/s`, `300-500 tok/s aggregate` выглядят как optimistic planning anchors, но верификация именно для `Qwen3.5-9B + structured output + L40S + Modal + ваша schema` не найдена.  
Что делать practically: выкинуть эти числа из ROI/estimate until bench; заменить на "неизвестно до POC".

### S2. Корпус слабо различает monolithic batch и chunked sub-batch

Серьезность: High  
Уверенность: High  
Почему это важно для планирования: большая часть оптимистичных выводов implicitly относится к full-book batch, но реальные recovery semantics, timeout envelope и retry cost сильно отличаются между `batch=23` и `sub-batch=4/8/12`.  
Что делать practically: formalize design target как sub-batch architecture; full-book batch оставить только как эксперимент.

### S3. Недооценен runtime-cost failure path

Серьезность: High  
Уверенность: Medium  
Почему это важно для планирования: в cost claims почти не учитываются cold start churn, scaledown behavior, retries, partial failures, повторная обработка глав и concurrent books.  
Что делать practically: считать cost/book только по observed benchmark с success и failure paths.

### S4. Недооценен serialization/deserialization risk

Серьезность: Medium  
Уверенность: Medium  
Почему это важно для планирования: один большой JSON batch не только ускоряет GPU utilization, но и увеличивает размер payload, пост-обработку, blast radius malformed JSON и parsing costs. Modal имеет gRPC payload limit 100MB: [Troubleshooting](https://modal.com/docs/guide/troubleshooting).  
Что делать practically: измерять payload size и JSON parse cost на sub-batch sizes до rollout.

### S5. Production-runtime тезисы в consensus-документе не полностью воспроизводимы из текущей среды

Серьезность: Medium  
Уверенность: High  
Почему это важно для планирования: часть strongest statements в consensus касается feature-flag state, конкретных book IDs и production statistics, которые нельзя независимо подтвердить без доступа к окружению/БД/логам.  
Что делать practically: приложить отдельные production artifacts к следующему planning cycle, если эти тезисы будут использованы как входные факты.

### S6. Корпус слабо покрывает idempotency после частичного успеха

Серьезность: High  
Уверенность: High  
Почему это важно для планирования: batch retry и partial save без строгой idempotency легко приведут к повторной обработке уже завершенных глав. Это прямо отмечено в одном аудите, но не доведено до системного design requirement.  
Что делать practically: определить source of truth для chapter completion и retry eligibility до migration.

## Edge cases и системные риски

### E1. Одна сверхдлинная глава

Риск: oversized input, timeout, malformed/truncated JSON или batch abort.  
Вывод аудитора: текущий корпус недооценивает этот кейс. Закрытый `#16732` не превращает invalid/oversized chapter в безопасно изолированный request-level failure.  
Практическое действие: pre-validation длины главы, length caps в schema, автоматический split/reduce path для extreme chapters.

### E2. Книга на 100+ глав

Риск: full-book batch становится operationally неудобным по payload, checkpoint granularity и rollback radius.  
Вывод аудитора: monolithic batch здесь почти наверняка хуже sub-batch по failure containment.  
Практическое действие: лимитировать sub-batch size и сохранять progress после каждого sub-batch.

### E3. All-or-nothing semantics против partial save

Риск: если модель или transport fail поздно, весь batch становится дорогим для повтора, а уже готовые главы не закреплены.  
Вывод аудитора: упрощение recovery semantics ради скорости является опасной рекомендацией.  
Практическое действие: checkpointing на уровне sub-batch и chapter-level idempotency keys.

### E4. Зависший `.remote()` или зависший поток на VPS

Риск: `asyncio.to_thread(extractor.extract_chapter.remote, ...)` и будущий batch-вызов без отдельного timeout/abort механизма могут держать worker дольше ожидаемого.  
Вывод аудитора: аудит `modal-parallel-batch-processing-AUDIT.md` прав в том, что VPS-side timeout нужно учитывать, даже если platform timeout на Modal выставлен.  
Практическое действие: завернуть blocking bridge в явный timeout и корректный cancellation/retry policy.

### E5. Celery soft/hard time limits

Риск: локальный task имеет `soft_time_limit=10500` и `time_limit=10800`, но planning-документы почти не пересчитывают новый retry budget с учетом batch/sub-batch и fallback path.  
Вывод аудитора: timeout policy нельзя проектировать только на стороне Modal.  
Практическое действие: пересчитать worst-case по sub-batch count, retries и downstream post-processing.

### E6. Concurrent books

Риск: даже если один book POC проходит, несколько книг одновременно могут взорвать cost, cold starts, queueing и shared capacity assumptions.  
Вывод аудитора: корпус почти целиком reason'ит в модели "одна книга".  
Практическое действие: benchmark не только single-book, но и 2-4 concurrent books.

### E7. Structured output failures не сводятся к truncation

Риск: malformed JSON, schema drift, empty fields, semantically unusable but syntactically valid JSON.  
Вывод аудитора: часть документов излишне сужает проблему до `max_tokens` и `finish_reason`.  
Практическое действие: separate metrics для truncation, malformed JSON, validation error, semantically incomplete payload.

### E8. GPU/KV/FSM pressure

Риск: hybrid Qwen3.5 architecture, KV planning, guided decoding overhead и memory fragmentation могут взаимодействовать нелинейно.  
Вывод аудитора: ни один документ не дал benchmark, который одновременно покрывает batch size, structured backend, schema complexity и memory tuning.  
Практическое действие: benchmark matrix должна менять только один параметр за раз.

### E9. Version drift

Риск: документы уже содержат противоречия даже внутри аудитов; без жесткой фиксации versions planning быстро устареет.  
Практическое действие: каждая planning recommendation должна быть привязана к конкретной version tuple: Modal SDK, vLLM, model revision, schema version.

## Скорректированные оценки и benchmarks

Ниже только то, что можно использовать без самообмана.

| Метрика/тезис | Что заявлено в корпусе | Скорректированная оценка |
|---|---|---|
| Batch chat support | Иногда подается как новинка без оговорок | Факт наличия batch chat подтвержден. Это capability, а не доказательство production feasibility |
| Cold start через snapshots | `12-20s`, `15-20s`, иногда как почти гарантированный результат | Нет planning-safe числа. Допустима только гипотеза "может быть существенно быстрее после snapshot", verified only by bench |
| E2E время книги | `7-8 мин`, `9-12 мин`, `15x speedup` | Нет подтвержденных чисел для вашего стека. До POC использовать только "ожидается ускорение относительно sequential path" |
| `num_gpu_blocks_override=512` | Либо обязателен, либо уже вреден | Это tuning knob. Нужен sweep, а не догма |
| Guidance vs XGrammar | В одном месте Guidance объявлен robust default, в другом XGrammar быстрее на `15-20%` | Текущая planning-safe формулировка: backend choice не закрыт; нужен POC на вашей schema/model/load |
| Timeout policy | Поднять Modal timeout до `1800s` и проблема решена | Platform это допускает, но operational safety определяется не только Modal timeout, а целой цепочкой Celery/retry/checkpointing |
| Cost per book | Подразумевается дешевизна за счет batch utilization | Без учета cold starts, retries, concurrent books и failure path cost-claim неполон |
| Scaledown | `60s` выглядит лучше `120s` | Это plausible tuning, но не архитектурный вывод; менять после измерений |

Вывод аудитора: на 27 марта 2026 года planning-ready numeric baseline для latency/cost отсутствует. Planning-ready architectural baseline есть: sub-batch, pre-validation, checkpointing, idempotency, explicit benchmarks.

## Выводы для планирования

### Что реально можно брать в планирование

1. Текущий локальный Modal path sequential и требует исправлений даже до batch migration.
2. `vllm.LLM.chat()` batch input существует и может быть базой для sub-batch design.
3. Offline sleep mode API существует; server-mode refactor не является обязательным prerequisite.
4. Monolithic full-book batch нельзя считать безопасным default.
5. `max_length`/`maxLength`, pre-validation и truthfulness/status fixes имеют высокий ROI и низкий implementation risk.

### Что требует POC до принятия в план как committed work

1. Выбор structured output backend и точной конфигурации.
2. Оптимальный sub-batch size: `4`, `8`, `12` или иной.
3. Нужен ли `num_gpu_blocks_override`, и если да, в каком диапазоне.
4. Реальный cold start эффект от memory snapshots.
5. Реальный E2E latency/cost per book с учетом failure paths.

### Что нельзя брать в работу без дополнительной проверки

1. Удаление fallback/sequential recovery на основании claim про fixed batch isolation.
2. Удаление `num_gpu_blocks_override` на основании claim про fixed `#37121`.
3. Закладку в roadmap чисел `15-20s`, `7-8 мин`, `15x`, `+15-20%`.
4. Реализацию по code snippets из `modal-parallel-batch-processing.md` без перепроверки API.

### Приоритет рисков

Blocking:

- Некорректная status/idempotency основа в текущем коде.
- Недоказанная batch isolation для bad inputs.
- Отсутствие benchmark baseline по вашему стеку.

High:

- Отсутствие schema length caps.
- Слабое test coverage failure modes.
- Неопределенность around Qwen3.5 hybrid memory behavior.

Medium:

- Snapshot gain uncertainty.
- Scaledown tuning.
- Queue/payload overhead.

Low:

- Дискуссия о "правильном" guided backend до появления bench.

## Приоритетные рекомендации

### R1. Сначала исправить текущий sequential Modal path

Серьезность: Critical  
Уверенность: High  
Почему это важно для планирования: migration поверх semantic corruption даст быстрый, но хрупкий pipeline.  
Что делать practically: исправить `descriptions_extracted`/`completed_with_errors` модель, починить `logger.opt(...)`, добавить chapter-level truthfulness tests.

### R2. Добавить schema caps и pre-validation до batch migration

Серьезность: High  
Уверенность: High  
Почему это важно для планирования: это уменьшает риск malformed/truncated JSON и oversized chapter failures на текущем path и в будущих batch tests.  
Что делать practically: добавить `max_length` для длинных string fields в `modal/schemas.py`, измерять chapter sizes до отправки в Modal.

### R3. Планировать не monolithic batch, а chunked sub-batch

Серьезность: High  
Уверенность: High  
Почему это важно для планирования: это лучший компромисс между throughput и blast radius при текущем уровне неопределенности.  
Что делать practically: проектировать `extract_chapters_batch(...)` вокруг `sub-batch=4/8/12`, а не "batch всей книги".

### R4. Зафиксировать version tuple перед любым POC

Серьезность: High  
Уверенность: High  
Почему это важно для планирования: иначе API drift повторит текущую проблему документации.  
Что делать practically: зафиксировать точные версии Modal SDK, `vllm`, model revision и schema revision в benchmark protocol.

### R5. Построить benchmark matrix как инженерный эксперимент, а не как confirmation bias

Серьезность: High  
Уверенность: High  
Почему это важно для планирования: corpus already overfit'нут под желаемый вывод "batch быстрее".  
Что делать practically: сравнивать `sequential current`, `sub-batch 4`, `sub-batch 8`, `sub-batch 12`, `with/without snapshots`, `with/without override`, `backend A/B`, и фиксировать success/error/cost metrics.

### R6. Не принимать production-runtime тезисы без прямых артефактов

Серьезность: Medium  
Уверенность: High  
Почему это важно для планирования: consensus-документ полезен, но часть его strongest claims про production нельзя independently воспроизвести из текущей среды.  
Что делать practically: если эти тезисы войдут в roadmap/risk assessment, приложить SQL extracts, logs или dashboard snapshots с абсолютными датами.

## Открытые вопросы и необходимые POC/benchmark

1. Какой точный API-конфиг structured backend должен использоваться в выбранной версии `vllm`?
2. Каков реальный failure mode при одном oversized/invalid chapter внутри `sub-batch=4/8/12`?
3. Есть ли practical разница между `XGrammar` и `guidance` на вашей schema не только по latency, но и по malformed JSON rate?
4. Дает ли `enable_sleep_mode + snapshots` достаточно большой выигрыш на именно вашем cold path?
5. Нужен ли `num_gpu_blocks_override` для `Qwen3.5-9B` на L40S в вашем workload после актуальной версии `vllm`?
6. Каков p50/p95 wall-clock и cost/book для `sequential current` против `sub-batch` с учетом retries?
7. Как ведет себя pipeline при `2-4` concurrent books?
8. Каков safe payload ceiling по размеру chapter texts и результатов JSON до приближения к Modal `100MB` gRPC limit?
9. Как будет устроена chapter-level idempotency после partial success?
10. Нужен ли `Function.map(return_exceptions=True)` как альтернатива или fallback к внутреннему vLLM batch?

Минимальный benchmark protocol:

1. Зафиксировать versions и один commit baseline.
2. Подготовить три набора книг: обычная, длинная, pathological-long-chapter.
3. Прогнать `sequential current`, `sub-batch 4`, `sub-batch 8`, `sub-batch 12`.
4. Повторить с двумя backend configurations для structured output.
5. Повторить с `num_gpu_blocks_override` и без него.
6. Повторить со snapshots и без них.
7. Отдельно замерить malformed JSON rate, truncation rate, timeout rate, per-book cost, partial recovery success.

## Источники

### Локальные документы

- `docs/research/modal-parallel-batch-consensus-report.md`
- `docs/research/modal-parallel-batch-processing-AUDIT.md`
- `docs/research/parallel-batch-audit-final-AUDIT.md`
- `docs/research/modal-parallel-batch-processing.md`
- `docs/research/parallel-batch-audit-final.md`
- `docs/research/PROMPT-modal-parallel-processing-research.md`
- `docs/research/modal-gpu-migration-plan.md`

### Локальный код репозитория

- `modal/llm_extractor.py`
- `modal/config.py`
- `modal/app.py`
- `modal/schemas.py`
- `backend/app/tasks/book_tasks.py`
- `backend/app/services/modal_client.py`
- `backend/app/services/consistency_manager.py`
- `backend/app/services/entity_synthesis_service.py`
- `backend/tests/services/test_modal_client.py`
- `backend/tests/tasks/test_modal_integration.py`

### Первичные внешние источники

- vLLM `LLM` API: https://docs.vllm.ai/en/v0.18.0/api/vllm/entrypoints/llm/
- vLLM structured outputs config: https://docs.vllm.ai/en/v0.18.0/api/vllm/config/structured_outputs/
- vLLM sleep mode: https://docs.vllm.ai/en/v0.18.0/features/sleep_mode/
- vLLM `StructuredOutputsParams` source: https://raw.githubusercontent.com/vllm-project/vllm/main/vllm/sampling_params.py
- vLLM engine finish reason source: https://raw.githubusercontent.com/vllm-project/vllm/main/vllm/v1/engine/__init__.py
- vLLM PR `#8648`: https://github.com/vllm-project/vllm/pull/8648
- vLLM Issue `#16732`: https://github.com/vllm-project/vllm/issues/16732
- vLLM Issue `#37121`: https://github.com/vllm-project/vllm/issues/37121
- vLLM PR `#37429`: https://github.com/vllm-project/vllm/pull/37429
- vLLM Issue `#18819`: https://github.com/vllm-project/vllm/issues/18819
- vLLM Issue `#19196`: https://github.com/vllm-project/vllm/issues/19196
- vLLM Issue `#10081`: https://github.com/vllm-project/vllm/issues/10081
- vLLM Issue `#27969`: https://github.com/vllm-project/vllm/issues/27969
- Hugging Face model card `Qwen/Qwen3.5-9B`: https://huggingface.co/Qwen/Qwen3.5-9B
- Modal dynamic batching: https://modal.com/docs/guide/dynamic-batching
- Modal `Function` reference: https://modal.com/docs/reference/modal.Function
- Modal `Queue` reference: https://modal.com/docs/reference/modal.Queue
- Modal timeouts: https://modal.com/docs/guide/timeouts
- Modal cold start guide: https://modal.com/docs/guide/cold-start
- Modal memory snapshots: https://modal.com/docs/guide/memory-snapshots
- Modal troubleshooting: https://modal.com/docs/guide/troubleshooting
- Modal pricing: https://modal.com/pricing
