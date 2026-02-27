# fancai — Production Readiness

## What This Is

Веб-приложение для чтения книг с AI-функциональностью: интерактивная Entity Wiki (глоссарий персонажей, локаций, объектов со спойлер-защитой по главам) и генерация иллюстраций по найденным в тексте описаниям. Приложение работает, но содержит баги, мертвый код, незавершенные функции и проблемы стабильности, которые нужно устранить перед выпуском для реальных пользователей.

## Core Value

Пользователь может загрузить книгу, читать ее, получить AI-сгенерированный глоссарий персонажей без спойлеров и видеть иллюстрации к описаниям — и всё это работает стабильно, без сбоев и визуальных глюков.

## Requirements

### Validated

<!-- Существующий функционал, который уже работает -->

- ✓ Загрузка и парсинг EPUB/FB2 книг — existing
- ✓ Чтение книг в EPUB-ридере с CFI-навигацией — existing
- ✓ AI-извлечение описаний через Gemini 3.0 Flash (TSA и Legacy режимы) — existing
- ✓ AI-извлечение сущностей (персонажи, локации, объекты) — existing
- ✓ Спойлер-защита Entity Wiki по текущей главе — existing
- ✓ Генерация иллюстраций через Imagen 4 — existing
- ✓ Подсветка описаний в тексте (8 стратегий) — existing
- ✓ Регистрация и авторизация (email/password, JWT) — existing
- ✓ Оффлайн кэширование глав (IndexedDB) — existing
- ✓ PWA с Service Worker — existing
- ✓ Прогресс чтения и сессии — existing
- ✓ Библиотека книг пользователя — existing
- ✓ Профиль Entity с описаниями и связями — existing
- ✓ Celery-обработка книг с WebSocket-прогрессом (polling fallback) — existing
- ✓ Админ-панель для управления контентом — existing

### Active

<!-- Текущий скоуп: стабилизация и доведение до продакшена -->

- [ ] Полный аудит фронтенда и бэкенда — выявить все баги и недочеты
- [ ] Исправление всех найденных багов и проблем стабильности
- [ ] Удаление мертвого кода (NLP remnants, TODO-стабы, неиспользуемые конфиги)
- [ ] Исправление security issues (DEBUG default, hardcoded secrets, token expiry)
- [ ] Доработка Entity Wiki до production-качества
- [ ] Доработка парсинга описаний (chunk boundary, fuzzy matching)
- [ ] Полировка пользовательского флоу от загрузки до чтения
- [ ] Стабильная работа на production сервере (fancai.ru)

### Out of Scope

<!-- Явно не входит в этот этап -->

- Платежная система (YooKassa/CloudPayments) — стабы в коде, но монетизация позже
- WebSocket real-time (сейчас polling fallback достаточен) — сложная доработка, не критична
- Закладки и выделения (sync endpoint — TODO-стаб) — дорабатывать позже
- Мобильное приложение — web-first
- OAuth (Google, GitHub) — email/password достаточен для v1
- Gemini Context Caching — оптимизация стоимости, не стабильность
- Масштабирование Celery (concurrency > 1) — хватит для текущей нагрузки

## Context

Проект развивался 5.5 месяцев как pet-проект с активным использованием Claude Code (514 Task calls). За это время:
- NLP-система удалена (Dec 2025), но остатки в коде
- 14 тестовых файлов от NLP всё еще в корне бэкенда
- Некоторые endpoints — TODO-стабы (sync, batch descriptions)
- WebSocket сервис — no-op заглушка на фронте
- Chunk boundary проблема теряет сущности на стыках чанков (15% overlap не гарантирует)
- Fuzzy matching threshold 0.85 — слишком высокий для русских имен
- Password reset URL хардкодит localhost
- Health check — фейковый (возвращает "checking...")
- Два роутера перегружены (images.py, reading_sessions.py)
- Отчет полного аудита: docs/reports/2026-02-06-full-project-audit.md
- Карта кодовой базы: .planning/codebase/

## Constraints

- **Сервер**: 8GB RAM, 4 CPU cores, PostgreSQL 15 (не апгрейдится), Redis 7.4
- **Tech stack**: React 19 + TypeScript 5.7 + Vite 7 / FastAPI + Python 3.11 — менять нельзя
- **AI**: Gemini 3.0 Flash + Imagen 4 — единственные AI-провайдеры
- **Домен**: fancai.ru, Москва (Europe/Moscow timezone)
- **Язык контента**: приоритет — русские книги (важно для fuzzy matching)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Стабильность перед фичами | Пользователь не будет терпеть баги — сначала всё должно работать | — Pending |
| Аудит, затем фиксы | Полная карта проблем перед починкой — чтобы приоритизировать правильно | — Pending |
| NLP код удалить полностью | Мертвый код увеличивает когнитивную нагрузку и путает | — Pending |
| TODO-стабы — пометить/убрать | Сломанные endpoints хуже отсутствующих — они создают иллюзию работы | — Pending |
| Security defaults исправить | DEBUG=True по умолчанию и hardcoded secrets — критичные дыры | — Pending |

---
*Last updated: 2026-02-27 after initialization*
