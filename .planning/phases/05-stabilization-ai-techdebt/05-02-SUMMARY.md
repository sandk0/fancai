---
phase: 05-stabilization-ai-techdebt
plan: 02
subsystem: infra
tags: [postgresql, backup, docker, csp, dead-code-cleanup, openrouter]

# Dependency graph
requires:
  - phase: 03-migration-services
    provides: OpenRouter миграция (LLM + images)
  - phase: 04.1-integration-rebrand
    provides: Ребрендинг fancai
provides:
  - Автоматический ежедневный бэкап PostgreSQL через Docker-контейнер pgbackup
  - Скрипт восстановления бэкапа с верификацией 6 ключевых таблиц
  - Очищенный CSP без устаревших Google-доменов
  - Удалён мёртвый код (vless_http_client.py, POLLINATIONS_ENABLED)
  - Обновлённые provider strings на OpenRouter/FLUX.2 Klein
affects: [06-testing-quality, 07-frontend-polish]

# Tech tracking
tech-stack:
  added: [prodrigestivill/postgres-backup-local:17]
  patterns: [bind-mount volumes для бэкапов, скрипт восстановления с верификацией]

key-files:
  created:
    - scripts/backup-restore.sh
  modified:
    - docker-compose.prod.yml
    - docker-compose.dev.yml
    - backend/app/middleware/security_headers.py
    - backend/app/routers/images.py
    - backend/app/schemas/responses/images.py
    - backend/app/models/image.py
    - backend/app/services/imagen_generator.py
    - backend/app/services/image_generator.py
    - backend/app/core/openrouter_client.py
    - .github/workflows/ci.yml
    - scripts/generate-secrets.sh
    - frontend/.env.production

key-decisions:
  - "prodrigestivill/postgres-backup-local:17 -- зрелый образ для бэкапов PostgreSQL в Docker"
  - "bind-mount volume /backups/postgres для доступа к бэкапам без Docker"
  - "Очищены все Google Imagen 4 упоминания в Python source files (не только images.py)"

patterns-established:
  - "Бэкап-восстановление: скрипт с 4 фазами (подготовка, восстановление, верификация, очистка)"

requirements-completed: [DEPLOY-04]

# Metrics
duration: 8min
completed: 2026-03-04
---

# Phase 5 Plan 02: Бэкап PostgreSQL и очистка техдолга Summary

**Ежедневный бэкап PostgreSQL через pgbackup контейнер с 7-дневной ротацией, скрипт восстановления с верификацией, удалён мёртвый код (vless_http_client.py, POLLINATIONS_ENABLED, Google Imagen 4 references, стале Google-домены в CSP)**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-04T20:26:34Z
- **Completed:** 2026-03-04T20:34:42Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Сервис pgbackup добавлен в docker-compose.prod.yml с ежедневным расписанием и 7-дневной ротацией
- Скрипт backup-restore.sh создан с верификацией 6 ключевых таблиц (users, books, chapters, descriptions, entities, entity_relationships)
- Удалён vless_http_client.py (мёртвый код Pollinations.ai)
- Обновлены все provider strings на "OpenRouter/FLUX.2 Klein" (images.py, schemas, models, services)
- CSP очищен: удалены googleusercontent.com и googleapis.com из img-src/connect-src, добавлен openrouter.ai
- POLLINATIONS_ENABLED удалён из 4 файлов (prod/dev compose, CI, generate-secrets)
- frontend/.env.production обновлён с bookreader.example.com на fancai.ru

## Task Commits

Each task was committed atomically:

1. **Task 1: Автоматический бэкап PostgreSQL через Docker-контейнер + скрипт восстановления** - `1d1101f` (feat)
2. **Task 2: Очистка мёртвого кода** - `d054609` (chore)
3. **Task 2 (доп.): Оставшиеся Google Imagen 4 references** - `6dea09c` (fix)

## Files Created/Modified
- `docker-compose.prod.yml` - Добавлен сервис pgbackup, volume pgbackup_data, удалён POLLINATIONS_ENABLED (2 строки)
- `docker-compose.dev.yml` - Удалён POLLINATIONS_ENABLED (2 строки)
- `scripts/backup-restore.sh` - Новый скрипт восстановления бэкапа с верификацией
- `backend/app/services/vless_http_client.py` - УДАЛЁН (мёртвый код)
- `backend/app/routers/images.py` - Provider strings обновлены на OpenRouter/FLUX.2 Klein
- `backend/app/middleware/security_headers.py` - CSP очищен от Google-доменов, добавлен openrouter.ai
- `backend/app/schemas/responses/images.py` - Дефолтные provider strings обновлены
- `backend/app/models/image.py` - Комментарий enum обновлён
- `backend/app/services/imagen_generator.py` - Docstrings обновлены
- `backend/app/services/image_generator.py` - Docstrings обновлены
- `backend/app/core/openrouter_client.py` - Docstring обновлён
- `.github/workflows/ci.yml` - Удалён POLLINATIONS_ENABLED
- `scripts/generate-secrets.sh` - Удалён POLLINATIONS_ENABLED
- `frontend/.env.production` - URL обновлены на fancai.ru (gitignored)

## Decisions Made
- Использован prodrigestivill/postgres-backup-local:17 -- зрелый Docker образ специально для бэкапов PostgreSQL
- bind-mount volume для /backups/postgres -- бэкапы доступны напрямую из хост-системы без Docker
- Очищены ВСЕ "Google Imagen 4" упоминания в Python source files, а не только те что были в плане (schemas, models, services) -- для консистентности кодовой базы

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Обновлены оставшиеся Google Imagen 4 references в schemas, models, services**
- **Found during:** Task 2 (Очистка мёртвого кода)
- **Issue:** План указал только images.py строки ~316 и ~794, но "Google Imagen 4" также присутствовал в schemas/responses/images.py (3 места), models/image.py (1), imagen_generator.py (2), image_generator.py (2), openrouter_client.py (1)
- **Fix:** Обновлены все дефолтные значения и docstrings на "OpenRouter/FLUX.2 Klein"
- **Files modified:** schemas/responses/images.py, models/image.py, imagen_generator.py, image_generator.py, openrouter_client.py
- **Verification:** `grep -r "Google Imagen 4" backend/app/ --include="*.py"` возвращает 0 результатов
- **Committed in:** `6dea09c`

---

**Total deviations:** 1 auto-fixed (Rule 1 -- stale strings для корректности)
**Impact on plan:** Необходимо для полной очистки кодовой базы от устаревших provider references. Без этого фикса дефолтные значения в API responses показывали бы "Google Imagen 4".

## Issues Encountered
- `frontend/.env.production` gitignored -- файл обновлён локально, но не входит в коммит (ожидаемо, это env-конфиг)
- Backend тесты: 2 pre-existing ошибки (test_langextract_processor.py -- импорт удалённого модуля, test_circuit_breaker.py -- логика CB), не связаны с нашими изменениями. 31 unit test прошли успешно.

## User Setup Required

Перед деплоем на сервер необходимо создать директорию для бэкапов:
```bash
mkdir -p /backups/postgres && chown 999:999 /backups/postgres
```

## Next Phase Readiness
- DEPLOY-04 (стратегия бэкапа БД) выполнен
- Мёртвый код очищен, CSP актуален
- Готово к Phase 6 (тестирование и качество) и Phase 7 (фронтенд)

## Self-Check: PASSED

- FOUND: `.planning/phases/05-stabilization-ai-techdebt/05-02-SUMMARY.md`
- FOUND: `scripts/backup-restore.sh`
- CONFIRMED DELETED: `backend/app/services/vless_http_client.py`
- FOUND commit: `1d1101f` (Task 1)
- FOUND commit: `d054609` (Task 2)
- FOUND commit: `6dea09c` (Task 2 deviation fix)

---
*Phase: 05-stabilization-ai-techdebt*
*Completed: 2026-03-04*
