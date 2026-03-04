# Проблемы и технический долг

**Дата анализа:** 2026-03-04

> **Контекст актуализации:** За 1–4 марта 2026 внесены изменения:
> безопасность (IP-whitelist, CSP-исправление), переименование колонки БД
> (`relation_type → type` + добавлен `updated_at` в `entity_relationships`),
> инфраструктурная миграция (nginx → Caddy, docker-compose-lite → prod).
> Документ отражает **текущее состояние**.

---

## Технический долг

### Дублирование слоя генерации изображений

- **Проблема:** Существуют два сервиса генерации: `image_generator.py` (фасад) и `imagen_generator.py` (реальный клиент). `image_generator.py` содержит устаревший docstring «Uses Google Imagen 4» и ссылку на Pollinations.ai («Replaces legacy Pollinations.ai»), хотя оба файла теперь работают через OpenRouter.
- **Файлы:** `backend/app/services/image_generator.py`, `backend/app/services/imagen_generator.py`
- **Влияние:** Запутывает при онбординге и ревью. Нет функциональной регрессии.
- **Способ исправления:** Обновить docstring `image_generator.py`; рассмотреть слияние в один файл.

### Стрелы-зомби: устаревшие упоминания провайдеров

- **Проблема:** В `images.py` (строки 316, 794) значение поля `provider` жёстко задано как `"Google Imagen 4"`, хотя фактически используется FLUX.2 Klein через OpenRouter. `SecurityHeadersMiddleware` разрешает домены `https://generativelanguage.googleapis.com` и `https://*.googleusercontent.com` в CSP `connect-src`/`img-src`, которые более не нужны.
- **Файлы:** `backend/app/routers/images.py:316`, `backend/app/routers/images.py:794`, `backend/app/middleware/security_headers.py:98-114`
- **Влияние:** CSP разрешает лишние домены (расширяет поверхность атаки); ответы API содержат неверную мета-информацию.
- **Способ исправления:** Изменить строку `provider` на `"OpenRouter/FLUX.2 Klein"`. Убрать `*.googleapis.com` / `*.googleusercontent.com` из CSP middleware. (Caddyfile уже корректен — использует `https:` wildcard для img-src.)

### Мертвый код: `vless_http_client.py`

- **Проблема:** `backend/app/services/vless_http_client.py` создан для проксирования запросов к pollinations.ai. Pollinations.ai больше не используется; ни один файл вне самого модуля его не импортирует.
- **Файлы:** `backend/app/services/vless_http_client.py`
- **Влияние:** Мёртвый код увеличивает когнитивную нагрузку и оставляет ссылку на устаревшую инфраструктуру (VLESS-прокси).
- **Способ исправления:** Удалить файл. Проверить, нет ли упоминаний в CI/env.

### Незавершённый рефакторинг: `useBookDescriptions` не подключен к backend

- **Проблема:** Hook `useBookDescriptions` в `frontend/src/hooks/api/useDescriptions.ts:340-370` заглушен — он не вызывает бекенд и возвращает пустой массив. При этом на бекенде уже существует endpoint `POST /api/v1/descriptions/{book_id}/chapters/batch` (`backend/app/routers/descriptions.py:150`).
- **Файлы:** `frontend/src/hooks/api/useDescriptions.ts:340-370`, `backend/app/routers/descriptions.py:150`
- **Влияние:** Функционал «список всех описаний книги» недоступен во фронтенде несмотря на готовый бекенд.
- **Способ исправления:** Реализовать `useBookDescriptions` вызовом `api/descriptions.ts:getBatchDescriptions`.

### TODO: удаление описаний при повторной обработке книги

- **Проблема:** В `books/crud.py:747` закомментирован код удаления существующих описаний перед повторной обработкой. При повторном запуске описания накапливаются, возможны дубли.
- **Файлы:** `backend/app/routers/books/crud.py:747-749`
- **Влияние:** Повторная обработка книги создаёт дублирующиеся описания в БД.
- **Способ исправления:** Раскомментировать / реализовать удаление `Description` по `book_id` перед сбросом флага обработки.

### Стале конфиг: `POLLINATIONS_ENABLED` в dev docker-compose

- **Проблема:** `docker-compose.dev.yml` передаёт переменную `POLLINATIONS_ENABLED=true` бекенду и воркеру (строки 92, 138), хотя Pollinations.ai не используется и эта переменная отсутствует в `Settings`.
- **Файлы:** `docker-compose.dev.yml:92,138`
- **Влияние:** Шум в конфигурации; переменная игнорируется, но вводит в заблуждение.
- **Способ исправления:** Удалить строки с `POLLINATIONS_ENABLED` из dev-compose.

### .env.production содержит заглушечные URL

- **Проблема:** `frontend/.env.production` содержит `VITE_API_BASE_URL=https://api.bookreader.example.com` и другие `*.bookreader.example.com` URL. Реальный продакшн домен — `fancai.ru`.
- **Файлы:** `frontend/.env.production`
- **Влияние:** Если `.env.production` будет использован напрямую при CI/CD сборке без переопределения, фронтенд уйдёт на несуществующий хост.
- **Способ исправления:** Обновить `VITE_API_BASE_URL=https://fancai.ru` (или `https://api.fancai.ru` если backend вынесен на поддомен). Проверить остальные URL.

---

## Известные баги

### Chunk boundary: потеря сущностей на границах чанков

- **Симптомы:** Сущности, упоминаемые на границе двух 100K-символьных чанков, могут не попасть ни в один из результатов LLM-экстракции.
- **Файлы:** `backend/app/services/gemini_extractor.py:233-305`
- **Триггер:** Книги длиннее 100K символов в одной главе; персонаж упоминается в последних строках одного чанка и первых строках следующего.
- **Текущий обходной путь:** 15% overlap (`chunk_overlap_percent=0.15`), но это снижает, не устраняет проблему. Fuzzy matching при сборке mentions (`book_tasks.py:27-53`).
- **Масштаб:** По оценке аудита 2026-02-06 — 15% потерь на границах.

### LLM Dedup: порог 0.85 может пропустить неполные имена

- **Симптомы:** «Гарри» и «Гарри Поттер» не сливаются автоматически, если LLM выставил confidence ниже 0.85.
- **Файлы:** `backend/app/tasks/book_tasks.py:687`
- **Триггер:** Частичные имена для персонажей с длинными именами при невысокой уверенности LLM.
- **Обходной путь:** `find_entity_fuzzy` использует difflib cutoff=0.7 и substring match; но это только для поиска при построении mentions, не для автомерджа.

### `reduce_pass` в `ConsistencyManager` обрезает при >300K символов

- **Симптомы:** Для книг с очень большим числом сущностей Reduce-фаза обрезает список до 300K символов и логирует предупреждение.
- **Файлы:** `backend/app/services/consistency_manager.py:581-585`
- **Триггер:** Книга с >2000 сущностей (крупные серии, многотомники).
- **Обходной путь:** Нет. Лишние сущности не обрабатываются.
- **Нужно:** Реализовать Recursive Reduce (итеративная обработка батчами).

### WebSocket отключён на фронтенде, включён на бекенде

- **Симптомы:** `frontend/src/services/websocket.tsx` помечен `@deprecated DISABLED` — все методы — no-ops. Бекенд endpoint `ws/book-progress/{book_id}` (`backend/app/routers/websocket.py`) полностью реализован с cookie-auth. Прогресс обработки книги доступен только через polling.
- **Файлы:** `frontend/src/services/websocket.tsx`, `frontend/src/components/UI/ParsingOverlay.tsx:87-122`, `backend/app/routers/websocket.py`
- **Влияние:** Лишняя нагрузка от polling; реальный прогресс задерживается.
- **Способ исправления:** Разблокировать `websocket.tsx`, подключить к `/ws/book-progress/{id}` с HttpOnly cookie (бекенд поддерживает).

---

## Вопросы безопасности

### `/health/deep` публично доступен без аутентификации

- **Риск:** `GET /health/deep` (`backend/app/routers/health.py:476`) не требует аутентификации и возвращает детальную информацию о системе: статус PostgreSQL, Redis, Celery, статистику сессий. Caddyfile не ограничивает этот путь.
- **Файлы:** `backend/app/routers/health.py:476-485`, `Caddyfile`
- **Текущая защита:** IP-whitelist в Caddyfile (только `77.246.110.17` имеет доступ к сайту целиком). Это снижает риск для production.
- **Рекомендации:** Добавить `Depends(verify_metrics_auth)` к `deep_health_check` аналогично `/health/metrics`.

### SecurityHeadersMiddleware: CSP не применяется к Caddy-ответам

- **Риск:** `SecurityHeadersMiddleware` добавляет CSP к ответам FastAPI (`/api/*`). Но статика фронтенда отдаётся напрямую Caddy с другим CSP (заданным в `header` блоке Caddyfile:56). Это два разных CSP с разными разрешениями. Middleware-CSP содержит устаревшие Google домены.
- **Файлы:** `backend/app/middleware/security_headers.py:111-115`, `Caddyfile:56`
- **Текущая защита:** Caddyfile CSP актуален; middleware CSP применяется только к API ответам, что менее критично.
- **Рекомендации:** Обновить `connect-src` в `security_headers.py`: заменить `generativelanguage.googleapis.com` на `https://openrouter.ai`.

### CSP nonce не реализован

- **Риск:** В комментарии `security_headers.py:76` указано: «TODO: implement nonce generation». `script-src` разрешает только `'self'` — без `unsafe-inline` и без nonce. Если в будущем потребуется inline-скрипт, придётся добавлять `unsafe-inline`, что ослабит защиту от XSS.
- **Файлы:** `backend/app/middleware/security_headers.py:76-89`
- **Рекомендации:** При необходимости inline-скриптов реализовать per-request nonce.

### Redis DB-сегрегация отсутствует в dev окружении

- **Риск:** `docker-compose.dev.yml` использует `REDIS_URL=redis://redis:6379` без указания DB-номера для Celery broker и result backend. В prod (`docker-compose.prod.yml`) раздельно: DB 0 (cache), DB 1 (broker), DB 2 (results). В dev все три попадают в DB 0 по умолчанию, что теоретически позволяет `flushdb` уничтожить Celery задачи.
- **Файлы:** `docker-compose.dev.yml:82,135`, `docker-compose.prod.yml:91-92`
- **Текущая защита:** Dev-окружение изолировано; `flushdb` разработчиком — редкий сценарий.
- **Рекомендации:** Добавить в dev-compose `CELERY_BROKER_URL=...redis:6379/1` и `CELERY_RESULT_BACKEND=...redis:6379/2`.

---

## Производительность

### `user_statistics_service.py` (864 строки): множественные запросы в цикле

- **Проблема:** Сервис вычисляет агрегированную статистику через серию отдельных DB-запросов без кэширования. При росте числа книг/сессий запросы будут медленнее.
- **Файлы:** `backend/app/services/user_statistics_service.py`
- **Причина:** Сложная бизнес-логика агрегации (время чтения, скорость, streak), не выраженная одним SQL-запросом.
- **Путь улучшения:** Перенести часть агрегации в SQL (window functions), кэшировать в Redis с TTL 5 мин.

### Нет batch endpoint для всех описаний книги (фронтенд)

- **Проблема:** `useBookDescriptions` возвращает `[]` (заглушка). Для загрузки всех описаний книги при необходимости нужно будет делать N запросов по главам. Backend batch endpoint существует.
- **Файлы:** `frontend/src/hooks/api/useDescriptions.ts:340-370`
- **Причина:** Незавершённая интеграция (см. раздел Технический долг).

### `reading_sessions.py` (1088 строк): legacy offset pagination остался

- **Проблема:** Роутер содержит два пути пагинации: cursor-based (новый) и offset-based (legacy, помечен `deprecated`). Offset пагинация выполняет `SELECT id` для подсчёта общего числа записей (`count_result = await db.execute(count_query); total = len(count_result.all())`), что при большой таблице загружает все ID в память.
- **Файлы:** `backend/app/routers/reading_sessions.py:875-895`
- **Путь улучшения:** Заменить на `SELECT COUNT(*)` или удалить legacy-путь.

---

## Хрупкие зоны

### `gemini_extractor.py` (1220 строк): центр обработки, минимум unit-тестов

- **Файлы:** `backend/app/services/gemini_extractor.py`
- **Почему хрупкий:** Реализует extraction, chunking, TSA parsing, fallback chain. Изменение формата ответа OpenRouter ломает весь pipeline. Тесты есть (`tests/services/test_gemini_extractor.py`), но главным образом тестируют вспомогательные методы, а не полный `analyze_chapter()` с реальным LLM.
- **Безопасное изменение:** Всегда добавлять тест перед изменением парсинга ответа. Использовать фикстуры с реальными JSON-ответами.
- **Покрытие:** Частичное; `analyze_chapter()` end-to-end не покрыт тестами.

### `book_tasks.py` (922 строки): нет тестов для основного flow

- **Файлы:** `backend/app/tasks/book_tasks.py`
- **Почему хрупкий:** `process_book_task` — главная задача обработки книги. Нет файла `test_book_tasks.py`. Сложная логика: чанкинг, extraction, entity merging, dedup, synthesis — всё в одном Celery task.
- **Риск:** Регрессии при изменении pipeline не будут пойманы автотестами.
- **Безопасное изменение:** Декомпозировать шаги на отдельные функции, добавить unit-тесты для каждого шага.

### `EpubReader.tsx` (286 строк): самый изменяемый файл

- **Файлы:** `frontend/src/components/Reader/EpubReader.tsx`
- **Почему хрупкий:** 84 коммита — самый часто изменяемый файл. Координирует 25+ хуков. Любое изменение порядка инициализации хуков или зависимостей может нарушить навигацию, сохранение прогресса или подсветку.
- **Покрытие тестами:** `__tests__/EpubReader.test.tsx` (1069 строк) существует.
- **Безопасное изменение:** Выносить новую логику в отдельные хуки в `hooks/epub/`. Не добавлять бизнес-логику напрямую в компонент.

### `description.py` модель: зомби-значение enum в PostgreSQL

- **Файлы:** `backend/app/models/description.py:35-38`
- **Почему хрупкий:** В PostgreSQL enum `descriptiontype` присутствует значение `'OBJECT'` (uppercase) наряду с `'object'` (lowercase). PostgreSQL не поддерживает `DROP VALUE` для enum. Обходной путь через `_missing_` метод в `DescriptionType`. При миграции на другую БД или использовании прямых SQL-запросов возможны ошибки.
- **Безопасное изменение:** Не добавлять новые enum-значения напрямую через ALTER TYPE — только через Alembic-миграцию с проверкой.

### `consistency_manager.py` (697 строк): Reduce без Recursive режима

- **Файлы:** `backend/app/services/consistency_manager.py:581-585`
- **Почему хрупкий:** При превышении 300K символов текст обрезается без фоллбека. Для больших книг это тихое ухудшение качества без явной ошибки.
- **Безопасное изменение:** Перед добавлением новых полей в entity_list_text проверять, что не увеличивается вероятность обрезки.

---

## Пробелы в тестовом покрытии

### Отсутствуют тесты для `book_tasks.py` (основной pipeline)

- **Что не покрыто:** `process_book_task` — весь flow от загрузки книги до entity synthesis.
- **Файлы:** `backend/app/tasks/book_tasks.py` (922 строки)
- **Риск:** Любые изменения pipeline проверяются только вручную.
- **Приоритет:** Высокий

### Слабое покрытие `gemini_extractor.py` конца-конца

- **Что не покрыто:** `analyze_chapter()` с реалистичными LLM-ответами (TSA и Legacy режимы).
- **Файлы:** `backend/app/services/gemini_extractor.py`
- **Риск:** Изменение формата ответа OpenRouter/Gemini ломает extraction без поимки в тестах.
- **Приоритет:** Высокий

### Пропущен тест в `ErrorBoundary`

- **Что не покрыто:** Тест `'respects dark theme from localStorage'` помечен `it.skip` из-за `localStorage timing issues` в тестовом окружении.
- **Файлы:** `frontend/src/components/__tests__/ErrorBoundary.test.tsx:201`
- **Риск:** Низкий (UI edge case).
- **Приоритет:** Низкий

### Производительностные тесты помечены skip

- **Что не покрыто:** `test_jsonb_performance.py` и `performance/test_reading_sessions_load.py` полностью пропущены.
- **Файлы:** `backend/tests/test_jsonb_performance.py:28`, `backend/tests/performance/test_reading_sessions_load.py:32`
- **Риск:** Регрессии производительности под нагрузкой не будут обнаружены.
- **Приоритет:** Средний

---

## Ограничения масштабирования

### Одиночная точка IP-whitelist в Caddyfile

- **Текущее:** `fancai.ru` заблокирован для всех кроме IP `77.246.110.17` (строка 7 Caddyfile).
- **Ограничение:** Платформа фактически однопользовательская. Для расширения до публичного доступа потребуется удалить whitelist и провести полный аудит безопасности (rate limiting, captcha на регистрации, etc.).
- **Масштаб:** Текущая архитектура готова к ~100 concurrent users (32GB RAM, 12 vCPU).

### Celery workers: единый пул без приоритизации тяжёлых задач

- **Текущее:** `task_routes` разделяет задачи на очереди `heavy`/`normal`/`light`, но все workers слушают одну очередь по умолчанию. Если запустить много книг одновременно, воркеры заняты и задачи image generation не обрабатываются.
- **Файлы:** `backend/app/core/celery_app.py:46-53`
- **Путь масштабирования:** Запускать отдельные инстанции воркеров с `--queues heavy` и `--queues normal,light`.

---

## Зависимости с риском

### `google-genai` SDK в requirements (не используется в runtime)

- **Риск:** Если SDK присутствует в зависимостях но не используется — это лишний вес образа и потенциальная поверхность уязвимостей.
- **Проверка:** Убедиться, что `google-generativeai` / `google-genai` удалены из `requirements.txt` и `pyproject.toml` после миграции на OpenRouter.
- **Влияние:** Зависит от наличия в `requirements.txt` (требует проверки).

---

*Аудит проблем: 2026-03-04*
