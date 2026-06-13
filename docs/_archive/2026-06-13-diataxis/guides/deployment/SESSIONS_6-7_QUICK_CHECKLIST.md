# Sessions 6-7 Deployment Quick Checklist

**Быстрый контрольный список для развертывания (3-5 минут)**

---

## ⚡ 5-минутное развертывание

### Step 1: Загрузить Stanza модель (30-40 минут)
```bash
# Запустить backend контейнер
docker-compose up -d backend

# Загрузить русскую модель (в контейнере)
docker-compose exec backend python -c "import stanza; stanza.download('ru')"

# Проверить загрузку
docker-compose exec backend ls -lah /root/stanza_resources/ru/
# Должны быть файлы tokenize, pos, lemma, depparse, ner (~630MB всего)
```

### Step 2: Проверить feature flags (1 минута)
```bash
# Убедиться, что в docker-compose.yml или .env установлены:
export USE_ADVANCED_PARSER=false    # Start with false
export USE_LLM_ENRICHMENT=false     # Optional LLM

# Перезагрузить backend
docker-compose restart backend
```

### Step 3: Проверить загрузку (2 минуты)
```bash
# Проверить логи
docker-compose logs backend | grep -i "stanza\|advanced\|ensemble"

# API health check
curl -s http://localhost:8000/health | jq .

# Ожидается: status: healthy
```

### Step 4: Запустить тесты (3 минуты)
```bash
cd backend

# Advanced Parser integration tests
python3 test_advanced_parser_integration.py

# Ожидается: 6/6 PASSED (или 9/9 если запустить оба)
```

---

## 🔧 Configuration Matrix

**Выберите конфигурацию в зависимости от stage:**

### Development (Recommended)
```bash
USE_ADVANCED_PARSER=false
USE_LLM_ENRICHMENT=false
LANGEXTRACT_API_KEY=none
```
✅ Стабильно, использует 4-processor ensemble

### Staging (Testing Advanced Parser)
```bash
USE_ADVANCED_PARSER=true
USE_LLM_ENRICHMENT=false
LANGEXTRACT_API_KEY=none
```
⚠️ Тестирование Advanced Parser без LLM costs

### Production (Full Features)
```bash
USE_ADVANCED_PARSER=true
USE_LLM_ENRICHMENT=true
LANGEXTRACT_API_KEY=<your-api-key>
```
💰 Максимальное качество, требует бюджет

---

## 🚨 Emergency Rollback (1 минута)

```bash
# Если что-то сломалось:
export USE_ADVANCED_PARSER=false
export USE_LLM_ENRICHMENT=false
docker-compose restart backend

# ✅ Система вернется к Sessions 1-5 (базовый ensemble)
```

---

## 📊 Success Metrics

Если увидите это - deployment успешен:

- ✅ `docker-compose ps` - все контейнеры UP
- ✅ `curl http://localhost:8000/health` - status: healthy
- ✅ Logs без ERROR
- ✅ Processing time <5 seconds
- ✅ Тесты 6/6 или 9/9 PASSED
- ✅ F1 score >0.87 (в логах или через API)

---

## 📱 Когда используется что?

| Текст | <500 chars | >=500 chars |
|------|-----------|-----------|
| **USE_ADVANCED_PARSER=false** | Standard Ensemble | Standard Ensemble |
| **USE_ADVANCED_PARSER=true** | Standard Ensemble | Advanced Parser |
| **+ USE_LLM_ENRICHMENT=true** | Standard Ensemble | Advanced + LLM |

---

## 🔍 Quick Verification

```bash
# 1. Проверить Stanza
docker-compose exec backend python -c "
import stanza
nlp = stanza.Pipeline('ru')
print('✅ Stanza loaded')
"

# 2. Проверить Advanced Parser adapter
docker-compose exec backend python -c "
from app.services.nlp.adapters import AdvancedParserAdapter
print('✅ AdvancedParserAdapter available')
"

# 3. Проверить Multi-NLP Manager
docker-compose exec backend python -c "
from app.services.multi_nlp_manager import multi_nlp_manager
print('✅ MultiNLPManager initialized')
"

# All three should print ✅
```

---

## 💾 File Locations

- **Main guide:** `/docs/guides/deployment/SESSIONS_6-7_DEPLOYMENT_GUIDE.md`
- **Settings:** `/backend/app/services/settings_manager.py`
- **Adapter:** `/backend/app/services/nlp/adapters/advanced_parser_adapter.py`
- **Tests:** `/backend/test_advanced_parser_integration.py`
- **Docker:** `/docker-compose.yml`

---

## ⏱️ Timeline

| Phase | Duration | Action |
|-------|----------|--------|
| 1 | 30-40 min | Download Stanza model |
| 2 | 1 min | Set feature flags |
| 3 | 2 min | Check logs |
| 4 | 3 min | Run tests |
| **Total** | **45-50 min** | Ready for production |

---

**Last Updated:** 2025-11-23
**Version:** 1.0
**Status:** Production-Ready
