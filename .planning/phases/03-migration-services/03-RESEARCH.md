# Phase 3: Миграция сервисов — Исследование

**Исследовано:** 2026-03-01 (обновлено: image models re-research)
**Домен:** OpenRouter API, Caddy, Redis Rate Limiting, Python httpx/openai SDK
**Доверие:** HIGH (основные факты проверены по официальным источникам)

<user_constraints>
## Ограничения пользователя (из CONTEXT.md)

### Зафиксированные решения

**OpenRouter клиент:**
- Единый клиент `openrouter_client.py` в `backend/app/core/` — все 5 AI-сервисов (4 LLM + 1 image) импортируют его
- Методы: `generate_text()` (для response_mime_type сервисов), `generate_structured()` (для response_schema сервисов), `generate_image()` (для генерации изображений)
- Встроенные retry, логирование, метрики, fallback chain — в одном месте
- google-genai SDK полностью удаляется из requirements.txt после миграции

**Structured output:**
- Claude's Discretion — выбрать оптимальный подход на этапе исследования (JSON Schema inlining vs JSON mode + prompt)
- Исследовать документацию OpenRouter на предмет поддержки structured output разными провайдерами
- Pydantic-модели (`GeminiResponseSchema`, `GeminiTSAResponseSchema`, `DeduplicationResponse`) должны продолжать работать — конвертация автоматическая

**Fallback chain:**
- Порядок: Gemini 3 Flash (основная) → Claude Haiku 4.5 (первый fallback) → Gemini 2.5 Flash Lite (последний fallback)
- Триггер переключения: ошибки API (5xx, timeout, rate limit) — не ошибки парсинга ответа
- Промпты одинаковые для всех моделей — не адаптировать под каждую модель
- Интеграция с существующим tenacity retry: fallback срабатывает после исчерпания retry для текущей модели
- Логировать каждое переключение fallback с указанием причины

**Caddy:**
- Заменить все nginx-конфиги (~881 строк суммарно) одним Caddyfile (~80 строк)
- Auto-HTTPS через Let's Encrypt (Caddy делает это из коробки)
- HTTP/3 включить (Caddy поддерживает по умолчанию)
- Сохранить ключевые nginx-фичи: reverse proxy к бэкенду, раздача статики фронтенда, WebSocket proxy, gzip
- Admin API Caddy не нужен (управление через Caddyfile)
- SSL-сертификаты: Caddy управляет автоматически, удалить ручные сертификаты из nginx/ssl/

**Rate limiting:**
- Использовать существующий `rate_limiter.py` на Redis — не добавлять slowapi как зависимость
- Расширить существующий декоратор `@rate_limit()` для поддержки per-user ID (сейчас по IP)
- Применить rate limiting к AI-эндпоинтам (извлечение описаний, генерация изображений, обработка книг)
- Claude's Discretion: конкретные лимиты, формат ответа при превышении

### Дискреция Claude
- Выбор между OpenAI SDK с base_url и прямыми HTTP-вызовами к OpenRouter (httpx)
- Стратегия structured output (JSON Schema inlining vs JSON mode)
- Конкретные rate limit значения для разных эндпоинтов
- Порядок миграции сервисов (от простых к сложным или все сразу)
- Обработка различий в форматах ответов между моделями в fallback chain
- Конфигурация Caddyfile (конкретные директивы, таймауты, размеры буферов)

### Отложенные идеи (НЕ в скоупе)
Нет — обсуждение проведено в рамках скоупа фазы
</user_constraints>

<phase_requirements>
## Требования фазы

| ID | Описание | Обеспечение исследованием |
|----|----------|--------------------------|
| MIGR-01 | Мигрировать entity_synthesis на OpenRouter API (только response_mime_type, низкая сложность) | openrouter_client.generate_text(), JSON mode через system prompt |
| MIGR-02 | Мигрировать consistency_manager на OpenRouter API (только response_mime_type, средняя сложность) | openrouter_client.generate_text(), та же стратегия |
| MIGR-03 | Мигрировать entity_dedup на OpenRouter API (response_schema с вложенными Optional полями, высокая сложность) | openrouter_client.generate_structured(), $defs inlining для Google моделей |
| MIGR-04 | Мигрировать gemini_extractor на OpenRouter API (response_schema с Pydantic, высокая сложность) | openrouter_client.generate_structured(), GeminiResponseSchema.model_json_schema() с inlining |
| MIGR-04.1 | Мигрировать imagen_generator с Imagen 4 на OpenRouter image-модели (FLUX.2 Pro/Klein) | openrouter_client.generate_image(), /chat/completions с modalities=["image"] — НЕ /images/generations |
| MIGR-05 | Реализовать fallback chain: Gemini 3 Flash → Claude Haiku 4.5 → Gemini 2.5 Flash Lite | Client-side fallback с tenacity, цикл по FALLBACK_MODELS списку |
| MIGR-06 | Заменить nginx на Caddy — Caddyfile ~80 строк | Caddy официальная документация, Docker образ caddy:2-alpine |
| MIGR-07 | Настроить auto-HTTPS в Caddy (Let's Encrypt + ZeroSSL) | Caddy auto-HTTPS из коробки, нужен порт 443 и DNS |
| MIGR-08 | Добавить rate limiting по user ID (расширение существующего rate_limiter.py) | Существующий RateLimiter класс, добавить user_id идентификатор |
</phase_requirements>

---

## Обзор

Фаза 3 — миграция всей AI-инфраструктуры на OpenRouter: 4 LLM-сервиса и 1 image-сервис переходят с google-genai SDK на единый HTTP-клиент. Параллельно — замена nginx (881 строка конфигов) на Caddy (~80 строк). Это устраняет vendor lock на Google и добавляет fallback chain для надёжности.

Ключевое техническое решение: использовать **httpx async** напрямую вместо OpenAI SDK. Причины: (1) httpx уже есть в requirements.txt; (2) полный контроль над request/response; (3) нет лишней зависимости; (4) OpenRouter API совместим с OpenAI формат, поэтому httpx + requests.post достаточно. OpenAI SDK подходит, но добавляет зависимость без реальных преимуществ для этого проекта.

Для structured output: единственный надёжный метод через OpenRouter — **JSON Schema inlining** (без `$defs`/`$ref`). Это подтверждено исследованием проблемы pydantic-ai: Google Gemini модели через OpenRouter не поддерживают `$defs` references корректно. Решение: `model.model_json_schema()` + рекурсивное inline разворачивание.

**КРИТИЧНО для image генерации:** OpenRouter image models используют **`/chat/completions` с параметром `modalities`** — НЕ `/images/generations`. Ответ приходит в `choices[0].message.images[0].image_url.url` как base64 data URL. Старые FLUX 1.1 модели (`flux-1.1-pro`, `flux-schnell`) недоступны; новые FLUX.2 (`flux.2-pro`, `flux.2-flex`, `flux.2-klein-4b`, `flux.2-max`) — доступны и подтверждены (проверено 2026-03-01).

**Основная рекомендация:** httpx async + JSON Schema inlining для structured output + client-side fallback chain через список моделей в цикле + FLUX.2 Klein 4B (`black-forest-labs/flux.2-klein-4b`) как основная image модель (самая быстрая/дешёвая в FLUX.2 семействе), FLUX.2 Pro как fallback для высокого качества.

---

## Стандартный стек

### Ядро

| Библиотека | Версия | Назначение | Почему стандартная |
|------------|--------|------------|-------------------|
| httpx | 0.28.1 (уже в проекте) | Async HTTP клиент для OpenRouter API | Уже в requirements.txt, async нативный, без лишних зависимостей |
| tenacity | 9.1.2 (уже в проекте) | Retry с exponential backoff | Уже используется во всех LLM-сервисах |
| pydantic v2 | 2.12.5 (уже в проекте) | JSON Schema генерация из моделей | model_json_schema() для structured output |
| caddy | 2-alpine (Docker) | Web сервер вместо nginx | Auto-HTTPS, HTTP/3, 80 строк вместо 881 |

### Поддерживающие

| Библиотека | Версия | Назначение | Когда использовать |
|------------|--------|------------|-------------------|
| openai SDK | — | OpenAI-compatible клиент | НЕ использовать — избыточно при наличии httpx |
| openrouter Python SDK | beta | Официальный SDK | НЕ использовать — нестабильный beta, httpx надёжнее |
| slowapi | — | FastAPI rate limiting | НЕ добавлять — существующий rate_limiter.py достаточен |

### Image модели на OpenRouter (проверено 2026-03-01)

| Model ID | Цена за изображение (1 MP) | Описание | Рекомендация |
|----------|---------------------------|----------|--------------|
| `black-forest-labs/flux.2-klein-4b` | $0.014 за первый MP, $0.001 за доп. | Самая быстрая/дешёвая в FLUX.2, < 1 секунды | **Основная — для fancai** |
| `black-forest-labs/flux.2-pro` | $0.03 за первый MP, $0.015 за доп. | Высокое качество, strong prompt adherence | Fallback / высокое качество |
| `black-forest-labs/flux.2-flex` | $0.06 за MP (input+output) | Лучший в рендеринге текста/типографики | Если нужны надписи на иллюстрации |
| `black-forest-labs/flux.2-max` | $0.07 за первый MP, $0.03 за доп. | Максимальное качество BFL | Для особых случаев |
| `google/gemini-2.5-flash-image-preview` | ~$0.30/M input tokens | Генерация + редактирование + multi-turn | Альтернатива через chat |
| `google/gemini-3.1-flash-image-preview` | $0.25/M input, $60/M image tokens | Новейший (фев 2026), Pro-качество | Альтернатива |
| `sourceful/riverflow-v2-fast` | $0.02 за 1K img, $0.04 за 2K | SOTA скорость, max 2K | Самая дешёвая опция |
| `sourceful/riverflow-v2-pro` | $0.15 за 1K/2K, $0.33 за 4K | Лучший контроль, text rendering | Если нужна 4K |

**Устаревшие/недоступные (НЕ использовать):**
- `black-forest-labs/flux-1.1-pro` — 404, старая версия
- `black-forest-labs/flux-pro-1.1` — 404, старая версия
- `black-forest-labs/flux-schnell` — 404, старая версия
- `fal/flux-pro` — 404, не интегрирован

### Альтернативы

| Вместо | Можно использовать | Компромисс |
|--------|--------------------|------------|
| httpx прямой | OpenAI SDK (openai==1.x) с base_url | OpenAI SDK проще в коде, но лишняя зависимость |
| JSON Schema inlining | JSON mode + system prompt | JSON mode проще, но нет гарантии структуры без schema |
| FLUX.2 Klein | FLUX.2 Pro | Выше качество, но дороже в 2x и медленнее |

**Установка (добавить в requirements.txt):**
```bash
# Ничего нового не нужно — httpx и tenacity уже есть
# Удалить: google-genai==1.61.0
```

---

## Архитектурные паттерны

### Структура файлов

```
backend/app/core/
├── openrouter_client.py      # НОВЫЙ: единый клиент для всех AI-вызовов
├── rate_limiter.py           # ИЗМЕНИТЬ: добавить per-user ID поддержку
└── retry.py                  # БЕЗ ИЗМЕНЕНИЙ: retry декораторы переиспользуются

backend/app/services/
├── entity_synthesis_service.py    # МИГРИРОВАТЬ: _call_gemini → openrouter_client
├── consistency_manager.py         # МИГРИРОВАТЬ: прямые genai вызовы
├── entity_deduplication_service.py # МИГРИРОВАТЬ: response_schema → JSON Schema
├── gemini_extractor.py            # МИГРИРОВАТЬ: _call_gemini_with_retry, _call_gemini_tsa
└── imagen_generator.py            # МИГРИРОВАТЬ: genai Imagen → OpenRouter images

Caddyfile                          # НОВЫЙ: в корне проекта (рядом с docker-compose)
caddy_data/                        # VOLUME: SSL сертификаты Caddy (управляет автоматически)
```

### Паттерн 1: Единый OpenRouter клиент

**Что:** Единый `openrouter_client.py` в `app/core/` с тремя методами для трёх типов вызовов.
**Когда использовать:** Все AI-сервисы импортируют только из этого модуля.

```python
# backend/app/core/openrouter_client.py
# Источник: OpenRouter API docs (https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
# + структурированные выводы (https://openrouter.ai/docs/guides/features/structured-outputs)

import base64
import json
import logging
from typing import Any, Optional, Type
import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# Fallback chain для LLM (в порядке приоритета)
FALLBACK_MODELS = [
    "google/gemini-3-flash-preview",      # основная — самая быстрая
    "anthropic/claude-haiku-4.5",          # первый fallback
    "google/gemini-2.5-flash-lite",        # последний fallback
]

# Image модели — FLUX.2 семейство (без fallback chain, одна модель)
# ВАЖНО: используется /chat/completions с modalities=["image"], НЕ /images/generations
DEFAULT_IMAGE_MODEL = "black-forest-labs/flux.2-klein-4b"  # быстрая/дешёвая


def _inline_defs(schema: dict) -> dict:
    """
    Рекурсивно разворачивает $defs/$ref в JSON Schema.

    Необходимо для Google Gemini через OpenRouter:
    Google модели через OpenRouter не поддерживают $defs/$ref —
    деградируют к строкам вместо объектов.
    Источник: https://github.com/pydantic/pydantic-ai/issues/3617
    """
    defs = schema.pop("$defs", {})

    def resolve(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                ref_name = node["$ref"].split("/")[-1]
                return resolve(dict(defs.get(ref_name, {})))
            return {k: resolve(v) for k, v in node.items()}
        elif isinstance(node, list):
            return [resolve(item) for item in node]
        return node

    return resolve(schema)


class OpenRouterClient:
    """
    Единый клиент для всех OpenRouter API вызовов.

    Использует httpx.AsyncClient напрямую (без OpenAI SDK).
    Реализует client-side fallback chain для LLM.
    Image generation использует /chat/completions с modalities.
    """

    def __init__(self, api_key: str, timeout: int = 120):
        self.api_key = api_key
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=OPENROUTER_BASE_URL,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://fancai.ru",
                    "X-Title": "fancai",
                },
                timeout=self.timeout,
            )
        return self._client

    async def generate_text(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.3,
        model: Optional[str] = None,
    ) -> str:
        """
        Простая генерация текста (JSON mode через system prompt).

        Для: entity_synthesis_service, consistency_manager
        (заменяет response_mime_type="application/json")
        """
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        models = [model] if model else FALLBACK_MODELS

        for i, current_model in enumerate(models):
            try:
                body = {
                    "model": current_model,
                    "messages": messages,
                    "temperature": temperature,
                    "response_format": {"type": "json_object"},
                }

                resp = await self._get_client().post("/chat/completions", json=body)
                resp.raise_for_status()
                data = resp.json()
                content = data["choices"][0]["message"]["content"]

                if i > 0:
                    logger.warning(
                        f"[OpenRouter] Fallback успешен: модель {current_model} "
                        f"(попытка {i+1})"
                    )

                return content

            except Exception as e:
                is_last = (i == len(models) - 1)
                logger.warning(
                    f"[OpenRouter] Модель {current_model} недоступна: {e}. "
                    f"{'Завершено.' if is_last else f'Fallback → {models[i+1]}'}"
                )
                if is_last:
                    raise

        raise RuntimeError("Все модели в fallback chain недоступны")

    async def generate_structured(
        self,
        prompt: str,
        schema_class: Type[BaseModel],
        system_prompt: Optional[str] = None,
        temperature: float = 0.1,
        model: Optional[str] = None,
    ) -> dict:
        """
        Генерация со структурированным выводом (JSON Schema).

        Для: gemini_extractor (_call_gemini_with_retry, _call_gemini_tsa),
             entity_deduplication (_call_gemini)

        $defs инлайнинг: обязателен для Google моделей через OpenRouter.
        Источник: github.com/pydantic/pydantic-ai/issues/3617
        """
        raw_schema = schema_class.model_json_schema()
        inlined_schema = _inline_defs(raw_schema)

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        models = [model] if model else FALLBACK_MODELS

        for i, current_model in enumerate(models):
            try:
                body = {
                    "model": current_model,
                    "messages": messages,
                    "temperature": temperature,
                    "response_format": {
                        "type": "json_schema",
                        "json_schema": {
                            "name": schema_class.__name__,
                            "strict": True,
                            "schema": inlined_schema,
                        },
                    },
                }

                resp = await self._get_client().post("/chat/completions", json=body)
                resp.raise_for_status()
                data = resp.json()
                content = data["choices"][0]["message"]["content"]

                if i > 0:
                    logger.warning(
                        f"[OpenRouter] Fallback успешен: модель {current_model}"
                    )

                return json.loads(content)

            except Exception as e:
                is_last = (i == len(models) - 1)
                logger.warning(
                    f"[OpenRouter] Модель {current_model} ошибка при structured: {e}. "
                    f"{'Завершено.' if is_last else f'Fallback → {models[i+1]}'}"
                )
                if is_last:
                    raise

        raise RuntimeError("Все модели в fallback chain недоступны")

    async def generate_image(
        self,
        prompt: str,
        model: str = DEFAULT_IMAGE_MODEL,
        aspect_ratio: str = "4:3",   # landscape — хорошо для иллюстраций книг
        image_size: str = "1K",       # "1K" | "2K" | "4K" | "0.5K"
    ) -> bytes:
        """
        Генерация изображений через OpenRouter.

        Для: imagen_generator (заменяет Google Imagen 4)

        ВАЖНО: Использует /chat/completions с modalities=["image"],
        НЕ /images/generations endpoint!

        Ответ: choices[0].message.images[0].image_url.url (base64 data URL)
        Источник: openrouter.ai/docs/guides/overview/multimodal/image-generation
        """
        body = {
            "model": model,
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "modalities": ["image"],   # image-only; для FLUX.2 моделей нет text output
            "image_config": {
                "aspect_ratio": aspect_ratio,
                "image_size": image_size,
            },
        }

        resp = await self._get_client().post("/chat/completions", json=body)
        resp.raise_for_status()
        data = resp.json()

        # Ответ: choices[0].message.images[0].image_url.url
        # Формат: "data:image/png;base64,iVBORw0KGgo..."
        images = data["choices"][0]["message"].get("images", [])
        if not images:
            raise RuntimeError(f"OpenRouter image model {model} вернул пустой images список")

        data_url: str = images[0]["image_url"]["url"]
        # Убрать префикс "data:image/png;base64,"
        _, b64_data = data_url.split(",", 1)
        return base64.b64decode(b64_data)

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()


# Singleton — создаётся при первом импорте через settings
_client: Optional[OpenRouterClient] = None


def get_openrouter_client() -> OpenRouterClient:
    global _client
    if _client is None:
        from app.core.config import settings
        _client = OpenRouterClient(
            api_key=settings.OPENROUTER_API_KEY,
        )
    return _client
```

### Паттерн 2: Миграция LLM-сервиса (response_mime_type тип)

**Что:** entity_synthesis, consistency_manager — только JSON text output, нет schema.
**Когда использовать:** Самый простой случай — замена прямого genai вызова.

```python
# Было (entity_synthesis_service.py):
import google.genai.types as types
client = extractor._client
response = await client.aio.models.generate_content(
    model=model,
    contents=prompt,
    config=types.GenerateContentConfig(response_mime_type="application/json"),
)
raw = parse_json_safe(response.text)

# Стало:
from app.core.openrouter_client import get_openrouter_client
client = get_openrouter_client()
raw_text = await client.generate_text(
    prompt=prompt,
    system_prompt="Respond ONLY with valid JSON, no markdown.",
    temperature=0.3,
)
raw = parse_json_safe(raw_text)
```

### Паттерн 3: Миграция с response_schema (Pydantic)

**Что:** gemini_extractor, entity_dedup — structured output с Pydantic моделями.
**Когда использовать:** Когда нужна гарантированная структура ответа.

```python
# Было (gemini_extractor.py _call_gemini_with_retry):
config = self._types.GenerateContentConfig(
    response_schema=GeminiResponseSchema,
    response_mime_type="application/json",
)
response = await asyncio.to_thread(
    self._client.models.generate_content, ...
)
return GeminiResponseSchema.model_validate(response.parsed)

# Стало:
from app.core.openrouter_client import get_openrouter_client
client = get_openrouter_client()
raw_dict = await client.generate_structured(
    prompt=prompt,
    schema_class=GeminiResponseSchema,
    temperature=0.3,
)
return GeminiResponseSchema.model_validate(raw_dict)
```

### Паттерн 4: Миграция imagen_generator

**Что:** imagen_generator.py — замена Google Imagen 4 на OpenRouter FLUX.2.
**КРИТИЧНО:** API endpoint изменился — НЕ `/images/generations`, а `/chat/completions` с `modalities`.

```python
# Было (imagen_generator.py):
from google import genai
from google.genai import types as genai_types

client = genai.Client(api_key=settings.GOOGLE_API_KEY)
response = client.models.generate_images(
    model="imagen-4.0-generate-preview-06-06",
    prompt=en_prompt,
    config=genai_types.GenerateImagesConfig(
        number_of_images=1,
        aspect_ratio="4:3",
    ),
)
image_bytes = response.generated_images[0].image.image_bytes

# Стало:
from app.core.openrouter_client import get_openrouter_client

async def generate_image(self, prompt: str) -> bytes:
    # Перевести промпт RU→EN остаётся через OpenRouter LLM
    en_prompt = await self._translate_prompt(prompt)

    client = get_openrouter_client()
    image_bytes = await client.generate_image(
        prompt=en_prompt,
        model="black-forest-labs/flux.2-klein-4b",  # быстрая/дешёвая
        aspect_ratio="4:3",   # landscape для иллюстраций книг
        image_size="1K",      # достаточно для thumbnails
    )
    return image_bytes
```

### Паттерн 5: Caddyfile для fancai

**Что:** Заменяет 881 строку nginx конфигов одним Caddyfile ~80 строк.
**Когда использовать:** Production (docker-compose.lite.prod.yml).

```caddyfile
# Caddyfile — production конфигурация fancai
# Источник: caddyserver.com/docs/caddyfile/patterns

fancai.ru {
    # Auto-HTTPS через Let's Encrypt — автоматически

    # Статика фронтенда (React SPA)
    handle /* {
        root * /var/www/frontend

        # SPA роутинг — все 404 отдают index.html
        try_files {path} /index.html

        file_server
    }

    # API бэкенда
    handle /api/* {
        reverse_proxy backend:8000 {
            # WebSocket поддержка (автоматически через Caddy)
            header_up X-Real-IP {remote_host}
            header_up X-Forwarded-For {remote_host}

            transport http {
                dial_timeout 5s
                response_header_timeout 120s
            }
        }
    }

    # WebSocket для realtime (если нужно)
    handle /ws/* {
        reverse_proxy backend:8000
    }

    # Storage (изображения, файлы)
    handle /storage/* {
        root * /var/www
        file_server
    }

    # Сжатие (zstd + gzip)
    encode zstd gzip

    # Security headers
    header {
        X-Frame-Options SAMEORIGIN
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
    }

    # Размер запроса для upload EPUB (50MB)
    request_body {
        max_size 50MB
    }
}

# HTTP → HTTPS редирект (Caddy делает автоматически при настройке TLS)
www.fancai.ru {
    redir https://fancai.ru{uri} permanent
}
```

### Паттерн 6: Docker Compose для Caddy

**Что:** Замена nginx-сервиса в docker-compose.lite.prod.yml.

```yaml
# Заменить nginx-сервис на:
caddy:
  image: caddy:2-alpine
  container_name: fancai_caddy
  ports:
    - "80:80"
    - "443:443"
    - "443:443/udp"   # HTTP/3 (QUIC)
  volumes:
    - ./Caddyfile:/etc/caddy/Caddyfile:ro
    - caddy_data:/data           # SSL сертификаты (Caddy управляет)
    - caddy_config:/config       # Caddy конфигурационный кеш
    - ./backend/storage:/var/www/storage:ro
    - frontend_build:/var/www/frontend:ro  # или путь к build
  depends_on:
    backend:
      condition: service_healthy
  networks:
    - bookreader_network
  restart: unless-stopped
  deploy:
    resources:
      limits:
        cpus: '0.5'
        memory: 128M

volumes:
  caddy_data:    # КРИТИЧНО: persistence для SSL сертификатов
  caddy_config:
```

### Паттерн 7: Per-user Rate Limiting (расширение существующего)

**Что:** Расширить существующий `RateLimiter` в `rate_limiter.py` для per-user ID.

```python
# backend/app/middleware/rate_limit.py — расширение @rate_limit декоратора

def rate_limit(
    max_requests: int,
    window_seconds: int,
    key_func: Optional[Callable] = None,  # НОВОЕ: кастомная функция ключа
):
    """
    Декоратор rate limiting.

    По умолчанию — по user_id (из JWT). Fallback — по IP.
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            request: Request = kwargs.get("request") or next(
                (a for a in args if isinstance(a, Request)), None
            )

            # Определяем идентификатор
            if key_func:
                identifier = await key_func(request)
            else:
                # Per-user: берём user_id из JWT если есть
                user_id = getattr(request.state, "user_id", None)
                identifier = f"user:{user_id}" if user_id else f"ip:{request.client.host}"

            is_limited, info = await rate_limiter.is_rate_limited(
                identifier=identifier,
                endpoint=str(request.url.path),
                max_requests=max_requests,
                window_seconds=window_seconds,
            )

            if is_limited:
                raise HTTPException(
                    status_code=429,
                    detail={
                        "error": "rate_limit_exceeded",
                        "message": "Слишком много запросов. Повторите позже.",
                        "retry_after": info.get("reset_in_seconds", 60),
                    },
                    headers={"Retry-After": str(info.get("reset_in_seconds", 60))},
                )

            return await func(*args, **kwargs)
        return wrapper
    return decorator
```

### Антипаттерны

- **Использовать OpenAI SDK** вместо httpx — добавляет зависимость без преимуществ для этого проекта.
- **Передавать Pydantic модель напрямую** в `response_format` — нужно сначала вызвать `model_json_schema()` и сделать `_inline_defs()`.
- **Игнорировать UDP порт 443** в docker-compose — HTTP/3 требует UDP для QUIC.
- **Не монтировать caddy_data volume** — Caddy потеряет SSL сертификаты при рестарте контейнера.
- **Использовать `strict: True`** с Claude Haiku для сложных схем с `anyOf` — не все модели поддерживают строгий режим; проверить и иметь fallback на `strict: False`.
- **Пробрасывать ошибки парсинга** как fallback триггеры — только HTTP ошибки (4xx, 5xx, timeout) должны запускать fallback.
- **Вызывать `/images/generations`** для FLUX.2 моделей — OpenRouter image models используют `/chat/completions` с `modalities=["image"]`.
- **Читать `data[0].b64_json`** из ответа — правильный путь: `choices[0].message.images[0].image_url.url` (data URL).
- **Использовать старые FLUX 1.x IDs** (`flux-1.1-pro`, `flux-schnell`) — эти модели недоступны. Только FLUX.2 (с точкой: `flux.2-pro`, не дефисом: `flux-2-pro`).

---

## Не изобретать велосипед

| Проблема | Не строить | Использовать вместо | Почему |
|----------|-----------|---------------------|--------|
| JSON Schema из Pydantic | Кастомный конвертер | `model.model_json_schema()` + `_inline_defs()` | Pydantic v2 встроено |
| Rate limiting | Новый алгоритм | Существующий `RateLimiter` в rate_limiter.py | Уже есть Redis sliding window |
| Retry логика | Кастомный retry | Существующий `retry_llm_extraction` из retry.py | Уже настроен с jitter |
| SSL сертификаты | Ручное обновление | Caddy auto-HTTPS | Caddy делает это сам через Let's Encrypt |
| Nginx conf для SPA | Кастомные location блоки | `try_files {path} /index.html` в Caddy | Встроенная поддержка |
| Мониторинг LLM вызовов | Новые метрики | Существующие `record_llm_request`, `record_llm_error` | Уже в monitoring/metrics.py |

**Ключевой принцип:** Все retry, кэширование и метрики уже реализованы. `openrouter_client.py` — тонкий HTTP-слой поверх них.

---

## Типичные ловушки

### Ловушка 1: $defs/$ref в JSON Schema через Google Gemini

**Что происходит:** Google Gemini через OpenRouter возвращает строки вместо объектов при использовании `$ref` в JSON Schema.
**Почему:** OpenRouter не транслирует `$defs`/`$ref` для Google моделей — они попадают "как есть" и Gemini их игнорирует.
**Как избежать:** Всегда вызывать `_inline_defs()` перед передачей схемы в API. Pydantic v2 генерирует `$defs` для вложенных моделей — обязательно разворачивать.
**Признаки:** Поле типа `List[GeminiEntitySchema]` приходит как `List[str]`.
**Источник:** [pydantic-ai issue #3617](https://github.com/pydantic/pydantic-ai/issues/3617)

### Ловушка 2: strict: True несовместим с некоторыми схемами

**Что происходит:** Claude Haiku и Gemini 2.5 Flash Lite отклоняют запросы с `strict: True` если в схеме есть `anyOf` или сложные типы.
**Почему:** Разные модели по-разному реализуют JSON Schema strict mode.
**Как избежать:** Попробовать сначала без `strict: True`. Если есть `Optional` поля — упростить схему или убрать strict.
**Признаки:** HTTP 400 или 422 от API при fallback на Claude.

### Ловушка 3: Caddy теряет SSL сертификаты при рестарте

**Что происходит:** При рестарте Caddy-контейнера начинается процесс повторного получения Let's Encrypt сертификата.
**Почему:** Сертификаты хранятся в `/data` внутри контейнера — без volume они теряются.
**Как избежать:** Обязательно монтировать `caddy_data:/data` как named volume (не bind mount).
**Признаки:** HTTPS не работает после `docker compose restart`.

### Ловушка 4: HTTP/3 требует UDP порт 443

**Что происходит:** HTTP/3 не работает даже если Caddy запущен.
**Почему:** HTTP/3 использует QUIC — UDP протокол. Стандартный `443:443` открывает только TCP.
**Как избежать:** В docker-compose указывать `443:443/udp` отдельно от `443:443`.
**Признаки:** curl с `--http3` падает, обычный HTTPS работает.

### Ловушка 5: Fallback срабатывает на ошибки парсинга JSON

**Что происходит:** Если LLM вернул невалидный JSON, система переключается на следующую модель и тратит время.
**Почему:** Ошибка `json.JSONDecodeError` выглядит как обычный Exception.
**Как избежать:** В fallback loop ловить только HTTP-ошибки (httpx.HTTPStatusError, httpx.TimeoutException). JSON ошибки — пробрасывать вверх, логировать и обрабатывать отдельно.
**Признаки:** Постоянные попытки всех моделей при одном и том же плохом промпте.

### Ловушка 6: asyncio.to_thread больше не нужен

**Что происходит:** Старый код использует `asyncio.to_thread` для google-genai (синхронный SDK). После миграции на httpx это не нужно.
**Почему:** httpx.AsyncClient полностью async — никакого thread pool не требуется.
**Как избежать:** Убрать все `asyncio.to_thread` обёртки при миграции каждого сервиса.
**Признаки:** Предупреждение о thread pool exhaustion в логах.

### Ловушка 7: Image API — неверный endpoint и формат ответа

**Что происходит:** Код вызывает `/images/generations` и читает `data[0].b64_json` — получает 404 или пустой ответ.
**Почему:** OpenRouter image models (FLUX.2, Gemini image, Riverflow) используют `/chat/completions` с `modalities` параметром. Это принципиально отличается от OpenAI `/images/generations`. Старый код написанный под предположение "OpenAI-совместимый images endpoint" — не работает.
**Как избежать:**
1. Использовать `/chat/completions` (НЕ `/images/generations`)
2. Добавить `"modalities": ["image"]` в тело запроса
3. Читать ответ из `choices[0].message.images[0].image_url.url`
4. Парсить base64 data URL: `url.split(",", 1)[1]` затем `base64.b64decode()`
**Признаки:** HTTP 404 или ответ без поля `data`.

### Ловушка 8: Старые FLUX 1.x model IDs (с дефисом vs с точкой)

**Что происходит:** Код использует `black-forest-labs/flux-1.1-pro` или `flux-schnell` — получает 404.
**Почему:** Старые FLUX 1.1 модели убраны с OpenRouter. Новые FLUX.2 модели имеют другой формат ID: точка в имени (`flux.2-pro`, `flux.2-klein-4b`), не дефис.
**Как избежать:** Использовать только FLUX.2 model IDs: `black-forest-labs/flux.2-pro`, `black-forest-labs/flux.2-klein-4b`, `black-forest-labs/flux.2-flex`, `black-forest-labs/flux.2-max`.
**Признаки:** HTTP 404 с сообщением "model not available".

---

## Примеры кода

Проверенные паттерны из официальных источников:

### OpenRouter Chat Completions (базовый запрос)

```python
# Источник: openrouter.ai/docs/guides/features/structured-outputs
import httpx

async with httpx.AsyncClient() as client:
    response = await client.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://fancai.ru",
        },
        json={
            "model": "google/gemini-3-flash-preview",
            "messages": [
                {"role": "user", "content": "Привет!"}
            ],
            "temperature": 0.3,
        },
    )
    data = response.json()
    text = data["choices"][0]["message"]["content"]
```

### OpenRouter Structured Output (JSON Schema)

```python
# Источник: openrouter.ai/docs/guides/features/structured-outputs
# + pydantic-ai issue #3617 (inlining requirement)

from pydantic import BaseModel
from typing import List, Optional

class Entity(BaseModel):
    name: str
    type: str
    importance: int

class ExtractResult(BaseModel):
    entities: List[Entity]
    summary: Optional[str] = None

# Шаг 1: Сгенерировать schema и inline $defs
schema = ExtractResult.model_json_schema()
inlined = _inline_defs(schema)  # см. реализацию выше

# Шаг 2: Запрос с JSON Schema
response = await client.post(
    "https://openrouter.ai/api/v1/chat/completions",
    headers={"Authorization": f"Bearer {api_key}"},
    json={
        "model": "google/gemini-3-flash-preview",
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "ExtractResult",
                "strict": True,
                "schema": inlined,
            },
        },
    },
)
result_dict = json.loads(response.json()["choices"][0]["message"]["content"])
result = ExtractResult.model_validate(result_dict)
```

### OpenRouter Image Generation (ПРАВИЛЬНЫЙ формат — обновлено 2026-03-01)

```python
# Источник: openrouter.ai/docs/guides/overview/multimodal/image-generation
# ВАЖНО: /chat/completions с modalities, НЕ /images/generations!

import base64
import httpx

async with httpx.AsyncClient() as client:
    response = await client.post(
        "https://openrouter.ai/api/v1/chat/completions",  # НЕ /images/generations
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://fancai.ru",
        },
        json={
            "model": "black-forest-labs/flux.2-klein-4b",  # быстрая/дешёвая FLUX.2
            "messages": [
                {"role": "user", "content": "A young woman reading a book in a magical forest"}
            ],
            "modalities": ["image"],   # ОБЯЗАТЕЛЕН для image generation
            "image_config": {
                "aspect_ratio": "4:3",   # для иллюстраций книг
                "image_size": "1K",      # "1K" | "2K" | "4K" | "0.5K"
            },
        },
        timeout=60.0,  # image generation медленнее чем LLM
    )
    data = response.json()

    # Ответ: choices[0].message.images (НЕ data[0].b64_json!)
    images = data["choices"][0]["message"]["images"]
    data_url = images[0]["image_url"]["url"]  # "data:image/png;base64,iVBOR..."

    # Декодировать base64
    _, b64_data = data_url.split(",", 1)
    image_bytes = base64.b64decode(b64_data)
```

### Проверенные ID моделей на OpenRouter (2026-03-01)

```python
# Источник: openrouter.ai/black-forest-labs/flux.2-pro (проверено 2026-03-01)
#           openrouter.ai/black-forest-labs/flux.2-klein-4b
#           openrouter.ai/black-forest-labs/flux.2-flex
#           openrouter.ai/black-forest-labs/flux.2-max

# LLM модели — доступны
LLM_MODELS = {
    "primary": "google/gemini-3-flash-preview",   # $0.50/$3.00 per M tokens
    "fallback_1": "anthropic/claude-haiku-4.5",    # $1.00/$5.00 per M tokens
    "fallback_2": "google/gemini-2.5-flash-lite",  # $0.10/$0.40 per M tokens
}

# Image модели — FLUX.2 семейство (все доступны на 2026-03-01)
IMAGE_MODELS = {
    # Рекомендуется для fancai: быстрая (<1 сек), дешёвая
    "default": "black-forest-labs/flux.2-klein-4b",  # $0.014/MP первый
    # Высокое качество для особых случаев
    "quality": "black-forest-labs/flux.2-pro",        # $0.03/MP первый
    # Если нужен текст/типографика на иллюстрации
    "text_render": "black-forest-labs/flux.2-flex",   # $0.06/MP
    # Максимальное качество (самый дорогой)
    "max_quality": "black-forest-labs/flux.2-max",    # $0.07/MP первый
}

# НЕДОСТУПНЫ (вернут 404):
UNAVAILABLE = [
    "black-forest-labs/flux-1.1-pro",   # старая версия
    "black-forest-labs/flux-pro-1.1",   # старая версия
    "black-forest-labs/flux-schnell",   # старая версия
    "fal/flux-pro",                     # не интегрирован
]
```

### Caddy: production конфиг с таймаутами

```caddyfile
# Источник: caddyserver.com/docs/caddyfile/directives/reverse_proxy
{
    # Глобальные настройки
    email admin@fancai.ru  # для Let's Encrypt
}

fancai.ru {
    encode zstd gzip

    # API backend
    handle /api/* {
        reverse_proxy backend:8000 {
            header_up X-Real-IP {remote_host}
            transport http {
                dial_timeout 5s
                response_header_timeout 120s  # AI запросы могут быть долгими
                read_timeout 130s
            }
        }
    }

    # Frontend SPA
    handle {
        root * /var/www/frontend
        try_files {path} /index.html
        file_server
    }

    # Upload limit для EPUB
    @uploads {
        path /api/v1/books/upload
    }
    request_body @uploads {
        max_size 50MB
    }
}
```

---

## Актуальное состояние технологий

| Старый подход | Текущий подход | Изменён | Влияние |
|---------------|----------------|---------|---------|
| google-genai SDK (синхронный + asyncio.to_thread) | httpx async напрямую | Phase 3 (сейчас) | Убирает thread pool overhead |
| Nginx 881 строк конфигов | Caddy ~80 строк Caddyfile | Phase 3 (сейчас) | Авто-HTTPS, HTTP/3, простота |
| Google Imagen 4 для изображений | OpenRouter FLUX.2 Klein 4B (основная) | Phase 3 (сейчас) | Единый API, дешевле, быстрее |
| Per-IP rate limiting | Per-user ID rate limiting | Phase 3 (сейчас) | Точнее для авторизованных пользователей |
| response_schema=PydanticModel (Gemini native) | response_format JSON Schema (OpenRouter) | Phase 3 (сейчас) | Требует $defs inlining |
| FLUX 1.1 (flux-1.1-pro, flux-schnell) | FLUX.2 (flux.2-pro, flux.2-klein-4b) | Нояб-Янв 2025-26 | Старые IDs недоступны, точка вместо дефиса |
| `/images/generations` endpoint | `/chat/completions` + `modalities` | OpenRouter image support | Другой путь ответа, другой формат |

**Устаревшее:**
- `google-genai==1.61.0`: удаляется полностью после миграции всех 5 сервисов
- `GOOGLE_API_KEY`: заменяется на `OPENROUTER_API_KEY`
- `nginx/nginx.prod.conf`, `nginx/nginx.prod.conf.template`, `frontend/nginx.conf`, `frontend/nginx.prod.conf`: всё заменяется одним `Caddyfile`
- `flux-1.1-pro`, `flux-schnell`: недоступны, заменяются на `flux.2-klein-4b` / `flux.2-pro`

---

## Открытые вопросы

1. **strict: True совместимость с Haiku и Gemini Lite**
   - Что мы знаем: OpenRouter поддерживает `strict: True` для OpenAI и Google. Для Claude — неясно.
   - Что неясно: Поддерживает ли claude-haiku-4.5 strict JSON Schema через OpenRouter?
   - Рекомендация: В коде иметь fallback `strict: False` для claude-haiku модели. Тест в Wave 0.

2. **Caddy frontend контейнер vs отдельный volume**
   - Что мы знаем: Текущий фронтенд — отдельный Docker контейнер с nginx. После миграции nginx убирается.
   - Что неясно: Как передавать build артефакты фронтенда в Caddy контейнер? Shared volume или multi-stage build?
   - Рекомендация: Shared named volume `frontend_build` — frontend контейнер пишет в него, Caddy читает. Или убрать frontend-контейнер полностью (Caddy сам раздаёт статику).

3. **image_config поддержка конкретными FLUX.2 моделями**
   - Что мы знаем: `image_config` с `aspect_ratio` и `image_size` задокументированы в OpenRouter image generation docs.
   - Что неясно: Все ли FLUX.2 модели поддерживают одинаковый набор aspect_ratio? Документация показывает список, но не указывает per-model ограничения.
   - Рекомендация: Использовать стандартные соотношения (4:3, 16:9, 1:1), избегать экзотических. Протестировать в Wave 0 с flux.2-klein-4b.

---

## Архитектура валидации

### Тестовый фреймворк

| Свойство | Значение |
|---------|---------|
| Фреймворк | pytest 9.0.2 + pytest-asyncio 1.3.0 |
| Конфиг | backend/pytest.ini |
| Быстрый запуск | `cd backend && pytest tests/services/test_openrouter_client.py -x -v` |
| Полный запуск | `cd backend && pytest -v --cov=app --cov-fail-under=70` |

### Требования → тесты

| ID | Поведение | Тип теста | Команда | Файл существует? |
|----|----------|-----------|---------|-----------------|
| MIGR-01 | entity_synthesis вызывает OpenRouter вместо genai | unit | `pytest tests/services/test_entity_synthesis.py -x` | ❌ Wave 0 |
| MIGR-02 | consistency_manager вызывает OpenRouter вместо genai | unit | `pytest tests/services/test_consistency_manager.py -x` | ❌ Wave 0 |
| MIGR-03 | entity_dedup получает DeduplicationResponse через OpenRouter | unit | `pytest tests/services/test_entity_deduplication.py -x` | ✅ (нужно обновить) |
| MIGR-04 | gemini_extractor возвращает GeminiResponseSchema через OpenRouter | unit | `pytest tests/services/test_gemini_extractor.py -x` | ✅ (нужно обновить) |
| MIGR-04.1 | imagen_generator генерирует изображение через OpenRouter (/chat/completions) | unit | `pytest tests/services/test_imagen_generator.py -x` | ✅ (шаблон, нужно обновить endpoint mock) |
| MIGR-05 | При ошибке основной модели — fallback на следующую | unit | `pytest tests/core/test_openrouter_client.py::test_fallback -x` | ❌ Wave 0 |
| MIGR-06 | Caddy обслуживает запросы (smoke) | smoke/manual | `curl -I https://fancai.ru` | manual |
| MIGR-07 | HTTPS работает, сертификат действителен | smoke/manual | `curl -v https://fancai.ru 2>&1 \| grep SSL` | manual |
| MIGR-08 | Rate limit срабатывает для user_id после N запросов | unit | `pytest tests/middleware/test_rate_limit.py -x` | ❌ Wave 0 |

### Частота проверок

- **После каждого коммита:** `cd backend && pytest tests/core/test_openrouter_client.py tests/services/test_gemini_extractor.py -x -v`
- **После каждой волны:** `cd backend && pytest -v --cov=app --cov-fail-under=70`
- **Гейт фазы:** Полный тестовый набор зелёный перед `/gsd:verify-work`

### Пробелы Wave 0

- [ ] `backend/tests/core/test_openrouter_client.py` — покрывает MIGR-05 (fallback chain), generate_text, generate_structured, generate_image, _inline_defs
- [ ] `backend/tests/services/test_entity_synthesis.py` — покрывает MIGR-01 (заменить google-genai mock на httpx mock)
- [ ] `backend/tests/services/test_consistency_manager.py` — покрывает MIGR-02
- [ ] `backend/tests/middleware/test_rate_limit.py` — покрывает MIGR-08 (per-user ID rate limiting)
- [ ] Обновить `backend/tests/services/test_entity_deduplication.py` — заменить genai mock на httpx mock для MIGR-03
- [ ] Обновить `backend/tests/services/test_gemini_extractor.py` — аналогично для MIGR-04
- [ ] Обновить `backend/tests/services/test_imagen_generator.py` — изменить mock с `/images/generations` + `data[0].b64_json` на `/chat/completions` + `choices[0].message.images[0].image_url.url`

---

## Источники

### Первичные (HIGH доверие)

- [openrouter.ai/docs/guides/features/structured-outputs](https://openrouter.ai/docs/guides/features/structured-outputs) — JSON Schema формат, Python пример
- [openrouter.ai/docs/guides/overview/multimodal/image-generation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation) — image generation endpoint (/chat/completions), modalities, image_config, response format
- [openrouter.ai/black-forest-labs/flux.2-pro](https://openrouter.ai/black-forest-labs/flux.2-pro) — подтверждена доступность FLUX.2 Pro, pricing $0.03/MP
- [openrouter.ai/black-forest-labs/flux.2-klein-4b](https://openrouter.ai/black-forest-labs/flux.2-klein-4b) — подтверждена доступность FLUX.2 Klein 4B, pricing $0.014/MP, релиз Jan 2026
- [openrouter.ai/black-forest-labs/flux.2-flex](https://openrouter.ai/black-forest-labs/flux.2-flex) — подтверждена доступность FLUX.2 Flex, релиз Nov 2025
- [openrouter.ai/black-forest-labs/flux.2-max](https://openrouter.ai/black-forest-labs/flux.2-max) — подтверждена доступность FLUX.2 Max, pricing $0.07/MP, релиз Dec 2025
- [openrouter.ai/google/gemini-3.1-flash-image-preview](https://openrouter.ai/google/gemini-3.1-flash-image-preview) — Gemini image модель (фев 2026)
- [openrouter.ai/anthropic/claude-haiku-4.5](https://openrouter.ai/anthropic/claude-haiku-4.5) — подтверждена доступность и model ID
- [openrouter.ai/google/gemini-2.5-flash](https://openrouter.ai/google/gemini-2.5-flash) — подтверждена доступность и model ID
- [openrouter.ai/google/gemini-3-flash-preview](https://openrouter.ai/google/gemini-3-flash-preview) — подтверждена доступность и model ID
- [openrouter.ai/google/gemini-2.5-flash-lite](https://openrouter.ai/google/gemini-2.5-flash-lite) — подтверждена доступность и model ID
- [caddyserver.com/docs/caddyfile/directives/reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) — конфигурация, таймауты, WebSocket
- [caddyserver.com/docs/caddyfile/directives/encode](https://caddyserver.com/docs/caddyfile/directives/encode) — gzip/zstd
- [caddyserver.com/docs/caddyfile/patterns](https://caddyserver.com/docs/caddyfile/patterns) — SPA, reverse proxy паттерны

### Вторичные (MEDIUM доверие)

- [github.com/pydantic/pydantic-ai/issues/3617](https://github.com/pydantic/pydantic-ai/issues/3617) — подтверждена проблема $defs/Google Gemini через OpenRouter, fix через prefer_inlined_defs
- [github.com/OpenRouterTeam/python-sdk](https://github.com/OpenRouterTeam/python-sdk) — официальный Python SDK (beta, использовать httpx вместо него)
- [openrouter.ai/announcements/the-first-ever-image-model-is-up-on-openrouter](https://openrouter.ai/announcements/the-first-ever-image-model-is-up-on-openrouter) — Gemini 2.5 Flash Image как первая image модель на OpenRouter
- [x.com/OpenRouterAI/status/1993362991535079554](https://x.com/OpenRouterAI/status/1993362991535079554) — официальный анонс FLUX.2 [pro] и [flex] на OpenRouter

### Проверенная недоступность (HIGH доверие — 404 подтверждён)

- `black-forest-labs/flux-1.1-pro` — 404 "model not available" (проверено 2026-03-01)
- `black-forest-labs/flux-pro-v1.1-ultra` — 404 "model not available" (проверено 2026-03-01)
- `black-forest-labs/flux-2-pro` (с дефисом) — 404 "model not available" — правильный ID через точку: `flux.2-pro`
- `fal/flux-pro` — 404 "model not available" (проверено 2026-03-01)

---

## Метаданные

**Оценка доверия:**
- Стандартный стек (LLM): HIGH — model IDs, API format проверены на официальном сайте
- Архитектура: HIGH — Caddy и httpx шаблоны из официальной документации
- Structured output ($defs): HIGH — подтверждена проблема и fix из GitHub issue pydantic-ai
- Image модели: HIGH — FLUX.2 модели доступны, endpoint и response format проверены по официальной документации (обновлено 2026-03-01)

**Дата исследования:** 2026-03-01 (image models re-research)
**Действительно до:** 2026-03-30 (LLM модели: 7 дней при активном развитии OpenRouter)
