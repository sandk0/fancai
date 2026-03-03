# Соглашения по написанию кода

**Дата анализа:** 2026-02-27

## Паттерны именования

**Файлы:**
- React-компоненты: PascalCase — `EpubReader.tsx`, `EntityCard.tsx`, `LibraryPage.tsx`
- Хуки: camelCase с префиксом `use` — `useBooks.ts`, `useDescriptionHighlighting.ts`, `useProgressSync.ts`
- Сервисы/утилиты: camelCase — `chapterCache.ts`, `syncQueue.ts`, `cacheManager.ts`
- Python-файлы бэкенда: snake_case — `entity_service.py`, `book_parser.py`, `auth_service.py`
- Тестовые файлы: зеркалят исходный файл в подкаталоге `__tests__/` — `useBooks.ts` → `__tests__/useBooks.test.tsx`
- Тестовые файлы бэкенда: префикс `test_` — `test_auth.py`, `test_chapters.py`

**Функции:**
- TypeScript: camelCase — `getOfflineBooksPlaceholder()`, `switchToFallback()`, `toCachedDescription()`
- Python: snake_case — `get_user_books()`, `check_database()`, `get_active_sessions_stats()`
- Приватные Python-хелперы: префикс с подчёркиванием — `_normalize_name()`, `_build_test_database_url()`, `_get_earliest_cfi()`

**Переменные:**
- TypeScript: camelCase — `queryClient`, `mockBooks`, `testUserId`
- Python: snake_case — `db_session`, `test_book`, `sample_user_data`
- Константы: SCREAMING_SNAKE_CASE — `MAX_CHAPTERS_PER_BOOK`, `STORAGE_KEYS`, `RATE_LIMIT_PRESETS`
- Неиспользуемые параметры/переменные: префикс `_` для линтера — `_rendition`, `_offset`

**Типы:**
- TypeScript-интерфейсы: PascalCase — `BookDetail`, `CacheStats`, `OfflineBookMarker`
- Pydantic-модели (бэкенд): PascalCase — `UserRegistrationRequest`, `LogoutResponse`, `ProblemDetail`
- Переменные обобщённых типов: одна заглавная буква или описательное имя — `T`, `TypeVar`
- Значения enum: SCREAMING_SNAKE_CASE в Python — `BookGenre.FANTASY`

**React-компоненты:**
- Предпочтительны именованные экспорты — `export const EpubReader = ...`
- Экспорт по умолчанию допускается только для страниц — `export default LibraryPage`

## Стиль кода

**Форматирование:**
- TypeScript: конфигурация Prettier не обнаружена — используются правила ESLint и настройки редактора
- Python: конфигурация Black не обнаружена — стандартный PEP 8, отступ 4 пробела
- TypeScript-отступы: 2 пробела (по данным исходного кода)

**Линтинг (TypeScript):**
- Инструмент: `eslint` v9 с `typescript-eslint` — `frontend/eslint.config.js`
- `@typescript-eslint/no-unused-vars`: error (префикс `_` для подавления)
- `@typescript-eslint/no-explicit-any`: warn (разрешено с `ignoreRestArgs: true`)
- `@typescript-eslint/explicit-module-boundary-types`: off
- `react-hooks/exhaustive-deps`: принудительно (пакет правил v7)
- `prefer-const`: warn
- `no-console`: off (console разрешён)

**Линтинг (Python):**
- mypy настроен: `backend/mypy.ini` и `backend/pyrightconfig.json`
- Аннотации типов обязательны для всех функций

## Организация импортов

**Порядок в TypeScript (по наблюдениям):**
1. Внешние библиотеки — `import { describe, it } from 'vitest'`, `import React from 'react'`
2. Сторонние пакеты — `import { QueryClient } from '@tanstack/react-query'`
3. Внутренние алиасы — `import { booksAPI } from '@/api/books'`, `import type { Book } from '@/types/api'`
4. Относительные импорты — `import { createChapterId } from './db'`

**Алиасы путей:**
- `@/` маппится на `frontend/src/` — определено в `frontend/vitest.config.ts` и `frontend/tsconfig.json`
- Используйте `@/` для всех кросс-директорных импортов; относительные только для импортов внутри одного каталога

**Порядок в Python (по наблюдениям):**
1. Стандартная библиотека — `import logging`, `from typing import List, Optional`
2. Сторонние библиотеки — `from fastapi import Depends`, `from sqlalchemy.ext.asyncio import AsyncSession`
3. Внутренние импорты приложения — `from app.models.entity import Entity`, `from app.core.config import settings`
4. Относительные импорты — `from ..core.database import get_database_session`

## Обработка ошибок

**Паттерны фронтенда:**
- Асинхронные операции в хуках: оборачивать в `try/catch`, пробрасывать ошибку после очистки состояния
  ```typescript
  try {
    const response = await authAPI.login({ email, password });
    set({ user, isAuthenticated: true, isLoading: false });
  } catch (error) {
    set({ isLoading: false });
    throw error;  // Пробрасываем, чтобы вызывающий код мог обработать
  }
  ```
- Мутации TanStack Query: ошибка доступна через `result.current.isError` / `result.current.error`
- Паттерн фоллбэка для IndexedDB: `switchToFallback()` в `frontend/src/services/chapterCache.ts`

**Паттерны бэкенда:**
- Использовать `ProblemDetail` (RFC 9457) из `app/core/exceptions.py` для всех HTTP-ошибок
- Выбрасывать `HTTPException` с соответствующими статус-кодами в роутерах
- Использовать `monkeypatch` или `AsyncMock` для имитации ошибок в тестах (а не реальные ошибки)
- Декораторы tenacity для всех вызовов LLM и внешних API: `@retry_api_call`, `@retry_image_generation`, `@retry_llm_extraction` из `app/core/retry.py`
- Всегда разворачивать ответ Gemini API — может быть вложен в ключ `data`

## Логирование

**Фронтенд:**
- Модуль: `frontend/src/lib/logger.ts` — `import { logger } from '@/lib/logger'`
- `logger.debug()` и `logger.info()` — заглушки в продакшен-сборках
- `logger.warn()` и `logger.error()` — всегда активны
- Никогда не использовать `console.log` напрямую — использовать `logger.*`
- Отладочные сообщения используют эмодзи-префиксы (соглашение кодовой базы): `'🧹 Clearing...'`, `'🔐 Login successful'`

**Бэкенд:**
- Стандартный модуль Python `logging`: `logger = logging.getLogger(__name__)`
- Повторные попытки tenacity логируются через `before_sleep_log` и `after_log`

## Комментарии

**Когда комментировать:**
- Модульные docstring: всегда, объяснять назначение файла/модуля
- Сложные алгоритмы: комментировать «почему», а не «что»
- Обходные решения и граничные случаи: пояснять через `# Note:`, `# IMPORTANT:`
- TODO: использовать формат `# TODO:` — отслеживаются в кодовой базе

**JSDoc/TSDoc:**
- Используется для публичных хуков и сервисов с `@module`, `@param`, `@returns`
- Пример из `frontend/src/hooks/api/useBooks.ts`:
  ```typescript
  /**
   * Загрузка offline книг из IndexedDB для placeholderData
   *
   * @param userId - ID пользователя
   * @returns Массив книг из IndexedDB или undefined
   */
  ```

**Python-docstring:**
- Классы и публичные методы: всегда документировать с секциями Attributes и Example
- Пример из `backend/app/schemas/responses/auth.py`:
  ```python
  class LogoutResponse(BaseModel):
      """
      Response после успешного logout.
      Attributes:
          message: Сообщение об успешном выходе
      Example:
          {"message": "Logout successful", "logged_out_at": "..."}
      """
  ```

## Проектирование функций

**TypeScript:**
- Предпочтительны маленькие функции с одной ответственностью, вынесенные в хуки
- Логика EpubReader: всегда выносить в отдельные хуки, никогда не редактировать `EpubReader.tsx` напрямую
- Вспомогательные функции внутри хуков следует выносить при повторном использовании
- Асинхронные функции: всегда `async/await`, никогда «сырые» цепочки `.then()` в коде хуков

**Python:**
- Все функции имеют аннотации типов для параметров и возвращаемых значений
- Методы сервисов принимают внедрённую `AsyncSession` — прямые вызовы БД в роутерах запрещены
- Использовать `selectinload`/`joinedload` явно — модели используют `lazy="raise"` (предотвращение N+1)
- Приватные хелперы: префикс `_`, могут использовать `@lru_cache` для чистых функций

## Проектирование модулей

**TypeScript-экспорты:**
- Хуки: именованные экспорты из файла модуля — `export function useBooks(...)`
- Сервисы: экспорт объектов-синглтонов — `export const chapterCache = new ChapterCacheService()`
- Типы: реэкспорт из barrel-файлов в `frontend/src/types/`
- Без barrel-файлов (`index.ts`) для хуков — импортировать напрямую из файла хука

**Python:**
- SQLAlchemy-модели: `from app.models import User, Book` (barrel-паттерн через `__init__.py`)
- Классы сервисов: создаются на каждый запрос, внедряются через FastAPI `Depends()`
- Паттерн контейнера: `frontend/src/core/container.py` для фабрик внедрения зависимостей

## Соглашения, специфичные для TypeScript

**Паттерны React:**
- Только функциональные компоненты — классовые компоненты запрещены
- Управление состоянием: Zustand для глобального состояния (`frontend/src/stores/`), TanStack Query для серверного состояния
- Прямые вызовы `fetch()` запрещены — все API-вызовы через модули `@/api/`, используя `apiClient`
- Позиции EPUB: всегда использовать CFI-строки, никогда номера страниц
- Zustand-сторы: `create<State>()` с middleware `persist` для авторизации

**Pydantic (бэкенд):**
- Все типы запросов/ответов используют Pydantic v2 `BaseModel`
- Примеры схем задаются через `model_config` / `class Config`
- Модели запросов с суффиксом `Request` — `UserRegistrationRequest`
- Модели ответов с суффиксом `Response` или `Schema` — `LoginResponse`, `EntityDetailSchema`

---

*Анализ соглашений: 2026-02-27*
