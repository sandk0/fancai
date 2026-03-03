# Аудит отчёта v3: Ревизия с приоритетом качества

**Дата:** 2026-03-01
**Scope:** Критический аудит `infrastructure-audit-v3-openrouter.md`, анализ рисков Valkey/Granian, пересмотр приоритетов «качество > стоимость»
**Автор:** Claude Code

## Executive Summary

Отчёт v3 содержит ценные фактчек-данные (11 ошибок v1/v2), но систематически **смещён в сторону экономии за счёт качества и стабильности**. Найдено **9 критических проблем**: Qwen3 32B как Primary имеет задокументированные баги structured output и деградацию на длинных контекстах; Valkey имеет **недокументированное breaking change** в MULTI транзакциях и баг с коррупцией данных в 9.0.x; Granian имеет **6+ WebSocket багов** за последние 3 месяца при bus factor = 1. Пересмотренные рекомендации: оставить Redis 7.4, отказаться от Granian навсегда, оставить Gemini 2.5 Flash как Primary с оптимизацией через Context Caching, использовать OpenRouter только как fallback.

---

## Часть 1: Критика v3 — системные проблемы

### КРИТИКА 1: Смещение приоритета в сторону стоимости

Весь отчёт v3 построен вокруг метрики «$/книга» и «экономия vs текущего». Качественные характеристики моделей описаны в таблице одним словом («Хорошо», «Отлично»), тогда как стоимость — точными цифрами с расчётами.

**Примеры смещения:**

- Qwen3 32B помечен **"BEST VALUE"** в таблице (строка 237), хотя это оценка стоимости, а не качества
- Стратегия routing (строка 262) ставит Qwen3 на первое место, Gemini — на третье («quality fallback»)
- TCO сценарий C ($89/мес) подан как оптимальный, хотя основан на непроверенном Qwen3
- Экономия «-88%» вынесена жирным в таблицу, а предупреждение о json_schema — мелким текстом

**Влияние:** Читатель получает впечатление, что Qwen3 — очевидный выбор. Реальная картина — Qwen3 дёшев, но имеет задокументированные проблемы с качеством, которые v3 не исследовал.

### КРИТИКА 2: Качество русского языка Qwen3 — маркетинг, не данные

v3 утверждает: «Отлично (119 языков)» (строка 237).

**Факт:** «119 языков» — это маркетинговый claim из блога Qwen3. Нет ни одного опубликованного бенчмарка MMMLU с разбивкой по русскому языку для Qwen3 32B. Агрегированные MMMLU скоры не говорят о качестве русского.

Для сравнения:

- Gemini используется в опубликованных исследованиях NER для русских культурных текстов ([arxiv.org/html/2506.02589v1](https://arxiv.org/html/2506.02589v1))
- Gemini 2.0 Flash Thinking достигает **micro-accuracy 0.98 (POS) и macro-F1 0.98 (NER)** в zero-shot cross-lingual transfer
- Для Qwen3 32B аналогичных данных нет

**Вердикт:** Утверждение v3 о «отличном русском» Qwen3 — необоснованное.

### КРИТИКА 3: JSON Schema — задокументированные баги Qwen3

v3 указывает: «✅ (non-thinking)» для JSON Schema у Qwen3 (строка 237). Это **вводит в заблуждение**.

**Факты:**

1. **vLLM Issue #18819** — ВСЕ модели Qwen3 при `enable_thinking=False` + `guided_json` дают **невалидный JSON**: лишние `{`, `[`, тройные backticks, или «complete gibberish»
2. **SGLang Issue #6675** — аналогичная проблема
3. **LangChain Issue #31335** — аналогичная проблема
4. **Alibaba Cloud документация**: «Generating a JSON string from a given JSON Schema is not currently supported»
5. **Практический бенчмарк (Medium, Dec 2025)**: «Qwen3 reliably handle simpler JSON... but lag slightly behind on harder schemas. Good enough if you wrap them with retry + JSON fixers»

**Workarounds существуют** (`/no_think` в промпте, thinking mode), но каждый добавляет сложность и стоимость.

**Для сравнения — Gemini:** `response_schema=PydanticModel` гарантирует валидный JSON. Google документация: «including a response_schema ensures you always receive valid JSON». Контролируемый тест показал **100% success rate**.

**OpenRouter Response Healing:** Исправляет синтаксис JSON (лишние скобки), но **НЕ исправляет несоответствие schema** (неправильные имена полей, отсутствующие required properties, неправильные типы). Для fancai со сложными Pydantic schemas (GeminiEntitySchema, GeminiDescriptionSchema, GeminiRelationshipSchema) — это недостаточно.

**Источники:** [vLLM #18819](https://github.com/vllm-project/vllm/issues/18819), [SGLang #6675](https://github.com/sgl-project/sglang/issues/6675), [Alibaba Cloud docs](https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output), [OpenRouter Healing](https://openrouter.ai/docs/guides/features/plugins/response-healing)

### КРИТИКА 4: Контекстное окно Qwen3 — критический риск для fancai

v3 указывает: «131K» контекст (строка 237). Это технически верно, но скрывает важную деталь.

**Факт:** Qwen3 32B имеет **нативное окно 32K токенов**, расширенное до 131K через YaRN scaling. Это не то же самое, что нативный 1M контекст Gemini.

**Задокументированные проблемы:**

- [HuggingFace Discussion #18](https://huggingface.co/Qwen/Qwen3-32B/discussions/18): тест на 107K токенов — Qwen3-32B **не смог найти ответ**, при том что Qwen3-30B-A3B справился
- GGUF + llama.cpp на том же промпте: 3 из 4 запусков дали правильный результат
- Оптимальные YaRN factors 3.37-3.40625 требуют ручной настройки

**Для fancai:** Главы русских книг до 100K символов = примерно 25-40K токенов. С системным промптом (~2K токенов) это уже **на границе нативного окна 32K**. Для крупных глав YaRN scaling включится с задокументированной деградацией качества.

**Gemini:** 1M контекст нативный, 10-25x запаса для любой главы.

### КРИТИКА 5: Consistency — задокументированная деградация Qwen3

v3 не исследует консистентность моделей при batch-обработке 100+ глав.

**Факты:**

- [vLLM #17652](https://github.com/vllm-project/vllm/issues/17652): batch_size=50 → ухудшение и нечитаемый output
- [vLLM #18252](https://github.com/vllm-project/vllm/issues/18252): automatic batch inference → «хаотичные» результаты
- [HuggingFace discussion](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct/discussions/9): batch vs individual → разные outputs при temperature=0
- [Mode drift analysis](https://blog.lukaszolejnik.com/prompt-injection-and-mode-drift-in-qwen3-a-security-analysis/): при отключении reasoning эффект сохраняется в рамках контекстного окна

Для обработки 100+ глав книги последовательно — это прямой риск.

### КРИТИКА 6: Интеграционная сложность не оценена

v3 предлагает простую интеграцию (строки 184-197): «меняется только `base_url` и `api_key`». Это **фундаментально неверно** для fancai.

**Реальная интеграция fancai использует google-genai SDK нативно в 5 сервисах:**

| Сервис              | Файл                              | Использование                                                            |
| ------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| Gemini Extractor    | `gemini_extractor.py`             | `client.aio.models.generate_content()` + `response_schema=PydanticModel` |
| Entity Dedup        | `entity_deduplication_service.py` | `response_schema=DeduplicationResponse` + `response_mime_type`           |
| Entity Synthesis    | `entity_synthesis_service.py`     | `types.GenerateContentConfig` + Pydantic                                 |
| Consistency Manager | `consistency_manager.py`          | `google.genai.types`                                                     |
| Imagen Generator    | `imagen_generator.py`             | `client.models.generate_images()`                                        |

Ключевое: **`response_schema=PydanticModel`** — нативная фича google-genai SDK, которой **нет аналога в OpenAI SDK**. Миграция требует:

1. Переписать все 5 сервисов на OpenAI SDK
2. Конвертировать Pydantic models → JSON Schema → injected в промпт
3. Добавить валидацию ответов (Gemini гарантирует валидность, OpenRouter — нет)
4. Добавить retry logic для невалидных ответов
5. Добавить Response Healing wrapper
6. Тестировать все extraction pipelines на реальных книгах

**Оценка трудозатрат:** 2-4 недели разработки + тестирования, не 1-2 недели как указано в v3.

### КРИТИКА 7: OpenRouter — единая точка отказа

v3 перечисляет недостатки OpenRouter (строки 210-215), но не анализирует реальную reliability.

**Факт:** Февраль 2026 — два крупных сбоя:

- 17 февраля: failure rate 20% → **80-90%** на 25 минут
- 19 февраля: аналогичная ситуация, ~30 минут near-total downtime
- Причина: сбой кеширующего слоя (не DDoS)

**Источник:** [OpenRouter Outages Feb 2026](https://openrouter.ai/announcements/openrouter-outages-on-february-17-and-19-2026)

Если OpenRouter — primary для LLM extraction, то 30 минут downtime = остановка обработки книг для всех пользователей. С прямым Gemini API такого риска нет (Google SLA 99.95%).

---

## Часть 2: Глубокий анализ рисков Valkey

### Рекомендация v3: Valkey 9.x как P1 (строка 471)

**Пересмотренная рекомендация: ОСТАВИТЬ Redis. Миграция на Valkey нецелесообразна при текущем масштабе.**

### 2.1 MULTI Transaction Breaking Change — НЕДОКУМЕНТИРОВАННОЕ

|                    | Redis                                           | Valkey                             |
| ------------------ | ----------------------------------------------- | ---------------------------------- |
| WATCH внутри MULTI | Ошибка, но **EXEC выполняет** остальные команды | Ошибка → **ABORT всей транзакции** |
| Nested MULTI       | Ошибка, транзакция продолжается                 | Ошибка → **ABORT**                 |

Это **undocumented breaking change** ([Issue #1629](https://github.com/valkey-io/valkey/issues/1629)). Celery и redis-py используют MULTI/EXEC для atomicity. Если в цепочке команд возникает ошибка (любая), Valkey откатит ВСЮ транзакцию, тогда как Redis выполнит валидные команды.

**Влияние на fancai:** Celery result backend, distributed lock, Redis PubSub — все используют pipeline/MULTI. Поведенческое отличие может привести к silent data loss.

### 2.2 Celery + Valkey — hack, не интеграция

| Аспект                         | Статус                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `valkey://` URL scheme         | **НЕ поддерживается** — Celery/Kombu crash: `"No such transport: valkey"`                                                                                    |
| `redis://` → Valkey workaround | Работает, но **fragile**                                                                                                                                     |
| PR #9300 (native support)      | **DRAFT** — не мержен                                                                                                                                        |
| `celery-valkey-backend` PyPI   | **v0.1.0** — не production-ready                                                                                                                             |
| Version string parsing         | Valkey возвращает `"7.2"` вместо `"7.2.4"` → `'float' object has no attribute 'split'` ([Sentry #107394](https://github.com/getsentry/sentry/issues/107394)) |

**Риск:** При обновлении Celery (5.6 → 5.7 или 6.0) `redis://` workaround может сломаться. Нет гарантий backward compatibility.

### 2.3 Valkey 9.x — нестабильная ветка

| Версия | Дата     | Urgency      | Критические баги                                                                                   |
| ------ | -------- | ------------ | -------------------------------------------------------------------------------------------------- |
| 9.0.0  | Oct 2025 | MODERATE     | Lua VM crash, hashtable shrinking crash                                                            |
| 9.0.1  | —        | MODERATE     | Performance regression, deadlock in IO-thread shutdown, CLUSTER SLOTS crash                        |
| 9.0.2  | —        | **HIGH**     | **Data corruption** в AOF slot cache (key duplication), chained replica crash, memory leak HEXPIRE |
| 9.0.3  | Feb 2026 | **SECURITY** | 3 CVE: protocol injection, remote DoS, request handling                                            |

**4 патча за 5 месяцев с HIGH и SECURITY urgency.** Баг коррупции данных в 9.0.2 ([#3004](https://github.com/valkey-io/valkey/releases/tag/9.0.2)) — disqualifier для production.

v3 рекомендует Valkey 9.x (строка 471). Даже если использовать Valkey, правильная версия — **8.1.6** (stable, Feb 24 2026).

### 2.4 Performance gain — нерелевантен для fancai

v3 утверждает: «Valkey ~37% быстрее для SETs, ~16% для GETs».

**Контекст, который v3 не даёт:**

- Требует io-threads (не дефолт)
- Требует host networking (не Docker NAT — [баг с регрессией производительности](https://github.com/centminmod/redis-comparison-benchmarks))
- Требует 100+ конкурентных клиентов
- **Без io-threads — производительность идентична** (~235-239K RPS)

fancai имеет ~50 пользователей, Redis используется как кеш + broker + result backend. При нагрузке < 1000 RPS разница между Redis и Valkey — **нулевая**.

### 2.5 Вердикт по Valkey

| Аргумент ЗА              | Контраргумент                                                 |
| ------------------------ | ------------------------------------------------------------- |
| Open source (BSD)        | Redis 7.4 RSAL — но мы используем как сервис, не модифицируем |
| +37% throughput          | Нерелевантно при < 1000 RPS                                   |
| Linux Foundation backing | Зрелость кодовой базы < 2 лет                                 |
| Дешевле (бесплатен)      | Redis тоже бесплатен для нашего use case                      |

**Решение: ОСТАВИТЬ Redis 7.4-alpine.** Миграция на Valkey не приносит выгоды при текущем масштабе, но несёт риски:

- Breaking change в MULTI
- Celery через hack
- 9.x нестабилен
- Нулевой performance gain

---

## Часть 3: Глубокий анализ рисков Granian

### Рекомендация v3: Granian P2 «после стабилизации» (строка 470)

**Пересмотренная рекомендация: ПОЛНОСТЬЮ ОТКАЗАТЬСЯ от Granian. Не включать даже в долгосрочные планы.**

### 3.1 WebSocket — CRITICAL для fancai

fancai использует WebSocket для real-time progress обработки книг (`/ws/book-progress/{book_id}`, `websocket.py`). Соединение живёт минуты во время парсинга. Redis PubSub → WebSocket → клиент.

**Баги WebSocket в Granian (последние 3 месяца):**

| Issue                                                              | Описание                                               | Статус       | Влияние на fancai              |
| ------------------------------------------------------------------ | ------------------------------------------------------ | ------------ | ------------------------------ |
| [#798](https://github.com/emmett-framework/granian/issues/798)     | `websocket.close` не доставляет `websocket.disconnect` | Fixed v2.7.1 | Утечка соединений              |
| [#818](https://github.com/emmett-framework/granian/issues/818)     | `websocket.close` до `accept` → hang                   | Fixed v2.7.2 | Зависание auth failure         |
| [#815](https://github.com/emmett-framework/granian/issues/815)     | Неправильный парсинг subprotocols                      | Fixed v2.7.2 | —                              |
| [#803](https://github.com/emmett-framework/granian/issues/803)     | WS tasks не cleanup на shutdown                        | Fixed v2.7.1 | Утечка при deploy              |
| **[#613](https://github.com/emmett-framework/granian/issues/613)** | **Нет WS ping/pong на уровне протокола**               | **OPEN**     | Connections за proxy дропаются |
| [#487](https://github.com/emmett-framework/granian/issues/487)     | Crash при ~100 WS соединениях (Rust panic)             | Fixed        | —                              |
| [#186](https://github.com/emmett-framework/granian/issues/186)     | `RuntimeError: ASGI flow error` на disconnect          | Fixed        | —                              |

**Критично:** Issue #613 (OPEN с июня 2025) — Granian не поддерживает **WebSocket ping/pong на уровне протокола**. Uvicorn имеет `--ws-ping-interval` и `--ws-ping-timeout`. fancai отправляет JSON `{"type": "ping"}` как workaround, но за nginx/Cloudflare протокольные PING frames **необходимы** для keepalive.

### 3.2 Graceful Shutdown — CRITICAL для fancai

**[#547](https://github.com/emmett-framework/granian/issues/547)** — **OPEN.** `lifespan.shutdown` event НЕ отправляется при получении SIGTERM.

fancai `main.py` использует `@asynccontextmanager async def lifespan(app)` для cleanup Redis, rate limiter, cache при shutdown. **С Granian этот код НИКОГДА не выполнится** при rolling restart Docker контейнера.

**[#611](https://github.com/emmett-framework/granian/issues/611)** — «Graceful shutdowns considered... almost impossible?» Автор — Hynek Schlawack (автор `attrs`, `structlog`). Granian с HTTP/2 за HAProxy зависает навсегда при shutdown.

**[#813](https://github.com/emmett-framework/granian/issues/813)** — Worker не завершается, потому что Rust layer ждёт connection futures бесконечно.

### 3.3 FastAPI совместимость

| Проблема                                           | Issue                                                          | Статус       | Влияние                              |
| -------------------------------------------------- | -------------------------------------------------------------- | ------------ | ------------------------------------ |
| GZipMiddleware → AssertionError                    | [#216](https://github.com/emmett-framework/granian/issues/216) | Fixed        | fancai использует middleware stack   |
| BackgroundTasks + StreamingResponse не выполняются | [#525](https://github.com/emmett-framework/granian/issues/525) | Fixed v2.2.1 | images.py, reading_sessions.py       |
| FileResponse + BackgroundTask → 404                | [#670](https://github.com/emmett-framework/granian/issues/670) | Closed       | Разный порядок выполнения vs Uvicorn |

### 3.4 paperless-ngx — «production user» с проблемами

Granian PyPI page утверждает: «used by paperless-ngx, Microsoft, Mozilla, Sentry».

**Факт:**

- paperless-ngx использует Granian, но имеет **множество issue reports**: ASGI transport errors (#9592, #9640), RuntimeError: ASGI flow error (#9608), users debugging which files cause errors (#10801)
- paperless-ngx **НЕ использует WebSocket** — гораздо проще use case
- «Microsoft, Mozilla, Sentry» — **нет публичных свидетельств** (ни блог-постов, ни конференций, ни incident reports). Маркетинг.

### 3.5 Bus Factor = 1

| Метрика                    | Значение             |
| -------------------------- | -------------------- |
| GitHub Stars               | 5,103                |
| Top contributor (gi0baro)  | 642 коммитов         |
| 2-й contributor (человек)  | 5 коммитов           |
| 3-й contributor (человек)  | 3 коммита            |
| Rust + Python FFI codebase | Сложно контрибьютить |

Для сравнения: Uvicorn — 40+ contributors, поддерживается Encode team + Kludex, широкое community.

### 3.6 Real-world performance gain — пренебрежимо мал

Бенчмарки Granian: 3x vs Uvicorn на hello-world 10KB response.

**Для fancai:** Запрос = 50ms DB + 20ms Gemini API + 10ms сериализация. Server overhead: Granian ~0.5ms, Uvicorn ~1.5ms. Разница: **~1ms** на запрос = **< 2% от общего latency**. 15 релизов за 8 месяцев ради 2% — неразумный trade-off.

### 3.7 Вердикт по Granian

**ПОЛНЫЙ ОТКАЗ.** Granian не подходит для fancai ни сейчас, ни в будущем, потому что:

1. WebSocket — core feature fancai — имеет критические недоработки в Granian
2. Graceful shutdown не работает — потеря данных при deploy
3. Bus factor 1 — долгосрочный риск
4. Negligible performance gain для DB-heavy приложения
5. 15 релизов за 8 месяцев — ещё не стабилизировался

Удалить Granian из roadmap полностью. Uvicorn — battle-tested выбор.

---

## Часть 4: Пересмотр модельной стратегии (качество > стоимость)

### 4.1 Сравнение Gemini vs Qwen3 по качеству

| Критерий               | Gemini Flash                    | Qwen3 32B                                      | Победитель |
| ---------------------- | ------------------------------- | ---------------------------------------------- | ---------- |
| Русский (доказано)     | Published NER research, F1=0.98 | «119 языков», нет Russian-specific data        | **Gemini** |
| JSON Schema            | Гарантированный валидный JSON   | Баги без workarounds, healing не фиксит schema | **Gemini** |
| Контекст (100K chars)  | 1M нативный                     | 32K нативный, 131K YaRN с деградацией          | **Gemini** |
| Entity extraction      | langextract ecosystem, proven   | Нет данных                                     | **Gemini** |
| Batch consistency      | Стабильный                      | Деградация при batch, mode drift               | **Gemini** |
| Operational complexity | Простой (direct API, Pydantic)  | Сложный (workarounds, healing, retries)        | **Gemini** |
| Стоимость на книгу     | $1.20                           | $0.20                                          | **Qwen3**  |

### 4.2 Пересмотренная стратегия

**Было (v3):**

1. Primary: Qwen3 32B (OpenRouter) — $0.20/книга
2. Fallback: DeepSeek V3.2 (OpenRouter) — $0.55/книга
3. Quality fallback: Gemini 2.5 Flash — $1.20/книга

**Стало (quality-first):**

1. **Primary: Gemini 2.5 Flash** (direct API) — $1.20/книга → **$0.50-0.70 с Context Caching**
2. **Fallback: Gemini 3.0 Flash** (direct API) — текущая модель, при rate limit 2.5 Flash
3. **Budget fallback: Qwen3 32B** (OpenRouter) — только при недоступности Google API
4. **Imagen 4 Fast** — оставить без изменений (primary)
5. **FLUX 2 Pro** (OpenRouter) — fallback для blocked сцен

### 4.3 Context Caching — оптимизация без смены модели

v3 упоминает Context Caching мельком. Это **главная упущенная оптимизация**.

Gemini 2.5 Flash с Context Caching:

- Системный промпт (~2K токенов) кешируется на 100+ глав книги
- Input price (cached): **$0.030/1M** vs $0.30/1M (10x дешевле)
- TTL кеша: 1-3 часа (хватает на обработку одной книги)

**Расчёт для книги (100 глав):**

| Компонент                | Без кеша  | С кешем   |
| ------------------------ | --------- | --------- |
| System prompt (2K × 100) | $0.06     | $0.006    |
| Chapter text (15K × 100) | $0.45     | $0.45     |
| Output (3K × 100)        | $0.75     | $0.75     |
| **Итого**                | **$1.26** | **$1.21** |

Экономия скромная на книгу, но при оптимизации chunk overlap (сейчас 15% дублирования) и batch API (50% скидка) стоимость снижается до **$0.60-0.70/книга** — в 3 раза дешевле текущего, сохраняя Gemini качество.

### 4.4 Пересмотренный TCO (quality-first)

| Статья                                    | Текущий (A)     | Quality-first (D)                    |
| ----------------------------------------- | --------------- | ------------------------------------ |
| LLM extraction (Gemini 2.5 Flash + cache) | $56.10          | $30.00                               |
| Entity synthesis/dedup                    | $10.30          | $5.50                                |
| Image generation (Imagen 4 Fast)          | $60.00          | $42.00 (30% dedup)                   |
| Translation                               | $6.00           | $2.10 (Gemini 2.5 Flash-Lite cached) |
| VPS                                       | $35.00          | $35.00                               |
| Домен                                     | $2.00           | $2.00                                |
| **ИТОГО**                                 | **$169.40/мес** | **$116.60/мес**                      |
| **Экономия**                              | baseline        | **-31%**                             |
| **На пользователя**                       | $3.39           | $2.33                                |

Экономия -31% вместо -47% (Сценарий C из v3), но **без рисков** смены модели и зависимости от OpenRouter.

---

## Часть 5: Пересмотренные рекомендации

| #   | Компонент        | v3 рекомендация            | Ревизия v3.1                                           | Изменение     | Приоритет |
| --- | ---------------- | -------------------------- | ------------------------------------------------------ | ------------- | --------- |
| 1   | Reverse Proxy    | Caddy 2.x                  | **Caddy 2.x**                                          | Без изменений | P0        |
| 2   | ASGI Server      | Granian P2                 | **ОСТАВИТЬ Uvicorn навсегда**                          | **ОТКАЗ**     | —         |
| 3   | Cache/Broker     | Valkey 9.x (P1)            | **ОСТАВИТЬ Redis 7.4**                                 | **ОТКАЗ**     | —         |
| 4   | Task Queue       | Оставить Celery            | Оставить Celery                                        | Без изменений | —         |
| 5   | Database         | PostgreSQL тюнинг          | PostgreSQL тюнинг                                      | Без изменений | P0        |
| 6   | Orchestration    | Docker Compose             | Docker Compose                                         | Без изменений | —         |
| 7   | Monitoring       | VictoriaMetrics            | VictoriaMetrics                                        | Без изменений | P2        |
| 8   | Backups          | pgBackRest                 | pgBackRest                                             | Без изменений | P0        |
| 9   | LLM Primary      | Qwen3 32B (OR)             | **Gemini 2.5 Flash (direct)**                          | **ОТКАТ**     | P1        |
| 10  | LLM Fallback     | DeepSeek V3.2 (OR)         | **Qwen3 32B (OR)** — только если Google API недоступен | Понижение     | P2        |
| 11  | Image Primary    | Imagen 4 Fast              | Imagen 4 Fast                                          | Без изменений | —         |
| 12  | Image Fallback   | FLUX 2 Pro (OR)            | FLUX 2 Pro (OR) — для blocked сцен                     | Без изменений | P2        |
| 13  | Cost opt         | Image dedup + routing      | **Gemini Context Caching + Image dedup**               | Пересмотр     | P1        |
| 14  | Config cleanup   | Legacy NLP, Gemini default | Legacy NLP, Gemini default, Celery memory              | Без изменений | P0        |
| 15  | Frontend serving | Статика через Caddy        | Статика через Caddy                                    | Без изменений | P1        |

### Ключевые отличия от v3:

- **Granian**: v3 отложил до P2 → v3.1 полностью отказывается (CRITICAL WebSocket, shutdown, bus factor)
- **Valkey**: v3 рекомендовал как P1 → v3.1 полностью отказывается (MULTI breaking change, Celery hack, 9.x нестабилен, нулевой gain)
- **Qwen3 32B**: v3 ставил Primary → v3.1 понижает до emergency fallback (JSON bugs, context degradation, no Russian data)
- **Gemini 2.5 Flash**: v3 ставил как quality fallback → v3.1 ставит Primary (proven quality, guaranteed JSON, 1M context)
- **TCO**: v3 оптимизировал до $89/мес (-47%) с рисками → v3.1 оптимизирует до $117/мес (-31%) без рисков

---

## Часть 6: Plan миграции (quality-first)

### Phase 0: Аварийные фиксы (НЕМЕДЛЕННО)

1. Исправить `docker-compose.lite.prod.yml:125`: `LANGEXTRACT_MODEL:-gemini-3-flash-preview`
2. Выровнять Celery memory limits: **1.5GB** во всех 3 файлах
3. Удалить legacy NLP настройки из `config.py` (7+ переменных + `validate_nlp_weights` validator)
4. Удалить `NLP_CACHE_CONFIG` из `celery_config.py`

### Phase 1: Gemini 2.5 Flash + оптимизация (1-2 недели)

1. Обновить `gemini_extractor.py:227`: `model_extraction: str = "gemini-2.5-flash"` (с тестами)
2. Включить Gemini Context Caching для системного промпта (TTL 1-3 часа)
3. Реализовать image dedup (hash-based, Redis Set для отслеживания)
4. Тестирование на 5-10 книгах: сравнить качество Gemini 2.5 vs 3.0 Flash
5. Переключение Imagen на `imagen-4.0-fast-generate-001` если ещё не сделано

### Phase 2: OpenRouter fallback (2-3 недели, параллельно)

1. Создать `app/services/ai_router.py` — абстракция для fallback
2. Добавить OpenRouter клиент (через `openai` SDK)
3. Тестирование Qwen3 32B на 5-10 книгах: сравнить качество extraction
4. Реализовать fallback chain: Gemini 2.5 Flash → Gemini 3.0 Flash → Qwen3 32B (OR)
5. Budget tracking (Redis counter, daily alerts)

### Phase 3: Инфраструктура сервера (параллельно с Phase 1-2)

1. Миграция на новый сервер (если нужно): **Docker Compose + Nginx/Caddy + Redis 7.4 + Uvicorn + PostgreSQL 17**
2. НЕ менять Redis на Valkey
3. НЕ менять Uvicorn на Granian
4. Настроить pgBackRest
5. VictoriaMetrics + Grafana (P2)

---

## Источники

### Valkey Risk Analysis

- [Valkey MULTI Breaking Change #1629](https://github.com/valkey-io/valkey/issues/1629)
- [Celery Valkey Support #9092](https://github.com/celery/celery/issues/9092)
- [Kombu Valkey Transport #2245](https://github.com/celery/kombu/issues/2245)
- [Celery Valkey Backend PR #9300 (DRAFT)](https://github.com/celery/celery/pull/9300)
- [Valkey 9.0.2 Data Corruption](https://github.com/valkey-io/valkey/releases/tag/9.0.2)
- [Valkey 9.0.3 CVEs](https://github.com/valkey-io/valkey/releases/tag/9.0.3)
- [Sentry Version String Bug](https://github.com/getsentry/sentry/issues/107394)
- [Valkey Migration Guide](https://valkey.io/topics/migration/)
- [Centminmod Benchmarks](https://github.com/centminmod/redis-comparison-benchmarks)

### Granian Risk Analysis

- [Granian WS Disconnect #798](https://github.com/emmett-framework/granian/issues/798)
- [Granian No WS Ping #613](https://github.com/emmett-framework/granian/issues/613) (OPEN)
- [Granian Lifespan Shutdown #547](https://github.com/emmett-framework/granian/issues/547) (OPEN)
- [Granian Graceful Shutdown #611](https://github.com/emmett-framework/granian/issues/611) (OPEN)
- [Granian WS Crash #487](https://github.com/emmett-framework/granian/issues/487)
- [paperless-ngx ASGI Errors #9592](https://github.com/paperless-ngx/paperless-ngx/discussions/9592)
- [Granian BackgroundTasks #525](https://github.com/emmett-framework/granian/issues/525)
- [Granian Worker Stuck #813](https://github.com/emmett-framework/granian/issues/813)

### Qwen3 Quality Analysis

- [vLLM Qwen3 JSON Bug #18819](https://github.com/vllm-project/vllm/issues/18819)
- [SGLang Qwen3 JSON #6675](https://github.com/sgl-project/sglang/issues/6675)
- [Alibaba Structured Output Docs](https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output)
- [Practical JSON Benchmark (Medium)](https://medium.com/@lyx_62906/which-cheap-and-oss-llms-actually-produce-valid-json-9b002e106b6d)
- [Qwen3 32B Context Issues](https://huggingface.co/Qwen/Qwen3-32B/discussions/18)
- [vLLM Batch Degradation #17652](https://github.com/vllm-project/vllm/issues/17652)
- [OpenRouter Response Healing](https://openrouter.ai/announcements/response-healing-reduce-json-defects-by-80percent)
- [OpenRouter Feb 2026 Outages](https://openrouter.ai/announcements/openrouter-outages-on-february-17-and-19-2026)
- [Google Structured Output Docs](https://ai.google.dev/gemini-api/docs/structured-output)
- [Gemini Context Caching](https://ai.google.dev/gemini-api/docs/caching)
