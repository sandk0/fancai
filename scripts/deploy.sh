#!/bin/bash

# BookReader AI Production Deploy Script
# Usage: ./scripts/deploy.sh [command]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
BACKUP_DIR="./backups"
LOG_DIR="./logs"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_requirements() {
    log_info "Checking requirements..."
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi
    
    if ! docker compose version &> /dev/null; then
        log_error "Docker Compose V2 is not installed"
        exit 1
    fi
    
    if [ ! -f "$ENV_FILE" ]; then
        log_error "Environment file $ENV_FILE not found"
        exit 1
    fi
    
    log_success "Requirements check passed"
}

init_deployment() {
    log_info "Initializing production deployment..."
    check_requirements
    
    # Create directories
    mkdir -p $LOG_DIR/{backend,postgres,redis,celery,beat}
    mkdir -p $BACKUP_DIR
    mkdir -p ./backend/storage/{books,covers}
    
    source $ENV_FILE
    
    log_info "Building images..."
    docker compose -f $COMPOSE_FILE build --no-cache
    
    log_info "Starting services..."
    docker compose -f $COMPOSE_FILE up -d
    
    log_success "Deployment initialized"
}

deploy_application() {
    log_info "Deploying application..."
    check_requirements
    
    docker compose -f $COMPOSE_FILE build
    docker compose -f $COMPOSE_FILE up -d
    
    log_success "Deployment completed"
}

show_logs() {
    docker compose -f $COMPOSE_FILE logs -f --tail=100 ${1:-}
}

backup_data() {
    log_info "Creating backup..."
    
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    BACKUP_NAME="backup_${TIMESTAMP}"
    
    mkdir -p $BACKUP_DIR/$BACKUP_NAME
    
    # Database backup
    docker compose -f $COMPOSE_FILE exec -T postgres pg_dump -U bookreader_user bookreader_prod > $BACKUP_DIR/$BACKUP_NAME/database.sql
    
    # Storage backup
    cp -r ./backend/storage $BACKUP_DIR/$BACKUP_NAME/
    
    # Config backup
    cp .env.production $BACKUP_DIR/$BACKUP_NAME/
    
    log_success "Backup created: $BACKUP_DIR/$BACKUP_NAME"
}

show_status() {
    log_info "Service status:"
    docker compose -f $COMPOSE_FILE ps
    
    log_info "Health checks:"
    curl -s -o /dev/null -w "%{http_code}" http://localhost/health || echo "Health check failed"
}

restart_services() {
    log_info "Restarting services..."
    docker compose -f $COMPOSE_FILE restart
    log_success "Services restarted"
}

stop_services() {
    log_info "Stopping services..."
    docker compose -f $COMPOSE_FILE down
    log_success "Services stopped"
}

start_services() {
    log_info "Starting services..."
    docker compose -f $COMPOSE_FILE up -d
    log_success "Services started"
}

show_help() {
    echo "BookReader AI Deploy Script"
    echo ""
    echo "Commands:"
    echo "  init     - Initialize production deployment"
    echo "  deploy   - Deploy/redeploy application"
    echo "  backup   - Create database and storage backup"
    echo "  status   - Show service status and health"
    echo "  logs     - Show logs (optional: specify service name)"
    echo "  restart  - Restart all services"
    echo "  stop     - Stop all services"
    echo "  start    - Start all services"
    echo "  help     - Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./scripts/deploy.sh init"
    echo "  ./scripts/deploy.sh logs backend"
    echo "  ./scripts/deploy.sh backup"
}

case "$1" in
    init)
        init_deployment
        ;;
    deploy)
        deploy_application
        ;;
    backup)
        backup_data
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "$2"
        ;;
    restart)
        restart_services
        ;;
    stop)
        stop_services
        ;;
    start)
        start_services
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        show_help
        ;;
esac