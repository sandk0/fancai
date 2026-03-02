#!/bin/bash

# fancai Monitoring Setup Script
# This script sets up Grafana, Prometheus, and Loki for monitoring

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

setup_monitoring() {
    log_info "Setting up monitoring stack..."
    
    # Create directories if they don't exist
    mkdir -p ./monitoring/{grafana/{data,dashboards,datasources},prometheus/data,loki/data,promtail}
    mkdir -p ./logs/{nginx,backend,postgres,redis,celery,beat}
    
    # Set permissions for Grafana
    chmod 777 ./monitoring/grafana/data
    
    # Set permissions for Prometheus
    chmod 777 ./monitoring/prometheus/data
    
    # Set permissions for Loki
    chmod 777 ./monitoring/loki/data
    
    log_success "Directories created and permissions set"
}

start_monitoring() {
    log_info "Starting monitoring services..."
    
    # Load environment variables
    if [ -f .env.production ]; then
        source .env.production
    else
        log_error "Environment file .env.production not found"
        exit 1
    fi
    
    # Start monitoring stack
    docker-compose -f docker-compose.monitoring.yml up -d
    
    log_success "Monitoring services started"
    log_info "Grafana UI: http://localhost:3000 (admin/${GRAFANA_PASSWORD})"
    log_info "Prometheus UI: http://localhost:9090"
    log_info "cAdvisor UI: http://localhost:8080"
}

stop_monitoring() {
    log_info "Stopping monitoring services..."
    docker-compose -f docker-compose.monitoring.yml down
    log_success "Monitoring services stopped"
}

show_status() {
    log_info "Monitoring services status:"
    docker-compose -f docker-compose.monitoring.yml ps
}

show_logs() {
    SERVICE=${1:-}
    if [ -z "$SERVICE" ]; then
        docker-compose -f docker-compose.monitoring.yml logs -f --tail=100
    else
        docker-compose -f docker-compose.monitoring.yml logs -f --tail=100 "$SERVICE"
    fi
}

create_dashboard() {
    log_info "Creating basic fancai dashboard..."
    
    cat > ./monitoring/grafana/dashboards/fancai-dashboard.json << 'EOF'
{
  "dashboard": {
    "id": null,
    "title": "fancai Dashboard",
    "tags": ["fancai"],
    "timezone": "browser",
    "panels": [
      {
        "title": "System CPU Usage",
        "type": "stat",
        "targets": [
          {
            "expr": "100 - (avg by (instance) (rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100)",
            "legendFormat": "CPU Usage %"
          }
        ]
      },
      {
        "title": "System Memory Usage",
        "type": "stat",
        "targets": [
          {
            "expr": "(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100",
            "legendFormat": "Memory Usage %"
          }
        ]
      },
      {
        "title": "HTTP Response Times",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "95th percentile"
          }
        ]
      }
    ],
    "time": {
      "from": "now-1h",
      "to": "now"
    },
    "refresh": "30s"
  }
}
EOF
    
    log_success "Dashboard template created"
}

show_help() {
    echo "fancai Monitoring Setup Script"
    echo ""
    echo "Commands:"
    echo "  setup    - Create directories and set permissions"
    echo "  start    - Start monitoring services (Grafana, Prometheus, Loki)"
    echo "  stop     - Stop monitoring services"
    echo "  status   - Show monitoring services status"
    echo "  logs     - Show logs (optional: specify service name)"
    echo "  dashboard- Create basic dashboard template"
    echo "  help     - Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./scripts/setup-monitoring.sh setup"
    echo "  ./scripts/setup-monitoring.sh start"
    echo "  ./scripts/setup-monitoring.sh logs grafana"
}

case "$1" in
    setup)
        setup_monitoring
        ;;
    start)
        start_monitoring
        ;;
    stop)
        stop_monitoring
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "$2"
        ;;
    dashboard)
        create_dashboard
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        show_help
        ;;
esac