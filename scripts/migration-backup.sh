#!/usr/bin/env bash
# =============================================================================
# fancai — Migration-grade full backup
# =============================================================================
# Создаёт полный point-in-time снэпшот всего стека fancai для миграции на
# идентичный VPS. Дополняет регулярные scripts/backup.sh + pgbackup сервис.
#
# Покрывает:
#   - Application code (git bundle + uncommitted)
#   - Secrets (.env*, ssh keys) — шифруется через age
#   - PostgreSQL (pg_dump custom + pg_dumpall globals + alembic version)
#   - Redis (BGSAVE + RDB)
#   - Storage (books, generated_images) — bind-mount
#   - Docker volumes (caddy_data!, beat_schedule, опционально nlp_models)
#   - Docker images list + compose config (resolved)
#   - System metadata (cron, dpkg, ufw/iptables, /etc/hosts, sshd_config)
#   - Pgbackup local snapshots (вторичная точка восстановления)
#   - Manifest + SHA256 для каждого артефакта
#
# Usage (на сервере):
#   sudo AGE_RECIPIENT=age1xxx... BACKUP_ROOT=/var/backups/fancai-migration \
#       bash /opt/fancai/app/scripts/migration-backup.sh
#
# Опции через env:
#   BACKUP_ROOT           — куда складывать (default /var/backups/fancai-migration)
#   AGE_RECIPIENT         — age public key для шифрования секретов (REQUIRED)
#   INCLUDE_NLP_MODELS    — 1 чтобы включить ~3.16 GB HF cache (default 0)
#   INCLUDE_VM_DATA       — 1 чтобы включить Victoria Metrics (default 0)
#   INCLUDE_NETDATA       — 1 чтобы включить Netdata cache (default 0)
#   INCLUDE_DOCKER_IMAGES — 1 чтобы сохранить custom images через docker save (~2.3 GB) (default 0)
#   POSTGRES_COLD         — 1 чтобы остановить Postgres и tar volume bit-perfect (default 0, downtime ~30s)
#   PROJECT_DIR           — путь к проекту (default /opt/fancai/app)
#   COMPOSE_FILE          — compose файл (default docker-compose.prod.yml)
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Конфигурация
# -----------------------------------------------------------------------------
PROJECT_DIR="${PROJECT_DIR:-/opt/fancai/app}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/fancai-migration}"
TIMESTAMP="$(date -u +%Y%m%d-%H%M)"
WORK="${BACKUP_ROOT}/${TIMESTAMP}"

INCLUDE_NLP_MODELS="${INCLUDE_NLP_MODELS:-0}"
INCLUDE_VM_DATA="${INCLUDE_VM_DATA:-0}"
INCLUDE_NETDATA="${INCLUDE_NETDATA:-0}"
INCLUDE_DOCKER_IMAGES="${INCLUDE_DOCKER_IMAGES:-0}"
POSTGRES_COLD="${POSTGRES_COLD:-0}"

LOG="${WORK}/backup.log"
MANIFEST="${WORK}/MANIFEST.md"
CHECKSUMS="${WORK}/checksums.sha256"

# Цвета
if [[ -t 1 ]]; then
    RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YLW=$'\033[1;33m'; BLU=$'\033[0;34m'; NC=$'\033[0m'
else
    RED=''; GRN=''; YLW=''; BLU=''; NC=''
fi

# -----------------------------------------------------------------------------
# Логирование
# -----------------------------------------------------------------------------
log()      { printf '%s[%s]%s %s\n' "${BLU}" "$(date -u +%FT%TZ)" "${NC}" "$*" | tee -a "${LOG}" >&2; }
log_ok()   { printf '%s[%s]%s %s%s%s\n' "${BLU}" "$(date -u +%FT%TZ)" "${NC}" "${GRN}OK${NC}    " "" "$*" | tee -a "${LOG}" >&2; }
log_warn() { printf '%s[%s]%s %s%s%s\n' "${BLU}" "$(date -u +%FT%TZ)" "${NC}" "${YLW}WARN${NC}  " "" "$*" | tee -a "${LOG}" >&2; }
log_err()  { printf '%s[%s]%s %s%s%s\n' "${BLU}" "$(date -u +%FT%TZ)" "${NC}" "${RED}ERROR${NC} " "" "$*" | tee -a "${LOG}" >&2; }
section()  { log ""; log "═══ $* ═══"; }

trap 'rc=$?; log_err "ABORT (exit=${rc}) at line ${LINENO}: ${BASH_COMMAND}"; exit $rc' ERR

# -----------------------------------------------------------------------------
# Хелперы
# -----------------------------------------------------------------------------
need() { command -v "$1" >/dev/null 2>&1 || { log_err "missing tool: $1"; exit 1; }; }

sha_add() {
    local f="$1"
    if [[ -f "$f" ]]; then
        ( cd "$(dirname "$f")" && sha256sum "$(basename "$f")" ) >> "${CHECKSUMS}"
    fi
}

age_encrypt_into() {
    local out="$1"
    if [[ -z "${AGE_RECIPIENT:-}" ]]; then
        log_err "AGE_RECIPIENT not set — refuse to write secrets in plaintext"
        return 1
    fi
    age -r "${AGE_RECIPIENT}" -o "${out}"
}

vol_tar() {
    local volume="$1"
    local outfile="$2"
    docker run --rm \
        -v "${volume}:/data:ro" \
        -v "$(dirname "${outfile}"):/backup" \
        alpine:3 \
        tar -czf "/backup/$(basename "${outfile}")" -C /data . 2>>"${LOG}"
}

# -----------------------------------------------------------------------------
# Pre-flight
# -----------------------------------------------------------------------------
preflight() {
    section "Pre-flight"

    need docker; need tar; need gzip; need git; need age; need sha256sum; need find

    if [[ ! -d "${PROJECT_DIR}" ]]; then
        log_err "PROJECT_DIR not found: ${PROJECT_DIR}"; exit 1
    fi
    if [[ ! -f "${PROJECT_DIR}/${COMPOSE_FILE}" ]]; then
        log_err "Compose file not found: ${PROJECT_DIR}/${COMPOSE_FILE}"; exit 1
    fi
    if [[ -z "${AGE_RECIPIENT:-}" ]]; then
        log_err "AGE_RECIPIENT env var required (age public key — age1...)"
        log_err "Generate locally: age-keygen -o ~/.age/key.txt"
        log_err "Then pass public key (printed by age-keygen) as AGE_RECIPIENT"
        exit 1
    fi

    # Проверка что в .env есть нужные переменные (без вывода значений)
    if [[ -f "${PROJECT_DIR}/.env" ]]; then
        local missing=()
        for k in DB_USER DB_PASSWORD DB_NAME REDIS_PASSWORD; do
            grep -q "^${k}=" "${PROJECT_DIR}/.env" || missing+=("$k")
        done
        if [[ ${#missing[@]} -gt 0 ]]; then
            log_warn ".env missing keys: ${missing[*]}"
        fi
    else
        log_err "${PROJECT_DIR}/.env not found"; exit 1
    fi

    # Загрузка .env в окружение (только для своих переменных, не пробрасываем дальше)
    set -a
    # shellcheck disable=SC1090
    source "${PROJECT_DIR}/.env"
    set +a

    # Проверка свободного места: нужно минимум 5 GB headroom
    local free_kb
    free_kb="$(df -k "${BACKUP_ROOT%/*}" 2>/dev/null | awk 'NR==2{print $4}' || df -k / | awk 'NR==2{print $4}')"
    local free_gb=$((free_kb / 1024 / 1024))
    if [[ ${free_gb} -lt 5 ]]; then
        log_err "Insufficient disk space: ${free_gb}G free, need ≥5G"; exit 1
    fi
    log_ok "Disk: ${free_gb}G free"

    # Проверка что Docker контейнеры running
    local required=(fancai_postgres fancai_redis fancai_caddy)
    for c in "${required[@]}"; do
        if ! docker ps --format '{{.Names}}' | grep -q "^${c}$"; then
            log_err "Required container not running: ${c}"; exit 1
        fi
    done
    log_ok "All required containers running"

    mkdir -p "${WORK}"/{code,secrets,database,redis,storage,volumes,docker,system,pgbackup}
    : > "${LOG}"
    : > "${CHECKSUMS}"
    log_ok "Workdir: ${WORK}"
}

# -----------------------------------------------------------------------------
# 1. System inventory (read-only метаданные)
# -----------------------------------------------------------------------------
backup_system() {
    section "System inventory"

    {
        echo "# System inventory — fancai-prod"
        echo "Generated: $(date -u +%FT%TZ)"
        echo
        echo "## Identity"
        echo "- hostname: $(hostname)"
        echo "- os: $(. /etc/os-release && echo "${PRETTY_NAME}")"
        echo "- kernel: $(uname -r)"
        echo "- arch: $(uname -m)"
        echo "- timezone: $(timedatectl show --property=Timezone --value 2>/dev/null || cat /etc/timezone)"
        echo "- uptime: $(uptime -p)"
        echo
        echo "## Hardware"
        echo "- CPU: $(lscpu | awk -F: '/Model name/{gsub(/^ +/,"",$2); print $2; exit}')"
        echo "- vCPU: $(nproc)"
        echo "- RAM: $(free -h | awk 'NR==2{print $2}')"
        echo "- Disk root: $(df -h / | awk 'NR==2{printf "%s used / %s total (%s used)", $3, $2, $5}')"
        echo
        echo "## Network"
        ip -4 -br addr show | awk '$1 != "lo"{printf "- %s: %s\n", $1, $3}'
        echo "- public-ipv4: $(curl -s --max-time 5 -4 ifconfig.me 2>/dev/null || echo unknown)"
        echo "- public-ipv6: $(curl -s --max-time 5 -6 ifconfig.me 2>/dev/null || echo unknown)"
        echo
        echo "## Docker"
        echo "- engine: $(docker --version)"
        echo "- compose: $(docker compose version | head -1)"
        echo
        echo "## Postgres"
        echo "- version: $(docker exec fancai_postgres bash -c 'psql -U $POSTGRES_USER -d "${DB_NAME:-postgres}" -tAc "SELECT version()"' 2>/dev/null | head -1 || echo "ERR")"
        echo "- db_name: ${DB_NAME:-?}"
        echo "- db_size: $(docker exec fancai_postgres bash -c 'psql -U $POSTGRES_USER -d "${DB_NAME}" -tAc "SELECT pg_size_pretty(pg_database_size(current_database()))"' 2>/dev/null || echo "ERR")"
        echo "- alembic_version: $(docker exec fancai_postgres bash -c 'psql -U $POSTGRES_USER -d "${DB_NAME}" -tAc "SELECT version_num FROM alembic_version"' 2>/dev/null || echo "ERR")"
        echo "- extensions:"
        docker exec fancai_postgres bash -c 'psql -U $POSTGRES_USER -d "${DB_NAME}" -tAc "SELECT extname || \" \" || extversion FROM pg_extension"' 2>/dev/null \
            | sed 's/^/  - /' || echo "  - ERR"
        echo
        echo "## Public DNS"
        for q in A AAAA MX TXT NS; do
            echo "- ${q}:"
            dig +short "${q}" fancai.ru @1.1.1.1 2>/dev/null | sed 's/^/  - /'
        done
    } > "${WORK}/system/inventory.md" 2>&1 || true

    # Сохраняем raw данные для потом
    crontab -l > "${WORK}/system/crontab-deploy.txt" 2>/dev/null || echo "(no crontab)" > "${WORK}/system/crontab-deploy.txt"
    if sudo -n true 2>/dev/null; then
        sudo crontab -l > "${WORK}/system/crontab-root.txt" 2>/dev/null || echo "(no root crontab)" > "${WORK}/system/crontab-root.txt"
        sudo iptables-save 2>/dev/null > "${WORK}/system/iptables.txt" || echo "(no iptables-save)" > "${WORK}/system/iptables.txt"
        sudo grep -vE '^(#|$)' /etc/ssh/sshd_config 2>/dev/null > "${WORK}/system/sshd_config.txt" || echo "(no access)" > "${WORK}/system/sshd_config.txt"
        sudo fail2ban-client status 2>/dev/null > "${WORK}/system/fail2ban-status.txt" || true
        ls /etc/cron.d/ /etc/cron.daily/ /etc/cron.hourly/ /etc/cron.weekly/ /etc/cron.monthly/ 2>/dev/null > "${WORK}/system/cron-dirs.txt" || true
    else
        log_warn "no passwordless sudo — system data будет неполным"
    fi
    dpkg -l > "${WORK}/system/dpkg-list.txt" 2>/dev/null || true
    systemctl list-unit-files --state=enabled --no-pager > "${WORK}/system/systemd-enabled.txt" 2>/dev/null || true
    ip addr > "${WORK}/system/ip-addr.txt"
    ip route > "${WORK}/system/ip-route.txt"
    cat /etc/hosts > "${WORK}/system/etc-hosts.txt"
    cat /etc/resolv.conf > "${WORK}/system/etc-resolv.txt" 2>/dev/null || true

    log_ok "System inventory written"
}

# -----------------------------------------------------------------------------
# 2. Application code
# -----------------------------------------------------------------------------
backup_code() {
    section "Application code"
    cd "${PROJECT_DIR}"

    # Git bundle: все ветки + теги + stash
    git bundle create "${WORK}/code/repo.bundle" --all
    log_ok "git bundle: $(du -h "${WORK}/code/repo.bundle" | cut -f1)"

    # Stash entries как отдельный bundle (если есть)
    if [[ -n "$(git stash list)" ]]; then
        git stash list > "${WORK}/code/stash-list.txt"
        log_ok "stash list: $(wc -l <"${WORK}/code/stash-list.txt") entries"
    fi

    # Diff vs HEAD (для удобства чтения)
    git diff > "${WORK}/code/working-tree.diff" || true
    git status --porcelain > "${WORK}/code/git-status.txt" || true

    # Working tree (включая uncommitted)
    # Исключаем тяжёлое: .git, node_modules, backend/storage (бэкапим отдельно), backups, logs
    tar --warning=no-file-changed --exclude='./.git' --exclude='./node_modules' \
        --exclude='./backend/node_modules' --exclude='./frontend/node_modules' \
        --exclude='./backend/storage' --exclude='./backups' --exclude='./logs' \
        --exclude='./backend/.venv' --exclude='./backend/.pytest_cache' \
        --exclude='*.pyc' --exclude='__pycache__' \
        -czf "${WORK}/code/working-tree.tar.gz" -C "${PROJECT_DIR}" . 2>>"${LOG}" || true
    log_ok "working tree: $(du -h "${WORK}/code/working-tree.tar.gz" | cut -f1)"

    git rev-parse HEAD > "${WORK}/code/git-head.txt"
    git remote -v > "${WORK}/code/git-remotes.txt"
    git log --oneline -20 > "${WORK}/code/git-recent-commits.txt"

    sha_add "${WORK}/code/repo.bundle"
    sha_add "${WORK}/code/working-tree.tar.gz"
}

# -----------------------------------------------------------------------------
# 3. Secrets (encrypted)
# -----------------------------------------------------------------------------
backup_secrets() {
    section "Secrets (encrypted with age)"
    cd "${PROJECT_DIR}"

    # .env файлы и templates
    local files=(.env)
    [[ -f .env.production ]] && files+=(.env.production)
    [[ -f backend/.env.production ]] && files+=(backend/.env.production)
    [[ -f frontend/.env.production ]] && files+=(frontend/.env.production)

    tar -cf - "${files[@]}" 2>/dev/null | age_encrypt_into "${WORK}/secrets/env-bundle.tar.age"
    log_ok "env-bundle.tar.age: $(du -h "${WORK}/secrets/env-bundle.tar.age" | cut -f1) (${#files[@]} files)"
    sha_add "${WORK}/secrets/env-bundle.tar.age"

    # SSH-настройки текущего пользователя (опционально, если хотим сохранить authorized_keys)
    if [[ -d "${HOME}/.ssh" ]]; then
        tar -cf - -C "${HOME}" .ssh 2>/dev/null | age_encrypt_into "${WORK}/secrets/ssh-${USER}.tar.age"
        log_ok "ssh-${USER}.tar.age: $(du -h "${WORK}/secrets/ssh-${USER}.tar.age" | cut -f1)"
        sha_add "${WORK}/secrets/ssh-${USER}.tar.age"
    fi
}

# -----------------------------------------------------------------------------
# 4. PostgreSQL
# -----------------------------------------------------------------------------
backup_postgres() {
    section "PostgreSQL"

    # Basics: используем env контейнера для credentials
    docker exec fancai_postgres bash -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -F custom -Z 9 --no-owner --no-acl' \
        > "${WORK}/database/dump.custom" 2>>"${LOG}"
    log_ok "pg_dump custom: $(du -h "${WORK}/database/dump.custom" | cut -f1)"

    # Plain SQL копия (для grep/inspect — опционально, можно убрать для экономии места)
    docker exec fancai_postgres bash -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl' \
        | gzip -9 > "${WORK}/database/dump.sql.gz" 2>>"${LOG}"
    log_ok "pg_dump plain: $(du -h "${WORK}/database/dump.sql.gz" | cut -f1)"

    # Globals (роли, tablespaces)
    docker exec fancai_postgres bash -c 'pg_dumpall -U "$POSTGRES_USER" --globals-only' \
        > "${WORK}/database/globals.sql" 2>>"${LOG}"
    log_ok "globals.sql: $(du -h "${WORK}/database/globals.sql" | cut -f1)"

    # Метаданные
    {
        echo "# Postgres metadata"
        docker exec fancai_postgres bash -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT version()"'
        echo "Database: $(docker exec fancai_postgres bash -c 'echo $POSTGRES_DB')"
        echo
        echo "## Extensions"
        docker exec fancai_postgres bash -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT extname || \"|\" || extversion FROM pg_extension"' \
            | tr '|' ' '
        echo
        echo "## Alembic version"
        docker exec fancai_postgres bash -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT version_num FROM alembic_version"'
        echo
        echo "## Database size"
        docker exec fancai_postgres bash -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT pg_size_pretty(pg_database_size(current_database()))"'
        echo
        echo "## Table sizes (top 20)"
        docker exec fancai_postgres bash -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid)) FROM pg_class c LEFT JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = '\''r'\'' AND n.nspname NOT IN ('\''pg_catalog'\'', '\''information_schema'\'') ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 20"'
    } > "${WORK}/database/metadata.txt" 2>&1 || true

    # Optional: cold tar volume (bit-perfect)
    if [[ "${POSTGRES_COLD}" == "1" ]]; then
        log_warn "POSTGRES_COLD=1 — stopping postgres for tar snapshot (downtime ~30s)"
        cd "${PROJECT_DIR}"
        docker compose -f "${COMPOSE_FILE}" stop postgres
        vol_tar "app_postgres_data" "${WORK}/database/postgres_data.tar.gz"
        docker compose -f "${COMPOSE_FILE}" start postgres
        sleep 5
        log_ok "postgres_data.tar.gz: $(du -h "${WORK}/database/postgres_data.tar.gz" | cut -f1)"
        sha_add "${WORK}/database/postgres_data.tar.gz"
    fi

    sha_add "${WORK}/database/dump.custom"
    sha_add "${WORK}/database/dump.sql.gz"
    sha_add "${WORK}/database/globals.sql"
}

# -----------------------------------------------------------------------------
# 5. Redis
# -----------------------------------------------------------------------------
backup_redis() {
    section "Redis"

    # Используем пароль из .env, который мы уже загрузили в env shell-а
    local pwd_arg=()
    if [[ -n "${REDIS_PASSWORD:-}" ]]; then
        pwd_arg=(-a "${REDIS_PASSWORD}" --no-auth-warning)
    fi

    # Зафиксируем LASTSAVE до BGSAVE
    local before_save
    before_save="$(docker exec fancai_redis redis-cli "${pwd_arg[@]}" LASTSAVE 2>/dev/null || echo 0)"

    docker exec fancai_redis redis-cli "${pwd_arg[@]}" BGSAVE >/dev/null 2>&1 || {
        log_warn "BGSAVE failed, falling back to SAVE"
        docker exec fancai_redis redis-cli "${pwd_arg[@]}" SAVE >/dev/null 2>&1
    }

    # Ждём пока LASTSAVE изменится (max 60s)
    for i in {1..60}; do
        local now
        now="$(docker exec fancai_redis redis-cli "${pwd_arg[@]}" LASTSAVE 2>/dev/null || echo 0)"
        if [[ "${now}" != "${before_save}" ]]; then
            break
        fi
        sleep 1
    done

    docker cp fancai_redis:/data/dump.rdb "${WORK}/redis/dump.rdb" 2>>"${LOG}"
    # AOF (если есть)
    docker cp fancai_redis:/data/appendonly.aof "${WORK}/redis/appendonly.aof" 2>/dev/null \
        || docker cp fancai_redis:/data/appendonlydir "${WORK}/redis/appendonlydir" 2>/dev/null \
        || log_warn "AOF data not found (may be acceptable)"

    gzip -9 "${WORK}/redis/dump.rdb"
    log_ok "redis dump.rdb.gz: $(du -h "${WORK}/redis/dump.rdb.gz" | cut -f1)"

    # Метаданные
    {
        echo "# Redis info"
        docker exec fancai_redis redis-cli "${pwd_arg[@]}" INFO server 2>/dev/null | head -10
        echo
        echo "## DB sizes"
        for db in 0 1 2; do
            echo "DB ${db}: $(docker exec fancai_redis redis-cli "${pwd_arg[@]}" -n ${db} DBSIZE 2>/dev/null)"
        done
    } > "${WORK}/redis/metadata.txt" 2>&1 || true

    sha_add "${WORK}/redis/dump.rdb.gz"
}

# -----------------------------------------------------------------------------
# 6. Storage (bind mount)
# -----------------------------------------------------------------------------
backup_storage() {
    section "Storage (books, images, covers)"
    cd "${PROJECT_DIR}"

    if [[ ! -d backend/storage ]]; then
        log_warn "backend/storage не найдена, пропускаем"
        return
    fi

    # books (включая covers внутри books/covers/)
    if [[ -d backend/storage/books ]]; then
        tar --warning=no-file-changed -czf "${WORK}/storage/books.tar.gz" -C backend/storage books 2>>"${LOG}"
        log_ok "books.tar.gz: $(du -h "${WORK}/storage/books.tar.gz" | cut -f1)"
        sha_add "${WORK}/storage/books.tar.gz"
    fi

    # generated_images
    if [[ -d backend/storage/generated_images ]]; then
        tar --warning=no-file-changed -czf "${WORK}/storage/generated_images.tar.gz" -C backend/storage generated_images 2>>"${LOG}"
        log_ok "generated_images.tar.gz: $(du -h "${WORK}/storage/generated_images.tar.gz" | cut -f1)"
        sha_add "${WORK}/storage/generated_images.tar.gz"
    fi

    # На всякий случай — любые другие подпапки storage
    for sub in backend/storage/*/; do
        local name
        name="$(basename "${sub}")"
        case "${name}" in
            books|generated_images) continue ;;
        esac
        tar --warning=no-file-changed -czf "${WORK}/storage/${name}.tar.gz" -C backend/storage "${name}" 2>>"${LOG}" || continue
        log_ok "${name}.tar.gz: $(du -h "${WORK}/storage/${name}.tar.gz" | cut -f1)"
        sha_add "${WORK}/storage/${name}.tar.gz"
    done

    # Inventory: список файлов с размерами
    {
        echo "# Storage inventory"
        echo "Generated: $(date -u +%FT%TZ)"
        echo
        echo "## Sizes"
        du -sh backend/storage/* 2>/dev/null
        echo
        echo "## File counts"
        echo "books (epub): $(find backend/storage/books -maxdepth 1 -type f 2>/dev/null | wc -l)"
        echo "covers: $(find backend/storage/books/covers -type f 2>/dev/null | wc -l)"
        echo "generated_images: $(find backend/storage/generated_images -type f 2>/dev/null | wc -l)"
    } > "${WORK}/storage/inventory.md"
}

# -----------------------------------------------------------------------------
# 7. Docker volumes (named)
# -----------------------------------------------------------------------------
backup_volumes() {
    section "Docker volumes"

    # Critical для миграции
    vol_tar "app_caddy_data" "${WORK}/volumes/caddy_data.tar.gz"
    log_ok "caddy_data.tar.gz: $(du -h "${WORK}/volumes/caddy_data.tar.gz" | cut -f1)"
    sha_add "${WORK}/volumes/caddy_data.tar.gz"

    vol_tar "app_caddy_config" "${WORK}/volumes/caddy_config.tar.gz"
    sha_add "${WORK}/volumes/caddy_config.tar.gz"

    vol_tar "app_beat_schedule" "${WORK}/volumes/beat_schedule.tar.gz"
    log_ok "beat_schedule.tar.gz: $(du -h "${WORK}/volumes/beat_schedule.tar.gz" | cut -f1)"
    sha_add "${WORK}/volumes/beat_schedule.tar.gz"

    # Monitoring volumes (полезно для непрерывности мониторинга)
    if [[ "${INCLUDE_VM_DATA}" == "1" ]] && docker volume inspect app_vm_data >/dev/null 2>&1; then
        vol_tar "app_vm_data" "${WORK}/volumes/vm_data.tar.gz"
        log_ok "vm_data.tar.gz: $(du -h "${WORK}/volumes/vm_data.tar.gz" | cut -f1)"
        sha_add "${WORK}/volumes/vm_data.tar.gz"
    fi
    if [[ "${INCLUDE_VM_DATA}" == "1" ]] && docker volume inspect app_kuma_data >/dev/null 2>&1; then
        vol_tar "app_kuma_data" "${WORK}/volumes/kuma_data.tar.gz"
        sha_add "${WORK}/volumes/kuma_data.tar.gz"
    fi
    if [[ "${INCLUDE_NETDATA}" == "1" ]] && docker volume inspect app_netdataconfig >/dev/null 2>&1; then
        vol_tar "app_netdataconfig" "${WORK}/volumes/netdataconfig.tar.gz"
        vol_tar "app_netdatalib" "${WORK}/volumes/netdatalib.tar.gz"
        sha_add "${WORK}/volumes/netdataconfig.tar.gz"
        sha_add "${WORK}/volumes/netdatalib.tar.gz"
    fi

    # Опционально: nlp_models
    if [[ "${INCLUDE_NLP_MODELS}" == "1" ]] && docker volume inspect app_nlp_models >/dev/null 2>&1; then
        log_warn "INCLUDE_NLP_MODELS=1 — это ~3.16 GB"
        vol_tar "app_nlp_models" "${WORK}/volumes/nlp_models.tar.gz"
        log_ok "nlp_models.tar.gz: $(du -h "${WORK}/volumes/nlp_models.tar.gz" | cut -f1)"
        sha_add "${WORK}/volumes/nlp_models.tar.gz"
    else
        log "skipping nlp_models (INCLUDE_NLP_MODELS=${INCLUDE_NLP_MODELS}); will be re-downloaded on first celery run"
    fi
}

# -----------------------------------------------------------------------------
# 8. Pgbackup local snapshots (вторичная точка восстановления)
# -----------------------------------------------------------------------------
backup_pgbackup() {
    section "Pgbackup local archive"

    if [[ -d /backups/postgres ]]; then
        sudo -n tar -czf "${WORK}/pgbackup/pgbackup-archive.tar.gz" -C /backups postgres 2>>"${LOG}" \
            || tar -czf "${WORK}/pgbackup/pgbackup-archive.tar.gz" -C /backups postgres 2>>"${LOG}" || true
        if [[ -f "${WORK}/pgbackup/pgbackup-archive.tar.gz" ]]; then
            log_ok "pgbackup-archive.tar.gz: $(du -h "${WORK}/pgbackup/pgbackup-archive.tar.gz" | cut -f1)"
            sha_add "${WORK}/pgbackup/pgbackup-archive.tar.gz"
        else
            log_warn "pgbackup tar failed (no sudo?)"
        fi
    else
        log_warn "/backups/postgres не найден"
    fi
}

# -----------------------------------------------------------------------------
# 9. Docker images & compose config
# -----------------------------------------------------------------------------
backup_docker_meta() {
    section "Docker metadata"
    cd "${PROJECT_DIR}"

    docker images --format 'table {{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}' > "${WORK}/docker/images-list.txt"

    # Auto-detect какие compose-файлы РЕАЛЬНО запустили контейнеры через labels
    # (на fancai-prod это обычно prod.yml + monitoring.yml с project=app)
    {
        echo "# Compose files detected from running containers"
        for c in $(docker ps --format '{{.Names}}' | grep '^fancai_'); do
            local proj cfg
            proj="$(docker inspect "$c" --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null)"
            cfg="$(docker inspect "$c" --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' 2>/dev/null)"
            printf '%-30s project=%s config=%s\n' "$c" "$proj" "$cfg"
        done
    } > "${WORK}/docker/compose-detection.txt"

    # Уникальные пары (project,config_files), использованные при up
    local detected_files
    detected_files="$(awk '{ for(i=1;i<=NF;i++) if($i ~ /^config=/) sub(/^config=/, "", $i) && print $i }' \
        "${WORK}/docker/compose-detection.txt" | sort -u | tr '\n' ' ')"
    log "Compose files detected: ${detected_files}"

    # Записываем resolved-config для того набора, что реально использовался
    local cfg_args=()
    for f in ${detected_files}; do
        if [[ -f "${PROJECT_DIR}/${f##*/}" ]]; then
            cfg_args+=(-f "${PROJECT_DIR}/${f##*/}")
        fi
    done

    if [[ ${#cfg_args[@]} -gt 0 ]]; then
        # COMPOSE_PROJECT_NAME=app фиксирует префикс volume — критично для restore!
        ( cd "${PROJECT_DIR}" && COMPOSE_PROJECT_NAME=app docker compose "${cfg_args[@]}" config ) \
            > "${WORK}/docker/compose-config-resolved-full.yml" 2>>"${LOG}" \
            || log_warn "Full compose config (multi-file) failed"
        log_ok "compose-config-resolved-full.yml ($(wc -l <"${WORK}/docker/compose-config-resolved-full.yml") lines)"
    fi

    # Также резервный вариант: только prod.yml на случай если детекция сломается
    docker compose -f "${COMPOSE_FILE}" config 2>/dev/null > "${WORK}/docker/compose-config-resolved-prod-only.yml" || \
        log_warn "compose config (prod-only) failed"

    # Скопируем сами raw compose-файлы для удобства restore
    for f in docker-compose.prod.yml docker-compose.monitoring.yml docker-compose.dev.yml; do
        [[ -f "${PROJECT_DIR}/${f}" ]] && cp "${PROJECT_DIR}/${f}" "${WORK}/docker/${f}"
    done
    [[ -f "${PROJECT_DIR}/Caddyfile" ]] && cp "${PROJECT_DIR}/Caddyfile" "${WORK}/docker/Caddyfile"

    # Зафиксируем COMPOSE_PROJECT_NAME для restore
    {
        echo "# Compose project context (для restore)"
        echo "COMPOSE_PROJECT_NAME=app"
        echo "PROJECT_DIR=${PROJECT_DIR}"
        echo "WORKING_DIR_LABEL=$(docker inspect fancai_postgres --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' 2>/dev/null)"
        echo "PRIMARY_COMPOSE=docker-compose.prod.yml"
        echo "OVERLAY_COMPOSE=docker-compose.monitoring.yml"
        echo "STARTUP_COMMAND='cd /opt/fancai/app && COMPOSE_PROJECT_NAME=app docker compose -f docker-compose.prod.yml -f docker-compose.monitoring.yml up -d'"
    } > "${WORK}/docker/compose-context.env"

    docker network ls > "${WORK}/docker/networks.txt"
    docker volume ls > "${WORK}/docker/volumes.txt"

    if [[ "${INCLUDE_DOCKER_IMAGES}" == "1" ]]; then
        log_warn "INCLUDE_DOCKER_IMAGES=1 — saving custom images (~2.3 GB total)"
        docker save fancai-backend:latest fancai-celery:latest fancai-frontend:latest 2>/dev/null \
            | gzip -3 > "${WORK}/docker/custom-images.tar.gz" || \
            log_warn "docker save failed (may need sudo)"
        if [[ -f "${WORK}/docker/custom-images.tar.gz" ]]; then
            log_ok "custom-images.tar.gz: $(du -h "${WORK}/docker/custom-images.tar.gz" | cut -f1)"
            sha_add "${WORK}/docker/custom-images.tar.gz"
        fi
    fi
}

# -----------------------------------------------------------------------------
# 10. Manifest + finalize
# -----------------------------------------------------------------------------
finalize() {
    section "Manifest & checksums"

    {
        echo "# Migration backup manifest"
        echo
        echo "**Created:** $(date -u +%FT%TZ)"
        echo "**Source:** $(hostname) ($(curl -s --max-time 5 -4 ifconfig.me 2>/dev/null || echo unknown))"
        echo "**Project:** ${PROJECT_DIR} @ $(cd "${PROJECT_DIR}" && git rev-parse --short HEAD)"
        echo "**Generator:** $(basename "$0")"
        echo
        echo "## Components"
        echo "| Component | Path | Size |"
        echo "|-----------|------|------|"
        find "${WORK}" -mindepth 2 -maxdepth 3 -type f \
            \( -name "*.tar.gz" -o -name "*.gz" -o -name "*.dump" -o -name "*.bundle" \
               -o -name "*.age" -o -name "*.sql" -o -name "*.txt" -o -name "*.yml" \
               -o -name "*.md" -o -name "*.diff" \) \
            | sort | while read -r f; do
                local rel="${f#${WORK}/}"
                local sz
                sz="$(du -h "${f}" | cut -f1)"
                echo "| ${rel} | \`${rel}\` | ${sz} |"
            done
        echo
        echo "## Total"
        echo "- Total size: $(du -sh "${WORK}" | cut -f1)"
        echo "- File count: $(find "${WORK}" -type f | wc -l)"
        echo
        echo "## Restore order"
        echo "1. Decrypt secrets/env-bundle.tar.age → .env"
        echo "2. Restore code: \`git clone code/repo.bundle .\` + extract working-tree.diff"
        echo "3. Start postgres+redis: \`docker compose up -d postgres redis\`"
        echo "4. Restore Postgres: \`pg_restore database/dump.custom\`"
        echo "5. Restore Redis: copy redis/dump.rdb to fancai_redis:/data/"
        echo "6. Extract storage: tar xzf storage/*.tar.gz → backend/storage/"
        echo "7. Restore caddy_data: docker run --rm -v app_caddy_data:/d -v backup:/b alpine tar xzf /b/caddy_data.tar.gz -C /d"
        echo "8. Start full stack: \`docker compose -f docker-compose.prod.yml up -d\`"
        echo "9. Update DNS A-record fancai.ru to new server IP"
        echo
        echo "## Verify"
        echo '```bash'
        echo "sha256sum -c checksums.sha256"
        echo "pg_restore --list database/dump.custom | head"
        echo "tar -tzf storage/books.tar.gz | head"
        echo '```'
    } > "${MANIFEST}"

    log_ok "manifest: ${MANIFEST}"

    # Pack everything except already-encrypted secrets
    section "Final packaging"
    local final_archive="${BACKUP_ROOT}/fancai-migration-${TIMESTAMP}.tar"
    tar -cf "${final_archive}" -C "${BACKUP_ROOT}" "${TIMESTAMP}"
    sha256sum "${final_archive}" > "${final_archive}.sha256"
    log_ok "final archive: ${final_archive} ($(du -h "${final_archive}" | cut -f1))"
    log_ok "final sha256: $(cat "${final_archive}.sha256")"

    section "Done"
    log_ok "Backup completed: ${WORK}"
    log_ok "Total: $(du -sh "${WORK}" | cut -f1)"
    log "Next steps:"
    log "  1. Verify: sha256sum -c \"${WORK}/checksums.sha256\""
    log "  2. Off-site: aws s3 cp \"${final_archive}\" s3://your-bucket/fancai/${TIMESTAMP}/"
    log "  3. Local copy: scp \"${final_archive}\" your-laptop:~/fancai-backups/"
    log "  4. Test restore: см. docs/operations/migration/04-MIGRATION_RUNBOOK.md"
}

# -----------------------------------------------------------------------------
# main
# -----------------------------------------------------------------------------
main() {
    preflight
    backup_system
    backup_code
    backup_secrets
    backup_postgres
    backup_redis
    backup_storage
    backup_volumes
    backup_pgbackup
    backup_docker_meta
    finalize
}

main "$@"
