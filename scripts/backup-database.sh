#!/bin/bash
# ============================================================================
# PostgreSQL Backup Script for fancai
# ============================================================================
# Purpose: Automated database backup with compression and retention policy
# Target: Development/Staging environment
#
# Features:
#   - Compressed backup (pg_dump -Fc format)
#   - Automatic retention (keep last 7 days)
#   - Error handling and logging
#   - Docker-aware (works with containerized PostgreSQL)
#
# Usage:
#   ./scripts/backup-database.sh
#   ./scripts/backup-database.sh --keep-days 14
#
# Cron setup (daily at 2 AM):
#   0 2 * * * /path/to/backup-database.sh >> /var/log/backup-database.log 2>&1
#
# Last Updated: 2025-11-15
# ============================================================================

set -e  # Exit on error
set -u  # Exit on undefined variable
set -o pipefail  # Exit on pipe failure

# ============================================================================
# CONFIGURATION
# ============================================================================

# Backup directory (absolute path)
BACKUP_DIR="${BACKUP_DIR:-/backups/postgresql}"

# Database connection settings (from environment or defaults)
DB_NAME="${DB_NAME:-fancai}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

# Docker container name (if using Docker)
DOCKER_CONTAINER="${DOCKER_CONTAINER:-fancai_postgres}"

# Backup retention (days to keep backups)
RETENTION_DAYS="${RETENTION_DAYS:-7}"

# Timestamp format
DATE=$(date +%Y%m%d_%H%M%S)

# Backup filename
BACKUP_FILE="backup_${DB_NAME}_${DATE}.dump"

# Log file
LOG_FILE="${BACKUP_DIR}/backup.log"

# Compression level (1-9, 9 = maximum compression)
COMPRESSION_LEVEL=9

# ============================================================================
# COLORS (for terminal output)
# ============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================================
# FUNCTIONS
# ============================================================================

# Log message to file and stdout
log() {
    local level="$1"
    shift
    local message="$@"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    echo -e "${timestamp} [${level}] ${message}" | tee -a "${LOG_FILE}"
}

# Error handler
error() {
    log "ERROR" "${RED}$@${NC}"
    exit 1
}

# Warning handler
warn() {
    log "WARN" "${YELLOW}$@${NC}"
}

# Info handler
info() {
    log "INFO" "${BLUE}$@${NC}"
}

# Success handler
success() {
    log "SUCCESS" "${GREEN}$@${NC}"
}

# Check if running inside Docker
is_docker() {
    if [ -f /.dockerenv ] || grep -q docker /proc/1/cgroup 2>/dev/null; then
        return 0
    else
        return 1
    fi
}

# Check if Docker container exists and is running
check_docker_container() {
    if docker ps --format '{{.Names}}' | grep -q "^${DOCKER_CONTAINER}$"; then
        return 0
    else
        return 1
    fi
}

# Create backup directory if not exists
create_backup_dir() {
    if [ ! -d "${BACKUP_DIR}" ]; then
        info "Creating backup directory: ${BACKUP_DIR}"
        mkdir -p "${BACKUP_DIR}" || error "Failed to create backup directory"
    fi

    # Check write permissions
    if [ ! -w "${BACKUP_DIR}" ]; then
        error "No write permission for backup directory: ${BACKUP_DIR}"
    fi
}

# Get database size
get_db_size() {
    local size=""

    if check_docker_container; then
        size=$(docker exec -t "${DOCKER_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -c \
            "SELECT pg_size_pretty(pg_database_size('${DB_NAME}'));" 2>/dev/null | tr -d ' ')
    else
        size=$(PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -t -c \
            "SELECT pg_size_pretty(pg_database_size('${DB_NAME}'));" 2>/dev/null | tr -d ' ')
    fi

    echo "${size}"
}

# Perform database backup
backup_database() {
    local backup_path="${BACKUP_DIR}/${BACKUP_FILE}"

    info "Starting backup of database: ${DB_NAME}"
    info "Backup file: ${backup_path}"

    # Get database size
    local db_size=$(get_db_size)
    if [ -n "${db_size}" ]; then
        info "Database size: ${db_size}"
    fi

    # Perform backup
    local start_time=$(date +%s)

    if check_docker_container; then
        # Docker-based backup
        info "Using Docker container: ${DOCKER_CONTAINER}"

        docker exec -t "${DOCKER_CONTAINER}" pg_dump \
            -U "${DB_USER}" \
            -d "${DB_NAME}" \
            -Fc \
            -Z "${COMPRESSION_LEVEL}" \
            --verbose \
            --no-owner \
            --no-acl \
            > "${backup_path}" 2>>"${LOG_FILE}" || error "Backup failed"
    else
        # Direct backup (non-Docker)
        info "Using direct PostgreSQL connection: ${DB_HOST}:${DB_PORT}"

        PGPASSWORD="${DB_PASSWORD}" pg_dump \
            -h "${DB_HOST}" \
            -p "${DB_PORT}" \
            -U "${DB_USER}" \
            -d "${DB_NAME}" \
            -Fc \
            -Z "${COMPRESSION_LEVEL}" \
            --verbose \
            --no-owner \
            --no-acl \
            > "${backup_path}" 2>>"${LOG_FILE}" || error "Backup failed"
    fi

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    # Verify backup file exists and is not empty
    if [ ! -f "${backup_path}" ]; then
        error "Backup file not created: ${backup_path}"
    fi

    local backup_size=$(du -h "${backup_path}" | cut -f1)

    if [ ! -s "${backup_path}" ]; then
        error "Backup file is empty: ${backup_path}"
    fi

    success "Backup completed successfully"
    info "Backup size: ${backup_size}"
    info "Duration: ${duration} seconds"
    info "Compression level: ${COMPRESSION_LEVEL}"
}

# Clean old backups
cleanup_old_backups() {
    info "Cleaning up backups older than ${RETENTION_DAYS} days"

    local old_backups=$(find "${BACKUP_DIR}" -name "backup_*.dump" -type f -mtime +${RETENTION_DAYS} 2>/dev/null)

    if [ -z "${old_backups}" ]; then
        info "No old backups to clean up"
        return
    fi

    local count=0
    while IFS= read -r backup; do
        if [ -f "${backup}" ]; then
            info "Removing old backup: $(basename ${backup})"
            rm -f "${backup}" && ((count++))
        fi
    done <<< "${old_backups}"

    success "Removed ${count} old backup(s)"
}

# List existing backups
list_backups() {
    info "Existing backups in ${BACKUP_DIR}:"

    if [ ! -d "${BACKUP_DIR}" ]; then
        warn "Backup directory does not exist"
        return
    fi

    local backups=$(find "${BACKUP_DIR}" -name "backup_*.dump" -type f 2>/dev/null | sort -r)

    if [ -z "${backups}" ]; then
        warn "No backups found"
        return
    fi

    echo ""
    printf "%-40s %-15s %-20s\n" "FILENAME" "SIZE" "DATE"
    printf "%s\n" "--------------------------------------------------------------------------------"

    while IFS= read -r backup; do
        local filename=$(basename "${backup}")
        local size=$(du -h "${backup}" | cut -f1)
        local date=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "${backup}" 2>/dev/null || stat -c "%y" "${backup}" 2>/dev/null | cut -d'.' -f1)
        printf "%-40s %-15s %-20s\n" "${filename}" "${size}" "${date}"
    done <<< "${backups}"

    echo ""
}

# Verify backup integrity
verify_backup() {
    local backup_path="${BACKUP_DIR}/${BACKUP_FILE}"

    info "Verifying backup integrity: ${BACKUP_FILE}"

    if check_docker_container; then
        docker exec -t "${DOCKER_CONTAINER}" pg_restore \
            --list "${backup_path}" >/dev/null 2>&1 || error "Backup verification failed"
    else
        pg_restore --list "${backup_path}" >/dev/null 2>&1 || error "Backup verification failed"
    fi

    success "Backup verification passed"
}

# Display usage information
usage() {
    cat <<EOF
PostgreSQL Backup Script for fancai

Usage:
    $0 [OPTIONS]

Options:
    --help              Show this help message
    --list              List existing backups
    --keep-days N       Set retention period (default: ${RETENTION_DAYS} days)
    --verify-only       Only verify last backup without creating new one

Environment Variables:
    BACKUP_DIR          Backup directory path (default: /backups/postgresql)
    DB_NAME             Database name (default: fancai)
    DB_USER             Database user (default: postgres)
    DB_PASSWORD         Database password
    DB_HOST             Database host (default: localhost)
    DB_PORT             Database port (default: 5432)
    DOCKER_CONTAINER    Docker container name (default: fancai_postgres)
    RETENTION_DAYS      Days to keep backups (default: 7)

Examples:
    # Standard backup
    $0

    # Backup with custom retention
    $0 --keep-days 14

    # List existing backups
    $0 --list

    # Using environment variables
    DB_NAME=mydb DB_USER=myuser $0

Cron Setup (daily at 2 AM):
    0 2 * * * /path/to/backup-database.sh >> /var/log/backup-database.log 2>&1

EOF
    exit 0
}

# ============================================================================
# MAIN
# ============================================================================

main() {
    local verify_only=false
    local list_only=false

    # Parse command-line arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --help|-h)
                usage
                ;;
            --list|-l)
                list_only=true
                shift
                ;;
            --keep-days)
                RETENTION_DAYS="$2"
                shift 2
                ;;
            --verify-only)
                verify_only=true
                shift
                ;;
            *)
                error "Unknown option: $1 (use --help for usage)"
                ;;
        esac
    done

    # Print header
    echo ""
    info "============================================================================"
    info "PostgreSQL Backup Script for fancai"
    info "============================================================================"
    info "Date: $(date '+%Y-%m-%d %H:%M:%S')"
    info "Database: ${DB_NAME}"
    info "Backup directory: ${BACKUP_DIR}"
    info "Retention: ${RETENTION_DAYS} days"
    info "============================================================================"
    echo ""

    # List backups and exit if --list
    if [ "${list_only}" = true ]; then
        list_backups
        exit 0
    fi

    # Create backup directory
    create_backup_dir

    # Verify only mode
    if [ "${verify_only}" = true ]; then
        local last_backup=$(find "${BACKUP_DIR}" -name "backup_*.dump" -type f 2>/dev/null | sort -r | head -n1)
        if [ -z "${last_backup}" ]; then
            error "No backups found to verify"
        fi
        BACKUP_FILE=$(basename "${last_backup}")
        verify_backup
        exit 0
    fi

    # Perform backup
    backup_database

    # Verify backup integrity
    verify_backup

    # Clean old backups
    cleanup_old_backups

    # List backups
    list_backups

    echo ""
    success "============================================================================"
    success "Backup completed successfully: ${BACKUP_FILE}"
    success "============================================================================"
    echo ""
}

# Run main function
main "$@"
