# Обзор архитектуры fancai

Высокоуровневая карта системы. Источник истины — код; этот документ — навигатор по нему.

## Что это

Читалка художественной литературы (EPUB) с двумя AI-фичами:

1. **Интерактивный глоссарий сущностей** (главная фича) — AI строит спойлер-безопасную
   энциклопедию персонажей/локаций/объектов, раскрывая информацию по мере чтения.
2. **Генерация иллюстраций** — LLM извлекает визуальные описания, Gemini генерирует image.

## Стек

| Слой     | Технологии                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| Frontend | React 19 · TypeScript 5.7 · Vite 8 · Tailwind 4 · TanStack Query · Zustand · epub.js 0.3.93 · PWA (vite-plugin-pwa) |
| Backend  | FastAPI 0.135 · Python 3.12 · SQLAlchemy 2 · Pydantic 2 · Celery 5.6                                                |
| Данные   | PostgreSQL 17 (+pgvector 0.8.2) · Redis 7.4                                                                         |
| AI       | Gemini Direct / Vertex + legacy OpenRouter reduce (см. [`ai-pipeline.md`](ai-pipeline.md))                                      |
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
- **Celery**: логические очереди `heavy` (парсинг книги), `normal` (изображения), `light`
  (cleanup/beat). Production audit 2026-07-18: единственный worker подписан только на
  `normal`; `heavy`/`light` не имеют consumers, `light` накопил 7212 сообщений.
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

```text
upload EPUB → Celery process_book_task (heavy; intended flow, production consumer currently missing)
  → парсинг глав → чанкинг → Gemini 3.5 Flash / Vertex extraction
  → сущности + описания + связи (в БД)
  → consistency reduce через legacy direct OpenRouter route
  → прогресс в WebSocket (Redis PubSub)
  → [по запросу] generate_image_task (normal) → Gemini 3.1 Flash Image
```

## Качество

Inventory: **84** backend test files · **38** frontend unit files · **8** e2e specs.
Проверенный audit baseline и текущие failures — в [`.planning/STATE.md`](../../.planning/STATE.md).
GitHub Actions workflow существует, но repository Actions сейчас выключены; CI нельзя
считать действующим gate.

## Подписки

Модель `SubscriptionPlan` (FREE/PREMIUM/ULTIMATE) присутствует в схеме, но **монетизация
отложена** (`.planning/PROJECT.md`) — платёжная система не подключена.

---

_Последнее обновление: 2026-07-18. Сверено с production routing/feature flags, `backend/app/tasks/`, `services/`, `core/ai_provider*`, `frontend/src/` и test inventory._
