# Аудит: параллельная обработка глав на Modal с vLLM — критический анализ отчёта

## Контекст

**Дата аудита**: 27 марта 2026 года
**Аудитируемый документ**: `docs/research/modal-parallel-batch-processing.md`
**Проект**: fancai.ru — Fiction reader с AI-иллюстрациями и интерактивным глоссарием
**Автор отчёта**: Claude Opus 4.6 на основе веб-исследования vLLM, Modal и Qwen3.5-9B

### Цель аудита

Провести **критический, глубокий и подробный** аудит исследовательского отчёта `docs/research/modal-parallel-batch-processing.md`. Каждое утверждение, число, ссылку и рекомендацию проверить на актуальность (март 2026) и корректность. Выявить пробелы, ошибки, недооценённые риски и альтернативы, которые отчёт упустил.

Аудит должен быть **одновременно широким** (покрыть все 9 разделов) **и глубоким** (проверить каждое конкретное утверждение с source verification в вебе).

## Текущий стек (для контекста аудитора)

```
Modal GPU: L40S (48GB GDDR6X)
Модель: Qwen/Qwen3.5-9B (гибридная: 24 GatedDeltaNet + 8 Full Attention layers)
vLLM: v0.18.0
Modal SDK: ~1.4.0
Backend: FastAPI + Celery + PostgreSQL + Redis
Frontend: React 19 + TypeScript 5.7
```

## Задачи аудита

### Блок A: Верификация фактов и утверждений

Для **каждого** фактического утверждения в отчёте — проверить через актуальные источники:

#### A1. vLLM Batch API (раздел 2)

- **Сигнатура `llm.chat()`**: Проверить, что именно `messages: list[ChatCompletionMessageParam] | Sequence[list[ChatCompletionMessageParam]]` — реальная текущая сигнатура в vLLM 0.18.0. Не изменилась ли она? Найти актуальный исходный код.
- **PR #8648**: Подтвердить, что этот PR действительно добавил batch chat support. Проверить, не был ли он reverted или superseded.
- **`StructuredOutputsParams` в batch mode**: Отчёт утверждает "работает". Найти конкретные тесты или issues, подтверждающие (или опровергающие) это. Есть ли known issues при batch + structured output + Qwen3.5 конкретно?
- **Issue #16732 (per-request error handling)**: Действительно ли закрыт как "not planned"? Не был ли reopened, не появился ли fix в v0.18.0?
- **`finish_reason: "length"`**: Проверить, что vLLM 0.18.0 действительно возвращает `"length"` при truncation structured output. Не возвращает ли он другое значение (e.g., `"stop"`, `None`)?
- **SqueezeBits benchmark**: Верифицировать утверждение "при batch size >= 8 xgrammar overhead видимый". Найти оригинальный benchmark, проверить цифры.
- **xgrammar vs guidance**: Проверить, действительно ли `backend="guidance"` доступен и стабилен в vLLM 0.18.0. Не deprecated ли? Какой backend используется по умолчанию именно в этой версии?

#### A2. Modal Patterns (раздел 3)

- **`@modal.batched()` не подходит**: Проверить текущую документацию Modal. Действительно ли ограничение "class с @modal.batched не может иметь других методов" всё ещё актуально?
- **gRPC payload limit 100 MB**: Найти актуальный лимит в документации Modal. Не изменился ли? 100 MB — это для `.remote()` args или для всего вызова включая metadata?
- **`Function.map()` с `return_exceptions=True`**: Проверить, что этот параметр существует именно с таким именем. В некоторых версиях Modal он мог называться иначе.
- **`modal.Queue`**: Проверить TTL, лимиты, актуальную документацию. Не deprecated ли Queue в пользу другого механизма?
- **Timeout до 24 часов**: Подтвердить текущий макс timeout для Modal functions.
- **`scaledown_window` диапазон**: Отчёт говорит "2 секунды до 20 минут". Проверить актуальные лимиты.
- **Pricing L40S $1.95/hr**: Проверить текущий pricing на modal.com/pricing. Не менялся ли?

#### A3. Qwen3.5-9B специфика (разделы 4, 9)

- **Архитектура "24 GatedDeltaNet + 8 Full Attention"**: Верифицировать через model card на HuggingFace. Точное количество слоёв каждого типа.
- **Bug #37121 (7x overestimation)**: Проверить текущий статус issue. Merged? Closed? Всё ещё актуален для vLLM 0.18.0? Правильно ли описан root cause?
- **`num_gpu_blocks_override=512`**: Откуда берётся число 512? Это оптимальное значение или произвольное? Как его вычислить корректно? Что произойдёт при 256 или 1024?
- **KV cache ~32 KB/token**: Проверить формулу. Отчёт даёт `2 x 8 x 4 x 256 x 2 bytes`. Верифицировать: 8 слоёв, 4 KV heads per layer (GQA), head_dim=256, 2 bytes (BF16). А при fp8 KV cache — будет 16 KB/token?
- **"Prefill медленнее чем у стандартных трансформеров"**: Найти benchmarks, подтверждающие это. Насколько медленнее? 2x? 5x? Это критично для нашего batch use case?
- **Warning "Input tensor shape suggests potential format mismatch"**: Отчёт ссылается на Issue #37103. Проверить статус — fixed? Действительно ли безвредно?
- **`enable_prefix_caching=True` с Mamba**: Отчёт говорит "экспериментально, но работает". Проверить — нет ли regression reports, data corruption, или silent accuracy degradation?

#### A4. Cold start (раздел 5)

- **torch.compile cache path `~/.cache/vllm/torch_compile_cache/`**: Проверить, что это актуальный путь в vLLM 0.18.0. Не изменился ли?
- **Tensorfuse benchmark (42s → 13s)**: Проверить оригинальный blog post. На какой модели получены числа? Применимы ли к Qwen3.5-9B?
- **`VLLM_TORCH_COMPILE_LEVEL=1` (O1)**: Проверить, что эта env var существует и работает. Какой точный trade-off: сколько % быстрее startup, сколько % медленнее inference?
- **`compilation_config={"cudagraph_capture_sizes": [1, 2, 4, 8, 16, 32]}`**: Проверить, что этот параметр LLM() принимает. Как именно называется? Не `cudagraph_batch_sizes`? Не через env var?
- **GPU snapshot sleep mode**: Отчёт утверждает, что `vllm.LLM` class не поддерживает sleep/wake. Проверить — может появился API в v0.18.0? Или через EngineCore?
- **Modal Ministral 3 example**: Проверить, что пример на modal.com/docs/examples/ministral3_inference актуален и использует именно описанный sleep pattern.

#### A5. Structured output (разделы 2.6, 2.7, 4)

- **Issue #8350 (truncation)**: Проверить статус. Не появился ли fix? Не был ли reopened?
- **Issue #18819 (Qwen3 + structured output)**: Проверить — это Qwen3 или Qwen3.5? Один и тот же баг? Fixed в v0.18.0?
- **`maxLength` в Pydantic → JSON Schema**: Проверить, что `Field(max_length=2000)` действительно генерирует `"maxLength": 2000` в JSON Schema. И что xgrammar/guidance backends это уважают (а не игнорируют).
- **`backend="guidance"` parameter**: Проверить точный синтаксис. Не `guided_decoding_backend`? Не через отдельный arg?

#### A6. FlashInfer (раздел 4, проблема 10)

- **`flashinfer-cubin` и `flashinfer-jit-cache`**: Проверить, что эти packages существуют на PyPI. Версии совместимы с vLLM 0.18.0?
- **`VLLM_ATTENTION_BACKEND=TRITON_ATTN_VLLM_V1`**: Проверить точное имя env var и значение. Не `FLASH_ATTN`? Не `TRITON`?
- **"100.7% от FlashAttention 3 на H100"**: Проверить источник. Применимо ли к L40S (разная архитектура GPU)?

### Блок B: Анализ недочётов и пробелов

#### B1. Пропущенные risk factors

- **Serialization overhead**: 23 главы x ~20KB = ~460KB. Но Modal использует serialization — проверить, нет ли overhead при serialization/deserialization большого `List[Optional[dict]]` с nested structures (descriptions, entities, relationships). Каждый dict может быть 50-200KB JSON. Суммарно 1-5 MB десериализованных данных.
- **Memory pressure на L40S**: При batch 23 глав — peak memory consumption. Учтён ли simultaneous KV cache для 23 запросов + model weights + structured output FSM state? Может ли OOM произойти в mid-inference?
- **Structured output FSM state**: xgrammar/guidance хранят state per-request. При batch 23 — 23 FSM instances. Это CPU overhead? Может ли это стать bottleneck?
- **Network timeout на `.remote()` уровне**: Modal `.remote()` имеет свой timeout. Отчёт ставит `LLM_TIMEOUT=1800` на class level. Но есть ли отдельный timeout на `.remote()` call из VPS? `asyncio.to_thread()` не имеет встроенного timeout.
- **Celery soft/hard time limits**: Текущий `soft_time_limit=10500` (2h 55m). С batch mode вся обработка быстрее, но cold start + batch + post-processing + retry = ? Не упрётся ли в time limit?
- **Modal free plan 10 GPU limit**: С batch mode нужен 1 GPU. Но что если параллельно 2 книги обрабатываются? Или image generation тоже на L4? Учтён ли concurrent usage?

#### B2. Accuracy of benchmarks (раздел 9)

- **"~40-50 tok/s batch 1, ~300-500 tok/s batch 8-20"**: Откуда эти числа для Qwen3.5-9B конкретно? Отчёт ссылается на Qwen 2.5 7B benchmarks и экстраполирует. Корректна ли экстраполяция для гибридной модели с DeltaNet?
- **Prefill estimate**: "23 x 8K = 184K tokens, chunked prefill 8192 tokens/batch = ~23 batches x ~2s each = 46s total prefill". Проверить — DeltaNet prefill значительно медленнее (рекуррентный). Реальное время может быть 2-3x больше.
- **Decode estimate**: "23 x 4K = 92K tokens, ~500 tok/s aggregate". Проверить — это output throughput при batch 20 для 9B модели на L40S. Realistic? L40S bandwidth limited (864 GB/s vs A100 2TB/s)?
- **Total inference ~230s = 4 мин**: Может быть слишком оптимистично. Проверить с учётом DeltaNet overhead, structured output overhead, и L40S memory bandwidth.
- **Cost $0.20 для batch**: Если inference реально 4 мин + cold start 110s ≈ 6.8 мин, то cost = $1.95 x (6.8/60) ≈ $0.22. Но scaledown_window=60s добавляет ещё 1 мин → $0.25. Корректно ли $0.20 в отчёте?

#### B3. Code review предложенных изменений (раздел 7)

- **`extract_chapters_batch` метод**: В fallback (except) делается sequential retry — но timeout=1800s может истечь во время sequential fallback после частичного batch failure. Нет time budget tracking.
- **`os.environ.setdefault("VLLM_TORCH_COMPILE_LEVEL", "1")` в `load_model()`**: Проверить — env var уже прочитан vLLM к моменту `LLM()` конструктора? Или нужно ставить раньше (module level)?
- **`num_gpu_blocks_override=512`**: Это параметр LLM()? Или SamplingParams? Или engine_args? Проверить точное имя и placement.
- **`compilation_config`**: Какой тип принимает? `dict`? `CompilationConfig`? Правильный ли синтаксис?
- **`@modal.exit()` для cleanup**: Modal гарантирует вызов `@modal.exit()` при scaledown? Или только при graceful shutdown? При OOM — вызовется ли?
- **Image для LLM**: Всё ещё `nvidia/cuda:12.8.1-devel-ubuntu22.04`. Если Triton backend или flashinfer-cubin решают JIT — можно ли перейти на runtime image? Отчёт рекомендует, но в коде оставляет devel.
- **`modal_batch_to_chapter_results`**: Функция простая, но нет error handling — если `r` не dict, а что-то неожиданное (string, list), конвертер упадёт молча.

#### B4. Архитектурные альтернативы, которые не рассмотрены

- **vLLM server mode в Modal (не sleep/wake, а просто HTTP)**: Можно запустить `vllm serve` как `@modal.web_server()` и слать 23 HTTP запроса параллельно с VPS через `httpx.AsyncClient`. Это даёт per-request error handling (HTTP 500 на одном запросе не убивает остальные). Почему этот вариант не рассмотрен как основная альтернатива?
- **Chunked batch**: Вместо одного batch 23 глав — разбить на 3-4 sub-batch по 6-8 глав. Если один sub-batch fails, остальные уже обработаны. Compromise между throughput и resilience.
- **Async completion**: `Function.spawn()` для fire-and-forget с polling. VPS не блокируется на 10-15 мин.
- **Dual-path processing**: Короткие главы (<5K tokens) через OpenRouter Gemini Flash (быстро, дёшево), длинные (>10K) через Modal vLLM (мощнее). Hybrid approach.
- **Speculative decoding**: vLLM 0.18.0 поддерживает speculative decoding. Для structured output с предсказуемой структурой (JSON schema) — может дать 2-3x ускорение decode phase.
- **Quantized model**: Qwen3.5-9B-FP8 или GPTQ-Int4 вместо BF16. Быстрее inference, меньше memory, больше batch concurrency. Отчёт упоминает FP8 crashes (#35702), но Int4 может работать.

#### B5. Edge cases и production concerns

- **Книга с 100+ главами** (эпик-фэнтези, сериалы): batch 100 глав — сколько памяти? Влезет ли в KV cache? Нужно ли chunk по 30?
- **Глава с >30K tokens**: При max_model_len=32768 и system prompt ~500 tokens + XML tags — реальный лимит ~31K. Длинная глава + output = может упереться.
- **Concurrent books**: Два пользователя одновременно отправляют книги. Оба вызывают `.remote()` → два Modal контейнера? Или очередь?
- **Modal outage / slow response**: Что если `.remote()` завис на 25 минут? Celery soft_time_limit сработает. Но partial results не сохранены.
- **Consistency**: В batch mode все главы обрабатываются вместе. Если контейнер crash в середине — ни один результат не сохранён (vs sequential, где 12 из 23 могут быть сохранены). Нужен ли partial save через Queue?
- **Idempotency**: Если Celery retry'ит task после timeout — batch вызов повторится для ВСЕХ глав, включая уже обработанные (is_description_parsed=True в коде, но check до batch, а не после).

### Блок C: Верификация ссылок и источников

Для каждой ссылки в разделе "Ссылки" отчёта:

1. **Открыть URL** — доступен ли? Не 404?
2. **Проверить содержание** — соответствует ли тому, что утверждает отчёт?
3. **Дата публикации** — актуально ли на март 2026?
4. **Конкретные числа** — если ссылка используется для обоснования числа (benchmark, pricing) — совпадает ли число?

Список ссылок для проверки:

- [ ] vLLM PR #8648
- [ ] vLLM Issues: #8350, #8481, #16732, #37121, #18819, #15236, #19196, #37103
- [ ] Modal docs: gpu_snapshot, dynamic-batching, batch-processing, vllm_throughput, memory-snapshot, timeouts, pricing
- [ ] Modal blog: gpu-mem-snapshots, mistral-3
- [ ] Qwen3.5: HuggingFace card, Artificial Analysis, vLLM Recipes
- [ ] Benchmarks: Tensorfuse blog, SqueezeBits, Koyeb, FlashInfer
- [ ] PyTorch blog: hybrid-models-as-first-class-citizens-in-vllm
- [ ] vLLM docs: optimization_levels, offline_inference, structured_outputs, triton-backend

### Блок D: Общая оценка

#### D1. Полнота

- Все ли вопросы из оригинального промпта (7 подразделов, 35+ вопросов) получили ответ?
- Какие вопросы остались без ответа или с поверхностным ответом?
- Не пропущены ли важные аспекты, не упомянутые в оригинальном промпте?

#### D2. Внутренняя consistency

- Нет ли противоречий между разделами? (например, числа в benchmarks vs утверждения в summary)
- Согласуются ли рекомендации между собой?
- Не противоречит ли код в разделе 7 описаниям в разделах 2-6?

#### D3. Практическая применимость

- Достаточно ли детален код для copy-paste имплементации?
- Какие неочевидные шаги пропущены? (deploy, testing, rollback plan)
- Нужна ли поэтапная миграция вместо big-bang?

#### D4. Оценка рисков

- Адекватны ли оценки вероятности рисков? (LOW/MEDIUM/HIGH)
- Нет ли blind spots — рисков, которые полностью упущены?
- Достаточен ли Plan B (OpenRouter)? Нужен ли Plan C?

## Формат ответа

Структурируй аудит в markdown документ `docs/research/modal-parallel-batch-processing-AUDIT.md`:

### Обязательные разделы:

1. **Вердикт** — общая оценка качества отчёта (1-10), ключевые findings аудита
2. **Верификация фактов** — для каждого проверенного утверждения: CONFIRMED / OUTDATED / INCORRECT / UNVERIFIABLE с обоснованием и ссылкой на источник
3. **Критические ошибки** — утверждения, которые фактически неверны и могут привести к проблемам при имплементации
4. **Недочёты и пробелы** — что упущено, недооценено или не рассмотрено
5. **Переоценённые и недооценённые риски** — коррекция risk assessment
6. **Code review findings** — проблемы в предложенном коде
7. **Альтернативные подходы** — что стоило рассмотреть
8. **Скорректированные benchmarks** — пересчёт ожидаемых чисел с учётом найденных ошибок
9. **Рекомендации** — что изменить в отчёте/плане перед имплементацией

### Требования к аудиту:

- **Source verification**: Каждое утверждение проверяй через актуальные источники в вебе. Не принимай утверждения отчёта на веру.
- **Конкретность**: Не "может быть проблема" — а "проблема X потому что Y, как видно из Z (ссылка)".
- **Actionable**: Каждый finding должен содержать рекомендацию "что с этим делать".
- **Evidence-based**: Каждый finding должен ссылаться на конкретный источник (GitHub issue, документация, benchmark).
- **На русском языке**: Весь аудит на русском. Технические термины и код — в оригинале.
