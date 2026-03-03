# Задача: Бенчмарк и дополнительная валидация VPS-сервера

## Контекст

У нас есть полный аудит сервера: `docs/reports/2026-03-01-vps-audit-pre-setup.md`
(включая раздел 12 — углублённое исследование io_concurrency и критических рисков).

Сервер: netcup VPS 4000 G12 (12 vCPU AMD EPYC 9645, 32 GB RAM, 1 TB NVMe через virtio-blk).
ОС: Debian 13.3, Docker 29.2.1. Сервер ещё НЕ настроен — чистая установка.

Цель этой сессии — **запустить бенчмарки** для валидации рекомендаций из аудита
и **собрать недостающие данные**, которые не были получены в первом проходе.

## SSH-доступ

```
ssh root@v2202603341452437776.hotsrv.de
```

Пароль: `cMfT7QBTwzICiRj`

Используй `sshpass -p 'cMfT7QBTwzICiRj' ssh root@v2202603341452437776.hotsrv.de "..."` для подключения.

## Режим работы

**ДОПУСКАЕТСЯ установка benchmark-утилит** (fio, ioping, sysbench) — они будут удалены после.
**Всё остальное — ТОЛЬКО ЧТЕНИЕ. Не менять конфигурации, не перезапускать сервисы.**

---

## Часть 1: Бенчмарк дисковой подсистемы (для io_concurrency)

Аудит рекомендует `effective_io_concurrency = 100` на основе данных vpsbenchmarks.com (13K-82K IOPS).
Нужно измерить **реальные IOPS нашего конкретного сервера**.

### 1.1. Установка инструментов

```bash
apt update && apt install -y fio ioping sysstat
```

### 1.2. Базовый I/O бенчмарк (8K — размер страницы PostgreSQL)

```bash
# 8K random read — основной паттерн PostgreSQL (bitmap heap scan)
fio --name=pg_randread \
    --ioengine=libaio \
    --direct=1 \
    --rw=randread \
    --bs=8k \
    --size=2G \
    --numjobs=4 \
    --iodepth=32 \
    --runtime=60 \
    --time_based \
    --group_reporting \
    --filename=/tmp/fio_test
```

### 1.3. Mixed read/write (эмуляция реальной PG нагрузки)

```bash
# 70% read / 30% write — типичная web app нагрузка
fio --name=pg_mixed \
    --ioengine=libaio \
    --direct=1 \
    --rw=randrw \
    --rwmixread=70 \
    --bs=8k \
    --size=2G \
    --numjobs=4 \
    --iodepth=16 \
    --runtime=60 \
    --time_based \
    --group_reporting \
    --filename=/tmp/fio_test_mixed
```

### 1.4. Latency (критично для PG)

```bash
# Средняя задержка чтения 8K блоков
ioping -c 100 -s 8k /tmp/

# Последовательная запись (WAL workload)
ioping -c 100 -s 8k -W /tmp/
```

### 1.5. Последовательный I/O (seq scan, VACUUM, backup)

```bash
fio --name=pg_seqread \
    --ioengine=libaio \
    --direct=1 \
    --rw=read \
    --bs=256k \
    --size=2G \
    --numjobs=1 \
    --iodepth=4 \
    --runtime=30 \
    --time_based \
    --group_reporting \
    --filename=/tmp/fio_test_seq
```

### 1.6. Noisy neighbor тест (запусти 3 раза с интервалом 10 мин)

```bash
# Быстрый IOPS тест — запусти 3 раза и сравни результаты
for i in 1 2 3; do
  echo "=== Run $i ==="
  fio --name=quick_iops --ioengine=libaio --direct=1 --rw=randread \
      --bs=4k --size=512M --numjobs=1 --iodepth=64 --runtime=10 \
      --time_based --group_reporting --filename=/tmp/fio_quick 2>&1 | grep -E "IOPS|lat"
  sleep 600  # 10 минут между запусками
done
```

**Ключевые вопросы:**

- Сколько IOPS при 8K random read? (ожидаем 13K-82K по vpsbenchmarks)
- Какая средняя и p99 latency?
- Есть ли значительный разброс между запусками (noisy neighbors)?
- Подтверждает ли результат рекомендацию io_concurrency = 100?

---

## Часть 2: Бенчмарк CPU и памяти

### 2.1. CPU бенчмарк

```bash
apt install -y sysbench

# Однопоточный (показывает реальную частоту CPU)
sysbench cpu --cpu-max-prime=20000 --threads=1 run

# Многопоточный (12 vCPU)
sysbench cpu --cpu-max-prime=20000 --threads=12 run
```

### 2.2. Пропускная способность памяти

```bash
sysbench memory --memory-block-size=1M --memory-total-size=10G --threads=4 run
```

---

## Часть 3: Недостающие данные из аудита

В первом проходе аудита некоторые данные не были собраны. Собери их сейчас.

### 3.1. Детали AppArmor

```bash
aa-status 2>/dev/null
# Сколько профилей в enforce/complain/unconfined?
# Есть ли профиль docker-default?
```

### 3.2. Детали nftables (Docker rules)

```bash
# Полный набор правил (включая Docker)
nft list ruleset 2>/dev/null | head -100

# Какие таблицы создал Docker?
nft list tables
```

### 3.3. Docker info (подробно)

```bash
docker info 2>/dev/null | grep -E "Storage Driver|Logging Driver|Cgroup|Server Version|Live Restore|Default Runtime|Docker Root Dir|Security Options|Runtimes|Default Shm Size|Kernel Version|Operating System|Total Memory"
```

### 3.4. Сетевая производительность

```bash
# Скорость сети (если curl/wget доступны)
# Скачивание тестового файла из европейского CDN
curl -o /dev/null -w "Download Speed: %{speed_download} bytes/sec\n" \
    https://proof.ovh.net/files/100Mb.dat 2>/dev/null

# Или через dd + /dev/zero для записи
dd if=/dev/zero of=/tmp/speed_test bs=1M count=1024 oflag=dsync 2>&1 | tail -1

# DNS resolution speed
for i in 1 2 3; do
  time dig fancai.ru @46.38.252.230 +short 2>/dev/null
done
```

### 3.5. Проверка ext4 inode capacity

```bash
# Критично: Docker overlay2 может исчерпать inodes раньше дискового пространства
df -i /
df -i /var/lib/docker/

# Сколько inodes всего и какой процент использован?
```

### 3.6. Kernel modules и capabilities

```bash
# Проверить наличие модулей для BBR, nftables, overlay
lsmod | grep -E "tcp_bbr|nft|overlay|br_netfilter"

# Доступен ли BBR?
sysctl net.ipv4.tcp_available_congestion_control

# Проверить clocksource (важно для KVM)
cat /sys/devices/system/clocksource/clocksource0/current_clocksource
cat /sys/devices/system/clocksource/clocksource0/available_clocksource
```

### 3.7. Проверка huge pages capability

```bash
# Может ли система выделить 4301 huge pages (8.4 GB)?
# Проверяем доступность (НЕ выделяем!)
grep -i huge /proc/meminfo
cat /proc/sys/vm/nr_hugepages

# Сколько свободной памяти сейчас? (нужно >8.5 GB свободных для huge pages)
free -g
```

---

## Часть 4: Очистка

```bash
# Удалить тестовые файлы
rm -f /tmp/fio_test /tmp/fio_test_mixed /tmp/fio_test_seq /tmp/fio_quick /tmp/speed_test

# Удалить benchmark-утилиты (опционально — если хочешь чистый сервер)
apt remove -y fio ioping sysbench sysstat && apt autoremove -y
```

---

## Формат отчёта

Сохрани результаты в `docs/reports/2026-03-01-vps-benchmark-results.md`:

```markdown
# Бенчмарк VPS: netcup VPS 4000 G12

**Дата:** 2026-03-01
**Сервер:** netcup VPS 4000 G12

## 1. Дисковая подсистема

### Random Read 8K (PostgreSQL workload)

| Метрика     | Значение |
| ----------- | -------- |
| IOPS        | ...      |
| Bandwidth   | ...      |
| Avg Latency | ...      |
| p99 Latency | ...      |

### Mixed R/W 8K (70/30)

[аналогичная таблица]

### Sequential Read 256K

[аналогичная таблица]

### Latency (ioping)

| Тест           | Min | Avg | Max | p99 |
| -------------- | --- | --- | --- | --- |
| Random read 8K | ... | ... | ... | ... |
| Seq write 8K   | ... | ... | ... | ... |

### Noisy Neighbor Test (3 запуска)

| Запуск | IOPS | Отклонение от среднего |
| ------ | ---- | ---------------------- |
| 1      | ...  | ...                    |
| 2      | ...  | ...                    |
| 3      | ...  | ...                    |

### Вывод по io_concurrency

На основе измеренных IOPS:

- Рекомендация: effective_io_concurrency = ...
- Рекомендация: maintenance_io_concurrency = ...
- Обоснование: ...

## 2. CPU

| Тест                       | Результат |
| -------------------------- | --------- |
| Single-thread (events/sec) | ...       |
| 12-thread (events/sec)     | ...       |
| Масштабируемость (12t/1t)  | ...x      |

## 3. Память

| Метрика          | Значение |
| ---------------- | -------- |
| Memory bandwidth | ...      |

## 4. Сеть

| Метрика        | Значение |
| -------------- | -------- |
| Download speed | ...      |
| DNS resolution | ...      |

## 5. Недостающие данные

### AppArmor

[результаты]

### nftables

[результаты]

### Inodes

| FS  | Total | Used | Free | Use% |
| --- | ----- | ---- | ---- | ---- |
| /   | ...   | ...  | ...  | ...  |

### Kernel modules

[BBR, nft, overlay, clocksource]

### Huge pages capacity

[расчёт: доступно ли 4301 × 2MB = 8.4 GB?]

## 6. Сводка: подтверждение/корректировка рекомендаций аудита

| Параметр из аудита | Рекомендация | Подтверждено? | Корректировка |
| ------------------ | ------------ | ------------- | ------------- |
| e_i_c = 100        | ...          | ✅/❌         | ...           |
| m_i_c = 100        | ...          | ✅/❌         | ...           |
| huge_pages = 4301  | ...          | ✅/❌         | ...           |
| BBR congestion     | ...          | ✅/❌         | ...           |
```

## Важные ограничения

- **ДОПУСКАЕТСЯ** установка benchmark-утилит (fio, ioping, sysbench, sysstat)
- **НЕ ДОПУСКАЕТСЯ** изменение системных настроек (sysctl, nftables, sshd, docker)
- Удали тестовые файлы и утилиты после завершения
- Noisy neighbor тест займёт ~30 минут (3 запуска × 10 мин интервал) — можно запустить параллельно с другими тестами
- Группируй SSH-команды для эффективности
- Все пароли и IP-адреса в отчёте заменяй на `<REDACTED>`
