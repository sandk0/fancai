# Руководство по деплою fancai на AWS

**Дата:** 2026-01-16
**Scope:** Анализ AWS сервисов и пошаговая инструкция по деплою
**Бюджет:** до $100/месяц
**Целевая нагрузка:** до 1000 пользователей
**Регион:** eu-central-1 (Frankfurt)

---

## Executive Summary

Проведён анализ AWS сервисов для деплоя проекта fancai с тремя уровнями конфигурации:

- **Tier 1 (Base):** До 500 пользователей, $37-68/мес
- **Tier 2 (Enhanced):** 500-2000 пользователей, $85-136/мес (2x мощнее)
- **Tier 3 (Pro):** 2000-5000 пользователей, $140-279/мес (3x мощнее)

Рекомендуется **Вариант B: EC2 + RDS Tier 1** для MVP: ~$37/мес с Free Tier.

Готовые docker-compose файлы для всех конфигураций: `deploy/aws/`.

---

## 1. Анализ требований проекта

### 1.1 Компоненты fancai

| Компонент | Технология | Требования RAM | Требования CPU |
|-----------|------------|----------------|----------------|
| **Frontend** | React + Vite | 256 MB | Минимальные |
| **Backend** | FastAPI + Uvicorn | 1-2 GB | 1-2 vCPU |
| **Database** | PostgreSQL 17 | 512 MB - 1 GB | 1 vCPU |
| **Cache** | Redis 7.4 | 256-512 MB | Минимальные |
| **Workers** | Celery | 512 MB - 1 GB | 1 vCPU |
| **Storage** | Files (EPUB, Images) | — | I/O bound |

### 1.2 Расчёт нагрузки для 1000 пользователей

| Метрика | Значение | Комментарий |
|---------|----------|-------------|
| **DAU (Daily Active Users)** | ~100-200 | ~10-20% от total |
| **Concurrent Users (peak)** | 20-50 | Пиковая нагрузка |
| **API Requests/sec** | 5-20 | При нормальной работе |
| **Data Transfer/month** | 50-100 GB | EPUB + изображения |
| **Storage** | 10-50 GB | Зависит от книг |

---

## 2. Уровни конфигурации

### 2.1 Три уровня мощности

Для каждого варианта деплоя доступны три уровня конфигурации:

| Уровень | Название | Пользователи | Характеристика |
|---------|----------|--------------|----------------|
| **Tier 1** | Base | До 500 | MVP, минимальный бюджет |
| **Tier 2** | Enhanced | 500-2000 | Продакшн, 2x мощность |
| **Tier 3** | Pro | 2000-5000 | Высокая нагрузка, 3x мощность |

### 2.2 Сравнение компонентов по уровням

#### EC2 Instance Types

| Уровень | Instance | vCPU | RAM | Цена/мес | Производительность |
|---------|----------|------|-----|----------|---------------------|
| **Tier 1** | t3.small | 2 | 2 GB | ~$20 | Базовая |
| **Tier 2** | t3.medium | 2 | 4 GB | ~$40 | **2x RAM** |
| **Tier 3** | t3.large | 2 | 8 GB | ~$80 | **4x RAM** |

#### RDS PostgreSQL

| Уровень | Instance | vCPU | RAM | Storage | Цена/мес* |
|---------|----------|------|-----|---------|-----------|
| **Tier 1** | db.t4g.micro | 2 | 1 GB | 20 GB | ~$18 |
| **Tier 2** | db.t4g.small | 2 | 2 GB | 50 GB | ~$35 |
| **Tier 3** | db.t4g.medium | 2 | 4 GB | 100 GB | ~$75 |

*\* db.t4g.micro бесплатен первый год (Free Tier)*

#### ElastiCache Redis

| Уровень | Instance | vCPU | RAM | Цена/мес* |
|---------|----------|------|-----|-----------|
| **Tier 1** | cache.t3.micro | 2 | 0.5 GB | ~$13 |
| **Tier 2** | cache.t3.small | 2 | 1.5 GB | ~$26 |
| **Tier 3** | cache.t3.medium | 2 | 3.0 GB | ~$52 |

*\* cache.t3.micro бесплатен первый год (Free Tier)*

#### EBS Storage

| Уровень | Size | Type | IOPS | Цена/мес |
|---------|------|------|------|----------|
| **Tier 1** | 20 GB | gp3 | 3000 | ~$2 |
| **Tier 2** | 50 GB | gp3 | 3000 | ~$5 |
| **Tier 3** | 100 GB | gp3 | 6000 | ~$12 |

---

## 3. Варианты деплоя

### 3.1 Сравнительная таблица (все уровни)

| Вариант | Tier 1 | Tier 2 | Tier 3 | Сложность | Надёжность |
|---------|--------|--------|--------|-----------|------------|
| **A: Single EC2** | ~$55 | ~$85 | ~$140 | Низкая | Средняя |
| **B: EC2 + RDS** | ~$65 | ~$115 | ~$220 | Средняя | Высокая |
| **C: Lightsail** | ~$45 | ~$75 | ~$135 | Низкая | Средняя |
| **D: ECS Fargate** | ~$120 | ~$180 | ~$280 | Высокая | Высокая |

### 3.2 Сравнительная таблица (базовая)

| Вариант | Стоимость | Сложность | Надёжность | Масштабируемость |
|---------|-----------|-----------|------------|------------------|
| **A: Single EC2** | ~$55-70 | Низкая | Средняя | Ограниченная |
| **B: EC2 + RDS** | ~$75-95 | Средняя | Высокая | Хорошая |
| **C: Lightsail** | ~$60-80 | Низкая | Средняя | Ограниченная |
| **D: ECS Fargate** | ~$120-150 | Высокая | Высокая | Отличная |

### 3.3 Вариант A: Single EC2 (Budget Option)

**Архитектура:**
```
┌─────────────────────────────────────────┐
│            EC2 Instance                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  │
│  │ Nginx   │  │ Backend │  │ Celery  │  │
│  │ +React  │  │ FastAPI │  │ Worker  │  │
│  └────┬────┘  └────┬────┘  └────┬────┘  │
│       │            │            │       │
│  ┌────┴────────────┴────────────┴────┐  │
│  │     Docker Compose                │  │
│  │  ┌──────────┐  ┌──────────┐      │  │
│  │  │PostgreSQL│  │  Redis   │      │  │
│  │  └──────────┘  └──────────┘      │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│              S3 Bucket                  │
│       (EPUB files, Images)              │
└─────────────────────────────────────────┘
```

#### Стоимость по уровням (eu-central-1)

**Tier 1 (Base) — ~$55/мес:**

| Сервис | Spec | Стоимость/мес |
|--------|------|---------------|
| EC2 t3.small | 2 vCPU, 2 GB RAM | ~$20 |
| EBS gp3 | 20 GB | ~$2 |
| S3 | 50 GB storage | ~$1.15 |
| CloudFront | 100 GB transfer | ~$8.50 |
| Route 53 | 1 hosted zone | $0.50 |
| Data Transfer | ~50 GB | ~$5 |
| **ИТОГО** | | **~$37 (Free Tier) / ~$55** |

**Tier 2 (Enhanced) — ~$85/мес:**

| Сервис | Spec | Стоимость/мес |
|--------|------|---------------|
| EC2 t3.medium | 2 vCPU, **4 GB RAM** | ~$40 |
| EBS gp3 | **50 GB** | ~$5 |
| S3 | 100 GB storage | ~$2.30 |
| CloudFront | 200 GB transfer | ~$17 |
| Route 53 | 1 hosted zone | $0.50 |
| Data Transfer | ~100 GB | ~$9 |
| **ИТОГО** | | **~$74 (Free Tier) / ~$85** |

**Tier 3 (Pro) — ~$140/мес:**

| Сервис | Spec | Стоимость/мес |
|--------|------|---------------|
| EC2 t3.large | 2 vCPU, **8 GB RAM** | ~$80 |
| EBS gp3 | **100 GB, 6000 IOPS** | ~$12 |
| S3 | 200 GB storage | ~$4.60 |
| CloudFront | 500 GB transfer | ~$40 |
| Route 53 | 1 hosted zone | $0.50 |
| Data Transfer | ~200 GB | ~$18 |
| **ИТОГО** | | **~$155** |

**Плюсы:**
- ✅ Самый дешёвый вариант
- ✅ Простая настройка (один сервер)
- ✅ Весь контроль в руках

**Минусы:**
- ❌ Single point of failure
- ❌ DB и app на одном сервере
- ❌ Сложнее масштабировать
- ❌ Нужно самому делать backups

---

### 3.4 Вариант B: EC2 + RDS (Рекомендуется)

**Архитектура:**
```
                    ┌──────────────┐
                    │  CloudFront  │
                    │    (CDN)     │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
       ┌──────────┐  ┌──────────┐  ┌──────────┐
       │   S3     │  │   ALB    │  │   S3     │
       │ Frontend │  │  (opt)   │  │  Files   │
       └──────────┘  └────┬─────┘  └──────────┘
                          │
                    ┌─────┴─────┐
                    │           │
                    ▼           ▼
              ┌──────────┐  ┌──────────┐
              │   EC2    │  │   EC2    │
              │ Backend  │  │ Celery   │
              │ + Redis  │  │ Worker   │
              └────┬─────┘  └────┬─────┘
                   │             │
                   └──────┬──────┘
                          │
                    ┌─────┴─────┐
                    │  RDS      │
                    │PostgreSQL │
                    └───────────┘
```

#### Стоимость по уровням (eu-central-1)

**Tier 1 (Base) — ~$65/мес (рекомендуется для MVP):**

| Сервис | Spec | Без Free Tier | С Free Tier |
|--------|------|---------------|-------------|
| EC2 t3.small | 2 vCPU, 2 GB RAM | ~$20 | ~$20 |
| EBS gp3 | 20 GB | ~$2 | ~$2 |
| RDS db.t4g.micro | 2 vCPU, 1 GB RAM | ~$15 | **$0** |
| RDS Storage | 20 GB gp2 | ~$3 | **$0** |
| ElastiCache cache.t3.micro | 0.5 GB | ~$13 | **$0** |
| S3 | 50 GB | ~$1.15 | ~$1.15 |
| CloudFront | 100 GB | ~$8.50 | ~$8.50 |
| Route 53 | 1 hosted zone | $0.50 | $0.50 |
| Data Transfer | ~50 GB | ~$5 | ~$5 |
| **ИТОГО** | | **~$68** | **~$37** |

**Tier 2 (Enhanced) — ~$115/мес:**

| Сервис | Spec | Без Free Tier | С Free Tier |
|--------|------|---------------|-------------|
| EC2 t3.medium | 2 vCPU, **4 GB RAM** | ~$40 | ~$40 |
| EBS gp3 | **50 GB** | ~$5 | ~$5 |
| RDS db.t4g.small | 2 vCPU, **2 GB RAM** | ~$30 | ~$30 |
| RDS Storage | **50 GB gp2** | ~$6 | ~$6 |
| ElastiCache cache.t3.small | **1.5 GB** | ~$26 | ~$26 |
| S3 | 100 GB | ~$2.30 | ~$2.30 |
| CloudFront | 200 GB | ~$17 | ~$17 |
| Route 53 | 1 hosted zone | $0.50 | $0.50 |
| Data Transfer | ~100 GB | ~$9 | ~$9 |
| **ИТОГО** | | **~$136** | **~$136*** |

*\* Free Tier не покрывает db.t4g.small и cache.t3.small*

**Tier 3 (Pro) — ~$220/мес:**

| Сервис | Spec | Стоимость/мес |
|--------|------|---------------|
| EC2 t3.large | 2 vCPU, **8 GB RAM** | ~$80 |
| EBS gp3 | **100 GB, 6000 IOPS** | ~$12 |
| RDS db.t4g.medium | 2 vCPU, **4 GB RAM** | ~$60 |
| RDS Storage | **100 GB gp2** | ~$12 |
| ElastiCache cache.t3.medium | **3.0 GB** | ~$52 |
| S3 | 200 GB | ~$4.60 |
| CloudFront | 500 GB | ~$40 |
| Route 53 | 1 hosted zone | $0.50 |
| Data Transfer | ~200 GB | ~$18 |
| **ИТОГО** | | **~$279** |

#### Производительность по уровням

| Метрика | Tier 1 | Tier 2 | Tier 3 |
|---------|--------|--------|--------|
| **Concurrent Users** | 20-50 | 50-150 | 150-500 |
| **API Requests/sec** | 10-30 | 30-100 | 100-300 |
| **DB Connections** | 50 | 150 | 400 |
| **Redis Operations/sec** | 1000 | 5000 | 15000 |
| **Background Jobs/min** | 10 | 30 | 100 |

**Плюсы:**
- ✅ Managed PostgreSQL (автоматические backups)
- ✅ Лучшая изоляция (DB отдельно)
- ✅ Free Tier существенно снижает стоимость на Tier 1
- ✅ Легче масштабировать между уровнями

**Минусы:**
- ❌ Дороже после окончания Free Tier
- ❌ Больше сервисов для управления

---

### 3.5 Вариант C: Lightsail (Simple Option)

**Архитектура:** Аналогична Single EC2, но на платформе Lightsail.

#### Стоимость по уровням

**Tier 1 (Base) — ~$45/мес:**

| Сервис | Spec | Стоимость/мес |
|--------|------|---------------|
| Lightsail Instance | 2 vCPU, 2 GB, 60 GB SSD | $12 |
| Lightsail Database | 1 GB RAM, 40 GB SSD | $15 |
| S3 | 50 GB | ~$1.15 |
| CloudFront | 100 GB | ~$8.50 |
| Route 53 | 1 hosted zone | $0.50 |
| **ИТОГО** | | **~$37** |

**Tier 2 (Enhanced) — ~$75/мес:**

| Сервис | Spec | Стоимость/мес |
|--------|------|---------------|
| Lightsail Instance | 2 vCPU, **4 GB**, 80 GB SSD | $20 |
| Lightsail Database | **2 GB RAM**, 80 GB SSD | $30 |
| S3 | 100 GB | ~$2.30 |
| CloudFront | 200 GB | ~$17 |
| Route 53 | 1 hosted zone | $0.50 |
| **ИТОГО** | | **~$70** |

**Tier 3 (Pro) — ~$135/мес:**

| Сервис | Spec | Стоимость/мес |
|--------|------|---------------|
| Lightsail Instance | 2 vCPU, **8 GB**, 160 GB SSD | $40 |
| Lightsail Database | **4 GB RAM**, 120 GB SSD | $60 |
| S3 | 200 GB | ~$4.60 |
| CloudFront | 500 GB | ~$40 |
| Route 53 | 1 hosted zone | $0.50 |
| **ИТОГО** | | **~$145** |

#### Сравнение Lightsail Instances

| Plan | vCPU | RAM | SSD | Transfer | Цена/мес |
|------|------|-----|-----|----------|----------|
| $12 | 2 | 2 GB | 60 GB | 3 TB | $12 |
| $20 | 2 | 4 GB | 80 GB | 4 TB | $20 |
| $40 | 2 | 8 GB | 160 GB | 5 TB | $40 |
| $80 | 4 | 16 GB | 320 GB | 6 TB | $80 |

**Плюсы:**
- ✅ Фиксированная цена (предсказуемо)
- ✅ Простой интерфейс
- ✅ Включённый трафик (3-6 TB)
- ✅ Самый дешёвый managed DB

**Минусы:**
- ❌ Меньше гибкости
- ❌ Нет ElastiCache (Redis в Docker)
- ❌ Ограниченная интеграция с AWS сервисами
- ❌ Нет Free Tier

---

### 3.6 Вариант D: ECS Fargate (Enterprise Option)

**Архитектура:**
```
                    ┌──────────────┐
                    │  CloudFront  │
                    └──────┬───────┘
                           │
                    ┌──────┴───────┐
                    │     ALB      │
                    │ (Load Bal.)  │
                    └──────┬───────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
   ┌──────────┐     ┌──────────┐     ┌──────────┐
   │ Fargate  │     │ Fargate  │     │ Fargate  │
   │ Backend  │     │ Backend  │     │ Celery   │
   │  Task 1  │     │  Task 2  │     │  Worker  │
   └────┬─────┘     └────┬─────┘     └────┬─────┘
        │                │                │
        └────────────────┼────────────────┘
                         │
              ┌──────────┴──────────┐
              │                     │
              ▼                     ▼
        ┌──────────┐          ┌──────────┐
        │   RDS    │          │ElastiCache│
        │PostgreSQL│          │  Redis   │
        └──────────┘          └──────────┘
```

#### Стоимость по уровням

**Tier 1 (Base) — ~$120/мес:**

| Сервис | Spec | Стоимость/мес |
|--------|------|---------------|
| Fargate Backend | 0.5 vCPU, 1 GB × 2 tasks | ~$35 |
| Fargate Celery | 0.5 vCPU, 1 GB × 1 task | ~$18 |
| ALB | Fixed + LCU | ~$20 |
| RDS db.t4g.micro | 1 GB RAM | ~$15* |
| ElastiCache cache.t3.micro | 0.5 GB | ~$13* |
| S3 + CloudFront | | ~$10 |
| Route 53 | | $0.50 |
| **ИТОГО** | | **~$112 / ~$84*** |

*\* С Free Tier*

**Tier 2 (Enhanced) — ~$180/мес:**

| Сервис | Spec | Стоимость/мес |
|--------|------|---------------|
| Fargate Backend | 1 vCPU, **2 GB** × 2 tasks | ~$70 |
| Fargate Celery | 0.5 vCPU, 1 GB × 2 tasks | ~$35 |
| ALB | Fixed + LCU | ~$25 |
| RDS db.t4g.small | **2 GB RAM** | ~$30 |
| ElastiCache cache.t3.small | **1.5 GB** | ~$26 |
| S3 + CloudFront | | ~$20 |
| Route 53 | | $0.50 |
| **ИТОГО** | | **~$207** |

**Tier 3 (Pro) — ~$280/мес:**

| Сервис | Spec | Стоимость/мес |
|--------|------|---------------|
| Fargate Backend | 2 vCPU, **4 GB** × 3 tasks | ~$150 |
| Fargate Celery | 1 vCPU, 2 GB × 2 tasks | ~$50 |
| ALB | Fixed + LCU | ~$35 |
| RDS db.t4g.medium | **4 GB RAM** | ~$60 |
| ElastiCache cache.t3.medium | **3.0 GB** | ~$52 |
| S3 + CloudFront | | ~$45 |
| Route 53 | | $0.50 |
| **ИТОГО** | | **~$393** |

#### Преимущества Fargate

| Особенность | Описание |
|-------------|----------|
| Auto-scaling | Автоматическое масштабирование tasks |
| No EC2 management | Не нужно управлять серверами |
| Built-in HA | Распределение по AZ |
| Pay-per-use | Платите только за используемое время |
| Rolling deployments | Blue/Green деплой из коробки |

**Плюсы:**
- ✅ Serverless контейнеры
- ✅ Автоматическое масштабирование
- ✅ Высокая доступность
- ✅ Нет управления серверами

**Минусы:**
- ❌ Самый дорогой вариант
- ❌ Сложнее настройка
- ❌ Превышает бюджет $100
- ❌ Overkill для MVP

---

## 4. Итоговая матрица выбора

### 4.1 Выбор по бюджету

| Бюджет | Рекомендация | Вариант | Tier |
|--------|--------------|---------|------|
| **< $50** | Lightsail | C | Tier 1 |
| **$50-80** | EC2 + RDS (Free Tier) | B | Tier 1 |
| **$80-120** | Single EC2 Enhanced | A | Tier 2 |
| **$120-150** | EC2 + RDS Enhanced | B | Tier 2 |
| **$150-200** | ECS Fargate | D | Tier 1 |
| **> $200** | EC2 + RDS Pro | B | Tier 3 |

### 4.2 Выбор по количеству пользователей

| Пользователи | Рекомендация | Вариант | Tier |
|--------------|--------------|---------|------|
| **< 200** | Любой Tier 1 | A/B/C | Tier 1 |
| **200-500** | EC2 + RDS | B | Tier 1-2 |
| **500-1000** | EC2 + RDS Enhanced | B | Tier 2 |
| **1000-2000** | EC2 + RDS Pro | B | Tier 2-3 |
| **> 2000** | ECS Fargate | D | Tier 2+ |

### 4.3 Выбор по приоритету

| Приоритет | Рекомендация |
|-----------|--------------|
| **Минимальная стоимость** | Lightsail Tier 1 (~$37) |
| **Лучшее соотношение цена/качество** | EC2 + RDS Tier 1 с Free Tier (~$37) |
| **Максимальная производительность в бюджете** | Single EC2 Tier 2 (~$85) |
| **Enterprise-ready** | ECS Fargate Tier 2 (~$207) |
| **Простота управления** | Lightsail Tier 2 (~$70) |

---

## 5. Рекомендация

### Рекомендуемый вариант: **B (EC2 + RDS) Tier 1**

**Почему:**
1. **Free Tier** — первый год ~$37/мес вместо $68
2. **Managed services** — PostgreSQL с автоматическими backups
3. **Масштабируемость** — легко перейти на Tier 2/3
4. **Надёжность** — DB изолирована от application

### Путь масштабирования

```
MVP ($37/мес)          Growth ($115/мес)       Scale ($220/мес)
     │                       │                      │
     ▼                       ▼                      ▼
┌──────────┐           ┌──────────┐           ┌──────────┐
│ Tier 1   │    →      │ Tier 2   │    →      │ Tier 3   │
│ 500 users│           │ 2000 users│          │ 5000 users│
│ t3.small │           │ t3.medium │          │ t3.large  │
│ 1GB DB   │           │ 2GB DB    │          │ 4GB DB    │
└──────────┘           └──────────┘           └──────────┘
```

**Альтернативы по ситуации:**
- **Бюджет критичен** → Lightsail Tier 1 (~$37)
- **Нужна максимальная мощность** → Single EC2 Tier 2/3
- **Enterprise requirements** → ECS Fargate

---

## 6. Пошаговая инструкция деплоя (Вариант B)

### Шаг 0: Подготовка

**Требования:**
- AWS аккаунт (зарегистрируйтесь на [aws.amazon.com](https://aws.amazon.com))
- Установленный AWS CLI
- Домен fancai.ru с доступом к DNS

**Установка AWS CLI:**
```bash
# macOS
brew install awscli

# Linux
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Конфигурация
aws configure
# AWS Access Key ID: [ваш ключ]
# AWS Secret Access Key: [ваш секрет]
# Default region name: eu-central-1
# Default output format: json
```

---

### Шаг 1: Создание VPC и Security Groups

```bash
# Создать VPC (или использовать default)
aws ec2 describe-vpcs --region eu-central-1

# Создать Security Group для EC2
aws ec2 create-security-group \
  --group-name fancai-ec2-sg \
  --description "Security group for fancai EC2" \
  --region eu-central-1

# Получить ID созданной группы
SG_ID=$(aws ec2 describe-security-groups \
  --group-names fancai-ec2-sg \
  --query 'SecurityGroups[0].GroupId' \
  --output text \
  --region eu-central-1)

# Добавить правила
# SSH (ограничить своим IP!)
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 22 \
  --cidr YOUR_IP/32 \
  --region eu-central-1

# HTTP
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 80 \
  --cidr 0.0.0.0/0 \
  --region eu-central-1

# HTTPS
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0 \
  --region eu-central-1
```

---

### Шаг 2: Создание RDS PostgreSQL

```bash
# Создать DB Subnet Group
aws rds create-db-subnet-group \
  --db-subnet-group-name fancai-db-subnet \
  --db-subnet-group-description "Subnet group for fancai DB" \
  --subnet-ids subnet-xxx subnet-yyy \
  --region eu-central-1

# Создать Security Group для RDS
aws ec2 create-security-group \
  --group-name fancai-rds-sg \
  --description "Security group for fancai RDS" \
  --region eu-central-1

RDS_SG_ID=$(aws ec2 describe-security-groups \
  --group-names fancai-rds-sg \
  --query 'SecurityGroups[0].GroupId' \
  --output text \
  --region eu-central-1)

# Разрешить доступ только от EC2
aws ec2 authorize-security-group-ingress \
  --group-id $RDS_SG_ID \
  --protocol tcp \
  --port 5432 \
  --source-group $SG_ID \
  --region eu-central-1

# Создать RDS инстанс
aws rds create-db-instance \
  --db-instance-identifier fancai-db \
  --db-instance-class db.t4g.micro \
  --engine postgres \
  --engine-version 17 \
  --master-username fancai_admin \
  --master-user-password "YOUR_STRONG_PASSWORD_HERE" \
  --allocated-storage 20 \
  --storage-type gp2 \
  --vpc-security-group-ids $RDS_SG_ID \
  --db-subnet-group-name fancai-db-subnet \
  --backup-retention-period 7 \
  --no-publicly-accessible \
  --region eu-central-1

# Дождаться создания (~10-15 минут)
aws rds wait db-instance-available \
  --db-instance-identifier fancai-db \
  --region eu-central-1

# Получить endpoint
aws rds describe-db-instances \
  --db-instance-identifier fancai-db \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text \
  --region eu-central-1
```

---

### Шаг 3: Создание ElastiCache Redis

```bash
# Security Group для ElastiCache
aws ec2 create-security-group \
  --group-name fancai-redis-sg \
  --description "Security group for fancai Redis" \
  --region eu-central-1

REDIS_SG_ID=$(aws ec2 describe-security-groups \
  --group-names fancai-redis-sg \
  --query 'SecurityGroups[0].GroupId' \
  --output text \
  --region eu-central-1)

# Разрешить доступ от EC2
aws ec2 authorize-security-group-ingress \
  --group-id $REDIS_SG_ID \
  --protocol tcp \
  --port 6379 \
  --source-group $SG_ID \
  --region eu-central-1

# Создать Subnet Group для ElastiCache
aws elasticache create-cache-subnet-group \
  --cache-subnet-group-name fancai-redis-subnet \
  --cache-subnet-group-description "Subnet group for fancai Redis" \
  --subnet-ids subnet-xxx subnet-yyy \
  --region eu-central-1

# Создать Redis кластер
aws elasticache create-cache-cluster \
  --cache-cluster-id fancai-redis \
  --cache-node-type cache.t3.micro \
  --engine redis \
  --engine-version 7.0 \
  --num-cache-nodes 1 \
  --cache-subnet-group-name fancai-redis-subnet \
  --security-group-ids $REDIS_SG_ID \
  --region eu-central-1

# Получить endpoint (~5 минут)
aws elasticache describe-cache-clusters \
  --cache-cluster-id fancai-redis \
  --show-cache-node-info \
  --query 'CacheClusters[0].CacheNodes[0].Endpoint.Address' \
  --output text \
  --region eu-central-1
```

---

### Шаг 4: Создание S3 Bucket

```bash
# Создать bucket для файлов
aws s3 mb s3://fancai-storage-prod --region eu-central-1

# Настроить CORS
cat > /tmp/cors.json << 'EOF'
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET", "PUT", "POST"],
      "AllowedOrigins": ["https://fancai.ru"],
      "ExposeHeaders": ["ETag"]
    }
  ]
}
EOF

aws s3api put-bucket-cors \
  --bucket fancai-storage-prod \
  --cors-configuration file:///tmp/cors.json

# Создать bucket для frontend (static hosting)
aws s3 mb s3://fancai-frontend-prod --region eu-central-1

# Включить static website hosting
aws s3 website s3://fancai-frontend-prod \
  --index-document index.html \
  --error-document index.html
```

---

### Шаг 5: Создание EC2 Instance

```bash
# Найти AMI (Amazon Linux 2023)
AMI_ID=$(aws ec2 describe-images \
  --owners amazon \
  --filters "Name=name,Values=al2023-ami-2023*-x86_64" \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
  --output text \
  --region eu-central-1)

# Создать Key Pair
aws ec2 create-key-pair \
  --key-name fancai-key \
  --query 'KeyMaterial' \
  --output text \
  --region eu-central-1 > ~/.ssh/fancai-key.pem

chmod 400 ~/.ssh/fancai-key.pem

# Создать EC2 instance
aws ec2 run-instances \
  --image-id $AMI_ID \
  --instance-type t3.small \
  --key-name fancai-key \
  --security-group-ids $SG_ID \
  --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":20,"VolumeType":"gp3"}}]' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=fancai-backend}]' \
  --region eu-central-1

# Получить Public IP
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=fancai-backend" \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text \
  --region eu-central-1)

EC2_IP=$(aws ec2 describe-instances \
  --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text \
  --region eu-central-1)

echo "EC2 IP: $EC2_IP"
```

---

### Шаг 6: Настройка EC2 (SSH)

```bash
# Подключиться к EC2
ssh -i ~/.ssh/fancai-key.pem ec2-user@$EC2_IP

# На EC2: Установить Docker
sudo dnf update -y
sudo dnf install -y docker git
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker ec2-user

# Установить Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Перелогиниться для применения группы docker
exit
ssh -i ~/.ssh/fancai-key.pem ec2-user@$EC2_IP

# Клонировать репозиторий
git clone https://github.com/YOUR_USERNAME/fancai-vibe-hackathon.git
cd fancai-vibe-hackathon
```

---

### Шаг 7: Создание .env файла на EC2

```bash
# Создать .env файл
cat > .env << 'EOF'
# Database (RDS)
DB_USER=fancai_admin
DB_PASSWORD=YOUR_RDS_PASSWORD
DB_HOST=fancai-db.xxxxxxxxxx.eu-central-1.rds.amazonaws.com
DB_PORT=5432
DB_NAME=fancai
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}

# Redis (ElastiCache)
REDIS_HOST=fancai-redis.xxxxxx.0001.euc1.cache.amazonaws.com
REDIS_PORT=6379
REDIS_URL=redis://${REDIS_HOST}:${REDIS_PORT}/0
CELERY_BROKER_URL=redis://${REDIS_HOST}:${REDIS_PORT}/1
CELERY_RESULT_BACKEND=redis://${REDIS_HOST}:${REDIS_PORT}/2

# Security
SECRET_KEY=your-64-char-secret-key-here-use-python-secrets-token-urlsafe
JWT_SECRET_KEY=another-64-char-secret-key-for-jwt-tokens

# Google AI
GOOGLE_API_KEY=your-google-ai-api-key

# Domain
DOMAIN_NAME=fancai.ru
DOMAIN_URL=https://fancai.ru
CORS_ORIGINS=https://fancai.ru

# S3
AWS_S3_BUCKET=fancai-storage-prod
AWS_REGION=eu-central-1

# Misc
DEBUG=false
LOG_LEVEL=INFO
WORKERS_COUNT=2
EOF
```

---

### Шаг 8: Создание docker-compose.aws.yml

```bash
cat > docker-compose.aws.yml << 'EOF'
version: '3.8'

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile.lite.prod
    container_name: fancai-backend
    restart: always
    env_file:
      - .env
    ports:
      - "8000:8000"
    volumes:
      - ./backend/storage:/app/storage
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 1G

  celery-worker:
    build:
      context: ./backend
      dockerfile: Dockerfile.lite.prod
    container_name: fancai-celery
    restart: always
    env_file:
      - .env
    command: celery -A app.core.celery_app worker --loglevel=info --concurrency=2
    volumes:
      - ./backend/storage:/app/storage
    depends_on:
      - backend
    deploy:
      resources:
        limits:
          memory: 768M

  celery-beat:
    build:
      context: ./backend
      dockerfile: Dockerfile.lite.prod
    container_name: fancai-beat
    restart: always
    env_file:
      - .env
    command: celery -A app.core.celery_app beat --loglevel=info
    depends_on:
      - celery-worker
    deploy:
      resources:
        limits:
          memory: 256M

  nginx:
    image: nginx:1.27-alpine
    container_name: fancai-nginx
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
      - ./frontend/dist:/usr/share/nginx/html:ro
    depends_on:
      - backend
    deploy:
      resources:
        limits:
          memory: 128M
EOF
```

---

### Шаг 9: Сборка и запуск

```bash
# Сборка frontend
cd frontend
npm ci
npm run build
cd ..

# Запуск миграций
docker-compose -f docker-compose.aws.yml run --rm backend alembic upgrade head

# Запуск сервисов
docker-compose -f docker-compose.aws.yml up -d

# Проверка
docker-compose -f docker-compose.aws.yml ps
docker-compose -f docker-compose.aws.yml logs -f backend
```

---

### Шаг 10: Настройка CloudFront и SSL

```bash
# Создать SSL сертификат в ACM (us-east-1 для CloudFront!)
aws acm request-certificate \
  --domain-name fancai.ru \
  --subject-alternative-names "*.fancai.ru" \
  --validation-method DNS \
  --region us-east-1

# Получить CNAME для валидации
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:us-east-1:ACCOUNT:certificate/CERT_ID \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord' \
  --region us-east-1

# Добавить CNAME запись в DNS домена (через регистратор)
# После валидации (~5-30 минут) создать CloudFront distribution

# Создать CloudFront distribution (через консоль AWS проще)
# Origin: S3 bucket (fancai-frontend-prod)
# Alternate domain: fancai.ru
# SSL Certificate: выбрать созданный сертификат
# Default root object: index.html
```

---

### Шаг 11: Настройка Route 53

```bash
# Создать hosted zone
aws route53 create-hosted-zone \
  --name fancai.ru \
  --caller-reference $(date +%s)

# Получить Name Servers
aws route53 get-hosted-zone \
  --id Z0XXXXXXXXXX \
  --query 'DelegationSet.NameServers'

# Обновить NS записи у регистратора домена

# Создать A запись для API (EC2)
aws route53 change-resource-record-sets \
  --hosted-zone-id Z0XXXXXXXXXX \
  --change-batch '{
    "Changes": [{
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "api.fancai.ru",
        "Type": "A",
        "TTL": 300,
        "ResourceRecords": [{"Value": "'$EC2_IP'"}]
      }
    }]
  }'

# Создать ALIAS запись для CloudFront
# (проще через AWS Console)
```

---

## 7. Мониторинг и обслуживание

### 7.1 CloudWatch Alarms

```bash
# Alarm на CPU > 80%
aws cloudwatch put-metric-alarm \
  --alarm-name fancai-cpu-high \
  --metric-name CPUUtilization \
  --namespace AWS/EC2 \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=InstanceId,Value=$INSTANCE_ID \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:eu-central-1:ACCOUNT:alerts \
  --region eu-central-1

# Alarm на RDS connections
aws cloudwatch put-metric-alarm \
  --alarm-name fancai-rds-connections \
  --metric-name DatabaseConnections \
  --namespace AWS/RDS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=DBInstanceIdentifier,Value=fancai-db \
  --evaluation-periods 2 \
  --region eu-central-1
```

### 7.2 Автоматические Backups

RDS уже настроен с `backup-retention-period 7`. Дополнительно:

```bash
# Ежедневный snapshot EC2 (через EventBridge)
# Создать Lambda или использовать AWS Backup
```

### 7.3 Обновление приложения

```bash
# На EC2
cd ~/fancai-vibe-hackathon
git pull origin main

# Пересборка
docker-compose -f docker-compose.aws.yml build
docker-compose -f docker-compose.aws.yml up -d

# Миграции (если есть)
docker-compose -f docker-compose.aws.yml run --rm backend alembic upgrade head
```

---

## 8. Итоговая стоимость (Вариант B)

### Первый год (с Free Tier)

| Сервис | Стоимость/мес |
|--------|---------------|
| EC2 t3.small | $20 |
| EBS 20GB gp3 | $2 |
| RDS db.t4g.micro | **$0** (Free Tier) |
| ElastiCache cache.t3.micro | **$0** (Free Tier) |
| S3 50GB | $1.15 |
| CloudFront 100GB | $8.50 |
| Route 53 | $0.50 |
| Data Transfer | ~$5 |
| **ИТОГО** | **~$37/мес** |

### После Free Tier

| Сервис | Стоимость/мес |
|--------|---------------|
| EC2 t3.small | $20 |
| EBS 20GB gp3 | $2 |
| RDS db.t4g.micro + 20GB | $18 |
| ElastiCache cache.t3.micro | $13 |
| S3 50GB | $1.15 |
| CloudFront 100GB | $8.50 |
| Route 53 | $0.50 |
| Data Transfer | ~$5-10 |
| **ИТОГО** | **~$68-73/мес** |

### Оптимизация (если нужно снизить)

| Действие | Экономия |
|----------|----------|
| Reserved Instance EC2 (1 год) | -30% (~$6) |
| Reserved Instance RDS (1 год) | -30% (~$5) |
| Spot Instance для Celery | -70% |
| Использовать Redis в Docker | -$13 |

---

## 9. Checklist перед запуском

- [ ] AWS аккаунт создан и настроен
- [ ] AWS CLI установлен и сконфигурирован
- [ ] VPC и Security Groups созданы
- [ ] RDS PostgreSQL запущен и доступен
- [ ] ElastiCache Redis запущен и доступен
- [ ] S3 buckets созданы
- [ ] EC2 instance запущен
- [ ] Docker и Docker Compose установлены на EC2
- [ ] Репозиторий склонирован на EC2
- [ ] .env файл создан с правильными credentials
- [ ] Frontend собран (`npm run build`)
- [ ] Миграции выполнены (`alembic upgrade head`)
- [ ] Docker Compose запущен
- [ ] SSL сертификат получен и валидирован
- [ ] CloudFront distribution создан
- [ ] DNS записи настроены
- [ ] CloudWatch alarms настроены
- [ ] Приложение доступно по https://fancai.ru

---

## 10. Готовые файлы деплоя

Все конфигурационные файлы находятся в директории `deploy/aws/`.

### 10.1 Структура файлов

```
deploy/aws/
├── README.md                           # Документация
├── docker-compose.single-ec2.tier1.yml # Вариант A: Tier 1
├── docker-compose.single-ec2.tier2.yml # Вариант A: Tier 2
├── docker-compose.single-ec2.tier3.yml # Вариант A: Tier 3
├── docker-compose.ec2-rds.tier1.yml    # Вариант B: Tier 1 ⭐
├── docker-compose.ec2-rds.tier2.yml    # Вариант B: Tier 2
├── docker-compose.ec2-rds.tier3.yml    # Вариант B: Tier 3
├── docker-compose.lightsail.tier1.yml  # Вариант C: Tier 1
├── .env.tier1.example                  # Шаблон окружения Tier 1
├── .env.tier2.example                  # Шаблон окружения Tier 2
├── .env.tier3.example                  # Шаблон окружения Tier 3
└── nginx/
    ├── nginx.conf                      # Nginx для Tier 1/2
    └── nginx-tier3.conf                # Nginx с load balancing
```

### 10.2 Быстрый выбор файла

| Бюджет | Пользователи | Файл | Команда |
|--------|--------------|------|---------|
| ~$37 | до 500 | `docker-compose.ec2-rds.tier1.yml` | Free Tier первый год |
| ~$55 | до 500 | `docker-compose.single-ec2.tier1.yml` | Всё в одном сервере |
| ~$85 | 500-2000 | `docker-compose.single-ec2.tier2.yml` | 4GB RAM |
| ~$115 | 500-2000 | `docker-compose.ec2-rds.tier2.yml` | Managed DB |
| ~$220 | 2000-5000 | `docker-compose.ec2-rds.tier3.yml` | Load balancing |

### 10.3 Использование

```bash
# 1. Скопировать .env
cd deploy/aws
cp .env.tier1.example .env.tier1
nano .env.tier1  # Заполнить значения

# 2. Сборка frontend
cd ../../frontend
npm ci && npm run build
cd ../deploy/aws

# 3. Сборка и запуск
docker-compose -f docker-compose.ec2-rds.tier1.yml build
docker-compose -f docker-compose.ec2-rds.tier1.yml run --rm backend alembic upgrade head
docker-compose -f docker-compose.ec2-rds.tier1.yml up -d

# 4. Проверка
docker-compose -f docker-compose.ec2-rds.tier1.yml ps
docker-compose -f docker-compose.ec2-rds.tier1.yml logs -f backend
```

### 10.4 Переход между уровнями

**Tier 1 → Tier 2:**
```bash
# 1. Обновить AWS ресурсы (RDS, ElastiCache)
# 2. Скопировать новый .env
cp .env.tier2.example .env.tier2
# 3. Перезапустить с новым файлом
docker-compose -f docker-compose.ec2-rds.tier1.yml down
docker-compose -f docker-compose.ec2-rds.tier2.yml up -d
```

**Tier 2 → Tier 3:**
```bash
# 1. Обновить AWS ресурсы
# 2. Обновить nginx конфиг
cp nginx/nginx-tier3.conf nginx/nginx.conf
# 3. Скопировать новый .env
cp .env.tier3.example .env.tier3
# 4. Перезапустить
docker-compose -f docker-compose.ec2-rds.tier2.yml down
docker-compose -f docker-compose.ec2-rds.tier3.yml up -d
```

---

## 11. Источники

- [AWS Fargate Pricing](https://aws.amazon.com/fargate/pricing/)
- [Amazon RDS for PostgreSQL Pricing](https://aws.amazon.com/rds/postgresql/pricing/)
- [Amazon ElastiCache Pricing](https://aws.amazon.com/elasticache/pricing/)
- [AWS Lightsail vs EC2 Comparison](https://deploy.me/blog/aws-lightsail-vs-ec2-2025)
- [EC2 t3.small Pricing](https://instances.vantage.sh/aws/ec2/t3.small)
- [AWS Pricing Calculator](https://calculator.aws/)
- [CloudFront Pricing](https://aws.amazon.com/cloudfront/pricing/)

---

**Создано:** 2026-01-16
**Обновлено:** 2026-01-16
**Версия:** 2.0 (добавлены Tier 2/3 конфигурации и deployment files)
**Следующий шаг:** Выбрать конфигурацию из `deploy/aws/` и начать с Шага 0
