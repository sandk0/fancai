# NLP Canary Deployment Runbook

## Оглавление

1. [Обзор](#обзор)
2. [Архитектура](#архитектура)
3. [Текущий статус](#текущий-статус)
4. [Процедуры управления](#процедуры-управления)
5. [Мониторинг и метрики](#мониторинг-и-метрики)
6. [Emergency Rollback](#emergency-rollback)
7. [Troubleshooting](#troubleshooting)

---

## Обзор

**Назначение:** Управление постепенным rollout новой Multi-NLP архитектуры (Strategy Pattern) с минимизацией рисков для production.

**Статус (2025-11-23):** ✅ **Canary система готова к использованию**
- Новая архитектура уже на **100% rollout** (Stage 4)
- Система canary deployment готова для будущих изменений
- Instant rollback capability доступен

**Ключевые преимущества:**
- 🎯 Gradual rollout (5% → 25% → 50% → 100%)
- 🔒 Consistent hashing - пользователи остаются в своих cohorts
- ⚡ Instant rollback одной командой
- 📊 Quality monitoring per cohort
- 🛡️ Feature flag integration для глобального контроля

---

## Архитектура

### Компоненты

```
┌─────────────────────────────────────────────────────────────┐
│                    Admin Dashboard                           │
│              /api/v1/admin/nlp-canary/*                     │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│               NLPCanaryDeployment                           │
│         (backend/app/services/nlp_canary.py)                │
│                                                             │
│  • Consistent hashing (SHA256)                              │
│  • Stage management (0-4)                                   │
│  • Cohort assignment cache                                  │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
┌─────────────────┐         ┌──────────────────┐
│ Feature Flags   │         │ nlp_rollout_config│
│   (Database)    │         │    (Database)     │
└─────────────────┘         └──────────────────┘
```

### Database Schema

**nlp_rollout_config** таблица:
```sql
CREATE TABLE nlp_rollout_config (
    id SERIAL PRIMARY KEY,
    current_stage INTEGER NOT NULL,           -- 0-4
    rollout_percentage INTEGER NOT NULL,      -- 0, 5, 25, 50, 100
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_by VARCHAR(255),                  -- admin email
    notes TEXT
);
```

### Rollout Stages

| Stage | Percentage | Name            | Description                    |
|-------|-----------|-----------------|--------------------------------|
| 0     | 0%        | DISABLED        | Все пользователи на старой архитектуре |
| 1     | 5%        | EARLY_TESTING   | Ранее тестирование с малой группой |
| 2     | 25%       | EXPANDED        | Расширенное тестирование |
| 3     | 50%       | HALF_ROLLOUT    | Половина пользователей |
| 4     | 100%      | FULL_ROLLOUT    | Полный rollout (production default) |

### Consistent Hashing Algorithm

```python
# Пример: Как пользователи распределяются по cohorts
user_hash = hash(user_id) % 100  # SHA256, результат 0-99

if user_hash < rollout_percentage:
    # Пользователь в new architecture cohort
    use_new_architecture = True
else:
    # Пользователь в old architecture cohort
    use_new_architecture = False
```

**Свойства:**
- ✅ Детерминированность - один user_id всегда попадает в один cohort
- ✅ Равномерное распределение - SHA256 обеспечивает uniform distribution
- ✅ No flapping - пользователи не переключаются между cohorts случайно

---

## Текущий статус

### Production Status (2025-11-23)

```bash
# Проверить текущий статус
python backend/scripts/nlp_rollback.py --status
```

**Expected Output:**
```
📊 NLP Canary Deployment Status
================================================================

🎯 Current Stage:
  Stage: 4 (FULL_ROLLOUT)
  Rollout: 100%

👥 User Distribution:
  Total users: XXXX
  New architecture: XXXX (100%)
  Old architecture: 0 (0%)

💾 Cache:
  Cached cohort assignments: XXX

🕐 Last Update:
  Timestamp: 2025-11-23T00:00:00+00:00
  Updated by: system
  Notes: Initial state: new architecture already at 100%

🚩 Feature Flag:
  USE_NEW_NLP_ARCHITECTURE: ENABLED

📈 Quality Metrics:
  [Detailed metrics for old vs new architecture]
```

### API Check

```bash
# Через API (требуется admin token)
curl -X GET https://fancai.ru/api/v1/admin/nlp-canary/status \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

---

## Процедуры управления

### 1. Продвижение на следующую стадию (Advance)

**Когда использовать:**
- После успешного тестирования текущей стадии
- Метрики показывают улучшение качества
- Нет критических ошибок в новой архитектуре

**CLI команда:**
```bash
python backend/scripts/nlp_rollback.py --advance --admin "admin@example.com"
```

**API запрос:**
```bash
curl -X POST https://fancai.ru/api/v1/admin/nlp-canary/advance \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Output:**
```
✅ Advanced successfully!
  Old stage: 1 (5%)
  New stage: 2 (25%)
  Admin: admin@example.com
  Timestamp: 2025-11-23T12:00:00+00:00
```

**Что происходит:**
1. Обновляется `nlp_rollout_config` в БД
2. Очищается cache cohort assignments
3. Пользователи перераспределяются по новым процентам
4. Записывается audit trail с admin email

**Post-advance checklist:**
- [ ] Проверить статус: `--status`
- [ ] Мониторить error rate в течение 1 часа
- [ ] Проверить quality metrics: `GET /nlp-canary/metrics`
- [ ] Проверить логи на warnings/errors

---

### 2. Emergency Rollback

**Когда использовать:**
- 🚨 Критическая ошибка в новой архитектуре
- 🚨 Резкое увеличение error rate (>2x)
- 🚨 Деградация quality metrics (F1 score падает)
- 🚨 Performance проблемы (timeout, high latency)

#### Full Rollback (0% - полное отключение)

**CLI команда:**
```bash
# EMERGENCY: Откат на 0% (все пользователи на старую архитектуру)
python backend/scripts/nlp_rollback.py --stage 0 --admin "admin@example.com"
```

**API запрос:**
```bash
curl -X POST https://fancai.ru/api/v1/admin/nlp-canary/rollback \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"stage": 0}'
```

**Expected Output:**
```
🔄 Rolling back to stage 0...

✅ Rollback complete!
  Old stage: 4 (100%)
  New stage: 0 (0%)
  Admin: admin@example.com
  Timestamp: 2025-11-23T12:00:00+00:00
```

#### Partial Rollback

```bash
# Откат на 25% (если проблемы на 100%)
python backend/scripts/nlp_rollback.py --stage 2 --admin "admin@example.com"

# Откат на 5% (minimal testing)
python backend/scripts/nlp_rollback.py --stage 1 --admin "admin@example.com"
```

**Post-rollback checklist:**
- [ ] Подтвердить rollback: `--status`
- [ ] Проверить что error rate снизился
- [ ] Уведомить команду в Slack/Email
- [ ] Создать incident report
- [ ] Проанализировать логи для root cause

---

### 3. Просмотр истории изменений

```bash
# Последние 10 изменений
python backend/scripts/nlp_rollback.py --history

# Последние 20 изменений
python backend/scripts/nlp_rollback.py --history --history-limit 20
```

**API запрос:**
```bash
curl -X GET "https://fancai.ru/api/v1/admin/nlp-canary/history?limit=10" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

**Пример вывода:**
```
📜 NLP Canary Rollout History (last 3 changes)
================================================================================

1. Stage 4 (100%)
   Timestamp: 2025-11-23T12:00:00+00:00
   Updated by: admin@example.com
   Notes: Advanced to full rollout after successful 50% testing

2. Stage 3 (50%)
   Timestamp: 2025-11-22T10:00:00+00:00
   Updated by: admin@example.com
   Notes: Advanced from stage 2 (25%) to stage 3 (50%)

3. Stage 0 (0%)
   Timestamp: 2025-11-21T18:30:00+00:00
   Updated by: admin@example.com
   Notes: ROLLBACK from stage 3 (50%) to stage 0 (0%)
```

---

## Мониторинг и метрики

### 1. Получить quality metrics

**CLI:**
```bash
# Включено в --status команду
python backend/scripts/nlp_rollback.py --status
```

**API:**
```bash
curl -X GET https://fancai.ru/api/v1/admin/nlp-canary/metrics \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

**Пример ответа:**
```json
{
  "old_architecture": {
    "name": "Legacy NLP Processor",
    "f1_score": 0.82,
    "precision": 0.80,
    "recall": 0.84,
    "avg_quality_score": 6.5,
    "avg_processing_time_ms": 850,
    "error_rate": 0.02
  },
  "new_architecture": {
    "name": "Multi-NLP Strategy Pattern (v2.0)",
    "f1_score": 0.91,
    "precision": 0.89,
    "recall": 0.93,
    "avg_quality_score": 8.5,
    "avg_processing_time_ms": 1100,
    "error_rate": 0.01
  }
}
```

### 2. Автоматические рекомендации

**API endpoint:**
```bash
curl -X GET https://fancai.ru/api/v1/admin/nlp-canary/recommendations \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

**Пример ответа:**
```json
{
  "current_stage": 2,
  "current_percentage": 25,
  "risk_level": "low",
  "recommendations": [
    {
      "type": "advance",
      "priority": "high",
      "message": "New architecture shows 10.7% improvement. Safe to advance."
    }
  ],
  "metrics_summary": {
    "f1_improvement": "10.7%",
    "old_f1": 0.82,
    "new_f1": 0.91,
    "old_error_rate": 0.02,
    "new_error_rate": 0.01
  }
}
```

### 3. Ключевые метрики для мониторинга

**Критические метрики:**
- ❗ **Error Rate** - не должен превышать старую архитектуру более чем на 50%
- ❗ **F1 Score** - должен быть выше или равен старой архитектуре
- ⚠️ **Processing Time** - допустимо увеличение до 30%

**Рекомендуемые пороги для advance:**
- ✅ F1 Score improvement > 5%
- ✅ Error rate не увеличился
- ✅ Processing time увеличился < 30%

**Рекомендуемые пороги для rollback:**
- 🚨 Error rate увеличился > 50%
- 🚨 F1 Score деградация > 5%
- 🚨 Timeout rate > 1%

---

## Emergency Rollback

### Быстрый откат (One-liner)

```bash
# SSH в production сервер
ssh admin@fancai.ru

# Emergency full rollback
cd /opt/fancai-vibe-hackathon/backend
python scripts/nlp_rollback.py --stage 0 --admin "incident-response@example.com"
```

### Альтернатива через API

```bash
# Если нет SSH доступа, используем API
curl -X POST https://fancai.ru/api/v1/admin/nlp-canary/rollback \
  -H "Authorization: Bearer $EMERGENCY_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"stage": 0}'
```

### Глобальное отключение через Feature Flag

```bash
# Если canary система не работает, отключаем через feature flag
# Это отключит новую архитектуру для ВСЕХ пользователей мгновенно

# Через psql
psql -U bookreader -d bookreader_prod -c "
UPDATE feature_flags
SET enabled = false
WHERE name = 'USE_NEW_NLP_ARCHITECTURE';
"

# Или через API
curl -X PUT https://fancai.ru/api/v1/admin/feature-flags/USE_NEW_NLP_ARCHITECTURE \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

### Post-Rollback Actions

1. **Немедленно:**
   - [ ] Проверить error rate снизился
   - [ ] Уведомить команду
   - [ ] Создать incident в ticketing system

2. **В течение 1 часа:**
   - [ ] Собрать логи с момента инцидента
   - [ ] Проанализировать error traces
   - [ ] Идентифицировать root cause

3. **В течение 24 часов:**
   - [ ] Создать postmortem document
   - [ ] Создать fix PR
   - [ ] Обновить runbook с lessons learned

---

## Troubleshooting

### Проблема: CLI команда не работает

**Симптомы:**
```
❌ Failed to get status: connection refused
```

**Решение:**
```bash
# 1. Проверить что PostgreSQL доступен
pg_isready -h localhost -p 5432

# 2. Проверить DATABASE_URL в .env
cat backend/.env | grep DATABASE_URL

# 3. Попробовать через Docker
docker-compose exec backend python scripts/nlp_rollback.py --status
```

---

### Проблема: Cohort assignments не обновляются

**Симптомы:**
- Пользователи остаются на старых cohorts после advance/rollback

**Решение:**
```bash
# Очистить cache cohort assignments
python backend/scripts/nlp_rollback.py --clear-cache

# Или через API
curl -X POST https://fancai.ru/api/v1/admin/nlp-canary/clear-cache \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

### Проблема: Метрики показывают нули

**Симптомы:**
```json
{
  "old_architecture": {"total_processed": 0},
  "new_architecture": {"total_processed": 0}
}
```

**Причина:**
- Метрики пока не интегрированы с реальной системой мониторинга (TODO)
- Показываются примерные значения

**Решение:**
- Интегрировать с реальной системой статистики NLP
- См. `TODO` комментарии в `nlp_canary.py::get_cohort_metrics()`

---

### Проблема: Feature flag конфликтует с canary

**Симптомы:**
- Canary показывает 50% rollout, но все пользователи на старой архитектуре

**Причина:**
- Feature flag `USE_NEW_NLP_ARCHITECTURE` отключен

**Решение:**
```bash
# Проверить feature flag
curl -X GET https://fancai.ru/api/v1/admin/feature-flags/USE_NEW_NLP_ARCHITECTURE \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# Включить feature flag
curl -X PUT https://fancai.ru/api/v1/admin/feature-flags/USE_NEW_NLP_ARCHITECTURE \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

---

## Best Practices

### 1. Gradual Rollout Strategy

**Рекомендуемая последовательность:**

1. **Stage 0 → Stage 1 (0% → 5%)**
   - Duration: 24 hours
   - Monitor: Error rate, F1 score
   - Success criteria: No errors, F1 improvement > 0%

2. **Stage 1 → Stage 2 (5% → 25%)**
   - Duration: 48 hours
   - Monitor: All metrics, user feedback
   - Success criteria: F1 improvement > 5%, error rate stable

3. **Stage 2 → Stage 3 (25% → 50%)**
   - Duration: 72 hours
   - Monitor: Performance metrics, processing time
   - Success criteria: All metrics stable or improved

4. **Stage 3 → Stage 4 (50% → 100%)**
   - Duration: 1 week
   - Monitor: Production load, long-term stability
   - Success criteria: No regressions, team confidence

### 2. Monitoring Checklist

**После каждого advance:**
- [ ] Check error rate every 15 minutes (first hour)
- [ ] Check quality metrics every hour (first day)
- [ ] Review user feedback (if available)
- [ ] Monitor performance metrics
- [ ] Check logs for warnings

**Daily monitoring:**
- [ ] Review daily summary of metrics
- [ ] Compare cohort performance
- [ ] Check for anomalies
- [ ] Update team on progress

### 3. Communication Protocol

**Advance операция:**
```
Slack: #nlp-team
📊 NLP Canary Advanced: 25% → 50%
Admin: @john.doe
Time: 2025-11-23 12:00 UTC
Next check: 2025-11-23 13:00 UTC
```

**Rollback операция:**
```
Slack: #incidents, #nlp-team
🚨 EMERGENCY ROLLBACK: NLP Canary 100% → 0%
Reason: Error rate increased 3x
Admin: @jane.smith
Incident: INC-2025-1123-01
```

---

## Контакты

**NLP Team:**
- Slack: #nlp-team
- Email: nlp-team@example.com

**On-call Escalation:**
- PagerDuty: nlp-canary-oncall

**Documentation:**
- Runbook: `/docs/operations/nlp-canary-deployment-runbook.md`
- Code: `/backend/app/services/nlp_canary.py`
- API: `/backend/app/routers/admin/nlp_canary.py`

---

## Changelog

| Date       | Version | Changes                                    | Author |
|------------|---------|-------------------------------------------|--------|
| 2025-11-23 | 1.0     | Initial runbook creation                  | Claude |
| 2025-11-23 | 1.0     | Added emergency procedures and troubleshooting | Claude |

---

## См. также

- [Multi-NLP Architecture Documentation](/docs/explanations/architecture/nlp/architecture.md)
- [Feature Flags Guide](/docs/guides/feature-flags.md)
- [Production Deployment Guide](/docs/guides/deployment/production-deployment.md)
- [Incident Response Playbook](/docs/operations/incident-response.md)
