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

### Active

(Нет — планирование следующего milestone)

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

**Текущее состояние кодовой базы:**
- Frontend: ~68K LOC TypeScript/React 19 + Vite 7
- Backend: ~38K LOC Python/FastAPI + PostgreSQL 17 + Redis 7.4 + Celery
- AI: OpenRouter (Gemini 3 Flash + fallback) + FLUX.2 Klein для изображений
- Деплой: Docker Compose + Caddy + auto-HTTPS на fancai.ru

**Известный техдолг:**
- 2 pre-existing сломанных теста (test_langextract_processor.py, test_circuit_breaker.py)
- BookReaderPage.tsx и i18n ключи bookReader.* не переименованы
- security_headers.py:76 — TODO: implement nonce generation
- metrics.py:273 — pass в update_active_sessions_gauge (placeholder)
- getNLPProcessorInfo() — мёртвая функция в admin.ts
- IOSTapZones.tsx — dead code, экспортируется но не импортируется
- useTouchNavigation.ts (18KB) — dead code, не импортируется
- 18 визуальных тестов требуют ручной проверки на реальных устройствах

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

## Constraints

- **Сервер**: 32GB RAM, 12 vCPU, NVMe SSD, PostgreSQL 17, Redis 7.4
- **Стек**: React 19 + TypeScript 5.7+ + Vite 7 / FastAPI + Python 3.12 — менять нельзя
- **AI**: OpenRouter (Gemini 3 Flash + fallback chain) + FLUX.2 Klein. Circuit breaker защищает от каскадных сбоев
- **Домен**: fancai.ru, Москва (Europe/Moscow)
- **Язык контента**: приоритет — русские книги

---
*Last updated: 2026-03-09 after v1.1 milestone completion*
