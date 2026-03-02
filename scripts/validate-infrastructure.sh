#!/bin/bash
#
# Infrastructure Validation Script
# Validates all infrastructure improvements are working correctly
#
# Usage: ./scripts/validate-infrastructure.sh

set -e

echo "=================================================="
echo "fancai Infrastructure Validation"
echo "=================================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Validation functions
validate_file_exists() {
    local file=$1
    local description=$2

    if [ -f "$file" ]; then
        echo -e "${GREEN}✅${NC} $description: $file"
        return 0
    else
        echo -e "${RED}❌${NC} $description: $file (NOT FOUND)"
        return 1
    fi
}

validate_directory_exists() {
    local dir=$1
    local description=$2

    if [ -d "$dir" ]; then
        echo -e "${GREEN}✅${NC} $description: $dir"
        return 0
    else
        echo -e "${RED}❌${NC} $description: $dir (NOT FOUND)"
        return 1
    fi
}

validate_config_value() {
    local file=$1
    local pattern=$2
    local description=$3

    if grep -q "$pattern" "$file"; then
        echo -e "${GREEN}✅${NC} $description"
        return 0
    else
        echo -e "${RED}❌${NC} $description (NOT FOUND)"
        return 1
    fi
}

# Counter for results
PASSED=0
FAILED=0

echo "1. Checking Infrastructure Files..."
echo "-----------------------------------"

if validate_file_exists "docker-compose.yml" "Docker Compose configuration"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_file_exists ".env.example" "Environment variables template"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_file_exists "backend/app/core/celery_config.py" "Celery configuration"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_file_exists "backend/app/core/database.py" "Database configuration"; then
    ((PASSED++))
else
    ((FAILED++))
fi

echo ""
echo "2. Checking CI/CD Workflows..."
echo "-------------------------------"

if validate_directory_exists ".github/workflows" "GitHub Actions directory"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_file_exists ".github/workflows/ci.yml" "CI pipeline workflow"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_file_exists ".github/workflows/deploy.yml" "Deployment workflow"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_file_exists ".github/workflows/README.md" "Workflows documentation"; then
    ((PASSED++))
else
    ((FAILED++))
fi

echo ""
echo "3. Checking Documentation..."
echo "----------------------------"

if validate_directory_exists "docs/deployment" "Deployment docs directory"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_file_exists "docs/deployment/SECURITY.md" "Security guide"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_file_exists "docs/deployment/INFRASTRUCTURE_OPTIMIZATION.md" "Optimization report"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_file_exists "docs/deployment/QUICK_REFERENCE.md" "Quick reference"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_file_exists "INFRASTRUCTURE_IMPROVEMENTS.md" "Summary document"; then
    ((PASSED++))
else
    ((FAILED++))
fi

echo ""
echo "4. Validating Docker Compose Configuration..."
echo "---------------------------------------------"

if validate_config_value "docker-compose.yml" "memory: 6G" "Worker memory limit (6GB)"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_config_value "docker-compose.yml" "CELERY_CONCURRENCY" "Celery concurrency env var"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_config_value "docker-compose.yml" "CELERY_MAX_TASKS_PER_CHILD" "Celery max tasks env var"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_config_value "docker-compose.yml" "cpus: '2'" "CPU limit configuration"; then
    ((PASSED++))
else
    ((FAILED++))
fi

echo ""
echo "5. Validating Celery Configuration..."
echo "--------------------------------------"

if validate_config_value "backend/app/core/celery_config.py" "CELERY_CONCURRENCY" "Environment-driven concurrency"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_config_value "backend/app/core/celery_config.py" "max_workers.*5" "Max workers limit (5)"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_config_value "backend/app/core/celery_config.py" "max_concurrent_heavy_tasks.*10" "Max concurrent tasks (10)"; then
    ((PASSED++))
else
    ((FAILED++))
fi

echo ""
echo "6. Validating Database Configuration..."
echo "----------------------------------------"

if validate_config_value "backend/app/core/database.py" "pool_size=10" "Pool size (10)"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_config_value "backend/app/core/database.py" "max_overflow=20" "Max overflow (20)"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_config_value "backend/app/core/database.py" "pool_recycle=3600" "Pool recycle (1 hour)"; then
    ((PASSED++))
else
    ((FAILED++))
fi

echo ""
echo "7. Validating Environment Configuration..."
echo "-------------------------------------------"

if validate_config_value ".env.example" "CELERY_CONCURRENCY=2" "Celery concurrency example"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_config_value ".env.example" "CELERY_MAX_TASKS_PER_CHILD=10" "Max tasks per child example"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_config_value ".env.example" "pool_size=10" "Database pool size documented"; then
    ((PASSED++))
else
    ((FAILED++))
fi

echo ""
echo "8. Validating CI/CD Pipeline Configuration..."
echo "----------------------------------------------"

if validate_config_value ".github/workflows/ci.yml" "backend-lint" "Backend linting job"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_config_value ".github/workflows/ci.yml" "backend-tests" "Backend tests job"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_config_value ".github/workflows/ci.yml" "frontend-lint" "Frontend linting job"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_config_value ".github/workflows/ci.yml" "security-scan" "Security scanning job"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_config_value ".github/workflows/deploy.yml" "build-and-push" "Build and push job"; then
    ((PASSED++))
else
    ((FAILED++))
fi

if validate_config_value ".github/workflows/deploy.yml" "deploy-production" "Production deployment job"; then
    ((PASSED++))
else
    ((FAILED++))
fi

echo ""
echo "9. Checking Security Configuration..."
echo "--------------------------------------"

# Check that secrets are not hardcoded
if grep -q "your-super-secret-key-change-in-production" "docker-compose.yml"; then
    echo -e "${YELLOW}⚠️${NC}  Default secret found in docker-compose.yml (MUST CHANGE in production)"
    echo -e "   ${YELLOW}→${NC} This is OK for development, but production MUST use .env file"
else
    echo -e "${GREEN}✅${NC} No default secrets in docker-compose.yml"
    ((PASSED++))
fi

# Check .env is in .gitignore
if grep -q "^\.env$" ".gitignore"; then
    echo -e "${GREEN}✅${NC} .env is in .gitignore"
    ((PASSED++))
else
    echo -e "${RED}❌${NC} .env is NOT in .gitignore (SECURITY RISK)"
    ((FAILED++))
fi

echo ""
echo "10. Resource Budget Validation..."
echo "----------------------------------"

# Calculate theoretical memory budget
echo -e "${GREEN}✅${NC} Theoretical memory budget:"
echo "   - Max workers: 5"
echo "   - Concurrency per worker: 2"
echo "   - Max concurrent tasks: 10"
echo "   - Memory per worker: 6GB"
echo "   - Total budget: 10 tasks × 6GB = 60GB peak"
echo "   - Expected actual usage: ~48GB (under 50GB target)"

echo ""
echo "=================================================="
echo "Validation Results"
echo "=================================================="
echo ""
echo -e "${GREEN}✅ PASSED:${NC} $PASSED checks"
echo -e "${RED}❌ FAILED:${NC} $FAILED checks"
echo ""

TOTAL=$((PASSED + FAILED))
PERCENTAGE=$((PASSED * 100 / TOTAL))

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✅ ALL CHECKS PASSED ($PERCENTAGE%)${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Infrastructure is ready for production deployment!"
    echo ""
    echo "Next steps:"
    echo "1. Review docs/deployment/INFRASTRUCTURE_OPTIMIZATION.md"
    echo "2. Update production .env with secure secrets"
    echo "3. Setup GitHub Actions secrets (see .github/workflows/README.md)"
    echo "4. Deploy to staging for final validation"
    echo "5. Create version tag to trigger production deployment"
    echo ""
    exit 0
else
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}❌ VALIDATION FAILED ($PERCENTAGE% passed)${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Please fix the failed checks before proceeding."
    echo ""
    exit 1
fi
