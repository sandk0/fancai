# Branch Protection Rules for BookReader AI

Complete guide for configuring GitHub branch protection rules to enforce code quality and prevent accidental changes to critical branches.

## Table of Contents

- [Overview](#overview)
- [Protection Rules Configuration](#protection-rules-configuration)
- [Status Checks](#status-checks)
- [Review Requirements](#review-requirements)
- [Additional Settings](#additional-settings)
- [Special Cases](#special-cases)
- [Troubleshooting](#troubleshooting)

---

## Overview

Branch protection rules prevent collaborators from making irrevocable changes to branches in your repository. They enforce code review and quality checks before merging.

### Protected Branches

**BookReader AI protects:**
- `main` - Production branch (strict rules)
- `develop` - Development branch (moderate rules)

---

## Protection Rules Configuration

### Step-by-Step Setup

**Navigate to:**
```
Repository → Settings → Branches → Add rule
```

### Main Branch Protection

#### Rule 1: Branch Name Pattern

```
Branch name pattern: main
```

This rule applies to the `main` branch only.

#### Rule 2: Require Pull Request Before Merging

```yaml
✅ Require a pull request before merging
  ✅ Require approvals: 1
  ✅ Dismiss stale pull request approvals when new commits are pushed
  ✅ Require review from Code Owners (optional)
  ❌ Restrict who can dismiss pull request reviews
  ❌ Allow specified actors to bypass required pull requests
  ✅ Require approval of the most recent reviewable push
```

**What this does:**
- Prevents direct pushes to `main`
- Requires at least 1 approval before merge
- Invalidates approvals when new code is pushed
- Ensures latest commit is reviewed

**Exception:** Repository admins can bypass (not recommended)

#### Rule 3: Require Status Checks to Pass

```yaml
✅ Require status checks to pass before merging
  ✅ Require branches to be up to date before merging

  Status checks that are required:
    ✅ Backend Linting
    ✅ Backend Tests
    ✅ Frontend Linting
    ✅ Frontend Tests
    ✅ Security Scanning
    ✅ MyPy Type Checking
    ✅ All Checks Passed
```

**What this does:**
- Blocks merge if any check fails
- Ensures branch is up-to-date with main
- Prevents merging outdated code

**Important:** Status checks appear after first workflow run. Create a test PR to populate the list.

#### Rule 4: Require Conversation Resolution

```yaml
✅ Require conversation resolution before merging
```

**What this does:**
- All PR comments must be marked "Resolved"
- Prevents merging with open discussions
- Ensures all feedback is addressed

#### Rule 5: Require Signed Commits (Optional)

```yaml
✅ Require signed commits
```

**What this does:**
- All commits must have GPG/SSH signature
- Verifies commit author identity
- Prevents impersonation

**Setup signed commits:**
```bash
# Generate GPG key
gpg --full-generate-key

# List keys
gpg --list-secret-keys --keyid-format LONG

# Export public key
gpg --armor --export KEY_ID

# Add to GitHub: Settings → SSH and GPG keys → New GPG key

# Configure Git
git config --global user.signingkey KEY_ID
git config --global commit.gpgsign true
```

#### Rule 6: Require Linear History

```yaml
✅ Require linear history
```

**What this does:**
- Prevents merge commits
- Requires squash or rebase merges
- Keeps history clean and readable

**Merge options:**
- Squash and merge: ✅ (multiple commits → 1)
- Rebase and merge: ✅ (replay commits)
- Merge commit: ❌ (creates merge commit)

#### Rule 7: Include Administrators

```yaml
✅ Include administrators
```

**What this does:**
- Applies all rules to repository admins
- No special privileges
- Best practice for production branches

#### Rule 8: Restrict Pushes

```yaml
✅ Restrict who can push to matching branches
  Restrict pushes that create matching branches: github-actions[bot]
```

**What this does:**
- Only specified users/teams can push directly
- Useful for automation accounts
- Blocks accidental direct pushes

#### Rule 9: Prevent Force Pushes

```yaml
❌ Allow force pushes
  Everyone: disabled
```

**What this does:**
- Prevents `git push --force`
- Protects branch history
- Critical for main branch

#### Rule 10: Prevent Deletions

```yaml
❌ Allow deletions
```

**What this does:**
- Prevents branch deletion
- Protects against accidents
- Essential for main/production branches

---

## Status Checks

### Required Status Checks

**CI Pipeline (ci.yml):**

| Check Name | Description | Failure Impact |
|------------|-------------|----------------|
| Backend Linting | Ruff + Black + MyPy | Merge blocked |
| Backend Tests | pytest with coverage | Merge blocked |
| Frontend Linting | ESLint + TypeScript | Merge blocked |
| Frontend Tests | Vitest unit tests | Merge blocked |
| Security Scanning | Trivy + TruffleHog | Merge blocked |
| All Checks Passed | Final gate | Merge blocked |

**Optional but Recommended:**

| Check Name | Description | When to Require |
|------------|-------------|-----------------|
| Docker Build | Build test | For Docker changes |
| MyPy Type Checking | Strict type check | High type safety |
| Performance Tests | Load testing | Critical features |
| Coverage Threshold | >70% coverage | Strict projects |

### Configuring Status Checks

**Add status checks:**
1. Settings → Branches → Edit rule
2. Scroll to "Require status checks to pass"
3. Search for check name
4. Select to add

**Note:** Status checks only appear after running at least once. Create a test PR to see available checks.

### Exempting Status Checks

**When to exempt:**
- Documentation-only changes
- Emergency hotfixes (with approval)
- Dependency updates (automated)

**How to exempt:**
```bash
# Temporarily disable checks (admin only)
# Settings → Branches → Edit rule → Uncheck status check

# Or use [skip ci] for specific commits
git commit -m "docs: update README [skip ci]"
```

---

## Review Requirements

### Code Review Process

**Minimum requirements:**
- 1 approval required
- Reviewer must have write access
- Cannot approve own PR

**Best practices:**
- Request review from domain expert
- Review within 24 hours
- Use review comments for discussions
- Approve only when all concerns addressed

### Code Owners (Optional)

**Setup CODEOWNERS file:**

```bash
# .github/CODEOWNERS

# Global owners
* @team-lead

# Backend code
backend/ @backend-team
backend/app/core/ @senior-backend-dev

# Frontend code
frontend/ @frontend-team
frontend/src/components/ @senior-frontend-dev

# CI/CD
.github/workflows/ @devops-team

# Documentation
docs/ @tech-writers
*.md @tech-writers

# Infrastructure
docker-compose*.yml @devops-team
Dockerfile* @devops-team
```

**What this does:**
- Automatically requests review from code owners
- Ensures domain experts review relevant changes
- Can require code owner approval

**Enable:**
```yaml
✅ Require review from Code Owners
```

### Dismissing Reviews

**When reviews are dismissed:**
- New commits pushed to PR
- Code significantly changed
- Security concerns raised

**Manual dismissal:**
- Click "Dismiss review" (requires permission)
- Provide reason
- Re-request review

---

## Additional Settings

### Merge Methods

**Configure allowed merge methods:**

Settings → Options → Pull Requests

```yaml
✅ Allow squash merging
  Default commit message: Pull request title
  Default commit description: Pull request description

✅ Allow rebase merging

❌ Allow merge commits (disabled for linear history)

✅ Automatically delete head branches
```

**Recommendations:**
- **Squash merge:** Feature branches (clean history)
- **Rebase merge:** Hotfixes (preserve commits)
- **Merge commit:** Never (unless required)

### Auto-merge

**Enable auto-merge:**

Settings → Options → Pull Requests

```yaml
✅ Allow auto-merge
```

**Usage:**
```bash
# Enable auto-merge on PR
gh pr merge --auto --squash
```

**What happens:**
1. PR approved
2. All checks pass
3. Branch up-to-date
4. Automatically merges

### Deployment Protection

**For production environment:**

Settings → Environments → production

```yaml
Environment protection rules:
  ✅ Required reviewers: 1-6 people
    - @senior-engineer
    - @devops-lead

  ✅ Wait timer: 5 minutes

  ✅ Deployment branches: Only main
```

**What this does:**
- Requires manual approval for production deploy
- Adds delay for last-minute checks
- Restricts deployment to specific branches

---

## Special Cases

### Emergency Hotfixes

**Process for urgent production fixes:**

1. **Create hotfix branch from main:**
```bash
git checkout main
git pull origin main
git checkout -b hotfix/critical-bug-fix
```

2. **Make minimal changes:**
```bash
# Fix only the critical issue
# Add tests for the fix
git add .
git commit -m "fix(critical): resolve security vulnerability"
```

3. **Fast-track review:**
```bash
gh pr create \
  --title "HOTFIX: Critical security fix" \
  --body "## Emergency Hotfix\n\nSeverity: Critical\nImpact: Security vulnerability\nTested: Yes" \
  --label "hotfix" \
  --label "priority:high"
```

4. **Expedited approval:**
- Tag senior engineer for immediate review
- Explain urgency in PR description
- Provide test evidence

5. **Bypass checks if necessary (admin only):**
- Use with extreme caution
- Document reason in PR
- Run checks post-merge

### Dependency Updates (Dependabot)

**Auto-approve safe updates:**

```yaml
# .github/workflows/dependabot-auto-approve.yml
name: Dependabot Auto-Approve
on: pull_request

jobs:
  auto-approve:
    runs-on: ubuntu-latest
    if: github.actor == 'dependabot[bot]'
    steps:
      - uses: hmarr/auto-approve-action@v3
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

**Conditions:**
- Patch version updates only (1.2.3 → 1.2.4)
- All tests pass
- Security scans pass

### Documentation Changes

**Bypass checks for docs:**

```bash
# Commit with [skip ci]
git commit -m "docs: update API documentation [skip ci]"

# Still requires approval, but no CI run
```

**When to use:**
- Typo fixes
- Documentation updates
- README changes
- No code changes

---

## Troubleshooting

### Issue 1: Cannot Merge - Status Check Failed

**Solution:**

```bash
# View failed check
gh pr checks

# View detailed logs
gh run view RUN_ID --log

# Fix issue and push
git add .
git commit -m "fix: resolve failing test"
git push
```

### Issue 2: Branch Not Up-to-Date

**Solution:**

```bash
# Update branch with main
git checkout feature-branch
git fetch origin
git rebase origin/main

# Resolve conflicts if any
git push --force-with-lease
```

### Issue 3: Required Review Missing

**Solution:**

```bash
# Request review
gh pr review --request @reviewer

# Or via UI: PR → Reviewers → Request review
```

### Issue 4: Administrator Bypass Not Working

**Possible causes:**
- "Include administrators" enabled (working as intended)
- Insufficient permissions
- Organization policy

**Solution:**
```bash
# Temporarily disable rule (emergency only)
# Settings → Branches → Edit rule → Uncheck "Include administrators"
```

### Issue 5: Status Check Not Appearing

**Solution:**

```bash
# Trigger workflow manually
gh workflow run ci.yml

# Or push any commit
git commit --allow-empty -m "chore: trigger CI"
git push

# Wait for workflow to complete
# Check will appear in branch protection settings
```

---

## Best Practices

### For Contributors

1. **Create feature branch from main:**
```bash
git checkout main
git pull origin main
git checkout -b feature/new-feature
```

2. **Keep branch up-to-date:**
```bash
git fetch origin
git rebase origin/main
```

3. **Write descriptive commits:**
```bash
git commit -m "feat(auth): add OAuth2 login support"
```

4. **Run tests locally:**
```bash
npm test
cd backend && pytest
```

5. **Address review comments:**
- Respond to all comments
- Make requested changes
- Mark conversations as resolved

### For Reviewers

1. **Review promptly** (within 24 hours)
2. **Be constructive** in feedback
3. **Check for:**
   - Code quality
   - Test coverage
   - Security issues
   - Performance implications
   - Documentation
4. **Approve only when ready**
5. **Request changes if concerns**

### For Administrators

1. **Enforce rules consistently**
2. **Document exceptions**
3. **Review rules quarterly**
4. **Monitor bypass usage**
5. **Update rules as project evolves**

---

## Compliance Checklist

Before merging to main:

- [ ] All required status checks pass
- [ ] At least 1 approval received
- [ ] All conversations resolved
- [ ] Branch up-to-date with main
- [ ] Commits signed (if required)
- [ ] No force pushes in history
- [ ] Changes reviewed by code owner
- [ ] Tests cover new code
- [ ] Documentation updated
- [ ] CHANGELOG updated (if applicable)

---

## Additional Resources

- [GitHub Branch Protection Docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/defining-the-mergeability-of-pull-requests/about-protected-branches)
- [Code Review Best Practices](https://google.github.io/eng-practices/review/)
- [CI/CD Setup Guide](./CI_CD_SETUP.md)
- [GitHub Actions Guide](./GITHUB_ACTIONS_GUIDE.md)

---

**Last Updated:** 2025-10-29
**Version:** 1.0.0
**Maintainer:** DevOps Team
