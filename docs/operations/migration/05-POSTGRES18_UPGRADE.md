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

Значит в `docker-compose.prod.yml` одним движением меняются **пять** строк:

| Что | Было | Стало |
| --- | --- | --- |
| образ сервера (`docker-compose.prod.yml:283`) | `pgvector/pgvector:0.8.6-pg17` | `pgvector/pgvector:0.8.6-pg18` |
| `PGDATA` (строка 291) | `PGDATA=/var/lib/postgresql/data/pgdata` | **строку удалить** — образ 18 сам ставит `/var/lib/postgresql/18/docker` |
| монтирование тома (строка 312) | `postgres_data:/var/lib/postgresql/data` | `postgres_data:/var/lib/postgresql` |
| целевой том (`volumes:` строка 390) | `postgres_data:` без `name:` → `app_postgres_data` | добавить `name: app_postgres_data_pg18` |
| образ sidecar'а бэкапа (строка 361) | `prodrigestivill/postgres-backup-local:17` | `…:18` |

Оба образа существуют в реестре — проверено `docker manifest inspect`.

Про `PGDATA` отдельно: если оставить явную переменную, образ 18 попытается
писать в `/var/lib/postgresql/data/pgdata` — то есть ровно в путь, который
он и отвергает. Строку надо именно удалить, а не поправить.

Про том отдельно: логическое имя `postgres_data` без `name:` разворачивается
в `app_postgres_data` — том из-под 17. Просто «создать новый том» рядом
недостаточно: пока в compose нет `name:`, сервер 18 получит старый том.
Явный `name: app_postgres_data_pg18` переключает ссылку и оставляет
`app_postgres_data` нетронутым как точку отката.

**Второе:** том из-под 17 к серверу 18 подключать нельзя ни при какой
конфигурации. Восстанавливаемся в **новый** том, старый держим до сверки.

**Третье:** сеть в `docker-compose.prod.yml` объявлена с явным
`name: fancai_network` (строка 411), поэтому в `docker run --network`
идёт `fancai_network` — без префикса проекта.

**Четвёртое, и это блокер окна: `/docker-entrypoint-initdb.d`.**
Найдено 2026-08-07, при подготовке боевого окна; в репетиции не всплыло,
потому что dev монтирует ДРУГОЙ файл (`./backend/sql/init.sql`), а
`./postgres/init/` существует только в прод-конфигурации и **не исполнялся
ни разу за всю жизнь прода**.

`docker-compose.prod.yml:320` монтирует `./postgres/init` в
`/docker-entrypoint-initdb.d:ro`. Эти скрипты запускаются **только при пустом
PGDATA** — то есть на текущем томе никогда, а на новом
`app_postgres_data_pg18` отработают впервые. Что там лежит:

| Файл | Что сделает | Последствие |
| --- | --- | --- |
| `postgres/init/01-extensions.sql:10` | `\c bookreader` | боевая база называется `fancai`; entrypoint гоняет `.sql` с `ON_ERROR_STOP=1`, файлы идут по алфавиту, значит этот падает ПЕРВЫМ и инициализация обрывается — **postgres не станет healthy посреди окна, до `pg_restore` дело не дойдёт** |
| `postgres/init/init.sql:12-16` | `ALTER SYSTEM SET log_statement='all'`, `log_connections`, `log_disconnections` | среди `-c` в compose этих параметров нет, перекрыть их некому: прод начнёт логировать каждый запрос |
| `postgres/init/01-extensions.sql:60` | роль `monitoring` с паролем `change_in_production_monitoring` | зашитый пароль в боевой БД |

Доказательства, что скрипты не отрабатывали (сняты с прода 2026-08-07):
`show log_statement` → `none`; роли — только `fancai`, никакой `monitoring`;
расширений `pg_stat_statements` и `btree_gin` нет.

**Что делать в окне:** снять монтирование init'а — это ШЕСТАЯ правка
в `docker-compose.prod.yml`, к пяти из таблицы выше. Расширения ставятся
явно в §5, восстановление идёт с `--no-owner --no-privileges`, поэтому
ни один из этих скриптов для переезда не нужен.

Отдельно от окна: скрипты ссылаются на имя базы, которого в проекте давно
нет, и держат зашитый пароль. Их стоит либо привести в порядок, либо удалить
— но это решение владельца, а не правка «по ходу» боевого окна.

---

## 1. Предусловия

- Окно обслуживания. Прод останавливается на время дампа и восстановления.
- Свободное место: на боевой машине 919 GB. База — **38 MB** (замерено
  2026-08-07 через `pg_database_size`); цифра 88.71 MB из
  `02-BACKUP_INVENTORY.md` устарела. Запас кратный.
- Клиент `pg_dump` версии **18**. Клиентом 17 дампить для восстановления в 18
  не следует; в репетиции использовался одноразовый контейнер
  `pgvector/pgvector:0.8.6-pg18`.

Зафиксировать версии (в репетиции: сервер `PostgreSQL 17.10`,
клиент `pg_dump 18.4`, целевой сервер `PostgreSQL 18.4`).

---

## 2. Снять эталоны ДО дампа

Подготовка окружения (все команды ниже полагаются на `$DB_USER`/`$DB_NAME`/
`$DB_PASSWORD` и каталог `/tmp/pg18`):

```bash
cd /path/to/fancai
set -a; . ./.env; set +a
mkdir -p /tmp/pg18

# Точка отката конфигурации: точная копия ДО правок, а не `git checkout`
cp docker-compose.prod.yml /tmp/pg18/docker-compose.prod.yml.pre-pg18
sha256sum docker-compose.prod.yml | tee /tmp/pg18/compose.sha256
```

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

## 3. Остановить писателей, потом снять дамп

**Порядок обязателен.** Дамп — это снимок на момент запуска `pg_dump`; всё,
что backend и Celery запишут после него, в новую базу не попадёт и потеряется
молча. Сначала гасим писателей, только потом дампим.

```bash
# 1. Перекрыть источник новых задач: HTTP-слой и планировщик.
#    Внимание: маршрута обслуживания в Caddyfile нет — с остановленным
#    backend'ом Caddy будет проксировать в мёртвый upstream и отдавать 502.
#    Если нужна заглушка вместо 502, её надо добавить в Caddyfile заранее.
docker compose -f docker-compose.prod.yml stop backend celery-beat

# 2. Заморозить потребление очередей. Без этого ожидание бесконечно:
#    prefetch=1 (celery_app.py:27), поэтому воркер добирает следующую задачу
#    из брокера сразу после текущей, и `active` никогда не опустеет,
#    пока в DB 1 что-то лежит.
CEL="docker exec fancai_celery celery -A app.core.celery_app"

$CEL inspect active_queues            # какие очереди реально потребляются
for q in heavy normal light; do $CEL control cancel_consumer "$q"; done
$CEL inspect active_queues            # ожидается "- empty -"

# Зафиксировать, сколько работы осталось в брокере: она переживёт окно
# и будет выполнена после возврата воркера.
set -a; . ./.env; set +a
for q in heavy normal light; do
  echo -n "$q="
  docker exec -e REDISCLI_AUTH="$REDIS_PASSWORD" fancai_redis redis-cli -n 1 llen "$q"
done | tee /tmp/pg18/broker_queues_pre.txt

# 3. Дать доработать тому, что уже выполняется. Потолок задачи — 30 минут
#    (task_time_limit=1800, celery_app.py:36), soft shutdown воркера — 120 с
#    (worker_soft_shutdown_timeout=120, :84), а stop_grace_period есть только
#    у postgres (:316) — воркеру Docker по умолчанию даёт 10 с и убивает.
$CEL inspect active     # повторять, пока не станет "- empty -"
$CEL inspect reserved   # уже забранные, но не начатые — тоже должны уйти

docker compose -f docker-compose.prod.yml stop -t 1900 celery-worker

# 4. Убедиться, что к базе больше никто не пишет.
docker exec fancai_postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc \
  "select count(*) from pg_stat_activity
    where datname = current_database()
      and pid <> pg_backend_pid()
      and state <> 'idle'"        # обязан быть 0

# 5. Авторитетный дамп — клиентом 18, сеть называется fancai_network
#    (в compose у неё явный name:, префикса проекта нет).
docker run --rm --network fancai_network \
  -e PGPASSWORD="$DB_PASSWORD" -v /tmp/pg18:/dump \
  pgvector/pgvector:0.8.6-pg18 \
  pg_dump -h fancai_postgres -U "$DB_USER" -d "$DB_NAME" -Fc -f /dump/prod.pgc
```

`-Fc` обязателен: plain-SQL не читается `pg_restore` и не даёт выборочного
восстановления.

**Проверить пригодность дампа до переключения тома:**

```bash
docker run --rm -v /tmp/pg18:/dump pgvector/pgvector:0.8.6-pg18 \
  pg_restore --list /dump/prod.pgc | head
ls -l /tmp/pg18/prod.pgc      # размер ненулевой
```

Оглавление должно содержать строку `Dumped from database version: 17.x`
и `Dumped by pg_dump version: 18.x`.

Писатели остаются погашенными до конца §6. Открывать трафик раньше сверки
нельзя: записи уйдут в базу, которую, возможно, придётся откатывать.

---

## 4. Переключение

Все правки из §0 вносятся в `docker-compose.prod.yml` **до** старта — их
**шесть**: тег сервера, удаление `PGDATA`, путь монтирования, `name:` тома,
тег sidecar'а и снятие монтирования `./postgres/init` (см. «Четвёртое» в §0:
без этого сервер 18 не пройдёт инициализацию и не станет healthy).

```bash
docker compose -f docker-compose.prod.yml stop postgres pgbackup

# правки в docker-compose.prod.yml — см. §0 (шесть строк, включая init)

docker compose -f docker-compose.prod.yml up -d postgres

# Доказать, что подключился НОВЫЙ том, а не app_postgres_data:
docker inspect fancai_postgres \
  --format '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{"\n"}}{{end}}'
# ожидается: app_postgres_data_pg18 -> /var/lib/postgresql

docker exec fancai_postgres sh -c 'echo $PGDATA'   # /var/lib/postgresql/18/docker
docker exec fancai_postgres psql -U "$DB_USER" -tAc 'select version()'
```

Если `docker inspect` показывает `app_postgres_data` — `name:` в блоке
`volumes:` не добавлен; останавливаться и править, не восстанавливая.

Старый том `app_postgres_data` **не удалять** — это точка отката.

---

## 5. Восстановление

Расширения создаются до данных: дамп ссылается на тип `vector` в определениях
таблиц.

**Список — по эталону с прода, а не по этому файлу.** Репетиция шла на dev,
а наборы расширений у dev и прода РАЗНЫЕ. Замер 2026-08-07:

| Стенд | Расширения |
| --- | --- |
| прод | `plpgsql 1.0`, `vector 0.8.2` — и всё |
| dev | `plpgsql 1.0`, `vector 0.8.6`, `pg_trgm 1.6`, `uuid-ossp 1.1` |

То есть прежняя редакция этого раздела ставила `pg_trgm` и `uuid-ossp`,
которых на проде НЕТ, — лишние объекты в боевой базе. Ставить надо ровно
то, что перечислено в `ext_pg17.txt` из §2 (`plpgsql` создаётся сам):

```bash
docker exec fancai_postgres psql -U "$DB_USER" -d "$DB_NAME" -c \
  'CREATE EXTENSION IF NOT EXISTS vector;'
```

**Побочный эффект, о котором надо знать заранее:** на проде SQL-версия
`vector` — `0.8.2`, хотя образ несёт 0.8.6 (`ALTER EXTENSION … UPDATE`
никто не делал). На новом томе `CREATE EXTENSION vector` без версии
поставит дефолт образа, то есть **0.8.6** — переезд неявно обновит
расширение. Если этого не хочется, версию надо задать явно:
`CREATE EXTENSION vector VERSION '0.8.2'`. Решение принять ДО окна
и записать в §6 как ожидаемое значение.

Затем данные:

```bash
docker run --rm --network fancai_network \
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

Backend остаётся выключенным: поднимать сервис ради проверок нельзя — Caddy
живой, и `/api/*` откроется до окончания сверки. Проверки гоняются
одноразовыми контейнерами того же образа (`--no-deps`, чтобы не поднять
за собой зависимости):

```bash
RUN="docker compose -f docker-compose.prod.yml run --rm --no-deps backend"

$RUN alembic heads      # ровно одна ревизия, без ветвлений
$RUN alembic current    # совпадает с heads
$RUN alembic check > /tmp/pg18/check_pg18.txt 2>&1

# Сравнивать после нормализации: в вывод попадают адреса Python-объектов
# (0x…) и порядок stdout/stderr, они различаются от запуска к запуску.
for f in check_pg17 check_pg18; do
  sed -E 's/0x[0-9a-f]+/0xADDR/g' /tmp/pg18/$f.txt | sort > /tmp/pg18/$f.norm
done
diff /tmp/pg18/check_pg17.norm /tmp/pg18/check_pg18.norm   # обязан быть пустым
```

Дальше:

- расширения совпадают с `ext_pg17.txt` из §2 — сравнивать со СНЯТЫМ
  эталоном, а не с числом в этом файле. Прежняя редакция требовала здесь
  `vector → 0.8.6`, что верно для dev и **неверно для прода**, где стоит
  `0.8.2`: критерий провалился бы на исправной миграции. Если в §5 принято
  решение обновить расширение — ожидаемым значением становится `0.8.6`,
  и это надо записать здесь до начала окна, а не решать по факту;
- счётчики совпадают с `counts_pg17.txt`;
- smoke пайплайна зелёный против 18:

  ```bash
  docker compose -f docker-compose.prod.yml run --rm --no-deps \
    -e OPENROUTER_API_KEY= -e GEMINI_API_KEY= backend \
    python scripts/smoke_llm_book_pipeline.py all
  ```

Только когда вся сверка выше зелёная — возвращать сервисы:

```bash
docker compose -f docker-compose.prod.yml up -d backend celery-worker celery-beat pgbackup

# Потребление очередей восстанавливается вместе с воркером; если он
# поднимался без перезапуска — вернуть подписки вручную:
for q in heavy normal light; do \
  docker exec fancai_celery celery -A app.core.celery_app control add_consumer "$q"; done
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

**Окно: не меньше 45 минут.** Складывается так:

| Слагаемое | Время |
| --- | --- |
| дренаж Celery: одна задача у самого лимита, очереди уже заморожены | до 30 мин |
| дамп, переключение, восстановление | ~1 мин |
| сверка, включая smoke | ~3 мин |
| запас на откат | ~10 мин |

Оценка «до 30 минут» верна **только после `cancel_consumer`**: пока
потребление не заморожено, воркер с `prefetch=1` берёт из брокера следующую
задачу за предыдущей, и дренаж не ограничен ничем, кроме длины очередей.
Если на входе `active`/`reserved` пусты, дренажа нет и всё укладывается
в 15 минут — но планировать окно надо по худшему случаю.

Задачи, оставшиеся в DB 1 (`broker_queues_pre.txt`), никуда не деваются:
брокерный том не трогается, и воркер разберёт их после возврата.

---

## 8. Откат

Ничего не удаляется до конца сверки, поэтому откат — возврат всех пяти
правок из таблицы §0 и старого тома:

```bash
docker compose -f docker-compose.prod.yml stop postgres pgbackup backend celery-worker celery-beat
# Возврат ИМЕННО той конфигурации, что была до окна (git checkout здесь
# опасен: он снесёт и посторонние правки, если они есть в рабочем дереве).
cp /tmp/pg18/docker-compose.prod.yml.pre-pg18 docker-compose.prod.yml
sha256sum -c /tmp/pg18/compose.sha256

docker compose -f docker-compose.prod.yml up -d postgres
docker inspect fancai_postgres \
  --format '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{"\n"}}{{end}}'
# ожидается снова: app_postgres_data -> /var/lib/postgresql/data

docker compose -f docker-compose.prod.yml up -d backend celery-worker celery-beat pgbackup
```

Том `app_postgres_data` (17) остаётся нетронутым всё время процедуры.
Удалять его — отдельным решением, после нескольких суток работы на 18.

---

## 9. Что репетиция проверила отдельно

Вторая прогонка — уже не «поднять 18», а именно те правки, которые предписаны
таблицей §0: том с явным `name:`, отсутствие `PGDATA`, монтирование
на `/var/lib/postgresql`. Результат:

```
rehearsal_postgres_data_pg18 -> /var/lib/postgresql
PGDATA=/var/lib/postgresql/18/docker
PostgreSQL 18.4
```

То есть `docker inspect` из §4 действительно доказывает подключение нового
тома, а не старого.

`cancel_consumer`/`add_consumer` из §3 и §6 проверены на dev-воркере:
после отмены `inspect active_queues` отдаёт `- empty -`, после
`add_consumer` подписка возвращается.

---

## 10. Что репетиция НЕ покрыла

- Боевой объём данных: 88.71 MB против 11 MB. Порядок величин тот же,
  но время `pg_restore` на проде не измерялось.
- `postgres-backup-local:18` поднимался только как факт наличия образа;
  расписание бэкапов на 18 не проверялось.
- Настройки производительности (`shared_buffers=4GB` и прочие `-c` из
  `docker-compose.prod.yml:292-…`) в репетиции не применялись — сервер
  поднимался с дефолтами.
