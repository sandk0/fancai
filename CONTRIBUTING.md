# Contributing — fancai

Спасибо за интерес к fancai. Этот документ описывает, как работать с
кодовой базой: окружение, конвенции, процесс PR.

> Если вы внешний контрибьютор: достаточно прочитать разделы 1–6.
> Раздел 7 — историческая справка о планировании (архив `.planning/`).

---

## 1. Окружение

### 1.1. Требования

- **Docker** с Compose v2 (вызывается как `docker compose`, через пробел)
- **Node.js 20+** (Vite 8 требует Node 20.19+)
- **Python 3.12** + [uv](https://docs.astral.sh/uv/) (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- **Git**
- API-ключ [OpenRouter](https://openrouter.ai/) для тестирования AI-функций
  (без него можно работать над всем, что не трогает `services/gemini_extractor.py`,
  `services/image_generation.py` и т.п.)

### 1.2. Первичная настройка

```bash
git clone https://github.com/sandk0/fancai.git
cd fancai

# Конфигурация
cp .env.production.example .env.development
# Заполните минимум: OPENROUTER_API_KEY, DB_PASSWORD, REDIS_PASSWORD, SECRET_KEY

# Инфраструктура
docker compose -f docker-compose.dev.yml up -d

# Backend
cd backend
uv sync                               # манифест — pyproject.toml + uv.lock
uv run alembic upgrade head
uv run uvicorn app.main:app --reload  # http://localhost:8000

# Frontend (отдельный терминал)
cd frontend
npm install
npm run dev                            # http://localhost:5173
```

Проверка:

```bash
curl http://localhost:8000/health     # должен вернуть {"status": "ok"}
```

---

## 2. Конвенции коммитов

[Conventional Commits](https://www.conventionalcommits.org/) — обязательны
для prod-кода и docs:

```
<type>(<scope>): <subject>

[optional body]

[optional footer: Closes #123]
```

### Типы

| Type       | Когда использовать                  |
| ---------- | ----------------------------------- |
| `feat`     | новая функциональность              |
| `fix`      | исправление бага                    |
| `refactor` | рефакторинг без изменения поведения |
| `test`     | добавление/обновление тестов        |
| `docs`     | изменения только в документации     |
| `chore`    | рутина: зависимости, конфиги, CI    |
| `style`    | форматирование без изменения логики |
| `perf`     | улучшение производительности        |

### Scope (примеры из истории)

`reader`, `epub`, `entities`, `images`, `auth`, `sync`, `ai`, `sw` (service worker),
`csp`, `modal`, `readme`, `contributing`.

### Примеры

```
feat(entities): add fuzzy matching threshold tuning per language
fix(sw): check preloadResponse.ok before using navigation preload
refactor(reader): extract gestureFSM into shared utility
test(36-01): add failing tests for Modal metrics transport format
docs(readme): rewrite for accurate v1.5 stack
chore(deps): bump fastapi to 0.135.1
```

### Правила

- Subject — императив в настоящем времени: «add», не «added», не «adds»
- Без точки в конце subject
- Атомарные коммиты — один логический change на коммит
- Если PR содержит несвязанные изменения — разбейте на отдельные коммиты или PR
- Subject ≤ 72 символа, body wrap на 72

---

## 3. Стиль кода

### 3.1. Python (backend)

- **Type hints обязательны** на всех функциях и методах
- **Pydantic v2** для всех request/response схем
- **SQLAlchemy 2** с `lazy="raise"` — всегда указывайте `selectinload`/`joinedload` явно
- **Кастомные исключения** из `app/core/exceptions.py` (RFC 9457 формат)
- **tenacity retry** из `app/core/retry.py` для всех LLM/external вызовов
- **Новые AI-вызовы** через `app/core/ai_provider_factory.py`; не добавляйте прямые
  Gemini/OpenRouter/Modal client paths. Existing consistency/image drift отслеживается в
  `docs/architecture/ai-pipeline.md`.
- Размер файла: цельтесь в ≤500 строк, переразбивайте при превышении
- Комментарии — только когда «почему» неочевидно. «Что» должно быть видно из кода

```bash
cd backend
uv run ruff check app/            # lint (совпадает с CI)
uv run black --check app/         # formatter gate (совпадает с CI)
uv run mypy app/                  # type check
```

### 3.2. TypeScript (frontend)

- **Функциональные компоненты** + хуки (никаких class components)
- **TanStack Query** для всех API-вызовов — никакого прямого `fetch()`
- **Zustand** для клиентского состояния (3 стора: `auth`, `reader`, `ui`)
- **CFI** для позиции в EPUB (никогда не page numbers)
- **Tailwind 4** — utility-first, CSS-переменные в `globals.css`
- Props и хуки типизируйте интерфейсами, не `any`
- Если хук >150 строк — декомпозируйте

```bash
cd frontend
npm run lint                     # ESLint
npm run type-check               # tsc --noEmit
```

### 3.3. Миграции БД (Alembic)

```bash
cd backend
uv run alembic revision --autogenerate -m "add_<descriptive>_to_<table>"
# ВНИМАТЕЛЬНО проверьте сгенерированный файл
uv run alembic upgrade head
```

- Внимательно ревьюйте autogenerate-результат — он не идеален
- Используйте `op.batch_alter_table()` для совместимости с SQLite (если нужна)
- Включайте обе функции: `upgrade()` и `downgrade()`
- Тестируйте на чистой БД перед merge

---

## 4. Тестирование

| Уровень                    | Команда                           | Где                            |
| -------------------------- | --------------------------------- | ------------------------------ |
| Backend unit / integration | `cd backend && uv run pytest -v`  | `backend/tests/`               |
| Frontend unit              | `cd frontend && npm test`         | `frontend/src/**/*.test.ts(x)` |
| Frontend E2E               | `cd frontend && npm run test:e2e` | `frontend/tests/e2e/`          |

Правила:

- **Новые фичи** — обязательно тесты (минимум один happy path + edge case)
- **Багфиксы** — обязательно регрессионный тест (failing first → fix → green)
- **Spoiler-protection** — property-based тесты через `hypothesis` (см. `tests/services/test_entity_filter.py`)
- Не мокайте БД в integration-тестах (есть исторический инцидент с разъездом
  mock vs prod миграции)

Перед PR: прогоните полный набор локально, не полагайтесь только на CI.

---

## 5. Pre-commit hooks (опционально)

В корне есть `.pre-commit-config.yaml` (его версии устарели и могут расходиться
с прод-зависимостями — конфиг будет обновлён отдельной фазой). Если хотите
включить:

```bash
pip install pre-commit
pre-commit install
pre-commit run --all-files       # прогнать все файлы вручную
```

Если хуки ругаются на legacy-код, который вы не трогали — пропустить можно
точечно через `SKIP=<hook-id> git commit ...`. **Не** используйте `--no-verify`
без согласования с maintainer.

---

## 6. Pull Request

### 6.1. Перед открытием PR

- [ ] Все тесты зелёные локально (backend + frontend + e2e если затронуты)
- [ ] `ruff check`, `mypy`, `npm run lint`, `npm run type-check` чистые
- [ ] `npm run build` успешный (TypeScript-типы окей)
- [ ] Коммиты атомарные, conventional, без мусорных «wip / fixup / typo»
- [ ] Если меняли публичные API endpoint'ы — обновлена `docs/` (или соответствующий `.md`)
- [ ] Если меняли user-facing UI — приложите скриншот / GIF в описании PR

### 6.2. Тело PR

Минимум:

```markdown
## Что

Краткое описание изменений (1–3 предложения).

## Почему

Контекст: что не работало / какая фича / какой бизнес-кейс.

## Как проверить

- Шаги для ручной проверки
- Какие тесты добавлены/изменены

Closes #<issue-id> (если применимо)
```

Скриншоты — для UI-изменений. Для bugfix'ов хороший паттерн: «before / after»
скриншоты или output.

### 6.3. Code review

- Минимум одно одобрение от maintainer
- Отвечайте на все комментарии — либо изменением, либо обоснованием почему не меняете
- Дискуссии в треде, не в DM
- После approval — squash-merge (для коротких) или merge-commit (для крупных
  с осмысленной commit-историей)

---

## 7. Планирование (архив `.planning/`)

Исторически проект вёлся через phase-based планировщик (GSD), который
удалён из репозитория. Его артефакты сохранены в `.planning/` как
**read-only историческая справка** — vision, состояние и хронология фаз:

- `.planning/PROJECT.md` — vision, scope, what's-in/out
- `.planning/STATE.md` — оперативное состояние на момент последней фазы
- `.planning/ROADMAP.md` — phases / plans / milestones
- `.planning/MILESTONES.md` — история отгруженных milestones
- `.planning/phases/<NN>/PLAN.md` — детальные планы фаз

Специальных команд или инструментов для работы с проектом больше не
требуется — обычный git-флоу из разделов 1–6. Файлы в `.planning/` можно
читать для контекста; активного workflow за ними больше нет.

---

## 8. Вопросы и помощь

- **Issues / bugs:** <https://github.com/sandk0/fancai/issues>
- **Security:** см. [`docs/SECURITY.md`](docs/SECURITY.md) — приватные сообщения,
  не публичные issue
- **Documentation:** [`docs/README.md`](docs/README.md) как навигатор

---

_Последнее обновление: 2026-04-30. Сверено с `package.json`, `backend/pyproject.toml`, `.pre-commit-config.yaml`, `.planning/PROJECT.md`._
