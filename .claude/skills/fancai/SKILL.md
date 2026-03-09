# fancai Development Patterns

> Auto-generated skill from repository analysis

## Overview

The fancai repository is a Python-based application with a focus on AI service integration and planning-driven development. It follows conventional commit patterns and maintains comprehensive documentation through a structured planning system. The codebase emphasizes Docker containerization, database migrations with Alembic, and security-first configuration management.

## Coding Conventions

### File Naming
- Use **camelCase** for file names
- Example: `userService.py`, `aiModelConfig.py`

### Import Style
- Use **aliases** for imports to maintain clean namespaces
```python
import openrouter_client as orc
from backend.app.services import ai_service as ai
from sqlalchemy import Column, Integer, String as SA_String
```

### Export Style
- Use **named exports** for better code organization
```python
# In models/__init__.py
from .user import User
from .ai_model import AIModel
from .plan import Plan

__all__ = ["User", "AIModel", "Plan"]
```

### Commit Messages
- Follow conventional commit format
- Average length: 72 characters
- Prefixes: `fix`, `docs`, `feat`, `chore`, `refactor`, `test`
```
feat: migrate ai service to openrouter integration
fix: add missing env vars to docker compose config  
docs: update roadmap with completed migration tasks
```

## Workflows

### Plan Completion Documentation
**Trigger:** When finishing a development plan execution
**Command:** `/complete-plan`

1. Create `SUMMARY.md` in the appropriate phase directory with execution results and verification details
2. Update `STATE.md` with current position, key metrics, decisions made, and session information
3. Update `ROADMAP.md` by checking off completed plan items and updating progress percentages
4. Mark related requirements as complete in `REQUIREMENTS.md` with completion timestamps

**Files involved:**
```
.planning/phases/*/SUMMARY.md
.planning/STATE.md
.planning/ROADMAP.md
.planning/REQUIREMENTS.md
```

### Service Migration to OpenRouter
**Trigger:** When migrating AI service integrations to OpenRouter
**Command:** `/migrate-to-openrouter`

1. Replace existing provider SDK imports with `openrouter_client`
```python
# Before
import google.generativeai as genai

# After
import openrouter_client as orc
```

2. Update service calls to use OpenRouter's unified interface
```python
# Before
response = genai.generate_content(prompt)

# After
response = orc.generate_text(prompt, model="gpt-4")
```

3. Remove old provider dependencies from `requirements.txt`
4. Update test files to mock OpenRouter instead of the previous provider
5. Verify structured response handling works with Pydantic schemas

### Docker Compose Environment Fixes
**Trigger:** When deployment fails due to missing environment variables
**Command:** `/fix-env-var`

1. Identify the missing environment variable from error logs or deployment output
2. Add the environment variable to the appropriate service in `docker-compose.prod.yml`
```yaml
backend:
  environment:
    - DATABASE_URL=${DATABASE_URL}
    - NEW_REQUIRED_VAR=${NEW_REQUIRED_VAR}
```

3. Add the variable to related services (celery-worker, celery-beat) if they need access
4. Verify the variable is available in your production environment configuration

### Database Migration Creation
**Trigger:** When adding new database tables or modifying existing schemas
**Command:** `/new-migration`

1. Create new SQLAlchemy model in `backend/app/models/`
```python
# backend/app/models/new_feature.py
from sqlalchemy import Column, Integer, String, DateTime
from .base import Base

class NewFeature(Base):
    __tablename__ = "new_features"
    
    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime, nullable=False)
```

2. Register the model in `backend/app/models/__init__.py`
3. Generate Alembic migration with descriptive filename
```bash
alembic revision --autogenerate -m "add_new_feature_table"
```

4. Review and enhance the migration with indexes and constraints as needed
5. Update related services to import and use the new model

### Security Configuration Hardening
**Trigger:** When hardening security policies or fixing CSP/auth issues
**Command:** `/harden-security`

1. Update `Caddyfile` with new security headers or authentication rules
```caddyfile
example.com {
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
    }
    basicauth /admin/* {
        admin $2a$14$...
    }
}
```

2. Modify CSP policies in `frontend/index.html` to allow/block domains as needed
3. Update Docker Compose files with security-related environment variables
4. Test configuration changes to ensure functionality isn't broken
5. Document security decisions clearly in the commit message

### Monitoring Stack Replacement
**Trigger:** When upgrading or replacing monitoring solutions
**Command:** `/replace-monitoring`

1. Create new `docker-compose.monitoring.yml` with replacement monitoring services
2. Update `Caddyfile` with new monitoring endpoints and authentication
3. Remove old monitoring configurations and associated Docker volumes
4. Update documentation files (`README.md`, `QUICKSTART.md`) with new setup instructions
5. Configure new monitoring tools with appropriate dashboards, alerts, and retention settings

### Dependency Updates Batch
**Trigger:** When performing routine dependency maintenance
**Command:** `/update-deps`

1. Update npm dependencies to latest minor versions in `package.json`
2. Update pip dependencies in `requirements.txt`, being careful with major version changes
3. Pin Docker images to specific patch versions for reproducibility
```yaml
# docker-compose.prod.yml
postgres:
  image: postgres:15.4-alpine  # Pinned to patch version
```

4. Run full test suite to verify compatibility
5. Document any major version changes and compatibility notes in commit message

## Testing Patterns

### Framework
- Uses **vitest** for testing framework
- Test files follow pattern: `*.test.tsx`

### Test Structure
```javascript
// Example test file: userService.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { userService } from './userService'

describe('userService', () => {
  it('should handle user creation', async () => {
    // Test implementation
    const result = await userService.createUser(userData)
    expect(result).toBeDefined()
  })
})
```

## Commands

| Command | Purpose |
|---------|---------|
| `/complete-plan` | Complete development plan and update all tracking documents |
| `/migrate-to-openrouter` | Migrate AI services from other providers to OpenRouter |
| `/fix-env-var` | Fix missing environment variables in Docker Compose |
| `/new-migration` | Create new Alembic database migration |
| `/harden-security` | Update security configurations across infrastructure |
| `/replace-monitoring` | Replace monitoring infrastructure with new tools |
| `/update-deps` | Batch update npm and pip dependencies |