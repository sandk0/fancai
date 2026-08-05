#!/bin/sh
# Production entrypoint for fancai Backend
# Validates environment, then hands off to CMD (gunicorn, celery, alembic, etc.)
#
# Pattern: ENTRYPOINT ["entrypoint.prod.sh"] + CMD ["gunicorn", "-c", "gunicorn.conf.py", "app.main:app"]
# - entrypoint always runs (env validation, startup logging)
# - CMD is overridable at runtime (celery-worker, celery-beat, alembic)
# - exec "$@" ensures proper PID 1 handoff for signal handling

# POSIX sh, а не bash: базовый образ переведён на alpine, где /bin/bash нет.
# `pipefail` убран сознательно — он не в POSIX, а конвейеров в скрипте ни одного.
set -eu

echo "=========================================="
echo "fancai Backend — Starting"
echo "=========================================="

# --- Environment validation (fast, no external calls) ---
# Массив bash и косвенное раскрытие `${!var}` заменены на POSIX-эквивалент.
# `eval` здесь безопасен: имена переменных — литералы из этой же строки,
# в него не попадает ничего извне.
for var in DATABASE_URL REDIS_URL SECRET_KEY; do
    eval "var_value=\${$var:-}"
    if [ -z "$var_value" ]; then
        echo "FATAL: Required environment variable $var is not set" >&2
        exit 1
    fi
done

if [ "${DEBUG:-false}" = "true" ]; then
    echo "WARNING: DEBUG=true in production" >&2
fi

# --- Startup info ---
echo "Workers: ${WORKERS_COUNT:-2}"
echo "Log level: ${LOG_LEVEL:-info}"
echo "Command: $*"
echo "=========================================="

# --- Hand off to CMD ---
# exec replaces this shell with the CMD process,
# so gunicorn/celery becomes PID 1 and receives signals directly.
# DB/Redis readiness handled by docker-compose depends_on + healthchecks.
# Migrations handled by deploy script (docker compose run --rm backend alembic upgrade head).
exec "$@"
