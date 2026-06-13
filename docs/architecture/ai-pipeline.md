# AI-пайплайн fancai (как есть, 2026-06-13)

Канонический ответ на вопрос «через что идёт AI». Источник истины — код `backend/app/`; ссылки `файл:строка` ниже.

## TL;DR

Весь AI-пайплайн идёт через **OpenRouter** (единственный активный провайдер):

- **LLM** (извлечение сущностей/описаний): `google/gemini-2.5-flash` (primary) → `google/gemini-2.5-flash-lite` (fallback)
- **Изображения**: `black-forest-labs/flux.2-klein-4b`
- **Единственный обязательный ключ**: `OPENROUTER_API_KEY`

| Параметр               | Значение                                        | Источник                          |
| ---------------------- | ----------------------------------------------- | --------------------------------- |
| LLM primary / fallback | gemini-2.5-flash / -flash-lite                  | `core/openrouter_client.py:58-59` |
| Image model            | flux.2-klein-4b                                 | `core/config.py:60`               |
| Клиент                 | `core/openrouter_client.py` (httpx.AsyncClient) | `:217-230`                        |
| Обязательный env       | `OPENROUTER_API_KEY`                            | `core/config.py:59`               |

## LLM-пайплайн (сущности и описания)

1. Книга загружается, парсится в главы (`services/book_parser.py`).
2. Глава режется на чанки (~100K символов, ~15% overlap для устойчивости на границах).
3. Чанк уходит в OpenRouter (`services/gemini_extractor.py` → `core/openrouter_client.py`),
   модель `gemini-2.5-flash`, при сбое — `-flash-lite`.
4. Из ответа извлекаются **сущности** (персонажи/локации/объекты), **описания** для
   генерации картинок и **связи** между сущностями.
5. Дедупликация (`services/entity_deduplication_service.py`) и синтез биографий
   (`services/entity_synthesis_service.py`) — тоже через OpenRouter.
6. Консистентность — `services/consistency_manager.py`.

Спойлер-безопасность: сущность хранит `first_mention_chapter`/`first_mention_cfi`
(`models/entity.py`) — UI показывает информацию только до текущей главы читателя.

## Image-пайплайн

`services/imagen_generator.py` (несмотря на имя — использует **OpenRouter**, не Google Imagen):
описание → при необходимости перевод RU→EN через OpenRouter `generate_text()` → генерация
`flux.2-klein-4b`. Celery-задача `generate_image_task` (очередь `normal`).

## Кэширование

`services/llm_cache_service.py` — литеральный кэш LLM-ответов в Redis. Это **не** Google
Prompt/Context Caching API (тот в коде не реализован, только в плане v2 от 2026-05-03).

## Отключённые / мёртвые пути (важно для документации)

| Что                                 | Статус                               | Где                            |
| ----------------------------------- | ------------------------------------ | ------------------------------ |
| Modal (self-hosted LLM)             | отключён, `USE_MODAL_PIPELINE=False` | `services/feature_flag.py:170` |
| Batch API                           | отключён, `USE_BATCH_MODE=False`     | `services/feature_flag.py:177` |
| `google-genai>=1.69.0`              | **мёртвый код** — 0 импортов в проде | `requirements.txt:30`          |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | **не используются**                  | —                              |
| Google context/batch caching        | не реализовано (только план)         | —                              |

> `google-genai` и переключатель `USE_MODAL_PIPELINE` — наследие двух незавершённых
> стратегических разворотов (self-hosted → Modal; OpenRouter → Gemini Direct, май 2026).
> Ни один не был доведён до прода: последняя миграция БД — 2026-03-28, схема Gemini-Direct
> не включала. Комментарии в `requirements.txt:22,29-30` («Gemini 3.0 Flash», «direct API»)
> вводят в заблуждение и подлежат правке как код (вне scope docs-задачи).

## Эволюция провайдера (контекст)

self-hosted LLM (отброшен, v1.4) → Modal batch (отброшен, медленно/ненадёжно, 2026-03) →
**OpenRouter optimization (текущий)** → Gemini Direct (оценён, отложен, май 2026).

---

_Последнее обновление: 2026-06-13. Сверено с: `backend/app/core/openrouter_client.py`, `core/config.py`, `services/feature_flag.py`, `services/gemini_extractor.py`, `services/imagen_generator.py`._
