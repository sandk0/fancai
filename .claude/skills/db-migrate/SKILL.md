---
name: db-migrate
description: Create and run database migrations for fancai. Use when changing database schema, adding columns, creating tables, or modifying SQLAlchemy models.
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Bash, Grep, Glob
---

# Database Migration Workflow

## Steps

1. **Analyze Change**: Understand what schema change is needed
2. **Update Model**: Modify SQLAlchemy model in `backend/app/models/`
3. **Update Schema**: Modify Pydantic schema in `backend/app/schemas/`
4. **Generate Migration**: `cd backend && alembic revision --autogenerate -m "$ARGUMENTS"`
5. **Review Migration**: Read the generated migration file, verify:
   - Correct upgrade() and downgrade() operations
   - No data loss in downgrade
   - Proper index creation
6. **Test Migration**: `cd backend && alembic upgrade head`
7. **Verify**: Run backend tests `cd backend && pytest -v --tb=short`

## Conventions
- Migration message format: descriptive snake_case
- Always include downgrade() implementation
- For production: test migration on staging data first
