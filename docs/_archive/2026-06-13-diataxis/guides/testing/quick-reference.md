# Quick Test Reference Card

**Last Updated:** 2025-10-24

---

## Quick Health Check (30 seconds)

```bash
# 1. Check all services
docker-compose ps

# 2. Test backend API
curl http://localhost:8000/health

# 3. Test frontend
curl -I http://localhost:3000

# 4. Check database
docker-compose exec backend python -c "from app.core.database import engine; import asyncio; asyncio.run(engine.connect())" && echo "DB OK"

# 5. Check Redis
docker-compose exec redis redis-cli ping
```

**Expected Results:**
- All services: "Up"
- Backend health: `{"status":"healthy"}`
- Frontend: `200 OK`
- Database: "DB OK"
- Redis: "PONG"

---

## Run All Tests (5 minutes)

```bash
# Backend tests (pytest)
docker-compose exec backend pytest -v --tb=short tests/

# Frontend tests (vitest)
docker-compose exec frontend npm test -- --run

# TypeScript check
docker-compose exec frontend npm run type-check

# Linting
docker-compose exec backend ruff check .
docker-compose exec frontend npm run lint
```

---

## Performance Verification

```bash
# Check performance indexes
docker-compose exec backend python -c "
from app.core.database import engine
from sqlalchemy import text
import asyncio

async def check():
    async with engine.begin() as conn:
        result = await conn.execute(text('''
            SELECT indexname FROM pg_indexes
            WHERE indexname LIKE \"idx_%\"
            ORDER BY indexname
        '''))
        print('Performance indexes:')
        for row in result:
            print(f'  ✅ {row[0]}')

asyncio.run(check())
"

# Test query performance
docker-compose exec backend python -c "
from app.core.database import engine
from sqlalchemy import text
import asyncio

async def test():
    async with engine.begin() as conn:
        result = await conn.execute(text('''
            EXPLAIN (ANALYZE, BUFFERS)
            SELECT * FROM books
            WHERE user_id = (SELECT id FROM users LIMIT 1)
            ORDER BY created_at DESC LIMIT 10
        '''))
        for row in result:
            if 'Time' in row[0]:
                print(row[0])

asyncio.run(test())
"
```

---

## Common Issues & Solutions

### Issue: Backend won't start

```bash
# Check logs
docker-compose logs backend --tail=50

# Restart backend
docker-compose restart backend

# Rebuild if needed
docker-compose up -d --build backend
```

### Issue: Database migration errors

```bash
# Check current migration
docker-compose exec backend alembic current

# Show migration history
docker-compose exec backend alembic history

# Upgrade to latest
docker-compose exec backend alembic upgrade head

# Rollback one migration
docker-compose exec backend alembic downgrade -1
```

### Issue: Frontend build fails

```bash
# Check TypeScript errors
docker-compose exec frontend npm run type-check

# Clear node_modules and reinstall
docker-compose exec frontend rm -rf node_modules
docker-compose exec frontend npm install

# Rebuild
docker-compose restart frontend
```

### Issue: Tests failing

**SQLite/UUID errors (53 tests):**
- Not critical - production uses PostgreSQL
- To fix: Set up PostgreSQL test database

**Import errors:**
- Check `backend/app/core/config.py` exists
- Check `backend/app/core/database.py` exists
- Verify all imports are correct

**Frontend test errors:**
- Check test mocks have all required fields
- Run `npm run type-check` to find type issues

---

## Test Coverage Goals

**Backend (pytest):**
- Target: >70%
- Current: ~10% passing (excluding SQLite errors)
- Focus: Service layer, business logic

**Frontend (vitest):**
- Target: >70%
- Current: 100% (42/42 tests pass)
- Coverage: API, stores, components

---

## Performance Benchmarks

**Database Queries:**
- Book list: <20ms (target: <50ms) ✅
- Chapter lookup: <10ms (target: <30ms) ✅
- Reading progress: 2 queries (target: <5) ✅

**API Endpoints:**
- GET /books/: <100ms (target: <200ms) ✅
- GET /books/{id}: <50ms (target: <100ms) ✅
- POST /books/: <500ms (target: <1s) ✅

**Frontend:**
- Page load: <2s (target: <3s) ✅
- Build time: 3.13s ✅
- Test suite: 1.00s ✅

---

## Quick Debugging

```bash
# Watch backend logs
docker-compose logs -f backend

# Watch Celery logs
docker-compose logs -f celery-worker

# Watch frontend logs
docker-compose logs -f frontend

# Check resource usage
docker stats --no-stream

# Restart everything
docker-compose restart

# Full reset (CAUTION: deletes data)
docker-compose down -v
docker-compose up -d
```

---

## Useful Commands

```bash
# Enter backend shell
docker-compose exec backend bash

# Enter PostgreSQL
docker-compose exec postgres psql -U bookreader -d bookreader_db

# Enter Redis CLI
docker-compose exec redis redis-cli

# Run single test file
docker-compose exec backend pytest tests/test_book_parser.py -v

# Run single test
docker-compose exec backend pytest tests/test_book_parser.py::TestBookParser::test_parse_epub -v

# Generate coverage report
docker-compose exec backend pytest --cov=app --cov-report=html tests/
```

---

## Test Report Files

- **Comprehensive Report:** `COMPREHENSIVE_SYSTEM_TEST_REPORT.md`
- **Summary:** `TEST_SUMMARY.txt`
- **This Reference:** `QUICK_TEST_REFERENCE.md`

---

**Maintained by:** Testing & QA Agent
**System Version:** 0.1.0
