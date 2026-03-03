# Руководство по настройке VPS-сервера: Debian 13 + Docker + fancai

**Дата:** 2026-03-01
**Сервер:** netcup.com — 12 vCPU AMD EPYC 9755, 32 GB DDR5, 100 GB NVMe SSD
**ОС:** Debian 13 (Trixie)
**Домен:** fancai.ru
**Автор:** Claude Code

---

## Часть 1: Результаты исследования

### Что нового в Debian 13 (Trixie) на март 2026

Debian 13 выпущен 9 августа 2025, текущий point release — 13.3 (10 января 2026).

| Компонент  | Debian 12 (Bookworm) | Debian 13 (Trixie)  | Значение для проекта                      |
| ---------- | -------------------- | ------------------- | ----------------------------------------- |
| Ядро Linux | 6.1                  | **6.12 LTS**        | BBR v3, улучшенная поддержка NVMe         |
| OpenSSH    | 9.2                  | **10.0p1**          | Post-quantum KEX (ML-KEM) по умолчанию    |
| OpenSSL    | 3.0                  | **3.5**             | Новые криптоалгоритмы                     |
| systemd    | 252                  | **257**             | Улучшенный cgroup v2                      |
| Python     | 3.11                 | **3.13**            | Docker-образ python:3.12-slim по-прежнему |
| nftables   | Есть                 | **Единственный** FW | UFW/iptables — только через shim          |
| AppArmor   | По умолчанию         | **По умолчанию**    | Без изменений                             |
| APT        | 2.6                  | **3.0**             | Новый синтаксис sources                   |

**Ключевые изменения безопасности:**

- **OpenSSH 10.0** — post-quantum key exchange (ML-KEM/mlkem768x25519-sha256) включён по умолчанию
- **Hardware exploit mitigations** (amd64) — Intel CET для защиты от ROP/COP атак
- **cgroup v2** — единственный вариант, Docker полностью поддерживает
- **nftables** — iptables работает только через iptables-nft compatibility layer

**Известные проблемы Debian 13:**

- Прерванное обновление OpenSSH может заблокировать SSH-доступ
- Имена сетевых интерфейсов могут измениться при миграции с Debian 12
- Docker 29+ имеет экспериментальный нативный nftables-бэкенд, но НЕ рекомендуется для production

### Ключевые решения

| Решение              | Выбор                   | Обоснование                                                  |
| -------------------- | ----------------------- | ------------------------------------------------------------ |
| Firewall             | nftables напрямую       | Debian 13 default, UFW не нужен                              |
| Docker + firewall    | iptables-nft shim       | Стабильный, production-ready. Нативный nftables experimental |
| Reverse proxy        | **Caddy v2** (не nginx) | Auto-HTTPS, проще конфиг, HTTP/3 built-in                    |
| SSH порт             | 2222                    | Отсекает 99% автосканеров + fail2ban                         |
| Port knocking        | **Нет**                 | Лишняя сложность, knockd может упасть                        |
| SSH ключ             | Ed25519                 | Стандарт, быстрее и безопаснее RSA                           |
| Swap                 | 4 GB swap file          | Safety net от OOM killer                                     |
| vm.swappiness        | 10                      | Минимальный swap, но не 0 (для аварийных ситуаций)           |
| vm.overcommit_memory | 1                       | Необходим для Redis background saves (fork)                  |
| Huge Pages           | 4500 страниц            | 8GB shared_buffers / 2MB + 10% overhead                      |
| TCP congestion       | BBR v3                  | Встроен в ядро 6.12, до 25x лучше CUBIC                      |
| PG eviction          | volatile-lru → Redis    | Защищает Celery broker данные от eviction                    |
| Chrony vs timesyncd  | **chrony**              | Точнее для production, лучше NTP-клиент                      |
| THP                  | **Отключить**           | Критично для PostgreSQL — вызывает latency jitter            |

---

## Часть 2: Пошаговая инструкция

> **Важно:** Все команды выполняются на сервере по SSH от root.
> После создания пользователя `deploy` — переключаемся на него.

---

### Шаг 1: Базовые пакеты

**Зачем:** Docker уже установлен, но нужны утилиты для администрирования и безопасности.

```bash
apt update && apt install -y \
    curl wget git vim htop iotop \
    net-tools dnsutils mtr \
    unzip rsync \
    ca-certificates gnupg \
    fail2ban \
    unattended-upgrades needrestart \
    chrony \
    jq tree ncdu \
    acl \
    sudo
```

**Проверка:**

```bash
fail2ban-client --version
chronyd --version
needrestart --version
```

---

### Шаг 2: Hostname и часовой пояс

**Зачем:** Идентификация сервера в логах, корректное время для бэкапов и логов.

```bash
# Hostname
hostnamectl set-hostname fancai-prod

# Часовой пояс — Europe/Moscow
timedatectl set-timezone Europe/Moscow

# Локали
apt install -y locales
sed -i 's/# en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen
sed -i 's/# ru_RU.UTF-8/ru_RU.UTF-8/' /etc/locale.gen
locale-gen
update-locale LANG=en_US.UTF-8
```

**Проверка:**

```bash
hostname
timedatectl
locale -a | grep -E "en_US|ru_RU"
```

---

### Шаг 3: Chrony (NTP)

**Зачем:** Chrony точнее systemd-timesyncd — быстрее синхронизирует время после простоя, поддерживает hardware timestamping, лучше работает с прерывистым сетевым соединением. Для production DB-сервера это важно (WAL timestamps, certificate validation).

```bash
# chrony уже установлен в шаге 1

# Настроить серверы NTP (ближайшие к Германии/netcup)
cat > /etc/chrony/chrony.conf << 'EOF'
# NTP серверы (Европа, ближайшие к netcup Германия)
pool de.pool.ntp.org iburst maxsources 4
pool europe.pool.ntp.org iburst maxsources 2

# Fallback
server time.cloudflare.com iburst

# Drift file
driftfile /var/lib/chrony/drift

# RTC sync
rtcsync

# Step-корректировка при большом расхождении (>1 секунда, первые 3 проверки)
makestep 1 3

# Logging
logdir /var/log/chrony
log measurements statistics tracking

# Не слушать на внешних интерфейсах
bindcmdaddress 127.0.0.1
bindcmdaddress ::1

# Запретить управление извне
deny all
EOF

# Отключить systemd-timesyncd (конфликтует с chrony)
systemctl disable --now systemd-timesyncd 2>/dev/null || true

# Включить chrony
systemctl enable --now chrony
```

**Проверка:**

```bash
chronyc tracking
chronyc sources -v
timedatectl | grep "synchronized"
# Должно быть: System clock synchronized: yes
```

---

### Шаг 4: Создание пользователя deploy

**Зачем:** Непривилегированный пользователь для деплоя. Root login по SSH будет отключён.

```bash
# Создать пользователя
useradd -m -s /bin/bash -G sudo,docker deploy

# Установить пароль (нужен для sudo)
passwd deploy
# Введите надёжный пароль

# Создать SSH-директорию
mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
```

**Следующий подшаг — генерация SSH-ключа НА ЛОКАЛЬНОЙ МАШИНЕ (не на сервере!):**

```bash
# === НА ЛОКАЛЬНОЙ МАШИНЕ ===
# Генерация Ed25519 ключа с усиленным KDF (100 раундов)
ssh-keygen -t ed25519 -a 100 -C "admin@fancai.ru" -f ~/.ssh/fancai_deploy

# Скопировать публичный ключ на сервер
ssh-copy-id -i ~/.ssh/fancai_deploy.pub root@<IP_СЕРВЕРА>
# Или вручную:
cat ~/.ssh/fancai_deploy.pub | ssh root@<IP_СЕРВЕРА> "cat >> /home/deploy/.ssh/authorized_keys"
```

**На сервере — установить права:**

```bash
chown -R deploy:deploy /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

**Проверка (с локальной машины, В НОВОМ ТЕРМИНАЛЕ, НЕ ЗАКРЫВАЯ ТЕКУЩУЮ СЕССИЮ!):**

```bash
ssh -i ~/.ssh/fancai_deploy deploy@<IP_СЕРВЕРА>
sudo whoami  # Должно вывести: root
```

> **КРИТИЧНО:** Не закрывайте текущую root-сессию, пока не убедитесь, что новый пользователь может подключиться и выполнить sudo!

---

### Шаг 5: SSH Hardening

**Зачем:** Защита от brute force, использование только современных алгоритмов, отключение root login.

```bash
cat > /etc/ssh/sshd_config.d/hardening.conf << 'EOF'
# =============================================================================
# SSH Hardening — fancai production server
# Debian 13 / OpenSSH 10.0+
# =============================================================================

# --- Порт и протокол ---
Port 2222
AddressFamily inet

# --- Доступ ---
PermitRootLogin no
AllowUsers deploy
MaxAuthTries 3
MaxSessions 3
LoginGraceTime 30

# --- Аутентификация ---
PubkeyAuthentication yes
PasswordAuthentication no
PermitEmptyPasswords no
KbdInteractiveAuthentication no
UsePAM yes

# --- Post-Quantum + Modern Key Exchange (OpenSSH 10.0+) ---
KexAlgorithms mlkem768x25519-sha256,sntrup761x25519-sha512@openssh.com,curve25519-sha256,curve25519-sha256@libssh.org

# --- Шифры (ChaCha20 + AES-256-GCM) ---
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes256-ctr

# --- MAC алгоритмы ---
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com

# --- Host ключи ---
HostKey /etc/ssh/ssh_host_ed25519_key
HostKey /etc/ssh/ssh_host_rsa_key

# --- Отключить ненужное ---
X11Forwarding no
AllowTcpForwarding no
AllowAgentForwarding no
PermitTunnel no
HostbasedAuthentication no
IgnoreRhosts yes

# --- Keep-alive ---
ClientAliveInterval 300
ClientAliveCountMax 2

# --- Логирование ---
LogLevel VERBOSE

# --- Banner ---
Banner /etc/ssh/banner.txt
EOF

# Создать SSH banner
cat > /etc/ssh/banner.txt << 'EOF'
*******************************************************************
*  Authorized access only. All activity is monitored and logged.  *
*******************************************************************
EOF
```

**КРИТИЧНО: Тестирование перед перезагрузкой sshd!**

```bash
# 1. Проверить синтаксис конфигурации
sshd -t
# Если ошибки — исправить ПЕРЕД рестартом!

# 2. В ОТДЕЛЬНОМ терминале (не закрывая текущий!) проверить подключение:
# ssh -p 2222 -i ~/.ssh/fancai_deploy deploy@<IP_СЕРВЕРА>

# 3. Только после успешной проверки:
systemctl restart sshd

# 4. Проверить что sshd слушает на 2222
ss -tlnp | grep 2222
```

**Проверка:**

```bash
# На локальной машине:
ssh -p 2222 -i ~/.ssh/fancai_deploy deploy@<IP_СЕРВЕРА>

# Проверить что root login отключён:
ssh -p 2222 root@<IP_СЕРВЕРА>
# Должен быть: Permission denied (publickey)

# Проверить что пароль отключён:
ssh -p 2222 -o PubkeyAuthentication=no deploy@<IP_СЕРВЕРА>
# Должен быть: Permission denied (publickey)
```

---

### Шаг 6: nftables Firewall

**Зачем:** nftables — единственный firewall на Debian 13. Нужно разрешить SSH (2222), HTTP (80), HTTPS (443) и Docker-трафик.

> **Важно:** Docker использует iptables-nft shim и управляет своими правилами автоматически. Мы настраиваем только `inet filter` таблицу — Docker её не трогает. НЕ используем `flush ruleset` — это сломает Docker-сетки.

```bash
cat > /etc/nftables.conf << 'EOF'
#!/usr/sbin/nft -f
# =============================================================================
# nftables firewall — fancai production server
# Debian 13 / Docker (iptables-nft compatibility)
# =============================================================================
#
# ВАЖНО: НЕ используем "flush ruleset" — это сломает Docker networking!
# Флушим только нашу таблицу.
# Docker управляет своими правилами через iptables-nft автоматически.

# Удалить предыдущие правила только нашей таблицы
flush table inet filter 2>/dev/null || true
delete table inet filter 2>/dev/null || true

table inet filter {

    # --- Набор для rate limiting SSH ---
    set ssh_ratelimit {
        type ipv4_addr
        flags dynamic, timeout
        timeout 1m
    }

    # --- Набор для логирования (anti-flood лога) ---
    set log_ratelimit {
        type ipv4_addr
        flags dynamic, timeout
        timeout 5m
    }

    chain input {
        type filter hook input priority 0; policy drop;

        # Established/Related — пропускаем (критично для Docker)
        ct state established,related accept

        # Invalid — отбрасываем
        ct state invalid drop

        # Loopback — всегда разрешаем
        iif "lo" accept

        # ICMP — ping с rate limiting
        ip protocol icmp limit rate 10/second burst 20 packets accept
        ip6 nexthdr icmpv6 limit rate 10/second burst 20 packets accept

        # SSH (порт 2222) — rate limiting: 3 новых соединения в минуту с одного IP
        tcp dport 2222 ct state new \
            update @ssh_ratelimit { ip saddr limit rate 3/minute burst 5 packets } \
            accept

        # HTTP / HTTPS — без ограничений (Caddy)
        tcp dport { 80, 443 } accept

        # HTTPS UDP (HTTP/3 QUIC)
        udp dport 443 accept

        # Логирование заблокированных пакетов (sample — не больше 5/мин)
        limit rate 5/minute burst 5 packets \
            log prefix "[nft-drop] " level info
    }

    chain forward {
        # ВАЖНО: policy accept, потому что Docker управляет forward rules
        # через iptables-nft. Если поставить drop — сломается Docker networking.
        type filter hook forward priority 0; policy accept;
    }

    chain output {
        type filter hook output priority 0; policy accept;
    }
}
EOF

# Включить nftables
systemctl enable nftables
nft -f /etc/nftables.conf
```

**Проверка:**

```bash
# Посмотреть активные правила
nft list ruleset

# Проверить что SSH работает (в новом терминале!)
ssh -p 2222 -i ~/.ssh/fancai_deploy deploy@<IP_СЕРВЕРА>

# Проверить что порт 22 закрыт
nmap -p 22 <IP_СЕРВЕРА>  # Должен быть filtered

# Проверить что 80, 443 открыты
nmap -p 80,443 <IP_СЕРВЕРА>
```

---

### Шаг 7: fail2ban

**Зачем:** Автоматическая блокировка IP после неудачных попыток входа. Debian 13 использует nftables-бэкенд по умолчанию.

```bash
cat > /etc/fail2ban/jail.local << 'EOF'
# =============================================================================
# fail2ban — fancai production server
# Debian 13 / nftables backend
# =============================================================================

[DEFAULT]
# --- Бэкенд: nftables (default на Debian 13) ---
banaction = nftables-multiport
banaction_allports = nftables-allports

# --- Базовые настройки ---
bantime = 1h
findtime = 10m
maxretry = 3

# --- Инкрементальный бан (fail2ban 1.x) ---
# Повторные нарушители получают экспоненциально растущий бан
bantime.increment = true
bantime.factor = 24
bantime.maxtime = 5w

# --- Не банить свои IP ---
ignoreip = 127.0.0.1/8 ::1

# =============================================================================
# SSH jail (основной)
# =============================================================================
[sshd]
enabled = true
port = 2222
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600

# =============================================================================
# SSH aggressive (для сканеров)
# =============================================================================
[sshd-aggressive]
enabled = true
port = 2222
filter = sshd[mode=aggressive]
logpath = /var/log/auth.log
maxretry = 1
bantime = 86400
findtime = 86400
EOF

# Перезапустить fail2ban
systemctl enable fail2ban
systemctl restart fail2ban
```

**Проверка:**

```bash
# Статус
fail2ban-client status
fail2ban-client status sshd

# Проверить что nftables-бэкенд работает
nft list ruleset | grep f2b

# Посмотреть логи
journalctl -u fail2ban -n 20
```

---

### Шаг 8: Sysctl — ядро и сеть

**Зачем:** Оптимизация ядра для PostgreSQL + Redis + Docker + высокопроизводительной сети.

```bash
cat > /etc/sysctl.d/99-fancai.conf << 'EOF'
# =============================================================================
# Sysctl — fancai production server
# Debian 13 / Linux 6.12 / 32 GB RAM / 12 vCPU / NVMe
# =============================================================================

# ==========================
# СЕТЬ
# ==========================

# BBR v3 congestion control — до 25x лучше CUBIC на ядре 6.12
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr

# Connection backlog (для PostgreSQL, Redis, Caddy)
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.core.netdev_max_backlog = 65535

# Ephemeral ports — расширенный диапазон
net.ipv4.ip_local_port_range = 1024 65535

# Reuse TIME-WAIT сокетов (безопасно для серверов)
net.ipv4.tcp_tw_reuse = 1

# Ускоренное закрытие соединений
net.ipv4.tcp_fin_timeout = 15

# TCP keepalive (для PostgreSQL + Redis persistent connections)
net.ipv4.tcp_keepalive_time = 600
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 5

# TCP buffer sizes (для высокопропускных соединений)
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216

# TCP performance
net.ipv4.tcp_window_scaling = 1
net.ipv4.tcp_timestamps = 1
net.ipv4.tcp_sack = 1
net.ipv4.tcp_no_metrics_save = 1
net.ipv4.tcp_slow_start_after_idle = 0

# IP forwarding (ОБЯЗАТЕЛЬНО для Docker)
net.ipv4.ip_forward = 1

# ==========================
# БЕЗОПАСНОСТЬ СЕТИ
# ==========================

# Reverse path filtering (защита от IP spoofing)
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# Отключить ICMP redirects (MITM защита)
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0

# Отключить source routing
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0

# SYN cookies (защита от SYN flood)
net.ipv4.tcp_syncookies = 1

# Игнорировать ICMP broadcast
net.ipv4.icmp_echo_ignore_broadcasts = 1

# Логировать martian пакеты
net.ipv4.conf.all.log_martians = 1

# ==========================
# ПАМЯТЬ
# ==========================

# Overcommit: 1 = всегда разрешать (НЕОБХОДИМО для Redis background saves через fork)
# Примечание: PostgreSQL предпочитает 2, но Redis упадёт без 1.
# Поскольку оба в Docker-контейнерах, 1 — безопасный компромисс.
vm.overcommit_memory = 1

# Swappiness: 10 = минимальный swap, но не 0 (оставить safety net)
vm.swappiness = 10

# Dirty pages — оптимизация записи для PostgreSQL
# Начинать сброс при 5% грязных страниц, принудительно при 15%
vm.dirty_background_ratio = 5
vm.dirty_ratio = 15
vm.dirty_expire_centisecs = 3000
vm.dirty_writeback_centisecs = 500

# ==========================
# HUGE PAGES (для PostgreSQL shared_buffers = 8 GB)
# ==========================
# Расчёт: 8 GB / 2 MB (размер huge page на x86_64) = 4096 + 10% overhead = 4500
# Зарезервировано при загрузке: 4500 × 2 MB = ~8.8 GB
vm.nr_hugepages = 4500

# ==========================
# FILE DESCRIPTORS
# ==========================
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
EOF

# Применить
sysctl --system
```

**Проверка:**

```bash
# Проверить ключевые параметры
sysctl net.ipv4.tcp_congestion_control  # bbr
sysctl vm.overcommit_memory              # 1
sysctl vm.swappiness                     # 10
sysctl vm.nr_hugepages                   # 4500
sysctl net.core.somaxconn                # 65535
sysctl net.ipv4.ip_forward               # 1

# Проверить huge pages
grep HugePages /proc/meminfo
# HugePages_Total: 4500
# HugePages_Free:  4500 (до запуска PostgreSQL)
```

---

### Шаг 9: Отключить Transparent Huge Pages (THP)

**Зачем:** THP вызывает latency jitter и деградацию производительности PostgreSQL и Redis. Это документированная проблема — все production-гайды PostgreSQL и Redis рекомендуют отключать THP. Мы используем явные huge pages (vm.nr_hugepages) вместо THP.

```bash
# Создать systemd-юнит для отключения THP при загрузке
cat > /etc/systemd/system/disable-thp.service << 'EOF'
[Unit]
Description=Disable Transparent Huge Pages (THP)
DefaultDependencies=no
After=sysinit.target local-fs.target
Before=docker.service postgresql.service

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'echo never > /sys/kernel/mm/transparent_hugepage/enabled && echo never > /sys/kernel/mm/transparent_hugepage/defrag'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

# Включить и запустить
systemctl daemon-reload
systemctl enable --now disable-thp
```

**Проверка:**

```bash
cat /sys/kernel/mm/transparent_hugepage/enabled
# Должно быть: always madvise [never]

cat /sys/kernel/mm/transparent_hugepage/defrag
# Должно быть: always defer defer+madvise madvise [never]
```

---

### Шаг 10: Limits (ulimits)

**Зачем:** Docker-контейнеры наследуют лимиты хостовой системы. PostgreSQL и Redis нуждаются в высоких лимитах на файловые дескрипторы.

```bash
cat > /etc/security/limits.d/99-fancai.conf << 'EOF'
# =============================================================================
# Limits — fancai production server
# =============================================================================

# File descriptors для всех пользователей
* soft nofile 65536
* hard nofile 65536
root soft nofile 65536
root hard nofile 65536

# Process limits
* soft nproc 4096
* hard nproc 4096
root soft nproc 4096
root hard nproc 4096

# Memlock для huge pages (PostgreSQL)
* soft memlock unlimited
* hard memlock unlimited
EOF
```

**Проверка:**

```bash
# Перелогинитесь и проверьте
ulimit -n   # 65536
ulimit -u   # 4096
ulimit -l   # unlimited
```

---

### Шаг 11: Swap

**Зачем:** Safety net от OOM killer. С 32 GB RAM swap будет использоваться крайне редко (vm.swappiness=10), но OOM-killed PostgreSQL — это потеря данных, а swap — просто замедление.

```bash
# Проверить что swap ещё не создан
swapon --show

# Создать 4 GB swap file
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile

# Добавить в fstab для автозагрузки
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

**Проверка:**

```bash
swapon --show
# NAME      TYPE  SIZE USED PRIO
# /swapfile file    4G   0B   -2

free -h | grep Swap
# Swap:         4.0Gi       0B      4.0Gi
```

---

### Шаг 12: Automatic Security Updates

**Зачем:** Автоматическое применение security-патчей. Для production-сервера это обязательно.

```bash
# Настроить unattended-upgrades
cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'EOF'
Unattended-Upgrade::Allowed-Origins {
    "Debian:trixie";
    "Debian:trixie-security";
    "Debian:trixie-updates";
};

// Автоматически починить прерванный dpkg
Unattended-Upgrade::AutoFixInterruptedDpkg "true";

// Удалять неиспользуемые зависимости
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Remove-New-Unused-Dependencies "true";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";

// Автоперезагрузка при обновлении ядра — в 4:00 MSK
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";

// Уведомления
Unattended-Upgrade::Mail "admin@fancai.ru";
Unattended-Upgrade::MailReport "on-change";
EOF

# Включить периодические обновления
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
EOF

# needrestart — автоматический перезапуск сервисов (без интерактивного prompt)
sed -i "s/\$nrconf{restart} = 'i'/\$nrconf{restart} = 'a'/" /etc/needrestart/needrestart.conf
```

**Проверка:**

```bash
# Тестовый запуск (dry-run)
unattended-upgrade --dry-run --debug 2>&1 | tail -20

# Статус таймера
systemctl status apt-daily-upgrade.timer
```

---

### Шаг 13: Docker Engine — оптимизация

**Зачем:** Настройка Docker daemon для production: ротация логов, live-restore, ulimits, метрики.

```bash
# Docker уже установлен. Настраиваем daemon.json
cat > /etc/docker/daemon.json << 'EOF'
{
  "storage-driver": "overlay2",
  "data-root": "/var/lib/docker",

  "exec-opts": ["native.cgroupdriver=systemd"],

  "log-driver": "json-file",
  "log-opts": {
    "max-size": "20m",
    "max-file": "5",
    "compress": "true"
  },

  "live-restore": true,
  "shutdown-timeout": 30,

  "default-ulimits": {
    "nofile": { "Name": "nofile", "Hard": 65536, "Soft": 32768 },
    "nproc": { "Name": "nproc", "Hard": 4096, "Soft": 2048 }
  },

  "default-address-pools": [
    { "base": "172.80.0.0/16", "size": 24 }
  ],

  "metrics-addr": "127.0.0.1:9323",

  "features": {
    "buildkit": true
  },

  "icc": false
}
EOF

# Перезапустить Docker
systemctl restart docker
```

**Обоснование параметров:**

| Параметр                | Значение       | Почему                                                              |
| ----------------------- | -------------- | ------------------------------------------------------------------- |
| `storage-driver`        | overlay2       | Единственный production-ready вариант                               |
| `log-driver`            | json-file      | Совместим со всеми инструментами, `docker logs` работает            |
| `max-size/max-file`     | 20m/5          | Макс 100 MB логов на контейнер, предотвращает переполнение диска    |
| `compress`              | true           | Экономия 60-70% диска на логах                                      |
| `live-restore`          | true           | Контейнеры работают при рестарте daemon                             |
| `icc`                   | false          | Контейнеры не могут общаться напрямую, только через Docker networks |
| `metrics-addr`          | 127.0.0.1:9323 | Prometheus метрики, только для localhost                            |
| `default-address-pools` | 172.80.0.0/16  | Избежать конфликтов с корпоративными сетями                         |

**Проверка:**

```bash
docker info | grep -E "Storage Driver|Logging Driver|Cgroup Driver|Live Restore"
# Storage Driver: overlay2
# Logging Driver: json-file
# Cgroup Driver: systemd
# Live Restore Enabled: true

# Docker метрики для Prometheus
curl -s http://127.0.0.1:9323/metrics | head -5
```

---

### Шаг 14: Docker Compose — настройка автоочистки

**Зачем:** Docker накапливает неиспользуемые образы, контейнеры и volumes. Автоматическая очистка предотвращает заполнение диска.

```bash
# Docker Compose plugin уже установлен
docker compose version

# Создать systemd timer для еженедельной очистки
cat > /etc/systemd/system/docker-cleanup.service << 'EOF'
[Unit]
Description=Docker system cleanup (prune)
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/docker system prune -af --filter "until=168h"
ExecStartPost=/usr/bin/docker volume prune -f --filter "label!=keep"
EOF

cat > /etc/systemd/system/docker-cleanup.timer << 'EOF'
[Unit]
Description=Weekly Docker cleanup

[Timer]
OnCalendar=Sun 03:00
Persistent=true
RandomizedDelaySec=600

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now docker-cleanup.timer
```

**Проверка:**

```bash
systemctl list-timers | grep docker
docker system df
```

---

### Шаг 15: Структура директорий проекта

**Зачем:** Упорядоченная структура для деплоя, бэкапов, конфигов.

```bash
# Создать структуру
mkdir -p /opt/fancai/{caddy,postgres,redis,backups/{db,storage},logs,scripts}

# Установить владельца
chown -R deploy:deploy /opt/fancai

# Права
chmod 750 /opt/fancai
chmod 700 /opt/fancai/backups
```

**Итоговая структура:**

```
/opt/fancai/
├── docker-compose.yml          # Основной compose (копируется из репозитория)
├── docker-compose.monitoring.yml
├── .env                        # Production переменные
├── backend/                    # Код бэкенда (git clone)
├── frontend/                   # Код фронтенда (git clone)
├── caddy/
│   └── Caddyfile               # Конфигурация Caddy
├── postgres/
│   └── init/                   # SQL-скрипты инициализации
├── redis/
│   └── redis.conf              # Конфигурация Redis (опционально)
├── backups/
│   ├── db/                     # PostgreSQL дампы (pg_dump)
│   └── storage/                # Файлы пользователей
├── logs/                       # Внешние логи (опционально)
└── scripts/
    ├── backup-db.sh            # Скрипт бэкапа PostgreSQL
    └── restore-db.sh           # Скрипт восстановления
```

---

### Шаг 16: PostgreSQL конфигурация (32 GB)

**Зачем:** Текущая конфигурация оптимизирована под 4-8 GB. На 32 GB сервере нужно масштабировать shared_buffers (512 MB → 8 GB), effective_cache_size (1 GB → 24 GB) и т.д.

Конфигурация передаётся через docker-compose command (см. Часть 3).

**Ключевые изменения vs текущая конфигурация:**

| Параметр                 | Было (8 GB server) | Стало (32 GB server) | Улучшение                       |
| ------------------------ | ------------------ | -------------------- | ------------------------------- |
| shared_buffers           | 512 MB             | **8 GB**             | 16× больше кэшированных данных  |
| effective_cache_size     | 1 GB               | **24 GB**            | Значительно лучше query plans   |
| work_mem                 | 16 MB              | **64 MB**            | Меньше temp files на диске      |
| maintenance_work_mem     | 128 MB             | **2 GB**             | 15× быстрее VACUUM/INDEX        |
| wal_compression          | on (generic)       | **zstd**             | ~30% меньше WAL vs lz4          |
| wal_buffers              | 8 MB               | **64 MB**            | Лучше write throughput          |
| max_wal_size             | 1 GB               | **4 GB**             | Реже checkpoints                |
| max_parallel_workers     | default 8          | **12**               | Соответствует числу vCPU        |
| autovacuum_max_workers   | 2                  | **4**                | Быстрее обслуживание таблиц     |
| effective_io_concurrency | 200                | **200**              | Уже оптимально для NVMe         |
| huge_pages               | try                | **try**              | Работает с vm.nr_hugepages=4500 |

---

### Шаг 17: Redis конфигурация

**Зачем:** Смена eviction policy с `allkeys-lru` на `volatile-lru` — критично для защиты Celery broker данных.

**Проблема текущей конфигурации:**

- `allkeys-lru` удаляет ЛЮБЫЕ ключи (включая Celery task данные без TTL) при нехватке памяти
- Celery broker ключи в db=1 не имеют TTL → могут быть удалены → потеря задач

**Решение:** `volatile-lru` удаляет только ключи с TTL → Celery данные защищены. Требование: все cache-ключи ДОЛЖНЫ иметь TTL.

Полная конфигурация — см. Часть 3, раздел Redis.

---

### Шаг 18: Caddy v2 — reverse proxy

**Зачем:** Caddy заменяет nginx + certbot. Automatic HTTPS без конфигурации, HTTP/3 built-in, конфиг в 4 раза короче.

```bash
# Создать Caddyfile
cat > /opt/fancai/caddy/Caddyfile << 'CADDYEOF'
# =============================================================================
# Caddy v2 — fancai.ru production reverse proxy
# Auto-HTTPS via Let's Encrypt (автоматически, zero config)
# =============================================================================

{
    email admin@fancai.ru

    servers {
        protocols h1 h2 h3
    }
}

fancai.ru {
    # Сжатие: zstd предпочтительно, gzip fallback
    encode zstd gzip

    # Заголовки безопасности
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        -Server
    }

    # API → FastAPI backend
    handle /api/* {
        reverse_proxy backend:8000 {
            health_uri /health
            health_interval 30s
            health_timeout 5s

            transport http {
                dial_timeout 5s
                response_header_timeout 120s
            }

            header_up X-Real-IP {remote_host}
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto {scheme}
        }
    }

    # WebSocket
    handle /ws/* {
        reverse_proxy backend:8000
    }

    # Статические файлы (загруженные книги, обложки)
    handle /storage/* {
        root * /var/www
        file_server
    }

    # Frontend (React SPA) — всё остальное
    handle {
        reverse_proxy frontend:80
    }

    # Логирование
    log {
        output file /var/log/caddy/access.log {
            roll_size 50MiB
            roll_keep 5
            roll_keep_for 720h
        }
        format json
    }
}
CADDYEOF

chown deploy:deploy /opt/fancai/caddy/Caddyfile
```

---

### Шаг 19: Backup PostgreSQL

**Зачем:** Ежедневный бэкап БД с ротацией 7 дней.

```bash
cat > /opt/fancai/scripts/backup-db.sh << 'BACKUPEOF'
#!/bin/bash
# =============================================================================
# PostgreSQL Backup Script — fancai production
# Вызывается через systemd timer ежедневно в 03:00 MSK
# Ротация: 7 дней
# =============================================================================

set -euo pipefail

BACKUP_DIR="/opt/fancai/backups/db"
CONTAINER="bookreader_postgres"
DB_NAME="${DB_NAME:-fancai}"
DB_USER="${DB_USER:-fancai}"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${DATE}.sql.gz"
RETENTION_DAYS=7

# Проверить что контейнер запущен
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    echo "[ERROR] Container ${CONTAINER} is not running!" >&2
    exit 1
fi

# Создать бэкап (custom format для параллельного restore)
echo "[INFO] Starting backup: ${BACKUP_FILE}"
docker exec "${CONTAINER}" pg_dump \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    --format=custom \
    --compress=zstd:6 \
    --verbose \
    2>/dev/null | cat > "${BACKUP_FILE%.sql.gz}.dump"

BACKUP_FILE="${BACKUP_FILE%.sql.gz}.dump"

# Проверить размер
BACKUP_SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
echo "[INFO] Backup complete: ${BACKUP_FILE} (${BACKUP_SIZE})"

# Ротация — удалить бэкапы старше RETENTION_DAYS дней
DELETED=$(find "${BACKUP_DIR}" -name "*.dump" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
echo "[INFO] Deleted ${DELETED} old backups (older than ${RETENTION_DAYS} days)"

# Вывести текущие бэкапы
echo "[INFO] Current backups:"
ls -lh "${BACKUP_DIR}"/*.dump 2>/dev/null || echo "  (none)"
BACKUPEOF

chmod +x /opt/fancai/scripts/backup-db.sh
chown deploy:deploy /opt/fancai/scripts/backup-db.sh

# Systemd timer для ежедневного бэкапа
cat > /etc/systemd/system/fancai-backup.service << 'EOF'
[Unit]
Description=fancai PostgreSQL backup
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
User=deploy
EnvironmentFile=/opt/fancai/.env
ExecStart=/opt/fancai/scripts/backup-db.sh
StandardOutput=journal
StandardError=journal
EOF

cat > /etc/systemd/system/fancai-backup.timer << 'EOF'
[Unit]
Description=Daily fancai PostgreSQL backup at 03:00 MSK

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable fancai-backup.timer
```

**Проверка:**

```bash
# Тестовый запуск (после деплоя, когда PostgreSQL запущен)
/opt/fancai/scripts/backup-db.sh

# Проверить таймер
systemctl list-timers | grep fancai
```

---

### Шаг 20: Базовый мониторинг (до деплоя)

**Зачем:** Алерты о дисковом пространстве и памяти ДО установки Netdata/Prometheus.

```bash
cat > /opt/fancai/scripts/health-check.sh << 'HEALTHEOF'
#!/bin/bash
# =============================================================================
# Простой health check — fancai production
# Проверяет: диск, память, Docker
# Вызывается через systemd timer каждые 5 минут
# =============================================================================

set -euo pipefail

ALERT_LOG="/var/log/fancai-alerts.log"
DISK_THRESHOLD=80
MEM_THRESHOLD=90

log_alert() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ALERT: $1" | tee -a "${ALERT_LOG}"
}

# --- Disk ---
DISK_USAGE=$(df / | awk 'NR==2 {gsub(/%/,""); print $5}')
if [ "${DISK_USAGE}" -ge "${DISK_THRESHOLD}" ]; then
    log_alert "Disk usage: ${DISK_USAGE}% (threshold: ${DISK_THRESHOLD}%)"
fi

# --- Memory ---
MEM_USAGE=$(free | awk '/Mem:/ {printf("%.0f", $3/$2 * 100)}')
if [ "${MEM_USAGE}" -ge "${MEM_THRESHOLD}" ]; then
    log_alert "Memory usage: ${MEM_USAGE}% (threshold: ${MEM_THRESHOLD}%)"
fi

# --- Swap (alert if any significant usage) ---
SWAP_USED=$(free -m | awk '/Swap:/ {print $3}')
if [ "${SWAP_USED}" -gt 512 ]; then
    log_alert "Swap usage: ${SWAP_USED} MB (>512 MB — investigate memory pressure)"
fi

# --- Docker daemon ---
if ! systemctl is-active --quiet docker; then
    log_alert "Docker daemon is NOT running!"
fi

# --- Docker containers (если деплой уже сделан) ---
if docker ps --format '{{.Names}}' | grep -q bookreader; then
    UNHEALTHY=$(docker ps --filter "health=unhealthy" --format "{{.Names}}" | grep bookreader || true)
    if [ -n "${UNHEALTHY}" ]; then
        log_alert "Unhealthy containers: ${UNHEALTHY}"
    fi

    EXITED=$(docker ps -a --filter "status=exited" --format "{{.Names}}" | grep bookreader || true)
    if [ -n "${EXITED}" ]; then
        log_alert "Exited containers: ${EXITED}"
    fi
fi
HEALTHEOF

chmod +x /opt/fancai/scripts/health-check.sh
chown deploy:deploy /opt/fancai/scripts/health-check.sh

# Systemd timer — каждые 5 минут
cat > /etc/systemd/system/fancai-health.service << 'EOF'
[Unit]
Description=fancai health check

[Service]
Type=oneshot
ExecStart=/opt/fancai/scripts/health-check.sh
StandardOutput=journal
StandardError=journal
EOF

cat > /etc/systemd/system/fancai-health.timer << 'EOF'
[Unit]
Description=fancai health check every 5 minutes

[Timer]
OnCalendar=*:0/5
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now fancai-health.timer

# Logrotate для алертов
cat > /etc/logrotate.d/fancai-alerts << 'EOF'
/var/log/fancai-alerts.log {
    weekly
    rotate 4
    compress
    missingok
    notifempty
}
EOF
```

**Проверка:**

```bash
/opt/fancai/scripts/health-check.sh
systemctl list-timers | grep fancai
```

---

## Часть 3: Конфигурационные файлы

### 3.1. /etc/ssh/sshd_config.d/hardening.conf

> См. Шаг 5 выше — полный файл уже приведён.

---

### 3.2. /etc/nftables.conf

> См. Шаг 6 выше — полный файл уже приведён.

---

### 3.3. /etc/fail2ban/jail.local

> См. Шаг 7 выше — полный файл уже приведён.

---

### 3.4. /etc/docker/daemon.json

> См. Шаг 13 выше — полный файл уже приведён.

---

### 3.5. /etc/sysctl.d/99-fancai.conf

> См. Шаг 8 выше — полный файл уже приведён.

---

### 3.6. /etc/security/limits.d/99-fancai.conf

> См. Шаг 10 выше — полный файл уже приведён.

---

### 3.7. docker-compose.yml (production, 32 GB)

```yaml
# =============================================================================
# Production Docker Compose — fancai.ru
# Server: 32 GB RAM, 12 vCPU, NVMe SSD
# =============================================================================

services:
  # --- Caddy Reverse Proxy (auto-HTTPS) ---
  caddy:
    image: caddy:2-alpine
    container_name: bookreader_caddy
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp" # HTTP/3 (QUIC)
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
      - ./backend/storage:/var/www/storage:ro
      - caddy_logs:/var/log/caddy
    restart: unless-stopped
    networks:
      - bookreader_network
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 256M
        reservations:
          cpus: "0.2"
          memory: 128M
    healthcheck:
      test:
        [
          "CMD",
          "wget",
          "--no-verbose",
          "--tries=1",
          "--spider",
          "http://localhost:80/",
        ]
      interval: 30s
      timeout: 10s
      retries: 3

  # --- Frontend (React SPA → nginx static) ---
  frontend:
    image: bookreader-frontend:prod
    build:
      context: ./frontend
      dockerfile: Dockerfile.prod
      args:
        - VITE_API_URL=https://fancai.ru/api/v1
        - VITE_WS_URL=wss://fancai.ru/ws
        - VITE_APP_NAME=fancai
    container_name: bookreader_frontend
    restart: unless-stopped
    networks:
      - bookreader_network
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256M
        reservations:
          cpus: "0.1"
          memory: 128M
    healthcheck:
      test:
        [
          "CMD",
          "wget",
          "--no-verbose",
          "--tries=1",
          "--spider",
          "http://127.0.0.1:80/",
        ]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

  # --- Backend API (FastAPI + Gunicorn) ---
  backend:
    image: bookreader-backend:prod
    build:
      context: ./backend
      dockerfile: Dockerfile.lite.prod
    container_name: bookreader_backend
    environment:
      # Database
      - DATABASE_URL=postgresql+asyncpg://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}
      # Redis
      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0
      - CELERY_BROKER_URL=redis://:${REDIS_PASSWORD}@redis:6379/1
      - CELERY_RESULT_BACKEND=redis://:${REDIS_PASSWORD}@redis:6379/2
      # Security
      - SECRET_KEY=${SECRET_KEY}
      - JWT_SECRET_KEY=${JWT_SECRET_KEY}
      - JWT_ACCESS_TOKEN_EXPIRE_MINUTES=${JWT_ACCESS_TOKEN_EXPIRE_MINUTES:-30}
      - JWT_REFRESH_TOKEN_EXPIRE_DAYS=${JWT_REFRESH_TOKEN_EXPIRE_DAYS:-7}
      # Environment
      - DEBUG=false
      - ENVIRONMENT=production
      - LOG_LEVEL=${LOG_LEVEL:-INFO}
      # CORS
      - CORS_ORIGINS=https://fancai.ru
      - ALLOWED_HOSTS=fancai.ru,localhost,127.0.0.1
      # AI (LangExtract / Gemini)
      - USE_LANGEXTRACT_PRIMARY=true
      - LANGEXTRACT_API_KEY=${LANGEXTRACT_API_KEY}
      - LANGEXTRACT_MODEL=${LANGEXTRACT_MODEL:-gemini-3-flash-preview}
      - USE_ADVANCED_PARSER=false
      - USE_NLP_PROCESSORS=false
      # Images
      - POLLINATIONS_ENABLED=${POLLINATIONS_ENABLED:-true}
      # VAPID (PWA push)
      - VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY:-}
      - VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY:-}
      - VAPID_SUBJECT=${VAPID_SUBJECT:-mailto:admin@fancai.ru}
      # Performance
      - WORKERS_COUNT=${WORKERS_COUNT:-4}
      - MAX_FILE_SIZE=${MAX_FILE_SIZE:-52428800}
      # Hawk monitoring
      - HAWK_TOKEN=${HAWK_TOKEN:-}
    volumes:
      - ./backend/storage:/app/storage
      - /dev/shm:/dev/shm
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - bookreader_network
    healthcheck:
      test: ["CMD", "python", "/app/healthcheck.py"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    deploy:
      resources:
        limits:
          cpus: "3.0"
          memory: 3G
        reservations:
          cpus: "1.0"
          memory: 1G

  # --- Celery Worker ---
  celery-worker:
    image: bookreader-backend:prod
    container_name: bookreader_celery
    command: >
      celery -A app.core.celery_app worker
      --loglevel=${LOG_LEVEL:-info}
      --concurrency=${CELERY_CONCURRENCY:-4}
      --max-tasks-per-child=100
      --max-memory-per-child=512000
      --prefetch-multiplier=1
    environment:
      - DATABASE_URL=postgresql+asyncpg://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}
      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0
      - CELERY_BROKER_URL=redis://:${REDIS_PASSWORD}@redis:6379/1
      - CELERY_RESULT_BACKEND=redis://:${REDIS_PASSWORD}@redis:6379/2
      - SECRET_KEY=${SECRET_KEY}
      - ENVIRONMENT=production
      - LOG_LEVEL=${LOG_LEVEL:-INFO}
      - USE_LANGEXTRACT_PRIMARY=true
      - LANGEXTRACT_API_KEY=${LANGEXTRACT_API_KEY}
      - LANGEXTRACT_MODEL=${LANGEXTRACT_MODEL:-gemini-3-flash-preview}
      - USE_ADVANCED_PARSER=false
      - USE_NLP_PROCESSORS=false
      - POLLINATIONS_ENABLED=${POLLINATIONS_ENABLED:-true}
      - MAX_FILE_SIZE=${MAX_FILE_SIZE:-52428800}
      - VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY:-}
      - VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY:-}
      - VAPID_SUBJECT=${VAPID_SUBJECT:-mailto:admin@fancai.ru}
      - HAWK_TOKEN=${HAWK_TOKEN:-}
    volumes:
      - ./backend/storage:/app/storage
      - /dev/shm:/dev/shm
    depends_on:
      backend:
        condition: service_healthy
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - bookreader_network
    deploy:
      resources:
        limits:
          cpus: "3.0"
          memory: 2560M
        reservations:
          cpus: "0.5"
          memory: 768M

  # --- Celery Beat ---
  celery-beat:
    image: bookreader-backend:prod
    container_name: bookreader_beat
    command: >
      celery -A app.core.celery_app beat
      --loglevel=${LOG_LEVEL:-info}
      --schedule=/tmp/celerybeat-schedule
      --pidfile=/tmp/celerybeat.pid
    environment:
      - DATABASE_URL=postgresql+asyncpg://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}
      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0
      - CELERY_BROKER_URL=redis://:${REDIS_PASSWORD}@redis:6379/1
      - CELERY_RESULT_BACKEND=redis://:${REDIS_PASSWORD}@redis:6379/2
      - SECRET_KEY=${SECRET_KEY}
      - ENVIRONMENT=production
      - LOG_LEVEL=${LOG_LEVEL:-INFO}
    volumes:
      - beat_schedule:/tmp
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - bookreader_network
    deploy:
      resources:
        limits:
          cpus: "0.3"
          memory: 256M
        reservations:
          cpus: "0.1"
          memory: 128M

  # --- PostgreSQL 17 (оптимизирован под 32 GB) ---
  postgres:
    image: postgres:17-alpine
    container_name: bookreader_postgres
    environment:
      - POSTGRES_DB=${DB_NAME}
      - POSTGRES_USER=${DB_USER}
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C
      - PGDATA=/var/lib/postgresql/data/pgdata
    command: >
      postgres
      -c shared_buffers=8GB
      -c effective_cache_size=24GB
      -c work_mem=64MB
      -c maintenance_work_mem=2GB
      -c huge_pages=try
      -c max_connections=100
      -c wal_compression=zstd
      -c wal_buffers=64MB
      -c checkpoint_completion_target=0.9
      -c max_wal_size=4GB
      -c min_wal_size=1GB
      -c random_page_cost=1.1
      -c effective_io_concurrency=200
      -c maintenance_io_concurrency=200
      -c max_parallel_workers=12
      -c max_parallel_workers_per_gather=4
      -c max_parallel_maintenance_workers=4
      -c max_worker_processes=16
      -c default_statistics_target=200
      -c enable_partitionwise_join=on
      -c enable_partitionwise_aggregate=on
      -c autovacuum_max_workers=4
      -c autovacuum_vacuum_scale_factor=0.05
      -c autovacuum_analyze_scale_factor=0.025
      -c log_min_duration_statement=1000
      -c log_checkpoints=on
      -c log_lock_waits=on
      -c log_temp_files=0
      -c log_autovacuum_min_duration=0
      -c shared_preload_libraries=pg_stat_statements
      -c pg_stat_statements.max=1000
      -c pg_stat_statements.track=all
      -c default_text_search_config=pg_catalog.russian
      -c timezone=UTC
      -c temp_file_limit=2GB
      -c deadlock_timeout=1s
      -c track_activities=on
      -c track_counts=on
      -c track_io_timing=on
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./postgres/init:/docker-entrypoint-initdb.d:ro
    restart: unless-stopped
    networks:
      - bookreader_network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    deploy:
      resources:
        limits:
          cpus: "4.0"
          memory: 12G
        reservations:
          cpus: "1.0"
          memory: 8G

  # --- Redis 7.4 (оптимизирован, volatile-lru) ---
  redis:
    image: redis:7.4-alpine
    container_name: bookreader_redis
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD}
      --maxmemory 640mb
      --maxmemory-policy volatile-lru
      --appendonly yes
      --appendfsync everysec
      --aof-use-rdb-preamble yes
      --save "900 1"
      --save "300 10"
      --save "60 10000"
      --tcp-backlog 4096
      --tcp-keepalive 300
      --timeout 0
      --io-threads 2
      --io-threads-do-reads yes
      --lazyfree-lazy-eviction yes
      --lazyfree-lazy-expire yes
      --lazyfree-lazy-server-del yes
      --activedefrag yes
      --maxclients 1000
      --hz 10
      --dynamic-hz yes
    volumes:
      - redis_data:/data
    restart: unless-stopped
    networks:
      - bookreader_network
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 768M
        reservations:
          cpus: "0.3"
          memory: 512M

volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local
  beat_schedule:
    driver: local
  caddy_data:
    driver: local
  caddy_config:
    driver: local
  caddy_logs:
    driver: local

networks:
  bookreader_network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.80.0.0/24
    driver_opts:
      com.docker.network.bridge.name: br-fancai
```

**Распределение ресурсов (32 GB RAM):**

| Сервис              | CPU лимит | RAM лимит  | RAM резерв   | Комментарий                        |
| ------------------- | --------- | ---------- | ------------ | ---------------------------------- |
| PostgreSQL          | 4.0       | 12 GB      | 8 GB         | 8 GB shared_buffers + overhead     |
| Backend             | 3.0       | 3 GB       | 1 GB         | 4 Gunicorn workers                 |
| Celery Worker       | 3.0       | 2.5 GB     | 768 MB       | 4 concurrency, 512 MB/task         |
| Redis               | 1.0       | 768 MB     | 512 MB       | 640 MB maxmemory                   |
| Caddy               | 1.0       | 256 MB     | 128 MB       | Reverse proxy                      |
| Frontend            | 0.5       | 256 MB     | 128 MB       | Static files                       |
| Celery Beat         | 0.3       | 256 MB     | 128 MB       | Scheduler                          |
| **Итого**           | **12.8**  | **~19 GB** | **~10.7 GB** |                                    |
| **ОС + Huge Pages** | —         | **~13 GB** | —            | 8.8 GB huge pages + 4 GB swap + OS |

---

### 3.8. Шаблон .env

```bash
cat > /opt/fancai/.env.template << 'ENVEOF'
# =============================================================================
# fancai.ru — Production Environment Variables
# =============================================================================
# ВНИМАНИЕ: Скопируйте в .env и замените все <CHANGE_ME> на реальные значения!
# cp .env.template .env && vim .env

# --- Database ---
DB_NAME=fancai
DB_USER=fancai
DB_PASSWORD=<CHANGE_ME>

# --- Redis ---
REDIS_PASSWORD=<CHANGE_ME>

# --- Security ---
SECRET_KEY=<CHANGE_ME>
JWT_SECRET_KEY=<CHANGE_ME>
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=30
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7

# --- Domain ---
DOMAIN_NAME=fancai.ru
DOMAIN_URL=https://fancai.ru

# --- AI (LangExtract / Gemini) ---
LANGEXTRACT_API_KEY=<CHANGE_ME>
LANGEXTRACT_MODEL=gemini-3-flash-preview

# --- Images ---
POLLINATIONS_ENABLED=true

# --- Performance ---
WORKERS_COUNT=4
CELERY_CONCURRENCY=4
LOG_LEVEL=INFO
MAX_FILE_SIZE=52428800

# --- VAPID (PWA Push Notifications) ---
VAPID_PUBLIC_KEY=<CHANGE_ME>
VAPID_PRIVATE_KEY=<CHANGE_ME>
VAPID_SUBJECT=mailto:admin@fancai.ru

# --- Monitoring (Hawk Tracker) ---
HAWK_TOKEN=<CHANGE_ME>
ENVEOF

chown deploy:deploy /opt/fancai/.env.template
chmod 600 /opt/fancai/.env.template
```

**Генерация секретов:**

```bash
# SECRET_KEY
python3 -c "import secrets; print(secrets.token_urlsafe(64))"

# JWT_SECRET_KEY
python3 -c "import secrets; print(secrets.token_urlsafe(64))"

# DB_PASSWORD
python3 -c "import secrets; print(secrets.token_urlsafe(32))"

# REDIS_PASSWORD
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

---

### 3.9. Caddyfile

> См. Шаг 18 выше — полный файл уже приведён.

---

### 3.10. Скрипт бэкапа PostgreSQL

> См. Шаг 19 выше — полный файл уже приведён.

---

## Часть 4: Checklist верификации

Выполните все команды после завершения настройки для проверки каждого аспекта.

### Безопасность

```bash
# SSH — key-only auth, порт 2222, root отключён
ssh -p 2222 -o PubkeyAuthentication=no deploy@fancai.ru  # Должно: Permission denied
ssh -p 2222 root@fancai.ru                                # Должно: Permission denied
sshd -t                                                    # Должно: без ошибок

# Firewall
nft list ruleset | grep -c "dport 2222"  # Должно: 1
nft list ruleset | grep -c "dport { 80, 443 }"  # Должно: 1

# fail2ban
fail2ban-client status sshd  # Должно: показать jail
nft list ruleset | grep f2b  # Должно: показать цепочку f2b

# Автоматические обновления
systemctl is-active apt-daily-upgrade.timer  # active
unattended-upgrade --dry-run 2>&1 | grep -c "Allowed origins"  # >= 1
```

### Система

```bash
# Hostname и время
hostname                     # fancai-prod
timedatectl | grep "synchronized"  # yes
date                          # Moscow time

# Chrony
chronyc tracking | grep "Leap status"  # Normal

# Sysctl
sysctl net.ipv4.tcp_congestion_control  # bbr
sysctl vm.overcommit_memory              # 1
sysctl vm.swappiness                     # 10
sysctl vm.nr_hugepages                   # 4500
sysctl net.ipv4.ip_forward               # 1
sysctl net.core.somaxconn                # 65535

# THP отключён
cat /sys/kernel/mm/transparent_hugepage/enabled  # [never]

# Huge pages
grep HugePages_Total /proc/meminfo  # 4500

# Swap
swapon --show  # 4G

# Limits
ulimit -n  # 65536

# Локали
locale -a | grep en_US  # en_US.utf8
locale -a | grep ru_RU  # ru_RU.utf8
```

### Docker

```bash
# Daemon
docker info | grep "Storage Driver"    # overlay2
docker info | grep "Logging Driver"    # json-file
docker info | grep "Cgroup Driver"     # systemd
docker info | grep "Live Restore"      # true
docker compose version                  # 2.x

# Метрики
curl -s http://127.0.0.1:9323/metrics | head -3

# Автоочистка
systemctl is-active docker-cleanup.timer  # active
```

### Подготовка к деплою

```bash
# Директории
ls -la /opt/fancai/
ls -la /opt/fancai/caddy/Caddyfile
ls -la /opt/fancai/backups/

# .env (после заполнения)
test -f /opt/fancai/.env && echo "OK" || echo "MISSING!"

# DNS
dig fancai.ru +short  # Должно: IP сервера
curl -I http://fancai.ru 2>/dev/null | head -3  # После деплоя

# Таймеры
systemctl list-timers | grep fancai
# fancai-backup.timer  — ежедневно 03:00
# fancai-health.timer  — каждые 5 минут
```

---

## Часть 5: Потенциальные проблемы

### 1. SSH lockout

**Симптом:** Не можете подключиться после настройки SSH.
**Причина:** Порт 2222 не открыт в firewall, или ключ не скопирован.
**Решение:**

- Подключитесь через VNC-консоль хостера (netcup Control Panel)
- Проверьте: `nft list ruleset | grep 2222`, `cat /home/deploy/.ssh/authorized_keys`
- Откатите: `rm /etc/ssh/sshd_config.d/hardening.conf && systemctl restart sshd`

### 2. Docker networking сломалось после nftables

**Симптом:** Контейнеры не могут общаться между собой или с интернетом.
**Причина:** Использовали `flush ruleset` вместо `flush table inet filter`.
**Решение:**

```bash
systemctl restart docker  # Docker пересоздаст свои правила
nft -f /etc/nftables.conf  # Перезагрузить наши правила
```

### 3. PostgreSQL не стартует с huge_pages

**Симптом:** `FATAL: could not map anonymous shared memory: Cannot allocate memory`
**Причина:** vm.nr_hugepages слишком мало или не применился.
**Решение:**

```bash
# Проверить
grep HugePages /proc/meminfo
# Если HugePages_Total: 0 — sysctl не применился

sysctl -w vm.nr_hugepages=4500
# Если не хватает — уменьшить shared_buffers или увеличить nr_hugepages

# Временный workaround: huge_pages=off в PostgreSQL
```

### 4. Redis OOM при background save

**Симптом:** `Can't save in background: fork: Cannot allocate memory`
**Причина:** vm.overcommit_memory != 1
**Решение:**

```bash
sysctl vm.overcommit_memory  # Должно: 1
# Если нет:
sysctl -w vm.overcommit_memory=1
echo "vm.overcommit_memory = 1" >> /etc/sysctl.d/99-fancai.conf
```

### 5. Caddy не получает HTTPS-сертификат

**Симптом:** ERR_SSL_PROTOCOL_ERROR или timeout на порту 443.
**Причина:** DNS не указывает на сервер, или порт 80 заблокирован (нужен для ACME challenge).
**Решение:**

```bash
# Проверить DNS
dig fancai.ru +short  # Должен быть IP сервера

# Проверить порт 80
nft list ruleset | grep "dport { 80, 443 }"

# Логи Caddy
docker logs bookreader_caddy 2>&1 | grep -i "tls\|acme\|certificate"
```

### 6. Celery задачи теряются (после смены eviction policy)

**Симптом:** Задачи исчезают, Celery не обрабатывает их.
**Причина:** Cache-ключи без TTL при volatile-lru → Redis выдаёт OOM ошибки когда всё заполнено.
**Решение:** Убедиться, что ВСЕ cache-ключи (не Celery) имеют TTL. Проверить:

```bash
# В Redis CLI
docker exec -it bookreader_redis redis-cli -a <password>
# Найти ключи без TTL (кроме Celery)
# Пример:
# TTL mykey  # -1 означает нет TTL — добавить!
```

### 7. Disk full (100 GB NVMe)

**Симптом:** Контейнеры перестают работать, логи "No space left on device".
**Причина:** Docker образы/логи, PostgreSQL WAL, бэкапы.
**Решение:**

```bash
# Что занимает место
ncdu /
docker system df

# Очистка
docker system prune -af --filter "until=72h"
docker volume prune -f

# Проверить WAL
docker exec bookreader_postgres ls -lh /var/lib/postgresql/data/pgdata/pg_wal/
```

### 8. Высокий swap usage

**Симптом:** Swap usage > 1 GB, система тормозит.
**Причина:** Сумма контейнеров превышает доступную RAM (после huge pages).
**Решение:**

- Уменьшить resource limits контейнеров
- Или уменьшить vm.nr_hugepages / shared_buffers
- Формула: 32 GB - 8.8 GB (huge pages) - 4 GB (swap file) = ~19 GB для контейнеров + ОС

---

## Приложение A: Порядок выполнения (Quick Reference)

```
1.  Базовые пакеты (apt install)
2.  Hostname + timezone + locale
3.  Chrony (NTP)
4.  Пользователь deploy + SSH ключ
5.  SSH hardening ← ПРОВЕРИТЬ ПОДКЛЮЧЕНИЕ ПЕРЕД РЕСТАРТОМ!
6.  nftables firewall
7.  fail2ban
8.  sysctl (ядро + сеть)
9.  Отключить THP
10. limits.conf
11. Swap 4 GB
12. Unattended upgrades
13. Docker daemon.json
14. Docker cleanup timer
15. Структура /opt/fancai/
16. PostgreSQL config (в compose)
17. Redis config (в compose)
18. Caddy + Caddyfile
19. Backup script + timer
20. Health check script + timer
21. .env заполнить
22. docker compose up -d
23. Проверить checklist (Часть 4)
```

---

## Приложение B: Рекомендации на будущее

1. **Netdata v2** — установить после первого деплоя для детального мониторинга CPU/RAM/диск/сеть
2. **Uptime Kuma v2** — мониторинг uptime + алерты в Telegram
3. **Dozzle v9** — веб-интерфейс для Docker-логов (удобнее `docker logs`)
4. **PgBouncer** — connection pooling, если max_connections станет узким местом
5. **Бэкап на S3** — rclone + S3-совместимое хранилище для off-site бэкапов
6. **Logrotate для Docker** — уже настроен через daemon.json (max-size/max-file)
7. **fail2ban + Telegram** — уведомления о банах через Telegram Bot API

---

## Источники

### Debian 13

- [Debian 13 Release Notes](https://www.debian.org/releases/trixie/release-notes/)
- [Debian 13.3 Announcement](https://www.debian.org/News/2026/20260110)
- [What's New in Debian 13](https://www.debian.org/releases/trixie/release-notes/whats-new.en.html)

### Security

- [SSH Hardening Guide 2026](https://www.sshaudit.com/hardening_guides.html)
- [OpenSSH Post-Quantum KEM](https://www.openssh.org/pq.html)
- [CIS Benchmark Debian](https://www.cisecurity.org/benchmark/debian_linux)
- [fail2ban + nftables](https://pieterbakker.com/secure-debian-12-with-fail2ban-and-nftables/)

### Docker

- [Docker nftables](https://docs.docker.com/engine/network/firewall-nftables/)
- [Docker daemon.json Guide](https://docs.docker.com/reference/cli/dockerd/#daemon-configuration-file)
- [Docker Logging Drivers](https://docs.docker.com/engine/logging/configure/)

### PostgreSQL

- [PostgreSQL Wiki: Tuning](https://wiki.postgresql.org/wiki/Tuning_Your_PostgreSQL_Server)
- [PGTune Calculator](https://pgtune.leopard.in.ua/)
- [Huge Pages + PostgreSQL](https://www.cybertec-postgresql.com/en/huge-pages-postgresql/)

### Redis

- [Redis Persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Redis Key Eviction](https://redis.io/docs/latest/develop/reference/eviction/)
- [Redis 7.4 What's New](https://redis.io/docs/latest/develop/whats-new/7-4/)

### Caddy

- [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https)

### Network / Kernel

- [BBR Congestion Control](https://fasterdata.es.net/host-tuning/linux/recent-tcp-enhancements/bbr-tcp/)
- [PostgreSQL Kernel Tuning](https://www.percona.com/blog/tune-linux-kernel-parameters-for-postgresql-optimization/)
