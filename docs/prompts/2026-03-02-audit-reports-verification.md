# Промпт: Глубокий аудит и верификация двух отчётов fancai

**Модель:** Claude Opus 4.6
**Цель:** Выявить ошибки, несоответствия, пропуски и неточности в двух отчётах, подготовить верифицированную базу для плана доработок

---

## Контекст проекта

fancai — приложение для чтения художественной литературы с двумя AI-фичами:

1. Генерация иллюстраций (Gemini извлекает описания → Imagen/FLUX генерирует изображения)
2. Интерактивная энциклопедия/глоссарий персонажей, мест, предметов со спойлер-фильтрацией по главам

**Стек:** React 19 + TypeScript 5.7 + Vite 7 | FastAPI + Python 3.12 + PostgreSQL 17.9 + Redis 7.4 + Celery 5.6
**AI:** Все 5 сервисов мигрированы на OpenRouter (Gemini 3.0 Flash → Claude Haiku 4.5 → Gemini 2.5 Flash Lite fallback). Изображения: FLUX.2 Klein через OpenRouter.
**Инфра:** Docker Compose, Caddy 2.11.1, Hawk Tracker (мониторинг), Prometheus + VictoriaMetrics + Netdata + Uptime Kuma + Dozzle + Flower
**Сервер:** netcup VPS 4000 G12 — 12 vCPU EPYC 9645, 32 GB DDR5, 1 TB NVMe, Debian 13.3 Trixie

---

## Задача

Провести глубокий перекрёстный аудит двух отчётов:

### Отчёт 1: `docs/reports/2026-03-02-pre-deploy-deep-audit.md`

Глубокий аудит кодовой базы и инфраструктуры перед production-деплоем. Содержит верификацию 5 фаз (безопасность, очистка, миграция, инфраструктура, ребрендинг), реестр проблем (5 CRITICAL, 10 HIGH, 9 MEDIUM, 8 LOW), чеклист готовности и порядок исправлений.

### Отчёт 2: `docs/reports/2026-03-02-server-setup-plan.md`

План настройки нового VPS-сервера: 7 фаз (безопасность, ОС, ядро, auto-updates, Docker, проект, деплой). Включает сводку аудитов v1+v2, корректировки, конкретные конфигурации и команды.

---

## Инструкции по аудиту

### 1. Перекрёстная верификация отчётов

Два отчёта описывают одну систему, но с разных точек зрения (код vs сервер). Выявить:

- **Противоречия между отчётами.** Примеры для проверки:
  - Отчёт 1 рекомендует `frame-src 'self' blob:` для CSP (C3). Отчёт 2 в Caddyfile (§6.2) не включает CSP-заголовок вообще — только meta-тег в index.html. Достаточно ли meta-тега? Покрывает ли он все маршруты (/api/_, /storage/_)?
  - Отчёт 1 говорит `shared_buffers=8GB` при контейнере `mem_limit=12GB` (H3). Отчёт 2 рекомендует `shared_buffers=4GB` при `mem_limit=5GB`. Проверить: 4GB shared_buffers + work_mem\*connections + maintenance_work_mem — влезает ли в 5GB cgroup?
  - Отчёт 1 упоминает `effective_cache_size=24GB` как ошибку, рекомендует `8GB`. Отчёт 2 рекомендует `10GB`. Какое значение корректно для 32GB RAM при cgroup 5GB + HugePages?
  - Отчёт 1 рекомендует Celery `broker=os.getenv("CELERY_BROKER_URL", settings.REDIS_URL)`. Отчёт 2 в §6.3 показывает `volatile-lru` и REDIS_URL для Celery. Согласованы ли рекомендации?
  - Сводная таблица ресурсов отчёта 1 (`~17.35GB / 32GB`) расходится с таблицей отчёта 2 (`~16.3GB + 15.7GB ОС`). Пересчитать и указать правильные числа.

- **Пропуски в одном отчёте, найденные в другом.**
  - Отчёт 1 не упоминает HugePages и cgroup v2 — это критично для PG tuning?
  - Отчёт 2 не упоминает CI `build:unsafe` (M8 из отчёта 1)?
  - Отчёт 2 не упоминает `Vite allowedHosts: true` (L4 из отчёта 1)?

### 2. Верификация фактов против кодовой базы

Для каждого утверждения в отчётах проверить:

- **Точность номеров строк.** Строки кода могли сдвинуться. Каждая ссылка вида `file.py:LINE` должна быть проверена.
- **Полнота grep-проверок.** Если отчёт утверждает «Grep: 0 совпадений», действительно ли это так? Примеры:
  - «python-jose отсутствует» — проверить `grep -r "python-jose" backend/` и `grep -r "jose" backend/`
  - «google-genai удалён из requirements.txt» — проверить: а в `requirements.lite.txt` всё ещё есть `google-genai==1.61.0` (строка 33). Отчёт 1 это упоминает (L2), но не как CRITICAL — хотя наличие мёртвой зависимости в файле, который может быть случайно использован, потенциально опасно.

Ключевые файлы для проверки (обязательно прочитать каждый):

- `backend/app/core/celery_app.py` — строки 13-14, как инициализируется broker/backend
- `backend/app/core/config.py` — строки 19-21 (DEBUG), 65-80 (legacy AI settings), 149-188 (validator)
- `docker-compose.prod.yml` — строки 77-107 (backend env), 150-155 (celery-worker), 195-205 (celery-beat), 221 (PG image), 230-245 (PG command), 260-265 (PG resources), 270-275 (Redis command), 306 (network)
- `docker-compose.dev.yml` — строки 233-238 (Redis), сравнить с prod
- `docker-compose.monitoring.yml` — все image tags, порты, auth-настройки
- `frontend/index.html` — строки 11-13 (CSP meta-тег) — полный разбор каждой директивы
- `Caddyfile` — все security headers, routing, HSTS
- `backend/entrypoint.prod.sh` — строки 71-116 (NLP checks)
- `scripts/deploy-production.sh` — строки 10, 83, 173, 258 (nginx/compose references)
- `.github/workflows/ci.yml` — строка 217 (build:unsafe)
- `frontend/vite.config.ts` — строка 72 (allowedHosts)
- `backend/requirements.lite.txt` — строка 33 (google-genai)
- `backend/requirements.txt` — сравнить с lite версией

### 3. Анализ приоритетов

Проверить корректность классификации проблем:

- **Заниженные приоритеты:**
  - `entrypoint.prod.sh` NLP checks (C5 в отчёте 1). Действительно ли это CRITICAL? Они не блокируют запуск, только создают confusing логи. Может быть HIGH?
  - `Dozzle без аутентификации` (C4 в отчёте 1). Если Caddy basicauth стоит перед Dozzle на monitor.fancai.ru, то прямой доступ по порту 8080 — это отдельная проблема (H7). Не дублируются ли C4 и H7?
  - `Flower без пароля` (M2) при открытом порте 5555 (H7) — не должен ли Flower быть HIGH, учитывая что Redis-пароль виден в UI?

- **Завышенные приоритеты:**
  - `Legacy NLP проверки` (C5) — это confusing логи, не data loss/security breach. CRITICAL обычно означает потерю данных или security breach.

- **Пропущенные проблемы:** Проверить, нет ли проблем, которые оба отчёта пропустили:
  - `max_connections=100` в PG prod + `work_mem=64MB` = потенциал 6.4GB. Есть ли PgBouncer или connection pooling?
  - `CORS_ORIGINS` в backend env — корректно ли ограничен?
  - Rate limiting — как настроен, есть ли в Caddy и в backend?
  - VAPID ключи в env — используется ли web push, корректно ли настроен?
  - `POLLINATIONS_ENABLED` в env — что это, актуально ли?

### 4. Технический аудит server-setup-plan.md

Проверить каждую фазу плана настройки сервера:

**Фаза 1 — SSH:**

- Корректен ли KexAlgorithms? Поддерживает ли `mlkem768x25519-sha256` OpenSSH 10.0p1?
- `AllowUsers deploy` — как делать deploy? Docker compose нужно от имени deploy? Есть ли docker group?
- `LogLevel VERBOSE` — на production может генерировать избыточные логи при SSH-атаках. Достаточно ли `INFO`?

**Фаза 1 — nftables:**

- `forward chain: policy accept` — безопасно ли это при Docker? Docker управляет своими forward rules?
- IPv6 SSH ratelimit правило — `ip6 saddr != ::1` — корректен ли синтаксис?
- `flush table inet filter 2>/dev/null || true` — не сломает ли это Docker chains при первом запуске?

**Фаза 3 — Sysctl:**

- `vm.overcommit_memory=1` — безопасно ли для production? Redis требует 1, но PG может пострадать при OOM.
- `vm.nr_hugepages=2200` — пересчитать: 4096MB / 2MB = 2048 страниц. 2200 = +7.4% overhead. Достаточно ли?
- `kernel.panic_on_oops=1` — не слишком ли агрессивно для production? Oops != panic, иногда система восстанавливается.
- `fs.inotify.max_user_watches=524288` — нужно ли столько для production (не dev)?

**Фаза 3 — THP:**

- `disable-thp.service` — Before=docker.service, но After=sysinit.target. Гарантирует ли это отключение THP до запуска PG? Docker может стартовать до sysinit target?

**Фаза 5 — Docker:**

- `icc: false` — inter-container communication disabled. Как контейнеры fancai общаются? Через network aliases? `icc: false` блокирует только default bridge, не user-defined networks?
- `userland-proxy: false` — есть ли известные проблемы с hairpin NAT при localhost access?
- `metrics-addr: 0.0.0.0:9323` — отчёт утверждает, что nftables блокирует доступ. Но Docker NAT обходит INPUT chain (H8 в отчёте 2). Противоречие?

**Фаза 6 — PostgreSQL:**

- `shm_size: 6g` при `shared_buffers=4GB` — зачем 6GB shm? PG shared_buffers не используют /dev/shm в Docker (используют System V shared memory или mmap). Нужен ли shm_size вообще?
- `oom_score_adj: -900` — это Docker compose v2 параметр? Поддерживается ли?
- `effective_cache_size=10GB` — при mem_limit=5GB и shared_buffers=4GB в HugePages. effective_cache_size = total_RAM_for_PG - shared_buffers. Если cgroup=5GB, то 5-4=1GB? Или 32GB total - other services? Объяснить корректный расчёт.
- `max_connections=50` (отчёт 2) vs `max_connections=100` (текущий prod). Какое значение правильнее и почему?
- `work_mem=32MB` (отчёт 2) vs `work_mem=64MB` (текущий prod). Пересчитать worst case.
- `log_min_duration_statement=500` — в миллисекундах. 500ms — нормальный порог для production?

**Фаза 6 — Redis:**

- `volatile-lru` — но все ли cache-ключи имеют TTL? Если нет, volatile-lru не будет их evict'ить вообще, что приведёт к OOM при заполнении maxmemory.
- `save 900 1 300 10 60 10000` + `appendonly yes` — двойная persistence (RDB + AOF). Не избыточно ли?

**Фаза 6 — Caddyfile (план):**

- CSP-заголовок отсутствует в Caddyfile плана. Meta-тег в index.html покрывает только HTML-страницы. API-ответы, ошибки Caddy, storage-файлы не защищены CSP.
- `try_files {path} /index.html` — SPA fallback. Корректен ли для Caddy синтаксис?
- Upload limit `@uploads` matcher после `handle` блоков — обрабатывается ли он корректно?

**Фаза 6 — Ресурсы:**

- Frontend: `CPU 0.5, RAM 256MB`. Если frontend — это build-only контейнер (exits после build), зачем ему ресурсы?
- Celery Worker: `3.0 CPU, 2.5 GB RAM`. Текущий prod: `1.5 CPU, 1.5 GB RAM`. Почему увеличение в 2x?
- Backend: `3.0 CPU, 3 GB RAM`. Текущий prod: `2.0 CPU, 2 GB RAM`. Обоснование?
- Суммарно CPU лимит = 12.8 при 12 vCPU — overcommit на 6.7%. Допустимо ли?

**Фаза 7 — Деплой:**

- Нет миграции данных со старого сервера. Как переносить PostgreSQL dump, uploaded EPUBs, generated images?
- Нет zero-downtime переключения. DNS TTL=300, но propagation может занять часы.
- Нет rollback плана. Что делать, если новый сервер не работает?

### 5. Аудит полноты и качества

- **Метрики покрытия:** Отчёт 1 утверждает «60+ файлов, ~15000 строк». Перечислить, какие критические файлы НЕ были проверены.
- **Качество рекомендаций:** Для каждого фикса оценить:
  - Минимальность изменения (не ломает ли другое)
  - Обратная совместимость (работает ли на dev-машине)
  - Тестируемость (как проверить, что фикс работает)
- **Временные оценки:** Отчёт 1 оценивает «Этап 1: 30 минут» для 5 критических фиксов. Реалистично ли? Учтены ли: тестирование, перезапуск Docker, проверка логов?

---

## Формат вывода

### Структура отчёта аудита

```markdown
# Аудит верификации отчётов fancai

## 1. Критические ошибки в отчётах

(Факты, которые отчёты утверждают неверно)

| #   | Отчёт | Утверждение | Реальность | Влияние |
| --- | ----- | ----------- | ---------- | ------- |

## 2. Противоречия между отчётами

(Где отчёты 1 и 2 дают разные рекомендации)

| #   | Тема | Отчёт 1 | Отчёт 2 | Корректный вариант | Обоснование |
| --- | ---- | ------- | ------- | ------------------ | ----------- |

## 3. Пропущенные проблемы

(Проблемы, найденные при верификации, которых нет ни в одном отчёте)

| #   | Severity | Проблема | Файл | Детали |
| --- | -------- | -------- | ---- | ------ |

## 4. Неверные приоритеты

(Проблемы с завышенным или заниженным приоритетом)

| #   | Текущий | Предлагаемый | Проблема | Обоснование |
| --- | ------- | ------------ | -------- | ----------- |

## 5. Технические ошибки в server-setup-plan.md

(По каждой фазе)

### Фаза N: ...

| #   | Проблема | Строка | Рекомендация |
| --- | -------- | ------ | ------------ |

## 6. Верифицированный реестр проблем

(Итоговый консолидированный реестр из обоих отчётов с корректными приоритетами)

### CRITICAL

### HIGH

### MEDIUM

### LOW

## 7. Рекомендации по обновлению отчётов

(Конкретные правки для каждого отчёта)
```

---

## Правила аудита

1. **Факты, не мнения.** Каждое утверждение подкреплять ссылкой на файл и строку.
2. **Проверять ВСЁ.** Не доверять ни одному утверждению из отчётов без верификации.
3. **Искать пропуски.** Что отчёты НЕ проверили? Какие файлы НЕ были прочитаны?
4. **Перекрёстная проверка.** Если два отчёта дают разные числа — пересчитать.
5. **Практичность.** Каждая рекомендация должна быть actionable. Не «улучшить безопасность», а «добавить строку X в файл Y на строке Z».
6. **Приоритеты по DREAD:**
   - CRITICAL = потеря данных, security breach, приложение полностью не работает
   - HIGH = degraded functionality, значительный security risk, data integrity
   - MEDIUM = tech debt, minor security, operational inconvenience
   - LOW = cleanup, cosmetic, future-proofing
7. **Язык:** Весь отчёт на русском, кроме кода и технических терминов.
