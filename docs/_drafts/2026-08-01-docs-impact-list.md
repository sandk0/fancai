# Документы, требующие правки после обновления стека — 2026-08-01

> **Это список, а не задача.** Правка документации явно выведена из scope аудита
> (§1.2 промпта). Здесь перечислено, что устареет, и чем именно.
> Архив `docs/_archive/**` намеренно исключён: он историчен по определению.

## 1. Устареет от обновления версий

| Документ | Строки | Что устареет |
| --- | --- | --- |
| `README.md` | 7-13 | бейджи: FastAPI 0.135, TypeScript 5.7, Vite 8 |
| `README.md` | 45-50 | «React 19 + TypeScript 5.7 + Vite 8», «Playwright 1.58» |
| `README.md` | 55-57 | «FastAPI 0.135.1», «Celery 5.6» |
| `README.md` | 91 | «Node.js 20+ (для Vite 8)» — после перехода на Node 24 |
| `README.md` | 151, 187 | ASCII-диаграмма: «FastAPI 0.135», «React 19 + Vite 8» |
| `README-ru.md` | 7-13, 46-52, 56-59, 92, 152, 188 | зеркало английского README |
| `CLAUDE.md` | 8 | «React 19 + TypeScript 5.7 + Vite 8 \| FastAPI 0.135 …» |
| `docs/architecture/overview.md` | 17-21 | таблица стека: TypeScript 5.7, Vite 8, epub.js 0.3.93, FastAPI 0.135, pgvector 0.8.2, Caddy 2.11 |
| `docs/deployment/README.md` | 17-23 | Caddy 2.11.1, FastAPI 0.135, Celery 5.6.2, pgvector 0.8.2, Redis 7.4.8, «React 19 / Vite 8» |
| `docs/ci-cd/README.md` | 38 | «Python 3.12, Node 22» — после смены Node в CI |
| `CONTRIBUTING.md` | 16-17 | «Node.js 20+ (Vite 8 требует Node 20.19+)», «Python 3.12» |

## 2. Устареет от смены AI-моделей

| Документ | Строки | Что устареет |
| --- | --- | --- |
| `README.md` | 66-68 | таблица маршрутов: `gemini-3.5-flash`, `gemini-3.1-flash-image` |
| `README.md` | 93 | «Gemini API key … и OpenRouter key для текущего consistency reduce» |
| `README-ru.md` | 67-69, 94 | зеркало |
| `docs/architecture/ai-pipeline.md` | 15-16 | `GEMINI_EXTRACTION_MODEL=gemini-3.5-flash` |
| `docs/architecture/ai-pipeline.md` | 103 | «`GeminiConfig` и production settings используют `gemini-3.5-flash`» |
| `docs/architecture/ai-pipeline.md` | 143-145 | production image model |
| `docs/architecture/ai-pipeline.md` | 159-166 | раздел «OpenRouter»: fallback chain `google/gemini-2.5-flash`, `-lite` |
| `docs/architecture/overview.md` | 59, 61 | «consistency reduce через legacy direct OpenRouter route», «Gemini 3.1 Flash Image» |
| `docs/deployment/README.md` | 27-29 | описание AI-маршрутов |
| `docs/research/gemini-api-consolidated.md` | §1.2, §16.1 | даты выключения 2.5-семейства (там 2026-06-17 / 2026-07-22, официально — 2026-10-16); «актуальная версия SDK 1.69.0» при факте 2.16.0 |

## 3. Фактически неверно **уже сейчас** — не следствие обновления

Эти места противоречат коду на 2026-08-01 независимо от того, будет ли обновление.
Строго говоря, это не «docs impact», а существующий дрейф; вынесено сюда, чтобы не потерять.

| Документ | Строки | Проблема |
| --- | --- | --- |
| `CLAUDE.md` | 9 | «AI: OpenRouter (LLM: google/gemini-2.5-flash primary …) \| OpenRouter (Images: black-forest-labs/flux.2-klein-4b)» — прод работает на Gemini/Vertex, а `flux.2-klein-4b` вообще нет в каталоге OpenRouter |
| `.claude/rules/ai-pipeline.md` | 20, 27-28 | «ALL AI calls through `core/openrouter_client.py` — NEVER call Google APIs directly» прямо противоречит `gemini_client.py`; модели указаны как `google/gemini-3-flash-preview` и `flux.2-klein-4b` |
| `.claude/rules/backend.md` | 16-25, 44, 47 | раздел «AI Pipeline (OpenRouter)»: «Images: FLUX.2 Klein via OpenRouter (not Imagen)», «Translation RU→EN via OpenRouter» |
| `.claude/rules/tests.md` | 20 | «Mock OpenRouter API calls» — актуальный путь Gemini |
| `.claude/rules/reader.md` | 20 | «epub.js 0.3.93 is stale (2019)» — фактически релиз **2022-02-16** |
| `CONTRIBUTING.md` | 19 | «API-ключ OpenRouter для тестирования AI-функций» — для основного пути нужен Gemini/Vertex |
| `docs/README.md` | 16 | описание `ai-pipeline.md` корректно, но ссылка на OpenRouter как основной — вводит в заблуждение |

## 4. Потребует переписывания, а не правки чисел

| Документ | Почему |
| --- | --- |
| `docs/architecture/ai-pipeline.md` | если Волна 6 меняет `FALLBACK_MODELS` и `AI_PROVIDER`-дефолт, раздел «Configuration contract» и обе mermaid-диаграммы описывают другую систему |
| `.claude/rules/ai-pipeline.md` и `.claude/rules/backend.md` | инварианты сформулированы вокруг OpenRouter-архитектуры, которой больше нет; нужен пересмотр, а не sed |
| `docs/research/gemini-api-consolidated.md` | документ от 2026-03-31 с ценами и датами, устаревшими на 4 месяца; кандидат на архивирование с заменой на `2026-08-01-llm-model-selection.md` |

## 5. Что править НЕ нужно

- `docs/_archive/**` — 177+ совпадений по версиям; каталог историчен.
- `CHANGELOG.md` — фиксирует прошлое; в него добавляется новая запись, старые не правятся.
- `.planning/**` — read-only по конвенции репозитория.
