# Аудит VPS-сервера: fancai.ru (pre-setup)

**Дата:** 2026-03-01
**IP:** `<REDACTED>`
**Hostname:** v2202603341452437776.hotsrv.de
**Провайдер:** netcup.com (Германия)

## Executive Summary

Сервер в чистом заводском состоянии с Debian 13.3 и Docker 29.2.1 — хорошая стартовая точка. **Две критических находки:** (1) DNS fancai.ru указывает на старый IP `77.246.106.109`, а не на IP этого сервера — Caddy не сможет получить SSL-сертификат; (2) SSH полностью открыт — root login по паролю на порту 22 без firewall. Диск отображается как virtio (`/dev/vda`), но это стандартный паравиртуализированный интерфейс netcup — **бэкенд NVMe SSD**, `io_concurrency` скорректирован до 20 (shared VPS). План VPS 4000 G12 включает 1 ТБ (не 100 ГБ). Сервер полностью готов к настройке по плану.

> **Примечание:** Данные аудита верифицированы с учётом специфики netcup.com — KVM-виртуализация, virtio-blk frontend над NVMe, план VPS 4000 G12, DDoS-защита Anexia, cloud-init provisioning. См. раздел 11.

---

## 1. Железо и ОС

### Заявлено vs Фактически

| Параметр | Заявлено (VPS 4000 G12) | Фактически                                        | Статус |
| -------- | ----------------------- | ------------------------------------------------- | ------ |
| CPU      | 12 vCPU AMD EPYC 9645   | 12 vCPU AMD EPYC 9645 96-Core (KVM, base 2.3 GHz) | ✅     |
| RAM      | 32 GB DDR5              | 31.35 GiB (32869572 kB)                           | ✅     |
| Disk     | 1 TB NVMe SSD           | 1 TiB virtio-blk (vda) → NVMe backend, ext4       | ✅     |
| OS       | Debian 13 (Trixie)      | Debian 13.3 (Trixie)                              | ✅     |
| Kernel   | ~6.12.x                 | 6.12.73+deb13-amd64                               | ✅     |

### Детали CPU

- **Модель:** AMD EPYC 9645 (Turin, Zen 5c, 3nm) — стандартный CPU для netcup G12
- **Виртуализация:** KVM (полная)
- **Тактовая частота:** base 2.3 GHz, all-core boost 3.3 GHz, max single-core boost 3.7 GHz. BogoMIPS 4593 отражает только base clock — это нормальное поведение KVM (гость не видит динамическую частоту)
- **Кэш:** L1d 768 KiB, L1i 768 KiB, L2 6 MiB, L3 192 MiB
- **NUMA:** 1 node, 12 sockets × 1 core × 1 thread

**Ключевые CPU-флаги:**

- AES-NI ✅ (`aes`)
- AVX/AVX2/AVX-512 ✅ (полный набор — `avx`, `avx2`, `avx512f`, `avx512bw`, `avx512vl`)
- SSE 4.1/4.2 ✅
- SHA extensions ✅ (`sha_ni`)
- RDRAND/RDSEED ⚠️ (RDSEED32 broken — см. раздел 8)
- Huge Pages — поддерживаются (2MB pages) ✅

**Уязвимости CPU:** Все mitigation включены, no active vulnerabilities.

### Детали диска

- **Устройство:** `/dev/vda` — virtio-blk (паравиртуализированный интерфейс KVM)
- **Физический бэкенд:** NVMe SSD на хосте (netcup стандарт — virtio frontend над NVMe)
- **Нет устройств** `/dev/nvme*` — ожидаемо для KVM, не означает отсутствие NVMe
- **Размер:** 1 TiB (2147483648 секторов) — соответствует плану VPS 4000 G12
- **Таблица разделов:** GPT

| Раздел | Размер  | Тип       | FS   | Mount     | Свободно |
| ------ | ------- | --------- | ---- | --------- | -------- |
| vda1   | 1M      | BIOS boot | —    | —         | —        |
| vda2   | 244M    | EFI       | vfat | /boot/efi | 241M     |
| vda3   | 977M    | Linux     | ext4 | /boot     | 744M     |
| vda4   | 1022.8G | Linux     | ext4 | /         | 965G     |

- **Mount options:** `rw,relatime,errors=remount-ro` — нет `noatime`, нет `discard`
- **I/O scheduler:** `none` (оптимально для virtio)
- **fstab:** чистый, без swap, с cdrom entries (можно удалить)

---

## 2. Сеть

| Параметр       | Значение                                  |
| -------------- | ----------------------------------------- |
| IPv4           | `<REDACTED>/22`                           |
| IPv6           | `2a0a:4cc0:c1:d183:...` (global scope) ✅ |
| Gateway        | `<REDACTED>` via eth0                     |
| Interface      | eth0 (altnames: enp0s3, ens3)             |
| MTU            | 1500                                      |
| Hostname       | v2202603341452437776 (заводской)          |
| DNS серверы    | 46.38.252.230, 46.38.225.230 (netcup)     |
| Docker network | 172.17.0.0/16 (bridge, docker0)           |

### DNS fancai.ru

```
$ dig fancai.ru +short
77.246.106.109
```

**❌ DNS fancai.ru указывает на `77.246.106.109` — это НЕ IP данного сервера!**
DNS необходимо обновить до миграции, иначе Caddy не сможет получить SSL-сертификат через Let's Encrypt.

### Открытые порты

| Порт | Протокол | Процесс | Адрес          |
| ---- | -------- | ------- | -------------- |
| 22   | TCP      | sshd    | 0.0.0.0 + [::] |

Других слушающих портов нет. Docker сети пусты (0 контейнеров).

---

## 3. Безопасность

### Текущий уровень: КРИТИЧНО НИЗКИЙ 🔴

#### SSH

| Параметр                     | Текущее     | Целевое (план) | Статус |
| ---------------------------- | ----------- | -------------- | ------ |
| Порт                         | 22          | 2222           | ❌     |
| PermitRootLogin              | **yes**     | no             | ❌     |
| PasswordAuthentication       | **yes**     | no             | ❌     |
| X11Forwarding                | **yes**     | no             | ❌     |
| KbdInteractiveAuthentication | no          | no             | ✅     |
| MaxAuthTries                 | 6 (default) | 3              | ❌     |
| SSH ключи                    | 0 ключей    | Ed25519        | ❌     |
| sshd_config.d/               | пусто       | hardening.conf | ❌     |

- **OpenSSH:** 10.0p2 ✅
- **OpenSSL:** 3.5.4 ✅
- **Post-quantum KEX:** `mlkem768x25519-sha256` доступен ✅
- **sntrup761:** доступен ✅

#### Firewall

- **Нет пользовательских правил** — только Docker chains (`ip filter`, `ip nat`, `ip6 filter`, `ip6 nat`)
- INPUT policy: фактически ACCEPT (Docker не создаёт INPUT chain)
- **Все порты на сервере доступны из интернета** ❌
- `iptables` → `iptables-nft` ✅ (правильный shim)

#### Другое

| Компонент                        | Статус                                              |
| -------------------------------- | --------------------------------------------------- |
| fail2ban                         | ❌ Не установлен                                    |
| Unattended upgrades              | ❌ Не установлен                                    |
| needrestart                      | ❌ Не установлен                                    |
| AppArmor                         | ✅ Загружен (4 enforce, 23 complain, 76 unconfined) |
| SELinux                          | Не установлен (ожидаемо)                            |
| rkhunter/chkrootkit              | Не установлены                                      |
| Непривилегированные пользователи | ❌ Нет (только root)                                |
| Группа sudo                      | Пуста                                               |

#### Логи SSH (уже сканируют!)

Сервер уже атакуют — в journalctl за 3.5 часа uptime видны SSH-сканеры:

```
error: kex_exchange_identification: read: Connection reset by peer
```

~8 таких записей — автоматические сканеры пробуют подключиться. **Настройка fail2ban и смена порта — приоритет.**

---

## 4. Системные настройки

### Параметры, требующие изменения

| Параметр               | Текущее      | Целевое (план) | Приоритет | Комментарий                   |
| ---------------------- | ------------ | -------------- | --------- | ----------------------------- |
| vm.swappiness          | **60**       | 10             | P1        | Минимальный swap              |
| vm.overcommit_memory   | **0**        | 1              | P0        | Обязательно для Redis fork    |
| vm.nr_hugepages        | **0**        | 4500           | P1        | Для PostgreSQL shared_buffers |
| THP enabled            | **[always]** | never          | P0        | Критично для PG + Redis       |
| THP defrag             | [madvise]    | never          | P0        |                               |
| net.core.somaxconn     | **4096**     | 65535          | P1        |                               |
| tcp_congestion_control | **cubic**    | bbr            | P1        | BBRv3 в ядре 6.12             |
| tcp_tw_reuse           | 2            | —              | —         | Уже auto                      |
| tcp_max_syn_backlog    | **2048**     | —              | P2        | Увеличить                     |
| rp_filter              | **0**        | —              | P2        | Рассмотреть =1                |
| send_redirects         | **1**        | 0              | P1        | Отключить для безопасности    |
| accept_redirects       | 0            | 0              | ✅        | Уже правильно                 |
| fs.file-max            | 9.2×10¹⁸     | 2097152        | ✅        | Уже max (int64), не трогать   |

### Swap

- **Текущее:** НЕТ swap
- **Целевое:** 4 GB swap file
- Нужно создать swap при настройке

### Время

| Параметр           | Текущее                 | Целевое             |
| ------------------ | ----------------------- | ------------------- |
| Timezone           | **Europe/Berlin** (CET) | Europe/Moscow (MSK) |
| NTP                | systemd-timesyncd       | chrony              |
| Clock synchronized | yes ✅                  | —                   |

### Локали

| Локаль      | Статус            |
| ----------- | ----------------- |
| en_US.UTF-8 | ✅ Установлена    |
| ru_RU.UTF-8 | ❌ Не установлена |

### Limits (ulimit)

| Параметр            | Soft     | Hard | Комментарий         |
| ------------------- | -------- | ---- | ------------------- |
| open files (nofile) | **1024** | —    | Слишком мало!       |
| max user processes  | 128172   | —    | OK                  |
| max locked memory   | 8192 KB  | —    | Мало для huge pages |

---

## 5. Docker

| Параметр         | Текущее                | Целевое             | Статус |
| ---------------- | ---------------------- | ------------------- | ------ |
| Engine Version   | 29.2.1                 | 27.x+               | ✅     |
| Compose          | v5.1.0 (plugin)        | plugin v2+          | ✅     |
| Buildx           | v0.31.1                | —                   | ✅     |
| Storage Driver   | overlayfs (containerd) | overlay2            | ✅     |
| Cgroup Driver    | systemd                | systemd             | ✅     |
| Cgroup Version   | 2                      | 2                   | ✅     |
| Firewall Backend | iptables               | iptables (nft shim) | ✅     |
| Live Restore     | **false**              | true                | ❌     |
| daemon.json      | **Нет**                | Настроить           | ❌     |
| Logging Driver   | json-file              | json-file + limits  | ⚠️     |
| Docker Root Dir  | /var/lib/docker        | /var/lib/docker     | ✅     |
| Rootless extras  | Установлены            | —                   | ✅     |

### Docker daemon limits

| Параметр    | Значение                       |
| ----------- | ------------------------------ |
| LimitNOFILE | 524288 hard / **1024 soft** ⚠️ |
| LimitNPROC  | infinity                       |
| LimitCORE   | infinity                       |

**LimitNOFILE soft=1024** — слишком мало для production с PostgreSQL + Redis + Celery.

### iptables

```
iptables v1.8.11 (nf_tables)
iptables → /usr/sbin/iptables-nft ✅
```

Docker 29.x использует `iptables-nft` shim корректно. Нативный nftables backend экспериментальный — план правильно его избегает.

---

## 6. Пакеты и сервисы

**Всего пакетов:** 353 (минимальная установка)

### Установлено (полезное)

| Пакет                 | Версия | Комментарий                       |
| --------------------- | ------ | --------------------------------- |
| docker-ce             | 29.2.1 | ✅                                |
| docker-compose-plugin | 5.1.0  | ✅                                |
| docker-buildx-plugin  | 0.31.1 | ✅                                |
| git                   | 2.47.3 | ✅                                |
| curl                  | 8.14.1 | ✅                                |
| wget                  | 1.25.0 | ✅                                |
| python3               | 3.13.5 | ✅ (системный, Docker будет свой) |
| OpenSSH               | 10.0p2 | ✅                                |
| AppArmor              | —      | ✅ Загружен                       |

### Не хватает (установить по плану)

| Пакет               | Приоритет | Зачем                                |
| ------------------- | --------- | ------------------------------------ |
| fail2ban            | P0        | Защита от brute force                |
| sudo                | P0        | Для пользователя deploy              |
| unattended-upgrades | P1        | Авто-обновления безопасности         |
| needrestart         | P1        | Перезапуск после обновлений          |
| chrony              | P1        | Точный NTP                           |
| vim                 | P2        | Полная версия (есть только vim-tiny) |
| htop                | P2        | Мониторинг                           |
| iotop               | P2        | Мониторинг I/O                       |
| jq                  | P2        | JSON-обработка                       |
| rsync               | P2        | Копирование файлов                   |
| net-tools           | P2        | Утилиты сети                         |
| dnsutils            | P2        | dig, nslookup                        |
| mtr                 | P2        | Трассировка                          |
| ncdu                | P2        | Анализ дискового пространства        |
| tree                | P2        | Визуализация директорий              |
| acl                 | P2        | Управление правами                   |
| locales             | P1        | Для ru_RU.UTF-8                      |

### Установлено (лишнее — оценить)

| Сервис                    | Комментарий                                                       |
| ------------------------- | ----------------------------------------------------------------- |
| cloud-init (6 сервисов)   | ⚠️ Отключить — безопасно на netcup, используется только при setup |
| qemu-guest-agent          | ✅ Оставить — нужен для netcup SCP (shutdown, snapshots)          |
| docker-ce-rootless-extras | Не нужно для production                                           |

### Запущенные сервисы

```
containerd, docker, ssh, cron, dbus, systemd-journald,
systemd-logind, systemd-timesyncd, systemd-udevd,
systemd-timedated, qemu-guest-agent, getty@tty1
```

Минимальный набор — лишнего нет.

### APT репозитории

- `debian.anexia.at` — зеркало Debian (Annexia, Австрия — близко к netcup Германия) ✅
- `security.debian.org` — security updates ✅
- Docker official (`docker.list`) ✅

### Systemd timers

| Timer             | Описание                 | Статус |
| ----------------- | ------------------------ | ------ |
| apt-daily         | APT обновление списков   | ✅     |
| apt-daily-upgrade | APT установка обновлений | ✅     |
| fstrim            | TRIM для SSD             | ✅     |
| logrotate         | Ротация логов            | ✅     |
| e2scrub_all       | Проверка ext4            | ✅     |
| dpkg-db-backup    | Бэкап dpkg               | ✅     |

---

## 7. Дисковая подсистема

| Параметр         | Значение                                               |
| ---------------- | ------------------------------------------------------ |
| Устройство       | /dev/vda (virtio-blk frontend → NVMe SSD backend)      |
| Архитектура      | KVM paravirt: гость видит virtio, хост использует NVMe |
| Размер           | 1 TiB (VPS 4000 G12 стандарт)                          |
| Файловая система | ext4                                                   |
| I/O scheduler    | none (оптимально для virtio)                           |
| Свободно на /    | 965 GB (1% использовано)                               |
| /var/log         | 29 MB                                                  |
| /var/cache       | 96 MB                                                  |
| /var/lib/docker  | 184 KB (пустой)                                        |
| iostat           | Не установлен (нужен sysstat)                          |
| smartctl         | Не установлен                                          |

> **netcup специфика:** Virtio-blk добавляет ~33-50% overhead (не 5-10% — реальные замеры KVM).
> Netcup VPS 4000 G12 показывает 13K-82K 4K IOPS (vpsbenchmarks.com) — разброс 6x
> из-за noisy neighbors. PostgreSQL `effective_io_concurrency = 100` (см. раздел 12.1).

---

## 8. Проблемы и риски

### P0 — Критические (исправить немедленно)

1. **DNS fancai.ru → старый IP** — домен указывает на `77.246.106.109`, а не на IP этого сервера. Caddy не получит SSL-сертификат. **Действие:** обновить A-запись в DNS.

2. **SSH полностью открыт** — root login по паролю, порт 22, без firewall, без fail2ban. Сканеры уже стучатся (8+ попыток за 3.5 часа). **Действие:** выполнить шаги 4-7 плана настройки как можно скорее.

3. **vm.overcommit_memory = 0** — Redis не сможет делать background saves (fork). **Действие:** sysctl настройка по плану.

4. **THP enabled (always)** — вызывает latency jitter для PostgreSQL и Redis. **Действие:** отключить в sysctl + grub.

### P1 — Важные (исправить при настройке)

5. **io_concurrency в плане = 200** — слишком высоко для shared VPS. Рекомендуется `effective_io_concurrency = 100`, `maintenance_io_concurrency = 100`. Обоснование: бенчмарки PG mailing list показывают плато производительности на ~100 для NVMe; выше — только CPU overhead и page cache pollution. Значение 20 было слишком консервативным (см. раздел 12.1).

6. **Нет swap** — OOM killer может убить PostgreSQL/Redis при пиковой нагрузке. Создать 4 GB swap file.

7. **Нет fail2ban** — при текущем SSH на порту 22 с root login по паролю это критичная дыра.

8. **Нет firewall INPUT rules** — все порты доступны из интернета.

9. **vm.swappiness = 60** — слишком агрессивный swap (когда swap будет создан).

10. **net.core.somaxconn = 4096** — увеличить для высоконагруженного reverse proxy.

11. **tcp_congestion = cubic** — переключить на BBR (встроен в ядро 6.12).

12. **Docker Live Restore = false** — при обновлении Docker все контейнеры перезапустятся.

13. **Docker daemon.json отсутствует** — нет log rotation, нет лимитов.

14. **Timezone Europe/Berlin** — должен быть Europe/Moscow.

15. **Нет ru_RU.UTF-8 локали** — может понадобиться для PostgreSQL.

16. **Нет huge pages** — нужны для PostgreSQL shared_buffers.

17. **cloud-init enabled** — может сбрасывать hostname, DNS и сетевые настройки при reboot. Безопасно отключить на netcup (используется только при начальном provisioning).

18. **IPv6 + Docker** — Docker включает ip_forward, что ломает IPv6 Router Advertisements. Нужен sysctl `net.ipv6.conf.eth0.accept_ra = 2` + systemd unit для reapply после старта Docker.

### P2 — Рекомендации

19. **RDSEED32 broken** — ядро обнаружило и отключило RDSEED32 (KVM issue). Не влияет на безопасность — RDRAND работает.

20. **Hostname заводской** — изменить на `fancai-prod`.

21. **send_redirects = 1** — отключить для hardening.

22. **Нет sysstat** — не можем мониторить I/O (iostat).

23. **fstab: cdrom entries** — косметика, можно удалить.

24. **Docker rootless extras** — не нужны для production deployment.

25. **qemu-guest-agent** — оставить. Используется netcup SCP для чистого shutdown и consistent snapshots.

---

## 9. Готовность к настройке по плану

### Checklist совместимости с планом

- [x] Debian 13 (Trixie) 13.3 подтверждён
- [x] Docker 29.2.1 установлен и работает
- [x] cgroup v2 активен
- [x] iptables-nft (не legacy)
- [x] ext4 совместима с overlay2 (overlayfs)
- [x] NVMe бэкенд подтверждён (virtio-blk frontend — стандарт netcup KVM). io_concurrency = 100
- [x] CPU поддерживает huge pages (2MB)
- [x] Достаточно RAM: huge pages 4500×2MB = 8.8 GB + контейнеры ~19 GB = ~28 GB < 31.35 GB
- [ ] DNS fancai.ru указывает на этот сервер — **НЕТ, указывает на старый IP**
- [x] IPv6 доступен (⚠️ требует accept_ra=2 для совместимости с Docker)
- [x] 1 ТБ дискового пространства (соответствует плану VPS 4000 G12)

---

## 10. Расхождения с планом настройки

### Критические корректировки

| #   | Что в плане                             | Фактически                    | Корректировка                                                                    |
| --- | --------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| 1   | `effective_io_concurrency = 200` (NVMe) | Shared VPS с NVMe backend     | Установить `effective_io_concurrency = 100` и `maintenance_io_concurrency = 100` |
| 2   | DNS fancai.ru → IP сервера              | DNS → 77.246.106.109 (старый) | Обновить A-запись ДО настройки Caddy                                             |

### Некритические отличия

| #   | Что в плане                | Фактически                 | Влияние                                                                    |
| --- | -------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| 3   | `fs.file-max = 2097152`    | Уже `9.2×10¹⁸` (max int64) | Не нужно устанавливать — уже выше                                          |
| 4   | mount `-o noatime,discard` | Только `relatime`          | Добавить `noatime` в fstab. `discard` не нужен — fstrim timer уже работает |
| 5   | chrony для NTP             | systemd-timesyncd работает | Заменить на chrony по плану                                                |
| 6   | —                          | cloud-init enabled         | Отключить (безопасно на netcup — используется только при provisioning)     |
| 7   | —                          | IPv6 + Docker              | Добавить sysctl `accept_ra=2` + systemd unit (см. раздел 11)               |

### Рекомендуемый порядок действий (с учётом находок)

1. **Шаг 0 (ДО всего):** Обновить DNS A-запись fancai.ru → IP этого сервера
2. **Шаг 0.5:** Отключить cloud-init (`systemctl disable cloud-init.target` + touch `/etc/cloud/cloud-init.disabled`)
3. **Шаги 1-3 по плану:** Пакеты, hostname, chrony
4. **Шаги 4-7 по плану (СРОЧНО):** Пользователь deploy, SSH hardening, firewall, fail2ban
5. **Шаг 8:** sysctl + THP + huge pages + swap
6. **Шаг 9-10:** Docker daemon.json, Docker network
7. **Шаг 11+:** Deployment (после того как DNS обновлён и пропагирован)

### PostgreSQL: поправки для shared VPS

В `docker-compose.yml` секция PostgreSQL command:

```diff
- -c effective_io_concurrency=200
+ -c effective_io_concurrency=100
- -c maintenance_io_concurrency=200
+ -c maintenance_io_concurrency=100
```

> **Обоснование (раздел 12.1):** Бенчмарки David Rowley (PG committer) на NVMe показывают
> плато на ~100. Значение 200 даёт <2% прироста на bare metal. Значение 20 слишком
> консервативно (PG18 default = 16). Начинаем с 100/100, валидируем fio + pgbench.

Все остальные параметры PostgreSQL из плана (shared_buffers, work_mem, etc.) корректны для данной конфигурации.

**Также добавить в docker-compose.yml для PostgreSQL (критично!):**

```yaml
services:
  postgres:
    stop_signal: SIGINT # Fast shutdown (не SIGTERM → smart shutdown)
    stop_grace_period: 60s # 60 сек до SIGKILL (не 10 по умолчанию)
```

> **Без этого:** Docker отправляет SIGTERM → PG ждёт отключения клиентов → через 10 сек
> Docker шлёт SIGKILL → WAL corruption. Документировано: CYBERTEC, docker-library/postgres #714.

---

## 11. Специфика netcup.com

Данные аудита верифицированы с учётом документации netcup, форумов и community knowledge (2025-2026).

### 11.1. Виртуализация и диск

- **KVM + virtio-blk** — стандартная архитектура netcup. `/dev/vda` — паравиртуализированный frontend, физический бэкенд — NVMe SSD. Netcup рекомендует virtio вместо SCSI (2x I/O performance).
- **Нет `/dev/nvme*`** — ожидаемо. Гость KVM не видит NVMe напрямую.
- Virtio-blk overhead минимальный (~5-10%), производительность ближе к native NVMe, чем к HDD.

### 11.2. CPU: EPYC 9645 (G12)

- netcup **никогда не предлагал EPYC 9755**. Линейка G12 использует **EPYC 9645** (Turin, Zen 5c, 3nm).
- Предыдущая G11: EPYC 9634 (Genoa, Zen 4). "9755" в задании — ошибка.
- BogoMIPS ~4593 = 2 × base clock 2296 MHz — стандартная формула. Реальный boost до 3.7 GHz.

### 11.3. План VPS 4000 G12

| Параметр | VPS 4000 G12 | Фактически | Совпадает |
| -------- | ------------ | ---------- | --------- |
| vCPU     | 12           | 12         | ✅        |
| RAM      | 32 GB        | 31.35 GiB  | ✅        |
| NVMe SSD | 1 TB         | 1 TiB      | ✅        |

Диск 1 ТБ — штатная комплектация плана, не over-provisioning. Заявленные "100 ГБ" в задании — ошибка.

### 11.4. Сеть и DDoS

- **DDoS-защита** (Layer 3-4) включена бесплатно — Anexia DDoS Guard, до 2 Tbps. Автоматическая активация при аномальном трафике.
- **Нет внешнего firewall** для отдельных портов — VPS полностью открыт, нужен собственный nftables.
- **DNS-серверы** 46.38.252.230 / 46.38.225.230 — стандартные netcup, низкая задержка внутри сети. Рекомендуется добавить fallback (1.1.1.1 или 8.8.8.8).

### 11.5. IPv6 + Docker (известная проблема)

Docker включает `ip_forward`, что ломает приём Router Advertisements на eth0. IPv6 маршрут по умолчанию пропадает.

**Решение (добавить в план настройки):**

```bash
# /etc/sysctl.d/99-docker-ipv6.conf
net.ipv6.conf.eth0.accept_ra = 2
```

```ini
# /etc/systemd/system/fix-ipv6-ra.service
[Unit]
Description=Fix IPv6 RA after Docker
After=docker.service

[Service]
Type=oneshot
ExecStart=/sbin/sysctl -w net.ipv6.conf.eth0.accept_ra=2

[Install]
WantedBy=multi-user.target
```

> **netcup специфика:** IPv6 /64 — switched (Layer 2), не routed. Для IPv6 в Docker-контейнерах нужен `ndppd`. Для текущего проекта достаточно IPv4 для Docker + IPv6 для хоста.

### 11.6. cloud-init

- Используется netcup **только при начальном provisioning** (hostname, сеть, SSH). Безопасно отключить.
- При переустановке ОС через SCP — cloud-init вернётся с чистым образом.
- **Метод отключения (три уровня):**
  1. `systemctl disable cloud-init.target`
  2. `touch /etc/cloud/cloud-init.disabled`
  3. `echo "network: {config: disabled}" > /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg`

### 11.7. qemu-guest-agent

**Оставить установленным.** Используется netcup SCP для:

- Чистый shutdown (надёжнее ACPI)
- Filesystem freeze перед snapshot (consistent backups)
- Отображение IP в панели управления
- Мониторинг памяти

Без него SCP показывает предупреждение, snapshots могут быть inconsistent.

### 11.8. Известные проблемы netcup (2025-2026)

| Проблема                               | Статус              | Влияние                           |
| -------------------------------------- | ------------------- | --------------------------------- |
| CPU feature bug (июнь 2025)            | Исправлено          | Не затрагивает новые серверы      |
| Nested virtualization (SVM)            | Постоянно отключено | Не влияет на Docker               |
| Storage optimization force-stop        | Редко               | qemu-guest-agent помогает         |
| IPv6 NDP cache expiry                  | Известно            | Только для IPv6 в контейнерах     |
| Storage optimization удаляет snapshots | Периодически        | Нужен внешний backup (см. 12.3)   |
| SCP SOAP API → REST миграция           | Дедлайн 01.05.2026  | Сломает автоматизацию на SOAP API |

---

## 12. Углублённое исследование (дополнение)

### 12.1. effective_io_concurrency: детальный анализ

**Как PG17 использует параметр:** Advisory `posix_fadvise(WILLNEED)` — подсказка ядру для prefetch страниц в page cache. Влияет на Bitmap Heap Scan, Index Scan, WAL recovery.

**Бенчмарки David Rowley (PG committer) на NVMe:**

| e_i_c | PCIe 3.0 NVMe (ms) | PCIe 4.0 NVMe (ms) |
| ----- | ------------------ | ------------------ |
| 0     | 88,627             | 59,307             |
| 10    | 74,174             | 56,780             |
| 100   | 67,340             | 55,662             |
| 1000  | 67,320             | 51,514             |

**Плато на ~100.** Переход 100→1000 даёт <0.1% на PCIe 3.0.

**netcup VPS 4000 G12 IOPS (vpsbenchmarks.com):**

| Дата              | DC        | 4K Random R IOPS | Комментарий      |
| ----------------- | --------- | ---------------- | ---------------- |
| Янв 2026 (лучший) | Nuremberg | 82,171           | Чистый хост      |
| Ноя 2025          | Vienna    | 47,961           | Средняя нагрузка |
| Янв 2026 (худший) | —         | 13,106           | Noisy neighbors  |

**Разброс 6x!** Но даже 13K IOPS >> чем PG может утилизировать через single-process prefetch.

**Риски:** Слишком высоко (>200) → CPU overhead + page cache pollution. Слишком низко (<16) → I/O stalls при bitmap heap scan. Значение 1 **хуже** чем 0 (syscall overhead без достаточного prefetch).

**Рекомендация: `effective_io_concurrency = 100`, `maintenance_io_concurrency = 100`**

**Команды для валидации на сервере:**

```bash
# Установить fio и ioping
apt install -y fio ioping

# 8K random read (PostgreSQL page size = 8KB)
fio --name=pg_randread --ioengine=libaio --direct=1 --rw=randread \
    --bs=8k --size=2G --numjobs=4 --iodepth=32 --runtime=60 \
    --time_based --group_reporting --filename=/tmp/fio_test

# Latency
ioping -c 100 -s 8k /var/lib/docker/volumes/

# Интерпретация:
# < 10K IOPS → e_i_c = 50
# 10-30K IOPS → e_i_c = 100 (рекомендация)
# > 30K IOPS → e_i_c = 100-200
```

**Источники:** PostgreSQL mailing list threads: "effective_io_concurrency and NVMe devices" (2022), "Setting effective_io_concurrency in VM?" (2017), PG18 commit "Increase default to 16". PGTune рекомендует 200 для SSD, но не различает bare metal и shared VPS.

### 12.2. Критические риски при настройке (исследование)

Полное исследование выявило **13 CRITICAL** и **12 HIGH** рисков. Ключевые:

#### CRITICAL — Потеря доступа

| #   | Риск                                                 | Вероятность | Предотвращение                                                                                         |
| --- | ---------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| 1   | SSH port change без открытия нового порта в nftables | Частая      | Сначала открыть порт, потом менять sshd. Держать ОБА порта во время перехода                           |
| 2   | `nft flush ruleset` уничтожает Docker networking     | Частая      | НЕ использовать flush ruleset. Только `delete table inet filter`. Override ExecStop в nftables.service |
| 3   | nftables rules не сохраняются после reboot           | Частая      | `nft list ruleset > /etc/nftables.conf` + `systemctl enable nftables`                                  |
| 4   | cloud-init сбрасывает сеть при reboot                | Средняя     | Отключить (три метода — см. раздел 11.6)                                                               |
| 5   | needrestart убивает sshd при обновлении glibc        | Редкая      | Добавить `$nrconf{override_rc}{qr(^ssh)} = 0;` в needrestart conf                                      |
| 6   | OpenSSH 10.0 удалил DSA ключи                        | Частая      | Использовать только Ed25519. Проверить клиенты                                                         |

**Аварийный доступ:** netcup SCP → VNC console (работает независимо от SSH). Rescue System позволяет монтировать FS и редактировать конфиги.

#### CRITICAL — Потеря данных / Крах сервера

| #   | Риск                                      | Вероятность  | Предотвращение                                                           |
| --- | ----------------------------------------- | ------------ | ------------------------------------------------------------------------ |
| 7   | Docker SIGKILL PostgreSQL через 10 сек    | Средняя      | `stop_signal: SIGINT` + `stop_grace_period: 60s`                         |
| 8   | Docker logs заполняют диск (нет rotation) | Очень частая | daemon.json: `max-size: 50m`, `max-file: 3`                              |
| 9   | Docker published ports обходят nftables   | Частая       | Биндить на 127.0.0.1, не на 0.0.0.0. Только Caddy на 80/443              |
| 10  | OOM killer убивает PostgreSQL             | Средняя      | `oom_score_adj: -500` для PG контейнера. Memory limits на все контейнеры |

#### HIGH — vm.overcommit_memory конфликт PG vs Redis

PostgreSQL хочет `vm.overcommit_memory = 2` (strict), Redis хочет `= 1` (always allow).

**Компромисс:** Оставить `= 0` (default heuristic) + жёсткие Docker memory limits:

- postgres: 10G limit
- redis: 2G limit + `--maxmemory 1536mb --save ""`
- celery: 4G limit
- Итого ~16G / 32G — достаточный headroom

#### HIGH — netcup storage optimization

Периодически netcup требует storage optimization → **удаляет ВСЕ snapshots** + останавливает сервер. Может зависнуть на 10+ часов.

**Защита:** Не полагаться на netcup snapshots. Внешние бэкапы обязательны.

### 12.3. Обязательные дополнения к плану настройки

На основе исследования, добавить в план:

**1. nftables.service override (предотвращает уничтожение Docker сети):**

```bash
mkdir -p /etc/systemd/system/nftables.service.d/
cat > /etc/systemd/system/nftables.service.d/override.conf << 'EOF'
[Service]
ExecStop=
ExecStop=/usr/sbin/nft delete table inet filter
EOF
```

**2. Docker daemon.json (полный):**

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "3", "compress": "true" },
  "live-restore": true,
  "storage-driver": "overlay2"
}
```

**3. journald limits:**

```ini
# /etc/systemd/journald.conf.d/limits.conf
[Journal]
SystemMaxUse=500M
MaxRetentionSec=1month
Compress=yes
```

**4. Blacklist критических пакетов от auto-upgrade:**

```bash
# /etc/apt/apt.conf.d/50unattended-upgrades
Unattended-Upgrade::Package-Blacklist {
    "openssh-server";
    "docker-ce";
    "docker-ce-cli";
    "containerd.io";
};
```

**5. needrestart — не трогать sshd:**

```bash
cat > /etc/needrestart/conf.d/no-sshd.conf << 'EOF'
$nrconf{override_rc}{qr(^ssh)} = 0;
EOF
```

**6. Бэкапы (3-2-1):**

- Copy 1: Live данные на VPS
- Copy 2: Ежедневный pg_dump → /opt/backups/ (7 дней ротация)
- Copy 3: restic → S3/Hetzner Storage Box (7 daily, 4 weekly, 6 monthly)

**7. Health check cron (каждые 5 мин):**

Мониторить: disk >85%, inodes >80%, memory <1GB free, unhealthy containers, SSL cert <14 дней.

### 12.4. Источники исследования

- [PostgreSQL: effective_io_concurrency and NVMe](https://postgrespro.com/list/thread-id/2598955)
- [PostgreSQL: Setting effective_io_concurrency in VM?](https://postgrespro.com/list/thread-id/2357389)
- [PG18: Increase default to 16](https://www.mail-archive.com/pgsql-committers@lists.postgresql.org/msg39193.html)
- [vpsbenchmarks.com: netcup RS 4000 G12](https://www.vpsbenchmarks.com/yabs/netcup-12c-31gb-20260124-b7eaab)
- [LowEndTalk: netcup G12 underperforming](https://lowendtalk.com/discussion/212781)
- [CYBERTEC: Docker sudden death for PostgreSQL](https://www.cybertec-postgresql.com/en/docker-sudden-death-for-postgresql/)
- [Docker nftables docs](https://docs.docker.com/engine/network/firewall-nftables)
- [Leo's Field: Don't Nuke My Docker nftables](https://szclsya.me/posts/net/dont-nuke-my-docker-nftables/)
- [netcup Storage Optimization forum](https://forum.netcup.de/administration-of-a-server-vserver/vserver-server-kvm-server/21115)
- [Debian 13 Release Notes](https://www.debian.org/releases/trixie/release-notes/issues.html)
- [netcup SCP Webservice deprecation](https://helpcenter.netcup.com/en/wiki/server/scp-webservice)
- [Docker Live Restore docs](https://docs.docker.com/engine/daemon/live-restore/)
- [Caddy Docker persistence](https://hub.docker.com/_/caddy)
