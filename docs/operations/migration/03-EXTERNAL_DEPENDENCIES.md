# External dependencies — что находится за пределами VPS

> Эти ресурсы **не попадают в backup-архив**, но критичны для работы fancai на новом сервере. Заполни поля `<TODO>` сам — это твои реквизиты, я не должен их видеть.

---

## 1. VPS-провайдер

| Параметр                  | Значение                                         | TODO для владельца          |
| ------------------------- | ------------------------------------------------ | --------------------------- |
| Регистратор VPS (биллинг) | VDSina (вероятно, нужно подтвердить)             | <TODO: уточнить>            |
| Физическая инфра          | **Hetzner Cloud** (по reverse-PTR `*.hotsrv.de`) | —                           |
| Текущий IP v4             | `159.195.53.244`                                 | —                           |
| Текущий IP v6             | `2a0a:4cc0:c1:d183::*`                           | —                           |
| Регион / DC               | <TODO: узнать в панели>                          | <TODO>                      |
| Тип VPS / тариф           | AMD EPYC 12 vCPU 32 GB RAM 1 TB                  | <TODO: имя тарифа в панели> |
| Email биллинга            | <TODO>                                           | —                           |
| Учётка панели управления  | <TODO>                                           | в 1Password                 |

### Рекомендуемая замена при миграции

Если VDSina недоступен — взять **Hetzner Cloud напрямую**:

- Класс машины: **CCX33** (8 vCPU AMD EPYC, 32 GB RAM) или **CCX43** (16 vCPU, 64 GB) — оба x86_64
- Альтернатива: Selectel (если хочется RU-юрисдикции)
- Альтернатива: DigitalOcean Premium AMD (8 vCPU 32 GB, $192/мес)

**Минимальные требования совместимости:**

- ✅ x86_64 (KVM/HVM, не ARM)
- ✅ ≥12 vCPU AMD/Intel (можно 8 — текущая загрузка ~25%)
- ✅ ≥32 GB RAM
- ✅ ≥100 GB диска (нынешнее использование 48 GB)
- ✅ Debian 13+ или Ubuntu 24.04+ (для совместимости с Docker 29.x)

---

## 2. DNS (домен `fancai.ru`)

| Параметр                     | Текущее значение                            | TODO                                               |
| ---------------------------- | ------------------------------------------- | -------------------------------------------------- |
| DNS-zone hosting             | **VDSina** (`ns1-4.vdsina.com`)             | <TODO: подтвердить, есть ли API для автоматизации> |
| Регистратор домена           | <TODO: узнать в Whois или у себя>           | <TODO: учётка>                                     |
| A-запись `fancai.ru`         | `159.195.53.244`                            | при миграции изменить на NEW_IP                    |
| AAAA-запись                  | (нет)                                       | —                                                  |
| A-запись `www.fancai.ru`     | (alias на `fancai.ru` через `redir`)        | —                                                  |
| A-запись `monitor.fancai.ru` | (alias на `fancai.ru`)                      | —                                                  |
| A-запись `uptime.fancai.ru`  | (alias на `fancai.ru`)                      | —                                                  |
| MX-запись                    | `10 mx.fancai.ru`                           | сохранить если нужна почта                         |
| TXT-SPF                      | `v=spf1 include:_spf.cloud.yandex.net ~all` | сохранить                                          |
| TXT verification             | `602c3682-0b43-4413-bd67-6bf9b2dbb3fd`      | <TODO: какой сервис?>                              |

### Что делать перед миграцией

1. **За 24 часа до миграции:** снизить TTL A-записей до **60 секунд** в панели VDSina
2. **В момент миграции:** изменить A-записи на новый IP
3. **После миграции:** TTL пройдёт быстро (≤60 сек на наш IP), Caddy получит запросы

> 💡 Если есть **API VDSina** — можно автоматизировать смену A-record через bash-скрипт. Уточнить у поддержки VDSina.

---

## 3. SSL / TLS (Caddy + Let's Encrypt)

| Параметр              | Значение                                                              |
| --------------------- | --------------------------------------------------------------------- |
| Источник сертификатов | Let's Encrypt (acme-v02.api.letsencrypt.org)                          |
| ACME challenge тип    | HTTP-01 (порт 80)                                                     |
| ACME account email    | `admin@fancai.ru`                                                     |
| Текущие сертификаты   | `fancai.ru`, `www.fancai.ru`, `monitor.fancai.ru`, `uptime.fancai.ru` |
| Резервный ACME        | ZeroSSL (`acme.zerossl.com-v2-dv90`)                                  |

**Перенос:** `caddy_data` volume переносится через migration backup. Это сохраняет ACME account и кэш сертификатов — на новом сервере Caddy не запросит новые сертификаты, пока не истёк срок (валидны 90 дней с момента выпуска).

**Если caddy_data потерян:**

- Caddy выдаст новые сертификаты через ACME при первом запросе
- Risk: Let's Encrypt rate-limit — **5 сертификатов/неделю/registered domain**. У нас 4 поддомена + `fancai.ru` = 5 сразу. На грани лимита!
- Fallback: Caddy автоматически перейдёт на ZeroSSL после rate-limit

---

## 4. AI сервисы

### 4.1. OpenRouter (главный AI канал)

| Параметр            | TODO                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------- |
| Email аккаунта      | <TODO>                                                                                 |
| API key             | в `.env` (`OPENROUTER_API_KEY`)                                                        |
| Биллинг (карта)     | <TODO: где>                                                                            |
| Текущий баланс      | <TODO>                                                                                 |
| Использование (мес) | <TODO>                                                                                 |
| IP-allowlist?       | <TODO: проверить в панели OpenRouter>                                                  |
| Used models         | gemini-2.5-flash (primary), gemini-2.5-flash-lite (fallback), flux.2-klein-4b (images) |

**При миграции:** API key продолжит работать с любого IP, если не настроен allowlist. Если настроен — добавить новый IP.

### 4.2. Modal (резервный AI)

| Параметр     | TODO                                                                |
| ------------ | ------------------------------------------------------------------- |
| Token ID     | в `.env` (`MODAL_TOKEN_ID`)                                         |
| Token secret | в `.env` (`MODAL_TOKEN_SECRET`)                                     |
| Email        | <TODO>                                                              |
| Status       | <TODO: используется ли? в memory есть упоминания "Modal abandoned"> |

**Если Modal abandoned** — можно убрать `MODAL_TOKEN_*` из `.env` при миграции. Это снизит attack surface.

---

## 5. Email и push

### 5.1. Yandex Cloud SMTP

| Параметр                             | TODO                                                             |
| ------------------------------------ | ---------------------------------------------------------------- |
| SPF: `_spf.cloud.yandex.net`         | подтверждено в DNS                                               |
| Используется backend'ом?             | <TODO: проверить, отправляются ли письма>                        |
| SMTP credentials в `.env`?           | **нет** (среди 26 ключей не было SMTP\_\*) — возможно, неактивно |
| Если используется — где credentials? | <TODO: backend/app/core/config.py?>                              |

> ⚠️ Возможно, fancai не отправляет email (нет recovery emails и др.), или это делается через другой канал. Уточнить.

### 5.2. PWA Push (VAPID)

| Параметр            | Значение                                               |
| ------------------- | ------------------------------------------------------ |
| `VAPID_PUBLIC_KEY`  | в `.env`                                               |
| `VAPID_PRIVATE_KEY` | в `.env`                                               |
| `VAPID_SUBJECT`     | `mailto:admin@fancai.ru`                               |
| Подписки            | сохранены в Postgres `push_subscriptions` (или аналог) |

**При миграции:** ключи в `.env` остаются те же → существующие push subscriptions у пользователей **продолжат работать**.

---

## 6. Error monitoring

### HawkBit

| Параметр          | Значение                                        |
| ----------------- | ----------------------------------------------- |
| Token (backend)   | в `.env` (`HAWK_TOKEN`)                         |
| Token (frontend)  | в `.env` (`VITE_HAWK_TOKEN`) — embedded в build |
| Project URL       | <TODO: узнать в панели Hawk>                    |
| Аккаунт владельца | <TODO>                                          |

---

## 7. Monitoring (внешний)

| Сервис                    | Где                                | Что мониторит            |
| ------------------------- | ---------------------------------- | ------------------------ |
| Uptime Kuma (self-hosted) | https://uptime.fancai.ru           | external probes          |
| Netdata                   | https://monitor.fancai.ru/netdata  | host + container metrics |
| Victoria Metrics          | https://monitor.fancai.ru/victoria | metrics aggregation      |
| Flower                    | https://monitor.fancai.ru/flower   | Celery tasks             |
| Dozzle                    | https://monitor.fancai.ru/dozzle   | docker logs              |

Все самохостятся. **Для внешнего alerting** (если сервер целиком недоступен) нужно подключить external monitoring:

- **TODO:** настроить external uptime check (UptimeRobot бесплатный) → email/Telegram при `fancai.ru` down

---

## 8. Что владельцу записать в 1Password / Keychain

Минимальный набор для exam-recovery:

```
Vault: fancai-migration

1. age private key file: fancai-migration.key
   - содержит "AGE-SECRET-KEY-1...."
   - также записать public key (age1...) рядом для запуска backup

2. SSH access:
   - host fancai → 159.195.53.244:2222 user deploy
   - private key ~/.ssh/id_ed25519 (на машине владельца)

3. VDSina credentials:
   - login URL
   - username + password
   - 2FA backup codes

4. Domain registrar:
   - whois контакт fancai.ru
   - login + password + 2FA

5. OpenRouter:
   - https://openrouter.ai
   - email + password + API key + биллинг карта

6. Backblaze B2 (если выбран для off-site):
   - keyId + applicationKey
   - bucket name: fancai-migration

7. GitHub:
   - sandk0/fancai
   - personal token для push при необходимости

8. HawkBit:
   - URL панели, token

9. Yandex Cloud (если используется):
   - аккаунт + folder ID

10. Hetzner Cloud (рекомендуется как fallback VPS provider):
    - аккаунт + project + payment method
    - заранее иметь учётку ДО кризиса!
```

---

## 9. Pre-create аварийный VPS account

Самая частая ошибка: владелец узнаёт «сервер удалён» в час Х, и в этот же момент впервые регистрируется на новом провайдере. KYC-проверка может занять **до 24 часов**.

**Рекомендация:** **прямо сейчас** зарегистрироваться на:

1. **Hetzner Cloud** — войти, добавить payment method, создать project `fancai-emergency`. Тратить 0€ пока нет VPS.
2. **(альтернативно)** Selectel или OVH

Тогда в момент Х: заказ VPS = **2 минуты**, не 2 часа KYC.

---

## 10. Frequency of update

Этот документ — справочник, обновлять при изменениях:

- Поменял OpenRouter API key → обновить
- Сменил DNS-провайдера → обновить
- Закрыл Modal/HawkBit → удалить из списка
- Сменил VPS-провайдера → обновить

Дата последнего review: 2026-05-10. Следующий review: **2026-08-10** (3 месяца).
