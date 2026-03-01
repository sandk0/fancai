# Phase 3: Миграция сервисов - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Мигрировать все 5 AI-сервисов с Google Gemini SDK (`google-genai`) на OpenRouter API: 4 LLM-сервиса с fallback chain (Gemini 3 Flash → Claude Haiku 4.5 → Gemini 2.5 Flash Lite) и генерацию изображений с Imagen 4 на OpenRouter image-модели (FLUX.2 Pro/Klein и др.). Заменить nginx на Caddy с auto-HTTPS и HTTP/3. Полностью удалить зависимость google-genai. Добавить per-user rate limiting через FastAPI slowapi.

</domain>

<decisions>
## Implementation Decisions

### OpenRouter клиент
- Единый клиент `openrouter_client.py` в `backend/app/core/` — все 5 AI-сервисов (4 LLM + 1 image) импортируют его
- Методы: `generate_text()` (для response_mime_type сервисов), `generate_structured()` (для response_schema сервисов), `generate_image()` (для генерации изображений)
- Встроенные retry, логирование, метрики, fallback chain — в одном месте
- google-genai SDK полностью удаляется из requirements.txt после миграции

### Structured output
- Claude's Discretion — выбрать оптимальный подход на этапе исследования (JSON Schema inlining vs JSON mode + prompt)
- Исследовать документацию OpenRouter на предмет поддержки structured output разными провайдерами
- Pydantic-модели (`GeminiResponseSchema`, `GeminiTSAResponseSchema`, `DeduplicationResponse`) должны продолжать работать — конвертация автоматическая

### Fallback chain
- Порядок: Gemini 3 Flash (основная) → Claude Haiku 4.5 (первый fallback) → Gemini 2.5 Flash Lite (последний fallback)
- Триггер переключения: ошибки API (5xx, timeout, rate limit) — не ошибки парсинга ответа
- Промпты одинаковые для всех моделей — не адаптировать под каждую модель (упрощает поддержку)
- Интеграция с существующим tenacity retry: fallback срабатывает после исчерпания retry для текущей модели
- Логировать каждое переключение fallback с указанием причины

### Caddy
- Заменить все nginx-конфиги (~530 строк) одним Caddyfile (~80 строк)
- Auto-HTTPS через Let's Encrypt (Caddy делает это из коробки)
- HTTP/3 включить (Caddy поддерживает по умолчанию)
- Сохранить ключевые nginx-фичи: reverse proxy к бэкенду, раздача статики фронтенда, WebSocket proxy, gzip
- Admin API Caddy не нужен (управление через Caddyfile)
- SSL-сертификаты: Caddy управляет автоматически, удалить ручные сертификаты из nginx/ssl/

### Rate limiting
- Использовать существующий `rate_limiter.py` на Redis — не добавлять slowapi как зависимость
- Расширить существующий декоратор `@rate_limit()` для поддержки per-user ID (сейчас по IP)
- Применить rate limiting к AI-эндпоинтам (извлечение описаний, генерация изображений, обработка книг)
- Claude's Discretion: конкретные лимиты, формат ответа при превышении

### Claude's Discretion
- Выбор между OpenAI SDK с base_url и прямыми HTTP-вызовами к OpenRouter
- Стратегия structured output (JSON Schema inlining vs JSON mode)
- Конкретные rate limit значения для разных эндпоинтов
- Порядок миграции сервисов (от простых к сложным или все сразу)
- Обработка различий в форматах ответов между моделями в fallback chain
- Конфигурация Caddyfile (конкретные директивы, таймауты, размеры буферов)

</decisions>

<specifics>
## Specific Ideas

- Imagen 4 заменяется на OpenRouter image-модели (FLUX.2 Pro/Klein и др.) — единый API для всех AI-сервисов
- Существующие промпты на русском языке — они должны работать одинаково через OpenRouter
- Перевод RU→EN для image prompts сохраняется (сейчас через Gemini, после миграции через OpenRouter LLM)
- Rate limiter уже работает на Redis — лучше расширить его, чем добавлять новую зависимость (slowapi)
- После миграции google-genai SDK и GOOGLE_API_KEY больше не нужны — полное удаление vendor lock

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `backend/app/core/retry.py` — tenacity-декораторы `retry_llm_extraction`, `retry_api_call`, `retry_image_generation` — переиспользовать для OpenRouter
- `backend/app/core/rate_limiter.py` + `backend/app/middleware/rate_limit.py` — Redis-based rate limiting, уже применяется декоратором `@rate_limit()`
- `backend/app/monitoring/metrics.py` — метрики `record_llm_request`, `record_llm_error`, `record_llm_rate_limit` — переиспользовать
- `backend/app/core/cache.py` — `CacheManager` для кеширования ответов LLM
- `backend/app/services/llm_cache_service.py` — кеш результатов LLM по главам

### Established Patterns
- Все LLM-вызовы обёрнуты в tenacity retry с экспоненциальной задержкой
- Pydantic v2 модели для structured output (`GeminiResponseSchema`, `GeminiTSAResponseSchema`, `DeduplicationResponse`)
- Ответы Gemini API могут быть обёрнуты в `data` — нужно учитывать разницу с OpenRouter
- Два типа LLM-вызовов: `response_mime_type="application/json"` (entity_synthesis, consistency_manager) и `response_schema=PydanticModel` (gemini_extractor, entity_dedup)

### Integration Points
- 4 сервиса для миграции:
  - `entity_synthesis_service.py` — `response_mime_type` только, низкая сложность
  - `consistency_manager.py` — `response_mime_type` только, средняя сложность
  - `entity_deduplication_service.py` — `response_schema` с вложенными Optional полями, высокая сложность
  - `gemini_extractor.py` — `response_schema` с Pydantic, высокая сложность
- `imagen_generator.py` — мигрировать с Imagen 4 (google-genai SDK) на OpenRouter image-модели (FLUX.2 Pro/Klein), высокая сложность — другой API (не chat)
- nginx конфиги: `nginx/nginx.prod.conf` (283 строки), `nginx/nginx.prod.conf.template` (245 строк), `frontend/nginx.conf`, `frontend/nginx.prod.conf`
- Docker Compose файлы: nginx-сервис нужно заменить на Caddy-сервис

</code_context>

<deferred>
## Deferred Ideas

None — обсуждение проведено в рамках скоупа фазы

</deferred>

---

*Phase: 03-migration-services*
*Context gathered: 2026-03-01*
