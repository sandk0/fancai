#!/bin/bash
# Infrastructure Health Check Script for fancai
# This script validates all infrastructure configurations and security settings

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0
CHECKS=0

echo "============================================"
echo "fancai - Infrastructure Health Check"
echo "============================================"
echo ""

# Helper functions
check_pass() {
    echo -e "${GREEN}✅ PASS${NC}: $1"
    CHECKS=$((CHECKS + 1))
}

check_fail() {
    echo -e "${RED}❌ FAIL${NC}: $1"
    ERRORS=$((ERRORS + 1))
    CHECKS=$((CHECKS + 1))
}

check_warn() {
    echo -e "${YELLOW}⚠️  WARN${NC}: $1"
    WARNINGS=$((WARNINGS + 1))
    CHECKS=$((CHECKS + 1))
}

# Section 1: Docker Compose Validation
echo "=== 1. Docker Compose Configuration ==="
echo ""

# Check dev docker-compose syntax
if docker compose -f docker-compose.dev.yml config > /dev/null 2>&1; then
    check_pass "docker-compose.dev.yml syntax is valid"
else
    check_fail "docker-compose.dev.yml has syntax errors"
fi

# Check production docker-compose syntax
if docker compose -f docker-compose.prod.yml config > /dev/null 2>&1; then
    check_pass "docker-compose.prod.yml syntax is valid"
else
    check_fail "docker-compose.prod.yml has syntax errors"
fi

# Check for version field (should not exist in Compose V2)
if grep -q "^version:" docker-compose.dev.yml 2>/dev/null; then
    check_fail "docker-compose.dev.yml contains obsolete 'version' field"
else
    check_pass "docker-compose.dev.yml follows Compose V2 format (no version field)"
fi

# Check for health checks in prod compose
HEALTH_CHECKS=$(grep -c "healthcheck:" docker-compose.prod.yml || true)
if [ "$HEALTH_CHECKS" -ge 4 ]; then
    check_pass "Health checks configured for all services ($HEALTH_CHECKS found)"
else
    check_warn "Only $HEALTH_CHECKS health checks found (expected 4+)"
fi

echo ""

# Section 2: Dockerfile Security
echo "=== 2. Dockerfile Security & Optimization ==="
echo ""

# Check backend production Dockerfile
if [ -f backend/Dockerfile.prod ]; then
    # Check for non-root user
    if grep -q "useradd\|adduser" backend/Dockerfile.prod; then
        check_pass "Backend Dockerfile creates non-root user"
    else
        check_warn "Backend Dockerfile may be running as root"
    fi

    # Check for health check
    if grep -q "HEALTHCHECK" backend/Dockerfile.prod; then
        check_pass "Backend Dockerfile includes HEALTHCHECK"
    else
        check_warn "Backend Dockerfile missing HEALTHCHECK instruction"
    fi

    # Check for multi-stage build
    if grep -q "FROM.*as\|FROM.*AS" backend/Dockerfile.prod; then
        check_pass "Backend Dockerfile uses multi-stage build"
    else
        check_warn "Backend Dockerfile not using multi-stage build"
    fi
else
    check_fail "backend/Dockerfile.prod not found"
fi

# Check frontend production Dockerfile
if [ -f frontend/Dockerfile.prod ]; then
    if grep -q "FROM.*AS\|FROM.*as" frontend/Dockerfile.prod; then
        check_pass "Frontend Dockerfile uses multi-stage build"
    else
        check_fail "Frontend Dockerfile should use multi-stage build"
    fi
else
    check_fail "frontend/Dockerfile.prod not found"
fi

echo ""

# Section 3: .dockerignore files
echo "=== 3. Docker Build Optimization ==="
echo ""

if [ -f backend/.dockerignore ]; then
    check_pass "Backend .dockerignore exists"
    IGNORE_COUNT=$(wc -l < backend/.dockerignore)
    if [ "$IGNORE_COUNT" -gt 20 ]; then
        check_pass "Backend .dockerignore is comprehensive ($IGNORE_COUNT entries)"
    else
        check_warn "Backend .dockerignore may need more entries ($IGNORE_COUNT found)"
    fi
else
    check_fail "Backend .dockerignore missing (builds will be slower and larger)"
fi

if [ -f frontend/.dockerignore ]; then
    check_pass "Frontend .dockerignore exists"
else
    check_fail "Frontend .dockerignore missing"
fi

echo ""

# Section 4: Security & Secrets
echo "=== 4. Security & Secrets Management ==="
echo ""

# Check for exposed secrets in code
if grep -r "sk-[a-zA-Z0-9]\{20,\}" --exclude-dir=node_modules --exclude-dir=.git --exclude="*.md" . 2>/dev/null | grep -v ".env.example" | grep -q .; then
    check_fail "Potential API keys found in codebase!"
else
    check_pass "No exposed API keys found in codebase"
fi

# Check for hardcoded passwords in production configs
if grep -E "password.*=.*(123|test|admin|root)" docker-compose.prod.yml 2>/dev/null | grep -v "\${" | grep -q .; then
    check_fail "Hardcoded passwords found in production config!"
else
    check_pass "No hardcoded passwords in production config"
fi

# Check .env.production exists (production environment)
if [ -f .env.production ]; then
    check_pass ".env.production file exists"
else
    check_warn ".env.production not found (required for production deployment)"
fi

# Check for .env in .gitignore
if grep -q "^\.env$" .gitignore 2>/dev/null; then
    check_pass ".env is ignored by git"
else
    check_fail ".env should be in .gitignore"
fi

echo ""

# Section 5: CI/CD Workflows
echo "=== 5. CI/CD Pipeline Validation ==="
echo ""

if [ -d .github/workflows ]; then
    # Check for deprecated actions
    DEPRECATED_ACTIONS=$(grep -r "actions/checkout@v[12]" .github/workflows 2>/dev/null | wc -l || echo 0)
    if [ "$DEPRECATED_ACTIONS" -eq 0 ]; then
        check_pass "No deprecated GitHub Actions found"
    else
        check_warn "$DEPRECATED_ACTIONS deprecated actions found (upgrade to v3+)"
    fi

    # Check for security scanning
    if grep -q "trivy" .github/workflows/*.yml 2>/dev/null; then
        check_pass "Security scanning (Trivy) configured in CI"
    else
        check_warn "No security scanning in CI pipeline"
    fi

    # Check for test coverage
    if grep -q "codecov\|coverage" .github/workflows/*.yml 2>/dev/null; then
        check_pass "Code coverage tracking configured"
    else
        check_warn "No code coverage tracking in CI"
    fi
else
    check_warn "No GitHub Actions workflows found"
fi

echo ""

# Section 6: Database Configuration (if running)
echo "=== 6. Database Configuration ==="
echo ""

if docker compose ps postgres | grep -q "Up"; then
    # Check PostgreSQL version
    PG_VERSION=$(docker compose exec -T postgres psql -U postgres -t -c "SELECT version();" 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo "unknown")
    if [[ "$PG_VERSION" =~ ^1[5-9]\. ]]; then
        check_pass "PostgreSQL version is modern ($PG_VERSION)"
    else
        check_warn "PostgreSQL version may be outdated ($PG_VERSION)"
    fi

    # Check for connection limit
    MAX_CONN=$(docker compose exec -T postgres psql -U postgres -t -c "SHOW max_connections;" 2>/dev/null | tr -d '[:space:]')
    if [ "$MAX_CONN" -ge 100 ]; then
        check_pass "PostgreSQL max_connections is adequate ($MAX_CONN)"
    else
        check_warn "PostgreSQL max_connections may be too low ($MAX_CONN)"
    fi
else
    check_warn "PostgreSQL container not running (skipping live checks)"
fi

echo ""

# Section 7: Redis Configuration (if running)
echo "=== 7. Redis Configuration ==="
echo ""

if docker compose ps redis | grep -q "Up"; then
    # Check Redis version
    REDIS_VERSION=$(docker compose exec -T redis redis-cli INFO server 2>/dev/null | grep "redis_version" | cut -d: -f2 | tr -d '\r' || echo "unknown")
    if [[ "$REDIS_VERSION" =~ ^[6-9]\. ]]; then
        check_pass "Redis version is modern ($REDIS_VERSION)"
    else
        check_warn "Redis version may be outdated ($REDIS_VERSION)"
    fi

    # Check for password protection (from compose config)
    if docker compose config | grep -q "requirepass"; then
        check_pass "Redis is password protected"
    else
        check_fail "Redis should be password protected"
    fi
else
    check_warn "Redis container not running (skipping live checks)"
fi

echo ""

# Section 8: Resource Limits
echo "=== 8. Resource Limits & Optimization ==="
echo ""

# Check for resource limits in compose files
MEMORY_LIMITS_DEV=$(grep -c "memory:" docker-compose.yml 2>/dev/null || echo 0)
MEMORY_LIMITS_PROD=$(grep -c "memory:" docker-compose.prod.yml 2>/dev/null || echo 0)
MEMORY_LIMITS=$((MEMORY_LIMITS_DEV + MEMORY_LIMITS_PROD))
if [ "$MEMORY_LIMITS" -ge 4 ]; then
    check_pass "Memory limits configured for services ($MEMORY_LIMITS found)"
else
    check_warn "Missing memory limits for some services (found $MEMORY_LIMITS)"
fi

# Check for CPU limits
CPU_LIMITS_DEV=$(grep "cpus:" docker-compose.yml 2>/dev/null | wc -l | tr -d ' ')
CPU_LIMITS_PROD=$(grep "cpus:" docker-compose.prod.yml 2>/dev/null | wc -l | tr -d ' ')
CPU_LIMITS=$((CPU_LIMITS_DEV + CPU_LIMITS_PROD))
if [ "$CPU_LIMITS" -ge 1 ]; then
    check_pass "CPU limits configured ($CPU_LIMITS services)"
else
    check_warn "Consider adding CPU limits to prevent resource starvation (found $CPU_LIMITS)"
fi

echo ""

# Final Summary
echo "============================================"
echo "Summary:"
echo "============================================"
echo -e "Total Checks:   ${CHECKS}"
echo -e "Passed:         ${GREEN}$((CHECKS - ERRORS - WARNINGS))${NC}"
echo -e "Warnings:       ${YELLOW}${WARNINGS}${NC}"
echo -e "Failures:       ${RED}${ERRORS}${NC}"
echo ""

if [ "$ERRORS" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
    echo -e "${GREEN}🎉 Perfect! All infrastructure checks passed!${NC}"
    exit 0
elif [ "$ERRORS" -eq 0 ]; then
    echo -e "${YELLOW}⚠️  Infrastructure is good but has ${WARNINGS} warnings to address${NC}"
    exit 0
else
    echo -e "${RED}❌ Infrastructure has ${ERRORS} critical issues that need fixing!${NC}"
    exit 1
fi
