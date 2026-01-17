# CLAUDE.md

Guidance for Claude Code when working with fancai repository.

## Project Overview

**fancai** - Web application for reading fiction with AI-generated images from book descriptions.

**Core Value:** LLM-powered extraction of visual descriptions + AI image generation.

## Technology Stack

### Frontend (`frontend/`)
- React 19 + TypeScript 5.7, Vite 6
- epub.js 0.3.93 (CFI navigation)
- TanStack Query 5.90 + Zustand 5
- Tailwind CSS 3.4 + shadcn/ui

### Backend (`backend/`)
- FastAPI 0.125 + Python 3.11
- PostgreSQL 15 + Redis 7.4
- Celery 5.4 + SQLAlchemy 2.0

### AI Services
- **Extraction:** Google Gemini 3.0 Flash (~$0.02/book)
- **Generation:** Google Imagen 4 ($0.04/image)

## Key Directories

```
frontend/src/
├── components/Reader/   # EPUB reader (15 files)
├── hooks/epub/          # EPUB hooks (22 files)
├── hooks/api/           # TanStack Query hooks
└── services/            # IndexedDB caching

backend/app/
├── services/            # Business logic (17+ services)
├── routers/             # API endpoints
└── models/              # SQLAlchemy models
```

## Development Commands

```bash
# Frontend
cd frontend && npm run dev      # Development
cd frontend && npm test         # Tests
cd frontend && npm run build    # Build

# Backend
cd backend && pytest -v         # Tests
cd backend && alembic upgrade head  # Migrations

# Docker
docker-compose up -d            # Start all
docker-compose logs -f backend  # View logs
```

## API Quick Reference

```
POST /api/v1/auth/login          # JWT auth
GET  /api/v1/books               # List books
POST /api/v1/books/upload        # Upload EPUB/FB2
GET  /api/v1/chapters/{id}       # Chapter content
GET  /api/v1/descriptions/{chapter_id}  # Descriptions
POST /api/v1/images/generate/{description_id}  # Generate image
```

## Environment Variables

```bash
DATABASE_URL=postgresql://user:pass@localhost/bookreader
REDIS_URL=redis://localhost:6379
SECRET_KEY=change-in-production
GOOGLE_API_KEY=...    # For Gemini + Imagen
```

## Code Conventions

### Commits
```
<type>(<scope>): <subject>
Types: feat, fix, docs, style, refactor, test, chore
```

### TypeScript
- Functional components with hooks
- TanStack Query for all API calls
- CFI for EPUB position tracking

### Python
- Type hints required
- Pydantic for validation
- tenacity for retries

## Key Files

### Backend Services
| File | Purpose |
|------|---------|
| `app/services/book_parser.py` | EPUB/FB2 parsing |
| `app/services/gemini_extractor.py` | Gemini API extraction |
| `app/services/imagen_generator.py` | Image generation |
| `app/core/retry.py` | Exponential backoff |

### Frontend
| File | Purpose |
|------|---------|
| `src/components/Reader/EpubReader.tsx` | Main reader |
| `src/hooks/epub/useDescriptionHighlighting.ts` | 9 search strategies |
| `src/services/chapterCache.ts` | IndexedDB cache |

## Theme System

**CSS Variables:** `frontend/src/styles/globals.css`
**Themes:** Light, Dark, Sepia, System
**Hooks:** `useTheme()`, `useEpubThemes()`

## iOS Mobile Fixes

- `touch-action: pan-x pan-y` - disable pinch-zoom
- `overscroll-behavior: none` - disable bounce
- Safari gesture event prevention
- Safe-area support for notch devices

## Production

- **URL:** https://fancai.ru
- **Deploy:** `docker-compose.lite.yml`
- **Uptime target:** >99%

## Superpowers Auto-Routing

При обработке задач автоматически вызывай соответствующие superpowers skills:

### Триггеры на русском языке

| Слова в промпте | Skill | Условие |
|-----------------|-------|---------|
| "баг", "ошибка", "не работает", "сломалось" | `/systematic-debugging` | Всегда |
| "добавить функцию", "реализовать", "создать" | `/brainstorm` | Новая функциональность |
| "план", "спецификация", "требования" | `/writing-plans` | Есть требования |
| "проанализировать", "исследовать", "аудит" | `/research-and-analysis` | Нужен отчёт |
| "рефакторинг", "оптимизация" | `/brainstorm` | Значительные изменения |
| "перед коммитом", "готово к PR" | `/verification-before-completion` | Всегда |

### Триггеры на английском языке

| Words in prompt | Skill | Condition |
|-----------------|-------|-----------|
| "bug", "error", "broken", "failing" | `/systematic-debugging` | Always |
| "add feature", "implement", "create", "build" | `/brainstorm` | New functionality |
| "plan", "spec", "requirements" | `/writing-plans` | Has requirements |
| "analyze", "research", "audit" | `/research-and-analysis` | Need report |
| "refactor", "optimize" | `/brainstorm` | Significant changes |
| "before commit", "ready for PR" | `/verification-before-completion` | Always |

### Правило 1%

Если есть хоть 1% вероятности, что skill применим — вызови его. Лучше вызвать и понять что не нужно, чем пропустить.

### Исключения (НЕ вызывать skills)

- Простые вопросы: "Что делает эта функция?"
- Тривиальные изменения: "Исправь опечатку"
- Чистое exploration: "Покажи структуру директории"

---

For detailed documentation: `/docs/README.md`
For full tech stack reference: `.claude/skills/tech-stack/SKILL.md`
