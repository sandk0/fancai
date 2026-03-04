#!/bin/bash
# Восстановление PostgreSQL бэкапа с верификацией.
# Использование: bash scripts/backup-restore.sh <backup-file> [test-db-name] [postgres-container]
#
# Бэкап-файлы находятся в /backups/postgres/daily/ на сервере
# или в volume pgbackup_data контейнера fancai_pgbackup.
#
# Пример:
#   bash scripts/backup-restore.sh /backups/postgres/daily/fancai-2026-03-05.sql.gz

set -euo pipefail

BACKUP_FILE="${1:?Usage: backup-restore.sh <backup-file> [test-db-name] [postgres-container]}"
TEST_DB="${2:-fancai_restore_test}"
POSTGRES_CONTAINER="${3:-fancai_postgres}"
POSTGRES_USER="${DB_USER:-fancai}"

echo "=== Восстановление PostgreSQL бэкапа ==="
echo "Файл бэкапа: $BACKUP_FILE"
echo "Тестовая БД: $TEST_DB"
echo "Контейнер: $POSTGRES_CONTAINER"
echo ""

# 1. Удалить тестовую БД если существует
echo "[1/4] Подготовка тестовой БД..."
docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -c "DROP DATABASE IF EXISTS $TEST_DB;" 2>/dev/null
docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -c "CREATE DATABASE $TEST_DB;"
echo "  Тестовая БД $TEST_DB создана"

# 2. Восстановить бэкап
echo "[2/4] Восстановление бэкапа..."
docker exec -i "$POSTGRES_CONTAINER" pg_restore \
    -U "$POSTGRES_USER" -d "$TEST_DB" \
    --no-owner --no-privileges --verbose \
    < "$BACKUP_FILE" 2>&1 | tail -5
echo "  Восстановление завершено"

# 3. Верификация -- count ключевых таблиц
echo "[3/4] Верификация данных..."
ERRORS=0
for TABLE in users books chapters descriptions entities entity_relationships; do
    COUNT=$(docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$TEST_DB" -t -c "SELECT COUNT(*) FROM $TABLE;" 2>/dev/null | tr -d ' ')
    if [ -z "$COUNT" ]; then
        echo "  ОШИБКА: таблица $TABLE не найдена"
        ERRORS=$((ERRORS + 1))
    else
        echo "  $TABLE: $COUNT записей"
    fi
done

# 4. Очистка
echo "[4/4] Очистка тестовой БД..."
docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -c "DROP DATABASE IF EXISTS $TEST_DB;"
echo "  Тестовая БД $TEST_DB удалена"

echo ""
if [ "$ERRORS" -gt 0 ]; then
    echo "=== ОШИБКА: $ERRORS таблиц не найдено ==="
    exit 1
else
    echo "=== Восстановление успешно завершено ==="
fi
