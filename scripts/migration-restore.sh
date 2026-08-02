#!/usr/bin/env bash
# =============================================================================
# fancai — Migration restore
# =============================================================================
# Восстанавливает полный стек fancai на чистом VPS из migration backup.
#
# Pre-requisites:
#   - Чистый VPS с теми же характеристиками (Debian 13 x86_64, 32 GB RAM)
#   - Установленные: docker, docker compose, git, age, curl, tar
#   - Архив migration-backup рядом
#   - age private key (передан off-band владельцем)
#
# Usage:
#   sudo BACKUP_ARCHIVE=fancai-migration-20260510-1430.tar \
#        AGE_IDENTITY=/root/.age/key.txt \
#        TARGET_DIR=/opt/fancai/app \
#        bash migration-restore.sh
#
# Опции через env:
#   BACKUP_ARCHIVE  — путь к .tar архиву (REQUIRED)
#   AGE_IDENTITY    — путь к age private key файлу (REQUIRED)
#   TARGET_DIR      — куда деплоить (default /opt/fancai/app)
#   COMPOSE_FILE    — compose файл (default docker-compose.prod.yml)
#   SKIP_DNS_CHECK  — 1 чтобы пропустить проверку DNS (default 0)
# =============================================================================

set -euo pipefail

BACKUP_ARCHIVE="${BACKUP_ARCHIVE:-}"
AGE_IDENTITY="${AGE_IDENTITY:-}"
TARGET_DIR="${TARGET_DIR:-/opt/fancai/app}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE_FILE_MONITORING="${COMPOSE_FILE_MONITORING:-docker-compose.monitoring.yml}"
RESTORE_MONITORING="${RESTORE_MONITORING:-1}"   # 1 = поднимать оба стека (как было), 0 = только prod
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-app}"   # фиксирует префикс volume → app_postgres_data, app_caddy_data, ...
export COMPOSE_PROJECT_NAME
SKIP_DNS_CHECK="${SKIP_DNS_CHECK:-0}"

# Сборка аргументов compose: prod.yml (+ monitoring.yml если включён)
compose_args() {
    local args=(-f "${COMPOSE_FILE}")
    if [[ "${RESTORE_MONITORING}" == "1" ]] && [[ -f "${TARGET_DIR}/${COMPOSE_FILE_MONITORING}" ]]; then
        args+=(-f "${COMPOSE_FILE_MONITORING}")
    fi
    printf '%s\n' "${args[@]}"
}

WORK_RESTORE="/tmp/fancai-restore-$(date +%s)"
LOG="${WORK_RESTORE}.log"

if [[ -t 1 ]]; then
    RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YLW=$'\033[1;33m'; BLU=$'\033[0;34m'; NC=$'\033[0m'
else
    RED=''; GRN=''; YLW=''; BLU=''; NC=''
fi

log()      { printf '%s[%s]%s %s\n' "${BLU}" "$(date -u +%FT%TZ)" "${NC}" "$*" | tee -a "${LOG}" >&2; }
log_ok()   { printf '%s[%s]%s %sOK%s    %s\n' "${BLU}" "$(date -u +%FT%TZ)" "${NC}" "${GRN}" "${NC}" "$*" | tee -a "${LOG}" >&2; }
log_warn() { printf '%s[%s]%s %sWARN%s  %s\n' "${BLU}" "$(date -u +%FT%TZ)" "${NC}" "${YLW}" "${NC}" "$*" | tee -a "${LOG}" >&2; }
log_err()  { printf '%s[%s]%s %sERROR%s %s\n' "${BLU}" "$(date -u +%FT%TZ)" "${NC}" "${RED}" "${NC}" "$*" | tee -a "${LOG}" >&2; }
section()  { log ""; log "═══ $* ═══"; }
need()     { command -v "$1" >/dev/null 2>&1 || { log_err "missing tool: $1"; exit 1; }; }
ask()      { local p="$1"; read -rp "${YLW}${p}${NC} (yes/no): " r; [[ "${r,,}" == "yes" ]]; }

trap 'rc=$?; log_err "ABORT (exit=${rc}) at line ${LINENO}: ${BASH_COMMAND}"; exit $rc' ERR

# -----------------------------------------------------------------------------
# Pre-flight
# -----------------------------------------------------------------------------
preflight() {
    section "Pre-flight checks"

    need docker; need tar; need git; need age; need sha256sum
    docker compose version >/dev/null 2>&1 || { log_err "docker compose plugin missing"; exit 1; }

    [[ -n "${BACKUP_ARCHIVE}" && -f "${BACKUP_ARCHIVE}" ]] || { log_err "BACKUP_ARCHIVE not set or file missing"; exit 1; }
    [[ -n "${AGE_IDENTITY}" && -f "${AGE_IDENTITY}" ]] || { log_err "AGE_IDENTITY not set or file missing"; exit 1; }

    log_ok "Backup archive: ${BACKUP_ARCHIVE} ($(du -h "${BACKUP_ARCHIVE}" | cut -f1))"

    # SHA256 verify (если есть .sha256 рядом)
    if [[ -f "${BACKUP_ARCHIVE}.sha256" ]]; then
        sha256sum -c "${BACKUP_ARCHIVE}.sha256"
        log_ok "Archive sha256 verified"
    else
        log_warn ".sha256 рядом не найден — пропускаем верификацию"
    fi

    # Architecture check
    local arch
    arch="$(uname -m)"
    if [[ "${arch}" != "x86_64" ]]; then
        log_warn "Architecture is ${arch}, source backup is x86_64"
        log_warn "Custom Docker images могут не запуститься — нужен rebuild"
        if ! ask "Continue anyway?"; then exit 0; fi
    fi

    mkdir -p "${WORK_RESTORE}"
    : > "${LOG}"
}

# -----------------------------------------------------------------------------
# Extract
# -----------------------------------------------------------------------------
extract_archive() {
    section "Extract backup archive"

    tar -xf "${BACKUP_ARCHIVE}" -C "${WORK_RESTORE}"
    local extracted_dir
    extracted_dir="$(find "${WORK_RESTORE}" -mindepth 1 -maxdepth 1 -type d | head -1)"
    [[ -d "${extracted_dir}" ]] || { log_err "extracted directory not found"; exit 1; }
    BACKUP_DIR="${extracted_dir}"

    log_ok "Extracted to: ${BACKUP_DIR}"

    # Verify per-file checksums
    if [[ -f "${BACKUP_DIR}/checksums.sha256" ]]; then
        ( cd "${BACKUP_DIR}" && sha256sum -c checksums.sha256 ) | tail -5
        log_ok "Per-file checksums verified"
    fi

    # Show manifest
    if [[ -f "${BACKUP_DIR}/MANIFEST.md" ]]; then
        head -30 "${BACKUP_DIR}/MANIFEST.md"
    fi
}

# -----------------------------------------------------------------------------
# Restore code
# -----------------------------------------------------------------------------
restore_code() {
    section "Restore code"

    if [[ -d "${TARGET_DIR}" ]] && [[ -n "$(ls -A "${TARGET_DIR}" 2>/dev/null)" ]]; then
        log_warn "TARGET_DIR ${TARGET_DIR} not empty"
        if ! ask "Wipe and re-deploy?"; then exit 0; fi
        rm -rf "${TARGET_DIR}"
    fi
    mkdir -p "${TARGET_DIR}"

    # Способ 1: clone из bundle
    git clone "${BACKUP_DIR}/code/repo.bundle" "${TARGET_DIR}"
    cd "${TARGET_DIR}"

    # Чекаут точного коммита из бэкапа
    if [[ -f "${BACKUP_DIR}/code/git-head.txt" ]]; then
        local target_commit
        target_commit="$(cat "${BACKUP_DIR}/code/git-head.txt")"
        git checkout "${target_commit}" 2>/dev/null || git checkout main
    fi

    # Применяем uncommitted (если был diff)
    if [[ -s "${BACKUP_DIR}/code/working-tree.diff" ]]; then
        if ! git apply --check "${BACKUP_DIR}/code/working-tree.diff" 2>/dev/null; then
            log_warn "working-tree.diff не применяется чисто — извлекаем из tar"
            tar -xzf "${BACKUP_DIR}/code/working-tree.tar.gz" -C "${TARGET_DIR}" \
                --exclude='.git'
        else
            git apply "${BACKUP_DIR}/code/working-tree.diff"
        fi
    fi

    # Восстанавливаем remote
    if [[ -f "${BACKUP_DIR}/code/git-remotes.txt" ]]; then
        git remote remove origin 2>/dev/null || true
        local origin_url
        origin_url="$(awk '/^origin/ && /\(fetch\)/{print $2}' "${BACKUP_DIR}/code/git-remotes.txt" | head -1)"
        if [[ -n "${origin_url}" ]]; then
            git remote add origin "${origin_url}"
            log_ok "git remote origin: ${origin_url}"
        fi
    fi

    log_ok "Code restored to ${TARGET_DIR}"
}

# -----------------------------------------------------------------------------
# Restore secrets
# -----------------------------------------------------------------------------
restore_secrets() {
    section "Restore secrets"

    age -d -i "${AGE_IDENTITY}" "${BACKUP_DIR}/secrets/env-bundle.tar.age" \
        | tar -xf - -C "${TARGET_DIR}"
    chmod 600 "${TARGET_DIR}/.env" 2>/dev/null || true
    log_ok ".env restored ($(wc -l < "${TARGET_DIR}/.env") lines)"

    # SSH (опционально, если бэкапили)
    if [[ -f "${BACKUP_DIR}/secrets/ssh-deploy.tar.age" ]]; then
        if ask "Restore SSH config to current user's home?"; then
            age -d -i "${AGE_IDENTITY}" "${BACKUP_DIR}/secrets/ssh-deploy.tar.age" \
                | tar -xf - -C "${HOME}"
            chmod 700 "${HOME}/.ssh"
            chmod 600 "${HOME}/.ssh"/* 2>/dev/null || true
            log_ok "SSH config restored"
        fi
    fi
}

# -----------------------------------------------------------------------------
# Bring up services
# -----------------------------------------------------------------------------
start_data_services() {
    section "Starting Postgres + Redis"
    cd "${TARGET_DIR}"
    log "Using COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME} (volume prefix: ${COMPOSE_PROJECT_NAME}_)"

    # Только prod.yml на этом этапе — поднимаем data-сервисы
    docker compose -f "${COMPOSE_FILE}" up -d postgres redis
    log "Waiting for postgres healthy..."
    for i in {1..60}; do
        if docker exec fancai_postgres pg_isready 2>/dev/null | grep -q "accepting connections"; then
            log_ok "postgres ready"; break
        fi
        sleep 2
    done
    sleep 3
}

# -----------------------------------------------------------------------------
# Restore Postgres
# -----------------------------------------------------------------------------
restore_postgres() {
    section "Restore Postgres"

    if [[ ! -f "${BACKUP_DIR}/database/dump.custom" ]]; then
        log_err "dump.custom not found"; exit 1
    fi

    # Проверка alembic version из бэкапа
    if [[ -f "${BACKUP_DIR}/database/metadata.txt" ]]; then
        log "Source metadata excerpt:"
        grep -A1 "Alembic version" "${BACKUP_DIR}/database/metadata.txt" || true
    fi

    # Restore через pg_restore (с --clean --if-exists для idempotency)
    log "Streaming pg_restore from dump.custom..."
    docker exec -i fancai_postgres bash -c \
        'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-acl' \
        < "${BACKUP_DIR}/database/dump.custom"

    # Restore globals (роли)
    if [[ -f "${BACKUP_DIR}/database/globals.sql" ]]; then
        docker exec -i fancai_postgres bash -c 'psql -U "$POSTGRES_USER" -d postgres' \
            < "${BACKUP_DIR}/database/globals.sql" 2>&1 \
            | grep -v "already exists" | grep -v "permission denied" || true
    fi

    # Verify
    local count_users count_books
    count_users="$(docker exec fancai_postgres bash -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM users"' 2>/dev/null || echo 0)"
    count_books="$(docker exec fancai_postgres bash -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM books"' 2>/dev/null || echo 0)"
    log_ok "Postgres restored: ${count_users} users, ${count_books} books"
}

# -----------------------------------------------------------------------------
# Restore Redis
# -----------------------------------------------------------------------------
restore_redis() {
    section "Restore Redis"

    if [[ ! -f "${BACKUP_DIR}/redis/dump.rdb.gz" ]]; then
        log_warn "dump.rdb.gz not found, пропускаем"
        return
    fi

    docker compose -f "${COMPOSE_FILE}" stop redis
    sleep 2

    # Извлечь и положить в volume
    local tmp_rdb="${WORK_RESTORE}/dump.rdb"
    gunzip -c "${BACKUP_DIR}/redis/dump.rdb.gz" > "${tmp_rdb}"
    docker run --rm -v app_redis_data:/data -v "$(dirname "${tmp_rdb}"):/src" \
        alpine:3 sh -c 'cp /src/dump.rdb /data/dump.rdb && chown 999:999 /data/dump.rdb'

    # AOF (если был)
    if [[ -d "${BACKUP_DIR}/redis/appendonlydir" ]]; then
        docker run --rm -v app_redis_data:/data -v "${BACKUP_DIR}/redis/appendonlydir:/src:ro" \
            alpine:3 sh -c 'cp -r /src /data/appendonlydir && chown -R 999:999 /data/appendonlydir'
    fi

    docker compose -f "${COMPOSE_FILE}" start redis
    sleep 5

    # Verify
    local key_count
    key_count="$(docker exec fancai_redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning DBSIZE 2>/dev/null' || echo 0)"
    log_ok "Redis restored, DB 0 keys: ${key_count}"
}

# -----------------------------------------------------------------------------
# Restore storage
# -----------------------------------------------------------------------------
restore_storage() {
    section "Restore storage"

    mkdir -p "${TARGET_DIR}/backend/storage"
    for f in "${BACKUP_DIR}"/storage/*.tar.gz; do
        [[ -f "${f}" ]] || continue
        log "Extracting $(basename "${f}")..."
        tar -xzf "${f}" -C "${TARGET_DIR}/backend/storage"
    done

    # Owner: backend container runs as UID 1000 typically
    # Adjust if your image differs
    chown -R 1000:1000 "${TARGET_DIR}/backend/storage" 2>/dev/null || \
        log_warn "Could not chown storage to 1000:1000 — check container UID"

    local total
    total="$(du -sh "${TARGET_DIR}/backend/storage" 2>/dev/null | cut -f1)"
    log_ok "Storage restored: ${total}"
}

# -----------------------------------------------------------------------------
# Restore volumes (caddy_data!)
# -----------------------------------------------------------------------------
restore_volumes() {
    section "Restore Docker volumes"

    # Создаём volumes если не существуют
    for v in app_caddy_data app_caddy_config app_beat_schedule; do
        docker volume create "${v}" >/dev/null 2>&1 || true
    done

    # caddy_data (КРИТИЧНО: содержит ACME account + certificates)
    if [[ -f "${BACKUP_DIR}/volumes/caddy_data.tar.gz" ]]; then
        docker run --rm -v app_caddy_data:/data \
            -v "${BACKUP_DIR}/volumes:/backup:ro" \
            alpine:3 sh -c 'cd /data && tar -xzf /backup/caddy_data.tar.gz'
        log_ok "caddy_data restored — Let's Encrypt rate-limit safe"
    else
        log_warn "caddy_data.tar.gz not in backup! Caddy will request new cert (rate-limit risk)"
    fi

    if [[ -f "${BACKUP_DIR}/volumes/caddy_config.tar.gz" ]]; then
        docker run --rm -v app_caddy_config:/data \
            -v "${BACKUP_DIR}/volumes:/backup:ro" \
            alpine:3 sh -c 'cd /data && tar -xzf /backup/caddy_config.tar.gz'
    fi

    if [[ -f "${BACKUP_DIR}/volumes/beat_schedule.tar.gz" ]]; then
        docker run --rm -v app_beat_schedule:/data \
            -v "${BACKUP_DIR}/volumes:/backup:ro" \
            alpine:3 sh -c 'cd /data && tar -xzf /backup/beat_schedule.tar.gz'
        log_ok "beat_schedule restored"
    fi

    # nlp_models (опционально, иначе будет качать ~10 минут при первом запуске)
    if [[ -f "${BACKUP_DIR}/volumes/nlp_models.tar.gz" ]]; then
        docker volume create app_nlp_models >/dev/null 2>&1 || true
        docker run --rm -v app_nlp_models:/data \
            -v "${BACKUP_DIR}/volumes:/backup:ro" \
            alpine:3 sh -c 'cd /data && tar -xzf /backup/nlp_models.tar.gz'
        log_ok "nlp_models restored (skip HF re-download)"
    fi

    # Monitoring volumes
    for vname in vm_data kuma_data netdataconfig netdatalib; do
        local f="${BACKUP_DIR}/volumes/${vname}.tar.gz"
        if [[ -f "${f}" ]]; then
            docker volume create "app_${vname}" >/dev/null 2>&1 || true
            docker run --rm -v "app_${vname}:/data" \
                -v "${BACKUP_DIR}/volumes:/backup:ro" \
                alpine:3 sh -c "cd /data && tar -xzf /backup/${vname}.tar.gz"
            log_ok "${vname} restored"
        fi
    done
}

# -----------------------------------------------------------------------------
# Final stack startup
# -----------------------------------------------------------------------------
start_full_stack() {
    section "Starting full stack"
    cd "${TARGET_DIR}"
    log "Using COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME}"

    # Собрать массив аргументов compose для всех нужных файлов
    mapfile -t cargs < <(compose_args)
    log "Compose files: ${cargs[*]}"

    # Build custom images заново (если их нет в backup)
    if ! docker image inspect fancai-backend:latest >/dev/null 2>&1; then
        log "Building custom images (это займёт 5-15 минут)..."
        docker compose "${cargs[@]}" build
    fi

    # Поднимаем весь стек (prod + monitoring если RESTORE_MONITORING=1)
    docker compose "${cargs[@]}" up -d

    log "Waiting 30 seconds for services to stabilize..."
    sleep 30

    docker compose "${cargs[@]}" ps
}

# -----------------------------------------------------------------------------
# Health check
# -----------------------------------------------------------------------------
health_check() {
    section "Health check"

    cd "${TARGET_DIR}"
    mapfile -t cargs < <(compose_args)
    docker compose "${cargs[@]}" ps --format json 2>/dev/null \
        | grep -o '"Health":"[^"]*"' | sort | uniq -c

    # Backend healthcheck
    if curl -fsS --max-time 5 http://localhost:8000/api/v1/health 2>/dev/null; then
        log_ok "Backend health: 200"
    else
        log_warn "Backend health check failed (may still be warming up)"
    fi

    if [[ "${SKIP_DNS_CHECK}" != "1" ]]; then
        local current_ip
        current_ip="$(curl -s --max-time 5 ifconfig.me 2>/dev/null || echo unknown)"
        local dns_ip
        dns_ip="$(dig +short A fancai.ru @1.1.1.1 2>/dev/null | head -1)"
        log "Current server IP: ${current_ip}"
        log "DNS A-record fancai.ru: ${dns_ip}"
        if [[ "${current_ip}" != "${dns_ip}" ]]; then
            log_warn "DNS NOT switched yet — Caddy ACME будет ждать DNS"
            log_warn "After DNS update: TTL пройдёт за <60s, Caddy получит сертификаты"
        else
            log_ok "DNS already points to this server"
        fi
    fi
}

# -----------------------------------------------------------------------------
# main
# -----------------------------------------------------------------------------
main() {
    log "fancai migration restore starting"
    log "Target: ${TARGET_DIR} on $(hostname) ($(uname -m))"
    log ""

    if ! ask "ВНИМАНИЕ: Этот скрипт перезапишет ${TARGET_DIR} и развернёт production-стек. Продолжить?"; then
        exit 0
    fi

    preflight
    extract_archive
    restore_code
    restore_secrets
    start_data_services
    restore_postgres
    restore_redis
    restore_storage
    restore_volumes
    start_full_stack
    health_check

    section "Done"
    log_ok "Restore completed."
    log ""
    log "Next steps:"
    log "  1. Обновить DNS A-record: fancai.ru → $(curl -s ifconfig.me 2>/dev/null || echo NEW_IP)"
    log "  2. Дождаться TTL (типично < 60s)"
    log "  3. Caddy автоматически перевыпустит/использует cached cert (caddy_data перенесён)"
    log "  4. UAT smoke tests: см. docs/operations/migration/04-MIGRATION_RUNBOOK.md § 7"
    log ""
    log "Cleanup workdir:"
    log "  rm -rf ${WORK_RESTORE}"
}

main "$@"
