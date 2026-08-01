# Расхождения «прод ↔ репозиторий» — снимок 2026-08-01

> Снято строго read-only по §4.10 промпта. Никаких `up`/`down`/`restart`/`pull`/`build`,
> правок файлов, `apt upgrade` и `docker compose config` не выполнялось.
> Значения секретов не читались и не выводились — только имена ключей.
> Строки прикладных таблиц не выбирались — только агрегаты.

## 1. Как снималось

| Что | Команда |
| --- | --- |
| Доступ | алиас `ssh fancai` → `deploy@fancai-prod:2222` |
| Хост | `cat /etc/os-release`, `uname -a`, `free -h`, `df -h`, `apt list --upgradable` |
| Checkout | `git -C /opt/fancai/app rev-parse HEAD`, `branch --show-current`, `status --porcelain`, `diff --name-status`, `diff --cached --name-status` |
| Контейнеры | `docker compose -f docker-compose.prod.yml ps --format …` |
| Образы | `docker inspect <c> --format '{{.Image}} …'`, `docker image ls --format …`, `docker image inspect … --format '{{json .Config.Labels}}'` |
| Пакеты Python | `docker exec <c> pip list --format=freeze`, `pip show … Required-by`, `python -V` |
| Сервисы | `psql -V`, `SHOW server_version`, `SELECT extversion FROM pg_extension`, `redis-server -v`, `caddy version` |
| Нагрузка | агрегаты `COUNT`/`SUM`/`AVG` по `llm_usage_log`, `books`, `chapters`, `pg_database_size` |
| Env | `env \| grep -E '^(AI_PROVIDER\|GEMINI_BACKEND\|GCP_\*\|…)='` и отдельно **только имена** ключей с `KEY\|SECRET\|TOKEN\|PASSWORD\|CREDENTIALS` |

Логи прода не читались: для инвентаризации стека они не нужны, а содержат пользовательский контент.

## 2. Хост

| Параметр | Значение |
| --- | --- |
| ОС | Debian GNU/Linux 13 (trixie) |
| Ядро | 6.12.73+deb13-amd64, сборка 2026-02-17 |
| Архитектура | x86_64 |
| RAM | 31 ГБ всего, 7,1 ГБ занято, **24 ГБ available** |
| Swap | 4,0 ГБ, занято 192 МБ |
| Диск | `/dev/vda4` 1007 ГБ, занято 49 ГБ (**6 %**) |
| Docker | Engine 29.2.1 (доступна 29.7.0), Compose v5.1.0 (доступна 5.3.1) |
| Обновляемых пакетов | **127**, включая security для `bind9-*`, `curl`, `libc-bin` |

**Расхождение с посылкой промпта.** §4.10 предупреждает, что «сервер ограничен по памяти»
и что обновления, требующие больше RAM или диска, могут быть неприменимы физически.
Фактически ресурсных ограничений нет: свободно 24 ГБ RAM и 918 ГБ диска.
Ни одно обновление из плана в ресурсы не упирается.

## 3. Checkout

| Параметр | Значение |
| --- | --- |
| Каталог деплоя | **`/opt/fancai/app`** (в `/opt/fancai` git-репозитория нет) |
| Ветка | `main`, upstream `origin/main` |
| HEAD | `a1f899001b8ff23efd89dd68248ffd9cd36080b8` |
| Дата коммита | 2026-06-16 04:36:16 +0300 |
| Совпадение с локальным `main` | **да, полное** |

### 3.1. Незакоммиченные правки на проде

```
 M Caddyfile
 M docker-compose.prod.yml
?? Caddyfile.bak.20260701-013930
?? Caddyfile.bak2
?? docker-compose.prod.yml.backup-pre-postbox-20260718
?? monitoring/netdata/netdata.conf
```

Индекс пуст (`git diff --cached --name-status` — ничего).

Содержание правок:

| Файл | Правка |
| --- | --- |
| `Caddyfile` | IP-allowlist расширен с одного адреса `77.246.110.17` до четырёх: `+159.195.46.185 176.120.214.188 81.163.40.118` |
| `docker-compose.prod.yml` | +9 строк env для Yandex Cloud Postbox: `EMAIL_ENABLED`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `PASSWORD_RESET_BASE_URL`, `YANDEX_POSTBOX_{ACCESS_KEY,SECRET_KEY,ENDPOINT,REGION}` |

**Ключевое наблюдение.** Эти же два файла с **побайтово теми же изменениями** лежат
незакоммиченными и в локальном рабочем дереве. То есть правка была сделана и синхронизирована,
но не зафиксирована ни разу.

**Влияние на план обновления:** прямое. Перед релизом боевая конфигурация существует только
как diff в двух рабочих деревьях. Любой `git checkout`, `git stash` или пересоздание
каталога деплоя её потеряет. Вынесено в Волну 0 (пункт 0.8) и требует согласования,
так как это не обновление версии.

## 4. Образы и контейнеры

| Контейнер | Образ | Image ID | Создан | Аптайм |
| --- | --- | --- | --- | --- |
| `fancai_backend` | `fancai-backend:latest` | `664c6dd8846f` | 2026-07-17T21:48 | 2 недели |
| `fancai_beat` | `fancai-backend:latest` | `664c6dd8846f` | 2026-06-16T02:19 | 6 недель |
| `fancai_celery` | `fancai-celery:latest` | `3b0f01988a5c` | 2026-06-16T02:24 | 6 недель |
| `fancai_caddy` | `caddy:2.11.1-alpine` | `818bec5261db` | 2026-06-30T23:40 | 4 недели |
| `fancai_postgres` | `pgvector/pgvector:0.8.2-pg17` | `e34a81641384` | 2026-03-24T10:32 | 4 месяца |
| `fancai_redis` | `redis:7.4.8-alpine` | `aa189b5a1954` | 2026-03-03T22:59 | 5 месяцев |
| `fancai_pgbackup` | `prodrigestivill/postgres-backup-local:17` | — | — | 4 месяца |
| `fancai_netdata` | `netdata/netdata:v2.9.0` | — | — | 4 месяца |
| `fancai_victoriametrics` | `victoriametrics/victoria-metrics:v1.137.0` | — | — | 4 недели |
| `fancai_uptime_kuma` | `louislam/uptime-kuma:2.2.1` | — | — | 4 месяца |
| `fancai_dozzle` | `amir20/dozzle:v10.1.1` | — | — | 4 месяца |
| `fancai_flower` | `mher/flower:2.0.1` | — | — | 4 месяца |

Размеры собственных образов: `fancai-backend` **571 МБ**, `fancai-celery` **1,78 ГБ**
(seed промпта оценивал в ~2,5 ГБ).

### 4.1. Связь «образ ↔ коммит»

**Не доказуема.**

- `docker image inspect fancai-backend:latest --format '{{json .Config.Labels}}'` →
  `{"com.docker.compose.project":"app","com.docker.compose.service":"backend","com.docker.compose.version":"5.1.0"}`.
  Меток `org.opencontainers.image.revision`, `…created`, `…version` **нет**.
- `RepoDigests` пуст — образы собраны локально, не тянулись из реестра.
- SBOM не публиковался.

Косвенно: образ `fancai-backend:latest` собран 2026-06-16 03:44 CEST, коммит `a1f89900`
датирован 2026-06-16 04:36 +0300 (= 03:36 CEST). Разница 8 минут согласуется со сборкой
сразу после коммита, но доказательством не является.

`fancai_backend` и `fancai_beat` работают на **одном и том же** Image ID, несмотря на разный
аптайм — значит пересоздание backend 2026-07-17 не сопровождалось пересборкой образа.

### 4.2. Происхождение фронтенд-сборки

**Не доказуемо в принципе при текущей схеме.**

| Проверка | Результат |
| --- | --- |
| Образ `fancai-frontend` на хосте | **отсутствует** в `docker image ls` |
| Завершённый контейнер сборки | **отсутствует** в `docker ps -a` |
| OCI-метки | нет объекта, на котором они могли бы быть |
| SBOM | `docker sbom` доступен, но применять не к чему |
| Что раздаёт Caddy | volume `app_frontend_build` → `/var/www/frontend` (ro) |
| Дата создания volume | **2026-03-29T20:53:21+02:00** |
| mtime содержимого volume | 2026-03-29 18:53 UTC — совпадает со временем создания volume |
| Состав | `index.html` (10 517 Б, md5 `dda61dac253902eeabdca68e50c39185`), `assets/`, `js/`, `sw.js`, `manifest.json`, `offline.html`, `robots.txt`, `sitemap.xml`, `stats.html` |

Отдельно: bind-mount `/opt/fancai/app/frontend/dist` содержит **другой** снимок,
с mtime 2026-03-10 11:37. Caddy его не читает.

**Формулировка находки:** production раздаёт статический артефакт возрастом около четырёх
месяцев, исходный коммит которого установить нечем, при том что checkout ушёл вперёд
на 2,5 месяца. Возраст подтверждается временем создания volume и однородным mtime;
происхождение — не подтверждается ничем.

**Влияние на план:** Волна 3 и Волна 4 меняют фронтенд. Пока нет прослеживаемости сборки,
проверить, что в прод уехало именно обновлённое дерево, будет нечем. Отсюда пункт 5.10
(OCI-метки) и B4 в backlog.

## 5. Версии внутри контейнеров

### 5.1. Python

Оба контейнера — **Python 3.12.13**.

Сравнение нормализованного подмножества прямых зависимостей из `requirements.txt`
с `pip list --format=freeze` в `fancai_backend`:

| Категория | Результат |
| --- | --- |
| Запиненные `==` (49 шт.) | **совпадают все** |
| `hypothesis` (без пина) | образ 6.155.3 · резолв на 2026-08-01 → 6.164.0 |
| `modal>=0.73` | образ 1.5.0 · резолв на 2026-08-01 → 1.5.3 |

Это не «образ собран не из текущего main», а прямое доказательство недетерминированности
сборки: два прогона одного коммита дают разные деревья.

### 5.2. ML-слой celery

`torch 2.11.0+cpu`, `gliner2 1.2.4`, `gliner 0.2.27` (транзитив), `sentence-transformers 5.3.0`,
`scikit-learn 1.8.0`, `transformers 5.6.2`, `tokenizers 0.22.2`, `huggingface_hub 1.19.0`,
`scipy 1.17.1`, `numpy 2.4.6`, `sentencepiece 0.2.1`, `pgvector 0.4.2`.

### 5.3. Сервисы

| Сервис | Версия |
| --- | --- |
| PostgreSQL | 17.9 (Debian 17.9-1.pgdg12+1) |
| Расширения | `plpgsql 1.0`, `vector 0.8.2` |
| Redis | 7.4.8 (jemalloc-5.3.0) |
| Caddy | v2.11.1 |

## 6. AI-конфигурация прода

Только не-секретные значения:

| Переменная | `fancai_backend` | `fancai_celery` |
| --- | --- | --- |
| `AI_PROVIDER` | `gemini` | `gemini` |
| `GEMINI_BACKEND` | `vertex` | `vertex` |
| `GCP_LOCATION` | `global` | `global` |
| `GCP_PROJECT` | задан | задан |
| `ENVIRONMENT` | `production` | `production` |
| `DEBUG` | `false` | **не задана** |
| `EMAIL_ENABLED` | `true` | **не задана** |
| `GEMINI_EXTRACTION_MODEL` | **не задана** | **не задана** |
| `GEMINI_LITE_MODEL` | **не задана** | **не задана** |
| `GEMINI_IMAGE_MODEL` | **не задана** | **не задана** |

Имена присутствующих секретных ключей (значения не читались):
`GEMINI_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `OPENROUTER_API_KEY`, `SECRET_KEY`,
`HAWK_TOKEN`, `METRICS_PASSWORD`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `YANDEX_POSTBOX_ACCESS_KEY`,
`YANDEX_POSTBOX_SECRET_KEY` (последние два — только в backend).

**Расхождения:**

1. `AI_PROVIDER` в проде — `gemini`, дефолт `config.py:66` — `"openrouter"`.
   `GEMINI_BACKEND` в проде — `vertex`, дефолт `config.py:76` — `"developer"`.
   Боевое поведение корректно, но опирается на окружение, а не на код.
2. Модели `GEMINI_*_MODEL` не заданы → применяются дефолты `config.py`:
   `gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-3.1-flash-image`.
   Это упрощает Волну 6: смена дефолтов в коде изменит поведение прода без правки `.env`.
3. `MODAL_TOKEN_*` присутствуют в обоих контейнерах, хотя код Modal считается удалённым.
4. `DEBUG` и `EMAIL_ENABLED` заданы только в backend. Для `DEBUG` это безопасно
   (дефолт `False`), но асимметрия конфигурации стоит фиксации.

## 7. Нагрузка (агрегаты для модели стоимости)

| Метрика | Значение |
| --- | --- |
| Размер БД | 38 МБ |
| Книг | 16 |
| Глав | 554 |
| Средняя длина главы | 27 722 символа |
| Суммарный объём текста | 15,36 млн символов |
| Описаний | 950 |
| Сущностей | 802 |
| Сгенерированных изображений | 45 |
| Пользователей | 3 |
| `chapter_embeddings` | **0** |

`llm_usage_log`, агрегаты по моделям:

| Модель | Вызовов | Вход, ток. | Выход, ток. | Расчётная стоимость | Первая | Последняя |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `google/gemini-3-flash-preview` | 202 | 788 852 | 718 173 | $2,5281 | 2026-03-03 | 2026-03-27 |
| `black-forest-labs/flux.2-klein-4b` | 120 | 0 | 0 | $1,9200 | 2026-03-04 | 2026-03-29 |
| `gemini-3.5-flash` | 44 | 275 066 | 270 610 | $5,4201 | 2026-06-16 | 2026-06-22 |
| `google/gemini-3.1-flash-lite-preview` | 32 | 215 824 | 107 319 | $0,2149 | 2026-03-29 | 2026-03-29 |
| `qwen/qwen3.5-397b-a17b` | 9 | 99 199 | 175 677 | $0,6854 | 2026-03-30 | 2026-03-30 |
| `google/gemini-2.5-flash` | 7 | 26 691 | 3 383 | $0,0154 | 2026-06-16 | 2026-06-16 |
| `gemini-3.1-flash-image` | 5 | 0 | 0 | $0,3350 | 2026-06-16 | 2026-06-22 |

> **Столбец «Расчётная стоимость» — не биллинг Google.** Значения вычислены функцией
> `compute_cost` / `compute_image_cost` из `backend/app/core/gemini_pricing.py`,
> где таблица цен захардкожена в том же репозитории. Использовать их для подтверждения
> тарифов провайдера нельзя. Таблица отдельно сверена с официальной страницей цен
> на 2026-08-01 — расхождений не найдено, но это сверка двух документов, а не счёта.

Последняя запись — 2026-06-22: AI-нагрузки нет уже полтора месяца.
Поле `service` пусто во всех записях, поэтому атрибуция по шагам пайплайна невозможна.

## 8. Использование ресурсов контейнерами

| Контейнер | CPU | Память | % лимита |
| --- | ---: | --- | ---: |
| `fancai_backend` | 0,32 % | 347,9 MiB / 2 GiB | 17 % |
| `fancai_celery` | 0,18 % | 332,6 MiB / 4 GiB | 8 % |
| `fancai_beat` | 0,01 % | 147,6 MiB / 256 MiB | **58 %** |
| `fancai_postgres` | 0,00 % | 128,2 MiB / 12 GiB | 1 % |
| `fancai_redis` | 0,46 % | 17,4 MiB / 768 MiB | 2 % |
| `fancai_caddy` | 0,00 % | 16,2 MiB / 128 MiB | 13 % |
| `fancai_uptime_kuma` | 0,48 % | 123,2 MiB / 128 MiB | **96 %** |
| `fancai_victoriametrics` | 0,32 % | 236,2 MiB / 256 MiB | **92 %** |
| `fancai_netdata` | 5,75 % | 217,8 MiB / 256 MiB | **85 %** |
| `fancai_flower` | 0,10 % | 40,0 MiB / 128 MiB | 31 % |
| `fancai_dozzle` | 0,06 % | 10,9 MiB / 64 MiB | 17 % |
| `fancai_pgbackup` | 0,00 % | 8,9 MiB / 256 MiB | 3 % |

Лимит Redis — **768 МБ**, а не 640 МБ, как указано в seed промпта.
Три контейнера мониторинга работают у потолка своих лимитов; это отдельная находка (E1, E2).

## 9. Сводка расхождений и их влияние на план

| # | Расхождение | Влияние на план обновления |
| --- | --- | --- |
| 1 | Конфигурация прода не версионируется (`Caddyfile`, `docker-compose.prod.yml`) | **прямое** — Волна 0, пункт 0.8; требует согласования |
| 2 | Связь «образ ↔ коммит» недоказуема | **прямое** — Волна 5, пункт 5.10 (OCI-метки) |
| 3 | Происхождение фронтенд-сборки недоказуемо; артефакту ~4 месяца | **прямое** — после Волн 3–4 проверить прослеживаемость нечем |
| 4 | Плавающие пины дают разные деревья | **прямое** — Волна 0, пункты 0.1–0.2 |
| 5 | `AI_PROVIDER`/`GEMINI_BACKEND` заданы только в env | **прямое** — влияет на выбор дефолтов в Волне 6 |
| 6 | Модели заданы дефолтами кода, а не env | **упрощает** Волну 6 |
| 7 | `MODAL_TOKEN_*` в окружении прода | косвенное — учесть при дочистке Modal (A1) |
| 8 | Ресурсных ограничений нет (24 ГБ RAM свободно) | **снимает** ограничение, заложенное в промпте |
| 9 | Три контейнера мониторинга у потолка лимитов | Волна 5, пункт 5.7 |
| 10 | 127 обновляемых пакетов ОС, Docker 29.2.1 → 29.7.0 | вне scope (§12.2), в backlog D3/D4 |
| 11 | celery-образ 1,78 ГБ, а не 2,5 ГБ | корректирует ожидаемую выгоду Волны 1 |
