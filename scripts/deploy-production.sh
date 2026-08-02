#!/bin/bash

# fancai - Production Deployment Script
# Comprehensive production deployment with safety checks and rollback

set -euo pipefail

# Script configuration
PROJECT_NAME="fancai"
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env"
BACKUP_DIR="/backups/$(date +%Y%m%d_%H%M%S)"
LOG_FILE="/var/log/fancai-deploy.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Logging functions
log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

error() {
    log "${RED}❌ ERROR: $1${NC}"
}

success() {
    log "${GREEN}✅ SUCCESS: $1${NC}"
}

warning() {
    log "${YELLOW}⚠️  WARNING: $1${NC}"
}

info() {
    log "${BLUE}ℹ️  INFO: $1${NC}"
}

step() {
    log "${PURPLE}🚀 STEP: $1${NC}"
}

# Function to check prerequisites
check_prerequisites() {
    step "Checking prerequisites..."
    
    # Check if running as root or with sudo
    if [[ $EUID -eq 0 ]]; then
        error "This script should not be run as root for security reasons"
        exit 1
    fi
    
    # Check if Docker is installed and running
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed"
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        error "Docker daemon is not running"
        exit 1
    fi
    
    # Check if Docker Compose is available
    if ! docker compose version &> /dev/null; then
        error "Docker Compose (v2) is not available"
        exit 1
    fi
    
    # Check if environment file exists
    if [[ ! -f "$ENV_FILE" ]]; then
        error "Environment file $ENV_FILE does not exist"
        info "Please copy .env.production.example to $ENV_FILE and configure it"
        exit 1
    fi
    
    # Check if required directories exist
    local required_dirs=("logs" "postgres")
    for dir in "${required_dirs[@]}"; do
        if [[ ! -d "$dir" ]]; then
            warning "Creating missing directory: $dir"
            mkdir -p "$dir"
        fi
    done
    
    success "Prerequisites check passed"
}

# Function to validate environment variables
validate_environment() {
    step "Validating environment variables..."
    
    source "$ENV_FILE"
    
    local required_vars=(
        "DOMAIN_NAME"
        "DB_PASSWORD"
        "REDIS_PASSWORD"
        "SECRET_KEY"
    )
    
    local missing_vars=()
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            missing_vars+=("$var")
        fi
    done
    
    if [[ ${#missing_vars[@]} -gt 0 ]]; then
        error "Missing required environment variables:"
        printf '%s\n' "${missing_vars[@]}"
        exit 1
    fi
    
    # Check password strength
    if [[ ${#DB_PASSWORD} -lt 16 ]]; then
        warning "DB_PASSWORD should be at least 16 characters long"
    fi
    
    if [[ ${#SECRET_KEY} -lt 32 ]]; then
        error "SECRET_KEY must be at least 32 characters long"
        exit 1
    fi
    
    success "Environment validation passed"
}

# Function to create backup
create_backup() {
    step "Creating backup..."
    
    mkdir -p "$BACKUP_DIR"
    
    # Backup environment file
    cp "$ENV_FILE" "$BACKUP_DIR/"
    
    # Backup database if running
    if docker compose -f "$COMPOSE_FILE" ps postgres | grep -q "Up"; then
        info "Creating database backup..."
        docker compose -f "$COMPOSE_FILE" exec -T postgres pg_dump \
            -U "${DB_USER:-fancai_user}" \
            -d "${DB_NAME:-fancai_prod}" \
            > "$BACKUP_DIR/database.sql" || true
    fi
    
    # Backup volumes
    info "Creating volume backups..."
    docker run --rm \
        -v fancai_postgres_data:/source:ro \
        -v "$BACKUP_DIR":/backup \
        alpine tar czf /backup/postgres_data.tar.gz -C /source . || true
        
    docker run --rm \
        -v fancai_redis_data:/source:ro \
        -v "$BACKUP_DIR":/backup \
        alpine tar czf /backup/redis_data.tar.gz -C /source . || true
    
    success "Backup created at $BACKUP_DIR"
    echo "$BACKUP_DIR" > .last_backup
}

# Function to pull and build images
build_images() {
    step "Building production images..."
    
    # Pull base images first
    docker compose -f "$COMPOSE_FILE" pull postgres redis caddy || true
    
    # Build our custom images
    info "Building backend image..."
    docker compose -f "$COMPOSE_FILE" build --no-cache backend
    
    info "Building frontend image..."
    docker compose -f "$COMPOSE_FILE" build --no-cache frontend
    
    # Tag images with timestamp for rollback capability
    local timestamp=$(date +%Y%m%d_%H%M%S)
    docker tag "fancai-backend:latest" "fancai-backend:$timestamp"
    docker tag "fancai-frontend:latest" "fancai-frontend:$timestamp"
    
    success "Images built successfully"
}

# Function to perform health checks
health_check() {
    step "Performing health checks..."
    
    local max_attempts=30
    local attempt=1
    
    info "Waiting for services to become healthy..."
    
    while [[ $attempt -le $max_attempts ]]; do
        local unhealthy_services=()
        
        # Check each service health
        local services=("postgres" "redis" "backend" "frontend")
        for service in "${services[@]}"; do
            local health_status=$(docker compose -f "$COMPOSE_FILE" ps "$service" --format "table {{.Service}}\t{{.Status}}" | tail -n 1 | awk '{print $2}')
            
            if [[ "$health_status" != *"healthy"* ]] && [[ "$health_status" != *"Up"* ]]; then
                unhealthy_services+=("$service")
            fi
        done
        
        if [[ ${#unhealthy_services[@]} -eq 0 ]]; then
            success "All services are healthy"
            return 0
        fi
        
        info "Attempt $attempt/$max_attempts - Waiting for services: ${unhealthy_services[*]}"
        sleep 10
        ((attempt++))
    done
    
    error "Health check timeout - some services are not healthy"
    docker compose -f "$COMPOSE_FILE" ps
    return 1
}

# Function to deploy application
deploy_application() {
    step "Deploying application..."
    
    # Stop existing containers gracefully
    info "Stopping existing containers..."
    docker compose -f "$COMPOSE_FILE" down --timeout 30 || true
    
    # Clean up orphaned containers and networks
    docker container prune -f || true
    docker image prune -f || true
    # NOTE: --volumes intentionally removed to protect postgres_data and redis_data
    
    # Start infrastructure services first
    info "Starting infrastructure services..."
    docker compose -f "$COMPOSE_FILE" up -d postgres redis
    
    # Wait for infrastructure
    sleep 20
    
    # Run database migrations
    info "Running database migrations..."
    docker compose -f "$COMPOSE_FILE" run --rm backend alembic upgrade head
    
    # Start application services
    info "Starting application services..."
    docker compose -f "$COMPOSE_FILE" up -d backend celery-worker celery-beat
    
    # Wait for backend to be ready
    sleep 30
    
    # Start frontend and caddy
    info "Starting frontend and caddy..."
    docker compose -f "$COMPOSE_FILE" up -d frontend caddy
    
    success "Application deployed"
}

# Function to verify deployment
verify_deployment() {
    step "Verifying deployment..."
    
    # Check if all expected containers are running
    local expected_services=("postgres" "redis" "backend" "celery-worker" "celery-beat" "frontend" "caddy")
    local failed_services=()
    
    for service in "${expected_services[@]}"; do
        if ! docker compose -f "$COMPOSE_FILE" ps "$service" | grep -q "Up"; then
            failed_services+=("$service")
        fi
    done
    
    if [[ ${#failed_services[@]} -gt 0 ]]; then
        error "Failed services: ${failed_services[*]}"
        return 1
    fi
    
    # Test API endpoint
    info "Testing API endpoint..."
    local api_url="http://localhost/api/v1/health"
    if curl -f -s "$api_url" > /dev/null; then
        success "API endpoint is responding"
    else
        error "API endpoint is not responding"
        return 1
    fi
    
    # Test frontend
    info "Testing frontend..."
    if curl -f -s "http://localhost/" > /dev/null; then
        success "Frontend is serving content"
    else
        error "Frontend is not responding"
        return 1
    fi
    
    success "Deployment verification passed"
}

# Function to rollback deployment
rollback() {
    error "Deployment failed, initiating rollback..."
    
    if [[ -f ".last_backup" ]]; then
        local backup_path=$(cat .last_backup)
        warning "Rolling back to backup: $backup_path"
        
        # Stop current deployment
        docker compose -f "$COMPOSE_FILE" down --timeout 30
        
        # Restore database backup if available
        if [[ -f "$backup_path/database.sql" ]]; then
            info "Restoring database backup..."
            docker compose -f "$COMPOSE_FILE" up -d postgres
            sleep 10
            docker compose -f "$COMPOSE_FILE" exec -T postgres psql \
                -U "${DB_USER:-fancai_user}" \
                -d "${DB_NAME:-fancai_prod}" \
                < "$backup_path/database.sql" || true
        fi
        
        # Restore previous images if available
        local timestamp_files=($(ls -t /tmp/fancai-images-* 2>/dev/null | head -1))
        if [[ ${#timestamp_files[@]} -gt 0 ]]; then
            info "Loading previous images..."
            docker load < "${timestamp_files[0]}" || true
        fi
        
        # Start with previous configuration
        docker compose -f "$COMPOSE_FILE" up -d
        
        warning "Rollback completed"
    else
        error "No backup found for rollback"
    fi
}

# Function to save deployment info
save_deployment_info() {
    step "Saving deployment information..."
    
    local deployment_info="/var/log/fancai-deployment-$(date +%Y%m%d_%H%M%S).info"
    
    cat > "$deployment_info" << EOF
Deployment Information
=====================
Date: $(date)
Project: $PROJECT_NAME
Git Commit: $(git rev-parse HEAD 2>/dev/null || echo "Not available")
Git Branch: $(git branch --show-current 2>/dev/null || echo "Not available")

Environment Variables:
$(grep -v "PASSWORD\|SECRET\|KEY" "$ENV_FILE" | head -20)

Docker Images:
$(docker compose -f "$COMPOSE_FILE" images)

Running Services:
$(docker compose -f "$COMPOSE_FILE" ps)
EOF
    
    success "Deployment info saved to $deployment_info"
}

# Main deployment function
main() {
    log "${PURPLE}=================================${NC}"
    log "${PURPLE}🚀 $PROJECT_NAME Production Deployment${NC}"
    log "${PURPLE}=================================${NC}"
    
    # Set trap for cleanup on failure
    trap rollback ERR
    
    check_prerequisites
    validate_environment
    create_backup
    build_images
    deploy_application
    
    # Perform health checks
    if health_check; then
        verify_deployment
        save_deployment_info
        
        success "🎉 Deployment completed successfully!"
        info "Application is now running at: https://${DOMAIN_NAME:-localhost}"
        info "API documentation: https://${DOMAIN_NAME:-localhost}/api/v1/docs"
        
        # Display running services
        log "${BLUE}Running services:${NC}"
        docker compose -f "$COMPOSE_FILE" ps
        
        # Optional: Start monitoring if requested
        if [[ "${1:-}" == "--with-monitoring" ]]; then
            info "Starting monitoring services..."
            docker compose -f "$COMPOSE_FILE" --profile monitoring up -d
            success "Monitoring available at: https://${DOMAIN_NAME:-localhost}:3001"
        fi
        
    else
        error "Health checks failed"
        exit 1
    fi
    
    # Remove trap
    trap - ERR
}

# Script usage
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --with-monitoring    Start monitoring services"
    echo "  --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                          # Standard deployment"
    echo "  $0 --with-monitoring        # Deployment with monitoring"
}

# Parse command line arguments
case "${1:-}" in
    --help)
        usage
        exit 0
        ;;
    --with-monitoring)
        main --with-monitoring
        ;;
    "")
        main
        ;;
    *)
        echo "Unknown option: $1"
        usage
        exit 1
        ;;
esac