<div align="center">

# fancai

**AI-ридер художественной литературы с интерактивной Entity Wiki и иллюстрациями**

[![Python 3.12](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://python.org)
[![FastAPI 0.135](https://img.shields.io/badge/FastAPI-0.135-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![PostgreSQL 17](https://img.shields.io/badge/PostgreSQL-17-336791?logo=postgresql&logoColor=white)](https://postgresql.org)
[![Redis 7.4](https://img.shields.io/badge/Redis-7.4-DC382D?logo=redis&logoColor=white)](https://redis.io)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript 5.7](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Vite 8](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

[Production](https://fancai.ru) · [Documentation](docs/README.md) · [Roadmap](.planning/ROADMAP.md) · [Report Bug](https://github.com/sandk0/fancai/issues)

**English** · [Русский](README-ru.md)

</div>

---

## Что это

fancai — веб-приложение для чтения художественной литературы (EPUB/FB2) с **двумя AI-функциями**:

1. **🧬 Entity Wiki — главная фича.** AI собирает интерактивный глоссарий
   персонажей, локаций и объектов прямо из текста книги. Защита от спойлеров:
   карточки сущностей показывают только то, что уже встречалось в прочитанных
   главах. Кликаешь на имя в тексте — видишь карточку без раскрытия будущего сюжета.

2. **🎨 AI-иллюстрации.** Параллельно с чтением AI находит описания сцен и
   генерирует к ним иллюстрации одним кликом.

Под капотом — mobile-first PWA с offline-чтением, follow-finger свайпами и
полноценной поддержкой iOS Safari/PWA. Production: <https://fancai.ru>.

---

## Технологический стек

### Frontend (`frontend/`)

- **React 19** + **TypeScript 5.7** + **Vite 8**
- **Tailwind CSS 4** + Radix UI primitives + Vaul (bottom sheets)
- **TanStack Query 5** для серверного состояния, **Zustand 5** для клиентского
- **epub.js 0.3.93** для рендеринга EPUB через CFI
- **Dexie 4** (IndexedDB) для offline-кэша глав
- **Vitest 4** + **Playwright 1.58** для тестов
- **i18next** (русский + английский, 1000+ ключей)

### Backend (`backend/`)

- **Python 3.12** + **FastAPI 0.135.1** (Pydantic v2, type hints обязательны)
- **PostgreSQL 17** (с pgvector) + **SQLAlchemy 2** (`lazy="raise"` везде)
- **Redis 7.4** + **Celery 5.6** для фоновых задач
- **Alembic** миграции, **uv** как пакет-менеджер
- **tenacity** + **circuitbreaker** для resilience внешних API
- **pytest 9** + **hypothesis** (property-based тесты для spoiler-фильтрации)

### AI-сервисы

| Назначение | Production route |
| --- | --- |
| Extraction / synthesis | Gemini Direct через Vertex AI global, `gemini-3.5-flash` |
| Consistency reduce | legacy direct OpenRouter call |
| Image generation | Gemini Direct через Vertex AI, `gemini-3.1-flash-image` |
| Modal batch / images | выключено feature flags |

Provider migration пока неполная: `AI_PROVIDER=gemini` управляет factory-based text
операциями, но consistency reduce и image generator имеют прямые client paths.
Фактическая схема, fallback semantics и known gaps —
[`docs/architecture/ai-pipeline.md`](docs/architecture/ai-pipeline.md).

### Production-инфраструктура

- **Caddy 2.11** (reverse proxy, auto-HTTPS, HTTP/3)
- **Docker Compose** (dev + prod + monitoring профили)
- **pgvector/pgvector:0.8.2-pg17** (БД)
- **Netdata + VictoriaMetrics + Uptime Kuma + Dozzle** для мониторинга
- **Hawk** для error tracking

---

## Быстрый старт

### Требования

- [Docker](https://docs.docker.com/get-docker/) с Compose v2 (`docker compose`, через пробел)
- [Node.js 20+](https://nodejs.org/) (для Vite 8)
- [uv](https://docs.astral.sh/uv/) для backend (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- Для AI: [Gemini API key](https://ai.google.dev/gemini-api/docs/api-key) в developer mode и OpenRouter key для текущего consistency reduce

### Запуск разработки

```bash
git clone https://github.com/sandk0/fancai.git
cd fancai

# 1. Конфигурация
cp .env.production.example .env.development
# Откройте .env.development и заполните минимум:
#   - AI_PROVIDER=gemini
#   - GEMINI_BACKEND=developer
#   - GEMINI_API_KEY=<Google AI Developer API key>
#   - OPENROUTER_API_KEY=<нужен текущему consistency reduce>
#   - DB_PASSWORD=<любой пароль>
#   - REDIS_PASSWORD=<любой пароль>
#   - SECRET_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(64))")

# 2. Инфраструктура (Postgres + Redis + Caddy)
docker compose -f docker-compose.dev.yml up -d

# 3. Backend (отдельный терминал)
cd backend
uv sync                              # манифест — pyproject.toml + uv.lock
uv run alembic upgrade head
uv run uvicorn app.main:app --reload

# 4. Frontend (отдельный терминал)
cd frontend
npm install
npm run dev
```

Открой <http://localhost:5173>. Backend API на <http://localhost:8000>,
Swagger UI на <http://localhost:8000/docs>.

### Production

См. [`docs/deployment/`](docs/deployment/) для подробных production-процедур.
Краткая команда деплоя — `/deploy` skill в Claude Code (привязан к VPS).

---

## Архитектура (high-level)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Browser (PWA, mobile-first)                  │
│  React 19 + TypeScript  │  epub.js (CFI)  │  TanStack Query +   │
│  Tailwind 4 + Radix     │  iframe reader  │  IndexedDB (Dexie)  │
└──────────────────────────────┬──────────────────────────────────┘
                               │ REST + WebSocket
┌──────────────────────────────┴──────────────────────────────────┐
│                       Caddy 2.11 (TLS, HTTP/3)                  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────────┐
│                  FastAPI 0.135 (Python 3.12)                    │
│  Auth (JWT)  │  Books CRUD  │  Reading sessions  │  Entity API  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Celery 5.6 workers: book_tasks, image_tasks              │  │
│  │  ↓                                                        │  │
│  │  Gemini Direct/Vertex + legacy OpenRouter reduce path       │  │
│  └───────────────────────────────────────────────────────────┘  │
└──────┬─────────────────────────────────────────┬────────────────┘
       │                                         │
┌──────┴──────────────┐               ┌──────────┴───────────┐
│  PostgreSQL 17      │               │  Redis 7.4           │
│  + pgvector         │               │  cache / pubsub /    │
│  (books, entities,  │               │  Celery broker /     │
│   chapters, notes)  │               │  JWT blacklist       │
└─────────────────────┘               └──────────────────────┘
```

Подробнее — [`docs/`](docs/README.md) (architecture, deployment, operations,
ci-cd, security).

---

## Структура репозитория

```
fancai/
├── backend/                 # FastAPI + Celery
│   ├── app/
│   │   ├── core/            # config, openrouter_client, retry, circuit breaker
│   │   ├── routers/         # 25 файлов, 97 routes + 1 websocket
│   │   ├── services/        # 28 сервисов (gemini_extractor, book_parser, entity_service)
│   │   ├── models/          # 18 SQLAlchemy моделей
│   │   ├── tasks/           # 10 Celery задач (book: 3h soft limit, image: 300s)
│   │   └── prompts/         # шаблоны для LLM
│   ├── alembic/versions/    # 54 миграции
│   └── tests/               # pytest, 76 test-файлов
├── frontend/                # React 19 + Vite 8
│   └── src/
│       ├── components/      # Reader/, Entities/, Library/, Settings/, UI/
│       ├── hooks/           # epub/ (31), api/ (12 TanStack Query), reader/, …
│       ├── services/        # IndexedDB caching (Dexie)
│       ├── stores/          # 3 Zustand stores (auth, reader, ui)
│       └── pages/           # routing
├── docs/                    # документация (см. docs/README.md)
├── .planning/               # Планирование (историч.): PROJECT.md, STATE.md, ROADMAP.md, MILESTONES.md
├── docker-compose.dev.yml   # локальная разработка
├── docker-compose.prod.yml  # production (Caddy + всё остальное)
└── docker-compose.monitoring.yml
```

---

## Команды разработки

```bash
# Backend
cd backend
uv run uvicorn app.main:app --reload    # dev сервер
uv run pytest -v                         # тесты
uv run ruff check .                      # lint
uv run mypy app/                         # type-check
uv run alembic revision --autogenerate -m "<msg>"
uv run alembic upgrade head

# Frontend
cd frontend
npm run dev                              # Vite dev server
npm test                                 # vitest
npm run test:e2e                         # Playwright
npm run lint                             # ESLint
npm run type-check                       # tsc --noEmit
npm run build                            # production build
```

Подробнее — [`docs/architecture/`](docs/architecture/) и [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## Roadmap и история

- **Текущее состояние:** [`.planning/STATE.md`](.planning/STATE.md)
- **Дорожная карта:** [`.planning/ROADMAP.md`](.planning/ROADMAP.md)
- **Milestones (v1.0 → v1.6):** [`.planning/MILESTONES.md`](.planning/MILESTONES.md)
- **Changelog:** [`CHANGELOG.md`](CHANGELOG.md)

Кратко: v1.0–v1.3 отгружены в production в марте 2026. v1.4 self-hosted NLP abandoned;
v1.5 Modal закрыт частично после неуспешного staging. v1.6 Gemini Direct + Vertex AI
отгружен 2026-06-16 вне формальных GSD-фаз. Сейчас feature-milestone не открыт:
приоритет — [Production Reliability Baseline](docs/superpowers/plans/2026-07-18-production-reliability-baseline.md)
(CI, dependencies, PWA precache, monitoring, provider routing, deploy/runbook).

Out of scope (явно не делаем): подписки/монетизация, социальные функции,
встроенный магазин книг, native mobile app, форматы помимо EPUB/FB2.
Полный список — в `.planning/PROJECT.md`.

---

## Contributing

См. [`CONTRIBUTING.md`](CONTRIBUTING.md) для процесса работы, конвенций
коммитов (conventional commits), стиля кода и PR-процесса.

## License

Apache License 2.0 — см. [`LICENSE`](LICENSE).

## Контакт

- **Issues / bugs:** <https://github.com/sandk0/fancai/issues>
- **Security:** см. [`docs/SECURITY.md`](docs/SECURITY.md)

---

_Последнее обновление: 2026-07-18. Сверено с production env/feature flags, `frontend/package.json`, `backend/pyproject.toml`, `docker-compose.prod.yml`, AI provider/task code, Alembic и test inventory._
