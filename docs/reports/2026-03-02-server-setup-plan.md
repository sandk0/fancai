# План настройки VPS-сервера для fancai.ru

**Дата:** 2026-03-02
**Источники:** `2026-03-01-vps-audit-pre-setup.md` + `2026-03-01-vps-setup-guide-debian13.md` + `2026-03-01-vps-benchmark-results.md`
**Автор:** Claude Code
**Аудит v2:** 2026-03-02 — глубокий аудит по 6 направлениям (SSH, PostgreSQL, Docker, ядро/память, Caddy/безопасность, Redis/бэкапы)

## Executive Summary

Сервер netcup VPS 4000 G12 (12 vCPU EPYC 9645, 32 GB DDR5, 1 TB NVMe) с Debian 13.3 (OpenSSH 10.0, Docker 29.2.1) в чистом заводском состоянии. Две критических проблемы: DNS указывает на старый IP, SSH полностью открыт (сканеры уже атакуют). План из 7 фаз с корректировками двух аудитов.

---

## Аудит v2: Сводка находок

Аудит v2 выявил **7 CRITICAL**, **10 HIGH**, **17 MEDIUM** проблем. Ниже — полный реестр с приоритетами.

### CRITICAL (исправить ДО деплоя)

| #   | Находка                                                                                                          | Фаза | Источник аудита    |
| --- | ---------------------------------------------------------------------------------------------------------------- | ---- | ------------------ |
| C1  | Docker `default-address-pools: 172.80.0.0/16` — это ПУБЛИЧНЫЙ IP-диапазон, не RFC 1918                           | 5    | Docker             |
| C2  | Celery игнорирует `CELERY_BROKER_URL` env — использует `REDIS_URL` (db 0) для всего                              | код  | Redis              |
| C3  | `allkeys-lru` + общий db 0 → Redis может удалить Celery-задачи                                                   | 6    | Redis              |
| C4  | `effective_cache_size=24GB` не указан, но подразумевается из guide — неверен для 12GB контейнера                 | 6    | PostgreSQL         |
| C5  | `max_wal_size` отсутствует в конфиге PG (дефолт 1GB слишком мал для 8GB shared_buffers)                          | 6    | PostgreSQL         |
| C6  | PG Docker `mem_limit: 12GB` + HugePages 9GB = 21GB возможного потребления (HugePages не учитываются в cgroup v2) | 6    | Ядро/память        |
| C7  | BBR модуль не загружен — `sysctl tcp_congestion_control=bbr` без `modprobe tcp_bbr` не работает                  | 3    | Бенчмарк/pre-audit |

### HIGH (исправить в первую неделю)

| #   | Находка                                                                                                 | Фаза | Источник аудита |
| --- | ------------------------------------------------------------------------------------------------------- | ---- | --------------- |
| H1  | `shared_buffers=8GB` = 66% от 12GB контейнера (рекомендуется 25-40%)                                    | 6    | PostgreSQL      |
| H2  | `effective_io_concurrency` отсутствует в конфиге PG (дефолт 1, должно быть 200 для NVMe)                | 6    | PostgreSQL      |
| H3  | `shutdown-timeout: 30` в daemon.json — при рестарте dockerd PG получает только 30 сек                   | 5    | Docker          |
| H4  | `MaxSessions 3` в SSH — сломает параллельные deploy-операции                                            | 1    | SSH             |
| H5  | Нет off-site бэкапа — pg_dump хранится на том же сервере                                                | 6    | Redis/бэкапы    |
| H6  | `redis.conf` (411 строк) не монтируется в compose — все настройки игнорируются                          | 6    | Redis           |
| H7  | Нет Redis-мониторинга — redis-exporter закомментирован в Prometheus                                     | 6    | Redis           |
| H8  | Docker NAT обходит nftables INPUT chain — правила для 80/443 неэффективны для Docker-трафика            | 1    | Caddy/безоп.    |
| H9  | Нет CSP-заголовка в Caddy — фронтенд-страницы не защищены (backend middleware покрывает только /api/\*) | 6    | Caddy/безоп.    |
| H10 | `io_concurrency=100` в плане противоречит бенчмарку (1.25M IOPS, рекомендация 200)                      | 6    | Бенчмарк        |

### MEDIUM (исправить в первый месяц)

| #   | Находка                                                                           | Фаза | Источник аудита |
| --- | --------------------------------------------------------------------------------- | ---- | --------------- |
| M1  | `AddressFamily inet` блокирует IPv6 SSH                                           | 1    | SSH             |
| M2  | Нет `AllowStreamLocalForwarding no` — Docker socket доступен через SSH forwarding | 1    | SSH             |
| M3  | `aes256-ctr` в Ciphers — не AEAD, лишний                                          | 1    | SSH             |
| M4  | `vm.swappiness=10` слишком высокий для БД-сервера                                 | 3    | Ядро/память     |
| M5  | Нет `nf_conntrack_max` — дефолт 65536 мал для Docker                              | 3    | Ядро/память     |
| M6  | `overlay2` deprecated в Docker 29 (работает, но планировать миграцию)             | 5    | Docker          |
| M7  | `metrics-addr: 127.0.0.1` недоступен из контейнера Prometheus                     | 5    | Docker          |
| M8  | Нет `userland-proxy: false`                                                       | 5    | Docker          |
| M9  | `work_mem=64MB` x 100 connections = до 6.4GB                                      | 6    | PostgreSQL      |
| M10 | Нет `max_parallel_workers`, `autovacuum_max_workers` в PG конфиге                 | 6    | PostgreSQL      |
| M11 | `X-Frame-Options: DENY` — должен быть `SAMEORIGIN` (epub.js)                      | 6    | Caddy/безоп.    |
| M12 | Нет www-редиректа в Caddyfile плана                                               | 6    | Caddy/безоп.    |
| M13 | SSH ratelimit только для IPv4 — IPv6 не ограничен                                 | 1    | Caddy/безоп.    |
| M14 | Нет `Cross-Origin-Opener-Policy` заголовка                                        | 6    | Caddy/безоп.    |
| M15 | Бэкап использует zlib вместо zstd                                                 | 6    | Redis/бэкапы    |
| M16 | 7-дневная ротация бэкапов — слишком мало                                          | 6    | Redis/бэкапы    |
| M17 | Нет `try_files` и upload-лимита в Caddyfile плана (есть в текущем repo Caddyfile) | 6    | Caddy/безоп.    |

---

## Корректировки из аудитов v1 + v2 (применить к setup guide)

| #   | Что в руководстве                | Коррекция                                            | Почему                                                 | Аудит |
| --- | -------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ | ----- |
| 1   | CPU: EPYC 9755                   | **EPYC 9645** (Turin, Zen 5c)                        | netcup G12 использует 9645, не 9755                    | v1    |
| 2   | Диск: 100 GB NVMe                | **1 TB NVMe** (VPS 4000 G12 стандарт)                | Подтверждено `lsblk`                                   | v1    |
| 3   | `effective_io_concurrency=200`   | **200** (оставить из guide)                          | Бенчмарк подтвердил 1.25M IOPS — 200 оправдан          | v2    |
| 4   | `maintenance_io_concurrency=200` | **200** (оставить из guide)                          | NVMe масштабируется линейно по depth                   | v2    |
| 5   | Docker log: `20m/5`              | **50m/3 + compress**                                 | Более надёжная ротация                                 | v1    |
| 6   | Нет PostgreSQL stop_signal       | **`stop_signal: SIGINT`** + `stop_grace_period: 60s` | Без этого Docker SIGKILL через 10 сек → WAL corruption | v1    |
| 7   | Нет cloud-init отключения        | **Отключить** (3 метода)                             | Может сбросить hostname/DNS при reboot                 | v1    |
| 8   | Нет IPv6+Docker фикса            | **Добавить `accept_ra=2`**                           | Docker ломает IPv6 Router Advertisements               | v1    |
| 9   | Нет nftables service override    | **Добавить**                                         | `nft flush ruleset` убивает Docker networking          | v1    |
| 10  | Нет needrestart защиты sshd      | **Добавить** `$nrconf{override_rc}{qr(^ssh)} = 0;`   | Обновление glibc может убить sshd                      | v1    |
| 11  | Нет blacklist для auto-upgrade   | **Blacklist: openssh-server, docker-ce**             | Автообновление может сломать доступ                    | v1    |
| 12  | Нет journald limits              | **`SystemMaxUse=500M`**                              | Логи могут заполнить диск                              | v1    |
| 13  | `shared_buffers=8GB`             | **4GB** (или увеличить контейнер до 16GB)            | 8GB = 66% контейнера, PG рекомендует 25-40%            | v2    |
| 14  | Нет `max_wal_size`               | **4GB**                                              | Дефолт 1GB мал при 4-8GB shared_buffers                | v2    |
| 15  | `172.80.0.0/16` в Docker pools   | **`10.200.0.0/16`**                                  | 172.80.0.0 — публичный IP, не RFC 1918                 | v2    |
| 16  | `MaxSessions 3` в SSH            | **5**                                                | 3 сломает параллельный deploy                          | v2    |
| 17  | `vm.swappiness=10`               | **1**                                                | БД-сервер не должен активно свопить                    | v2    |
| 18  | Нет `modprobe tcp_bbr`           | **Добавить** перед sysctl                            | Модуль BBR не загружен по умолчанию                    | v2    |
| 19  | `shutdown-timeout: 30`           | **90**                                               | PG нужно 60s, daemon должен ждать дольше               | v2    |
| 20  | PG Docker `mem_limit: 12GB`      | **4-5GB** (HugePages вне cgroup)                     | 12GB cgroup + 9GB HP = 21GB, перерасход                | v2    |
| 21  | `X-Frame-Options: DENY`          | **SAMEORIGIN**                                       | epub.js использует iframe                              | v2    |
| 22  | `allkeys-lru` в Redis            | **`volatile-lru`** + TTL на всех cache-ключах        | allkeys-lru может удалить Celery-данные                | v2    |

---

## Фаза 0: Предусловия (ДО подключения к серверу)

### 0.1. Обновить DNS

**Статус:** DNS fancai.ru → `77.246.106.109` (старый IP). Caddy не получит SSL-сертификат.

```
Действие: Обновить A-запись fancai.ru → <IP нового сервера>
Где: Панель управления DNS-хостинга
TTL: Установить 300 (5 мин) на время миграции
Проверка: dig fancai.ru +short → должен показать новый IP
Ожидание: до 24-48 часов на пропагацию (обычно 15-60 минут)
```

### 0.2. Подготовить SSH-ключ на локальной машине

```bash
ssh-keygen -t ed25519 -a 100 -C "admin@fancai.ru" -f ~/.ssh/fancai_deploy
```

### 0.3. Подготовить SSH config (аудит v2)

```bash
cat >> ~/.ssh/config << 'EOF'
Host fancai
    HostName <IP>
    Port 2222
    User deploy
    IdentityFile ~/.ssh/fancai_deploy
EOF
```

---

## Фаза 1: Безопасность [КРИТИЧНО — выполнить первым]

> Сервер уже атакуют — 8+ SSH-сканеров за 3.5 часа uptime. Каждый шаг проверять в отдельном терминале, не закрывая текущую root-сессию.

### 1.1. Базовые пакеты

```bash
apt update && apt install -y \
    sudo fail2ban chrony \
    unattended-upgrades needrestart locales \
    curl wget git vim htop iotop \
    net-tools dnsutils mtr jq tree ncdu rsync acl
```

### 1.2. Пользователь deploy

```bash
useradd -m -s /bin/bash -G sudo,docker deploy
passwd deploy

mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
```

Скопировать ключ с локальной машины:

```bash
# НА ЛОКАЛЬНОЙ МАШИНЕ:
ssh-copy-id -i ~/.ssh/fancai_deploy.pub root@<IP>
# или:
cat ~/.ssh/fancai_deploy.pub | ssh root@<IP> "cat >> /home/deploy/.ssh/authorized_keys"
```

На сервере:

```bash
chown -R deploy:deploy /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

**Проверка (в НОВОМ терминале):** `ssh -i ~/.ssh/fancai_deploy deploy@<IP>` → `sudo whoami` → `root`

### 1.3. SSH hardening (обновлено аудитом v2)

> Debian 13 Trixie поставляет **OpenSSH 10.0p1** — PQ-гибридные алгоритмы поддерживаются нативно.

```bash
cat > /etc/ssh/sshd_config.d/hardening.conf << 'EOF'
Port 2222
AddressFamily any
PermitRootLogin no
AllowUsers deploy
MaxAuthTries 3
MaxSessions 5
LoginGraceTime 30
PubkeyAuthentication yes
PasswordAuthentication no
PermitEmptyPasswords no
KbdInteractiveAuthentication no
UsePAM yes
KexAlgorithms mlkem768x25519-sha256,sntrup761x25519-sha512@openssh.com,curve25519-sha256,curve25519-sha256@libssh.org
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com
HostKey /etc/ssh/ssh_host_ed25519_key
X11Forwarding no
AllowTcpForwarding no
AllowAgentForwarding no
AllowStreamLocalForwarding no
GatewayPorts no
PermitTunnel no
HostbasedAuthentication no
IgnoreRhosts yes
ClientAliveInterval 300
ClientAliveCountMax 2
LogLevel VERBOSE
Banner /etc/ssh/banner.txt
EOF

cat > /etc/ssh/banner.txt << 'EOF'
*******************************************************************
*  Authorized access only. All activity is monitored and logged.  *
*******************************************************************
EOF

# Удалить неиспользуемый RSA HostKey (аудит v2)
rm -f /etc/ssh/ssh_host_rsa_key /etc/ssh/ssh_host_rsa_key.pub
```

**Изменения аудита v2 (4 изменения, 2 добавления vs v1):**

- `AddressFamily any` (было `inet`) — не блокировать IPv6
- `MaxSessions 5` (было `3`) — не ломать параллельный deploy
- `Ciphers` — убран `aes256-ctr` (не AEAD), только chacha20 + aes256-gcm
- Убран `HostKey rsa` — ed25519-only достаточен
- Добавлен `AllowStreamLocalForwarding no` — защита Docker socket
- Добавлен `GatewayPorts no` — defense-in-depth

**Порядок проверки (критично!):**

1. `sshd -t` — проверить синтаксис
2. В ОТДЕЛЬНОМ терминале: `ssh -p 2222 -i ~/.ssh/fancai_deploy deploy@<IP>`
3. Только после успеха: `systemctl restart sshd`
4. Подтвердить: `ss -tlnp | grep 2222`

### 1.4. nftables Firewall (обновлено аудитом v2)

> НЕ использовать `flush ruleset` — это сломает Docker networking!
> Docker NAT обходит INPUT chain — правила 80/443 здесь для хост-сервисов, Docker-трафик идёт через FORWARD.

```bash
cat > /etc/nftables.conf << 'EOF'
#!/usr/sbin/nft -f
flush table inet filter 2>/dev/null || true
delete table inet filter 2>/dev/null || true

table inet filter {
    set ssh_ratelimit_v4 {
        type ipv4_addr
        flags dynamic, timeout
        timeout 1m
    }

    set ssh_ratelimit_v6 {
        type ipv6_addr
        flags dynamic, timeout
        timeout 1m
    }

    chain input {
        type filter hook input priority 0; policy drop;
        ct state established,related accept
        ct state invalid drop
        iif "lo" accept
        ip protocol icmp limit rate 10/second burst 20 packets accept
        ip6 nexthdr icmpv6 limit rate 10/second burst 20 packets accept
        tcp dport 2222 ct state new \
            update @ssh_ratelimit_v4 { ip saddr limit rate 3/minute burst 5 packets } \
            accept
        tcp dport 2222 ct state new ip6 saddr != ::1 \
            update @ssh_ratelimit_v6 { ip6 saddr limit rate 3/minute burst 5 packets } \
            accept
        tcp dport { 80, 443 } accept
        udp dport 443 accept
        limit rate 5/minute burst 5 packets \
            log prefix "[nft-drop] " level info
    }

    chain forward {
        type filter hook forward priority 0; policy accept;
    }

    chain output {
        type filter hook output priority 0; policy accept;
    }
}
EOF

systemctl enable nftables
nft -f /etc/nftables.conf
```

**Изменения аудита v2:**

- Добавлен `ssh_ratelimit_v6` set для IPv6 SSH rate limiting (M13)
- Добавлено правило IPv6 SSH с отдельным rate limit set

**Аудит-корректировка v1 — nftables service override** (предотвращает уничтожение Docker сети при `systemctl stop nftables`):

```bash
mkdir -p /etc/systemd/system/nftables.service.d/
cat > /etc/systemd/system/nftables.service.d/override.conf << 'EOF'
[Service]
ExecStop=
ExecStop=/usr/sbin/nft delete table inet filter
EOF
systemctl daemon-reload
```

### 1.5. fail2ban

```bash
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
banaction = nftables-multiport
banaction_allports = nftables-allports
bantime = 1h
findtime = 10m
maxretry = 3
bantime.increment = true
bantime.factor = 24
bantime.maxtime = 5w
ignoreip = 127.0.0.1/8 ::1

[sshd]
enabled = true
port = 2222
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600

[sshd-aggressive]
enabled = true
port = 2222
filter = sshd[mode=aggressive]
logpath = /var/log/auth.log
maxretry = 1
bantime = 86400
findtime = 86400
EOF

systemctl enable --now fail2ban
```

### Проверка Фазы 1

```bash
ssh -p 2222 -o PubkeyAuthentication=no deploy@<IP>   # → Permission denied
ssh -p 2222 root@<IP>                                  # → Permission denied
fail2ban-client status sshd                            # → показать jail
nft list ruleset | grep "dport 2222"                  # → 2 правила (v4 + v6)
```

---

## Фаза 2: Система и ОС

### 2.1. Hostname, часовой пояс, локали

```bash
hostnamectl set-hostname fancai-prod
timedatectl set-timezone Europe/Moscow
sed -i 's/# en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen
sed -i 's/# ru_RU.UTF-8/ru_RU.UTF-8/' /etc/locale.gen
locale-gen
update-locale LANG=en_US.UTF-8
```

### 2.2. Отключить cloud-init (коррекция аудита v1)

```bash
systemctl disable cloud-init.target
touch /etc/cloud/cloud-init.disabled
echo "network: {config: disabled}" > /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg
```

### 2.3. Chrony (NTP)

```bash
cat > /etc/chrony/chrony.conf << 'EOF'
pool de.pool.ntp.org iburst maxsources 4
pool europe.pool.ntp.org iburst maxsources 2
server time.cloudflare.com iburst
driftfile /var/lib/chrony/drift
rtcsync
makestep 1 3
logdir /var/log/chrony
log measurements statistics tracking
bindcmdaddress 127.0.0.1
bindcmdaddress ::1
deny all
EOF

systemctl disable --now systemd-timesyncd 2>/dev/null || true
systemctl enable --now chrony
```

### 2.4. Fix IPv6 + Docker (коррекция аудита v1)

```bash
cat > /etc/sysctl.d/99-docker-ipv6.conf << 'EOF'
net.ipv6.conf.eth0.accept_ra = 2
EOF

cat > /etc/systemd/system/fix-ipv6-ra.service << 'EOF'
[Unit]
Description=Fix IPv6 RA after Docker
After=docker.service

[Service]
Type=oneshot
ExecStart=/sbin/sysctl -w net.ipv6.conf.eth0.accept_ra=2

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable fix-ipv6-ra
```

---

## Фаза 3: Оптимизация ядра (обновлено аудитом v2)

### 3.0. Загрузить модуль BBR (аудит v2 — C7)

> BBR модуль НЕ загружен по умолчанию на Debian 13. Без `modprobe` sysctl-настройка не работает.

```bash
modprobe tcp_bbr
echo "tcp_bbr" >> /etc/modules-load.d/bbr.conf
```

### 3.1. Sysctl (обновлено аудитом v2)

```bash
cat > /etc/sysctl.d/99-fancai.conf << 'EOF'
# === СЕТЬ ===
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.core.netdev_max_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_keepalive_time = 600
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 5
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.ipv4.tcp_window_scaling = 1
net.ipv4.tcp_timestamps = 1
net.ipv4.tcp_sack = 1
net.ipv4.tcp_no_metrics_save = 1
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_mtu_probing = 1
net.ipv4.ip_forward = 1

# === CONNTRACK (Docker) — аудит v2 ===
net.netfilter.nf_conntrack_max = 131072

# === БЕЗОПАСНОСТЬ СЕТИ ===
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv4.tcp_syncookies = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.conf.all.log_martians = 1

# === ПАМЯТЬ (обновлено аудитом v2) ===
vm.overcommit_memory = 1
vm.swappiness = 1
vm.dirty_background_ratio = 5
vm.dirty_ratio = 15
vm.dirty_expire_centisecs = 3000
vm.dirty_writeback_centisecs = 500

# === HUGE PAGES (PG shared_buffers 4 GB — обновлено аудитом v2) ===
vm.nr_hugepages = 2200

# === FILE DESCRIPTORS ===
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288

# === СТАБИЛЬНОСТЬ (аудит v2) ===
kernel.panic = 10
kernel.panic_on_oops = 1
kernel.pid_max = 4194304
EOF

sysctl --system
```

**Изменения аудита v2:**

- `vm.swappiness` 10 → **1** (БД-сервер не должен активно свопить)
- `vm.nr_hugepages` 4500 → **2200** (пересчитано под 4GB shared_buffers: 4096MB/2MB = 2048 + ~150 overhead)
- Добавлен `nf_conntrack_max = 131072` (Docker исчерпывает дефолт 65536)
- Добавлен `tcp_fastopen = 3` (снижает latency для повторных соединений через Caddy)
- Добавлен `tcp_mtu_probing = 1` (Path MTU Discovery)
- Добавлен `kernel.panic = 10` (авто-перезагрузка после kernel panic)
- Добавлен `kernel.panic_on_oops = 1` (чистый reboot при oops)
- Добавлен `kernel.pid_max = 4194304` (запас для Docker)

### 3.2. Отключить THP

```bash
cat > /etc/systemd/system/disable-thp.service << 'EOF'
[Unit]
Description=Disable Transparent Huge Pages (THP)
DefaultDependencies=no
After=sysinit.target local-fs.target
Before=docker.service

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'echo never > /sys/kernel/mm/transparent_hugepage/enabled && echo never > /sys/kernel/mm/transparent_hugepage/defrag'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now disable-thp
```

### 3.3. Limits

```bash
cat > /etc/security/limits.d/99-fancai.conf << 'EOF'
* soft nofile 65536
* hard nofile 65536
root soft nofile 65536
root hard nofile 65536
* soft nproc 4096
* hard nproc 4096
root soft nproc 4096
root hard nproc 4096
* soft memlock unlimited
* hard memlock unlimited
EOF
```

### 3.4. Swap (4 GB)

> `fallocate` безопасен на ext4 (Debian 13 default). На btrfs использовать `dd` вместо fallocate.

```bash
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### 3.5. fstab — добавить noatime (коррекция аудита v1)

Текущий mount: `relatime` → добавить `noatime` для снижения I/O. `discard` НЕ нужен — `fstrim.timer` уже работает.

### Проверка Фазы 3

```bash
sysctl net.ipv4.tcp_congestion_control     # bbr
sysctl vm.overcommit_memory                 # 1
sysctl vm.nr_hugepages                      # 2200
sysctl net.netfilter.nf_conntrack_max       # 131072
cat /sys/kernel/mm/transparent_hugepage/enabled  # [never]
swapon --show                                # 4G
ulimit -n                                    # 65536
```

---

## Фаза 4: Auto-updates и защита сервисов

### 4.1. unattended-upgrades

```bash
cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'EOF'
Unattended-Upgrade::Allowed-Origins {
    "Debian:trixie";
    "Debian:trixie-security";
    "Debian:trixie-updates";
};

Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Remove-New-Unused-Dependencies "true";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
Unattended-Upgrade::Mail "admin@fancai.ru";
Unattended-Upgrade::MailReport "on-change";

// Blacklist (коррекция аудита v1) — не обновлять автоматически
Unattended-Upgrade::Package-Blacklist {
    "openssh-server";
    "docker-ce";
    "docker-ce-cli";
    "containerd.io";
};
EOF

cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
EOF

sed -i "s/\$nrconf{restart} = 'i'/\$nrconf{restart} = 'a'/" /etc/needrestart/needrestart.conf
```

### 4.2. needrestart — защита sshd (коррекция аудита v1)

```bash
cat > /etc/needrestart/conf.d/no-sshd.conf << 'EOF'
$nrconf{override_rc}{qr(^ssh)} = 0;
EOF
```

### 4.3. journald limits (коррекция аудита v1)

```bash
mkdir -p /etc/systemd/journald.conf.d/
cat > /etc/systemd/journald.conf.d/limits.conf << 'EOF'
[Journal]
SystemMaxUse=500M
MaxRetentionSec=1month
Compress=yes
EOF
systemctl restart systemd-journald
```

---

## Фаза 5: Docker (обновлено аудитом v2)

### 5.1. daemon.json (обновлено аудитом v2)

```bash
cat > /etc/docker/daemon.json << 'EOF'
{
  "storage-driver": "overlay2",
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "3",
    "compress": "true"
  },
  "live-restore": true,
  "shutdown-timeout": 90,
  "default-ulimits": {
    "nofile": { "Name": "nofile", "Hard": 65536, "Soft": 32768 },
    "nproc": { "Name": "nproc", "Hard": 4096, "Soft": 2048 }
  },
  "default-address-pools": [
    { "base": "10.200.0.0/16", "size": 24 }
  ],
  "metrics-addr": "0.0.0.0:9323",
  "icc": false,
  "userland-proxy": false
}
EOF

systemctl restart docker
```

**Изменения аудита v2:**

- `shutdown-timeout` 30 → **90** (PG нужно 60s для graceful shutdown, daemon должен ждать дольше)
- `default-address-pools` `172.80.0.0/16` → **`10.200.0.0/16`** (172.80 — публичный IP, CRITICAL fix)
- `metrics-addr` `127.0.0.1:9323` → **`0.0.0.0:9323`** (доступ из контейнера Prometheus; ограничить nftables)
- Добавлен **`userland-proxy: false`** (лучшая производительность через kernel hairpin NAT)
- Убран `features.buildkit` (дефолт с Docker 23.0, redundant)

> **Примечание:** `metrics-addr: 0.0.0.0:9323` открывает метрики на всех интерфейсах. nftables INPUT chain автоматически блокирует внешний доступ (policy drop, порт 9323 не в allow-списке). Если Prometheus работает на хосте (не в контейнере), использовать `127.0.0.1:9323`.

### 5.2. Автоочистка Docker (timer)

```bash
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

### Проверка Фазы 5

```bash
docker info | grep -E "Storage Driver|Logging Driver|Live Restore"
# overlay2 / json-file / true
docker info | grep -i iptables   # проверить backend (nftables или legacy)
```

---

## Фаза 6: Структура проекта и конфигурация (обновлено аудитом v2)

### 6.1. Директории

```bash
mkdir -p /opt/fancai/{caddy,postgres/init,redis,backups/{db,storage},logs,scripts}
chown -R deploy:deploy /opt/fancai
chmod 750 /opt/fancai
chmod 700 /opt/fancai/backups
```

### 6.2. Caddyfile (обновлено аудитом v2)

```bash
cat > /opt/fancai/caddy/Caddyfile << 'EOF'
{
    email admin@fancai.ru
    servers {
        protocols h1 h2 h3
    }
}

fancai.ru {
    encode zstd gzip

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "SAMEORIGIN"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        Cross-Origin-Opener-Policy "same-origin"
        -Server
    }

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

    handle /ws/* {
        reverse_proxy backend:8000
    }

    handle /storage/* {
        root * /var/www
        header Cache-Control "public, max-age=86400, immutable"
        file_server
    }

    # Frontend SPA (catch-all — должен быть последним)
    handle {
        root * /var/www/frontend
        try_files {path} /index.html
        file_server
    }

    # Upload limit для EPUB
    @uploads {
        path /api/v1/books/upload /api/v1/books/*/upload
    }
    request_body @uploads {
        max_size 50MB
    }

    log {
        output file /var/log/caddy/access.log {
            roll_size 50MiB
            roll_keep 5
            roll_keep_for 720h
        }
        format json
    }
}

# www -> non-www редирект (аудит v2)
www.fancai.ru {
    redir https://fancai.ru{uri} permanent
}
EOF

chown deploy:deploy /opt/fancai/caddy/Caddyfile
```

**Изменения аудита v2:**

- `X-Frame-Options` `DENY` → **`SAMEORIGIN`** (epub.js использует iframe для рендеринга книг)
- Добавлен **`Cross-Origin-Opener-Policy "same-origin"`** (защита от Spectre-атак)
- Добавлен **www-редирект** (SEO, cookie scope)
- Добавлен **`try_files {path} /index.html`** (SPA routing — из текущего repo Caddyfile)
- Добавлен **upload limit 50MB** (из текущего repo Caddyfile)
- Добавлен **`Cache-Control`** для storage (иммутабельные сгенерированные изображения)
- Frontend: static files из `/var/www/frontend` вместо `reverse_proxy frontend:80` (из текущего repo)
- **Не добавлен COEP** — сломает Google Fonts и Pollinations AI images

### 6.3. docker-compose.yml (обновлено аудитом v2)

Ключевые корректировки PostgreSQL-сервиса:

```yaml
postgres:
  image: postgres:17.9-alpine
  shm_size: "6g" # аудит v2: нужен для shared_buffers в Docker
  stop_signal: SIGINT # аудит v1: Fast shutdown
  stop_grace_period: 60s # аудит v1: 60 сек до SIGKILL
  oom_score_adj: -900 # аудит v2: PG последним убивается OOM killer
  command: >
    postgres
    -c shared_buffers=4GB
    -c effective_cache_size=10GB
    -c work_mem=32MB
    -c maintenance_work_mem=1GB
    -c huge_pages=try
    -c wal_compression=zstd
    -c max_wal_size=4GB
    -c checkpoint_completion_target=0.9
    -c max_connections=50
    -c max_parallel_workers_per_gather=4
    -c max_parallel_workers=12
    -c max_parallel_maintenance_workers=4
    -c autovacuum_max_workers=4
    -c default_statistics_target=200
    -c effective_io_concurrency=200
    -c maintenance_io_concurrency=200
    -c random_page_cost=1.1
    -c log_min_duration_statement=500
    -c log_checkpoints=on
  deploy:
    resources:
      limits:
        cpus: "4.0"
        memory: 5G # аудит v2: HugePages (4.3GB) вне cgroup
      reservations:
        cpus: "1.0"
        memory: 3G
```

Redis-сервис:

```yaml
redis:
  command: >
    redis-server
    --requirepass ${REDIS_PASSWORD}
    --appendonly yes
    --maxmemory 640mb
    --maxmemory-policy volatile-lru
    --save 900 1 300 10 60 10000
```

**Изменение аудита v2:** `allkeys-lru` → **`volatile-lru`** (не удалять ключи без TTL — Celery broker data)

**Полное распределение ресурсов (32 GB RAM) — пересчитано аудитом v2:**

| Сервис          | CPU лимит | RAM лимит (cgroup) | HugePages  | Реальное потребление |
| --------------- | --------- | ------------------ | ---------- | -------------------- |
| PostgreSQL      | 4.0       | 5 GB               | 4.3 GB     | ~9.3 GB              |
| Backend         | 3.0       | 3 GB               | —          | 3 GB                 |
| Celery Worker   | 3.0       | 2.5 GB             | —          | 2.5 GB               |
| Redis           | 1.0       | 768 MB             | —          | 768 MB               |
| Caddy           | 1.0       | 256 MB             | —          | 256 MB               |
| Frontend        | 0.5       | 256 MB             | —          | 256 MB               |
| Celery Beat     | 0.3       | 256 MB             | —          | 256 MB               |
| **Итого**       | **12.8**  | **~12 GB**         | **4.3 GB** | **~16.3 GB**         |
| ОС + page cache | —         | —                  | —          | **~15.7 GB**         |

> **Ключевое изменение:** HugePages НЕ учитываются в cgroup v2 memory limit. Поэтому PG cgroup limit = 5GB (для work_mem, maintenance, autovacuum), а shared_buffers=4GB живут в HugePages (4.3GB с overhead). Итого для ОС остаётся ~15.7GB — комфортный запас для page cache.

### 6.4. .env

```bash
cp /opt/fancai/.env.template /opt/fancai/.env
chmod 600 /opt/fancai/.env
# Заполнить все <CHANGE_ME> значениями:
# python3 -c "import secrets; print(secrets.token_urlsafe(64))"
```

### 6.5. Backup и Health Check (systemd timers)

- `fancai-backup.timer` — ежедневно 03:00 MSK, `pg_dump --format=custom --compress=zstd:6`, ротация 7/28/90 дней (daily/weekly/monthly)
- `fancai-health.timer` — каждые 5 минут: disk >80%, memory >90%, swap >512 MB, unhealthy containers

**Аудит v2 — обновления бэкапов:**

- Использовать `--compress=zstd:6` (PG 16+, быстрее и лучше сжатие чем zlib:9)
- Добавить ярусную ротацию: daily 7d, weekly 4w, monthly 3m (вместо только 7d)
- Планировать off-site бэкап (rclone/restic → S3) до production launch

---

## Фаза 7: Деплой и верификация

### 7.1. Предусловия деплоя

- [ ] DNS fancai.ru → IP сервера (проверить: `dig fancai.ru +short`)
- [ ] `.env` заполнен всеми секретами
- [ ] Все фазы 1-6 выполнены и проверены
- [ ] **Код-фикс C2:** celery_app.py читает `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND` из env

### 7.2. Запуск

```bash
cd /opt/fancai
docker compose up -d
docker compose ps    # все healthy
```

### 7.3. Финальный checklist

**Безопасность:**

```bash
ssh -p 2222 -o PubkeyAuthentication=no deploy@fancai.ru   # Permission denied
fail2ban-client status sshd                                 # jail active
nft list ruleset | grep f2b                                # f2b chain exists
```

**Система:**

```bash
hostname                                        # fancai-prod
timedatectl | grep "synchronized"               # yes
chronyc tracking | grep "Leap status"           # Normal
sysctl net.ipv4.tcp_congestion_control          # bbr
sysctl vm.nr_hugepages                          # 2200
sysctl net.netfilter.nf_conntrack_max           # 131072
cat /sys/kernel/mm/transparent_hugepage/enabled  # [never]
swapon --show                                    # 4G
```

**Docker:**

```bash
docker info | grep "Live Restore"    # true
docker compose ps                    # все healthy
curl -s http://127.0.0.1:9323/metrics | head -3  # Prometheus метрики
```

**Приложение:**

```bash
curl -I https://fancai.ru            # HTTP/2 200
curl https://fancai.ru/api/health    # OK
```

---

## Критические риски и решения (обновлено аудитом v2)

| Риск                                          | Решение                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| SSH lockout после hardening                   | Всегда проверять в отдельном терминале. Аварийно: netcup SCP → VNC console               |
| `nft flush ruleset` убивает Docker            | Никогда не flush ruleset. Только `delete table inet filter`. Override в nftables.service |
| Docker SIGKILL → PG WAL corruption            | `stop_signal: SIGINT` + `stop_grace_period: 60s`                                         |
| Docker published ports обходят nftables       | Биндить на 127.0.0.1, не 0.0.0.0. Только Caddy на 80/443                                 |
| cloud-init сбрасывает сеть при reboot         | Отключить (3 метода в Фазе 2.2)                                                          |
| needrestart убивает sshd при обновлении glibc | `$nrconf{override_rc}{qr(^ssh)} = 0;`                                                    |
| Docker logs заполняют диск                    | daemon.json: `max-size: 50m`, `max-file: 3`                                              |
| OOM killer убивает PostgreSQL                 | `oom_score_adj: -900` + Swap 4 GB + Docker memory limits                                 |
| netcup storage optimization удаляет snapshots | Не полагаться на netcup snapshots. pg_dump + off-site бэкапы                             |
| Redis eviction теряет Celery задачи           | `volatile-lru` + Celery на отдельных Redis db 1/2 (код-фикс C2)                          |
| HugePages не учитываются в cgroup v2          | PG cgroup limit = 5GB (без shared_buffers). HugePages pre-allocated отдельно             |
| Docker default-address-pools в публичном IP   | Использовать `10.200.0.0/16` (RFC 1918)                                                  |
| BBR модуль не загружен                        | `modprobe tcp_bbr` + `/etc/modules-load.d/bbr.conf` ДО sysctl                            |
| nf_conntrack exhaustion под нагрузкой         | `nf_conntrack_max = 131072` (дефолт 65536 мал для Docker)                                |

---

## Код-фиксы перед деплоем (аудит v2)

Эти изменения нужно внести в кодовую базу до деплоя на новый сервер:

### C2: Celery использует неправильный Redis DB

**Проблема:** `backend/app/core/celery_app.py` использует `settings.REDIS_URL` (db 0) для broker и backend, игнорируя env vars `CELERY_BROKER_URL` и `CELERY_RESULT_BACKEND` из docker-compose.

**Фикс:**

```python
import os

celery_app = Celery(
    "bookreader",
    broker=os.getenv("CELERY_BROKER_URL", settings.REDIS_URL),
    backend=os.getenv("CELERY_RESULT_BACKEND", settings.REDIS_URL),
)
```

### index.html CSP: frame-src 'none'

**Проблема:** Meta-тег CSP в `frontend/index.html` имеет `frame-src 'none'`, но epub.js создаёт blob: iframes для рендеринга книг. Требуется тестирование — возможно функциональный баг.

**Фикс (если подтвердится):** Изменить `frame-src 'none'` → `frame-src blob:`

---

## Будущие улучшения (после стабилизации)

1. **redis-exporter** — добавить в monitoring compose для Prometheus метрик Redis
2. **Netdata v2** — детальный мониторинг CPU/RAM/диск/сеть
3. **Uptime Kuma v2** — мониторинг uptime + алерты в Telegram
4. **PgBouncer** — connection pooling при нехватке max_connections
5. **restic/rclone → S3** — off-site бэкапы (правило 3-2-1)
6. **fail2ban → Telegram** — уведомления о банах
7. **containerd snapshotter** — миграция с overlay2 (deprecated в Docker 29)
8. **Caddy rate limiting** — caddy-ratelimit плагин для защиты static assets от DDoS
9. **redis.conf** — смонтировать или удалить (411 строк dead config)
10. **Log shipping** — централизованные логи (Loki/Hawk)
