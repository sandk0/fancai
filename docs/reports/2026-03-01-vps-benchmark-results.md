# Бенчмарк VPS: netcup VPS 4000 G12

**Дата:** 2026-03-01
**Сервер:** netcup VPS 4000 G12 (12 vCPU AMD EPYC 9645, 32 GB RAM, 1 TB NVMe virtio-blk)
**ОС:** Debian 13.3, ядро 6.12.73+deb13-amd64
**Инструменты:** fio 3.39, ioping 1.3, sysbench 1.0.20

---

## 1. Дисковая подсистема

### Random Read 8K (PostgreSQL workload)

Основной паттерн: bitmap heap scan, index scan — случайное чтение блоков по 8K.

```
fio --ioengine=libaio --direct=1 --rw=randread --bs=8k --size=2G --numjobs=4 --iodepth=32 --runtime=60
```

| Метрика        | Значение                    |
| -------------- | --------------------------- |
| IOPS           | **1,247,000**               |
| Bandwidth      | 9,743 MiB/s (10.2 GB/s)     |
| Avg Latency    | 100 us                      |
| p99 Latency    | 139 us                      |
| p99.9 Latency  | 182 us                      |
| p99.99 Latency | 302 us                      |
| Queue Depth    | 4 jobs × 32 depth = 128 IOs |

**Контекст:** vpsbenchmarks.com давал 13K-82K IOPS для этого VPS. Наш результат (1.25M IOPS)
сильно превышает ожидания. Причина — тест vpsbenchmarks использует depth=1 или низкий depth,
а при depth=128 NVMe SSD через virtio-blk раскрывает полный потенциал многоканального контроллера.

### Mixed R/W 8K (70% read / 30% write)

Эмуляция типичной web-app нагрузки PostgreSQL.

```
fio --ioengine=libaio --direct=1 --rw=randrw --rwmixread=70 --bs=8k --size=2G --numjobs=4 --iodepth=16 --runtime=60
```

| Метрика       | Read          | Write       |
| ------------- | ------------- | ----------- |
| IOPS          | **760,000**   | **326,000** |
| Bandwidth     | 5,934 MiB/s   | 2,543 MiB/s |
| Avg Latency   | 56 us         | 56 us       |
| p99 Latency   | 83 us         | 83 us       |
| p99.9 Latency | 118 us        | 116 us      |
| Total IOPS    | **1,086,000** |             |

### Sequential Read 256K (seq scan, VACUUM, backup)

```
fio --ioengine=libaio --direct=1 --rw=read --bs=256k --size=2G --numjobs=1 --iodepth=4 --runtime=30
```

| Метрика     | Значение                 |
| ----------- | ------------------------ |
| IOPS        | 57,200                   |
| Bandwidth   | **14.0 GiB/s (15 GB/s)** |
| Avg Latency | 53 us                    |
| p99 Latency | 86 us                    |

### Latency (ioping — однопоточный, disk ext4)

Показывает задержку при единичных запросах (queue depth = 1).

```
ioping -c 100 -s 8k /var/tmp/   # ext4 на /dev/vda4
```

| Тест                | Min    | Avg         | Max     | Mdev   | IOPS  |
| ------------------- | ------ | ----------- | ------- | ------ | ----- |
| Random read 8K      | 365 us | **493 us**  | 1.01 ms | 78 us  | 2,030 |
| Sequential write 8K | 697 us | **1.01 ms** | 4.17 ms | 489 us | 987   |

**Замечание:** ioping тестирует задержку при depth=1 (последовательные запросы). Это «worst case»
для PostgreSQL — реальная нагрузка всегда использует несколько конкурентных I/O.

### Noisy Neighbor Test (3 запуска с интервалом 10 мин)

```
fio --ioengine=libaio --direct=1 --rw=randread --bs=4k --numjobs=1 --iodepth=64 --runtime=10
```

| Запуск  | Время    | IOPS        | Avg Lat | Отклонение |
| ------- | -------- | ----------- | ------- | ---------- |
| 1       | 19:53:22 | 376,000     | 168 us  | −0.6%      |
| 2       | 20:03:34 | 375,000     | 169 us  | −0.9%      |
| 3       | 20:13:44 | **384,000** | 165 us  | **+1.5%**  |
| **Avg** |          | **378,300** | 167 us  |            |

**Максимальное отклонение: 2.4%** — отсутствие noisy neighbors. Производительность стабильна.

### Вывод по io_concurrency

Измеренные результаты подтверждают экстремально высокую производительность NVMe:

| Метрика                | Depth=1 (ioping) | Depth=64 (4K) | Depth=128 (8K) |
| ---------------------- | ---------------- | ------------- | -------------- |
| IOPS                   | 2,030            | 378,300       | 1,247,000      |
| Масштабирование vs d=1 | 1x               | 186x          | 614x           |

Диск **великолепно** масштабируется с ростом queue depth. PostgreSQL `effective_io_concurrency`
управляет prefetch для bitmap heap scan — чем выше значение, тем больше страниц PG
запрашивает конкурентно.

**Рекомендации:**

- `effective_io_concurrency = 200` (было 100 в аудите — повышаем)
- `maintenance_io_concurrency = 100` (VACUUM, CREATE INDEX — не нужно максимума)

**Обоснование:** при 1.25M IOPS на depth=128 и линейном масштабировании, PG может
безболезненно использовать 200 конкурентных prefetch-запросов. Значение 100 было
консервативным — для SSD такого уровня 200 является оптимальным балансом.

---

## 2. CPU

```
sysbench cpu --cpu-max-prime=20000
```

| Тест                       | Результат                |
| -------------------------- | ------------------------ |
| Single-thread (events/sec) | **1,579**                |
| 12-thread (events/sec)     | **12,659**               |
| Масштабируемость (12t/1t)  | **8.01x** (из 12x)       |
| Single-thread latency      | avg 0.63 ms, p95 0.67 ms |
| 12-thread latency          | avg 0.95 ms, p95 4.65 ms |

**Анализ:**

- Single-thread 1,579 eps — хороший результат для VPS на AMD EPYC 9645 (Turin, 2024).
  Для сравнения: Hetzner CPX41 (AMD EPYC Milan) даёт ~1,200 eps.
- Масштабируемость 8.01x из 12x (66.8%) — типично для VPS:
  гипервизор и scheduler overhead снижают масштабирование.
- Для нашей нагрузки (FastAPI + Celery + PG на одном сервере) — более чем достаточно.

---

## 3. Память

```
sysbench memory --memory-block-size=1M --memory-total-size=10G --threads=4
```

| Метрика          | Значение              |
| ---------------- | --------------------- |
| Memory bandwidth | **5,504 MiB/sec**     |
| Avg latency      | 0.71 ms per 1MB block |
| p95 latency      | 2.86 ms               |

**Анализ:** ~5.4 GB/s при записи блоков 1M — адекватно для VPS.
Для PG shared_buffers и Celery в-памяти операций этого более чем достаточно.

---

## 4. Сеть

| Метрика             | Значение                     |
| ------------------- | ---------------------------- |
| Download speed      | **107.5 MB/s (~860 Mbit/s)** |
| Тестовый файл       | 100 MB, OVH CDN (Европа)     |
| Время скачивания    | 0.97 сек                     |
| DNS resolution (#1) | 73 ms (cold cache)           |
| DNS resolution (#2) | 16 ms (cached)               |
| DNS resolution (#3) | 15 ms (cached)               |

**Анализ:** ~860 Mbit/s — близко к лимиту 1 Gbit/s порта netcup.
DNS через настроенный резолвер работает быстро после кэширования.

---

## 5. Недостающие данные

### 5.1. AppArmor

| Категория     | Кол-во | Детали                                           |
| ------------- | ------ | ------------------------------------------------ |
| Loaded        | 103    |                                                  |
| **Enforce**   | **4**  | docker-default, lsb_release, nvidia_modprobe (2) |
| Complain      | 23     | sbuild (12), transmission (4), Xorg, и др.       |
| Unconfined    | 76     | Desktop-ориентированные (chrome, firefox, etc.)  |
| Kill / Prompt | 0      |                                                  |

**Важно:**

- `docker-default` профиль в enforce — Docker-контейнеры защищены.
- 76 unconfined профилей — это дефолтный набор Debian 13, безопасно для сервера
  (эти приложения не установлены, профили просто загружены из пакетов).
- Для продакшена рекомендуется добавить custom AppArmor-профили для PostgreSQL и Redis.

### 5.2. nftables

Docker создал 4 таблицы:

| Таблица    | Назначение                        |
| ---------- | --------------------------------- |
| ip nat     | DNAT/SNAT для контейнеров         |
| ip filter  | Фильтрация (FORWARD policy: drop) |
| ip6 nat    | IPv6 NAT для контейнеров          |
| ip6 filter | IPv6 фильтрация                   |

**Ключевые наблюдения:**

- `FORWARD policy: drop` — хорошо, трафик между контейнерами контролируется.
- `DOCKER-USER` chain пуст — **нужно добавить** кастомные правила ДО первого деплоя.
- Нет INPUT chain — **нет файервола для хоста**. Критическая уязвимость!
- IPv6 FORWARD: `policy accept` — **нужно** изменить на `drop` или отключить IPv6.

### 5.3. Docker

| Параметр         | Значение            | Статус                      |
| ---------------- | ------------------- | --------------------------- |
| Server Version   | 29.2.1              | Актуален                    |
| Storage Driver   | overlayfs           | Ок                          |
| Logging Driver   | json-file           | ⚠️ Нет ротации по умолчанию |
| Cgroup Driver    | systemd v2          | Ок                          |
| Default Runtime  | runc                | Ок                          |
| **Live Restore** | **false**           | ❌ Включить!                |
| Docker Root Dir  | /var/lib/docker     | Ок                          |
| Kernel Version   | 6.12.73+deb13-amd64 | Актуальное                  |

**Рекомендации:**

- Включить `live-restore: true` в `/etc/docker/daemon.json` — позволит перезапускать dockerd
  без остановки контейнеров.
- Настроить ротацию логов: `"log-opts": {"max-size": "50m", "max-file": "3"}`.

### 5.4. Inodes

| FS            | Total      | Used   | Free       | Use%   |
| ------------- | ---------- | ------ | ---------- | ------ |
| / (/dev/vda4) | 66,511,424 | 48,279 | 66,463,145 | **1%** |

**Анализ:** 66.5M inodes при 48K использованных — абсолютно безопасно.
Docker overlay2 с десятками контейнеров обычно использует 100K-500K inodes.
Запас более чем достаточный.

### 5.5. Kernel Modules

| Модуль           | Статус         | Назначение                     |
| ---------------- | -------------- | ------------------------------ |
| nf_tables        | ✅ Загружен    | nftables framework             |
| nft_chain_nat    | ✅ Загружен    | NAT chains                     |
| nft_compat       | ✅ Загружен    | iptables compatibility         |
| overlay          | ✅ Загружен    | Docker overlay2                |
| **tcp_bbr**      | ❌ Не загружен | BBR congestion control         |
| **br_netfilter** | ❌ Не загружен | Bridge netfilter (Docker nets) |

**BBR:**

```
net.ipv4.tcp_available_congestion_control = reno cubic
```

BBR **недоступен** — модуль tcp_bbr не загружен. Потребуется:

```bash
modprobe tcp_bbr
echo "tcp_bbr" >> /etc/modules-load.d/bbr.conf
sysctl -w net.ipv4.tcp_congestion_control=bbr
```

**Clocksource:**

- Текущий: `kvm-clock` — правильный выбор для KVM VM.
- Доступные: `kvm-clock`, `acpi_pm`.
- kvm-clock обеспечивает точное время с минимальным overhead в виртуализации.

### 5.6. Huge Pages

| Параметр            | Значение                |
| ------------------- | ----------------------- |
| HugePages_Total     | 0 (не сконфигурированы) |
| Hugepagesize        | 2048 kB (2 MB)          |
| AnonHugePages (THP) | 28,672 kB (28 MB)       |
| Свободная память    | **28 GB**               |

**Расчёт для PostgreSQL shared_buffers = 8 GB:**

- Нужно: `8 GB / 2 MB = 4,096` huge pages
- С запасом (+5%): `4,096 × 1.05 = 4,301` huge pages
- Размер: `4,301 × 2 MB = 8.4 GB`
- Доступно: **28 GB свободной памяти** — более чем достаточно

✅ Huge pages возможны. Рекомендация из аудита (4,301 pages) **подтверждена**.

---

## 6. Сводка: подтверждение/корректировка рекомендаций аудита

| Параметр из аудита                 | Рекомендация аудита | Подтверждено? | Корректировка                             |
| ---------------------------------- | ------------------- | ------------- | ----------------------------------------- |
| `effective_io_concurrency = 100`   | 100                 | ⚠️ Повысить   | **200** — диск масштабируется линейно     |
| `maintenance_io_concurrency = 100` | 100                 | ✅ Да         | 100 — для фоновых операций достаточно     |
| `huge_pages = 4301`                | 4301 × 2MB          | ✅ Да         | 28 GB свободно, 8.4 GB нужно              |
| BBR congestion control             | Включить            | ⚠️ Модуль нет | Нужен `modprobe tcp_bbr` перед настройкой |
| Docker live-restore                | Включить            | ❌ Выключен   | Обязательно включить                      |
| nftables firewall                  | Настроить           | ❌ Нет INPUT  | **КРИТИЧНО:** нет файервола для хоста     |

---

## 7. Ключевые выводы

### Сильные стороны

1. **Дисковая подсистема — выдающаяся.** 1.25M IOPS при 8K random read — в 15-96 раз
   выше оценок vpsbenchmarks.com. Для PostgreSQL это означает минимальные задержки на I/O.

2. **Стабильность — отличная.** Noisy neighbor тест показал отклонение ≤2.4% между
   запусками. Виртуализация не создаёт проблем с производительностью.

3. **CPU — адекватный.** 1,579 eps single-thread, 12,659 eps 12-thread. AMD EPYC 9645
   (Turin) обеспечивает хорошую производительность для web-приложений.

4. **Сеть — близка к максимуму.** 860 Mbit/s из 1 Gbit/s порта.

### Критические действия перед деплоем

1. **🔴 Настроить файервол (nftables INPUT chain)** — сервер открыт для всех портов.
2. **🔴 Включить Docker live-restore** — для zero-downtime обновлений dockerd.
3. **🟡 Загрузить tcp_bbr** — для оптимальной производительности TCP.
4. **🟡 Настроить ротацию Docker-логов** — предотвратить заполнение диска.
5. **🟢 Поднять effective_io_concurrency до 200** — раскрыть потенциал NVMe.
