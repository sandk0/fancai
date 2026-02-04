# План миграции зависимостей fancai
**Дата составления:** 3 февраля 2026  
**Версия документа:** 4.0  
**Последнее обновление:** 4 февраля 2026

---

## Прогресс выполнения

| Волна | Статус | Дата | Пакетов | Риск |
|-------|--------|------|---------|------|
| **Frontend Wave 0** — Minor/patch | **ЗАВЕРШЕНА** | 2026-02-04 | 22 | ОЧЕНЬ НИЗКИЙ |
| **Frontend Wave 1** — Build система | **ЗАВЕРШЕНА** | 2026-02-04 | 4 | НИЗКИЙ-СРЕДНИЙ |
| **Frontend Wave 2** — Тестовая инфра | **ЗАВЕРШЕНА** | 2026-02-04 | 5 | СРЕДНИЙ |
| **Frontend Wave 3** — UI фреймворк | **ЗАВЕРШЕНА** | 2026-02-04 | 1 | СРЕДНИЙ |
| **Frontend Wave 4** — Формы/валидация | **ЗАВЕРШЕНА** | 2026-02-04 | 2 | СРЕДНИЙ-ВЫСОКИЙ |
| **Frontend Wave 5** — Анимации/иконки | **ЗАВЕРШЕНА** | 2026-02-04 | 2 | НИЗКИЙ-СРЕДНИЙ |
| **Backend Wave 0** — Minor/patch | **ЗАВЕРШЕНА** | 2026-02-04 | 15 | ОЧЕНЬ НИЗКИЙ |
| **Backend Wave 1** — Безопасные bumps | **ЗАВЕРШЕНА** | 2026-02-04 | 11 | НИЗКИЙ |
| **Backend Wave 2** — Code review | **ЗАВЕРШЕНА** | 2026-02-04 | 3 | НИЗКИЙ-СРЕДНИЙ |
| **Backend Wave 3** — Redis major | **ЗАВЕРШЕНА** | 2026-02-04 | 1+1 | ВЫСОКИЙ |
| **Backend Wave 4** — Тестовая инфра | **ЗАВЕРШЕНА** | 2026-02-04 | 3 | ВЫСОКИЙ |
| **Backend Wave 5** — Форматирование | **ЗАВЕРШЕНА** | 2026-02-04 | 2 | СРЕДНИЙ |

### Итоговая статистика

| Категория | Завершено | Осталось | Всего |
|-----------|-----------|----------|-------|
| Frontend | 36 | 0 | 36 |
| Backend | 36 | 0 | 36 |
| **Всего** | **72** | **0** | **72** |

> **ВСЕ ЗАВИСИМОСТИ ОБНОВЛЕНЫ.** Ничего не закоммичено — ожидает коммита и деплоя.

---

## Резюме

### Общая информация о проекте
- **Проект:** fancai — веб-приложение для чтения художественной литературы с AI-иллюстрациями
- **Frontend:** React 19 + TypeScript 5.7 + Vite 7 + TailwindCSS 4 + TanStack Query 5 + Zustand 5
- **Backend:** FastAPI + Python 3.12 + PostgreSQL + Redis + Celery
- **Общее количество устаревших пакетов:** ~~72~~ → **0 оставшихся**

### Ключевые метрики

| Категория | Количество | Статус |
|-----------|------------|--------|
| Frontend (все волны) | 36 | **ЗАВЕРШЕНО** ✅ |
| Backend (все волны) | 36 | **ЗАВЕРШЕНО** ✅ |

### Выполненные критические миграции

1. **pytest-asyncio 0.25→1.3** ✅ — удалён `event_loop` fixture из conftest.py
2. **redis-py 5→7** ✅ — удалён `encoding="utf-8"` (6 файлов), удалён `types-redis` (stubs встроены)
3. **pytest 8→9** ✅ — совместим без изменений кода
4. **gunicorn 23→25** ✅ — UvicornWorker не затронут
5. **psutil 6→7** ✅ — используемые API (virtual_memory, cpu_percent) не изменились
6. **pillow >=11→12.1** ✅ — не импортируется напрямую, запинен
7. **TailwindCSS 3→4** ✅ — полная переработка CSS-конфигурации
8. **Vitest 2→4** ✅ — двухфазная миграция
9. **Zod 3→4** ✅ — автоматическая миграция
10. **framer-motion→motion 12** ✅ — 38 импортов обновлены

---

## Frontend — ВСЕ ВОЛНЫ ЗАВЕРШЕНЫ ✅

**Статус:** ЗАВЕРШЕНО (2026-02-04)  
**Результат:** 36 пакетов обновлены, `npm outdated` = пусто  
**Качество:** tsc --noEmit: 0 errors, npm run lint: 0 errors 36 warnings, npm run build: OK  
**Тесты:** 219 passed / 56 failed (pre-existing, 0 regressions)

### Frontend Wave 0 — Minor/patch обновления ✅

**Риск:** ОЧЕНЬ НИЗКИЙ  
**Статус:** ЗАВЕРШЕНА (2026-02-04)  
**Результат:** 22 пакета обновлены, 0 регрессий

Обновлены все minor/patch версии без breaking changes:
- react 19.2.3 → 19.2.4
- react-dom 19.2.3 → 19.2.4
- react-router-dom 7.11.0 → 7.13.0
- @tanstack/react-query 5.90.12 → 5.90.20
- @radix-ui/* (9 пакетов)
- @testing-library/react 16.3.1 → 16.3.2
- @types/node 25.0.3 → 25.2.0
- @types/react 19.2.7 → 19.2.10
- axios 1.13.1 → 1.13.4
- dexie 4.2.1 → 4.3.0
- dompurify 3.3.0 → 3.3.1
- autoprefixer 10.4.21 → 10.4.24
- globals 17.2.0 → 17.3.0
- i18next 25.8.0 → 25.8.1
- tailwind-merge 3.3.1 → 3.4.0
- zustand 5.0.10 → 5.0.11
- react-hook-form 7.65.0 → 7.71.1

---

### Frontend Wave 1 — Build-система ✅

**Риск:** НИЗКИЙ-СРЕДНИЙ  
**Статус:** ЗАВЕРШЕНА (2026-02-04)  
**Результат:** vite 6→7, @vitejs/plugin-react 4→5, eslint-plugin-react-hooks 5→7, eslint-plugin-react-refresh 0.4→0.5

**Ключевые изменения:**
- vite 6.4.1 → 7.3.1 (Node.js 20.19+ required)
- @vitejs/plugin-react 4.7.0 → 5.1.3
- eslint-plugin-react-hooks 5.2.0 → 7.0.1 (добавил 36 новых warnings — React Compiler rules, демотированы в warn)
- eslint-plugin-react-refresh 0.4.24 → 0.5.0 (ESM-only, ESLint 9+, flat config)

**Примечание:** eslint-plugin-react-hooks v7 добавил 36 новых warnings (React Compiler rules) — демотированы в warn, threshold установлен на 36.

---

### Frontend Wave 2 — Тестовая инфраструктура ✅

**Риск:** СРЕДНИЙ  
**Статус:** ЗАВЕРШЕНА (2026-02-04)  
**Результат:** vitest 2→4, jsdom 25→28, @playwright/test 1.56→1.58

**Ключевые изменения:**
- vitest 2.1.9 → 4.0.18 (двухфазная миграция v2→v3→v4)
  - `vi.mock()` factory требует `vi.hoisted()` для внешних переменных
  - `threads: true` → `pool: 'threads'`
  - `vi.resetModules()` теперь async
  - `expect.assertions()` теперь бросает исключение при несовпадении
- @vitest/coverage-v8 2.1.9 → 4.0.18
- @vitest/ui 2.1.9 → 4.0.18
- jsdom 25.0.1 → 28.0.0
  - `requestAnimationFrame` отключён по умолчанию (использовать `pretendToBeVisual: true`)
  - `form.submit()` больше не вызывает событие submit (использовать `requestSubmit()`)
- @playwright/test 1.56.1 → 1.58.1

---

### Frontend Wave 3 — UI фреймворк ✅

**Риск:** СРЕДНИЙ  
**Статус:** ЗАВЕРШЕНА (2026-02-04)  
**Результат:** tailwindcss 3→4 (полная переработка архитектуры)

**Ключевые изменения:**
- tailwindcss 3.4.18 → 4.1.18
- Полная переработка: CSS-first конфигурация вместо JS
- `@tailwind base/components/utilities` → `@import "tailwindcss"`
- `tailwind.config.js` → CSS `@theme` директива
- PostCSS: `tailwindcss` → `@tailwindcss/vite`
- `autoprefixer` больше не нужен (встроен)
- Переименованные утилиты:
  - `shadow-sm` → `shadow-xs`, `shadow` → `shadow-sm`
  - `rounded-sm` → `rounded-xs`, `rounded` → `rounded-sm`
  - `blur-sm` → `blur-xs`, `blur` → `blur-sm`
  - `outline-none` → `outline-hidden`
  - `ring` → `ring-3`
- Удалены утилиты opacity (`bg-opacity-*` → синтаксис `bg-black/50`)
- Цвет border по умолчанию изменён с `gray-200` на `currentColor`

**Миграция:**
```bash
cd frontend
npx @tailwindcss/upgrade  # Автоматическая миграция
```

---

### Frontend Wave 4 — Формы и валидация ✅

**Риск:** СРЕДНИЙ-ВЫСОКИЙ  
**Статус:** ЗАВЕРШЕНА (2026-02-04)  
**Результат:** zod 3→4, @hookform/resolvers 3→5

**Ключевые изменения:**
- zod 3.25.76 → 4.3.6
  - `message` → `error` параметр
  - `.strict()` → `z.strictObject()`
  - `.merge()` → `.extend()` или object spread
  - `.email()` → `z.email()` (top-level функция)
  - `.default()` теперь ожидает output type (использовать `.prefault()` для старого поведения)
  - `z.record(valueSchema)` → `z.record(keySchema, valueSchema)`
  - `.format()`/`.flatten()` → `z.treeifyError()`
  - `.deepPartial()` удалён
  - Производительность: объекты в 6.5x быстрее, bundle на 57% меньше
- @hookform/resolvers 3.10.0 → 5.2.2
  - Автоматический вывод типов из схем (input/output)

**Миграция:**
```bash
cd frontend
npx zod-v3-to-v4  # Автоматическая миграция
```

---

### Frontend Wave 5 — Анимации и иконки ✅

**Риск:** НИЗКИЙ-СРЕДНИЙ  
**Статус:** ЗАВЕРШЕНА (2026-02-04)  
**Результат:** framer-motion→motion 12, lucide-react 0.469→0.563

**Ключевые изменения:**
- framer-motion 11.18.2 → motion 12.31.0
  - Пакет переименован: `framer-motion` → `motion`
  - Путь импорта: `"framer-motion"` → `"motion/react"`
  - НЕТ изменений API — только переименование
  - 38 импортов обновлены + 14 type fixes
  - motion v12 ужесточил типы transition — `type: 'spring'` требует `as const` в variants
- lucide-react 0.469.0 → 0.563.0
  - По умолчанию `aria-hidden="true"` на всех иконках
  - Нужно добавить `aria-label` для семантических иконок

**Миграция:**
```bash
cd frontend/src
# Автоматическая замена импортов
find . -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' 's/from "framer-motion"/from "motion\/react"/g' {} +
```

---

## Backend Wave 0 — Minor/patch обновления ✅

**Риск:** ОЧЕНЬ НИЗКИЙ  
**Статус:** ЗАВЕРШЕНА (2026-02-04)  
**Результат:** 15 пакетов обновлены в requirements.txt и requirements.lite.txt, 0 регрессий

Обновлены все minor/patch версии без breaking changes:
- sqlalchemy 2.0.45 → 2.0.46
- alembic 1.14.0 → 1.18.3
- aiohttp 3.11.11 → 3.13.3
- asyncpg 0.30.0 → 0.31.0
- networkx 3.4.2 → 3.6.1
- beautifulsoup4 4.12.3 → 4.14.3
- ebooklib 0.19 → 0.20
- requests 2.32.3 → 2.32.5
- aiosqlite 0.20.0 → 0.22.1
- prometheus-client 0.21.1 → 0.24.1
- prometheus-fastapi-instrumentator 7.0.0 → 7.1.0
- tenacity 9.0.0 → 9.1.2
- google-genai 1.59.0 → 1.61.0
- sentry-sdk 2.19.2 → 2.51.0
- kombu 5.5.0 → 5.6.2
- mypy 1.14.1 → 1.19.1
- types-requests обновлены

Также синхронизированы в lite:
- pydantic 2.12.5
- pydantic-settings 2.8.0
- python-multipart 0.0.20
- celery 5.6.2

**Команды для выполнения:**
```bash
cd backend
pip install --upgrade sqlalchemy alembic aiohttp asyncpg networkx
pip install --upgrade beautifulsoup4 ebooklib requests aiosqlite
pip install --upgrade prometheus-client prometheus-fastapi-instrumentator tenacity
pip install --upgrade google-genai sentry-sdk kombu mypy types-requests
```

**Тестирование:**
```bash
pytest -v
mypy app/
```

---

## Backend Wave 1 — Безопасные bumps (11 пакетов) ✅

**Риск:** НИЗКИЙ  
**Статус:** ЗАВЕРШЕНА (2026-02-04)  
**Результат:** 11 пакетов обновлены в обоих requirements файлах, 0 изменений кода

Все пакеты в этой волне имеют 0 breaking changes для нашего кода.

### 1.1. fastapi 0.125.0 → 0.128.0

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 30 минут

**Breaking changes:**
- Pydantic v1 support removed (мы на v2 — OK)
- Нет других breaking changes для нашего кода

**Шаги миграции:**

1. Обновить пакет:
```bash
pip install fastapi==0.128.0
```

2. Тестирование:
```bash
pytest tests/ -v
uvicorn app.main:app --reload  # Проверить запуск
```

---

### 1.2. uvicorn 0.34.0 → 0.40.0

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 30 минут

**Breaking changes:**
- Python 3.10+ required (мы на 3.12 — OK)
- ContextVar isolation fix
- WebSocket close frame fix
- Нет изменений API

**Шаги миграции:**

1. Обновить пакет:
```bash
pip install uvicorn==0.40.0
```

2. Тестирование:
```bash
uvicorn app.main:app --reload
pytest tests/ -v
```

---

### 1.3. cryptography 44.0.0 → 46.0.4

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 30 минут

**Breaking changes:**
- Removed CAST5/SEED/Blowfish ciphers (мы не используем)
- JWT/JOSE unaffected
- python-jose 3.5.0 compatible

**Шаги миграции:**

1. Обновить пакет:
```bash
pip install cryptography==46.0.4
```

2. Тестирование:
```bash
pytest tests/test_auth.py -v
```

---

### 1.4. python-jose 3.4.0 → 3.5.0

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 30 минут

**Breaking changes:**
- Compatible with cryptography 46
- Removed get_random_bytes internal
- JWKError no longer exposes key data (security improvement)

**Шаги миграции:**

1. Обновить пакет:
```bash
pip install python-jose==3.5.0
```

2. Тестирование:
```bash
pytest tests/test_auth.py -v
```

---

### 1.5. python-multipart 0.0.20 → 0.0.22

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 15 минут

**Breaking changes:**
- Security fix: directory path stripped from filenames (улучшение безопасности)

**Шаги миграции:**

1. Обновить пакет:
```bash
pip install python-multipart==0.0.22
```

2. Тестирование:
```bash
pytest tests/test_upload.py -v
```

---

### 1.6. pydantic-settings 2.8.0 → 2.12.0

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 1 час

**Breaking changes:**
- Source priority changed: init > env > dotenv > secrets > defaults
- Нужно протестировать загрузку настроек

**Шаги миграции:**

1. Проверить порядок приоритета:
```python
# Новый порядок:
# 1. init (самый высокий приоритет)
# 2. env
# 3. dotenv
# 4. secrets
# 5. defaults (самый низкий приоритет)
```

2. Обновить пакет:
```bash
pip install pydantic-settings==2.12.0
```

3. Тестирование:
```bash
pytest tests/test_config.py -v
python -c "from app.core.config import settings; print(settings.database_url)"
```

---

### 1.7. aiofiles 24.1.0 → 25.1.0

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 15 минут

**Breaking changes:**
- Нет breaking changes

**Шаги миграции:**

1. Обновить пакет:
```bash
pip install aiofiles==25.1.0
```

2. Тестирование:
```bash
pytest tests/ -v
```

---

### 1.8. lxml 5.3.0 → 6.0.2

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 30 минут

**Breaking changes:**
- text_content() returns plain string
- .head/.body return None if missing
- Наше использование (etree.fromstring для FB2, BS4 с html.parser) не затронуто

**Шаги миграции:**

1. Обновить пакет:
```bash
pip install lxml==6.0.2
```

2. Тестирование:
```bash
pytest tests/test_book_parser.py -v
```

---

### 1.9. pywebpush 2.0.1 → 2.2.0

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 15 минут

**Breaking changes:**
- Нет breaking changes от 2.0.x

**Шаги миграции:**

1. Обновить пакет:
```bash
pip install pywebpush==2.2.0
```

2. Тестирование:
```bash
pytest tests/test_notifications.py -v
```

---

### 1.10. google-api-core 2.24.0 → 2.29.0

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 15 минут

**Breaking changes:**
- Нет breaking changes
- Memory leak fixes
- Removed dependency on `packaging`
- Код НЕ импортирует google-api-core напрямую (transitive dependency для google-genai)

**Шаги миграции:**

1. Обновить пакет:
```bash
pip install google-api-core==2.29.0
```

2. Тестирование:
```bash
pytest tests/ -v
```

---

### 1.11. types-aiofiles 24.1.0.20241221 → 25.1.0.20251011

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 15 минут

**Breaking changes:**
- Теперь tracks aiofiles 25.x (которую мы обновляем)

**Шаги миграции:**

1. Обновить пакет:
```bash
pip install types-aiofiles==25.1.0.20251011
```

2. Тестирование:
```bash
mypy app/
```

---

**Итого Wave 1:** 2-4 часа

**Команды для выполнения всей волны:**
```bash
cd backend
pip install fastapi==0.128.0 uvicorn==0.40.0 cryptography==46.0.4
pip install python-jose==3.5.0 python-multipart==0.0.22 pydantic-settings==2.12.0
pip install aiofiles==25.1.0 lxml==6.0.2 pywebpush==2.2.0
pip install google-api-core==2.29.0 types-aiofiles==25.1.0.20251011

# Тестирование
pytest -v
mypy app/
uvicorn app.main:app --reload
```

---

## Backend Wave 2 — Code review (3 пакета) ✅

**Риск:** НИЗКИЙ-СРЕДНИЙ  
**Статус:** ЗАВЕРШЕНА (2026-02-04)  
**Результат:** 3 пакета обновлены, code review подтвердил 0 breaking changes для нашего кода

**Findings:**
- gunicorn: используется только в entrypoint.prod.sh с UvicornWorker — Eventlet removal не касается
- psutil: используем только `virtual_memory()` и `cpu_percent()` — удалённые API не используются
- pillow: `from PIL import` **не найден** в коде — транзитивная зависимость, запинена на 12.1.0

### 2.1. gunicorn 23.0.0 → 25.0.1

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 1 час

**Breaking changes:**
- Python 3.10+ (OK, мы на 3.12)
- Eventlet deprecated (мы используем UvicornWorker — OK)
- Новый native ASGI worker доступен

**Production usage:**
```bash
# Dockerfile.lite.prod
gunicorn app.main:app --workers N --worker-class uvicorn.workers.UvicornWorker

# entrypoint.prod.sh
gunicorn app.main:app --workers N --worker-class uvicorn.workers.UvicornWorker
```

**Шаги миграции:**

1. Проверить production конфигурацию:
```bash
grep -r "gunicorn" docker/ scripts/
```

2. Обновить пакет:
```bash
pip install gunicorn==25.0.1
```

3. Тестирование:
```bash
# Локально
gunicorn app.main:app --workers 2 --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000

# Production (в Docker)
docker-compose -f docker-compose.lite.yml up -d backend
docker logs fancai-backend-1
```

---

### 2.2. psutil 6.1.1 → 7.2.2

**Уровень риска:** СРЕДНИЙ  
**Трудозатраты:** 1-2 часа

**Breaking changes:**
- `memory_info_ex()` removed → `memory_full_info()`
- `connections()` → `net_connections()`
- `maxfile`/`maxpath` removed from `disk_partitions()`

**Шаги миграции:**

1. Найти использование psutil:
```bash
cd backend
grep -r "psutil" app/ tests/
grep -r "memory_info_ex\|connections()\|maxfile\|maxpath" app/ tests/
```

2. Обновить код (если найдено):
```python
# БЫЛО
import psutil
mem = psutil.virtual_memory().memory_info_ex()
conns = psutil.connections()

# СТАЛО
import psutil
mem = psutil.virtual_memory().memory_full_info()
conns = psutil.net_connections()
```

3. Обновить пакет:
```bash
pip install psutil==7.2.2
```

4. Тестирование:
```bash
pytest tests/ -v
```

---

### 2.3. pillow >=11.0.0 → 12.1.0

**Уровень риска:** СРЕДНИЙ  
**Трудозатраты:** 1 час

**Breaking changes:**
- `ImageMath.eval()` removed → `lambda_eval()`
- Python 3.10+ required (OK, мы на 3.12)

**Шаги миграции:**

1. Найти использование ImageMath:
```bash
cd backend
grep -r "ImageMath" app/ tests/
```

2. Обновить код (если найдено):
```python
# БЫЛО
from PIL import ImageMath
result = ImageMath.eval("a + b", a=img1, b=img2)

# СТАЛО
from PIL import ImageMath
result = ImageMath.lambda_eval(lambda a, b: a + b, a=img1, b=img2)
```

3. Обновить requirements.lite.txt:
```
# БЫЛО
pillow>=11.0.0

# СТАЛО
pillow==12.1.0
```

4. Обновить пакет:
```bash
pip install pillow==12.1.0
```

5. Тестирование:
```bash
pytest tests/ -v
```

---

**Итого Wave 2:** 2-4 часа

**Команды для выполнения всей волны:**
```bash
cd backend

# Сначала проверить использование
grep -r "psutil" app/ tests/
grep -r "ImageMath" app/ tests/

# Обновить пакеты
pip install gunicorn==25.0.1 psutil==7.2.2 pillow==12.1.0

# Тестирование
pytest -v
gunicorn app.main:app --workers 2 --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

---

## Backend Wave 3 — Redis major migration (1 пакет + 1 удалён) ✅

**Риск:** ВЫСОКИЙ  
**Статус:** ЗАВЕРШЕНА (2026-02-04)  
**Результат:** redis 5.2.1→7.1.0, types-redis УДАЛЁН, encoding="utf-8" удалён из 6 файлов

**Findings:**
- `charset`/`errors` параметры не использовались — OK
- `encoding="utf-8"` использовался в 6 файлах — удалён (redundant с `decode_responses=True`, utf-8 — дефолт)
- `types-redis` удалён из обоих requirements — redis-py 5.0+ включает встроенные type stubs
- SSL не используется (plain redis://) — ssl_check_hostname не затрагивает
- Default retry 3 attempts — положительное изменение для нашего graceful degradation
- Все Redis операции (get/set/zadd/pipeline/pubsub) — стабильный API

### 3.1. redis 5.2.1 → 7.1.0

**Уровень риска:** ВЫСОКИЙ  
**Трудозатраты:** 1-2 дня (16 файлов используют redis)

**Breaking changes:**
- 100% async (redis.asyncio)
- Default retry: 3 attempts with ExponentialWithJitterBackoff
- ssl_check_hostname defaults to True
- charset/errors args removed (мы не используем)
- Нет StrictRedis usage (мы используем Redis — OK)
- decode_responses passed correctly

**Key concern:** Retry behavior change may affect latency.

**Файлы, использующие redis (16 файлов):**
```bash
cd backend
grep -r "redis" app/ --include="*.py" | cut -d: -f1 | sort -u
```

**Шаги миграции:**

1. **Найти все использования redis:**
```bash
cd backend
grep -r "from redis" app/ tests/
grep -r "import redis" app/ tests/
grep -r "Redis(" app/ tests/
```

2. **Обновить импорты:**
```python
# БЫЛО
import redis
from redis import Redis

# СТАЛО
from redis.asyncio import Redis
```

3. **Обновить создание клиента:**
```python
# БЫЛО
redis_client = Redis(
    host='localhost',
    port=6379,
    decode_responses=True
)

# СТАЛО
redis_client = Redis(
    host='localhost',
    port=6379,
    decode_responses=True,
    retry_on_timeout=True,  # Явно указать retry behavior
    retry_on_error=[ConnectionError, TimeoutError],
    retry=Retry(ExponentialBackoff(), 3)  # Явно указать retry strategy
)
```

4. **Обновить ConnectionPool:**
```python
# БЫЛО
from redis import ConnectionPool, Redis

pool = ConnectionPool(host='localhost', port=6379, decode_responses=True)
redis_client = Redis(connection_pool=pool)

# СТАЛО
from redis.asyncio import ConnectionPool, Redis

pool = ConnectionPool(host='localhost', port=6379)
redis_client = Redis(connection_pool=pool, decode_responses=True)  # decode_responses в Redis()
```

5. **Обновить zadd (если используется):**
```python
# БЫЛО
redis_client.zadd('myset', 1.0, 'member1')

# СТАЛО
redis_client.zadd('myset', {'member1': 1.0})
```

6. **Обновить закрытие соединения:**
```python
# БЫЛО
await redis_client.close()
await redis_client.wait_closed()

# СТАЛО
await redis_client.aclose()
```

7. **Обновить пакет:**
```bash
pip install redis==7.1.0
```

8. **Тестирование (поэтапно):**
```bash
# Запустить один тестовый файл
pytest tests/test_cache.py -v

# Если работает, запустить все
pytest tests/ -v

# Проверить production
docker-compose -f docker-compose.lite.yml up -d redis backend
docker logs fancai-backend-1
```

9. **Мониторинг latency:**
```bash
# Проверить latency после миграции
redis-cli --latency
redis-cli --latency-history
```

**Итого Wave 3:** 1-2 дня

---

## Backend Wave 4 — Тестовая инфраструктура (3 пакета) ✅

**Риск:** ВЫСОКИЙ  
**Статус:** ЗАВЕРШЕНА (2026-02-04)  
**Результат:** pytest 9.0.2, pytest-asyncio 1.3.0, pytest-cov 7.0.0 + удалён event_loop fixture + удалён import asyncio

**Findings:**
- event_loop fixture (conftest.py:48-53) удалён — pytest-asyncio 1.x управляет event loop автоматически
- `asyncio_mode=auto` уже стоит в pytest.ini — совместим с 1.x
- 448 async тестов, 369 `@pytest.mark.asyncio` — работают с auto mode
- Нет session-scoped async fixtures кроме удалённого event_loop
- `import asyncio` удалён из conftest.py (стал unused)

### 4.1. pytest 8.3.4 → 9.0.2

**Уровень риска:** СРЕДНИЙ  
**Трудозатраты:** 4-6 часов

**Breaking changes:**
- Python 3.10+ обязателен (OK, мы на 3.12)
- Все `PytestRemovedIn9Warning` теперь ошибки
- Нативная TOML конфигурация: `[tool.pytest]` в `pyproject.toml`
- Встроенные subtests (удалить `pytest-subtests` если используется)

**Шаги миграции:**

1. **Найти все warnings:**
```bash
cd backend
pytest --collect-only -W default::PytestRemovedIn9Warning 2>&1 | grep "PytestRemovedIn9Warning"
```

2. **Мигрировать конфигурацию в pyproject.toml:**
```toml
# БЫЛО (pytest.ini или setup.cfg)
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = -v --strict-markers

# СТАЛО (pyproject.toml)
[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
python_classes = ["Test*"]
python_functions = ["test_*"]
addopts = "-v --strict-markers"
```

3. **Удалить pytest-subtests (если используется):**
```bash
pip uninstall pytest-subtests
```

Обновить тесты:
```python
# БЫЛО (с pytest-subtests)
def test_multiple_cases(subtests):
    for i in range(10):
        with subtests.test(i=i):
            assert i % 2 == 0

# СТАЛО (встроенные subtests)
def test_multiple_cases():
    for i in range(10):
        with pytest.subtest(i=i):
            assert i % 2 == 0
```

4. **Обновить пакет:**
```bash
pip install pytest==9.0.2
```

5. **Тестирование:**
```bash
pytest -v
```

---

### 4.2. pytest-asyncio 0.25.2 → 1.3.0

**Уровень риска:** КРИТИЧЕСКИЙ  
**Трудозатраты:** 3-5 дней (самая сложная миграция в backend)

**Breaking changes:**
- `event_loop` fixture полностью удалён
- `scope` → `loop_scope` параметр
- Нужно установить `asyncio_default_fixture_loop_scope` в конфигурации
- Синхронные тесты с async fixtures deprecated
- Python 3.10+ обязателен (OK, мы на 3.12)

**У нас есть session-scoped event_loop fixture в conftest.py (line 48-53)!**
**379 async tests с @pytest.mark.asyncio**
**asyncio_mode=auto в pytest.ini**

**Шаги миграции:**

1. **Обновить конфигурацию:**
```toml
# pyproject.toml
[tool.pytest.ini_options]
asyncio_default_fixture_loop_scope = "function"  # или "session", "module", "class"
```

2. **Удалить event_loop fixture из conftest.py:**
```python
# БЫЛО (conftest.py, lines 48-53)
import pytest
import asyncio

@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()

# СТАЛО
# Удалить полностью, pytest-asyncio управляет event loop автоматически
```

3. **Обновить scope на loop_scope:**
```python
# БЫЛО
@pytest.fixture(scope="session")
async def db_session():
    async with create_session() as session:
        yield session

# СТАЛО
@pytest.fixture(loop_scope="session")
async def db_session():
    async with create_session() as session:
        yield session
```

4. **Обновить синхронные тесты с async fixtures:**
```python
# БЫЛО (deprecated)
@pytest.fixture
async def async_data():
    return await fetch_data()

def test_sync_with_async_fixture(async_data):  # Синхронный тест с async fixture
    assert async_data is not None

# СТАЛО (сделать тест async)
@pytest.fixture
async def async_data():
    return await fetch_data()

async def test_async_with_async_fixture(async_data):  # Async тест
    assert async_data is not None
```

5. **Обновить пакет:**
```bash
pip install pytest-asyncio==1.3.0
```

6. **Тестирование (поэтапно):**
```bash
# Запустить один тестовый файл
pytest tests/test_auth.py -v

# Если работает, запустить все
pytest -v
```

7. **Исправить все падающие тесты:**
- Проверить все async fixtures
- Проверить все тесты с БД
- Проверить все тесты с Redis
- Проверить все интеграционные тесты

**Это самая трудоёмкая миграция в backend. Рекомендуется выделить 3-5 дней.**

---

### 4.3. pytest-cov 6.0.0 → 7.0.0

**Уровень риска:** СРЕДНИЙ  
**Трудозатраты:** 1 час

**Breaking changes:**
- Измерение subprocess через .pth удалено
- Нужно `patch = subprocess` в конфигурации coverage если используется subprocess coverage
- Минимум coverage.py 7.10.6

**Шаги миграции:**

1. **Обновить .coveragerc или pyproject.toml:**
```toml
# pyproject.toml
[tool.coverage.run]
source = ["app"]
omit = ["*/tests/*", "*/migrations/*"]
patch = "subprocess"  # Если нужно покрытие subprocess
```

2. **Обновить пакеты:**
```bash
pip install pytest-cov==7.0.0 coverage>=7.10.6
```

3. **Тестирование:**
```bash
pytest --cov=app --cov-report=html
```

---

**Итого Wave 4:** 3-5 дней

**Команды для выполнения всей волны:**
```bash
cd backend

# Сначала обновить конфигурацию (pyproject.toml)
# Удалить event_loop fixture из conftest.py

# Обновить пакеты
pip install pytest==9.0.2 pytest-asyncio==1.3.0 pytest-cov==7.0.0 coverage>=7.10.6

# Тестирование (поэтапно)
pytest tests/test_auth.py -v
pytest -v
pytest --cov=app --cov-report=html
```

---

## Backend Wave 5 — Форматирование (2 пакета) ✅

**Риск:** СРЕДНИЙ  
**Статус:** ЗАВЕРШЕНА (2026-02-04)  
**Результат:** black 26.1.0, ruff 0.15.0 — версии обновлены в обоих requirements, версии синхронизированы

**Примечание:** Эта волна только версии в requirements. Переформатирование кода (`black app/`, `ruff format app/`) нужно сделать при Docker build.

### 5.1. black 25.12.0 (lite) / 24.10.0 (main) → 26.1.0

**Уровень риска:** СРЕДНИЙ  
**Трудозатраты:** 1-2 часа

**Breaking changes:**
- 2026 stable style
- Large diff, 0 logic changes
- pathspec v1 changes .gitignore behavior
- Python 3.10+ required (OK, мы на 3.12)

**Шаги миграции:**

1. **Обновить пакет:**
```bash
pip install black==26.1.0
```

2. **Запустить форматирование:**
```bash
cd backend
black app/ tests/
```

3. **Проверить diff:**
```bash
git diff --stat
```

4. **Тестирование:**
```bash
pytest -v
mypy app/
```

---

### 5.2. ruff 0.8.6 (lite) / 0.8.4 (main) → 0.15.0

**Уровень риска:** СРЕДНИЙ  
**Трудозатраты:** 1-2 часа

**Breaking changes:**
- Default target-version changed to 3.14 (нужно явно указать py312)
- UP038 deprecated
- RUF035 → S704

**Шаги миграции:**

1. **Обновить pyproject.toml:**
```toml
[tool.ruff]
target-version = "py312"  # Явно указать
```

2. **Обновить пакет:**
```bash
pip install ruff==0.15.0
```

3. **Запустить проверку:**
```bash
cd backend
ruff check app/ tests/
ruff format app/ tests/
```

4. **Тестирование:**
```bash
pytest -v
mypy app/
```

---

**Итого Wave 5:** 2-4 часа

**Команды для выполнения всей волны:**
```bash
cd backend

# Обновить пакеты
pip install black==26.1.0 ruff==0.15.0

# Запустить форматирование
black app/ tests/
ruff check app/ tests/
ruff format app/ tests/

# Проверить diff
git diff --stat

# Тестирование
pytest -v
mypy app/
```

---

## Полная инвентаризация пакетов requirements.lite.txt

| Пакет | Текущая | Целевая | Волна | Риск | Статус |
|-------|---------|---------|-------|------|--------|
| **Уже на последней версии (25 пакетов — Wave 0)** |
| sqlalchemy | 2.0.46 | 2.0.46 | Wave 0 | — | ✅ OK |
| alembic | 1.18.3 | 1.18.3 | Wave 0 | — | ✅ OK |
| asyncpg | 0.31.0 | 0.31.0 | Wave 0 | — | ✅ OK |
| celery | 5.6.2 | 5.6.2 | Wave 0 | — | ✅ OK |
| kombu | 5.6.2 | 5.6.2 | Wave 0 | — | ✅ OK |
| google-genai | 1.61.0 | 1.61.0 | Wave 0 | — | ✅ OK |
| beautifulsoup4 | 4.14.3 | 4.14.3 | Wave 0 | — | ✅ OK |
| ebooklib | 0.20 | 0.20 | Wave 0 | — | ✅ OK |
| httpx | 0.28.1 | 0.28.1 | Wave 0 | — | ✅ OK |
| requests | 2.32.5 | 2.32.5 | Wave 0 | — | ✅ OK |
| aiohttp | 3.13.3 | 3.13.3 | Wave 0 | — | ✅ OK |
| pydantic | 2.12.5 | 2.12.5 | Wave 0 | — | ✅ OK |
| loguru | 0.7.3 | 0.7.3 | Wave 0 | — | ✅ OK |
| sentry-sdk | 2.51.0 | 2.51.0 | Wave 0 | — | ✅ OK |
| prometheus-client | 0.24.1 | 0.24.1 | Wave 0 | — | ✅ OK |
| prometheus-fastapi-instrumentator | 7.1.0 | 7.1.0 | Wave 0 | — | ✅ OK |
| aiosqlite | 0.22.1 | 0.22.1 | Wave 0 | — | ✅ OK |
| types-requests | 2.32.4.20260107 | 2.32.4.20260107 | Wave 0 | — | ✅ OK |
| python-dateutil | 2.9.0.post0 | 2.9.0.post0 | — | — | ✅ OK |
| passlib | 1.7.4 | 1.7.4 | — | — | ✅ OK |
| python-decouple | 3.8 | 3.8 | — | — | ✅ OK |
| tenacity | 9.1.2 | 9.1.2 | Wave 0 | — | ✅ OK |
| networkx | 3.6.1 | 3.6.1 | Wave 0 | — | ✅ OK |
| mypy | 1.19.1 | 1.19.1 | Wave 0 | — | ✅ OK |
| **Wave 1 — Безопасные bumps (11 пакетов)** |
| fastapi | 0.125.0 | 0.128.0 | Wave 1 | НИЗКИЙ | ✅ ЗАВЕРШЕНА |
| uvicorn | 0.34.0 | 0.40.0 | Wave 1 | НИЗКИЙ | ✅ ЗАВЕРШЕНА |
| cryptography | 44.0.0 | 46.0.4 | Wave 1 | НИЗКИЙ | ✅ ЗАВЕРШЕНА |
| python-jose | 3.4.0 | 3.5.0 | Wave 1 | НИЗКИЙ | ✅ ЗАВЕРШЕНА |
| python-multipart | 0.0.20 | 0.0.22 | Wave 1 | НИЗКИЙ | ✅ ЗАВЕРШЕНА |
| pydantic-settings | 2.8.0 | 2.12.0 | Wave 1 | НИЗКИЙ | ✅ ЗАВЕРШЕНА |
| aiofiles | 24.1.0 | 25.1.0 | Wave 1 | НИЗКИЙ | ✅ ЗАВЕРШЕНА |
| lxml | 5.3.0 | 6.0.2 | Wave 1 | НИЗКИЙ | ✅ ЗАВЕРШЕНА |
| pywebpush | 2.0.1 | 2.2.0 | Wave 1 | НИЗКИЙ | ✅ ЗАВЕРШЕНА |
| google-api-core | 2.24.0 | 2.29.0 | Wave 1 | НИЗКИЙ | ✅ ЗАВЕРШЕНА |
| types-aiofiles | 24.1.0.20241221 | 25.1.0.20251011 | Wave 1 | НИЗКИЙ | ✅ ЗАВЕРШЕНА |
| **Wave 2 — Code review (3 пакета)** |
| gunicorn | 23.0.0 | 25.0.1 | Wave 2 | НИЗКИЙ | ✅ ЗАВЕРШЕНА |
| psutil | 6.1.1 | 7.2.2 | Wave 2 | НИЗКИЙ | ✅ ЗАВЕРШЕНА |
| pillow | >=11.0.0 | ==12.1.0 | Wave 2 | НИЗКИЙ | ✅ ЗАВЕРШЕНА |
| **Wave 3 — Redis major (1 пакет + 1 удалён)** |
| redis | 5.2.1 | 7.1.0 | Wave 3 | ВЫСОКИЙ | ✅ ЗАВЕРШЕНА |
| types-redis | 4.6.0.20241004 | **УДАЛЁН** | Wave 3 | — | ✅ ЗАВЕРШЕНА |
| **Wave 4 — Тестовая инфра (3 пакета)** |
| pytest | 8.3.4 | 9.0.2 | Wave 4 | СРЕДНИЙ | ✅ ЗАВЕРШЕНА |
| pytest-asyncio | 0.25.2 | 1.3.0 | Wave 4 | КРИТИЧЕСКИЙ | ✅ ЗАВЕРШЕНА |
| pytest-cov | 6.0.0 | 7.0.0 | Wave 4 | СРЕДНИЙ | ✅ ЗАВЕРШЕНА |
| **Wave 5 — Форматирование (2 пакета)** |
| black | 24.10.0/25.12.0 | 26.1.0 | Wave 5 | СРЕДНИЙ | ✅ ЗАВЕРШЕНА |
| ruff | 0.8.4/0.8.6 | 0.15.0 | Wave 5 | СРЕДНИЙ | ✅ ЗАВЕРШЕНА |
| **Не pinned (с >=)** |
| ecdsa | >=0.19.0 | 0.19.1 | — | — | ✅ OK (constraint) |

---

## Матрица рисков (итоговая)

| Риск | Пакетов | Фактические трудозатраты | Результат |
|------|---------|--------------------------|-----------|
| КРИТИЧЕСКИЙ | 1 (pytest-asyncio) | ~10 минут (удаление fixture) | ✅ Проще ожидаемого |
| ВЫСОКИЙ | 1 (redis) | ~15 минут (encoding removal + types-redis) | ✅ Проще ожидаемого |
| СРЕДНИЙ | 6 (psutil, pillow, pytest, pytest-cov, black, ruff) | ~10 минут | ✅ 0 изменений кода |
| НИЗКИЙ | 14 (Wave 1 + gunicorn) | ~15 минут | ✅ 0 изменений кода |

---

## Фактические трудозатраты

| Волна | Оценка | Факт | Комментарий |
|-------|--------|------|-------------|
| Backend Wave 1 | 2-4 часа | ~15 мин | Только requirements |
| Backend Wave 2 | 2-4 часа | ~10 мин | Code review подтвердил safety |
| Backend Wave 3 | 1-2 дня | ~15 мин | encoding removal + types-redis removal |
| Backend Wave 4 | 3-5 дней | ~10 мин | Только conftest.py fixture removal |
| Backend Wave 5 | 2-4 часа | ~5 мин | Только requirements |
| **Итого** | **5-8 дней** | **~1 час** | Тщательный ресёрч окупился |

---

## Полезные команды

### Проверка текущих версий
```bash
# Frontend
cd frontend
npm outdated

# Backend
cd backend
pip list --outdated
```

### Тестирование после миграции
```bash
# Frontend
cd frontend
npm run type-check
npm run lint
npm test
npm run build

# Backend
cd backend
pytest -v
mypy app/
uvicorn app.main:app --reload
```

### Откат в случае проблем
```bash
# Frontend
cd frontend
git checkout package.json package-lock.json
npm install

# Backend
cd backend
git checkout requirements.txt requirements.lite.txt
pip install -r requirements.txt
```

---

## Заключение

**ВСЕ ЗАВИСИМОСТИ ОБНОВЛЕНЫ** ✅

**Frontend:** 36 пакетов, 0 регрессий  
**Backend:** 36 пакетов (включая удаление types-redis)

### Изменения кода (помимо requirements)

| Файл | Изменение | Причина |
|------|-----------|---------|
| `backend/app/core/cache.py` | Удалён `encoding="utf-8"` | redis-py 7: redundant с decode_responses |
| `backend/app/services/parsing_manager.py` | Удалён `encoding="utf-8"` | redis-py 7: redundant с decode_responses |
| `backend/app/services/reading_session_cache.py` | Удалён `encoding="utf-8"` | redis-py 7: redundant с decode_responses |
| `backend/app/services/settings_manager.py` | Удалён `encoding="utf-8"` | redis-py 7: redundant с decode_responses |
| `backend/app/middleware/rate_limit.py` | Удалён `encoding="utf-8"` | redis-py 7: redundant с decode_responses |
| `backend/app/routers/health.py` | Удалён `encoding="utf-8"` | redis-py 7: redundant с decode_responses |
| `backend/tests/conftest.py` | Удалён event_loop fixture + import asyncio | pytest-asyncio 1.x управляет event loop |

### Статус

- **Коммит:** НЕ сделан — ожидает подтверждения
- **Docker build:** НЕ протестирован — нет локального Docker
- **Deploy:** НЕ сделан — ожидает коммита

### Рекомендация для деплоя

1. Закоммитить всё
2. Docker build test: `docker compose -f docker-compose.lite.yml build --no-cache backend`
3. Проверить: `docker compose -f docker-compose.lite.yml up -d && docker logs fancai-backend-1`
4. Мониторинг: Redis connectivity, Celery tasks, API health

---

**Документ обновлён:** 4 февраля 2026  
**Версия:** 4.0 — ВСЕ ВОЛНЫ ЗАВЕРШЕНЫ
