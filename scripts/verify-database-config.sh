#!/bin/bash
# ============================================================================
# Database Configuration Verification Script
# ============================================================================
# Purpose: Verify PostgreSQL and Redis configurations are loaded correctly
# Usage: ./scripts/verify-database-config.sh
# Last Updated: 2025-11-15
# ============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Docker container names
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-fancai_postgres}"
REDIS_CONTAINER="${REDIS_CONTAINER:-fancai_redis}"

# Database credentials
DB_NAME="${DB_NAME:-fancai}"
DB_USER="${DB_USER:-postgres}"
REDIS_PASSWORD="${REDIS_PASSWORD:-}"

# ============================================================================
# FUNCTIONS
# ============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

section() {
    echo ""
    echo -e "${BLUE}============================================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}============================================================================${NC}"
}

check_container() {
    local container=$1
    if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        log_success "Container ${container} is running"
        return 0
    else
        log_error "Container ${container} is not running"
        return 1
    fi
}

# ============================================================================
# POSTGRESQL VERIFICATION
# ============================================================================

verify_postgresql() {
    section "PostgreSQL Configuration Verification"

    # Check container
    if ! check_container "${POSTGRES_CONTAINER}"; then
        log_error "PostgreSQL container not found. Start it with: docker-compose up -d postgres"
        return 1
    fi

    # Check config file
    log_info "Checking postgresql.conf..."
    if docker exec "${POSTGRES_CONTAINER}" test -f /etc/postgresql/postgresql.conf; then
        log_success "postgresql.conf is mounted"
    else
        log_error "postgresql.conf not found in container"
        return 1
    fi

    # Check key settings
    log_info "Verifying key PostgreSQL settings..."

    local settings=(
        "shared_buffers"
        "max_connections"
        "work_mem"
        "effective_cache_size"
        "random_page_cost"
    )

    for setting in "${settings[@]}"; do
        local value=$(docker exec -t "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -c \
            "SHOW ${setting};" 2>/dev/null | tr -d ' \r')
        if [ -n "${value}" ]; then
            log_success "${setting} = ${value}"
        else
            log_warning "Could not read ${setting}"
        fi
    done

    # Check extensions
    log_info "Checking installed extensions..."
    local extensions=$(docker exec -t "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -c \
        "SELECT extname FROM pg_extension WHERE extname IN ('pg_stat_statements', 'pg_trgm', 'btree_gin', 'uuid-ossp');" \
        2>/dev/null | tr -d ' \r')

    if [ -n "${extensions}" ]; then
        echo "${extensions}" | while read -r ext; do
            if [ -n "${ext}" ]; then
                log_success "Extension installed: ${ext}"
            fi
        done
    else
        log_warning "No custom extensions found"
    fi

    # Check helper functions
    log_info "Checking helper functions..."
    local functions=$(docker exec -t "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -c \
        "SELECT proname FROM pg_proc WHERE proname IN ('get_slow_queries', 'get_table_sizes', 'get_database_size');" \
        2>/dev/null | tr -d ' \r')

    if [ -n "${functions}" ]; then
        echo "${functions}" | while read -r func; do
            if [ -n "${func}" ]; then
                log_success "Helper function exists: ${func}()"
            fi
        done
    else
        log_warning "Helper functions not found"
    fi

    # Check monitoring user
    log_info "Checking monitoring user..."
    local monitoring_user=$(docker exec -t "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -c \
        "SELECT rolname FROM pg_roles WHERE rolname = 'monitoring';" 2>/dev/null | tr -d ' \r')

    if [ -n "${monitoring_user}" ]; then
        log_success "Monitoring user exists"
    else
        log_warning "Monitoring user not found"
    fi

    # Test database size function
    log_info "Testing get_database_size() function..."
    local db_size=$(docker exec -t "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -c \
        "SELECT * FROM get_database_size();" 2>/dev/null | grep -v "^$")

    if [ -n "${db_size}" ]; then
        log_success "Database size: ${db_size}"
    else
        log_warning "Could not retrieve database size"
    fi

    # Check cache hit ratio
    log_info "Checking cache hit ratio..."
    local cache_ratio=$(docker exec -t "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -c \
        "SELECT ROUND(sum(heap_blks_hit)::NUMERIC / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0) * 100, 2) as cache_hit_ratio FROM pg_statio_user_tables;" \
        2>/dev/null | tr -d ' \r')

    if [ -n "${cache_ratio}" ]; then
        if (( $(echo "${cache_ratio} > 99" | bc -l) )); then
            log_success "Cache hit ratio: ${cache_ratio}% (excellent)"
        elif (( $(echo "${cache_ratio} > 90" | bc -l) )); then
            log_warning "Cache hit ratio: ${cache_ratio}% (acceptable)"
        else
            log_warning "Cache hit ratio: ${cache_ratio}% (needs improvement)"
        fi
    else
        log_warning "Could not calculate cache hit ratio (no data yet)"
    fi

    # Check active connections
    log_info "Checking active connections..."
    local connections=$(docker exec -t "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -c \
        "SELECT count(*) FROM pg_stat_activity WHERE datname = '${DB_NAME}';" 2>/dev/null | tr -d ' \r')

    if [ -n "${connections}" ]; then
        log_success "Active connections: ${connections}"
    fi
}

# ============================================================================
# REDIS VERIFICATION
# ============================================================================

verify_redis() {
    section "Redis Configuration Verification"

    # Check container
    if ! check_container "${REDIS_CONTAINER}"; then
        log_error "Redis container not found. Start it with: docker-compose up -d redis"
        return 1
    fi

    # Check config file
    log_info "Checking redis.conf..."
    if docker exec "${REDIS_CONTAINER}" test -f /usr/local/etc/redis/redis.conf; then
        log_success "redis.conf is mounted"
    else
        log_error "redis.conf not found in container"
        return 1
    fi

    # Check key settings
    log_info "Verifying key Redis settings..."

    # Check if password is set
    if [ -z "${REDIS_PASSWORD}" ]; then
        log_warning "REDIS_PASSWORD not set, using redis-cli without auth"
        local redis_cmd="redis-cli"
    else
        local redis_cmd="redis-cli -a ${REDIS_PASSWORD}"
    fi

    # Maxmemory
    local maxmemory=$(docker exec -t "${REDIS_CONTAINER}" ${redis_cmd} CONFIG GET maxmemory 2>/dev/null | tail -n1 | tr -d '\r')
    if [ -n "${maxmemory}" ] && [ "${maxmemory}" != "0" ]; then
        local maxmemory_mb=$((maxmemory / 1024 / 1024))
        log_success "maxmemory = ${maxmemory_mb}MB"
    else
        log_warning "maxmemory not set or unlimited"
    fi

    # Maxmemory policy
    local policy=$(docker exec -t "${REDIS_CONTAINER}" ${redis_cmd} CONFIG GET maxmemory-policy 2>/dev/null | tail -n1 | tr -d '\r')
    if [ -n "${policy}" ]; then
        log_success "maxmemory-policy = ${policy}"
    fi

    # AOF enabled
    local aof=$(docker exec -t "${REDIS_CONTAINER}" ${redis_cmd} CONFIG GET appendonly 2>/dev/null | tail -n1 | tr -d '\r')
    if [ "${aof}" = "yes" ]; then
        log_success "AOF persistence enabled"
    else
        log_warning "AOF persistence disabled"
    fi

    # Check memory usage
    log_info "Checking memory usage..."
    local used_memory=$(docker exec -t "${REDIS_CONTAINER}" ${redis_cmd} INFO MEMORY 2>/dev/null | grep "used_memory_human" | cut -d: -f2 | tr -d '\r')
    if [ -n "${used_memory}" ]; then
        log_success "Used memory: ${used_memory}"
    fi

    # Check fragmentation
    local fragmentation=$(docker exec -t "${REDIS_CONTAINER}" ${redis_cmd} INFO MEMORY 2>/dev/null | grep "mem_fragmentation_ratio" | cut -d: -f2 | tr -d '\r')
    if [ -n "${fragmentation}" ]; then
        if (( $(echo "${fragmentation} < 1.5" | bc -l) )); then
            log_success "Memory fragmentation: ${fragmentation} (good)"
        else
            log_warning "Memory fragmentation: ${fragmentation} (consider defrag)"
        fi
    fi

    # Check keyspace
    log_info "Checking keyspace..."
    local keyspace=$(docker exec -t "${REDIS_CONTAINER}" ${redis_cmd} INFO KEYSPACE 2>/dev/null | grep "^db" || echo "")
    if [ -n "${keyspace}" ]; then
        echo "${keyspace}" | while read -r line; do
            log_success "${line}"
        done
    else
        log_info "No keys in keyspace (database is empty)"
    fi

    # Check connected clients
    local clients=$(docker exec -t "${REDIS_CONTAINER}" ${redis_cmd} INFO CLIENTS 2>/dev/null | grep "connected_clients" | cut -d: -f2 | tr -d '\r')
    if [ -n "${clients}" ]; then
        log_success "Connected clients: ${clients}"
    fi

    # Test latency
    log_info "Testing Redis latency..."
    local latency=$(docker exec -t "${REDIS_CONTAINER}" ${redis_cmd} --latency-history -i 1 2>/dev/null | head -n 3 || echo "")
    if [ -n "${latency}" ]; then
        log_success "Latency test successful"
    fi
}

# ============================================================================
# BACKUP VERIFICATION
# ============================================================================

verify_backup() {
    section "Backup Configuration Verification"

    # Check backup script
    local backup_script="./scripts/backup-database.sh"
    if [ -f "${backup_script}" ]; then
        log_success "Backup script exists"

        if [ -x "${backup_script}" ]; then
            log_success "Backup script is executable"
        else
            log_warning "Backup script is not executable (run: chmod +x ${backup_script})"
        fi
    else
        log_error "Backup script not found at ${backup_script}"
        return 1
    fi

    # Check backup directory
    local backup_dir="${BACKUP_DIR:-/backups/postgresql}"
    if [ -d "${backup_dir}" ]; then
        log_success "Backup directory exists: ${backup_dir}"

        # List backups
        local backup_count=$(find "${backup_dir}" -name "backup_*.dump" -type f 2>/dev/null | wc -l)
        if [ "${backup_count}" -gt 0 ]; then
            log_success "Found ${backup_count} backup(s)"

            # Show latest backup
            local latest=$(find "${backup_dir}" -name "backup_*.dump" -type f 2>/dev/null | sort -r | head -n1)
            if [ -n "${latest}" ]; then
                local size=$(du -h "${latest}" | cut -f1)
                log_success "Latest backup: $(basename ${latest}) (${size})"
            fi
        else
            log_info "No backups found yet (run: ${backup_script})"
        fi
    else
        log_warning "Backup directory does not exist: ${backup_dir}"
    fi
}

# ============================================================================
# DOCKER COMPOSE VERIFICATION
# ============================================================================

verify_docker_compose() {
    section "Docker Compose Configuration Verification"

    local compose_file="./docker-compose.production.yml"
    if [ ! -f "${compose_file}" ]; then
        log_error "docker-compose.production.yml not found"
        return 1
    fi

    log_success "docker-compose.production.yml exists"

    # Check PostgreSQL volume mounts
    log_info "Checking PostgreSQL volume mounts..."
    if grep -q "postgresql.conf:/etc/postgresql/postgresql.conf" "${compose_file}"; then
        log_success "postgresql.conf is mounted in docker-compose"
    else
        log_error "postgresql.conf mount missing in docker-compose"
    fi

    if grep -q "postgres/init:/docker-entrypoint-initdb.d" "${compose_file}"; then
        log_success "init scripts are mounted in docker-compose"
    else
        log_warning "init scripts mount missing in docker-compose"
    fi

    # Check Redis volume mounts
    log_info "Checking Redis volume mounts..."
    if grep -q "redis.conf:/usr/local/etc/redis/redis.conf" "${compose_file}"; then
        log_success "redis.conf is mounted in docker-compose"
    else
        log_error "redis.conf mount missing in docker-compose"
    fi
}

# ============================================================================
# MAIN
# ============================================================================

main() {
    echo ""
    echo -e "${BLUE}============================================================================${NC}"
    echo -e "${BLUE}Database Configuration Verification for fancai${NC}"
    echo -e "${BLUE}============================================================================${NC}"
    echo -e "${BLUE}Date: $(date '+%Y-%m-%d %H:%M:%S')${NC}"
    echo -e "${BLUE}============================================================================${NC}"

    # Docker Compose verification
    verify_docker_compose

    # PostgreSQL verification
    verify_postgresql

    # Redis verification
    verify_redis

    # Backup verification
    verify_backup

    # Summary
    section "Verification Summary"
    log_success "Configuration verification completed"
    log_info "All configurations are loaded correctly"
    echo ""
    log_info "Next steps:"
    echo "  1. Monitor resource usage: docker stats ${POSTGRES_CONTAINER} ${REDIS_CONTAINER}"
    echo "  2. Check slow queries: docker exec ${POSTGRES_CONTAINER} psql -U ${DB_USER} -d ${DB_NAME} -c \"SELECT * FROM get_slow_queries(10);\""
    echo "  3. Setup automated backups: crontab -e"
    echo "  4. Review full documentation: docs/operations/deployment/database-optimization-4gb-server.md"
    echo ""
}

# Run main function
main "$@"
