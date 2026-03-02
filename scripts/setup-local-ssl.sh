#!/bin/bash

# Local SSL Setup for Testing
# Use this script when DNS is not yet configured

echo "🔧 Setting up local SSL for testing..."

# Create local environment with localhost
cat > .env.production.local << EOF
# LOCAL TESTING CONFIGURATION
DOMAIN_NAME=localhost
DOMAIN_URL=https://localhost

# Database
DB_NAME=fancai_prod
DB_USER=fancai_user
DB_PASSWORD=your_secure_password_here

# Redis
REDIS_PASSWORD=your_redis_password_here

# Security
SECRET_KEY=$(openssl rand -hex 32)
JWT_SECRET_KEY=$(openssl rand -hex 32)
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=30
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7

# AI Services
OPENAI_API_KEY=
POLLINATIONS_ENABLED=true

# Performance
WORKERS_COUNT=2
LOG_LEVEL=INFO
CELERY_CONCURRENCY=2

# Frontend
VITE_API_URL=https://localhost/api/v1
VITE_WS_URL=wss://localhost/ws
VITE_APP_NAME=fancai

# Security
ALLOWED_HOSTS=localhost,127.0.0.1,fancai.ru
CORS_ORIGINS=https://localhost,https://fancai.ru
EOF

echo "✅ Created .env.production.local for local testing"

# Update nginx config for localhost
sed 's/fancai.ru/localhost/g' nginx/nginx.prod.conf > nginx/nginx.local.conf

echo "✅ Created nginx.local.conf for localhost"

# Create deployment command
cat > scripts/deploy-local.sh << 'EOF'
#!/bin/bash
echo "🚀 Deploying locally with HTTPS..."

# Use local environment
export $(cat .env.production.local | xargs)

# Deploy with local config
docker compose -f docker-compose.production.yml up -d

echo "✅ Local deployment started!"
echo "📱 Access at: https://localhost"
echo "⚠️  Accept self-signed certificate in browser"
EOF

chmod +x scripts/deploy-local.sh

echo "✅ Created scripts/deploy-local.sh"
echo ""
echo "🎯 Next steps:"
echo "1. Edit .env.production.local with your passwords"
echo "2. Run: ./scripts/deploy-local.sh"
echo "3. Access: https://localhost (accept self-signed cert)"
echo ""
echo "🌐 When DNS is ready for fancai.ru:"
echo "1. Configure A record: fancai.ru -> YOUR_SERVER_IP"
echo "2. Wait for DNS propagation (15-30 minutes)"
echo "3. Run: sudo certbot certonly --standalone -d fancai.ru"
echo "4. Use original .env.production.example"