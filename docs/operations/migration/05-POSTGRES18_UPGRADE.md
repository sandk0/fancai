# Runbook: PostgreSQL 17 → 18

> Составлен по результатам локальной репетиции 2026-08-04 на dev-стеке.
> Каждая команда ниже выполнена и проверена; числа — замеренные, не оценочные.
>
> Мажорный апгрейд PostgreSQL **не переживает простую смену тега образа**:
> каталог данных 17 не читается сервером 18. Путь — `pg_dump` → новый том →
> `pg_restore`.

---

## 0. Что выяснила репетиция (читать до планирования окна)

**Главная находка: в образах 18+ сменилось место монтирования тома.**

`pgvector/pgvector:0.8.6-pg18` (как и upstream `postgres:18`) хранит данные
в каталоге с мажорной версией и отказывается стартовать, если том примонтирован
на прежний путь `/var/lib/postgresql/data` — **даже если том пустой**:

```
Error: in 18+, these Docker images are configured to store database data in a
       format which is compatible with "pg_ctlcluster" ...
       Counter to that, there appears to be PostgreSQL data in:
         /var/lib/postgresql/data (unused mount/volume)
```

Значит в `docker-compose.prod.yml` одним движением меняются **три** вещи:

| Что | Было | Стало |
| --- | --- | --- |
| образ сервера (строка 283) | `pgvector/pgvector:0.8.6-pg17` | `pgvector/pgvector:0.8.6-pg18` |
| монтирование тома (строка 312) | `postgres_data:/var/lib/postgresql/data` | `postgres_data:/var/lib/postgresql` |
| образ sidecar'а бэкапа (строка 361) | `prodrigestivill/postgres-backup-local:17` | `…:18` |

`PGDATA` внутри контейнера становится `/var/lib/postgresql/18/docker`.
Оба образа существуют в реестре — проверено `docker manifest inspect`.

**Второе:** том из-под 17 к серверу 18 подключать нельзя ни при какой
конфигурации. Восстанавливаемся в **новый** том, старый держим до сверки.

---

## 1. Предусловия

- Окно обслуживания. Прод останавливается на время дампа и восстановления.
- Свободное место: на боевой машине 919 GB при базе 88.71 MB (`02-BACKUP_INVENTORY.md`) — с запасом.
- Клиент `pg_dump` версии **18**. Клиентом 17 дампить для восстановления в 18
  не следует; в репетиции использовался одноразовый контейнер
  `pgvector/pgvector:0.8.6-pg18`.

Зафиксировать версии (в репетиции: сервер `PostgreSQL 17.10`,
клиент `pg_dump 18.4`, целевой сервер `PostgreSQL 18.4`).

---

## 2. Снять эталоны ДО дампа

Нужны для сверки после восстановления. `alembic check` **не будет пустым**:
в проекте есть доисторический дрейф (`chapters.parse_attempts`, индексы
`description_entities`, комментарии `llm_usage_log`). Сравнивать надо
с эталоном, а не с нулём.

```bash
docker exec fancai_backend alembic heads   > /tmp/pg18/heads_pg17.txt
docker exec fancai_backend alembic current > /tmp/pg18/current_pg17.txt
docker exec fancai_backend alembic check   > /tmp/pg18/check_pg17.txt 2>&1   # exit=255, это норма

docker exec fancai_postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc \
  "select extname||' '||extversion from pg_extension order by 1" > /tmp/pg18/ext_pg17.txt

docker exec fancai_postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc \
  "select 'books='||(select count(*) from books),
          'chapters='||(select count(*) from chapters),
          'entities='||(select count(*) from entities),
          'descriptions='||(select count(*) from descriptions),
          'users='||(select count(*) from users)" > /tmp/pg18/counts_pg17.txt
```

---

## 3. Дамп клиентом 18

```bash
docker run --rm --network app_fancai_network \
  -e PGPASSWORD="$DB_PASSWORD" -v /tmp/pg18:/dump \
  pgvector/pgvector:0.8.6-pg18 \
  pg_dump -h fancai_postgres -U "$DB_USER" -d "$DB_NAME" -Fc -f /dump/prod.pgc
```

`-Fc` обязателен: plain-SQL не читается `pg_restore` и не даёт выборочного
восстановления.

**Проверить пригодность дампа до остановки чего-либо:**

```bash
docker run --rm -v /tmp/pg18:/dump pgvector/pgvector:0.8.6-pg18 \
  pg_restore --list /dump/prod.pgc | head
ls -l /tmp/pg18/prod.pgc      # размер ненулевой
```

Оглавление должно содержать строку `Dumped from database version: 17.x`
и `Dumped by pg_dump version: 18.x`.

---

## 4. Переключение

Одним движением, по таблице из §0:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.monitoring.yml down postgres pgbackup
docker volume create app_postgres_data_pg18
# правки в docker-compose.prod.yml: тег сервера, путь тома, тег sidecar'а
docker compose -f docker-compose.prod.yml up -d postgres
docker compose -f docker-compose.prod.yml exec postgres pg_isready -U "$DB_USER"
```

Старый том `app_postgres_data` **не удалять** — это точка отката.

---

## 5. Восстановление

Расширения создаются до данных: дамп ссылается на тип `vector` в определениях
таблиц.

```bash
docker exec fancai_postgres psql -U "$DB_USER" -d "$DB_NAME" -c \
  'CREATE EXTENSION IF NOT EXISTS vector;
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'

docker run --rm --network app_fancai_network \
  -e PGPASSWORD="$DB_PASSWORD" -v /tmp/pg18:/dump \
  pgvector/pgvector:0.8.6-pg18 \
  pg_restore -h fancai_postgres -U "$DB_USER" -d "$DB_NAME" \
             --no-owner --no-privileges --exit-on-error /dump/prod.pgc
```

Флаги зафиксированы репетицией:

- `--no-owner`, `--no-privileges` — роли на целевом сервере создаются заново
  из `POSTGRES_USER`, владельцы из дампа неприменимы;
- `--exit-on-error` — иначе `pg_restore` досчитывает до конца и выходит с 0,
  оставив половину схемы.

---

## 6. Сверка (критерий успеха)

```bash
docker exec fancai_backend alembic heads      # ровно одна ревизия, без ветвлений
docker exec fancai_backend alembic current    # совпадает с heads
docker exec fancai_backend alembic check > /tmp/pg18/check_pg18.txt 2>&1

# Сравнивать после нормализации: в вывод попадают адреса Python-объектов
# (0x…) и порядок stdout/stderr, они различаются от запуска к запуску.
for f in check_pg17 check_pg18; do
  sed -E 's/0x[0-9a-f]+/0xADDR/g' /tmp/pg18/$f.txt | sort > /tmp/pg18/$f.norm
done
diff /tmp/pg18/check_pg17.norm /tmp/pg18/check_pg18.norm   # обязан быть пустым
```

Дальше:

- `select extversion from pg_extension where extname='vector'` → `0.8.6`;
- счётчики совпадают с `counts_pg17.txt`;
- smoke пайплайна зелёный против 18:

  ```bash
  docker exec -e OPENROUTER_API_KEY= -e GEMINI_API_KEY= fancai_celery \
    python scripts/smoke_llm_book_pipeline.py all
  ```

---

## 7. Время (замер репетиции)

База репетиции — 11 MB / 228 TOC-записей / 21 таблица.
Боевая — 88.71 MB, то есть примерно ×8.

| Шаг | Репетиция | Ожидание на проде |
| --- | ---: | --- |
| `pg_dump -Fc` (включая pull образа 18) | 24 с | pull разовый; сам дамп — секунды |
| старт сервера 18 на пустом томе | 4 с | 4–10 с |
| `pg_restore` | < 1 с | единицы секунд |
| smoke пайплайна (6 режимов) | 93 с | столько же, от размера БД не зависит |

**Окно: 15 минут** с запасом на сверку и откат. Собственно недоступность —
меньше минуты; остальное занимает проверка.

---

## 8. Откат

Ничего не удаляется до конца сверки, поэтому откат — возврат трёх правок
в `docker-compose.prod.yml` и старого тома:

```bash
docker compose -f docker-compose.prod.yml down postgres pgbackup
git checkout docker-compose.prod.yml          # тег сервера, путь тома, тег sidecar'а
docker compose -f docker-compose.prod.yml up -d postgres pgbackup
```

Том `app_postgres_data` (17) остаётся нетронутым всё время процедуры.
Удалять его — отдельным решением, после нескольких суток работы на 18.

---

## 9. Что репетиция НЕ покрыла

- Боевой объём данных: 88.71 MB против 11 MB. Порядок величин тот же,
  но время `pg_restore` на проде не измерялось.
- `postgres-backup-local:18` поднимался только как факт наличия образа;
  расписание бэкапов на 18 не проверялось.
- Настройки производительности (`shared_buffers=4GB` и прочие `-c` из
  `docker-compose.prod.yml:292-…`) в репетиции не применялись — сервер
  поднимался с дефолтами.
