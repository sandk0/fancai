# Ручная настройка SSL сертификатов

## Метод 1: Упрощенный (рекомендуется для первого запуска)

### Шаг 1: Подготовка

На сервере в `/opt/bookreader`:

```bash
# Создайте необходимые директории
mkdir -p nginx/ssl
mkdir -p nginx/certbot-www/.well-known/acme-challenge
chmod -R 755 nginx/certbot-www

# Создайте тестовый файл
echo "OK" > nginx/certbot-www/.well-known/acme-challenge/test.txt
```

### Шаг 2: Временный nginx (только HTTP)

Создайте файл `docker-compose.temp-ssl.yml`:

```yaml
services:
  nginx-temp:
    image: nginx:alpine
    container_name: bookreader_nginx_temp
    ports:
      - "80:80"
    volumes:
      - ./nginx/nginx.http-only.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/certbot-www:/var/www/certbot:ro
    restart: no
```

Запустите временный nginx:

```bash
docker compose -f docker-compose.temp-ssl.yml up -d
```

### Шаг 3: Проверка доступности

```bash
# Проверьте, что webroot доступен
curl http://fancai.ru/.well-known/acme-challenge/test.txt
# Должно вернуть: OK
```

Если не работает:
- Проверьте DNS: `nslookup fancai.ru` должен показывать IP вашего сервера
- Проверьте firewall: `sudo ufw status` (порт 80 должен быть открыт)
- Проверьте nginx: `docker compose -f docker-compose.temp-ssl.yml logs`

### Шаг 4: Получение сертификата

```bash
# Используйте certbot напрямую
docker run -it --rm \
  -v "$(pwd)/nginx/ssl:/etc/letsencrypt" \
  -v "$(pwd)/nginx/certbot-www:/var/www/certbot" \
  certbot/certbot:latest \
  certonly --webroot \
  -w /var/www/certbot \
  --email sandk008@gmail.com \
  --agree-tos \
  --no-eff-email \
  -d fancai.ru \
  -d www.fancai.ru
```

**Для тестирования** (использует staging сервер, не имеет лимитов):

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
  -d fancai.ru \
  -d www.fancai.ru
```

### Шаг 5: Копирование сертификатов

```bash
# Создайте симлинки для nginx
ln -sf /etc/letsencrypt/live/fancai.ru/fullchain.pem nginx/ssl/fullchain.pem
ln -sf /etc/letsencrypt/live/fancai.ru/privkey.pem nginx/ssl/privkey.pem

# Или скопируйте напрямую
cp nginx/ssl/live/fancai.ru/fullchain.pem nginx/ssl/fullchain.pem
cp nginx/ssl/live/fancai.ru/privkey.pem nginx/ssl/privkey.pem
chmod 644 nginx/ssl/fullchain.pem
chmod 600 nginx/ssl/privkey.pem
```

### Шаг 6: Запуск production nginx

```bash
# Остановите временный nginx
docker compose -f docker-compose.temp-ssl.yml down

# Запустите production конфигурацию
docker compose -f docker-compose.prod.yml up -d
```

### Шаг 7: Проверка SSL

```bash
# Проверьте HTTPS
curl -I https://fancai.ru

# Проверьте SSL сертификат
echo | openssl s_client -connect fancai.ru:443 -servername fancai.ru 2>/dev/null | openssl x509 -noout -dates

# Онлайн проверка
# Откройте: https://www.ssllabs.com/ssltest/analyze.html?d=fancai.ru
```

### Шаг 8: Настройка автообновления

Создайте cron job для автоматического обновления:

```bash
# Добавьте в crontab
sudo crontab -e
```

Добавьте строку:

```bash
0 0,12 * * * cd /opt/bookreader && docker run --rm -v "$(pwd)/nginx/ssl:/etc/letsencrypt" -v "$(pwd)/nginx/certbot-www:/var/www/certbot" certbot/certbot:latest renew --quiet && docker compose -f docker-compose.prod.yml restart nginx
```

Или используйте systemd timer (создайте `/etc/systemd/system/certbot-renewal.service`):

```ini
[Unit]
Description=Certbot Renewal
After=network.target

[Service]
Type=oneshot
WorkingDirectory=/opt/bookreader
ExecStart=/usr/bin/docker run --rm -v /opt/bookreader/nginx/ssl:/etc/letsencrypt -v /opt/bookreader/nginx/certbot-www:/var/www/certbot certbot/certbot:latest renew --quiet
ExecStartPost=/usr/bin/docker compose -f /opt/bookreader/docker-compose.prod.yml restart nginx
```

И timer (`/etc/systemd/system/certbot-renewal.timer`):

```ini
[Unit]
Description=Certbot Renewal Timer

[Timer]
OnCalendar=*-*-* 00,12:00:00
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
```

Активируйте:

```bash
sudo systemctl daemon-reload
sudo systemctl enable certbot-renewal.timer
sudo systemctl start certbot-renewal.timer
sudo systemctl status certbot-renewal.timer
```

---

## Метод 2: Использование скрипта (автоматизированный)

Скопируйте скрипт `scripts/init-ssl.sh` на сервер и выполните:

```bash
# На сервере
cd /opt/bookreader
chmod +x scripts/init-ssl.sh

# Тестовый запуск (staging)
sudo ./scripts/init-ssl.sh fancai.ru sandk008@gmail.com 1

# Production запуск
sudo ./scripts/init-ssl.sh fancai.ru sandk008@gmail.com 0
```

---

## Troubleshooting

### Ошибка: "Unable to open config file"

Эта ошибка возникает, когда certbot пытается прочитать несуществующий файл конфигурации. Используйте Метод 1 с прямым вызовом certbot.

### Ошибка: "Connection refused"

Проверьте:
```bash
# Nginx запущен?
docker ps | grep nginx

# Порт 80 открыт?
sudo netstat -tlnp | grep :80

# Firewall?
sudo ufw status
```

### Ошибка: "Invalid response from http://fancai.ru/.well-known/acme-challenge/..."

Проверьте DNS:
```bash
nslookup fancai.ru
dig fancai.ru
```

Проверьте веб-доступность:
```bash
curl -v http://fancai.ru/.well-known/acme-challenge/test.txt
```

### Ошибка: "too many certificates already issued"

Let's Encrypt имеет лимит: 50 сертификатов на домен в неделю. Используйте `--staging` для тестирования.

### Сертификат получен, но HTTPS не работает

Проверьте:
```bash
# Сертификаты скопированы?
ls -la nginx/ssl/

# Nginx видит сертификаты?
docker compose -f docker-compose.prod.yml exec nginx ls -la /etc/nginx/ssl/

# Логи nginx
docker compose -f docker-compose.prod.yml logs nginx
```

---

## Полезные команды

```bash
# Проверка статуса сертификата
docker run --rm -v "$(pwd)/nginx/ssl:/etc/letsencrypt" certbot/certbot:latest certificates

# Ручное обновление сертификата
docker run --rm -v "$(pwd)/nginx/ssl:/etc/letsencrypt" -v "$(pwd)/nginx/certbot-www:/var/www/certbot" certbot/certbot:latest renew

# Удаление сертификата (для повторного получения)
docker run --rm -v "$(pwd)/nginx/ssl:/etc/letsencrypt" certbot/certbot:latest delete --cert-name fancai.ru

# Тестирование обновления (dry-run)
docker run --rm -v "$(pwd)/nginx/ssl:/etc/letsencrypt" -v "$(pwd)/nginx/certbot-www:/var/www/certbot" certbot/certbot:latest renew --dry-run
```

---

## Важные заметки

1. **Rate Limits**: Let's Encrypt имеет лимиты на production сервере. Для тестирования используйте `--staging`.

2. **Валидность**: Сертификаты действительны 90 дней. Настройте автообновление обязательно!

3. **Безопасность**: Приватный ключ (`privkey.pem`) должен иметь права 600.

4. **Backup**: Сохраните директорию `nginx/ssl/` - она содержит все ваши сертификаты.

5. **Wildcard сертификаты**: Для `*.fancai.ru` требуется DNS-01 validation (не webroot).

---

## Дополнительные ресурсы

- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
- [Certbot Documentation](https://certbot.eff.org/docs/)
- [SSL Labs Test](https://www.ssllabs.com/ssltest/)
- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/)
