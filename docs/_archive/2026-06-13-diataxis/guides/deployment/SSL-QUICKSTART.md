# SSL Quick Start Guide

## Быстрая настройка SSL для fancai.ru

### Шаг 1: Подготовка (на сервере)

```bash
cd /opt/bookreader

# Создайте директории
mkdir -p nginx/ssl nginx/certbot-www/.well-known/acme-challenge
chmod -R 755 nginx/certbot-www

# Тестовый файл
echo "OK" > nginx/certbot-www/.well-known/acme-challenge/test.txt
```

### Шаг 2: Запустите временный nginx

```bash
# Запуск nginx только для HTTP (для получения сертификата)
docker compose -f docker-compose.temp-ssl.yml up -d

# Проверьте, что работает
curl http://fancai.ru/.well-known/acme-challenge/test.txt
# Должно вернуть: OK
```

**Если не работает:**
- Проверьте DNS: `nslookup fancai.ru` → должен показывать IP сервера
- Проверьте firewall: `sudo ufw allow 80/tcp && sudo ufw allow 443/tcp`
- Проверьте nginx: `docker ps` и `docker logs bookreader_nginx_temp`

### Шаг 3: Получите сертификат

**Для ТЕСТИРОВАНИЯ (рекомендуется сначала):**

```bash
docker run -it --rm \
  -v "$(pwd)/nginx/ssl:/etc/letsencrypt" \
  -v "$(pwd)/nginx/certbot-www:/var/www/certbot" \
  certbot/certbot:latest \
  certonly --webroot \
  -w /var/www/certbot \
  --email sandk008@gmail.com \
  --agree-tos \
  --no-eff-email \
  --staging \
  -d fancai.ru -d www.fancai.ru
```

Если успешно, получите PRODUCTION сертификат:

**PRODUCTION:**

```bash
docker run -it --rm \
  -v "$(pwd)/nginx/ssl:/etc/letsencrypt" \
  -v "$(pwd)/nginx/certbot-www:/var/www/certbot" \
  certbot/certbot:latest \
  certonly --webroot \
  -w /var/www/certbot \
  --email sandk008@gmail.com \
  --agree-tos \
  --no-eff-email \
  -d fancai.ru -d www.fancai.ru
```

### Шаг 4: Скопируйте сертификаты в правильное место

```bash
# Скопируйте сертификаты
cp nginx/ssl/live/fancai.ru/fullchain.pem nginx/ssl/fullchain.pem
cp nginx/ssl/live/fancai.ru/privkey.pem nginx/ssl/privkey.pem

# Установите правильные права
chmod 644 nginx/ssl/fullchain.pem
chmod 600 nginx/ssl/privkey.pem

# Проверьте
ls -la nginx/ssl/*.pem
```

### Шаг 5: Запустите production stack

```bash
# Остановите временный nginx
docker compose -f docker-compose.temp-ssl.yml down

# Запустите production
docker compose -f docker-compose.prod.yml up -d

# Проверьте статус
docker compose -f docker-compose.prod.yml ps
```

### Шаг 6: Проверьте HTTPS

```bash
# Простая проверка
curl -I https://fancai.ru

# Проверка сертификата
echo | openssl s_client -connect fancai.ru:443 -servername fancai.ru 2>/dev/null | openssl x509 -noout -text

# Онлайн проверка (откройте в браузере)
# https://www.ssllabs.com/ssltest/analyze.html?d=fancai.ru
```

### Шаг 7: Настройте автообновление

```bash
# Добавьте в crontab
sudo crontab -e

# Добавьте эту строку (обновление 2 раза в день)
0 0,12 * * * cd /opt/bookreader && docker run --rm -v "$(pwd)/nginx/ssl:/etc/letsencrypt" -v "$(pwd)/nginx/certbot-www:/var/www/certbot" certbot/certbot:latest renew --quiet && docker compose -f docker-compose.prod.yml restart nginx
```

---

## Готово! 🎉

Ваш сайт теперь работает с HTTPS:
- https://fancai.ru
- https://www.fancai.ru

---

## Troubleshooting

### Ошибка: "Connection refused"

```bash
# Проверьте DNS
nslookup fancai.ru

# Проверьте firewall
sudo ufw status

# Проверьте nginx
docker ps | grep nginx
docker logs bookreader_nginx_temp
```

### Ошибка: "Invalid response from http://fancai.ru"

DNS не настроен или не распространился. Подождите и проверьте:

```bash
dig fancai.ru
```

### Ошибка: "too many certificates already issued"

Вы превысили лимит Let's Encrypt (50 сертификатов/неделю). Подождите или используйте `--staging` для тестов.

### HTTPS не работает после получения сертификата

```bash
# Проверьте, что сертификаты скопированы
ls -la nginx/ssl/*.pem

# Проверьте логи nginx
docker compose -f docker-compose.prod.yml logs nginx

# Проверьте конфигурацию nginx
docker compose -f docker-compose.prod.yml exec nginx nginx -t
```

---

## Полезные команды

```bash
# Проверка статуса сертификата
docker run --rm \
  -v "$(pwd)/nginx/ssl:/etc/letsencrypt" \
  certbot/certbot:latest certificates

# Ручное обновление
docker run --rm \
  -v "$(pwd)/nginx/ssl:/etc/letsencrypt" \
  -v "$(pwd)/nginx/certbot-www:/var/www/certbot" \
  certbot/certbot:latest renew

# Тест обновления (dry run)
docker run --rm \
  -v "$(pwd)/nginx/ssl:/etc/letsencrypt" \
  -v "$(pwd)/nginx/certbot-www:/var/www/certbot" \
  certbot/certbot:latest renew --dry-run
```

---

## Дополнительная информация

Полная документация: `docs/operations/deployment/ssl-setup-manual.md`
