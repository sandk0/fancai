# CI/CD Setup Guide for BookReader AI

Complete guide for setting up and configuring the CI/CD pipeline for BookReader AI.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [GitHub Secrets Configuration](#github-secrets-configuration)
- [Workflow Configuration](#workflow-configuration)
- [Branch Protection Rules](#branch-protection-rules)
- [Environment Setup](#environment-setup)
- [Testing the Pipeline](#testing-the-pipeline)
- [Troubleshooting](#troubleshooting)

---

## Overview

BookReader AI uses **GitHub Actions** for continuous integration and deployment with the following workflows:

| Workflow | Purpose | Trigger | Duration |
|----------|---------|---------|----------|
| `ci.yml` | Code quality, tests, security | Push/PR | ~8-12 min |
| `security.yml` | Comprehensive security scanning | Push/PR/Weekly | ~15-20 min |
| `performance.yml` | Performance testing and optimization | Push to main/Weekly | ~10-15 min |
| `type-check.yml` | MyPy type checking | Push/PR | ~3-5 min |
| `deploy.yml` | Production deployment | Tags/Manual | ~5-10 min |
| `tests-reading-sessions.yml` | Specific feature tests | Push/PR | ~5-8 min |

**Total CI time per PR**: ~12-15 minutes (parallel execution)

---

## Prerequisites

Before setting up CI/CD, ensure you have:

- [ ] GitHub repository with admin access
- [ ] Production server (VPS/Cloud) with SSH access
- [ ] Docker and Docker Compose installed on production server
- [ ] Domain name configured (optional, for SSL)
- [ ] GitHub Container Registry access (automatic with GitHub)
- [ ] Codecov account (optional, for coverage reports)

---

## Initial Setup

### Step 1: Clone and Verify Repository

```bash
# Clone repository
git clone https://github.com/YOUR_USERNAME/fancai-vibe-hackathon.git
cd fancai-vibe-hackathon

# Verify workflow files exist
ls -la .github/workflows/
```

Expected files:
- `ci.yml` - Main CI pipeline
- `security.yml` - Security scanning
- `performance.yml` - Performance tests
- `type-check.yml` - Type checking
- `deploy.yml` - Deployment
- `tests-reading-sessions.yml` - Feature tests

### Step 2: Verify Dependencies

**Backend:**
```bash
cd backend
pip install -r requirements.txt
pytest --version
ruff --version
black --version
mypy --version
```

**Frontend:**
```bash
cd frontend
npm install
npm run lint
npm run type-check
npm test -- --run
```

### Step 3: Enable GitHub Actions

1. Go to repository **Settings**
2. Navigate to **Actions** → **General**
3. Ensure **Allow all actions and reusable workflows** is selected
4. Enable **Read and write permissions** for GITHUB_TOKEN

---

## GitHub Secrets Configuration

### Required Secrets

Navigate to: **Settings → Secrets and variables → Actions → New repository secret**

#### Production Deployment

```
PROD_SSH_KEY
  Description: SSH private key for production server
  How to generate: See "SSH Key Generation" below

PROD_HOST
  Description: Production server IP or hostname
  Example: 203.0.113.10 or bookreader.example.com

PROD_USER
  Description: SSH username for deployment
  Example: deploy or ubuntu
```

#### Staging Deployment (Optional)

```
STAGING_SSH_KEY
  Description: SSH private key for staging server

STAGING_HOST
  Description: Staging server IP or hostname

STAGING_USER
  Description: SSH username
```

#### External Services (Optional)

```
CODECOV_TOKEN
  Description: Token for coverage uploads
  Get from: https://codecov.io

SLACK_WEBHOOK_URL
  Description: Webhook for deployment notifications
  Get from: Slack workspace → Apps → Incoming Webhooks

GIST_SECRET
  Description: Token for type coverage badge
  Get from: GitHub Settings → Developer settings → Personal access tokens
```

### SSH Key Generation

```bash
# Generate SSH key pair for GitHub Actions
ssh-keygen -t ed25519 -f ~/.ssh/github-actions-deploy -C "github-actions@bookreader"

# Display private key (add to PROD_SSH_KEY secret)
cat ~/.ssh/github-actions-deploy
# Copy the ENTIRE output including:
# -----BEGIN OPENSSH PRIVATE KEY-----
# ... key content ...
# -----END OPENSSH PRIVATE KEY-----

# Display public key (add to production server)
cat ~/.ssh/github-actions-deploy.pub
```

### Add Public Key to Production Server

```bash
# SSH to production server
ssh your-user@prod-server

# Add public key to authorized_keys
mkdir -p ~/.ssh
chmod 700 ~/.ssh
echo "PUBLIC_KEY_CONTENT_HERE" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# Test connection from local machine
ssh -i ~/.ssh/github-actions-deploy deploy@prod-server
```

---

## Workflow Configuration

### CI Workflow (`ci.yml`)

**Default Configuration:**
- Python: 3.11
- Node.js: 18
- PostgreSQL: 15-alpine
- Redis: 7-alpine

**Customization Options:**

```yaml
# Change Python version
env:
  PYTHON_VERSION: '3.12'  # Update here

# Adjust test timeout
- name: Run tests
  timeout-minutes: 30  # Increase if needed

# Modify coverage threshold
- name: Upload coverage
  with:
    fail_ci_if_error: true  # Fail on coverage < 70%
```

### Security Workflow (`security.yml`)

**Enabled Scans:**
- Dependency scanning (pip-audit, safety, npm audit)
- SAST (Bandit for Python, ESLint security for JS/TS)
- CodeQL analysis
- Docker security (Trivy)
- Secrets detection (TruffleHog, Gitleaks)
- License compliance

**Schedule Configuration:**
```yaml
schedule:
  - cron: '0 9 * * 1'  # Every Monday at 9 AM UTC
```

To change schedule:
```yaml
schedule:
  - cron: '0 2 * * *'  # Daily at 2 AM UTC
  - cron: '0 9 * * 5'  # Every Friday at 9 AM UTC
```

### Performance Workflow (`performance.yml`)

**Default Configuration:**
- Load test duration: 60 seconds
- Concurrent users: 10
- Bundle size limit: 5MB

**Manual Trigger with Custom Parameters:**
1. Go to **Actions** tab
2. Select **Performance Testing** workflow
3. Click **Run workflow**
4. Enter custom values:
   - Duration: 120 (seconds)
   - Users: 50 (concurrent)

### Deployment Workflow (`deploy.yml`)

**Trigger Methods:**

1. **Automatic (via Git tag):**
```bash
git tag -a v1.0.0 -m "Release version 1.0.0"
git push origin v1.0.0
```

2. **Manual:**
- Go to **Actions** tab
- Select **Deploy to Production** workflow
- Click **Run workflow**
- Select environment (staging/production)

**Deployment Features:**
- Automated database backup before production deploy
- Blue-green deployment strategy
- Health checks with retries
- Automatic rollback on failure
- Zero-downtime deployment

---

## Branch Protection Rules

Configure branch protection for `main` branch:

**Navigate to:** Settings → Branches → Add rule

### Configuration

```yaml
Branch name pattern: main

Protection Rules:
  ✅ Require a pull request before merging
    - Required approvals: 1
    - Dismiss stale reviews: true

  ✅ Require status checks to pass before merging
    - Require branches to be up to date
    - Status checks required:
      - Backend Linting
      - Backend Tests
      - Frontend Linting
      - Frontend Tests
      - Security Scanning
      - MyPy Type Checking
      - All Checks Passed

  ✅ Require conversation resolution before merging

  ✅ Require signed commits (optional, recommended)

  ✅ Include administrators (enforce for everyone)

  ❌ Allow force pushes: false
  ❌ Allow deletions: false
```

**Detailed guide:** See [BRANCH_PROTECTION_RULES.md](./BRANCH_PROTECTION_RULES.md)

---

## Environment Setup

### Production Environment Configuration

1. **Create Environment:**
   - Go to **Settings → Environments**
   - Click **New environment**
   - Name: `production`

2. **Environment Protection Rules:**
   ```
   ✅ Required reviewers: 1-6 people
   ✅ Wait timer: 5 minutes (optional delay)
   ✅ Deployment branches: Only main branch
   ```

3. **Environment Secrets:**
   Add production-specific secrets if different from repository secrets.

### Staging Environment (Optional)

Create similar environment named `staging` with:
- Required reviewers: 0 (automatic deployment)
- Deployment branches: main, develop

---

## Testing the Pipeline

### Test 1: Verify CI on Pull Request

```bash
# Create test branch
git checkout -b test-ci-pipeline

# Make a small change
echo "# Testing CI/CD" >> README.md

# Commit and push
git add README.md
git commit -m "test(ci): verify CI/CD pipeline"
git push origin test-ci-pipeline

# Create pull request on GitHub
# Expected: All checks should run and pass
```

**What to check:**
- [ ] All workflows triggered
- [ ] No failing tests
- [ ] Security scans pass
- [ ] Type checking passes
- [ ] All status checks green

### Test 2: Security Scanning

```bash
# Trigger security scan manually
# Go to Actions → Security Scanning → Run workflow

# Wait for completion (~15-20 minutes)

# Check results:
# - No critical vulnerabilities
# - No secrets detected
# - License compliance OK
```

### Test 3: Deployment (Staging)

```bash
# Deploy to staging manually
# Go to Actions → Deploy to Production → Run workflow
# Select environment: staging

# Monitor deployment:
# 1. Build and push images
# 2. SSH to staging server
# 3. Pull images and restart containers
# 4. Health check passes

# Verify staging site:
curl https://staging.bookreader.example.com/api/health
```

### Test 4: Performance Testing

```bash
# Trigger performance test
# Go to Actions → Performance Testing → Run workflow
# Optional: Set custom duration (120s) and users (25)

# Review results:
# - Lighthouse score
# - Bundle size analysis
# - Load test metrics
# - Database performance
```

---

## Troubleshooting

### Issue 1: CI Tests Failing

**Symptoms:** Tests pass locally but fail in CI

**Causes:**
- Environment differences (Python/Node versions)
- Missing dependencies
- Database connection issues
- Timezone differences

**Solutions:**

```bash
# Check Python version matches
python --version  # Should match PYTHON_VERSION in workflow

# Check Node version matches
node --version  # Should match NODE_VERSION in workflow

# Run tests in clean Docker environment
docker-compose -f docker-compose.test.yml up --abort-on-container-exit

# Check test dependencies
cd backend && pip freeze | grep pytest
cd frontend && npm list | grep vitest
```

**Enable debug logging:**
```yaml
# Add to workflow file temporarily
env:
  ACTIONS_RUNNER_DEBUG: true
  ACTIONS_STEP_DEBUG: true
```

### Issue 2: Security Scan Failures

**High/Critical Vulnerabilities Found:**

```bash
# Review dependency scan results
# Go to Actions → Security Scanning → Latest run → Artifacts

# Download reports
# backend-dependency-scan/pip-audit-report.json
# frontend-dependency-scan/npm-audit-report.json

# Update vulnerable dependencies
cd backend
pip list --outdated
pip install --upgrade PACKAGE_NAME

cd frontend
npm audit fix
npm audit fix --force  # Use with caution
```

**Secrets Detected:**

```bash
# If TruffleHog/Gitleaks finds secrets:

# 1. Immediately rotate all leaked secrets
# 2. Remove from git history
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch path/to/secret-file' \
  --prune-empty --tag-name-filter cat -- --all

# 3. Force push (WARNING: coordinate with team)
git push origin --force --all
```

### Issue 3: Deployment Failures

**SSH Connection Failed:**

```bash
# Test SSH connection manually
ssh -i ~/.ssh/github-actions-deploy deploy@prod-server

# Check SSH key format in GitHub secret
# Must include header/footer:
-----BEGIN OPENSSH PRIVATE KEY-----
...
-----END OPENSSH PRIVATE KEY-----

# Verify authorized_keys on server
cat ~/.ssh/authorized_keys
```

**Health Check Failed:**

```bash
# SSH to production server
ssh deploy@prod-server

# Check container logs
cd /opt/bookreader
docker-compose logs backend --tail=100
docker-compose logs frontend --tail=100

# Check container status
docker-compose ps

# Check environment variables
docker-compose exec backend env | grep DATABASE_URL
```

**Docker Image Build Failed:**

```bash
# Test Docker build locally
cd backend
docker build -f Dockerfile.prod -t test-backend .

# Check for large files
du -sh backend/ frontend/

# Verify .dockerignore is working
cat backend/.dockerignore
cat frontend/.dockerignore
```

### Issue 4: Performance Tests Failing

**Bundle Size Exceeds Limit:**

```bash
# Analyze bundle
cd frontend
npm run build:analyze

# Check largest dependencies
npm list --depth=0 --json | jq '.dependencies | to_entries | sort_by(.value.size) | reverse'

# Consider code splitting
# Review vite.config.ts for optimization options
```

**Load Test Failure:**

```bash
# Review Locust results
# Download from: Actions → Performance Testing → Artifacts → locust-load-test-results

# Check average response times
# Target: < 200ms for health endpoint
# Maximum: < 500ms

# Optimize if needed:
# - Add database indexes
# - Implement caching
# - Optimize queries
```

---

## Maintenance

### Weekly Tasks

- [ ] Review Dependabot PRs and merge safe updates
- [ ] Check security scan results
- [ ] Review performance metrics trends
- [ ] Update documentation if workflows changed

### Monthly Tasks

- [ ] Rotate SSH keys
- [ ] Review and update branch protection rules
- [ ] Audit GitHub Actions permissions
- [ ] Review and archive old workflow runs
- [ ] Update CI/CD documentation

### Quarterly Tasks

- [ ] Major dependency updates (Python, Node, Docker)
- [ ] Review and optimize workflow execution times
- [ ] Security audit of entire pipeline
- [ ] Disaster recovery drill (test backup/restore)

---

## Best Practices

### Commit Messages

Use conventional commits for automatic changelog generation:

```bash
feat(auth): add OAuth2 login
fix(reader): resolve pagination bug
docs(api): update endpoint documentation
chore(deps): update dependencies
ci(security): add SAST scanning
```

### Pull Requests

Before creating PR:
```bash
# Run all checks locally
npm run lint  # Frontend
cd backend && ruff check . && black --check .  # Backend
npm test  # Frontend tests
cd backend && pytest  # Backend tests
npm run type-check  # TypeScript
cd backend && mypy app/  # Python types
```

### Security

- Never commit secrets or API keys
- Use GitHub secrets for sensitive data
- Enable secret scanning alerts
- Review dependency updates before merging
- Keep base Docker images up to date

### Performance

- Keep bundle size under 3MB (5MB max)
- Maintain test coverage above 70%
- Keep average API response time < 200ms
- Monitor and optimize slow database queries

---

## Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [GitHub Actions Guide](./GITHUB_ACTIONS_GUIDE.md)
- [Deployment Guide](./DEPLOYMENT_GUIDE.md)
- [Branch Protection Rules](./BRANCH_PROTECTION_RULES.md)
- [Docker Best Practices](../deployment/INFRASTRUCTURE_OPTIMIZATION.md)

---

## Support

**Issues with CI/CD setup?**

1. Check [Troubleshooting](#troubleshooting) section above
2. Review workflow run logs in GitHub Actions tab
3. Check existing [GitHub Issues](https://github.com/YOUR_USERNAME/fancai-vibe-hackathon/issues)
4. Create new issue with:
   - Workflow name and run link
   - Error message
   - Steps to reproduce
   - Expected vs actual behavior

**Questions?** Open a discussion in GitHub Discussions.

---

**Last Updated:** 2025-10-29
**Version:** 1.0.0
**Maintainer:** DevOps Team
