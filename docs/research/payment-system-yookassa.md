# Интеграция платежных систем для fancai.ru — Полный отчет

> **Канонические параметры**: См. [SHARED_ASSUMPTIONS.md](SHARED_ASSUMPTIONS.md)

> Дата: 2026-03-14
> Стек: FastAPI + Python 3.12 + PostgreSQL 17 + React 19
> Рынок: Россия (основной), международный (дополнительный)
> Тип продукта: AI SaaS — читалка с ИИ-иллюстрациями и интерактивным глоссарием

---

## Содержание

1. [YooKassa (ЮKassa) — основная платежная система](#1-yookassa-юkassa--основная-платежная-система)
2. [Альтернативные платежные системы](#2-альтернативные-платежные-системы)
3. [Подписочная модель биллинга](#3-подписочная-модель-биллинга)
4. [Система кредитов (top-up)](#4-система-кредитов-top-up)
5. [Архитектура интеграции с FastAPI](#5-архитектура-интеграции-с-fastapi)
6. [Frontend-интеграция (React)](#6-frontend-интеграция-react)
7. [Юридические требования и комплаенс](#7-юридические-требования-и-комплаенс)
8. [Безопасность](#8-безопасность)
9. [Рекомендации для fancai.ru](#9-рекомендации-для-fancairu)

---

## 1. YooKassa (ЮKassa) — основная платежная система

### 1.1 Обзор API

YooKassa (ранее Яндекс.Касса) — крупнейший платежный агрегатор в России, принадлежит Сберу. Обслуживает более 200 000 интернет-магазинов. REST API v3, документация на русском и английском.

**Ключевые возможности:**

- Прием платежей (одноразовые и рекуррентные)
- Возвраты (полные и частичные)
- Фискализация по 54-ФЗ (встроенная или через стороннюю кассу)
- Безопасные сделки
- Выплаты (payouts)
- Тестовый режим (sandbox)

**Базовый URL:** `https://api.yookassa.ru/v3/`
**Аутентификация:** HTTP Basic Auth (shopId + secretKey)

### 1.2 Python SDK

Официальный SDK: `yookassa` (PyPI), версия 3.10.0 (январь 2026).

```bash
pip install yookassa
# или для async:
pip install aioyookassa
```

**Конфигурация:**

```python
from yookassa import Configuration

Configuration.account_id = "YOUR_SHOP_ID"
Configuration.secret_key = "YOUR_SECRET_KEY"
```

**Создание платежа:**

```python
from yookassa import Payment
import uuid

payment = Payment.create({
    "amount": {
        "value": "490.00",
        "currency": "RUB"
    },
    "confirmation": {
        "type": "embedded"  # для виджета; "redirect" для редиректа
    },
    "capture": True,
    "description": "Подписка fancai.ru — тариф Pro",
    "metadata": {
        "user_id": "user_123",
        "plan": "pro_monthly"
    },
    "receipt": {
        "customer": {
            "email": "user@example.com"
        },
        "items": [
            {
                "description": "Подписка fancai Pro (1 месяц)",
                "quantity": "1.00",
                "amount": {
                    "value": "490.00",
                    "currency": "RUB"
                },
                "vat_code": 1,  # без НДС (для УСН)
                "payment_subject": "service",
                "payment_mode": "full_payment"
            }
        ]
    }
}, uuid.uuid4())  # idempotency key
```

**Асинхронный вариант (aioyookassa):**

```python
from aioyookassa import YooKassa

kassa = YooKassa(shop_id="YOUR_SHOP_ID", secret_key="YOUR_SECRET_KEY")

payment = await kassa.payments.create(
    amount={"value": "490.00", "currency": "RUB"},
    confirmation={"type": "embedded"},
    capture=True,
    description="Подписка fancai.ru — тариф Pro",
)
```

### 1.3 Поддерживаемые способы оплаты

| Метод                          | Статус (2026) | Рекуррент | Комиссия |
| ------------------------------ | ------------- | --------- | -------- |
| Банковские карты (Visa/MC/МИР) | Работает      | Да        | от 2.8%  |
| СБП (Система быстрых платежей) | Работает      | Нет       | от 0.4%  |
| YooMoney (кошелек)             | Работает      | Да        | от 3.0%  |
| Apple Pay (только МИР)         | Ограничен     | Да        | от 2.8%  |
| Google Pay                     | Не работает\* | —         | —        |
| Tinkoff Pay                    | Работает      | Нет       | от 2.8%  |
| SberPay                        | Работает      | Нет       | от 2.8%  |

> \*Google Pay отключен из-за санкций — карты Visa/MC не добавляются в Google Pay, а МИР пока не поддерживается.

### 1.4 Рекуррентные платежи (автоплатежи)

YooKassa **не хранит** данные о подписках — она только сохраняет платежный метод и списывает деньги по запросу. Логика подписок полностью на стороне мерчанта.

**Шаг 1: Первый платеж — сохранение метода**

```python
from yookassa import Payment
import uuid

# Первый платеж с сохранением метода
payment = Payment.create({
    "amount": {
        "value": "490.00",
        "currency": "RUB"
    },
    "capture": True,
    "save_payment_method": True,  # <-- ключевой параметр
    "confirmation": {
        "type": "redirect",
        "return_url": "https://fancai.ru/billing/success"
    },
    "description": "Подписка fancai Pro — первый платеж",
    "metadata": {
        "user_id": "user_123",
        "type": "subscription_initial"
    }
}, uuid.uuid4())
```

После успешной оплаты в объекте payment будет:

```json
{
  "payment_method": {
    "type": "bank_card",
    "id": "2c4573f2-...",
    "saved": true,
    "card": {
      "last4": "4242",
      "expiry_month": "12",
      "expiry_year": "2028"
    }
  }
}
```

Сохраняем `payment_method.id` в базу.

**Шаг 2: Последующие списания (без участия пользователя)**

```python
from yookassa import Payment
import uuid

# Автоматическое списание по расписанию
payment = Payment.create({
    "amount": {
        "value": "490.00",
        "currency": "RUB"
    },
    "capture": True,
    "payment_method_id": "2c4573f2-...",  # сохраненный метод
    "description": "Подписка fancai Pro — автопродление",
    "metadata": {
        "user_id": "user_123",
        "type": "subscription_renewal",
        "period": "2026-04"
    }
}, uuid.uuid4())
```

> **Важно:** Для активации рекуррентных платежей необходимо связаться с менеджером YooKassa и показать скриншот интерфейса отвязки карты. Требуется предоставить предполагаемый оборот.

### 1.5 Обработка вебхуков

YooKassa отправляет HTTP POST на ваш endpoint при изменении статуса объекта.

**Типы событий:**

- `payment.succeeded` — платеж успешно завершен
- `payment.waiting_for_capture` — платеж ожидает подтверждения
- `payment.canceled` — платеж отменен
- `refund.succeeded` — возврат выполнен

**Настройка вебхуков** — через личный кабинет ЮKassa или через API:

```python
from yookassa import Webhook

Webhook.add({
    "event": "payment.succeeded",
    "url": "https://api.fancai.ru/v1/webhooks/yookassa"
})
```

**Формат уведомления:**

```json
{
  "type": "notification",
  "event": "payment.succeeded",
  "object": {
    "id": "2c4573f2-...",
    "status": "succeeded",
    "amount": {"value": "490.00", "currency": "RUB"},
    "payment_method": {...},
    "metadata": {"user_id": "user_123", "plan": "pro_monthly"}
  }
}
```

### 1.6 Тестовый режим (Sandbox)

- Тестовый магазин создается автоматически при регистрации
- Все функции API доступны в тестовом режиме
- Реальные деньги **не списываются**
- Объекты в тестовом режиме помечены `"test": true`
- Тестовые карты:

| Номер карты         | Сценарий              |
| ------------------- | --------------------- |
| 5555 5555 5555 4477 | Успешная оплата       |
| 5555 5555 5555 4444 | Успешная оплата c 3DS |
| 5555 5555 5555 4002 | Отклонение            |

> CVC — любые 3 цифры, срок — любой будущий месяц/год.

**Важно:** Для тестовых вебхуков используйте отдельный URL (настраивается в демо-магазине).

### 1.7 Комиссии и тарифы (2026)

| Категория         | Ставка                                                       |
| ----------------- | ------------------------------------------------------------ |
| Банковские карты  | от 2.8% + НДС на комиссию                                    |
| СБП               | от 0.4% (акция) до 0.7%                                      |
| YooMoney          | от 3.0%                                                      |
| Apple Pay (МИР)   | от 2.8%                                                      |
| Подключение       | Бесплатно                                                    |
| Абонентская плата | Нет                                                          |
| Возвраты          | Бесплатно (но комиссию за оригинальный платеж не возвращают) |

> **Акция до 01.05.2026:** от 0.4% для новых клиентов (юрлица/ИП, подключение через сайт).
> **НДС:** С 01.01.2026 НДС начисляется на комиссию (22% с 2026 года).
> **Чеки от ЮKassa:** Если фискализация через ЮKassa — дополнительная плата за каждый чек.

### 1.8 Возвраты

```python
from yookassa import Refund
import uuid

# Полный возврат
refund = Refund.create({
    "payment_id": "2c4573f2-...",
    "amount": {
        "value": "490.00",
        "currency": "RUB"
    },
    "description": "Возврат по запросу пользователя",
    "receipt": {
        "customer": {"email": "user@example.com"},
        "items": [{
            "description": "Подписка fancai Pro (возврат)",
            "quantity": "1.00",
            "amount": {
                "value": "490.00",
                "currency": "RUB"
            },
            "vat_code": 1,
            "payment_subject": "service",
            "payment_mode": "full_payment"
        }]
    }
}, uuid.uuid4())

# Частичный возврат
partial_refund = Refund.create({
    "payment_id": "2c4573f2-...",
    "amount": {
        "value": "245.00",
        "currency": "RUB"
    },
    "description": "Частичный возврат — неиспользованные дни"
}, uuid.uuid4())
```

**Особенности возвратов:**

- Возврат возможен в течение 3 лет с даты платежа
- Сумма всех возвратов не может превышать сумму оригинального платежа
- Деньги возвращаются на тот же метод, которым был оплачен заказ
- Для карт — срок возврата 1-5 рабочих дней
- Комиссию ЮKassa за оригинальный платеж **не возвращает**

---

## 2. Альтернативные платежные системы

### 2.1 Robokassa

**Описание:** Платежный агрегатор, работающий с 2003 года. Популярен среди малого бизнеса.

**Преимущества:**

- Встроенная онлайн-касса (не нужен отдельный OFD)
- Гибкие тарифы от 1.8%
- Поддержка самозанятых и ИП
- 80+ способов оплаты
- Простая интеграция (redirect-based)

**Недостатки:**

- Нет embedded-виджета (только редирект)
- Менее современный API
- Нет официального Python SDK (есть сторонние)
- Комиссия для некоторых способов оплаты до 10%

**Комиссии:**

| Метод                | Ставка  |
| -------------------- | ------- |
| Банковские карты     | от 2.5% |
| СБП                  | от 1.0% |
| Электронные кошельки | от 5.0% |

**Для fancai.ru:** Robokassa может быть запасным вариантом, но YooKassa предпочтительнее из-за embedded-виджета и лучшего API.

### 2.2 CloudPayments

**Описание:** Принадлежит Тинькофф. Фокус на технологичность и API-first подход. PCI DSS Level 1.

**Преимущества:**

- Токенизация карт (без редиректа)
- Рекуррентные платежи
- Отличная документация и API
- Поддержка 3D Secure 2.0
- Apple Pay, Google Pay (с ограничениями)
- Быстрое подключение

**Недостатки:**

- Принадлежит Тинькофф — привязка к одному банку
- Комиссия выше, чем у YooKassa для малых оборотов
- Нет встроенной фискализации (нужен OFD)

**Комиссии:**

| Метод                  | Ставка  |
| ---------------------- | ------- |
| Банковские карты       | от 2.7% |
| Apple Pay / Google Pay | от 2.7% |
| СБП                    | от 0.7% |

**Python SDK:**

```bash
pip install cloudpayments  # неофициальный
```

Официальная документация: https://developers.cloudpayments.ru/

### 2.3 Tinkoff Acquiring (Т-Касса)

**Описание:** Интернет-эквайринг от Тинькофф Банка. С 2017 года владеет CloudPayments.

**Преимущества:**

- Прямой эквайринг (без посредников)
- Tinkoff Pay (популярен в РФ)
- Быстрое зачисление средств
- Хорошая документация API

**Недостатки:**

- Нужен расчетный счет в Тинькофф
- Менее гибкий, чем агрегаторы
- Комиссия зависит от оборота и категории бизнеса

**Python SDK:**

```bash
pip install tinkoff-acquiring-api
```

**Комиссии:** от 2.49% (зависит от оборота и MCC-кода).

### 2.4 СБП (Система быстрых платежей) — прямая интеграция

**Описание:** Сервис Банка России через НСПК. 225+ банков-участников.

**Преимущества:**

- Самая низкая комиссия: 0.4-0.7% (не более 0.7%)
- Мгновенное зачисление
- Высокое доверие пользователей
- QR-код + оплата по ссылке

**Недостатки:**

- Нет рекуррентных платежей
- Прямая интеграция сложная (через банк-партнер)
- Проще подключить через YooKassa/CloudPayments
- Не все пользователи привыкли платить через СБП

**Для fancai.ru:** Использовать СБП **через YooKassa** — получаем низкую комиссию без сложной прямой интеграции.

### 2.5 Stripe (для международных пользователей)

**Статус 2026:** Stripe **не работает** для российских юрлиц. Подключение возможно только через иностранное юрлицо.

**Альтернативы для международных платежей:**

- **Paddle** — MoR (Merchant of Record), сам решает вопросы налогов
- **FastSpring** — аналогично, для SaaS/цифровых товаров
- **PayPal** — ограничен для российских компаний
- **Wise** — для переводов, не для приема платежей

**Рекомендация:** На начальном этапе фокусироваться на российском рынке через YooKassa. Международные платежи отложить до появления значительного зарубежного трафика.

### 2.6 Сводная таблица сравнения

| Критерий            | YooKassa    | Robokassa  | CloudPayments | Tinkoff Acquiring |
| ------------------- | ----------- | ---------- | ------------- | ----------------- |
| Комиссия (карты)    | от 2.8%     | от 2.5%    | от 2.7%       | от 2.49%          |
| Комиссия (СБП)      | от 0.4%     | от 1.0%    | от 0.7%       | от 0.4%           |
| Embedded виджет     | Да          | Нет        | Да            | Да                |
| Рекуррент           | Да          | Нет        | Да            | Да                |
| Python SDK          | Официальный | Нет        | Неофициальный | Неофициальный     |
| Фискализация        | Встроенная  | Встроенная | Через OFD     | Через OFD         |
| Подключение         | Бесплатно   | Бесплатно  | Бесплатно     | Бесплатно         |
| Абонентка           | Нет         | Нет        | Нет           | Нет               |
| PCI DSS             | Level 1     | Level 1    | Level 1       | Level 1           |
| Sandbox             | Полный      | Ограничен  | Полный        | Полный            |
| Документация        | Отличная    | Средняя    | Хорошая       | Хорошая           |
| Скорость интеграции | 1-2 дня     | 1 день     | 1-2 дня       | 2-3 дня           |

---

## 3. Подписочная модель биллинга

### 3.1 Рекуррентные платежи через YooKassa

Архитектура подписочного биллинга для fancai.ru:

**Модель данных (PostgreSQL):**

```python
# backend/app/models/subscription.py
from sqlalchemy import Column, String, Integer, DateTime, Enum, ForeignKey, Numeric
from sqlalchemy.orm import relationship
from app.database import Base
import enum

class PlanTier(str, enum.Enum):
    FREE = "free"
    BASIC = "basic"
    PRO = "pro"

class SubscriptionStatus(str, enum.Enum):
    ACTIVE = "active"
    PAST_DUE = "past_due"      # платеж не прошел, grace period
    CANCELED = "canceled"       # отменена пользователем
    EXPIRED = "expired"         # истекла после grace period

class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    plan = Column(Enum(PlanTier), nullable=False, default=PlanTier.FREE)
    status = Column(Enum(SubscriptionStatus), nullable=False, default=SubscriptionStatus.ACTIVE)

    # YooKassa
    payment_method_id = Column(String, nullable=True)  # сохраненный метод
    last4 = Column(String(4), nullable=True)            # последние 4 цифры карты

    # Периоды
    current_period_start = Column(DateTime(timezone=True), nullable=False)
    current_period_end = Column(DateTime(timezone=True), nullable=False)
    canceled_at = Column(DateTime(timezone=True), nullable=True)
    grace_period_end = Column(DateTime(timezone=True), nullable=True)

    # Биллинг
    price_rub = Column(Numeric(10, 2), nullable=False)
    trial_end = Column(DateTime(timezone=True), nullable=True)

    # Retry
    retry_count = Column(Integer, default=0)
    next_retry_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="subscription")
    payments = relationship("Payment", back_populates="subscription")


class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True)
    subscription_id = Column(Integer, ForeignKey("subscriptions.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # YooKassa
    yookassa_payment_id = Column(String, unique=True, nullable=False)
    idempotency_key = Column(String, unique=True, nullable=False)
    status = Column(String, nullable=False)  # pending, succeeded, canceled

    amount = Column(Numeric(10, 2), nullable=False)
    currency = Column(String(3), default="RUB")
    description = Column(String, nullable=True)
    payment_type = Column(String, nullable=False)  # subscription, credits, one_time
    metadata_json = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default="now()")
    paid_at = Column(DateTime(timezone=True), nullable=True)

    subscription = relationship("Subscription", back_populates="payments")
```

> **Внимание**: Примеры кода выше используют SQLAlchemy 1.x стиль. Кодовая база fancai использует SQLAlchemy 2.0 (`Mapped[...]`, `mapped_column()`, `lazy="raise"`). Адаптировать перед использованием.

**Celery-задача для автоматического списания:**

```python
# backend/app/tasks/billing.py
from celery import shared_task
from datetime import datetime, timedelta, timezone
from yookassa import Payment as YooPayment
from app.models.subscription import Subscription, SubscriptionStatus, Payment
from app.database import get_db_session
import uuid
import logging

logger = logging.getLogger(__name__)

@shared_task(bind=True, max_retries=0)  # retry-логика кастомная
def charge_subscription(self, subscription_id: int):
    """Списание по подписке. Вызывается по расписанию (Celery Beat)."""
    with get_db_session() as db:
        sub = db.query(Subscription).get(subscription_id)
        if not sub or sub.status != SubscriptionStatus.ACTIVE:
            return

        if not sub.payment_method_id:
            logger.error(f"Subscription {sub.id}: no payment method")
            sub.status = SubscriptionStatus.PAST_DUE
            db.commit()
            return

        idempotency_key = str(uuid.uuid4())

        try:
            yoo_payment = YooPayment.create({
                "amount": {
                    "value": str(sub.price_rub),
                    "currency": "RUB"
                },
                "capture": True,
                "payment_method_id": sub.payment_method_id,
                "description": f"fancai.ru — продление подписки {sub.plan.value}",
                "metadata": {
                    "user_id": str(sub.user_id),
                    "subscription_id": str(sub.id),
                    "type": "subscription_renewal"
                }
            }, idempotency_key)

            # Сохраняем платеж
            payment = Payment(
                subscription_id=sub.id,
                user_id=sub.user_id,
                yookassa_payment_id=yoo_payment.id,
                idempotency_key=idempotency_key,
                status=yoo_payment.status,
                amount=sub.price_rub,
                payment_type="subscription",
            )
            db.add(payment)

            if yoo_payment.status == "succeeded":
                # Продлеваем подписку
                sub.current_period_start = sub.current_period_end
                sub.current_period_end += timedelta(days=30)
                sub.retry_count = 0
                sub.next_retry_at = None
            else:
                # Платеж не прошел сразу — переходим в dunning
                handle_failed_payment(db, sub)

            db.commit()

        except Exception as e:
            logger.exception(f"Subscription {sub.id}: payment failed")
            handle_failed_payment(db, sub)
            db.commit()


def handle_failed_payment(db, sub: Subscription):
    """Логика dunning — повторные попытки списания."""
    sub.retry_count += 1

    if sub.retry_count >= 4:
        # 4 неудачных попытки — переводим в expired
        sub.status = SubscriptionStatus.EXPIRED
        sub.next_retry_at = None
        # TODO: отправить email "Подписка истекла"
    else:
        # Расписание retry: через 1 день, 3 дня, 7 дней
        retry_delays = [1, 3, 7]
        delay = retry_delays[min(sub.retry_count - 1, len(retry_delays) - 1)]
        sub.status = SubscriptionStatus.PAST_DUE
        sub.next_retry_at = datetime.now(timezone.utc) + timedelta(days=delay)
        sub.grace_period_end = sub.current_period_end + timedelta(days=14)
        # TODO: отправить email "Проблема с оплатой"


@shared_task
def process_pending_renewals():
    """Запускается раз в час через Celery Beat.
    Находит подписки, которые нужно продлить или повторить списание."""
    now = datetime.now(timezone.utc)
    with get_db_session() as db:
        # Подписки, у которых истек текущий период
        due_subs = db.query(Subscription).filter(
            Subscription.status == SubscriptionStatus.ACTIVE,
            Subscription.current_period_end <= now,
        ).all()
        for sub in due_subs:
            charge_subscription.delay(sub.id)

        # Подписки с неудачными платежами — retry
        retry_subs = db.query(Subscription).filter(
            Subscription.status == SubscriptionStatus.PAST_DUE,
            Subscription.next_retry_at <= now,
            Subscription.retry_count < 4,
        ).all()
        for sub in retry_subs:
            charge_subscription.delay(sub.id)

        # Подписки с истекшим grace period
        expired_subs = db.query(Subscription).filter(
            Subscription.status == SubscriptionStatus.PAST_DUE,
            Subscription.grace_period_end <= now,
        ).all()
        for sub in expired_subs:
            sub.status = SubscriptionStatus.EXPIRED
        db.commit()
```

### 3.2 Обработка неудачных платежей (Dunning)

**Стратегия retry:**

| Попытка | Задержка       | Действие                                            |
| ------- | -------------- | --------------------------------------------------- |
| 1       | Сразу          | Первая попытка списания                             |
| 2       | +1 день        | Повтор + email "Проблема с оплатой"                 |
| 3       | +3 дня         | Повтор + email "Обновите карту"                     |
| 4       | +7 дней        | Последняя попытка + email "Подписка будет отменена" |
| —       | +14 дней grace | Подписка переходит в expired                        |

**Лучшие практики dunning:**

- Оптимизированная стратегия retry восстанавливает 45-70% неудачных платежей
- После 3-4 попыток вероятность успеха резко падает
- Сегментировать пользователей по причине отказа (soft/hard decline)
- Мягкий тон в email-уведомлениях
- Предоставить простой способ обновить карту в личном кабинете

### 3.3 Пропорциональный перерасчет (Proration)

При смене тарифа (например, Basic -> Pro):

```python
from datetime import datetime, timezone
from decimal import Decimal

def calculate_proration(
    old_price: Decimal,
    new_price: Decimal,
    period_start: datetime,
    period_end: datetime,
) -> Decimal:
    """Рассчитывает сумму к доплате при апгрейде."""
    now = datetime.now(timezone.utc)
    total_days = (period_end - period_start).days
    remaining_days = (period_end - now).days

    if remaining_days <= 0:
        return new_price

    # Кредит за неиспользованные дни старого тарифа
    daily_old = old_price / total_days
    credit = daily_old * remaining_days

    # Стоимость оставшихся дней по новому тарифу
    daily_new = new_price / total_days
    charge = daily_new * remaining_days

    proration = max(charge - credit, Decimal("0"))
    return proration.quantize(Decimal("0.01"))
```

### 3.4 Пробный период (Trial)

```python
from datetime import datetime, timedelta, timezone

def create_trial_subscription(user_id: int, plan: str) -> Subscription:
    now = datetime.now(timezone.utc)
    trial_days = 7  # 7 дней бесплатно

    sub = Subscription(
        user_id=user_id,
        plan=PlanTier.PRO,
        status=SubscriptionStatus.ACTIVE,
        current_period_start=now,
        current_period_end=now + timedelta(days=trial_days),
        trial_end=now + timedelta(days=trial_days),
        price_rub=Decimal("490.00"),
    )
    # Карту не привязываем — запросим при окончании триала
    return sub
```

**Варианты trial:**

1. **Без карты** — проще конверсия, но выше churn после trial
2. **С привязкой карты** — ниже конверсия, но автоматическое продление
3. **Рекомендация для fancai:** Начать без карты (7 дней), запросить карту за 1 день до конца

### 3.5 Grace period

- **Длительность:** 14 дней после неудачного платежа
- **Что доступно:** Полный функционал (чтение), но нет генерации ИИ-контента
- **UI:** Баннер "Обновите способ оплаты"
- **После grace period:** Переход на Free тариф, данные сохраняются

### 3.6 Отмена и возвраты

**Политика отмены:**

- Подписка действует до конца оплаченного периода
- Автопродление отключается при отмене
- Частичный возврат возможен в течение 3 дней после списания (pro rata)
- Полный возврат — в течение 24 часов после оплаты

---

## 4. Система кредитов (top-up)

### 4.1 Поток одноразового платежа за кредиты

Для ИИ-функций (генерация иллюстраций, обработка entity) — кредитная модель:

```python
# backend/app/models/credits.py
class CreditBalance(Base):
    __tablename__ = "credit_balances"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    balance = Column(Integer, default=0, nullable=False)  # текущий баланс
    total_purchased = Column(Integer, default=0, nullable=False)
    total_spent = Column(Integer, default=0, nullable=False)


class CreditTransaction(Base):
    __tablename__ = "credit_transactions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    amount = Column(Integer, nullable=False)  # +100 или -1
    type = Column(String, nullable=False)     # purchase, spend, bonus, refund
    description = Column(String, nullable=True)
    payment_id = Column(Integer, ForeignKey("payments.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default="now()")
```

### 4.2 Пакеты кредитов

| Пакет    | Кредиты | Цена (RUB) | Цена за кредит | Скидка |
| -------- | ------- | ---------- | -------------- | ------ |
| Starter  | 100     | 199        | 1.99           | —      |
| Standard | 500     | 799        | 1.60           | 20%    |
| Premium  | 1000    | 1299       | 1.30           | 35%    |

**Стоимость операций:**

- Генерация иллюстрации: 5 кредитов
- Обработка entity для главы: 2 кредита
- Batch-обработка книги (все entity): 20 кредитов

> **Примечание**: Канонические конверсии — анализ главы = 5 кредитов, изображение = 2 кредита. См. [SHARED_ASSUMPTIONS.md](SHARED_ASSUMPTIONS.md)

### 4.3 Покупка кредитов

```python
# backend/app/routers/billing.py
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from yookassa import Payment as YooPayment
import uuid

router = APIRouter(prefix="/v1/billing", tags=["billing"])

CREDIT_PACKAGES = {
    "starter": {"credits": 100, "price": "199.00"},
    "standard": {"credits": 500, "price": "799.00"},
    "premium": {"credits": 1000, "price": "1299.00"},
}

class PurchaseCreditsRequest(BaseModel):
    package: str  # starter, standard, premium

class PurchaseCreditsResponse(BaseModel):
    payment_id: str
    confirmation_token: str  # для embedded-виджета

@router.post("/credits/purchase", response_model=PurchaseCreditsResponse)
async def purchase_credits(
    req: PurchaseCreditsRequest,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    package = CREDIT_PACKAGES.get(req.package)
    if not package:
        raise HTTPException(400, "Invalid package")

    idempotency_key = str(uuid.uuid4())

    yoo_payment = YooPayment.create({
        "amount": {
            "value": package["price"],
            "currency": "RUB"
        },
        "confirmation": {
            "type": "embedded"
        },
        "capture": True,
        "description": f"fancai.ru — {package['credits']} кредитов",
        "metadata": {
            "user_id": str(user.id),
            "type": "credits",
            "package": req.package,
            "credits": str(package["credits"]),
        },
        "receipt": {
            "customer": {"email": user.email},
            "items": [{
                "description": f"Пакет кредитов fancai ({package['credits']} шт.)",
                "quantity": "1.00",
                "amount": {"value": package["price"], "currency": "RUB"},
                "vat_code": 1,
                "payment_subject": "service",
                "payment_mode": "full_payment"
            }]
        }
    }, idempotency_key)

    # Сохраняем в БД
    payment = Payment(
        user_id=user.id,
        yookassa_payment_id=yoo_payment.id,
        idempotency_key=idempotency_key,
        status="pending",
        amount=package["price"],
        payment_type="credits",
        metadata_json=f'{{"package": "{req.package}", "credits": {package["credits"]}}}'
    )
    db.add(payment)
    await db.commit()

    return PurchaseCreditsResponse(
        payment_id=yoo_payment.id,
        confirmation_token=yoo_payment.confirmation.confirmation_token,
    )
```

### 4.4 Auto-top-up (автопополнение)

```python
# backend/app/tasks/credits.py
from celery import shared_task

@shared_task
def check_low_balance(user_id: int):
    """Проверяет баланс и автоматически пополняет, если включено."""
    with get_db_session() as db:
        balance = db.query(CreditBalance).filter_by(user_id=user_id).first()
        settings = db.query(AutoTopUpSettings).filter_by(user_id=user_id).first()

        if not settings or not settings.enabled:
            return

        if balance.balance <= settings.threshold:
            # Автосписание
            package = CREDIT_PACKAGES[settings.package]
            try:
                yoo_payment = YooPayment.create({
                    "amount": {"value": package["price"], "currency": "RUB"},
                    "capture": True,
                    "payment_method_id": settings.payment_method_id,
                    "description": f"fancai.ru — автопополнение {package['credits']} кредитов",
                    "metadata": {
                        "user_id": str(user_id),
                        "type": "credits_autotopup",
                        "package": settings.package,
                    }
                }, str(uuid.uuid4()))

                if yoo_payment.status == "succeeded":
                    balance.balance += package["credits"]
                    balance.total_purchased += package["credits"]
                    db.commit()
            except Exception:
                logger.exception(f"Auto-top-up failed for user {user_id}")
```

### 4.5 Фискальные чеки для кредитов (54-ФЗ)

Чек формируется автоматически при передаче объекта `receipt` в запрос создания платежа (см. примеры выше). Ключевые поля:

- `payment_subject`: `"service"` — электронная услуга
- `payment_mode`: `"full_payment"` — полная оплата
- `vat_code`: `1` (без НДС для УСН) или `2` (НДС 0%) — зависит от системы налогообложения
- `customer.email` — обязателен для отправки чека

### 4.6 Мультивалютность

YooKassa принимает оплату только в RUB. Для международных пользователей:

- Отображать цены в USD на фронте (конвертация по курсу ЦБ)
- Реальное списание в RUB (банк конвертирует автоматически)
- Хранить `display_currency` и `display_amount` в метаданных

---

## 5. Архитектура интеграции с FastAPI

### 5.1 Webhook endpoint

```python
# backend/app/routers/webhooks.py
from fastapi import APIRouter, Request, HTTPException
from yookassa.domain.notification import (
    WebhookNotificationEventType,
    WebhookNotificationFactory,
)
from app.services.billing import BillingService
import logging
import json

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/webhooks", tags=["webhooks"])

# IP-адреса YooKassa для верификации
YOOKASSA_IPS = {
    "185.71.76.0/27",
    "185.71.77.0/27",
    "77.75.153.0/25",
    "77.75.156.11",
    "77.75.156.35",
    "77.75.154.128/25",
    "2a02:5180::/32",
}


def is_trusted_ip(client_ip: str) -> bool:
    """Проверяет, что запрос пришел с IP YooKassa."""
    import ipaddress
    try:
        ip = ipaddress.ip_address(client_ip)
        for network in YOOKASSA_IPS:
            if "/" in network:
                if ip in ipaddress.ip_network(network, strict=False):
                    return True
            elif str(ip) == network:
                return True
    except ValueError:
        pass
    return False


@router.post("/yookassa")
async def yookassa_webhook(
    request: Request,
    billing: BillingService = Depends(get_billing_service),
    db=Depends(get_db),
):
    # 1. Проверка IP
    client_ip = request.headers.get("X-Forwarded-For", request.client.host)
    if "," in client_ip:
        client_ip = client_ip.split(",")[0].strip()

    if not is_trusted_ip(client_ip):
        logger.warning(f"Untrusted IP: {client_ip}")
        raise HTTPException(403, "Forbidden")

    # 2. Парсинг уведомления
    try:
        body = await request.json()
        notification = WebhookNotificationFactory().create(body)
    except Exception as e:
        logger.error(f"Invalid webhook payload: {e}")
        raise HTTPException(400, "Bad request")

    payment = notification.object

    # 3. Идемпотентность — проверяем, не обработали ли уже
    existing = await db.execute(
        select(Payment).where(
            Payment.yookassa_payment_id == payment.id,
            Payment.status == payment.status,
        )
    )
    if existing.scalar_one_or_none():
        return {"status": "already_processed"}

    # 4. Обработка по типу события
    event = notification.event

    if event == WebhookNotificationEventType.PAYMENT_SUCCEEDED:
        await billing.handle_payment_succeeded(db, payment)
    elif event == WebhookNotificationEventType.PAYMENT_CANCELED:
        await billing.handle_payment_canceled(db, payment)
    elif event == WebhookNotificationEventType.REFUND_SUCCEEDED:
        await billing.handle_refund_succeeded(db, payment)
    else:
        logger.info(f"Unhandled event: {event}")

    return {"status": "ok"}
```

### 5.2 BillingService

```python
# backend/app/services/billing.py
from app.models.subscription import Subscription, SubscriptionStatus, Payment
from app.models.credits import CreditBalance, CreditTransaction

class BillingService:
    async def handle_payment_succeeded(self, db, yoo_payment):
        """Обработка успешного платежа."""
        metadata = yoo_payment.metadata or {}
        payment_type = metadata.get("type", "")

        # Обновляем статус в БД
        db_payment = await db.execute(
            select(Payment).where(
                Payment.yookassa_payment_id == yoo_payment.id
            )
        )
        db_payment = db_payment.scalar_one_or_none()
        if db_payment:
            db_payment.status = "succeeded"
            db_payment.paid_at = datetime.now(timezone.utc)

        if payment_type == "subscription_initial":
            await self._activate_subscription(db, yoo_payment, metadata)
        elif payment_type == "subscription_renewal":
            await self._renew_subscription(db, metadata)
        elif payment_type in ("credits", "credits_autotopup"):
            await self._add_credits(db, yoo_payment, metadata)

        await db.commit()

    async def _activate_subscription(self, db, yoo_payment, metadata):
        """Активирует подписку и сохраняет платежный метод."""
        user_id = int(metadata["user_id"])
        sub = await db.execute(
            select(Subscription).where(Subscription.user_id == user_id)
        )
        sub = sub.scalar_one()

        if yoo_payment.payment_method and yoo_payment.payment_method.saved:
            sub.payment_method_id = yoo_payment.payment_method.id
            if hasattr(yoo_payment.payment_method, "card"):
                sub.last4 = yoo_payment.payment_method.card.last4

        sub.status = SubscriptionStatus.ACTIVE

    async def _add_credits(self, db, yoo_payment, metadata):
        """Начисляет кредиты после оплаты."""
        user_id = int(metadata["user_id"])
        credits_amount = int(metadata["credits"])

        balance = await db.execute(
            select(CreditBalance).where(CreditBalance.user_id == user_id)
        )
        balance = balance.scalar_one()
        balance.balance += credits_amount
        balance.total_purchased += credits_amount

        tx = CreditTransaction(
            user_id=user_id,
            amount=credits_amount,
            type="purchase",
            description=f"Покупка {credits_amount} кредитов",
        )
        db.add(tx)

    async def handle_payment_canceled(self, db, yoo_payment):
        """Обработка отмененного платежа."""
        db_payment = await db.execute(
            select(Payment).where(
                Payment.yookassa_payment_id == yoo_payment.id
            )
        )
        db_payment = db_payment.scalar_one_or_none()
        if db_payment:
            db_payment.status = "canceled"
            await db.commit()

    async def handle_refund_succeeded(self, db, refund):
        """Обработка успешного возврата."""
        # Логика возврата кредитов или продления подписки
        pass
```

### 5.3 Идемпотентность

**Уровень API YooKassa:**

- Заголовок `Idempotence-Key` (UUID v4, макс. 64 символа)
- YooKassa кеширует результат на 24 часа
- Повторный запрос с тем же ключом и данными возвращает закешированный результат

**Уровень webhook-обработки:**

- Проверяем `yookassa_payment_id` + `status` в БД
- Если уже обработали — возвращаем 200 OK без повторной обработки

**Уровень БД:**

- Unique constraint на `yookassa_payment_id`
- Unique constraint на `idempotency_key`
- Используем транзакции с `SELECT FOR UPDATE` для credit balance

### 5.4 Безопасность транзакций БД

```python
async def add_credits_safe(db, user_id: int, amount: int):
    """Атомарное начисление кредитов с блокировкой строки."""
    async with db.begin():
        result = await db.execute(
            select(CreditBalance)
            .where(CreditBalance.user_id == user_id)
            .with_for_update()  # SELECT FOR UPDATE — блокировка строки
        )
        balance = result.scalar_one()
        balance.balance += amount
        balance.total_purchased += amount

        tx = CreditTransaction(
            user_id=user_id,
            amount=amount,
            type="purchase",
            description=f"Покупка {amount} кредитов",
        )
        db.add(tx)
```

### 5.5 Retry-логика для вебхуков

YooKassa повторяет отправку вебхука, если ваш сервер не вернул HTTP 200 в течение определенного времени. Но важно обрабатывать ситуации:

```python
# Celery task для отложенной проверки статуса
@shared_task(bind=True, max_retries=5, default_retry_delay=60)
def verify_payment_status(self, yookassa_payment_id: str):
    """Проверяет статус платежа напрямую через API (fallback)."""
    try:
        from yookassa import Payment as YooPayment
        payment = YooPayment.find_one(yookassa_payment_id)

        with get_db_session() as db:
            db_payment = db.query(Payment).filter_by(
                yookassa_payment_id=yookassa_payment_id
            ).first()

            if db_payment and db_payment.status != payment.status:
                db_payment.status = payment.status
                if payment.status == "succeeded":
                    # Вызываем обработку
                    billing = BillingService()
                    billing.handle_payment_succeeded_sync(db, payment)
                db.commit()

    except Exception as exc:
        self.retry(exc=exc)
```

---

## 6. Frontend-интеграция (React)

### 6.1 YooKassa Embedded Widget

Два варианта интеграции:

1. **Redirect** — пользователь уходит на страницу ЮKassa
2. **Embedded Widget** — форма оплаты прямо на вашем сайте (рекомендуется)

**Подключение скрипта:**

```typescript
// frontend/src/hooks/useYooKassaWidget.ts
import { useEffect, useRef, useCallback } from "react";

interface YooKassaWidgetOptions {
  confirmationToken: string;
  onSuccess?: (data: { type: string }) => void;
  onError?: (error: unknown) => void;
  onComplete?: () => void;
}

// Глобальный тип для виджета
declare global {
  interface Window {
    YooMoneyCheckoutWidget: new (config: {
      confirmation_token: string;
      return_url?: string;
      customization?: {
        modal?: boolean;
        colors?: { control_primary?: string };
      };
      error_callback: (error: unknown) => void;
    }) => {
      render: (containerId: string) => Promise<void>;
      destroy: () => void;
    };
  }
}

export function useYooKassaWidget() {
  const widgetRef = useRef<ReturnType<
    typeof window.YooMoneyCheckoutWidget
  > | null>(null);
  const scriptLoaded = useRef(false);

  // Загрузка скрипта виджета
  useEffect(() => {
    if (scriptLoaded.current) return;

    const script = document.createElement("script");
    script.src = "https://yookassa.ru/checkout-widget/v1/checkout-widget.js";
    script.async = true;
    script.onload = () => {
      scriptLoaded.current = true;
    };
    document.head.appendChild(script);

    return () => {
      if (widgetRef.current) {
        widgetRef.current.destroy();
      }
    };
  }, []);

  const renderWidget = useCallback(async (options: YooKassaWidgetOptions) => {
    if (!window.YooMoneyCheckoutWidget) {
      throw new Error("YooKassa widget not loaded");
    }

    // Уничтожаем предыдущий виджет
    if (widgetRef.current) {
      widgetRef.current.destroy();
    }

    const widget = new window.YooMoneyCheckoutWidget({
      confirmation_token: options.confirmationToken,
      return_url: `${window.location.origin}/billing/success`,
      customization: {
        modal: true,
        colors: {
          control_primary: "#4F46E5", // фирменный цвет fancai
        },
      },
      error_callback: (error) => {
        console.error("YooKassa widget error:", error);
        options.onError?.(error);
      },
    });

    widgetRef.current = widget;

    try {
      await widget.render("yookassa-widget-container");
      options.onSuccess?.({ type: "rendered" });
    } catch (error) {
      options.onError?.(error);
    }
  }, []);

  const destroyWidget = useCallback(() => {
    widgetRef.current?.destroy();
    widgetRef.current = null;
  }, []);

  return { renderWidget, destroyWidget };
}
```

**React-обертка (npm):**

Существует community-пакет `react-yoomoneycheckoutwidget`, но для контроля лучше написать свой hook (см. выше).

### 6.2 Компонент оплаты

```tsx
// frontend/src/components/Billing/PaymentDialog.tsx
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useYooKassaWidget } from "@/hooks/useYooKassaWidget";
import { api } from "@/lib/api";

interface PaymentDialogProps {
  open: boolean;
  onClose: () => void;
  type: "subscription" | "credits";
  packageId?: string;
  planId?: string;
}

export function PaymentDialog({
  open,
  onClose,
  type,
  packageId,
  planId,
}: PaymentDialogProps) {
  const { renderWidget, destroyWidget } = useYooKassaWidget();
  const [status, setStatus] = useState<
    "idle" | "loading" | "widget" | "polling"
  >("idle");

  const createPayment = useMutation({
    mutationFn: async () => {
      if (type === "credits") {
        return api.post("/v1/billing/credits/purchase", { package: packageId });
      } else {
        return api.post("/v1/billing/subscription/create", { plan: planId });
      }
    },
    onSuccess: async (data) => {
      setStatus("widget");
      await renderWidget({
        confirmationToken: data.confirmation_token,
        onComplete: () => {
          setStatus("polling");
          startPolling(data.payment_id);
        },
        onError: (error) => {
          console.error("Payment error:", error);
          setStatus("idle");
        },
      });
    },
  });

  const checkStatus = useMutation({
    mutationFn: (paymentId: string) =>
      api.get(`/v1/billing/payments/${paymentId}/status`),
  });

  function startPolling(paymentId: string) {
    const interval = setInterval(async () => {
      const result = await checkStatus.mutateAsync(paymentId);
      if (result.status === "succeeded") {
        clearInterval(interval);
        destroyWidget();
        onClose();
        // Инвалидируем кеш баланса/подписки
        // queryClient.invalidateQueries(['billing']);
      } else if (result.status === "canceled") {
        clearInterval(interval);
        setStatus("idle");
      }
    }, 2000); // опрос каждые 2 секунды

    // Таймаут — 5 минут
    setTimeout(() => clearInterval(interval), 5 * 60 * 1000);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl p-6 max-w-md w-full">
        <h2 className="text-lg font-semibold mb-4">
          {type === "credits" ? "Покупка кредитов" : "Оформление подписки"}
        </h2>

        {status === "idle" && (
          <button
            onClick={() => createPayment.mutate()}
            disabled={createPayment.isPending}
            className="w-full bg-indigo-600 text-white py-3 rounded-lg"
          >
            {createPayment.isPending ? "Подготовка..." : "Перейти к оплате"}
          </button>
        )}

        {status === "widget" && <div id="yookassa-widget-container" />}

        {status === "polling" && (
          <div className="text-center py-8">
            <div className="animate-spin h-8 w-8 border-2 border-indigo-600 border-t-transparent rounded-full mx-auto" />
            <p className="mt-4 text-gray-600">Проверяем оплату...</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

### 6.3 Биллинг-дашборд

```tsx
// frontend/src/components/Billing/BillingDashboard.tsx
// Основные компоненты:
//
// 1. SubscriptionCard — текущий тариф, дата продления, кнопка "Сменить тариф"
// 2. CreditBalance — текущий баланс кредитов, кнопка "Пополнить"
// 3. PaymentHistory — таблица платежей с пагинацией
// 4. PaymentMethodCard — привязанная карта (последние 4 цифры), кнопка "Сменить карту"
// 5. AutoTopUpSettings — настройки автопополнения кредитов
// 6. InvoiceDownload — скачивание чеков (PDF)
```

### 6.4 Опрос статуса платежа

Вместо polling можно использовать SSE (Server-Sent Events):

```python
# backend/app/routers/billing.py
from fastapi.responses import StreamingResponse
import asyncio

@router.get("/payments/{payment_id}/events")
async def payment_events(payment_id: str, db=Depends(get_db)):
    """SSE endpoint для отслеживания статуса платежа."""
    async def event_stream():
        for _ in range(150):  # 5 минут (2s * 150)
            payment = await db.execute(
                select(Payment).where(Payment.yookassa_payment_id == payment_id)
            )
            payment = payment.scalar_one_or_none()
            if payment and payment.status in ("succeeded", "canceled"):
                yield f"data: {json.dumps({'status': payment.status})}\n\n"
                return
            yield f"data: {json.dumps({'status': 'pending'})}\n\n"
            await asyncio.sleep(2)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

---

## 7. Юридические требования и комплаенс (Россия)

### 7.1 54-ФЗ — Онлайн-кассы

**Суть:** Все организации и ИП, принимающие оплату от физлиц в РФ (наличные и безналичные), обязаны применять контрольно-кассовую технику (ККТ) и отправлять фискальные данные в ФНС.

**Для онлайн-сервиса (fancai.ru) — два варианта:**

1. **Чеки от ЮKassa** (рекомендуется для старта):
   - ЮKassa формирует и отправляет чеки за вас
   - Не нужно покупать/арендовать онлайн-кассу
   - Не нужен договор с OFD
   - Не нужно менять фискальный накопитель
   - Дополнительная комиссия за каждый чек

2. **Сторонняя онлайн-касса:**
   - Нужна облачная касса (АТОЛ Онлайн, OrangeData, Модулькасса)
   - Договор с OFD (Платформа ОФД, OFD.ru, Такском)
   - Данные передаются через API ЮKassa -> касса -> OFD -> ФНС
   - Формат фискальных документов: ФФД 1.05, 1.1 или 1.2

**Обязательные поля чека:**

- Наименование товара/услуги
- Количество
- Цена с учетом скидок
- Ставка НДС
- Признак предмета расчета (`payment_subject`): "service" для SaaS
- Признак способа расчета (`payment_mode`): "full_payment"
- Email или телефон покупателя (для отправки чека)
- ИНН продавца

**Штрафы (с 2026 года):**

- ИП: от 30 000 руб. (было 10 000)
- ООО: от 150 000 руб. (было 30 000)
- Ошибки в чеках: до 100% суммы, мин. 10 000 руб.
- Повторные нарушения: до 750 000 руб.

### 7.2 Фискализация через OFD

```
Покупатель -> fancai.ru -> YooKassa API -> Касса (АТОЛ/OrangeData)
                                                    |
                                                    v
                                                  OFD -> ФНС
                                                    |
                                                    v
                                                Покупатель (чек по email/SMS)
```

При использовании "Чеков от ЮKassa" вся цепочка скрыта — достаточно передать `receipt` в запросе на создание платежа.

### 7.3 Какие данные хранить / не хранить

**Обязательно хранить:**

- ID платежа (yookassa_payment_id)
- Сумма и валюта
- Дата и время платежа
- Статус платежа
- Email покупателя (для чека)
- Metadata (user_id, тип покупки)

**Категорически НЕ хранить:**

- Полный номер карты (PAN)
- CVC/CVV код
- PIN код
- Полные данные карты
- Secret key в коде/git (только через env vars)

**Допустимо хранить:**

- Последние 4 цифры карты (для отображения)
- Тип карты (Visa/MC/МИР)
- Срок действия карты (месяц/год)
- payment_method_id от YooKassa (для рекуррентов)

### 7.4 Политика возвратов

Для SaaS-сервиса рекомендуется:

- Полный возврат в течение 24 часов после оплаты (без вопросов)
- Частичный возврат в течение 3 дней (pro rata за неиспользованные дни)
- Кредиты не возвращаются, если уже использованы
- Неиспользованные кредиты — возврат в течение 14 дней
- Документировать политику в оферте

### 7.5 Оферта и пользовательское соглашение

Для SaaS-сервиса нужны 3 документа:

1. **Пользовательское соглашение** — общие правила использования сервиса
2. **Договор-оферта на оказание платных услуг** — условия подписки и покупки кредитов
3. **Политика конфиденциальности** — обработка персональных данных (152-ФЗ)

**В оферте обязательно указать:**

- Описание услуг (подписка, кредиты)
- Тарифы и цены
- Порядок оплаты
- Условия автопродления
- Порядок отмены подписки
- Условия возврата
- Момент акцепта (оплата = согласие с офертой)
- Ответственность сторон
- Реквизиты ИП/ООО

**Правовая форма договора:**

- Для SaaS в РФ — лицензионный договор на ПО или договор оказания услуг
- Лицензионный формат выгоднее по налогам (освобождение от НДС по пп. 26 п. 2 ст. 149 НК)

### 7.6 Персональные данные (152-ФЗ)

**Требования:**

- Согласие на обработку персональных данных (checkbox при регистрации)
- Политика конфиденциальности на сайте
- Уведомление Роскомнадзора об обработке ПДн
- Хранение данных на серверах в РФ (для российских пользователей)
- Шифрование при передаче (TLS)
- Право на удаление данных

**Минимум ПДн для биллинга:**

- Email (для чеков и уведомлений)
- Опционально: телефон (для SMS-чеков)
- НЕ собирать ФИО, если не требуется для бизнес-логики

### 7.7 ИП vs ООО

| Критерий             | ИП                      | ООО                  |
| -------------------- | ----------------------- | -------------------- |
| Регистрация          | Проще, дешевле          | Сложнее, 10 000 руб. |
| Налоги (УСН 6%)      | Да                      | Да                   |
| Вывод денег          | Свободно на личный счет | Дивиденды (13% НДФЛ) |
| Ответственность      | Личным имуществом       | Уставным капиталом   |
| Подключение YooKassa | Да                      | Да                   |
| Рекуррентные платежи | Да                      | Да                   |
| Инвестиции           | Сложно                  | Да                   |

**Рекомендация для fancai.ru (старт):** ИП на УСН 6% — минимум бюрократии, быстрое подключение ЮKassa.

---

## 8. Безопасность

### 8.1 PCI DSS Compliance

**Подход для fancai.ru:** SAQ-A (Self-Assessment Questionnaire A) — самый простой уровень.

Суть: вы **никогда не обрабатываете и не храните данные карт**. Вся работа с картами через YooKassa (PCI DSS Level 1). Вы:

- Используете embedded-виджет или редирект
- Не видите номер карты
- Храните только token (payment_method_id)
- Не логируете данные карт

### 8.2 Хранение токенов

```python
# Правильно:
YOOKASSA_SHOP_ID = os.environ["YOOKASSA_SHOP_ID"]
YOOKASSA_SECRET_KEY = os.environ["YOOKASSA_SECRET_KEY"]

# НЕ правильно:
# YOOKASSA_SECRET_KEY = "test_XXXXX"  # НИКОГДА не в коде!
```

Для fancai.ru — секреты через `.env` + Docker secrets:

```
# .env (не в git!)
YOOKASSA_SHOP_ID=123456
YOOKASSA_SECRET_KEY=test_XXXXXXXXXXXXXXXXXXXXXXXX
```

### 8.3 Верификация вебхуков

YooKassa не использует подпись (HMAC). Верификация через IP-адрес:

```python
# Белый список IP YooKassa (актуально на 2026):
YOOKASSA_TRUSTED_IPS = [
    "185.71.76.0/27",
    "185.71.77.0/27",
    "77.75.153.0/25",
    "77.75.156.11",
    "77.75.156.35",
    "77.75.154.128/25",
    "2a02:5180::/32",
]
```

**Дополнительная верификация:**

```python
async def verify_webhook(yookassa_payment_id: str, expected_status: str):
    """Двойная проверка — запрашиваем статус напрямую через API."""
    payment = YooPayment.find_one(yookassa_payment_id)
    return payment.status == expected_status
```

### 8.4 Защита от фрода

1. **Rate limiting** на endpoint создания платежа:

```python
from slowapi import Limiter
limiter = Limiter(key_func=get_remote_address)

@router.post("/credits/purchase")
@limiter.limit("5/minute")
async def purchase_credits(request: Request, ...):
    ...
```

2. **Проверка metadata:**
   - `user_id` в metadata должен совпадать с авторизованным пользователем
   - Сумма в webhook должна совпадать с ожидаемой
   - Payment type должен соответствовать бизнес-логике

3. **Мониторинг:**
   - Алерт на аномально большое количество платежей от одного пользователя
   - Алерт на множественные неудачные попытки оплаты
   - Логирование всех webhook-событий

4. **HTTPS обязателен** для webhook endpoint

---

## 9. Рекомендации для fancai.ru

В проекте уже заложена конфигурация YooKassa: `YOOKASSA_SHOP_ID` и `YOOKASSA_SECRET_KEY` в `backend/app/core/config.py:70-71`, а также `CLOUDPAYMENTS_PUBLIC_ID` (строка 72).

### 9.1 Поэтапный план внедрения

**Фаза 1 (MVP, 1-2 недели):**

- Подключить YooKassa (тестовый режим)
- Модели в БД: Subscription, Payment, CreditBalance
- Embedded-виджет для одноразовых платежей
- Покупка кредитов (3 пакета)
- Webhook endpoint с IP-верификацией
- Чеки от ЮKassa (54-ФЗ)
- Базовый биллинг-дашборд

**Фаза 2 (подписки, 1-2 недели):**

- Рекуррентные платежи (согласовать с менеджером ЮKassa)
- Celery Beat для автосписаний
- Dunning (3 retry + grace period)
- Пробный период 7 дней
- Смена тарифа с proration

**Фаза 3 (улучшения, 1 неделя):**

- Auto-top-up кредитов
- SSE для отслеживания статуса
- История платежей с пагинацией
- Скачивание чеков

### 9.2 Рекомендуемый стек

```
Платежи:      yookassa==3.10.0 (sync) + aioyookassa (async)
Задачи:       Celery (уже в проекте, Redis DB 1 — broker)
Расписание:   Celery Beat (process_pending_renewals каждый час)
БД:           PostgreSQL 17 (уже в проекте)
Кеш:          Redis DB 0 (уже в проекте)
Frontend:     @tanstack/react-query (уже в проекте) + custom YooKassa hook
Мониторинг:   Sentry (ошибки) + Prometheus (метрики платежей)
```

### 9.3 Ценообразование (рекомендация)

| Тариф | Цена/мес | Кредиты/мес | Функции                                |
| ----- | -------- | ----------- | -------------------------------------- |
| Free  | 0        | 10          | Чтение, базовый глоссарий              |
| Basic | 299 руб  | 100         | + ИИ-иллюстрации, полный глоссарий     |
| Pro   | 490 руб  | 500         | + приоритет генерации, batch-обработка |

> **Примечание**: Канонические тарифы определены в [SHARED_ASSUMPTIONS.md](SHARED_ASSUMPTIONS.md): Free / Читатель (199₽) / Книгочей (499₽) / Библиотека (999₽). Рекомендуется использовать единую структуру.

Дополнительные кредиты — через top-up пакеты.

### 9.4 Ключевые метрики для отслеживания

- **MRR** (Monthly Recurring Revenue)
- **Churn Rate** (отток)
- **Payment Success Rate** (% успешных платежей)
- **Dunning Recovery Rate** (% восстановленных после неудачного платежа)
- **ARPU** (Average Revenue Per User)
- **Trial-to-Paid Conversion** (конверсия из пробного периода)
- **Credit Utilization** (% использования купленных кредитов)

---

## Источники

- [YooKassa — документация API](https://yookassa.ru/developers)
- [YooKassa — справочник API](https://yookassa.ru/developers/api)
- [YooKassa Python SDK (GitHub)](https://github.com/yoomoney/yookassa-sdk-python)
- [YooKassa — тарифы](https://yookassa.ru/en/fees/)
- [YooKassa — тестирование](https://yookassa.ru/developers/payment-acceptance/testing-and-going-live/testing)
- [YooKassa — вебхуки](https://yookassa.ru/developers/using-api/webhooks)
- [YooKassa — рекуррентные платежи](https://yookassa.ru/developers/payment-acceptance/scenario-extensions/recurring-payments/pay-with-saved)
- [YooKassa — фискализация](https://yookassa.ru/developers/payment-acceptance/receipts/54fz/basics)
- [aioyookassa (PyPI)](https://pypi.org/project/aioyookassa/)
- [CloudPayments — документация](https://developers.cloudpayments.ru/)
- [Tinkoff Acquiring API](https://developer.tbank.ru/)
- [tinkoff-acquiring-api (PyPI)](https://pypi.org/project/tinkoff-acquiring-api/)
- [СБП — Система быстрых платежей](https://sbp.nspk.ru/)
- [54-ФЗ — требования к онлайн-кассам](https://kontur.ru/market/spravka/295-kto_i_kogda_perehodit_na_online_kassy)
- [PCI DSS — стандарт безопасности](https://robokassa.com/content/pci-dss.html)
- [Robokassa — PCI DSS и безопасность](https://robokassa.com/content/pci-dss.html)
- [Сравнение YooKassa и Robokassa](https://startpack.ru/compare/yandex-kassa-vs-robokassa)
- [Договор SaaS — правовое регулирование](https://ezybrand.ru/blog/dogovor-na-uslugi-saas/)
- [152-ФЗ — О персональных данных](https://www.consultant.ru/document/cons_doc_LAW_61801/)
- [Онлайн-касса в 2026 году — новые правила](https://www.sostav.ru/blogs/269097/73780)
- [react-yoomoneycheckoutwidget (GitHub)](https://github.com/pavelety/react-yoomoneycheckoutwidget)
