# fancai — AI-ридер с интерактивной Entity Wiki

## What This Is

Веб-приложение для чтения книг с двумя AI-функциями: интерактивная Entity Wiki (глоссарий персонажей, локаций, объектов со спойлер-защитой по главам) и генерация иллюстраций по найденным в тексте описаниям. Mobile-first PWA с плавными свайпами, follow-finger навигацией и offline-чтением. Приложение стабильно работает в продакшене на fancai.ru.

## Core Value

Пользователь загружает книгу, читает её, получает AI-сгенерированный глоссарий персонажей без спойлеров, видит иллюстрации, делает заметки и выделения — и всё это работает стабильно на любом устройстве.

## Requirements

### Validated

- ✓ Безопасность продакшена (SEC-01..03, DEPLOY-01..08) — v1.0
- ✓ Очистка мёртвого кода NLP (CLEAN-01..05) — v1.0
- ✓ Миграция AI на OpenRouter с fallback chain (MIGR-01..08) — v1.0
- ✓ Мониторинг-стек: Netdata + Uptime Kuma + Dozzle (OPS-01..07) — v1.0
- ✓ Ребрендинг bookreader → fancai (INT-01..05, REBRAND-01..02) — v1.0
- ✓ Circuit breaker + бэкап БД + очистка техдолга (AI-02, DEPLOY-04, UX-06) — v1.0
- ✓ Entity Wiki quality: fuzzy matching, recursive reduce, spoiler tests (WIKI-01..04) — v1.0
- ✓ Обработка ошибок и UX (UX-02..05) — v1.0
- ✓ Ридер: закладки, выделения, поиск, entity-text linking (READ-01..05) — v1.0
- ✓ Follow-finger свайпы + spring physics (NAV-01, NAV-02) — v1.1
- ✓ Стабилизация навигации: race condition fix, lock, debounce (NAV-03, NAV-04, NAV-06) — v1.1
- ✓ Единый FSM gesture controller (NAV-05) — v1.1
- ✓ Мобильный UI: 44px touch targets, auto-hide header, vaul panels, crossfade (MUI-01..06) — v1.1
- ✓ iOS viewport: safe areas, VisualViewport API клавиатура, PWA standalone (VPT-01..03) — v1.1
- ✓ PWA: install banner, offline degradation, SW update, graduated resume, EPUB cache (PWA-01..05) — v1.1
- ✓ Фикс описаний: нормализация спецсимволов, full-mode TreeWalker highlighting (DSC-01) — v1.1

- ✓ Gesture pipeline: свайпы Apple Books 60fps, spring physics, follow-finger (NAV-01..04) — v1.2
- ✓ Адаптивная шапка 320px+, overflow menu, Vaul snap panels (HDR-01, HDR-02, PNL-01, PNL-02) — v1.2
- ✓ Мобильное выделение текста и HighlightTooltip (SEL-01, SEL-02) — v1.2
- ✓ DescriptionDrawer + EntityBottomSheet, edge taps (ENT-01, ENT-02) — v1.2
- ✓ Dead code cleanup ~38KB, BookReaderPage → ReaderPage (CLN-01) — v1.2

- ✓ iOS touch pipeline: полноэкранный overlay с FSM для всех жестов (TOUCH-01, TOUCH-02) — v1.3
- ✓ iOS навигация: shared FSM в gestureUtils.ts, дедупликация ~454 строк (NAV-01..04) — v1.3
- ✓ iOS выделение текста: overlay passthrough при long-press (SEL-01, SEL-02) — v1.3
- ✓ Надёжность генерации изображений: серверный retry (tenacity), раздельный circuit breaker LLM/Image (IMG-01..03) — v1.3
- ✓ Frontend image audit: TQ-based SSoT, IndexedDB metadata, async generation с polling (BUG-01..02, FIMG-01..06) — v1.3

- ✓ Docker и DB инфраструктура для NLP: pgvector, Dockerfile.celery, 4GB Celery, schema migration, feature flags (INFRA-01..05) — v1.4

### Active

## Current Milestone: v1.4 Оптимизация обработки книг

**Goal:** Миграция с all-LLM pipeline на гибридную архитектуру (GLiNER2 + classifier + pgvector + LLM synthesis), снижение стоимости обработки книги с ~$1.50 до ~$0.02-0.05 (97-99%).

**Target features:**
- GLiNER2 NER: локальная entity extraction с точными позициями (бесплатно, 205M params)
- Description classifier: rule-based + TF-IDF/sentence-transformer вместо LLM для описаний
- pgvector embeddings: контекстный поиск для entity synthesis
- LLM synthesis: один batch-вызов на книгу (DeepSeek V3.2 / Gemini 3.1 Flash Lite)
- Feature flags: поэтапный rollout с rollback на текущий pipeline
- Docker: pgvector/pgvector:pg17, Celery worker 4GB RAM, concurrency=1

### Out of Scope

- Платежная система (YooKassa/CloudPayments) — монетизация отложена
- Социальные/community-функции — чтение — занятие уединённое
- Встроенный магазин книг — юридические/лицензионные сложности
- Озвучка текста — лучше обслуживается средствами ОС
- AI-рекомендации книг — проблема холодного старта
- Форматы помимо EPUB/FB2 — EPUB стандарт, Calibre для конвертации
- Совместные аннотации — сначала однопользовательский режим
- Нативное мобильное приложение — web-first подход, PWA покрывает потребности
- 3D curl-анимация — несовместима с epub.js reflowable + iframe
- Pinch-to-zoom — epub.js не поддерживает, нативный zoom ОС достаточен
- Push notifications — не релевантно для ридера книг

## Context

Shipped v1.0 за 9 дней (2026-03-01 → 2026-03-09). 9 фаз, 23 плана, 52 требования.
Shipped v1.1 за 1 день (2026-03-09). 6 фаз, 13 планов, 21 требование. +9674/-2680 строк, 74 файла.
Shipped v1.2 за 4 дня (2026-03-10 → 2026-03-13). 8 фаз, 21 план, 13 требований. +64354/-5565 строк, 350 файлов.
Shipped v1.3 за 9 дней (2026-03-14 → 2026-03-23). 10 фаз, 14 планов, 20 требований. 88 коммитов.

**Текущее состояние кодовой базы:**
- Frontend: ~130K LOC TypeScript/React 19 + Vite 7
- Backend: ~37K LOC Python/FastAPI + PostgreSQL 17 + Redis 7.4 + Celery
- AI: OpenRouter (Gemini 3 Flash + fallback) + FLUX.2 Klein для изображений
- Деплой: Docker Compose + Caddy + auto-HTTPS на fancai.ru

**Известный техдолг:**
- EntityPopup.tsx — orphaned (заменён на EntityBottomSheet, оставлен для reference)
- BookReader.tsx — orphaned dead export (не импортируется production-кодом)
- security_headers.py:76 — TODO: implement nonce generation
- metrics.py:273 — pass в update_active_sessions_gauge (placeholder)
- unawaited onCenterTap на строках 549, 789 useGestureController.ts (cosmetic async inconsistency)
- Pre-existing test failures: ErrorBoundary.test.tsx (7), auth.test.ts (1)
- 18+ визуальных тестов требуют ручной проверки на реальных устройствах
- 3 мобильных бага ожидают UAT на Pixel 9 (Touch to Search, edge taps, annotation timing)

**v2 requirements (backlog):**
- DSC-v2-01: Умный парсинг описаний с начала предложения (NLP sentence boundary, spaCy)
- NAV-v2-01: Настраиваемые зоны тапов
- NAV-v2-02: Haptic feedback при перелистывании

## Key Decisions

| Решение | Обоснование | Результат |
|---------|-------------|-----------|
| Стабильность перед фичами | Пользователь не терпит баги — сначала всё должно работать | ✓ Good |
| NLP код удалён полностью | Мёртвый код увеличивает когнитивную нагрузку | ✓ Good |
| Все AI через OpenRouter | Единый провайдер с fallback chain, удаление google-genai | ✓ Good |
| Caddy вместо nginx | 748 строк → ~80, auto-HTTPS, HTTP/3 | ✓ Good |
| DOM span wrapping вместо epub.js SVG | epub.js annotations не поддерживает background-color | ✓ Good |
| Highlights merged в Bookmarks | Единая модель Notes вместо двух отдельных таблиц | ✓ Good |
| Token overlap >= 0.5 для русских имён | Ловит частичные имена: "Гарри" → "Гарри Поттер" | ✓ Good |
| Recursive batched reduce | BATCH_SIZE=50, MAX_DEPTH=2 для 500+ сущностей без потерь | ✓ Good |
| Ref-based mutex для навигации | useRef вместо useState — zero re-renders на touchmove | ✓ Good |
| FSM gesture controller | 4-state FSM заменил 3 boolean-системы — детерминированный dispatch | ✓ Good |
| CSS transform на wrapper div | Безопасно для epub.js, не затрагивает stage.container | ✓ Good |
| Graduated resume (3 уровня) | <30с pass-through, 30с-5мин soft check, >5мин full reinit | ✓ Good |
| REMOVED_CHARS/EXPANDED_CHARS | Расширяемая нормализация для спецсимволов (soft hyphen, ellipsis) | ✓ Good |
| Immersive mode по умолчанию | Header скрыт — максимум текста на мобильных | ✓ Good |
| Spring stiffness ×2 для быстрого отклика | Пользователь ожидает мгновенный отклик на свайп/тап | ✓ Good |
| Animation toggle в настройках | Возможность отключить анимации для слабых устройств | ✓ Good |
| ResizeObserver disconnect/reconnect | DOM span wrapping вызывает cascade — pause observer, mutate, resume | ✓ Good |
| TreeWalker skip-фильтры для 3 систем | description/entity/annotation spans не пересекаются | ✓ Good |
| selectstart listener вместо CSS | Единственный способ подавить Chrome Touch to Search | ✓ Good |
| hooks.content вместо rendered event | Аннотации применяются ДО рендеринга страницы (epub.js lifecycle) | ✓ Good |
| Vaul bottom sheets для мобильных popup | EntityPopup заменён на EntityBottomSheet — нет позиционирования | ✓ Good |
| elementFromPoint вместо e.target | Стабильное определение интерактивных элементов в edge zones | ✓ Good |
| Shared FSM через dependency injection | Дедупликация ~454 строк, обе платформы используют один код | ✓ Good |
| Раздельный circuit breaker LLM/Image | LLM failures не блокируют image generation | ✓ Good |
| Async generation с TQ polling | Устранение axios timeout при генерации изображений | ✓ Good |

## Constraints

- **Сервер**: 32GB RAM, 12 vCPU, NVMe SSD, PostgreSQL 17, Redis 7.4
- **Стек**: React 19 + TypeScript 5.7+ + Vite 7 / FastAPI + Python 3.12 — менять нельзя
- **AI**: OpenRouter (Gemini 3 Flash + fallback chain) + FLUX.2 Klein. Circuit breaker защищает от каскадных сбоев
- **Домен**: fancai.ru, Москва (Europe/Moscow)
- **Язык контента**: приоритет — русские книги

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-24 after v1.4 milestone start*
