# Backlog техдолга, найденного при аудите стека — 2026-08-01

> Найдено, но **намеренно не сделано**: выходит за scope §1.2 промпта (обновление версий).
> Каждый пункт — с доказательством и оценкой, чтобы не пришлось переоткрывать.

## A. Архитектура и мёртвый код

| # | Находка | Доказательство | Оценка |
| --- | --- | --- | --- |
| A1 | Код Modal жив вопреки коммиту `fa505c37` | `modal_client.py`, `prompts/modal_extraction.py`, ветки `use_modal` в `book_tasks.py:259,333,386,958`, `image_tasks.py:135`, `consistency_manager.py:618`; `MODAL_TOKEN_*` в окружении обоих прод-контейнеров | M — дочистка кода + удаление пина + чистка env |
| A2 | `GEMINI_LITE_MODEL` не имеет ни одного потребителя | grep по `backend/`: только `config.py:68` и `tests/core/test_config_gemini.py:9` | S — либо оживить tiering, либо удалить ключ |
| A3 | `GeminiConfig.model_*` хардкодит `gemini-3.5-flash` и используется в ключе кэша и метках метрик | `gemini_extractor.py:126-132, 447, 460, 463, 556, 561, 643` | S — включено в Волну 6 как 6.6, но сам факт расхождения источников истины шире |
| A4 | `ImagenService` называется по несуществующему более провайдеру, docstring говорит «через OpenRouter FLUX.2 Klein 4B» | `imagen_generator.py:347-351` | XS — переименование + docstring |
| A5 | `sentence-transformers` и `scikit-learn` в celery-образе без единого импорта | grep по `backend/`: 0 совпадений | включено в Волну 1 |
| A6 | GLiNER2-путь полностью реализован, но выключен флагом; `chapter_embeddings` в проде пуста | `ner_service.py`, `book_tasks.py:773,786,1053`; `COUNT(*)=0` | продуктовое решение: оживлять или удалять ~1,2 ГБ зависимостей |
| A7 | `backend/tests/services/test_image_generator_TEMPLATE.py` мокает `aiohttp.ClientSession`, которого нет в коде | единственные упоминания `aiohttp` во всём `backend/` | XS — удалить файл |

## B. Воспроизводимость сборки

| # | Находка | Доказательство | Предложение |
| --- | --- | --- | --- |
| B1 | **У бэкенда нет lock-файла вообще** | нет `uv.lock`, `poetry.lock`, `constraints.txt`; `pip install --no-cache-dir` без хешей | внедрить `constraints.txt`, генерируемый `uv pip compile --python-version 3.12`; **смена инструментария, требует согласования** |
| B2 | Ни один `apt-get`/`apk` не пинит версии | 5 Dockerfile | принятый компромисс; закрепление дороже выгоды |
| B3 | Образы без OCI-меток → связь с коммитом недоказуема | `docker image inspect` даёт только `com.docker.compose.*` | включено в Волну 5 как 5.10 |
| B4 | Фронтенд-образ не сохраняется, дистрибутив попадает в volume | `frontend/Dockerfile.prod:47` — финальный слой `alpine`, сервис в compose завершается | предложить сохранение образа с тегом-SHA либо публикацию SBOM |
| B5 | Тег `:latest` для собственных образов | `docker-compose.prod.yml:64,82,166,232` | перейти на теги по SHA коммита |

## C. Качество и гейты

| # | Находка | Доказательство | Оценка |
| --- | --- | --- | --- |
| C1 | `mypy.ini` с `ignore_errors = True` — типизация не проверяется | `mypy.ini` | L — отдельный type-debt цикл; блокирует смысл mypy 2.x |
| C2 | `tsconfig-build.json` со `strict: false` — прод-сборка не строгая | `frontend/tsconfig-build.json` | M; значимость вырастет при переходе на TS 6/7, где `strict: true` — дефолт |
| C3 | `mypy.ini` и `pyrightconfig.json` объявляют Python 3.11 при рантайме 3.12 | оба файла | XS |
| C4 | Нет `pyproject.toml`, конфиги размазаны по `pytest.ini` / `mypy.ini` / `pyrightconfig.json` / `.ruffignore` | — | M — консолидация; **требует согласования**, не делать вместе с обновлением ruff/black |
| C5 | GitHub Actions отключены на репозитории | `docs/superpowers/plans/2026-07-18-production-reliability-baseline.md` | входит в Task 1.2 плана надёжности |
| C6 | `--cov-fail-under=70` в `addopts` применяется к любому узкому прогону | `backend/pytest.ini` | XS — вынести гейт в CI-команду |

## D. Безопасность и конфигурация

| # | Находка | Доказательство | Оценка |
| --- | --- | --- | --- |
| D1 | Боевая конфигурация не версионируется: правки `Caddyfile` и `docker-compose.prod.yml` живут незакоммиченными и на проде, и локально | `git status --porcelain` в обоих местах даёт одинаковый набор | включено в Волну 0 как 0.8, требует согласования |
| D2 | На проде 3 бэкап-файла конфигов в рабочем дереве git | `Caddyfile.bak.20260701-013930`, `Caddyfile.bak2`, `docker-compose.prod.yml.backup-pre-postbox-20260718` | XS — вынести из репозитория |
| D3 | 127 обновляемых системных пакетов на хосте, включая security-обновления `bind9-*`, `curl`, `libc-bin` | `apt list --upgradable` | операция обслуживания, вне §12.2 |
| D4 | `docker-ce 29.2.1 → 29.7.0`, `docker-compose-plugin 5.1.0 → 5.3.1` доступны | там же | операция обслуживания |
| D5 | `OPENROUTER_IMAGE_MODEL` указывает на несуществующую модель | каталог OpenRouter, 336 моделей, FLUX отсутствует | включено в Волну 6 |
| D6 | `FALLBACK_MODELS` указывает на модели с выключением 2026-10-16 | официальная страница устареваний | включено в Волну 6 |

## E. Инфраструктура и мониторинг

| # | Находка | Доказательство | Оценка |
| --- | --- | --- | --- |
| E1 | `uptime-kuma` занимает 96 % своего лимита 128 МБ | `docker stats --no-stream` | XS — поднять лимит; включено в Волну 5 |
| E2 | `victoriametrics` 92 %, `netdata` 85 % от своих лимитов | там же | XS |
| E3 | `mher/flower:2.0.1` — образ не публиковался с 2023-08-13 | Docker Hub API | `REPLACE`, отдельное решение |
| E4 | Комментарий в `gunicorn.conf.py:5` говорит про «32GB/12vCPU», при `WORKERS_COUNT` по умолчанию 2 и лимите backend-контейнера 2 ГБ | `gunicorn.conf.py:5,14`; `docker stats` | XS — сверить и поправить |
| E5 | Ресурсные посылки в документации устарели: сервер имеет 31 ГБ RAM и 918 ГБ свободного диска, а `.claude/rules/docker.md` и часть докладов исходят из «4GB server» | `free -h`, `df -h` | XS |

## F. Отложенные обновления с условиями снятия

| Компонент | Решение | Условие снятия |
| --- | --- | --- |
| `redis-py` 8.1.0 | HOLD | kombu поднимет `redis<6.5` либо прогон Celery на RESP3 |
| TypeScript 6/7 | HOLD | релиз `typescript-eslint` с поддержкой TS ≥6.1, либо двойной alias `@typescript/native` + `@typescript/typescript6` |
| `mypy` 2.3.0 | HOLD | снятие `ignore_errors` (C1) |
| `epub.js` | HOLD | см. §6 основного отчёта |
| `@xmldom/xmldom` 0.9.10 через override | HOLD | регрессия читалки |
| PostgreSQL 18 | UPGRADE-STAGED | окно на dump/restore |
| Python 3.13/3.14 | HOLD | приближение EOL 3.12 (2028-10-31) или пакет, требующий >3.12 |
| `torch` / `gliner2` | HOLD | продуктовое решение по A6 |
