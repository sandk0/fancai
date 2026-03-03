# Задача: Аудит нового VPS-сервера перед настройкой

## Контекст

Я получил SSH-доступ к новому VPS-серверу (netcup.com). На сервере чистая установка Debian 13 (Trixie)
и установлен Docker из официального репозитория. Больше ничего не настраивалось.

Сервер предназначен для деплоя проекта fancai — fiction reader с AI-иллюстрациями
и интерактивным глоссарием (FastAPI + Celery + PostgreSQL 17 + Redis 7.4 + Caddy v2).

У нас есть подробный план настройки: `docs/reports/2026-03-01-vps-setup-guide-debian13.md`
— прочитай его ПЕРЕД подключением к серверу, чтобы понимать целевое состояние.

## Характеристики сервера (заявленные хостером)

- **CPU:** 12 vCPU (AMD EPYC 9755, 4 GHz)
- **RAM:** 32 GB DDR5
- **Диск:** 100 GB NVMe SSD
- **ОС:** Debian 13 (Trixie)
- **Провайдер:** netcup.com (Германия)
- **Домен:** fancai.ru (DNS уже направлен на IP сервера)
- **Docker:** установлен из официального репозитория Docker

## SSH-доступ

```
ssh root@<IP>
```

Пароль я предоставлю при запросе.

## Режим работы

**ТОЛЬКО ЧТЕНИЕ. НИЧЕГО НЕ МЕНЯТЬ НА СЕРВЕРЕ.**

- Не создавать файлы, не редактировать конфигурации, не устанавливать пакеты
- Не перезапускать сервисы
- Не менять настройки ядра, сети, firewall
- Только команды сбора информации: `cat`, `grep`, `sysctl`, `lsblk`, `free`, `df`, `ip`, `ss`,
  `docker info`, `nft list`, `systemctl status`, `uname`, `lscpu` и подобные
- Если нужно выполнить что-то потенциально изменяющее — СПРОСИ РАЗРЕШЕНИЯ

## Что проверить

### 1. Железо и ОС — верификация заявленных характеристик

```bash
# CPU: модель, количество ядер, частота, архитектура, флаги (aes, avx, sse)
lscpu
cat /proc/cpuinfo | grep -E "model name|cpu MHz|cache size" | head -6

# RAM: объём, тип, скорость (если доступно)
free -h
cat /proc/meminfo | head -20
dmidecode -t memory 2>/dev/null | head -40

# Диск: размер, тип (NVMe?), модель, partitioning, файловая система, mount options
lsblk -f
fdisk -l
df -hT
mount | grep -E "^/dev"
cat /etc/fstab

# Ядро
uname -a
cat /etc/debian_version
cat /etc/os-release

# Uptime, load
uptime
```

**Ключевые вопросы:**

- Совпадает ли CPU/RAM/Disk с заявленными 12 vCPU / 32 GB / 100 GB NVMe?
- Какая файловая система (ext4? xfs? btrfs?)? Какие mount options?
- Есть ли отдельные разделы или всё на одном?
- Поддерживает ли CPU huge pages, AES-NI, AVX?
- Какая версия ядра Linux? (ожидаем 6.12.x для Debian 13)

### 2. Сеть

```bash
# Интерфейсы, IP-адреса
ip addr show
ip route show

# DNS
cat /etc/resolv.conf
dig fancai.ru +short 2>/dev/null || nslookup fancai.ru

# Открытые порты (что слушает)
ss -tlnp
ss -ulnp

# Hostname
hostname
hostnamectl

# IPv6
ip -6 addr show

# MTU
ip link show | grep mtu

# Пропускная способность (если iperf доступен)
# Не устанавливать, только проверить наличие
which iperf3 2>/dev/null && echo "iperf3 available" || echo "iperf3 not installed"
```

**Ключевые вопросы:**

- Какой публичный IP? Совпадает с DNS fancai.ru?
- Есть ли IPv6?
- Какие порты уже слушают (SSH на 22?)?
- Какой DNS-резолвер настроен?
- Какой hostname по умолчанию?

### 3. Безопасность — текущее состояние

```bash
# SSH конфигурация
cat /etc/ssh/sshd_config
ls -la /etc/ssh/sshd_config.d/
cat /etc/ssh/sshd_config.d/*.conf 2>/dev/null

# Какие алгоритмы SSH поддерживаются
ssh -Q kex
ssh -Q cipher
ssh -Q mac

# Пользователи с shell
cat /etc/passwd | grep -v nologin | grep -v /bin/false
who
last -10

# Sudo
cat /etc/sudoers.d/* 2>/dev/null
getent group sudo

# SSH ключи
ls -la /root/.ssh/
cat /root/.ssh/authorized_keys 2>/dev/null | wc -l

# Firewall
nft list ruleset 2>/dev/null
iptables -L -n 2>/dev/null
ufw status 2>/dev/null

# fail2ban
systemctl status fail2ban 2>/dev/null
fail2ban-client status 2>/dev/null

# AppArmor
aa-status 2>/dev/null
systemctl status apparmor 2>/dev/null

# Автоматические обновления
dpkg -l | grep unattended-upgrades 2>/dev/null
cat /etc/apt/apt.conf.d/20auto-upgrades 2>/dev/null
cat /etc/apt/apt.conf.d/50unattended-upgrades 2>/dev/null | head -20

# SELinux (не ожидаем, но проверим)
getenforce 2>/dev/null || echo "SELinux not installed"

# Проверка на rootkits (если rkhunter/chkrootkit установлены)
which rkhunter 2>/dev/null && echo "rkhunter available" || echo "rkhunter not installed"
which chkrootkit 2>/dev/null && echo "chkrootkit available" || echo "chkrootkit not installed"

# Слушающие на 0.0.0.0 сервисы (потенциально опасные)
ss -tlnp | grep "0.0.0.0"
```

**Ключевые вопросы:**

- SSH: на каком порту? Разрешён ли root login по паролю? Какие алгоритмы?
- Есть ли firewall (nftables/iptables/ufw)?
- Есть ли fail2ban?
- Есть ли непривилегированные пользователи?
- AppArmor включён?
- Unattended upgrades настроены?
- Есть ли уже чужие SSH-ключи?
- OpenSSH 10.0+? Поддерживает ли ML-KEM (post-quantum)?

### 4. Системные настройки (sysctl, limits, swap)

```bash
# Текущие sysctl (ключевые параметры)
sysctl vm.swappiness
sysctl vm.overcommit_memory
sysctl vm.nr_hugepages
sysctl vm.dirty_ratio
sysctl vm.dirty_background_ratio
sysctl net.core.somaxconn
sysctl net.ipv4.tcp_congestion_control
sysctl net.ipv4.ip_forward
sysctl net.ipv4.tcp_tw_reuse
sysctl net.ipv4.tcp_max_syn_backlog
sysctl net.ipv4.tcp_syncookies
sysctl net.ipv4.conf.all.rp_filter
sysctl net.ipv4.conf.all.accept_redirects
sysctl net.ipv4.conf.all.send_redirects
sysctl fs.file-max

# Huge pages
grep -i huge /proc/meminfo
cat /sys/kernel/mm/transparent_hugepage/enabled
cat /sys/kernel/mm/transparent_hugepage/defrag

# Limits
ulimit -a
cat /etc/security/limits.conf
ls /etc/security/limits.d/
cat /etc/security/limits.d/*.conf 2>/dev/null

# Swap
swapon --show
free -h
cat /proc/swaps

# Время и часовой пояс
timedatectl
systemctl status systemd-timesyncd 2>/dev/null
systemctl status chrony 2>/dev/null

# Локаль
locale
locale -a 2>/dev/null | grep -E "en_US|ru_RU"
```

**Сравнить с целевыми значениями из плана:**

| Параметр               | Ожидаемый default | Целевое (по плану) | Приоритет       |
| ---------------------- | ----------------- | ------------------ | --------------- |
| vm.swappiness          | 60                | 10                 | P1              |
| vm.overcommit_memory   | 0                 | 1                  | P0 (Redis)      |
| vm.nr_hugepages        | 0                 | 4500               | P1 (PostgreSQL) |
| THP enabled            | always            | never              | P0 (PG + Redis) |
| net.core.somaxconn     | 4096              | 65535              | P1              |
| tcp_congestion_control | cubic             | bbr                | P1              |
| ip_forward             | 0                 | 1                  | P0 (Docker)     |
| fs.file-max            | ~65536            | 2097152            | P1              |
| swap                   | нет?              | 4 GB file          | P1              |
| timezone               | UTC?              | Europe/Moscow      | P2              |

### 5. Docker

```bash
# Версия и конфигурация
docker --version
docker compose version
docker info

# daemon.json
cat /etc/docker/daemon.json 2>/dev/null || echo "No daemon.json"

# Storage driver, cgroup driver
docker info 2>/dev/null | grep -E "Storage Driver|Logging Driver|Cgroup|Server Version|Live Restore|Default Runtime|Docker Root Dir|Security Options"

# Сеть Docker
docker network ls
ip addr show docker0 2>/dev/null

# Диск
docker system df 2>/dev/null

# Systemd unit — лимиты
systemctl show docker | grep -E "LimitNOFILE|LimitNPROC|LimitCORE"

# iptables-nft проверка (критично для Debian 13 + Docker)
iptables --version 2>/dev/null
update-alternatives --display iptables 2>/dev/null
# Должно быть: iptables -> /usr/sbin/iptables-nft
```

**Ключевые вопросы:**

- Какая версия Docker Engine? (ожидаем 27.x или 28.x)
- Docker Compose plugin установлен? (docker compose version)
- Есть ли daemon.json? Что в нём?
- Storage driver: overlay2?
- Cgroup driver: systemd? (cgroup v2 на Debian 13)
- Live restore включён?
- iptables-nft или iptables-legacy? (критично — Docker + nftables)
- Какие лимиты файловых дескрипторов для Docker daemon?

### 6. Установленные пакеты и сервисы

```bash
# Все установленные пакеты
dpkg -l | wc -l
dpkg -l | grep -E "docker|nginx|caddy|redis|postgres|python|node|fail2ban|chrony|ntp|certbot|ufw|curl|wget|git|vim|htop|jq|rsync|unattended|needrestart" 2>/dev/null

# Запущенные сервисы
systemctl list-units --type=service --state=running --no-pager

# Enabled сервисы
systemctl list-unit-files --type=service --state=enabled --no-pager

# Cron jobs
crontab -l 2>/dev/null
ls /etc/cron.d/ /etc/cron.daily/ /etc/cron.weekly/ 2>/dev/null

# Systemd timers
systemctl list-timers --all --no-pager

# Какие репозитории настроены
cat /etc/apt/sources.list 2>/dev/null
ls /etc/apt/sources.list.d/
cat /etc/apt/sources.list.d/*.list 2>/dev/null
cat /etc/apt/sources.list.d/*.sources 2>/dev/null
```

**Ключевые вопросы:**

- Какие пакеты уже установлены? Нет ли лишних?
- Какие сервисы запущены? Нет ли ненужных?
- Есть ли cron jobs?
- Какие APT-репозитории настроены? (Debian 13 использует DEB822 формат .sources)

### 7. Дисковое пространство и I/O

```bash
# Использование диска (подробно)
df -hT
du -sh /var/log/ /tmp/ /var/cache/ /var/lib/docker/ /root/ 2>/dev/null

# I/O scheduler (для NVMe обычно none/mq-deadline)
cat /sys/block/*/queue/scheduler 2>/dev/null
for d in /sys/block/*/; do echo "$(basename $d): $(cat $d/queue/scheduler 2>/dev/null)"; done

# NVMe информация
ls /dev/nvme* 2>/dev/null
cat /sys/class/nvme/nvme*/model 2>/dev/null
cat /sys/class/nvme/nvme*/firmware_rev 2>/dev/null

# Текущий I/O
iostat -x 1 3 2>/dev/null || echo "iostat not installed (sysstat package needed)"

# SMART данные (если smartctl доступен)
which smartctl 2>/dev/null && smartctl -a /dev/nvme0 2>/dev/null | head -30 || echo "smartctl not installed"
```

### 8. Потенциальные проблемы

```bash
# Процессы, зомби
ps aux --sort=-%mem | head -15
ps aux | awk '$8 ~ /Z/ {print}'

# Ошибки в dmesg
dmesg | tail -30
dmesg | grep -iE "error|fail|warn|oom|kill" | tail -20

# Журнал systemd (ошибки)
journalctl -p err -b --no-pager | tail -30

# /var/log — что занимает место
du -sh /var/log/* 2>/dev/null | sort -rh | head -10

# Проверить нет ли подозрительных процессов
ps aux | grep -v "^\[" | awk '{print $11}' | sort | uniq -c | sort -rn | head -20

# Проверить нет ли listening на нестандартных портах
ss -tlnp | grep -v -E ":22\b|:80\b|:443\b"

# Проверить /tmp — нет ли мусора
ls -la /tmp/
```

## Формат отчёта

Результат представь в виде структурированного отчёта:

```markdown
# Аудит VPS-сервера: fancai.ru (pre-setup)

**Дата:** 2026-03-XX
**IP:** <REDACTED>
**Провайдер:** netcup.com

## Executive Summary

[2-3 предложения: общее состояние сервера, главные находки,
готовность к настройке по плану]

## 1. Железо и ОС

### Заявлено vs Фактически

| Параметр | Заявлено              | Фактически | Статус   |
| -------- | --------------------- | ---------- | -------- |
| CPU      | 12 vCPU AMD EPYC 9755 | ...        | ✅/⚠️/❌ |
| RAM      | 32 GB DDR5            | ...        | ...      |
| Disk     | 100 GB NVMe           | ...        | ...      |
| OS       | Debian 13 (Trixie)    | ...        | ...      |
| Kernel   | ~6.12.x               | ...        | ...      |

### Детали

[Файловая система, mount options, CPU flags, etc.]

## 2. Сеть

[IP, DNS, порты, hostname, IPv6]

## 3. Безопасность

### Текущий уровень: [КРИТИЧНО НИЗКИЙ / НИЗКИЙ / СРЕДНИЙ / ВЫСОКИЙ]

- SSH: [порт, root access, алгоритмы]
- Firewall: [есть/нет, правила]
- fail2ban: [есть/нет]
- AppArmor: [включён/выключен]
- Авто-обновления: [настроены/нет]

## 4. Системные настройки

### Параметры, требующие изменения

| Параметр             | Текущее значение | Целевое (по плану) | Приоритет |
| -------------------- | ---------------- | ------------------ | --------- |
| vm.swappiness        | ...              | 10                 | P1        |
| vm.overcommit_memory | ...              | 1                  | P0        |
| ...                  | ...              | ...                | ...       |

## 5. Docker

| Параметр      | Текущее | Целевое      | Статус |
| ------------- | ------- | ------------ | ------ |
| Version       | ...     | 27.x+        | ...    |
| Compose       | ...     | plugin v2    | ...    |
| Storage       | ...     | overlay2     | ...    |
| Cgroup        | ...     | systemd (v2) | ...    |
| daemon.json   | ...     | настроить    | ...    |
| iptables mode | ...     | iptables-nft | ...    |

## 6. Пакеты и сервисы

### Установлено (полезное)

### Установлено (лишнее — удалить/отключить)

### Не хватает (установить по плану)

## 7. Дисковая подсистема

[NVMe модель, FS, scheduler, свободное место]

## 8. Проблемы и риски

### P0 — Критические (исправить немедленно)

### P1 — Важные (исправить при настройке)

### P2 — Рекомендации (желательно)

## 9. Готовность к настройке по плану

### Checklist совместимости с планом

- [ ] Debian 13 (Trixie) подтверждён
- [ ] Docker установлен и работает
- [ ] cgroup v2 активен
- [ ] iptables-nft (не legacy)
- [ ] Файловая система совместима с overlay2
- [ ] NVMe подтверждён (для io_concurrency=200)
- [ ] CPU поддерживает huge pages
- [ ] Достаточно RAM для huge pages (4500 × 2MB = 8.8 GB) + контейнеры (~19 GB)
- [ ] DNS fancai.ru указывает на этот сервер

## 10. Расхождения с планом настройки

[Что из docs/reports/2026-03-01-vps-setup-guide-debian13.md может не работать
или потребует корректировки на основе фактического состояния сервера.

Например:

- Другая версия ядра → другие sysctl параметры
- Другой тип диска → другие mount options
- Другой layout разделов → другая стратегия swap
- Отсутствие определённых CPU флагов → другие настройки PostgreSQL
- Docker версия < 27 → другие возможности daemon.json]
```

## Важные ограничения

- **ТОЛЬКО ЧТЕНИЕ** — никаких изменений на сервере
- Все пароли, IP-адреса и ключи в отчёте заменяй на `<REDACTED>`
- Если команда требует пакет, которого нет — отметь в отчёте, не устанавливай
- Отчёт сохрани в `docs/reports/2026-03-XX-vps-audit-pre-setup.md` (локально в репозитории, замени XX на актуальное число)
- Сравнивай КАЖДЫЙ параметр с целевым значением из плана настройки
- Обрати особое внимание на всё, что может помешать выполнению плана
- Группируй по параллельным ssh-командам для эффективности (несколько Bash вызовов одновременно)
- Используй `2>/dev/null` для команд, которые могут не существовать
