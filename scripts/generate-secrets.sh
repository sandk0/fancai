#!/bin/bash
# Generate Strong Secrets for fancai
# Usage: ./scripts/generate-secrets.sh [environment]
# Example: ./scripts/generate-secrets.sh development

set -e

ENVIRONMENT=${1:-development}
OUTPUT_FILE=".env.$ENVIRONMENT"

echo "========================================="
echo "  fancai - Secret Generator"
echo "========================================="
echo ""
echo "Environment: $ENVIRONMENT"
echo "Output file: $OUTPUT_FILE"
echo ""

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "ERROR: python3 is not installed"
    exit 1
fi

# Warn if file exists
if [ -f "$OUTPUT_FILE" ]; then
    echo "⚠️  WARNING: $OUTPUT_FILE already exists!"
    read -p "Overwrite? (yes/no): " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
        echo "Aborted."
        exit 0
    fi
    mv "$OUTPUT_FILE" "$OUTPUT_FILE.backup.$(date +%Y%m%d_%H%M%S)"
    echo "✅ Backed up existing file"
fi

echo ""
echo "Generating secrets..."
echo ""

# Generate secrets using Python
python3 << 'EOF' > "$OUTPUT_FILE"
import secrets
import sys

print("# fancai Environment Variables")
print(f"# Generated: {__import__('datetime').datetime.now().isoformat()}")
print("# DO NOT COMMIT THIS FILE TO GIT!")
print()
print("# =============================================================================")
print("# ENVIRONMENT")
print("# =============================================================================")
print("ENVIRONMENT=" + sys.argv[1] if len(sys.argv) > 1 else "development")
print("DEBUG=" + ("true" if sys.argv[1] == "development" else "false"))
print()
print("# =============================================================================")
print("# DOMAIN CONFIGURATION")
print("# =============================================================================")
print("DOMAIN_NAME=localhost")
print("DOMAIN_URL=http://localhost")
print("SSL_EMAIL=admin@your-domain.com")
print()
print("# =============================================================================")
print("# DATABASE SETTINGS")
print("# =============================================================================")
print("DB_NAME=fancai_dev" if sys.argv[1] == "development" else "fancai_prod")
print("DB_USER=postgres" if sys.argv[1] == "development" else "fancai_user")
print(f"DB_PASSWORD={secrets.token_urlsafe(32)}")
print()
print("# Full database URL (constructed from above)")
print("DATABASE_URL=postgresql+asyncpg://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}")
print()
print("# =============================================================================")
print("# REDIS SETTINGS")
print("# =============================================================================")
print(f"REDIS_PASSWORD={secrets.token_urlsafe(32)}")
print("REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379")
print()
print("# =============================================================================")
print("# SECURITY SECRETS (CRITICAL!)")
print("# =============================================================================")
print(f"SECRET_KEY={secrets.token_urlsafe(64)}")
print(f"JWT_SECRET_KEY={secrets.token_urlsafe(64)}")
print("JWT_ACCESS_TOKEN_EXPIRE_MINUTES=30")
print("JWT_REFRESH_TOKEN_EXPIRE_DAYS=7")
print()
print("# =============================================================================")
print("# AI SERVICES")
print("# =============================================================================")
print("OPENAI_API_KEY=")
print()
print("# =============================================================================")
print("# CELERY WORKER CONFIGURATION")
print("# =============================================================================")
print("CELERY_CONCURRENCY=2")
print("CELERY_MAX_TASKS_PER_CHILD=10")
print("CELERY_WORKER_MAX_MEMORY_PER_CHILD=5000000")
print("CELERY_BROKER_URL=redis://:${REDIS_PASSWORD}@redis:6379/1")
print("CELERY_RESULT_BACKEND=redis://:${REDIS_PASSWORD}@redis:6379/2")
print()
print("# =============================================================================")
print("# APPLICATION PERFORMANCE")
print("# =============================================================================")
print("WORKERS_COUNT=4")
print("LOG_LEVEL=" + ("DEBUG" if sys.argv[1] == "development" else "INFO"))
print()
print("# =============================================================================")
print("# SECURITY & CORS")
print("# =============================================================================")
print("CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000")
print("ALLOWED_HOSTS=localhost,127.0.0.1")
print()
print("# =============================================================================")
print("# FRONTEND BUILD VARIABLES")
print("# =============================================================================")
print("VITE_API_URL=http://localhost:8000/api/v1")
print("VITE_WS_URL=ws://localhost:8000")
print("VITE_APP_NAME=fancai")
print("REACT_APP_API_URL=http://localhost:8000")
print("REACT_APP_WS_URL=ws://localhost:8000")
print()
print("# =============================================================================")
print("# MONITORING (OPTIONAL)")
print("# =============================================================================")
print("PROMETHEUS_ENABLED=false")
print("PROMETHEUS_PORT=9090")
print("GRAFANA_USER=admin")
print(f"GRAFANA_PASSWORD={secrets.token_urlsafe(24)}")
print()
print("# =============================================================================")
print("# PGADMIN (DEV ONLY)")
print("# =============================================================================")
print("PGADMIN_EMAIL=admin@fancai.local")
print(f"PGADMIN_PASSWORD={secrets.token_urlsafe(24)}")
print()
print("# =============================================================================")
print("# FILE UPLOAD LIMITS")
print("# =============================================================================")
print("MAX_FILE_SIZE=52428800")
print("UPLOAD_MAX_SIZE=52428800")
EOF

# Pass environment to Python script
if [ $? -eq 0 ]; then
    echo "✅ Secrets generated successfully!"
    echo ""
    echo "📄 Output file: $OUTPUT_FILE"
    echo ""
    echo "⚠️  IMPORTANT SECURITY NOTES:"
    echo "  1. Never commit $OUTPUT_FILE to git"
    echo "  2. Store secrets securely (password manager, vault)"
    echo "  3. Rotate secrets quarterly"
    echo "  4. Use different secrets for each environment"
    echo ""

    if [ "$ENVIRONMENT" = "production" ]; then
        echo "🔒 PRODUCTION ENVIRONMENT DETECTED!"
        echo "  • Update DOMAIN_NAME and DOMAIN_URL"
        echo "  • Update SSL_EMAIL"
        echo "  • Review all settings before deployment"
        echo "  • Backup this file in a secure location"
        echo ""
    fi

    echo "Next steps:"
    echo "  1. Review and edit $OUTPUT_FILE if needed"
    echo "  2. Load environment: export \$(cat $OUTPUT_FILE | xargs)"
    echo "  3. Start services: docker-compose up -d"
    echo ""
else
    echo "❌ Error generating secrets"
    exit 1
fi

# Set appropriate permissions
chmod 600 "$OUTPUT_FILE"
echo "✅ File permissions set to 600 (owner read/write only)"
echo ""
echo "========================================="
echo "  Generation Complete!"
echo "========================================="
