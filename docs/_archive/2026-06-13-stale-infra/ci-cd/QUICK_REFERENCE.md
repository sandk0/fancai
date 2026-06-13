# CI/CD Quick Reference Card

Quick commands and procedures for common CI/CD tasks.

## Common Commands

### Create Pull Request

```bash
# Create feature branch
git checkout -b feature/new-feature

# Make changes and commit
git add .
git commit -m "feat(module): description"
git push origin feature/new-feature

# Create PR via GitHub CLI
gh pr create --fill
```

### Check CI Status

```bash
# List recent workflow runs
gh run list --limit 10

# Watch live workflow
gh run watch

# View specific run
gh run view RUN_ID --log
```

### Deploy to Production

```bash
# Method 1: Create release tag
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0

# Method 2: Manual trigger
gh workflow run deploy.yml -f environment=production
```

### Run Security Scan

```bash
# Trigger manually
gh workflow run security.yml

# View latest results
gh run list --workflow=security.yml --limit 1
```

### Run Performance Tests

```bash
# Default configuration
gh workflow run performance.yml

# Custom configuration
gh workflow run performance.yml \
  -f duration=120 \
  -f users=50
```

## Troubleshooting

### Workflow Failed

```bash
# View error logs
gh run view --log

# Re-run failed jobs
gh run rerun RUN_ID --failed
```

### PR Not Merging

**Check:**
1. All status checks passed?
2. Approvals received?
3. Conversations resolved?
4. Branch up-to-date?

```bash
# Update branch
git fetch origin
git rebase origin/main
git push --force-with-lease
```

### Security Scan Found Issues

```bash
# View vulnerability report
gh run view RUN_ID --log > security-report.txt

# Update dependencies
cd backend && pip install --upgrade PACKAGE
cd frontend && npm update
```

## Quick Checks

### Before Creating PR

```bash
# Run linters
cd backend && ruff check . && black --check .
cd frontend && npm run lint

# Run tests
cd backend && pytest
cd frontend && npm test

# Type check
cd frontend && npm run type-check
cd backend && mypy app/
```

### Health Check Production

```bash
# Via curl
curl https://bookreader.example.com/api/health

# Via GitHub CLI
gh api repos/:owner/:repo/deployments
```

## Configuration

### Required Secrets

```
PROD_SSH_KEY       - Production server SSH key
PROD_HOST          - Production server hostname
PROD_USER          - Production server username
CODECOV_TOKEN      - Codecov upload token (optional)
SLACK_WEBHOOK_URL  - Slack notifications (optional)
```

### Branch Protection

**Main branch requires:**
- 1 approval
- All status checks pass
- Conversations resolved
- Up-to-date with main

## Status Checks

**Required checks:**
- Backend Linting
- Backend Tests
- Frontend Linting
- Frontend Tests
- Security Scanning
- All Checks Passed

## Schedules

**Weekly Scans:**
- Security: Mondays 9 AM UTC
- Performance: Sundays 2 AM UTC

**Dependency Updates:**
- Dependabot: Mondays 9-10 AM UTC

## Important Links

- [Full Setup Guide](./CI_CD_SETUP.md)
- [GitHub Actions Guide](./GITHUB_ACTIONS_GUIDE.md)
- [Deployment Guide](./DEPLOYMENT_GUIDE.md)
- [Branch Protection](./BRANCH_PROTECTION_RULES.md)
- [Implementation Summary](./CI_CD_IMPLEMENTATION_SUMMARY.md)

## Emergency Procedures

### Rollback Production

```bash
# SSH to server
ssh deploy@prod-server
cd /opt/bookreader

# Stop containers
docker-compose -f docker-compose.production.yml down

# Checkout previous version
git checkout v1.0.0  # Last working version

# Start containers
docker-compose -f docker-compose.production.yml up -d
```

### Bypass CI (Emergency Only)

**Admin only:** Temporarily disable branch protection rules

Settings → Branches → Edit rule → Uncheck required checks

**Remember:** Re-enable immediately after merge!

## Metrics

**Target Performance:**
- CI Pipeline: <15 minutes
- Deployment: <10 minutes
- Test Coverage: >70%
- Security: No critical CVEs

## Support

**Issues?**
1. Check workflow logs
2. Review troubleshooting section
3. Contact DevOps team
4. Create GitHub issue

---

**Last Updated:** 2025-10-29
**Version:** 1.0.0
