#!/bin/bash

################################################################################
# fancai - Comprehensive Backup Script
#
# Creates timestamped backups of:
# - PostgreSQL database (pg_dump from container)
# - Redis data (SAVE command)
# - Storage files (books, images, covers)
# - Git repository (all branches, tags, stash)
# - Full project archive
#
# Usage:
#   ./scripts/backup.sh [--type full|db|files|git] [--compress]
#
# Examples:
#   ./scripts/backup.sh                    # Full backup (default)
#   ./scripts/backup.sh --type db          # Database only
#   ./scripts/backup.sh --compress         # Full backup with compression
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
TIMESTAMP=$(date +"%Y-%m-%d-%H%M%S")
BACKUP_NAME="backup-${TIMESTAMP}"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"

# Docker containers
POSTGRES_CONTAINER="fancai_postgres"
REDIS_CONTAINER="fancai_redis"

# Database credentials (from .env or defaults)
DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-}"
DB_PASSWORD="${POSTGRES_PASSWORD:-postgres}"

# Auto-detect database name if not set
if [ -z "${DB_NAME}" ]; then
    DB_NAME=$(docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -t -c "SELECT datname FROM pg_database WHERE datname LIKE 'fancai%' LIMIT 1;" 2>/dev/null | xargs)
    [ -z "${DB_NAME}" ] && DB_NAME="fancai_dev"
fi

# Default options
BACKUP_TYPE="full"
COMPRESS=false

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

create_manifest() {
    local manifest_file="${BACKUP_PATH}/manifest.txt"

    cat > "${manifest_file}" << EOF
fancai Backup Manifest
==============================

Backup Information:
------------------
Backup Name: ${BACKUP_NAME}
Timestamp: ${TIMESTAMP}
Date: $(date '+%Y-%m-%d %H:%M:%S %Z')
Backup Type: ${BACKUP_TYPE}
Compressed: ${COMPRESS}

System Information:
------------------
Hostname: $(hostname)
OS: $(uname -s)
Platform: $(uname -m)
User: $(whoami)

Git Information:
---------------
Branch: $(cd "${PROJECT_ROOT}" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "N/A")
Commit: $(cd "${PROJECT_ROOT}" && git rev-parse HEAD 2>/dev/null || echo "N/A")
Commit Message: $(cd "${PROJECT_ROOT}" && git log -1 --pretty=%B 2>/dev/null || echo "N/A")

Docker Containers Status:
------------------------
$(docker ps --format 'table {{.Names}}\t{{.Status}}' | grep fancai || echo "No containers running")

Backup Contents:
---------------
EOF

    # List backup contents
    if [ -d "${BACKUP_PATH}" ]; then
        du -sh "${BACKUP_PATH}"/* >> "${manifest_file}" 2>/dev/null || true
    fi

    print_success "Manifest created: ${manifest_file}"
}

################################################################################
# Backup Functions
################################################################################

backup_postgres() {
    print_header "Backing up PostgreSQL Database"

    local db_backup_dir="${BACKUP_PATH}/database"
    mkdir -p "${db_backup_dir}"

    if ! check_container_running "${POSTGRES_CONTAINER}"; then
        print_error "Cannot backup database - PostgreSQL container not running"
        return 1
    fi

    print_info "Exporting database: ${DB_NAME}"

    # Full database dump
    local dump_file="${db_backup_dir}/postgres_${DB_NAME}.sql"
    docker exec "${POSTGRES_CONTAINER}" pg_dump \
        -U "${DB_USER}" \
        -d "${DB_NAME}" \
        --no-owner \
        --no-acl \
        > "${dump_file}" 2>/dev/null

    if [ $? -eq 0 ] && [ -s "${dump_file}" ]; then
        print_success "Database dump created: $(du -sh "${dump_file}" | cut -f1)"
    else
        print_error "Database dump failed or is empty"
        # Try to show error for debugging
        docker exec "${POSTGRES_CONTAINER}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" --version > /dev/null 2>&1
        return 1
    fi

    # Schema only dump (for reference)
    local schema_file="${db_backup_dir}/schema_${DB_NAME}.sql"
    docker exec "${POSTGRES_CONTAINER}" pg_dump \
        -U "${DB_USER}" \
        -d "${DB_NAME}" \
        --schema-only \
        --no-owner \
        --no-acl \
        > "${schema_file}" 2>/dev/null

    print_success "Schema dump created: $(du -sh "${schema_file}" | cut -f1)"

    # Create database metadata
    cat > "${db_backup_dir}/db_metadata.txt" << EOF
Database: ${DB_NAME}
User: ${DB_USER}
Timestamp: ${TIMESTAMP}
PostgreSQL Version: $(docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -t -c "SELECT version();" | head -1)

Tables:
$(docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -c "\dt" 2>/dev/null)

Database Size:
$(docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT pg_size_pretty(pg_database_size('${DB_NAME}'));" 2>/dev/null)
EOF

    print_success "PostgreSQL backup completed"
}

backup_redis() {
    print_header "Backing up Redis Data"

    local redis_backup_dir="${BACKUP_PATH}/redis"
    mkdir -p "${redis_backup_dir}"

    if ! check_container_running "${REDIS_CONTAINER}"; then
        print_error "Cannot backup Redis - container not running"
        return 1
    fi

    print_info "Triggering Redis SAVE command"

    # Trigger Redis save
    docker exec "${REDIS_CONTAINER}" redis-cli SAVE > /dev/null 2>&1

    # Copy dump.rdb from container
    local redis_dump="${redis_backup_dir}/dump.rdb"
    docker cp "${REDIS_CONTAINER}:/data/dump.rdb" "${redis_dump}" 2>/dev/null

    if [ -f "${redis_dump}" ] && [ -s "${redis_dump}" ]; then
        print_success "Redis dump created: $(du -sh "${redis_dump}" | cut -f1)"
    else
        print_error "Redis dump not found or empty"
        return 1
    fi

    # Redis info
    docker exec "${REDIS_CONTAINER}" redis-cli INFO > "${redis_backup_dir}/redis_info.txt" 2>/dev/null

    print_success "Redis backup completed"
}

backup_storage_files() {
    print_header "Backing up Storage Files"

    local storage_backup_dir="${BACKUP_PATH}/storage"
    mkdir -p "${storage_backup_dir}"

    # Docker volume name (used in docker-compose.lite.yml)
    local VOLUME_NAME="fancai-vibe-hackathon_uploaded_books"
    
    # Check if we're running on the server with Docker volumes
    if docker volume inspect "${VOLUME_NAME}" &>/dev/null; then
        print_info "Found Docker volume: ${VOLUME_NAME}"
        print_info "Backing up from Docker named volume..."
        
        # Use Alpine container to extract data from volume
        docker run --rm \
            -v "${VOLUME_NAME}:/source:ro" \
            -v "${storage_backup_dir}:/backup" \
            alpine tar czf /backup/storage.tar.gz -C /source .
        
        if [ -f "${storage_backup_dir}/storage.tar.gz" ]; then
            print_success "Docker volume backup created: $(du -sh "${storage_backup_dir}/storage.tar.gz" | cut -f1)"
            
            # Also extract for inventory
            tar -xzf "${storage_backup_dir}/storage.tar.gz" -C "${storage_backup_dir}" 2>/dev/null || true
        else
            print_error "Docker volume backup failed"
            return 1
        fi
    else
        # Fallback to bind mount path (development or alternative setup)
        local storage_source="${PROJECT_ROOT}/backend/storage"
        
        if [ ! -d "${storage_source}" ] || [ -z "$(ls -A "${storage_source}" 2>/dev/null)" ]; then
            print_info "Storage directory not found or empty: ${storage_source}"
            print_info "And Docker volume ${VOLUME_NAME} not available"
            print_info "Creating empty storage backup directory"
            return 0
        fi

        print_info "Using bind mount path: ${storage_source}"

        # Copy with rsync for efficiency (if available) or fallback to cp
        if command -v rsync >/dev/null 2>&1; then
            rsync -a --info=progress2 "${storage_source}/" "${storage_backup_dir}/"
        else
            cp -r "${storage_source}"/* "${storage_backup_dir}/" 2>/dev/null || true
        fi
    fi

    # Create storage inventory
    cat > "${storage_backup_dir}/inventory.txt" << EOF
Storage Backup Inventory
========================
Timestamp: ${TIMESTAMP}
Backup Source: Docker Volume (${VOLUME_NAME}) or Bind Mount

Directory Structure:
$(tree -L 2 "${storage_backup_dir}" 2>/dev/null || find "${storage_backup_dir}" -type d | head -20)

File Counts:
Books: $(find "${storage_backup_dir}/books" -type f 2>/dev/null | wc -l | tr -d ' ')
Generated Images: $(find "${storage_backup_dir}/generated_images" -type f 2>/dev/null | wc -l | tr -d ' ')
Covers: $(find "${storage_backup_dir}/covers" -type f 2>/dev/null | wc -l | tr -d ' ')

Total Size: $(du -sh "${storage_backup_dir}" | cut -f1)
EOF

    print_success "Storage files backup completed: $(du -sh "${storage_backup_dir}" | cut -f1)"
}

backup_git_repository() {
    print_header "Backing up Git Repository"

    local git_backup_dir="${BACKUP_PATH}/git"
    mkdir -p "${git_backup_dir}"

    cd "${PROJECT_ROOT}"

    if [ ! -d ".git" ]; then
        print_error "Not a git repository"
        return 1
    fi

    print_info "Creating git bundle (all branches, tags, stash)"

    # Create git bundle with all refs
    local bundle_file="${git_backup_dir}/repository.bundle"
    git bundle create "${bundle_file}" --all

    if [ -f "${bundle_file}" ] && [ -s "${bundle_file}" ]; then
        print_success "Git bundle created: $(du -sh "${bundle_file}" | cut -f1)"
    else
        print_error "Git bundle creation failed"
        return 1
    fi

    # Export git config
    git config --list > "${git_backup_dir}/git_config.txt" 2>/dev/null

    # Export remotes
    git remote -v > "${git_backup_dir}/git_remotes.txt" 2>/dev/null

    # Export current status
    cat > "${git_backup_dir}/git_status.txt" << EOF
Git Repository Status
=====================
Timestamp: ${TIMESTAMP}

Current Branch: $(git rev-parse --abbrev-ref HEAD)
Current Commit: $(git rev-parse HEAD)
Commit Message: $(git log -1 --pretty=%B)
Commit Author: $(git log -1 --pretty="%an <%ae>")
Commit Date: $(git log -1 --pretty=%ci)

All Branches:
$(git branch -a)

All Tags:
$(git tag -l)

Stash List:
$(git stash list)

Repository Stats:
Total Commits: $(git rev-list --all --count)
Total Branches: $(git branch -a | wc -l | tr -d ' ')
Total Tags: $(git tag -l | wc -l | tr -d ' ')
EOF

    print_success "Git repository backup completed"
}

backup_project_archive() {
    print_header "Creating Full Project Archive"

    local archive_backup_dir="${BACKUP_PATH}/archive"
    mkdir -p "${archive_backup_dir}"

    print_info "Archiving project directory (excluding node_modules, __pycache__, etc.)"

    # Create exclusion list
    local exclude_file="/tmp/backup_exclude_${TIMESTAMP}.txt"
    cat > "${exclude_file}" << EOF
node_modules
__pycache__
*.pyc
.pytest_cache
.venv
venv
.env.local
.DS_Store
*.log
backups
.git/objects
EOF

    # Create tar archive
    local archive_file="${archive_backup_dir}/project.tar.gz"

    tar -czf "${archive_file}" \
        -C "${PROJECT_ROOT}/.." \
        --exclude-from="${exclude_file}" \
        "$(basename "${PROJECT_ROOT}")" 2>/dev/null

    rm -f "${exclude_file}"

    if [ -f "${archive_file}" ] && [ -s "${archive_file}" ]; then
        print_success "Project archive created: $(du -sh "${archive_file}" | cut -f1)"
    else
        print_error "Project archive creation failed"
        return 1
    fi
}

compress_backup() {
    print_header "Compressing Backup"

    local compressed_file="${BACKUP_DIR}/${BACKUP_NAME}.tar.gz"

    print_info "Creating compressed archive: ${compressed_file}"

    tar -czf "${compressed_file}" \
        -C "${BACKUP_DIR}" \
        "${BACKUP_NAME}" 2>/dev/null

    if [ -f "${compressed_file}" ] && [ -s "${compressed_file}" ]; then
        print_success "Compressed backup created: $(du -sh "${compressed_file}" | cut -f1)"

        # Remove uncompressed backup directory
        rm -rf "${BACKUP_PATH}"
        print_info "Removed uncompressed backup directory"
    else
        print_error "Compression failed"
        return 1
    fi
}

################################################################################
# Main Backup Logic
################################################################################

main() {
    print_header "fancai - Backup Script"

    print_info "Backup started at: $(date '+%Y-%m-%d %H:%M:%S')"
    print_info "Backup type: ${BACKUP_TYPE}"
    print_info "Backup directory: ${BACKUP_PATH}"

    # Create backup directory
    mkdir -p "${BACKUP_PATH}"

    # Execute backup based on type
    case "${BACKUP_TYPE}" in
        "full")
            backup_postgres || print_error "PostgreSQL backup failed"
            backup_redis || print_error "Redis backup failed"
            backup_storage_files || print_error "Storage backup failed"
            backup_git_repository || print_error "Git backup failed"
            backup_project_archive || print_error "Project archive failed"
            ;;
        "db")
            backup_postgres || print_error "PostgreSQL backup failed"
            backup_redis || print_error "Redis backup failed"
            ;;
        "files")
            backup_storage_files || print_error "Storage backup failed"
            ;;
        "git")
            backup_git_repository || print_error "Git backup failed"
            ;;
        *)
            print_error "Unknown backup type: ${BACKUP_TYPE}"
            exit 1
            ;;
    esac

    # Create manifest
    create_manifest

    # Compress if requested
    if [ "${COMPRESS}" = true ]; then
        compress_backup
    fi

    # Final summary
    print_header "Backup Summary"

    if [ "${COMPRESS}" = true ]; then
        print_success "Backup completed: ${BACKUP_DIR}/${BACKUP_NAME}.tar.gz"
        print_info "Total size: $(du -sh "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz" | cut -f1)"
    else
        print_success "Backup completed: ${BACKUP_PATH}"
        print_info "Total size: $(du -sh "${BACKUP_PATH}" | cut -f1)"
    fi

    print_info "Backup finished at: $(date '+%Y-%m-%d %H:%M:%S')"

    # List recent backups
    print_info "\nRecent backups:"
    ls -lth "${BACKUP_DIR}" | head -6
}

################################################################################
# Parse Arguments
################################################################################

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --type)
                BACKUP_TYPE="$2"
                shift 2
                ;;
            --compress)
                COMPRESS=true
                shift
                ;;
            --help)
                cat << EOF
fancai - Backup Script

Usage: $0 [OPTIONS]

OPTIONS:
    --type TYPE     Backup type: full|db|files|git (default: full)
    --compress      Compress backup into .tar.gz archive
    --help          Show this help message

EXAMPLES:
    $0                          # Full backup
    $0 --type db                # Database only
    $0 --type files             # Storage files only
    $0 --compress               # Full backup with compression
    $0 --type db --compress     # Compressed database backup

BACKUP CONTENTS:
    full    - Database + Redis + Storage + Git + Project archive
    db      - PostgreSQL + Redis only
    files   - Storage files only (books, images, covers)
    git     - Git repository bundle only

OUTPUT:
    Backups are saved to: ${BACKUP_DIR}
    Format: backup-YYYY-MM-DD-HHmmss/
    With manifest.txt containing backup metadata

EOF
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done
}

################################################################################
# Entry Point
################################################################################

parse_args "$@"
main

exit 0
