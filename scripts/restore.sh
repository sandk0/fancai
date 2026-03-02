#!/bin/bash

################################################################################
# fancai - Restore Script
#
# Restores from backups created by backup.sh:
# - PostgreSQL database (drop and recreate)
# - Redis data (flush and restore)
# - Storage files (books, images, covers)
# - Git repository (optional)
#
# Usage:
#   ./scripts/restore.sh <backup-name> [--type full|db|files] [--force]
#
# Examples:
#   ./scripts/restore.sh backup-2025-10-24-010000
#   ./scripts/restore.sh backup-2025-10-24-010000 --type db
#   ./scripts/restore.sh backup-2025-10-24-010000.tar.gz --force
#
################################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/backups"

# Docker containers
POSTGRES_CONTAINER="fancai_postgres"
REDIS_CONTAINER="fancai_redis"

# Database credentials
DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-}"
DB_PASSWORD="${POSTGRES_PASSWORD:-postgres}"

# Auto-detect database name if not set
if [ -z "${DB_NAME}" ]; then
    DB_NAME=$(docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -t -c "SELECT datname FROM pg_database WHERE datname LIKE 'fancai%' LIMIT 1;" 2>/dev/null | xargs)
    [ -z "${DB_NAME}" ] && DB_NAME="fancai_dev"
fi

# Options
RESTORE_TYPE="full"
FORCE=false
BACKUP_NAME=""
BACKUP_PATH=""

################################################################################
# Helper Functions
################################################################################

print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

check_container_running() {
    local container=$1
    if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        print_error "Container ${container} is not running"
        return 1
    fi
    return 0
}

confirm_action() {
    local message=$1

    if [ "${FORCE}" = true ]; then
        return 0
    fi

    read -p "$(echo -e "${YELLOW}${message} (yes/no): ${NC}")" response
    case "$response" in
        [yY][eE][sS]|[yY])
            return 0
            ;;
        *)
            print_info "Operation cancelled by user"
            exit 0
            ;;
    esac
}

validate_backup() {
    print_header "Validating Backup"

    if [ ! -d "${BACKUP_PATH}" ] && [ ! -f "${BACKUP_PATH}" ]; then
        print_error "Backup not found: ${BACKUP_PATH}"
        return 1
    fi

    # If compressed, extract first
    if [ -f "${BACKUP_PATH}" ] && [[ "${BACKUP_PATH}" == *.tar.gz ]]; then
        print_info "Extracting compressed backup..."

        local extract_dir="${BACKUP_DIR}/temp_restore_$(date +%s)"
        mkdir -p "${extract_dir}"

        tar -xzf "${BACKUP_PATH}" -C "${extract_dir}"

        # Find the extracted directory
        local extracted=$(find "${extract_dir}" -mindepth 1 -maxdepth 1 -type d | head -1)
        if [ -z "${extracted}" ]; then
            print_error "Failed to extract backup"
            rm -rf "${extract_dir}"
            return 1
        fi

        BACKUP_PATH="${extracted}"
        print_success "Backup extracted to: ${BACKUP_PATH}"
    fi

    # Validate backup structure
    if [ ! -f "${BACKUP_PATH}/manifest.txt" ]; then
        print_warning "Manifest file not found - backup may be incomplete"
    else
        print_info "Backup manifest:"
        head -20 "${BACKUP_PATH}/manifest.txt" | sed 's/^/  /'
    fi

    print_success "Backup validated"
}

################################################################################
# Restore Functions
################################################################################

restore_postgres() {
    print_header "Restoring PostgreSQL Database"

    local db_backup_dir="${BACKUP_PATH}/database"

    if [ ! -d "${db_backup_dir}" ]; then
        print_error "Database backup not found: ${db_backup_dir}"
        return 1
    fi

    if ! check_container_running "${POSTGRES_CONTAINER}"; then
        print_error "PostgreSQL container not running"
        return 1
    fi

    local dump_file="${db_backup_dir}/postgres_${DB_NAME}.sql"

    if [ ! -f "${dump_file}" ]; then
        print_error "Database dump file not found: ${dump_file}"
        return 1
    fi

    print_warning "This will DROP and RECREATE the database: ${DB_NAME}"
    confirm_action "Continue with database restore?"

    print_info "Terminating active connections to database..."
    docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d postgres -c \
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" \
        > /dev/null 2>&1 || true

    print_info "Dropping existing database..."
    docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d postgres -c \
        "DROP DATABASE IF EXISTS ${DB_NAME};" > /dev/null 2>&1

    print_info "Creating fresh database..."
    docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d postgres -c \
        "CREATE DATABASE ${DB_NAME};" > /dev/null 2>&1

    print_info "Restoring database from dump: $(du -sh "${dump_file}" | cut -f1)"
    docker exec -i "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" \
        < "${dump_file}" > /dev/null 2>&1

    if [ $? -eq 0 ]; then
        print_success "Database restored successfully"

        # Verify restoration
        local table_count=$(docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | tr -d ' ')

        print_info "Tables restored: ${table_count}"
    else
        print_error "Database restoration failed"
        return 1
    fi
}

restore_redis() {
    print_header "Restoring Redis Data"

    local redis_backup_dir="${BACKUP_PATH}/redis"

    if [ ! -d "${redis_backup_dir}" ]; then
        print_error "Redis backup not found: ${redis_backup_dir}"
        return 1
    fi

    if ! check_container_running "${REDIS_CONTAINER}"; then
        print_error "Redis container not running"
        return 1
    fi

    local redis_dump="${redis_backup_dir}/dump.rdb"

    if [ ! -f "${redis_dump}" ]; then
        print_error "Redis dump file not found: ${redis_dump}"
        return 1
    fi

    print_warning "This will FLUSH all Redis data"
    confirm_action "Continue with Redis restore?"

    print_info "Flushing Redis database..."
    docker exec "${REDIS_CONTAINER}" redis-cli FLUSHALL > /dev/null 2>&1

    print_info "Stopping Redis to replace dump.rdb..."
    docker exec "${REDIS_CONTAINER}" redis-cli SHUTDOWN SAVE > /dev/null 2>&1 || true

    # Wait for Redis to stop
    sleep 2

    print_info "Copying dump.rdb to container..."
    docker cp "${redis_dump}" "${REDIS_CONTAINER}:/data/dump.rdb"

    print_info "Starting Redis..."
    docker start "${REDIS_CONTAINER}" > /dev/null 2>&1

    # Wait for Redis to start
    sleep 3

    # Verify Redis is running
    if docker exec "${REDIS_CONTAINER}" redis-cli PING > /dev/null 2>&1; then
        print_success "Redis restored successfully"

        # Show key count
        local key_count=$(docker exec "${REDIS_CONTAINER}" redis-cli DBSIZE | grep -o '[0-9]*')
        print_info "Keys restored: ${key_count}"
    else
        print_error "Redis restoration failed - container not responding"
        return 1
    fi
}

restore_storage_files() {
    print_header "Restoring Storage Files"

    local storage_backup_dir="${BACKUP_PATH}/storage"

    if [ ! -d "${storage_backup_dir}" ]; then
        print_error "Storage backup not found: ${storage_backup_dir}"
        return 1
    fi

    local storage_dest="${PROJECT_ROOT}/backend/storage"

    print_warning "This will overwrite existing storage files in: ${storage_dest}"
    confirm_action "Continue with storage restore?"

    print_info "Creating backup of current storage (if exists)..."
    if [ -d "${storage_dest}" ]; then
        local current_backup="${storage_dest}_backup_$(date +%s)"
        mv "${storage_dest}" "${current_backup}"
        print_info "Current storage backed up to: ${current_backup}"
    fi

    print_info "Restoring storage files..."
    mkdir -p "${storage_dest}"

    if command -v rsync >/dev/null 2>&1; then
        rsync -a --info=progress2 "${storage_backup_dir}/" "${storage_dest}/"
    else
        cp -r "${storage_backup_dir}"/* "${storage_dest}/"
    fi

    print_success "Storage files restored: $(du -sh "${storage_dest}" | cut -f1)"

    # Show file counts
    if [ -f "${storage_backup_dir}/inventory.txt" ]; then
        print_info "Restored inventory:"
        grep "File Counts:" -A 5 "${storage_backup_dir}/inventory.txt" | sed 's/^/  /'
    fi
}

restore_git_repository() {
    print_header "Restoring Git Repository"

    local git_backup_dir="${BACKUP_PATH}/git"

    if [ ! -d "${git_backup_dir}" ]; then
        print_error "Git backup not found: ${git_backup_dir}"
        return 1
    fi

    local bundle_file="${git_backup_dir}/repository.bundle"

    if [ ! -f "${bundle_file}" ]; then
        print_error "Git bundle not found: ${bundle_file}"
        return 1
    fi

    print_warning "This is optional - git repository restore should be done carefully"
    print_info "Consider manually cloning from the bundle instead"
    print_info "To manually restore: git clone ${bundle_file} restored-repo"

    if ! confirm_action "Continue with automatic git restore?"; then
        print_info "Skipping git restore"
        return 0
    fi

    cd "${PROJECT_ROOT}"

    # Verify bundle
    if ! git bundle verify "${bundle_file}" > /dev/null 2>&1; then
        print_error "Git bundle verification failed"
        return 1
    fi

    print_info "Fetching from bundle..."
    git fetch "${bundle_file}" 'refs/*:refs/*'

    print_success "Git repository restored from bundle"
}

################################################################################
# Main Restore Logic
################################################################################

main() {
    print_header "fancai - Restore Script"

    print_info "Restore started at: $(date '+%Y-%m-%d %H:%M:%S')"
    print_info "Restore type: ${RESTORE_TYPE}"
    print_info "Backup source: ${BACKUP_NAME}"

    # Validate backup
    validate_backup || exit 1

    print_warning "\nWARNING: Restore will OVERWRITE current data!"
    print_warning "Make sure you have a current backup before proceeding"

    if [ "${FORCE}" != true ]; then
        confirm_action "\nAre you absolutely sure you want to restore?"
    fi

    # Execute restore based on type
    case "${RESTORE_TYPE}" in
        "full")
            restore_postgres || print_error "PostgreSQL restore failed"
            restore_redis || print_error "Redis restore failed"
            restore_storage_files || print_error "Storage restore failed"
            # restore_git_repository || print_error "Git restore failed"
            ;;
        "db")
            restore_postgres || print_error "PostgreSQL restore failed"
            restore_redis || print_error "Redis restore failed"
            ;;
        "files")
            restore_storage_files || print_error "Storage restore failed"
            ;;
        *)
            print_error "Unknown restore type: ${RESTORE_TYPE}"
            exit 1
            ;;
    esac

    # Final summary
    print_header "Restore Summary"
    print_success "Restore completed successfully"
    print_info "Restore finished at: $(date '+%Y-%m-%d %H:%M:%S')"

    print_info "\nNext steps:"
    print_info "1. Restart application containers: docker-compose restart"
    print_info "2. Verify database connections"
    print_info "3. Test application functionality"
    print_info "4. Check logs for any errors"
}

################################################################################
# Parse Arguments
################################################################################

parse_args() {
    # Check for --help first
    for arg in "$@"; do
        if [ "$arg" = "--help" ]; then
            cat << EOF
fancai - Restore Script

Usage: $0 <backup-name> [OPTIONS]

ARGUMENTS:
    backup-name     Name of backup directory or .tar.gz file

OPTIONS:
    --type TYPE     Restore type: full|db|files (default: full)
    --force         Skip confirmation prompts
    --help          Show this help message

EXAMPLES:
    $0 backup-2025-10-24-010000
    $0 backup-2025-10-24-010000 --type db
    $0 backup-2025-10-24-010000.tar.gz --force

RESTORE TYPES:
    full    - Database + Redis + Storage files
    db      - PostgreSQL + Redis only
    files   - Storage files only

WARNINGS:
    - Restore will OVERWRITE current data
    - Database will be DROPPED and RECREATED
    - Redis will be FLUSHED
    - Make a backup before restoring!

AVAILABLE BACKUPS:
$(ls -lth "${BACKUP_DIR}" 2>/dev/null | grep backup- | head -10 || echo "  No backups found")

EOF
            exit 0
        fi
    done

    if [ $# -eq 0 ]; then
        cat << EOF
fancai - Restore Script

Usage: $0 <backup-name> [OPTIONS]

Use --help for detailed information

AVAILABLE BACKUPS:
$(ls -lth "${BACKUP_DIR}" 2>/dev/null | grep backup- | head -10 || echo "  No backups found")

EOF
        exit 1
    fi

    BACKUP_NAME="$1"
    shift

    while [[ $# -gt 0 ]]; do
        case $1 in
            --type)
                RESTORE_TYPE="$2"
                shift 2
                ;;
            --force)
                FORCE=true
                shift
                ;;
            *)
                print_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done

    # Determine backup path
    if [[ "${BACKUP_NAME}" == *.tar.gz ]]; then
        BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"
    elif [ -d "${BACKUP_DIR}/${BACKUP_NAME}" ]; then
        BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"
    elif [ -f "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz" ]; then
        BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}.tar.gz"
    else
        BACKUP_PATH="${BACKUP_NAME}"  # Try as absolute path
    fi
}

################################################################################
# Entry Point
################################################################################

parse_args "$@"
main

exit 0
