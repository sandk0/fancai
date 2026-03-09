# fancai — Fiction reader with AI illustrations and interactive book glossary

Two core AI features:

1. **Image generation** — Gemini extracts visual descriptions, Imagen generates illustrations
2. **Entity glossary/wiki (main feature)** — AI builds interactive encyclopedia: characters, locations, objects with spoiler-free chapter tracking

Stack: React 19 + TypeScript 5.7 + Vite 7 | FastAPI + Python 3.12 + PostgreSQL 17 + Redis 7.4 + Celery
AI: OpenRouter (LLM: Gemini 3.0 Flash) | OpenRouter (Images: FLUX.2 Klein)
Production: https://fancai.ru | Deploy: `/deploy` skill

## Commands

```bash
cd frontend && npm run dev          # Frontend dev server
cd frontend && npm test             # Jest tests (prefer single files)
cd frontend && npm run build        # Production build
cd backend && pytest -v             # Backend tests
cd backend && alembic upgrade head  # Run migrations
docker compose up -d                # Start all services (NOT docker-compose)
```

## Code Conventions

- Commits: `<type>(<scope>): <subject>` — feat, fix, refactor, test, chore
- TypeScript: functional components, TanStack Query for API, CFI for EPUB positions
- Python: type hints, Pydantic validation, tenacity retries
- No direct fetch() — use TanStack Query hooks

## Architecture Gotchas

- epub.js uses CFI for position tracking (not page numbers)
- Description highlighting: 8 fallback search strategies (useDescriptionHighlighting.ts)
- IndexedDB caches chapters offline (chapterCache.ts)
- EpubReader.tsx (286 lines) — well-decomposed into 25+ hooks, but still the most-changed file
- Entity system: spoiler-free, shows info only up to current reading chapter

## Workflow

- Run tests before completing any code task
- `/clear` between unrelated tasks
- For tech stack details: `.claude/skills/tech-stack/SKILL.md`
- For deploy: `/deploy` skill
- For migrations: `/db-migrate` skill

## Known Claude Code Bugs

- **AskUserQuestion внутри Skill**: AskUserQuestion авто-одобряется без показа UI при вызове из Skill-контекста (v2.1.68). Workaround: внутри skill НЕ используй AskUserQuestion — задавай вопросы plain text и жди ответа пользователя в следующем сообщении.

## Compaction Rules

IMPORTANT: При /compact всегда сохраняй:

- Список изменённых файлов в текущей задаче
- Текущий план и прогресс (если есть)
- Найденные баги и решения
- Имена веток и коммитов

---

For iOS/theme/Reader rules: `.claude/rules/frontend.md`
For Reader/EPUB rules: `.claude/rules/reader.md`
For skill routing: `.claude/rules/auto-routing.md`
GSD planning: `.planning/` (ROADMAP.md, STATE.md)
