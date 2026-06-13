# Reference (placeholder)

Эта директория задумывалась как Diataxis-секция «Reference»
(API, database, components, CLI), но не была заполнена. Содержимое
из `api/`, `database/`, `components/`, `nlp/`, `cli/` (на которые
ссылался прежний README) — никогда не было создано.

NLP-секция, упоминавшаяся в старом README, неактуальна — система
была удалена в декабре 2025 (RAM-оптимизация); извлечение описаний и
сущностей идёт через LLM API (OpenRouter).

## Куда идти

| Что нужно                           | Где это                                                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Live API reference (Swagger UI)** | `http://localhost:8000/docs` при запущенном backend                                                                                |
| OpenAPI schema (JSON)               | `http://localhost:8000/openapi.json`                                                                                               |
| Database schema (модели)            | [`../../backend/app/models/`](../../backend/app/models/) (18 SQLAlchemy моделей)                                                   |
| Migrations                          | [`../../backend/alembic/versions/`](../../backend/alembic/versions/) (47 файлов)                                                   |
| Backend services                    | [`../../backend/app/services/`](../../backend/app/services/) — `gemini_extractor.py`, `book_parser.py`, `entity_service.py` и т.д. |
| Backend routers                     | [`../../backend/app/routers/`](../../backend/app/routers/) — 25 файлов                                                             |
| Frontend hooks (TanStack Query API) | [`../../frontend/src/hooks/api/`](../../frontend/src/hooks/api/)                                                                   |
| AI client (OpenRouter unified)      | [`../../backend/app/core/openrouter_client.py`](../../backend/app/core/openrouter_client.py)                                       |
| Backend conventions / structure     | [`../../backend/CLAUDE.md`](../../backend/CLAUDE.md)                                                                               |
| Frontend conventions / structure    | [`../../frontend/CLAUDE.md`](../../frontend/CLAUDE.md)                                                                             |

Реальный API-контракт лучше всего читать через `/docs` (Swagger), потому что
он автоматически синхронизирован с FastAPI декораторами. Документ-копия
в этой директории всегда устаревала бы.

---

_Last updated: 2026-04-30._
