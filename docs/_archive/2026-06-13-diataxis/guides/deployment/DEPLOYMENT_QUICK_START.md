# Quick Start - Deployment за 10 команд

**Копируйте и вставляйте в Termius по очереди**

---

## 1. Обновление системы и установка Docker

```bash
apt update && apt upgrade -y && curl -fsSL https://get.docker.com | sh && apt install -y docker-compose-plugin git vim python3
```

## 2. Настройка firewall

```bash
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

## 3. Создание swap

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 4. Клонирование проекта

```bash
mkdir -p /opt/bookreader && cd /opt/bookreader && git clone https://github.com/sandk0/fancai-vibe-hackathon.git .
```

## 5. Генерация секретов

```bash
cat << 'EOF'
Скопируйте эти секреты:

DB_PASSWORD=$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')
REDIS_PASSWORD=$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')
SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
JWT_SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
ADMIN_PASSWORD=$(python3 -c 'import secrets; print(secrets.token_urlsafe(16))')
EOF
```

Запустите генерацию:
```bash
echo "DB_PASSWORD: $(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
echo "REDIS_PASSWORD: $(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
echo "SECRET_KEY: $(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
echo "JWT_SECRET_KEY: $(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
echo "ADMIN_PASSWORD: $(python3 -c 'import secrets; print(secrets.token_urlsafe(16))')"
```

## 6. Настройка .env.staging

```bash
cp .env.staging.example .env.staging && vim .env.staging
```

**Замените в файле:**
- `DOMAIN_NAME=fancai.ru`
- `DB_PASSWORD=` (вставить сгенерированный)
- `REDIS_PASSWORD=` (вставить сгенерированный)
- `SECRET_KEY=` (вставить сгенерированный)
- `JWT_SECRET_KEY=` (вставить сгенерированный)
- `ADMIN_PASSWORD=` (вставить сгенерированный)

Сохранить: `Esc` → `:wq` → `Enter`

## 7. Проверка DNS и получение SSL

```bash
dig +short fancai.ru
```

Должен вернуть `88.210.35.41`. Если да - продолжайте:

```bash
mkdir -p nginx/ssl && docker compose -f docker-compose.ssl.yml --profile ssl-init run --rm certbot
```

Введите email когда спросит, согласитесь с ToS.

## 8. Запуск auto-renewal SSL

```bash
docker compose -f docker-compose.ssl.yml --profile ssl-renew up -d
```

## 9. Build и Deploy

```bash
docker compose -f docker-compose.staging.yml build && docker compose -f docker-compose.staging.yml up -d
```

Ждите 2-3 минуты для build.

## 10. Инициализация БД

```bash
sleep 60 && docker compose -f docker-compose.staging.yml exec backend alembic upgrade head
```

## 11. Создание admin user

```bash
docker compose -f docker-compose.staging.yml exec backend python -c "from app.models.user import User; from app.core.database import SessionLocal; from passlib.context import CryptContext; import os; pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto'); db = SessionLocal(); admin = User(email=os.getenv('ADMIN_EMAIL', 'admin@fancai.ru'), username='admin', hashed_password=pwd_context.hash(os.getenv('ADMIN_PASSWORD')), is_active=True, is_superuser=True); db.add(admin); db.commit(); print(f'✅ Admin created: {admin.email}'); db.close()"
```

## ✅ Готово!

Проверьте:
```bash
docker compose -f docker-compose.staging.yml ps
docker stats --no-stream
curl https://fancai.ru/health
```

Откройте в браузере: **https://fancai.ru**

---

**Детальные инструкции:** `DEPLOYMENT_COMMANDS.md`
