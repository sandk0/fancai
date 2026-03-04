# Соглашения по коду

**Дата анализа:** 2026-03-04

## Именование

**Файлы (Frontend):**
- React-компоненты: PascalCase (`EpubReader.tsx`, `EntityCard.tsx`, `LibraryPage.tsx`)
- Хуки: camelCase с префиксом `use` (`useDescriptionHighlighting.ts`, `useProgressSync.ts`)
- API-модули: camelCase (`books.ts`, `client.ts`, `readingSessions.ts`)
- Типы: camelCase (`api.ts`, `epub.ts`, `state.ts`)
- Утилиты: kebab-case для директорий, camelCase для файлов (`text-search/normalization.ts`)

**Файлы (Backend):**
- Модули Python: snake_case (`auth_service.py`, `entity_deduplication_service.py`)
- Роутеры: snake_case (`reading_sessions.py`, `books/crud.py`)
- Тесты: `test_` префикс (`test_auth.py`, `test_reading_sessions.py`)

**Переменные и функции:**
- TypeScript: camelCase для переменных и функций (`mockRendition`, `createWrapper`, `setupInterceptors`)
- TypeScript: PascalCase для типов, интерфейсов, классов (`ApiClient`, `UseDescriptionHighlightingOptions`)
- Python: snake_case везде (`get_current_active_user`, `retry_llm_extraction`, `test_start_session_success`)
- Константы: SCREAMING_SNAKE_CASE (`DEBOUNCE_DELAY_MS`, `PRIORITY_THRESHOLD`, `DEFAULT_RETRYABLE_EXCEPTIONS`)

**Типы/классы (Backend):**
- Pydantic-модели: PascalCase (`UserRegistrationRequest`, `DeduplicationResponse`, `MockParsedBook`)
- Исключения: PascalCase с суффиксом Error/Exception (`RateLimitError`, `ProblemDetail`, `LLMExtractionError`)
- Protocol-абстракции: PascalCase с префиксом I (`IBookParser`, `IImageGeneratorService`)

## Стиль кода

**Форматирование (Frontend):**
- Инструмент: ESLint 9.x с typescript-eslint v8
- Конфиг: `frontend/eslint.config.js` (Flat Config формат)
- Правило `no-console`: отключено (проект активно логирует в DEV)
- Правило `@typescript-eslint/no-unused-vars`: error, игнорируются `_`-переменные
- Правило `@typescript-eslint/no-explicit-any`: warn (не error)
- Правило `prefer-const`: warn
- React Hooks (v7): новые правила `set-state-in-effect`, `refs`, `purity`, `use-memo`, `immutability` переведены в warn для постепенного внедрения

**Форматирование (Backend):**
- Конфиг mypy: `backend/mypy.ini`
- Конфиг pyright: `backend/pyrightconfig.json`
- Type hints обязательны на всех функциях

## Организация импортов

**Frontend (TypeScript):**
```typescript
// 1. Сторонние библиотеки
import { useEffect, useCallback, useRef } from 'react';
import { describe, it, expect, vi } from 'vitest';

// 2. Внутренние типы через @-алиас
import type { Rendition } from '@/types/epub';
import type { Description, GeneratedImage } from '@/types/api';

// 3. Внутренние утилиты и сервисы
import { normalizeText } from '@/utils/text-search/normalization';
import { logger } from '@/lib/logger';

// 4. Относительные импорты
import { useDescriptionHighlighting } from '../useDescriptionHighlighting';
```

**Псевдонимы путей:**
- `@/` → `frontend/src/` (настроен в `frontend/vitest.config.ts` и `frontend/tsconfig.json`)

**Backend (Python):**
```python
# 1. Стандартная библиотека
import logging
import re
from typing import List, Dict, Optional

# 2. Сторонние библиотеки
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

# 3. Внутренние модули
from app.models.entity import Entity
from app.core.database import get_database_session
```

## Обработка ошибок

**Frontend:**
- Централизованный API-клиент с axios-интерцепторами (`frontend/src/api/client.ts`)
- Перехват 401: автоматический рефреш токена через HttpOnly cookies
- Логирование: `logger.error()` для всех ошибок, `logger.debug()` только в DEV
- TanStack Query: `retry: false` в тестах, конфигурируемые пресеты в `frontend/src/lib/queryClient.ts`

**Backend:**
- Кастомные исключения через `app/core/exceptions.py` (RFC 9457 формат)
- Базовый класс `ProblemDetail(HTTPException)` — возвращает `{type, title, status, detail}`
- Retry через tenacity: `@retry_api_call`, `@retry_llm_extraction`, `@retry_image_generation` из `app/core/retry.py`
- Все внешние вызовы (LLM, images) обязательно декорируются retry-декоратором

**Паттерны retry (Backend):**
```python
from app.core.retry import retry_api_call, retry_llm_extraction, retry_image_generation

@retry_llm_extraction  # 3 попытки, 1-30s, jitter
async def extract_entities(text: str) -> list:
    ...

@retry_image_generation  # 4 попытки, 2-60s, jitter
async def generate_image(prompt: str) -> bytes:
    ...
```

## Логирование

**Frontend (`frontend/src/lib/logger.ts`):**
```typescript
// logger.debug() и logger.info() — только в DEV-режиме (noop в production)
// logger.warn() и logger.error() — всегда
export const logger = {
  debug: isDev ? console.log.bind(console) : noop,
  info: isDev ? console.info.bind(console) : noop,
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};
```
- Использовать `logger.*` вместо `console.*` напрямую
- Emoji-префиксы в debug-сообщениях: `📡 [API]`, `🌐 [AXIOS]`

**Backend:**
- `logging.getLogger(__name__)` в каждом модуле
- `logger = logging.getLogger(__name__)` — стандартная инициализация
- Мониторинг ошибок: Hawk Tracker (`hawk-python-sdk[fastapi]`)

## Комментарии и документация

**Backend (Python):**
- Docstring обязателен для публичных классов и функций
- Формат: однострочный или многострочный numpy/Google-стиль
- Заголовки секций через `# ============================================================================`

**Frontend (TypeScript):**
- JSDoc-комментарии для сложных хуков и утилит
- Блок комментария в начале тестовых файлов с перечислением тестируемых сценариев
- Инлайн-комментарии для нетривиальной логики (особенно в epub.js и CFI)

## Дизайн модулей

**Frontend:**
- Функциональные компоненты с хуками, class-компоненты запрещены
- TanStack Query для ВСЕХ API-вызовов — прямой `fetch()` не используется
- Zustand для клиентского состояния (3 стора: `stores/auth.ts`, `stores/reader.ts`, `stores/ui.ts`)
- Экспорты: именованные экспорты предпочтительны; default экспорт для компонентов страниц

**Backend:**
- DI через FastAPI `Depends()` и контейнер `app/core/container.py`
- Все сервисы регистрируются через протоколы (IBookParser, IImageGeneratorService)
- SQLAlchemy: `lazy="raise"` на всех моделях — всегда использовать `selectinload`/`joinedload`
- Pydantic v2 для всех запросов и ответов

## Соглашения по коммитам

Формат: `<type>(<scope>): <subject>`

Типы: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `perf`, `style`

Примеры из истории:
```
feat(security): add IP whitelist to fancai.ru
fix(frontend): increase book processing progress timeout from 90s to 180s
fix(db): rename relation_type to type and add updated_at in entity_relationships
fix(security): use handle block for IP whitelist to fix directive ordering
```

## Работа с EPUB и CFI

- CFI (Canonical Fragment Identifiers) — **обязательный** способ отслеживания позиции
- Номера страниц запрещены для навигации
- Подсветка описаний: 8 стратегий поиска в `frontend/src/hooks/epub/useDescriptionHighlighting.ts`
- IndexedDB кеш глав: `frontend/src/services/chapterCache.ts` (Dexie)

## Специфика iOS Safari

- `touch-action: pan-x pan-y` — обязательно для touch-элементов
- `overscroll-behavior: none` — обязательно для скролл-контейнеров
- Safe-area: `env(safe-area-inset-*)` для устройств с notch

---

*Анализ соглашений: 2026-03-04*
