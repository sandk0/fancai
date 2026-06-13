# Рекомендации по развертыванию Sessions 6-7: Stanza + Advanced Parser

**Дата:** 2025-11-23
**Версия:** 1.0
**Статус:** Production-Ready

---

## Обзор

Данный документ содержит пошаговое руководство по развертыванию компонентов Sessions 6-7:

- **Session 6:** Активация Stanza NLP процессора (4-процессорный ensemble)
- **Session 7:** Интеграция Advanced Parser с опциональным LLM обогащением

Оба компонента готовы к production развертыванию и имеют встроенные механизмы graceful degradation.

---

## 📋 Pre-Deployment Checklist

Перед развертыванием убедитесь в следующем:

### Инфраструктура
- [ ] Docker Compose v2+ установлен
- [ ] Свободно **минимум 3GB памяти** (для NLP моделей)
- [ ] Свободно **минимум 2GB дискового пространства** (Session 6: +630MB для Stanza)
- [ ] PostgreSQL 15+ работает и доступна
- [ ] Redis работает и доступен

### Окружение
- [ ] `.env` файл настроен со следующими переменными:
  ```bash
  DB_PASSWORD=<secure-password>
  REDIS_PASSWORD=<secure-password>
  SECRET_KEY=<secure-key>
  ```

### Code Changes
- [ ] Переходите на ветку с Session 6-7 изменениями
- [ ] Файлы Advanced Parser adapter скачаны/скопированы
- [ ] settings_manager.py и config_loader.py обновлены

### Тестирование
- [ ] Все unit тесты Session 7 PASSED (9/9)
- [ ] Базовый API health check работает

---

## 🚀 Пошаговое развертывание

### Phase 1: Подготовка инфраструктуры (10-15 минут)

#### 1.1 Обновить Docker Compose

Убедитесь, что `docker-compose.yml` имеет конфигурацию для NLP моделей:

```yaml
# backend service
environment:
  - STANZA_RESOURCES_DIR=/root/stanza_resources
  - NLTK_DATA=/root/nltk_data

volumes:
  - nlp_stanza_models:/root/stanza_resources
  - nlp_nltk_data:/root/nltk_data
```

**Статус текущего setup:** ✅ Уже настроено в docker-compose.yml

#### 1.2 Проверить размеры ресурсов

```bash
# Текущие limits в docker-compose.yml:
# backend: 2GB (sufficient для Stanza)
# celery-worker: 1.5GB (sufficient)
```

**Действие:** Если память ограничена, увеличить лимиты:
```yaml
deploy:
  resources:
    limits:
      memory: 3G  # Увеличить для Stanza
```

#### 1.3 Очистить старые volumes (опционально)

```bash
# Если переустанавливаете NLP модели
docker volume rm bookreader_nlp_stanza_models
docker volume rm bookreader_nlp_nltk_data
```

---

### Phase 2: Загрузка Stanza моделей (30-40 минут)

#### 2.1 Запустить backend контейнер

```bash
cd /Users/sandk/Documents/GitHub/fancai-vibe-hackathon

# Запустить только backend + postgres + redis
docker-compose up -d postgres redis backend
```

#### 2.2 Загрузить русскую модель Stanza

```bash
# Вариант A: Через backend контейнер (рекомендуется)
docker-compose exec backend python -c "import stanza; stanza.download('ru')"

# Вариант B: Локально (если Python 3.11+ установлен)
python3 -c "import stanza; stanza.download('ru')"
```

**Ожидаемый вывод:**
```
Downloading default packages for language: ru...
Default packages for ru language installed.
Models saved in /root/stanza_resources/
```

**Размер модели:** ~630MB
**Время загрузки:** 10-20 минут (в зависимости от интернета)

#### 2.3 Проверить загрузку

```bash
# Проверить файлы моделей
docker-compose exec backend ls -lah /root/stanza_resources/ru/

# Должны быть файлы:
# - tokenize/default.pt (~100MB)
# - pos/default.pt (~70MB)
# - lemma/default.pt (~20MB)
# - depparse/default.pt (~300MB) - это главный компонент!
# - ner/default.pt (~50MB)
```

---

### Phase 3: Включение Advanced Parser (5 минут)

#### 3.1 Установить feature flags

**Вариант A: Через environment переменные** (рекомендуется для development)

```bash
# Обновить docker-compose.yml для backend service:
environment:
  - USE_ADVANCED_PARSER=false  # Сначала false для тестирования
  - USE_LLM_ENRICHMENT=false   # Требует API ключ, пока отключаем

# Или через .env файл
echo "USE_ADVANCED_PARSER=false" >> .env
echo "USE_LLM_ENRICHMENT=false" >> .env
```

**Вариант B: Через код** (для более гибкого управления)

```python
# backend/app/services/multi_nlp_manager.py - уже реализовано!
# Проверить наличие методов:
# - _is_feature_enabled(flag_name, default)
# - _should_use_advanced_parser(text)
```

#### 3.2 Перезагрузить backend

```bash
docker-compose restart backend
```

**Проверить логи:**
```bash
docker-compose logs -f backend | grep -i "advanced\|parser"

# Ожидаемый вывод:
# Advanced Parser disabled (default)
# или
# ✅ Advanced Parser enabled (enrichment: false)
```

---

### Phase 4: Включение Stanza процессора (5 минут)

#### 4.1 Проверить settings manager

```bash
# Файл уже обновлен в Session 6:
# backend/app/services/settings_manager.py (строки 148-156)

# Проверить, что enabled: true
docker-compose exec backend python -c "
from app.services.settings_manager import settings_manager
import json
print(json.dumps(settings_manager._settings['nlp_stanza'], indent=2))
"

# Ожидаемый вывод:
# {
#   "enabled": true,
#   "weight": 0.8,
#   "threshold": 0.3,
#   ...
# }
```

#### 4.2 Проверить загрузку Stanza

```bash
# Быстрый тест
docker-compose exec backend python -c "
import stanza
nlp = stanza.Pipeline('ru')
doc = nlp('Это тест.')
print('✅ Stanza loaded successfully')
print(f'Processors: {[proc.name for proc in nlp.processors]}')
"

# Ожидаемый вывод:
# ✅ Stanza loaded successfully
# Processors: ['tokenize', 'mwt', 'pos', 'lemma', 'depparse', 'ner']
```

---

### Phase 5: Тестирование (10-15 минут)

#### 5.1 Запустить unit тесты Session 7

```bash
cd /Users/sandk/Documents/GitHub/fancai-vibe-hackathon/backend

# Advanced Parser integration tests
python3 test_advanced_parser_integration.py

# Ожидаемый вывод:
# ✅ Test 1: Advanced Parser disabled by default - PASSED
# ✅ Test 2: Advanced Parser enabled via flag - PASSED
# ✅ Test 3: Short text fallback - PASSED
# ✅ Test 4: Result format compliance - PASSED
# ✅ Test 5: Statistics tracking - PASSED
# ✅ Test 6: Adapter statistics - PASSED
#
# ✅ All tests passed: 6/6
```

#### 5.2 Проверить Multi-NLP manager

```bash
# API health check
curl -s http://localhost:8000/health | jq .

# Должно быть:
# {
#   "status": "healthy",
#   "components": {
#     "postgres": "healthy",
#     "redis": "healthy"
#   }
# }
```

#### 5.3 Тест extraction на русском тексте

```bash
# Файл уже подготовлен:
# backend/test_advanced_parser_integration.py

# Запустить простой тест
python3 -c "
import asyncio
from app.services.multi_nlp_manager import multi_nlp_manager

text = '''
Улица была покрыта тонким слоем снега, блеск которого под луной
казался почти призрачным. Впереди виднелась черная силуэт замка,
его башни острыми пиками пронзали ночное небо.
'''

asyncio.run(multi_nlp_manager.initialize())
result = asyncio.run(multi_nlp_manager.extract_descriptions(text))

print(f'Found {len(result.descriptions)} descriptions')
for desc in result.descriptions[:2]:
    print(f'- [{desc.type}] {desc.content[:50]}...')
"
```

---

## ⚙️ Обязательные переменные окружения

### Session 6 (Stanza)

```bash
# Обязательно
STANZA_RESOURCES_DIR=/root/stanza_resources

# Автоматически установлено в docker-compose.yml
# Модель загружается при первом запуске
```

### Session 7 (Advanced Parser)

```bash
# Optional feature flags (default: false)
USE_ADVANCED_PARSER=false
USE_LLM_ENRICHMENT=false

# Optional (требуется только если USE_LLM_ENRICHMENT=true)
LANGEXTRACT_API_KEY=<your-api-key>

# Alternative: Local LLM (Ollama)
OLLAMA_BASE_URL=http://ollama:11434
```

### Матрица конфигурации

| Flag | Value | Результат |
|------|-------|-----------|
| USE_ADVANCED_PARSER | false | Standard 4-processor ensemble (SpaCy, Natasha, GLiNER, Stanza) |
| USE_ADVANCED_PARSER | true | Advanced Parser 3-stage pipeline |
| USE_LLM_ENRICHMENT | false | No LLM enrichment (graceful degradation) |
| USE_LLM_ENRICHMENT | true + API key | Full Advanced Parser + LLM enrichment |

---

## 📊 Мониторинг и метрики

### Ключевые метрики для отслеживания

```python
# Из Multi-NLP Manager
manager.processing_statistics = {
    "total_processed": int,
    "average_quality_scores": {
        "spacy": float,      # 0.85-0.88
        "natasha": float,    # 0.86-0.89
        "gliner": float,     # 0.84-0.88
        "stanza": float,     # 0.80-0.85 (зависит от задачи)
        "advanced_parser": float  # 0.88-0.90
    },
    "processor_usage": {
        "standard_ensemble": int,
        "advanced_parser": int
    },
    "processing_times": {
        "min_time": float,
        "max_time": float,
        "avg_time": float
    }
}
```

### Prometheus метрики (если используется)

```
nlp_processing_time_seconds{processor="stanza"}
nlp_processor_enabled{processor="stanza",enabled="1"}
nlp_ensemble_f1_score{strategy="4-processor"}
nlp_advanced_parser_usage_total
nlp_enrichment_rate{enabled="true"}
```

### Как проверить метрики

```bash
# Из API
curl -s http://localhost:8000/api/v1/admin/multi-nlp-settings/status | jq .

# Из логов
docker-compose logs backend | grep -E "F1|ensemble|Stanza|advanced"

# Из кода
from app.services.multi_nlp_manager import multi_nlp_manager
print(multi_nlp_manager.processing_statistics)
```

---

## 🔄 Gradual Rollout Strategy

### Phase 1: Development (Week 1)
```bash
# Запустить локально на dev машине
USE_ADVANCED_PARSER=false  # Сначала базовая конфигурация
USE_LLM_ENRICHMENT=false

# Убедиться, что:
# - 4 processor ensemble работает
# - Stanza корректно загружена
# - Нет ошибок в логах
```

### Phase 2: Staging (Week 2)
```bash
# Включить Advanced Parser на staging
USE_ADVANCED_PARSER=true
USE_LLM_ENRICHMENT=false

# Мониторить:
- Processing time (expect +10-15%)
- F1 score improvement (+1-2%)
- Error rates (should be 0%)
- Memory usage (+200-300MB)
```

### Phase 3: Canary Production (Week 3)
```bash
# Включить для 5% пользователей
# Используйте feature flag с процентом rollout

if user_id % 100 < 5:  # 5% users
    USE_ADVANCED_PARSER=true
else:
    USE_ADVANCED_PARSER=false
```

### Phase 4: Full Production (Week 4+)
```bash
# Если все метрики в норме
USE_ADVANCED_PARSER=true
USE_LLM_ENRICHMENT=false  # Пока не нужен LLM enrichment
```

### Phase 5: LLM Enrichment (опционально)
```bash
# Только если качество baseline отличное
USE_ADVANCED_PARSER=true
USE_LLM_ENRICHMENT=true
LANGEXTRACT_API_KEY=<key>  # или OLLAMA_BASE_URL

# Мониторить API costs и качество
```

---

## 🚨 Процедура Rollback

### Сценарий 1: Advanced Parser вызывает ошибки

```bash
# Сразу отключить
export USE_ADVANCED_PARSER=false

# Перезагрузить backend
docker-compose restart backend

# Проверить логи
docker-compose logs backend | tail -20

# Система автоматически вернется к Standard Ensemble
# (graceful degradation срабатывает)
```

### Сценарий 2: Stanza вызывает memory issues

```bash
# Отключить Stanza в settings_manager.py
# settings_manager.py:152 → "enabled": False

# Система будет использовать 3-processor ensemble:
# - SpaCy (1.0)
# - Natasha (1.2)
# - GLiNER (1.0)
# (Stanza будет пропущен, качество минимально снизится на ~0.5%)

docker-compose restart backend
```

### Сценарий 3: LLM Enrichment дорогостоящий

```bash
# Отключить обогащение
export USE_LLM_ENRICHMENT=false

# Система вернется к Advanced Parser без LLM
# (F1 score ~0.88-0.90 вместо ~0.90-0.92)

docker-compose restart backend
```

### Полный откат на базовый ensemble

```bash
# Отключить все новые компоненты
export USE_ADVANCED_PARSER=false
export USE_LLM_ENRICHMENT=false

# Удалить загруженные Stanza модели (опционально)
docker volume rm bookreader_nlp_stanza_models

# Перезагрузить
docker-compose down
docker-compose up -d

# Система вернется на спецификацию sessions 1-5
```

---

## 📈 Ожидаемые результаты

### До Sessions 6-7 (Sessions 1-5)
```
Processors: SpaCy, Natasha, GLiNER (3)
F1 Score: ~0.87-0.88
Processing Time: ~1.5s per chapter
Memory: ~1.2GB
Quality: Good
```

### После Session 6 (Stanza added)
```
Processors: SpaCy, Natasha, GLiNER, Stanza (4)
F1 Score: ~0.88-0.90 (+1-2%)
Processing Time: ~1.8s per chapter (+20%)
Memory: ~1.9GB (+700MB)
Quality: Better (improved dependency parsing)
```

### После Session 7 (Advanced Parser available)
```
Для длинных текстов (>=500 chars):
- Advanced Parser Mode: F1 ~0.88-0.90
- Advanced + LLM: F1 ~0.90-0.92 (+3-4%)
- Processing Time: 2.8s (без LLM) / 5.0s (с LLM)

Для коротких текстов (<500 chars):
- Standard Ensemble (автоматический fallback)
- F1 ~0.87-0.88
- Processing Time: ~1.5s
```

---

## 🔧 Troubleshooting

### Проблема: Stanza модель не загружается

```bash
# Проверить наличие файлов
docker-compose exec backend ls -la /root/stanza_resources/ru/

# Если папка пуста, загрузить заново
docker-compose exec backend python -c "import stanza; stanza.download('ru')"

# Если проблема с памятью, увеличить лимит
# docker-compose.yml → backend → deploy → memory: 3G
```

### Проблема: Advanced Parser не используется

```bash
# Проверить feature flag
docker-compose exec backend python -c "
import os
print(f'USE_ADVANCED_PARSER={os.environ.get(\"USE_ADVANCED_PARSER\", \"false\")}')
"

# Проверить инициализацию адаптера
docker-compose logs backend | grep -i "advanced parser"

# Если не инициализирован, проверить:
# 1. USE_ADVANCED_PARSER=true установлен
# 2. Нет ошибок при импорте AdvancedParserAdapter
# 3. Если используется, проверить текст >= 500 chars
```

### Проблема: Высокое потребление памяти

```bash
# Проверить использование памяти
docker stats backend

# Если >2GB, проверить:
# 1. Все NLP модели загружены корректно
# 2. Нет утечек памяти в коде
# 3. Есть ли одновременная обработка нескольких текстов

# Решение: Batch processing с очисткой памяти
docker-compose exec backend python -c "
import gc
import psutil
gc.collect()
print(f'Memory: {psutil.Process().memory_info().rss / 1024 / 1024:.1f}MB')
"
```

### Проблема: Медленная обработка

```bash
# Если Processing Time > 5s:
# 1. Проверить, используется ли Advanced Parser (может быть медленнее)
# 2. Если текст < 500 chars, должен использоваться Standard Ensemble
# 3. Если LLM enrichment включен, +2-3s на каждое описание

# Проверить время по компонентам
docker-compose logs backend | grep "processing_time"

# Оптимизация:
# - Отключить LLM enrichment если медленно
# - Использовать parallel processing для Stanza (future TODO)
# - Рассмотреть caching результатов
```

---

## 📚 Дополнительные ресурсы

### Документы Sessions 6-7
- `docs/reports/SESSIONS_6-7_FINAL_REPORT_2025-11-23.md` - Полный финальный отчет
- `backend/ADVANCED_PARSER_INTEGRATION.md` - Техническая документация
- `backend/INTEGRATION_SUMMARY.md` - Quick reference guide

### Тестовые файлы
- `backend/test_advanced_parser_integration.py` - 6 integration тестов
- `backend/test_enrichment_integration.py` - 3 enrichment теста

### API Endpoints (если добавлены)
```bash
# Проверить статус NLP
GET http://localhost:8000/api/v1/admin/multi-nlp-settings/status

# Получить статистику
GET http://localhost:8000/api/v1/admin/multi-nlp-settings/stats

# Обновить настройки Stanza
PUT http://localhost:8000/api/v1/admin/multi-nlp-settings/stanza
```

---

## ✅ Финальная проверка

Перед тем как считать deployment завершенным:

- [ ] Все контейнеры работают (`docker-compose ps`)
- [ ] Stanza модель загружена (~630MB)
- [ ] Advanced Parser инициализирован (если USE_ADVANCED_PARSER=true)
- [ ] API здоров (`curl http://localhost:8000/health`)
- [ ] Unit тесты PASSED (9/9)
- [ ] Нет ERROR в логах (`docker-compose logs | grep ERROR`)
- [ ] Processing time в норме (<5s)
- [ ] F1 score улучшен (+1-2% минимум)
- [ ] Graceful degradation работает (fallback на Standard Ensemble)

---

**Документ создан:** 2025-11-23
**Версия:** 1.0
**Статус:** Production-Ready
**Автор:** DevOps Engineer Agent v2.0
