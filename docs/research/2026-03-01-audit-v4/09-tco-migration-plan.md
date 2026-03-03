# TCO и план миграции

**Дата исследования:** 2026-03-01
**Источник:** Infrastructure Audit v4 — секции 11, 12

---

## Часть 1: TCO пересчёт

### 1.1 Базовые расчёты (50 пользователей, 37.5 книг/мес)

| Статья                      | Текущий                  | OpenRouter Quality-First          | Изменение |
| --------------------------- | ------------------------ | --------------------------------- | --------- |
| LLM extraction (37.5 книг)  | $70.88 (Gemini 3 direct) | $75.19 (Gemini 3 Flash OR + 5.5%) | +6%       |
| Entity synthesis/dedup      | $10.30                   | $10.87                            | +6%       |
| Image generation (2000 img) | $40.00 (Imagen 4 Fast)   | $63.15 (FLUX.2 Pro OR)            | +58%      |
| **AI subtotal**             | **$121.18**              | **$149.21**                       | **+23%**  |
| VPS (новый сервер)          | $35.00                   | $35.00                            | —         |
| Домен                       | $2.00                    | $2.00                             | —         |
| Offsite backup (B2)         | $0.00                    | $0.00                             | —         |
| **ИТОГО**                   | **$158.18/мес**          | **$186.21/мес**                   | **+18%**  |
| **На пользователя**         | **$3.16**                | **$3.72**                         |           |

### 1.2 С оптимизациями

| Оптимизация                                   | Экономия/мес      |
| --------------------------------------------- | ----------------- |
| Prompt caching (75% на cached tokens)         | -$15-20           |
| Image dedup (hash-based, ~30% дубликатов)     | -$19              |
| BYOK Google key (5% вместо 5.5%)              | -$0.75            |
| Free tier на FLUX.2 Klein (25 users × 10 img) | -$3.50            |
| **Итого с оптимизациями**                     | **~$148-153/мес** |

### 1.3 Тарифная стратегия (будущее)

| Тариф             | Пользователей | LLM модель                          | Image модель             | Revenue       |
| ----------------- | ------------- | ----------------------------------- | ------------------------ | ------------- |
| Free              | 25            | Gemini 2.5 Flash Lite ($0.32/книга) | FLUX.2 Klein (10 img)    | $0            |
| Paid ($5/мес)     | 20            | Gemini 3 Flash ($1.90/книга)        | FLUX.2 Pro (100 img)     | $100          |
| Premium ($15/мес) | 5             | Claude Haiku 4.5 ($3.50/книга)      | FLUX.2 Pro+Max (300 img) | $75           |
| **Revenue**       |               |                                     |                          | **$175/мес**  |
| **Cost**          |               |                                     |                          | **~$153/мес** |

---

## Часть 2: План миграции

### Phase 0: Аварийные фиксы (НЕМЕДЛЕННО)

1. **ФИКС БАГ:** `visibility_timeout: 3600 → 14400` в broker_transport_options
2. Удалить `celery_config.py` (мёртвый NLP код)
3. Удалить legacy NLP настройки из `config.py`
4. Добавить бэкап PostgreSQL (15 мин)

### Phase 1: Подготовка нового сервера (1-2 дня)

1. Docker Compose с новыми лимитами (RAM/CPU)
2. PostgreSQL 17 с оптимизированным конфигом
3. Redis 7.4-alpine
4. Caddy вместо 2× nginx
5. Netdata + Uptime Kuma + Dozzle
6. Dockge для UI управления
7. pg_dump автобэкап + offsite (B2/R2)

### Phase 2: Миграция на OpenRouter — LLM (10-14 дней)

1. Shared OpenRouter client wrapper
2. JSON Schema трансформер ($defs inline, nullable fix)
3. Миграция сервисов в порядке: synthesis → consistency → dedup → extractor
4. Интеграционное тестирование на 5-10 книгах
5. Canary deploy (10% трафика через OpenRouter)

### Phase 3: Миграция на OpenRouter — Images (5-7 дней)

1. Оценка FLUX.2 Pro vs Nano Banana на тестовых промптах
2. Переписка `imagen_generator.py` → `openrouter_image_generator.py`
3. Тестирование на реальных книгах
4. Полное переключение

### Phase 4: Оптимизации (параллельно с Phase 2-3)

1. Image dedup (hash-based, Redis Set)
2. Мониторинг расходов через OpenRouter Analytics API
3. Настройка provider routing для стабильного prompt caching
4. Rate limiting на уровне FastAPI (slowapi)
