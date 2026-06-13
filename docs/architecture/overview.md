# Обзор архитектуры fancai

Высокоуровневая карта системы. Источник истины — код; этот документ — навигатор по нему.

## Что это

Читалка художественной литературы (EPUB) с двумя AI-фичами:

1. **Интерактивный глоссарий сущностей** (главная фича) — AI строит спойлер-безопасную
   энциклопедию персонажей/локаций/объектов, раскрывая информацию по мере чтения.
2. **Генерация иллюстраций** — LLM извлекает визуальные описания, FLUX.2 рисует.

## Стек

| Слой     | Технологии                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| Frontend | React 19 · TypeScript 5.7 · Vite 8 · Tailwind 4 · TanStack Query · Zustand · epub.js 0.3.93 · PWA (vite-plugin-pwa) |
| Backend  | FastAPI 0.135 · Python 3.12 · SQLAlchemy 2 · Pydantic 2 · Celery 5.6                                                |
| Данные   | PostgreSQL 17 (+pgvector 0.8.2) · Redis 7.4                                                                         |
| AI       | OpenRouter (см. [`ai-pipeline.md`](ai-pipeline.md))                                                                 |
| Инфра    | Docker Compose · Caddy 2.11 · один VPS (см. [`../deployment/README.md`](../deployment/README.md))                   |

## Backend (карта)

- **Роутеры** `backend/app/routers/`: `auth`, `books/`, `chapters`, `descriptions`,
  `images`, `reading_sessions`, `reading_progress`, `sync` (PWA offline-очередь), `push`
  (web-push), `websocket` (прогресс), `health`, `admin/` (×10 подмодулей — REST API, **не**
  визуальная панель).
- **Модели** `backend/app/models/` (~18): User, Book, Chapter, Entity (+Mention/Relationship/
  Event), Description, Bookmark (объединяет закладки+highlights), GeneratedImage,
  ReadingSession/Progress/Goal, ChapterEmbedding (pgvector 384-dim), FeatureFlag, PushSubscription.
- **Сервисы** `backend/app/services/`: парсинг книг, извлечение/дедупликация/синтез сущностей,
  генерация изображений, кэш LLM, статистика, email, push.
- **Celery**: очереди `heavy` (парсинг книги), `normal` (изображения), `light` (cleanup/beat).
- **Real-time**: WebSocket `/ws/book-progress/{book_id}` через Redis PubSub (`core/pubsub.py`).
- **Auth**: JWT (HS256, header+cookie), Redis token-blacklist. CSRF-middleware присутствует, но
  отключён (Bearer-токены к CSRF не уязвимы).

## Frontend (карта)

- **Reader** `src/components/Reader/EpubReader.tsx` (~910 строк) декомпозирован в 25+ хуков
  `src/hooks/epub/` (рендеринг аннотаций, подсветка описаний/сущностей, навигация по CFI,
  жесты, iOS-фиксы).
- **Сущности** `src/components/Entities/`: `EntityDrawer` (полный профиль), `EntityBottomSheet`
  (превью), `SpoilerText` (спойлер-безопасность).
- **Сторы** Zustand: `auth`, `reader`, `ui`.
- **API**: axios `apiClient` + TanStack Query (`src/hooks/api/`). Прямой `fetch()` — только в
  Service Worker/PWA/offline.
- **PWA**: `src/sw.ts` (~877 строк, Workbox injectManifest), Dexie/IndexedDB кэш глав, offline.

## Поток обработки книги

```
upload EPUB → Celery process_book_task (heavy)
  → парсинг глав → чанкинг → OpenRouter LLM extraction
  → сущности + описания + связи (в БД)
  → прогресс в WebSocket (Redis PubSub)
  → [по запросу] generate_image_task (normal) → FLUX.2 via OpenRouter
```

## Качество

Тесты: **76** backend (pytest, cov ≥70%) · **38** frontend unit (vitest, cov ≥40%) · **8** e2e
(Playwright, `frontend/tests/`). CI — `.github/workflows/ci.yml` (8 джобов: lint/test/security/build).

## Подписки

Модель `SubscriptionPlan` (FREE/PREMIUM/ULTIMATE) присутствует в схеме, но **монетизация
отложена** (`.planning/PROJECT.md`) — платёжная система не подключена.

---

_Последнее обновление: 2026-06-13. Сверено с: `backend/app/routers/`, `models/`, `services/`, `frontend/src/`, `frontend/package.json`._
