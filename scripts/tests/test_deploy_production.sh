#!/usr/bin/env bash
#
# BACKUP_DIR/COMPOSE_FILE/ENV_FILE выставляются тестами, а читают их
# функции из подключаемого скрипта — этой связи shellcheck не видит.
# shellcheck disable=SC2034
#
# Стенд для `deploy-production.sh`: проверяет логику выкатки без прода.
#
# Полный прогон против настоящего стека невозможен — скрипт делает
# `docker compose down` и `alembic upgrade head`, то есть на dev снёс бы
# единственный реальный EPUB, а на проде это и есть сама выкатка.
# Поэтому `docker`, `git` и `curl` подменяются функциями, а проверяется
# то, ради чего скрипт правился 2026-08-05:
#
#   1. бэкап падает на пустом дампе, а не проходит молча;
#   2. прежние образы сохраняются ДО сборки, иначе откатывать нечем;
#   3. собираются все три образа, включая celery;
#   4. build-only `frontend` не требуется «running»;
#   5. артефакт фронта проверяется по exit-коду и файлу в томе;
#   6. откат возвращает образы и НЕ трогает БД;
#   7. грязное рабочее дерево останавливает выкатку.
#
# Запуск: bash scripts/tests/test_deploy_production.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_SCRIPT="$SCRIPT_DIR/deploy-production.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0

check() {
    local label="$1" expected="$2" actual="$3"
    if [[ "$expected" == "$actual" ]]; then
        printf '  ok   %s\n' "$label"
        PASS=$((PASS + 1))
    else
        printf '  FAIL %s: ожидалось «%s», получено «%s»\n' "$label" "$expected" "$actual"
        FAIL=$((FAIL + 1))
    fi
}

# Скрипт заканчивается `case`, который сразу зовёт main. Для стенда
# берём всё до него: нужны определения функций, а не запуск.
prepare_sourceable() {
    sed '/^# Parse command line arguments$/,$d' "$DEPLOY_SCRIPT" > "$WORK/lib.sh"
}

# Общие стабы. Каждый тест доопределяет то, что ему нужно.
stub_common() {
    log() { :; }
    step() { :; }
    info() { :; }
    success() { :; }
    warning() { :; }
    error() { echo "ERROR: $*" >> "$WORK/errors.log"; }
    : > "$WORK/errors.log"
    : > "$WORK/docker.log"

    # В бою эти переменные приходят из `.env` через `validate_environment`.
    # Дефолтов у них намеренно нет: на этом проде база называется `fancai`,
    # а прежние умолчания `fancai_user`/`fancai_prod` увели бы restore
    # в несуществующую базу. Под `set -u` необъявленная переменная валит
    # оболочку, поэтому стенд обязан их задать — как это делает боевой путь.
    DB_USER="fancai"
    DB_NAME="fancai"
    REDIS_PASSWORD="S3CRET-STUB-VALUE"  # pragma: allowlist secret
}

run_case() {
    local name="$1"; shift
    printf '%s\n' "$name"
    local here="$PWD"
    "$@"
    cd "$here" || true
    # `source` подтягивает `set -euo pipefail` из самого скрипта; снимаем,
    # иначе первый же ожидаемо-неуспешный вызов оборвёт стенд.
    set +e
}

# --- 1. Бэкап падает на пустом дампе -------------------------------------

test_backup_rejects_empty_dump() {
    # shellcheck disable=SC1091
    source "$WORK/lib.sh"
    stub_common
    BACKUP_DIR="$WORK/backup1"
    ENV_FILE="$WORK/env"; echo "X=1" > "$ENV_FILE"
    COMPOSE_FILE="compose.yml"

    docker() {
        case "$*" in
            *"ps postgres"*) echo "Up (healthy)" ;;
            *pg_dump*)       : ;;   # молча ничего не пишет — как при отказе
            *)               : ;;
        esac
    }
    local rc=0
    create_backup > /dev/null 2>&1 || rc=$?
    check "пустой дамп останавливает выкатку" "1" "$rc"
    check "причина названа" "1" "$(grep -c 'suspiciously small' "$WORK/errors.log")"

    # Годный дамп: проверка описи обязана идти через МОНТИРОВАНИЕ каталога,
    # а не пайпом в контейнер. `pg_restore --list` требует seekable-вход,
    # и на пайпе падает «did not find magic string» на валидном дампе —
    # именно так первый боевой прогон отклонил корректный бэкап 16 МБ.
    : > "$WORK/errors.log"
    : > "$WORK/docker.log"
    BACKUP_DIR="$WORK/backup1b"
    mkdir -p "$BACKUP_DIR"
    backup_redis() { :; }
    backup_frontend_artifact() { :; }
    docker() {
        echo "$*" >> "$WORK/docker.log"
        case "$*" in
            *"ps postgres"*)  echo "Up (healthy)" ;;
            *pg_dump*)        head -c 20000 /dev/zero | tr '\0' 'D' ;;
            *"ps -q postgres"*) echo "pgcid" ;;
            *"Config.Image"*) echo "pgvector/pgvector:0.8.6-pg17" ;;
            *pg_restore*)     echo "4005; 0 24592 TABLE DATA public books fancai" ;;
        esac
        return 0
    }
    rc=0
    create_backup > /dev/null 2>&1 || rc=$?
    check "годный дамп принимается" "0" "$rc"
    check "опись читается монтированием каталога" "1" \
        "$(grep -c -- "-v $BACKUP_DIR:/b:ro" "$WORK/docker.log")"
    check "пайп в /dev/stdin не используется" "0" \
        "$(grep -c "/dev/stdin" "$WORK/docker.log")"
}

# --- 2 и 3. Образы сохраняются до сборки, собираются все три -------------

test_images_preserved_before_build() {
    # shellcheck disable=SC1091
    source "$WORK/lib.sh"
    stub_common
    BACKUP_DIR="$WORK/backup2"; mkdir -p "$BACKUP_DIR"
    COMPOSE_FILE="compose.yml"
    cd "$WORK" || return 1

    # Работающие контейнеры есть: сохраняем ИХ образ, а не подвижный тег
    docker() {
        echo "$*" >> "$WORK/docker.log"
        case "$*" in
            *"ps -q"*)     echo "container-id-$RANDOM" ;;
            *inspect*Image*) echo "sha256:deadbeefcafe" ;;
            *) return 0 ;;
        esac
    }

    preserve_current_images > /dev/null 2>&1 || true
    local tagged
    # `|| true`: при нуле совпадений `grep -c` возвращает 1, и под `set -e`
    # из подключённого скрипта присваивание уронило бы стенд целиком —
    # регрессия выглядела бы поломкой инструмента, а не падением теста.
    tagged=$(grep -c "^tag sha256:deadbeefcafe fancai-.*:rollback-" "$WORK/docker.log" || true)
    check "сохранён образ работающего контейнера" "3" "$tagged"
    check "подвижный тег :latest источником не берётся" "0" \
        "$(grep -c "^tag fancai-.*:latest " "$WORK/docker.log")"

    # Контейнера нет, но тег есть — запасной путь
    : > "$WORK/docker.log"
    docker() {
        echo "$*" >> "$WORK/docker.log"
        case "$*" in
            *"ps -q"*)        : ;;
            *"image inspect"*) return 0 ;;
            *) return 0 ;;
        esac
    }
    preserve_current_images > /dev/null 2>&1 || true
    check "без контейнера берётся тег" "3" \
        "$(grep -c "^tag fancai-.*:latest fancai-.*:rollback-" "$WORK/docker.log")"

    # Ни контейнера, ни тега — предупреждение, не падение
    : > "$WORK/docker.log"
    : > "$WORK/errors.log"
    docker() {
        echo "$*" >> "$WORK/docker.log"
        case "$*" in
            *"ps -q"*)         : ;;
            *"image inspect"*) return 1 ;;
            *) return 0 ;;
        esac
    }
    local rc=0
    preserve_current_images > /dev/null 2>&1 || rc=$?
    check "отсутствие источника не роняет выкатку" "0" "$rc"
    check "и ничего не тегируется" "0" "$(grep -c "^tag " "$WORK/docker.log")"

    # Возвращаем рабочий стаб для проверок ниже
    docker() {
        echo "$*" >> "$WORK/docker.log"
        case "$*" in
            *"ps -q"*)       echo "cid" ;;
            *inspect*Image*) echo "sha256:deadbeefcafe" ;;
            *) return 0 ;;
        esac
    }
    : > "$WORK/docker.log"
    preserve_current_images > /dev/null 2>&1 || true
    check "список записан рядом с бэкапом" "3" "$(wc -l < "$BACKUP_DIR/images.txt" | tr -d ' ')"

    : > "$WORK/docker.log"
    : > "$WORK/calls.log"
    git() { echo "abc1234"; }
    assert_build_absorbed_no_local_env() { echo env_check >> "$WORK/calls.log"; }
    build_images > /dev/null 2>&1 || true
    for svc in backend celery-worker frontend; do
        check "собирается $svc" "1" "$(grep -c -- "build --no-cache $svc" "$WORK/docker.log")"
    done
    # Проверка обязана быть ЧАСТЬЮ сборки, а не просто существовать
    check "сборка проверяет образы на env" "1" "$(grep -c env_check "$WORK/calls.log")"
}

# --- 4. health_check не ждёт build-only frontend -------------------------

test_health_check_ignores_frontend() {
    # shellcheck disable=SC1091
    source "$WORK/lib.sh"
    stub_common
    COMPOSE_FILE="compose.yml"

    docker() {
        # frontend завершён — как и задумано в compose
        case "$*" in
            *"ps frontend"*) echo "Exited (0) 2 minutes ago" ;;
            *ps*)            echo "Up 3 minutes (healthy)" ;;
        esac
    }

    local start rc=0
    start=$(date +%s)
    health_check > /dev/null 2>&1 || rc=$?
    local elapsed=$(( $(date +%s) - start ))

    check "проверка проходит" "0" "$rc"
    check "без ожидания в 5 минут" "1" "$([[ $elapsed -lt 15 ]] && echo 1 || echo 0)"
}

# --- 5. Артефакт фронта проверяется по результату ------------------------

test_frontend_publication() {
    # shellcheck disable=SC1091
    source "$WORK/lib.sh"
    stub_common
    COMPOSE_FILE="compose.yml"
    cd "$WORK" || return 1

    compose_volume() { echo "app_frontend_build"; }
    docker() { echo "$*" >> "$WORK/docker.log"; return 0; }

    # Публикация обязана быть частью старта: без неё Docker не обновит
    # непустой том, и Caddy продолжит отдавать прошлую сборку.
    : > "$WORK/docker.log"
    publish_frontend_artifact() { echo publish >> "$WORK/calls.log"; }
    : > "$WORK/calls.log"
    start_services > /dev/null 2>&1 || true
    check "старт публикует SPA в том" "1" "$(grep -c publish "$WORK/calls.log")"

    # Сама публикация: содержимое образа копируется в том
    unset -f publish_frontend_artifact
    # shellcheck disable=SC1091
    source "$WORK/lib.sh"
    stub_common
    compose_volume() { echo "app_frontend_build"; }
    docker() { echo "$*" >> "$WORK/docker.log"; return 0; }
    : > "$WORK/docker.log"
    BACKUP_DIR="$WORK/backup5"
    mkdir -p "$BACKUP_DIR"
    rm -f "$BACKUP_DIR/.spa-published"
    publish_frontend_artifact > /dev/null 2>&1 || true
    check "том монтируется в /target" "1" \
        "$(grep -c "app_frontend_build:/target" "$WORK/docker.log")"
    check "содержимое образа копируется" "1" \
        "$(grep -c "cp -a /var/www/html/. /target/" "$WORK/docker.log")"
    # Маркер нужен откату: без него он не отличит «том не трогали»
    # от «публикация прервалась на середине».
    check "публикация оставляет маркер" "1" \
        "$([[ -f "$BACKUP_DIR/.spa-published" ]] && echo 1 || echo 0)"
}

test_frontend_artifact_verification() {
    # shellcheck disable=SC1091
    source "$WORK/lib.sh"
    stub_common
    COMPOSE_FILE="compose.yml"

    compose_volume() { echo "app_frontend_build"; }
    docker() {
        case "$*" in
            *"State.ExitCode"*) echo "0" ;;
            *md5sum*)           printf 'aaa ./index.html\nbbb ./assets/js/ReaderPage-x.js\n' ;;
            *) return 0 ;;
        esac
    }
    : > "$WORK/docker.log"
    docker() {
        echo "$*" >> "$WORK/docker.log"
        case "$*" in
            *"State.ExitCode"*) echo "0" ;;
            *md5sum*)           printf 'aaa ./index.html\nbbb ./assets/js/ReaderPage-x.js\n' ;;
            *) return 0 ;;
        esac
    }
    local rc=0
    verify_frontend_artifact > /dev/null 2>&1 || rc=$?
    check "полное совпадение принимается" "0" "$rc"
    # Контракт: сверяется ВЕСЬ набор файлов. Ленивые чанки в index.html
    # не упоминаются, поэтому проверка по одному файлу пропустила бы
    # недопубликованный чанк читалки.
    check "сверяется весь набор файлов, а не index.html" "2" \
        "$(grep -c "find . -type f" "$WORK/docker.log")"

    # Ленивый чанк читалки отличается, а index.html совпадает.
    # Проверка только по index.html такое пропустила бы — и пропускала:
    # именно недопубликованный ленивый чанк вешает читалку.
    : > "$WORK/errors.log"
    docker() {
        case "$*" in
            *"State.ExitCode"*)      echo "0" ;;
            *"/var/www/html"*)       printf 'aaa ./index.html\nbbb ./assets/js/ReaderPage-x.js\n' ;;
            *md5sum*)                printf 'aaa ./index.html\nСТАРЫЙ ./assets/js/ReaderPage-x.js\n' ;;
            *) return 0 ;;
        esac
    }
    rc=0
    verify_frontend_artifact > /dev/null 2>&1 || rc=$?
    check "расхождение ленивого чанка отвергается" "1" "$rc"
    check "названа причина" "1" "$(grep -c "не совпадает" "$WORK/errors.log")"

    # Пустой том — тоже отказ
    : > "$WORK/errors.log"
    docker() {
        case "$*" in
            *"State.ExitCode"*) echo "0" ;;
            *"/var/www/html"*)  printf 'aaa ./index.html\n' ;;
            *) : ;;
        esac
        return 0
    }
    rc=0
    verify_frontend_artifact > /dev/null 2>&1 || rc=$?
    check "пустой том отвергается" "1" "$rc"

    docker() {
        case "$*" in
            *"State.ExitCode"*) echo "1" ;;
            *) return 0 ;;
        esac
    }
    rc=0
    verify_frontend_artifact > /dev/null 2>&1 || rc=$?
    check "ненулевой exit отвергается" "1" "$rc"
}

# --- 6. Откат возвращает образы и не трогает БД --------------------------

test_rollback_restores_images_only() {
    # shellcheck disable=SC1091
    source "$WORK/lib.sh"
    stub_common
    COMPOSE_FILE="compose.yml"
    cd "$WORK" || return 1
    echo "20260805_120000" > .last_image_tag
    local bdir="$WORK/backup6"
    mkdir -p "$bdir"
    printf 'tar%.0s' {1..500} > "$bdir/frontend_build.tar.gz"
    touch "$bdir/.spa-published"
    echo "$bdir" > .last_backup
    BACKUP_DIR="$bdir"

    docker() {
        echo "$*" >> "$WORK/docker.log"
        return 0
    }
    compose_volume() { echo "app_frontend_build"; }
    rollback > /dev/null 2>&1 || true

    check "образы возвращены" "3" "$(grep -c "^tag fancai-.*:rollback-20260805_120000 fancai-.*:latest" "$WORK/docker.log")"
    check "psql не вызывался" "0" "$(grep -c "psql" "$WORK/docker.log")"
    check "pg_restore не вызывался" "0" "$(grep -c "pg_restore" "$WORK/docker.log")"
    # Проект `app` общий с мониторингом: `down` пытается снести сеть,
    # к которой подключены его контейнеры.
    check "не вызывается down по всему проекту" "0" "$(grep -cE "^compose .* down( |$)" "$WORK/docker.log")"

    # SPA живёт в общем томе: откат образов её не вернёт, нужен архив
    check "SPA восстанавливается из архива" "1" \
        "$(grep -c "frontend_build.tar.gz" "$WORK/docker.log")"

    # Сценарий «упал бэкап»: маркера публикации нет, `.last_backup` указывает
    # на ПРОШЛУЮ выкатку. Том текущая выкатка не трогала — значит и откатывать
    # его нельзя, иначе SPA уедет на ещё более старую версию.
    : > "$WORK/docker.log"
    rm -f "$BACKUP_DIR/.spa-published"
    local stale="$WORK/backup-prev"
    mkdir -p "$stale"
    printf 'tar%.0s' {1..500} > "$stale/frontend_build.tar.gz"
    echo "$stale" > .last_backup

    rollback > /dev/null 2>&1 || true
    check "без публикации SPA не откатывается" "0" \
        "$(grep -c "frontend_build.tar.gz" "$WORK/docker.log")"
    check "и старый бэкап не используется" "0" \
        "$(grep -c "backup-prev" "$WORK/docker.log")"
}

# --- 7. Грязное дерево останавливает выкатку -----------------------------

test_update_code_refuses_dirty_tree() {
    # shellcheck disable=SC1091
    source "$WORK/lib.sh"
    stub_common

    # 1. Изменён отслеживаемый файл — блок
    git() {
        case "$*" in
            "rev-parse --git-dir") echo ".git" ;;
            "status --porcelain --untracked-files=no") echo " M Caddyfile" ;;
            *) return 0 ;;
        esac
    }
    local rc=0
    update_code > /dev/null 2>&1 || rc=$?
    check "правка отслеживаемого файла блокирует" "1" "$rc"
    check "причина названа" "1" "$(grep -c 'local changes' "$WORK/errors.log")"

    # 2. Untracked внутри контекста сборки — блок: файл уедет в образ
    : > "$WORK/errors.log"
    git() {
        case "$*" in
            "rev-parse --git-dir") echo ".git" ;;
            "status --porcelain --untracked-files=no") : ;;
            "ls-files --others --exclude-standard -- backend frontend")
                echo "backend/.env.local" ;;
            *) return 0 ;;
        esac
    }
    rc=0
    update_code > /dev/null 2>&1 || rc=$?
    check "untracked в build-контексте блокирует" "1" "$rc"
    check "причина про образ названа" "1" \
        "$(grep -c 'build context' "$WORK/errors.log")"

    # 3. Untracked вне контекстов — только предупреждение
    : > "$WORK/errors.log"
    git() {
        case "$*" in
            "rev-parse --git-dir") echo ".git" ;;
            "status --porcelain --untracked-files=no") : ;;
            "ls-files --others --exclude-standard -- backend frontend") : ;;
            "ls-files --others --exclude-standard") echo "Caddyfile.bak2" ;;
            "rev-parse --short HEAD") echo "abc1234" ;;
            *) return 0 ;;
        esac
    }
    rc=0
    update_code > /dev/null 2>&1 || rc=$?
    check "бэкап конфига выкатке не мешает" "0" "$rc"
    check "и не поднимает ошибку" "0" "$(grep -c ERROR "$WORK/errors.log")"
}

# --- 8. Порядок шагов выкатки --------------------------------------------
#
# Самое ценное утверждение файла. Дамп обязан сниматься при остановленных
# писателях и непосредственно перед миграцией: раньше он снимался ДО трёх
# `--no-cache` сборок, пока бэкенд и воркер продолжали писать, и ручной
# restore потерял бы всё, что накопилось за минуты сборки.

test_deploy_step_order() {
    # shellcheck disable=SC1091
    source "$WORK/lib.sh"
    stub_common
    BACKUP_DIR="$WORK/backup8"
    cd "$WORK" || return 1

    : > "$WORK/order.log"
    local step_name
    for step_name in check_prerequisites validate_environment update_code \
                     preserve_current_images build_images quiesce_writers \
                     create_backup purge_stale_queues run_migrations \
                     start_services health_check verify_frontend_artifact \
                     verify_deployment save_deployment_info; do
        eval "${step_name}() { echo ${step_name} >> '$WORK/order.log'; return 0; }"
    done
    docker() { return 0; }

    main > /dev/null 2>&1 || true

    local order
    order=$(tr '\n' ' ' < "$WORK/order.log")

    # `|| true` обязателен: без совпадения grep возвращает 1, и под `set -e`
    # из подключённого скрипта присваивание уронило бы весь стенд. Тогда
    # настоящая регрессия выглядела бы поломкой стенда, а не падением теста.
    line_of() { grep -n "^$1$" "$WORK/order.log" | head -1 | cut -d: -f1 || true; }

    local build quiesce backup migrate start
    build=$(line_of build_images)
    quiesce=$(line_of quiesce_writers)
    backup=$(line_of create_backup)
    migrate=$(line_of run_migrations)
    start=$(line_of start_services)

    check "сборка идёт до остановки писателей" "1" \
        "$([[ -n "$build" && -n "$quiesce" && "$build" -lt "$quiesce" ]] && echo 1 || echo 0)"
    check "дамп снимается после остановки писателей" "1" \
        "$([[ -n "$backup" && "$quiesce" -lt "$backup" ]] && echo 1 || echo 0)"
    check "миграции идут после дампа" "1" \
        "$([[ -n "$migrate" && "$backup" -lt "$migrate" ]] && echo 1 || echo 0)"
    check "сервисы поднимаются после миграций" "1" \
        "$([[ -n "$start" && "$migrate" -lt "$start" ]] && echo 1 || echo 0)"
    check "очередь чистится между дампом и миграцией" "1" \
        "$(p=$(line_of purge_stale_queues); [[ -n "$p" && "$backup" -lt "$p" && "$p" -lt "$migrate" ]] && echo 1 || echo 0)"

    if [[ "$FAIL" -gt 0 ]]; then
        printf '       фактический порядок: %s\n' "$order"
    fi
}

# --- 10. Ни один шаг не трогает чужие контейнеры -------------------------
#
# Прод и мониторинг живут в ОДНОМ compose-проекте `app`: у `fancai_flower`,
# `fancai_netdata`, `fancai_victoriametrics`, `fancai_dozzle`
# и `fancai_uptime_kuma` та же метка `com.docker.compose.project`, только
# другой файл — проверено `docker inspect` на живом проде 2026-08-05.
# Compose считает сирот по метке проекта, поэтому `--remove-orphans`
# в прод-файле снёс бы весь мониторинг заодно. И `prune` тоже нельзя.

test_no_step_touches_foreign_containers() {
    # shellcheck disable=SC1091
    source "$WORK/lib.sh"
    stub_common
    COMPOSE_FILE="compose.yml"
    cd "$WORK" || return 1

    docker() { echo "$*" >> "$WORK/docker.log"; return 0; }
    git() { echo "abc1234"; }

    quiesce_writers   > /dev/null 2>&1 || true
    start_services    > /dev/null 2>&1 || true
    build_images      > /dev/null 2>&1 || true

    check "нет --remove-orphans" "0" \
        "$(grep -c -- "--remove-orphans" "$WORK/docker.log")"
    check "нет container prune" "0" \
        "$(grep -c "container prune" "$WORK/docker.log")"
    check "нет image prune" "0" \
        "$(grep -c "image prune" "$WORK/docker.log")"
    check "остановка адресная, а не по всему проекту" "0" \
        "$(grep -cE "^compose -f [^ ]+ (stop|down)$" "$WORK/docker.log")"
}

# --- 11. Redis снимается штатно и до необратимой очистки -----------------
#
# `purge_stale_queues` делает `DEL light` — это необратимо. Раскладка
# Redis в проекте load-bearing: DB 0 держит `parsing_queue`
# и `global_parsing_lock`, DB 1 — брокер Celery, DB 2 — результаты.
# Копировать `dump.rdb` из-под работающего Redis без BGSAVE нельзя:
# снимок будет рваным.

test_redis_snapshot_before_purge() {
    # shellcheck disable=SC1091
    source "$WORK/lib.sh"
    stub_common
    COMPOSE_FILE="compose.yml"
    BACKUP_DIR="$WORK/backup11"
    mkdir -p "$BACKUP_DIR"
    cd "$WORK" || return 1

    # Счётчик обязан быть файловым: `$(...)` порождает подоболочку,
    # и присваивание внутри неё теряется — LASTSAVE «не менялся» бы,
    # а функция честно ждала бы свои 60 секунд.
    echo 1 > "$WORK/lastsave"
    docker() {
        echo "$*" >> "$WORK/docker.log"
        case "$*" in
            *LASTSAVE*)
                local n; n=$(cat "$WORK/lastsave")
                echo "$n"
                echo $((n + 1)) > "$WORK/lastsave"
                ;;
            *"cp "*) printf 'REDIS0011%.0s' {1..20} > "$BACKUP_DIR/redis-dump.rdb" ;;
        esac
        return 0
    }

    local rc=0
    backup_redis > /dev/null 2>&1 || rc=$?

    check "снимок снят" "0" "$rc"
    check "вызван BGSAVE" "1" "$(grep -c "BGSAVE" "$WORK/docker.log")"
    check "RDB скопирован наружу" "1" "$(grep -c "cp .*dump.rdb" "$WORK/docker.log")"
    check "нет обращений к fancai_*_data" "0" \
        "$(grep -c "fancai_postgres_data\|fancai_redis_data" "$WORK/docker.log")"
    # Проверяем само ЗНАЧЕНИЕ во всей строке команды, а не шаблон флага:
    # секрет одинаково утекает и через `redis-cli -a`, и через
    # `docker compose -e VAR=value` в argv хоста.
    check "значение секрета не попадает в argv" "0" \
        "$(grep -c "S3CRET-STUB-VALUE" "$WORK/docker.log")"

    # Пустой снимок обязан останавливать выкатку
    : > "$WORK/docker.log"
    rm -f "$BACKUP_DIR/redis-dump.rdb"
    docker() {
        echo "$*" >> "$WORK/docker.log"
        case "$*" in
            *LASTSAVE*)
                local n; n=$(cat "$WORK/lastsave")
                echo "$n"
                echo $((n + 1)) > "$WORK/lastsave"
                ;;
            *"cp "*) : > "$BACKUP_DIR/redis-dump.rdb" ;;
        esac
        return 0
    }
    rc=0
    backup_redis > /dev/null 2>&1 || rc=$?
    check "пустой снимок отвергается" "1" "$rc"

    # Отдельно: снимок обязан быть ЧАСТЬЮ бэкапа, а не просто существовать
    # как функция. Иначе вызов можно потерять, и очистка очереди пройдёт
    # без страховки.
    BACKUP_DIR="$WORK/backup11b"
    mkdir -p "$BACKUP_DIR"
    ENV_FILE="$WORK/env11"; echo "X=1" > "$ENV_FILE"
    : > "$WORK/calls.log"

    backup_redis() { echo backup_redis >> "$WORK/calls.log"; }
    backup_frontend_artifact() { echo backup_frontend_artifact >> "$WORK/calls.log"; }
    docker() {
        case "$*" in
            *"ps postgres"*)    echo "Up (healthy)" ;;
            *pg_dump*)          head -c 20000 /dev/zero | tr '\0' 'D' ;;
            *"ps -q postgres"*) echo "pgcid" ;;
            *"Config.Image"*)   echo "pgvector/pgvector:0.8.6-pg17" ;;
            *pg_restore*)       echo "4005; 0 24592 TABLE DATA public books fancai" ;;
        esac
        return 0
    }
    rc=0
    create_backup > /dev/null 2>&1 || rc=$?

    check "бэкап с годным дампом проходит" "0" "$rc"
    check "create_backup зовёт снимок Redis" "1" "$(grep -c backup_redis "$WORK/calls.log")"
    check "create_backup архивирует SPA" "1" \
        "$(grep -c backup_frontend_artifact "$WORK/calls.log")"
}

# --- 9. Восстановление БД останавливает писателей ------------------------
#
# `restore-db` вызывается напрямую из разбора аргументов, минуя `main()`.
# Значит окружение он обязан загрузить сам (иначе `DB_USER`/`DB_NAME`
# пусты и restore уйдёт в никуда), а `pg_restore --clean` делает
# DROP/CREATE — под живыми backend и celery это гонки. Особенно после
# `rollback`, который поднимает весь стек обратно.

test_restore_quiesces_writers_first() {
    # shellcheck disable=SC1091
    source "$WORK/lib.sh"
    stub_common
    COMPOSE_FILE="compose.yml"
    ENV_FILE="$WORK/env.restore"
    cd "$WORK" || return 1

    local dump_dir="$WORK/backup9"
    mkdir -p "$dump_dir"
    printf 'PGDMP%.0s' {1..3000} > "$dump_dir/database.dump"

    : > "$WORK/order.log"
    check_prerequisites() { echo check_prerequisites >> "$WORK/order.log"; }
    validate_environment() {
        echo validate_environment >> "$WORK/order.log"
        DB_USER="fancai"; DB_NAME="fancai"
    }
    quiesce_writers()  { echo quiesce_writers  >> "$WORK/order.log"; }
    start_services()   { echo start_services   >> "$WORK/order.log"; }
    health_check()     { echo health_check     >> "$WORK/order.log"; return 0; }
    docker() {
        [[ "$*" == *pg_restore* ]] && echo pg_restore >> "$WORK/order.log"
        return 0
    }
    # Подтверждение читается со stdin
    restore_database_manually "$dump_dir" <<< "RESTORE" > /dev/null 2>&1 || true

    pos() { grep -n "^$1$" "$WORK/order.log" | head -1 | cut -d: -f1 || true; }
    local envload quiesce restore starts
    envload=$(pos validate_environment)
    quiesce=$(pos quiesce_writers)
    restore=$(pos pg_restore)
    starts=$(pos start_services)

    check "окружение загружается до restore" "1" \
        "$([[ -n "$envload" && -n "$restore" && "$envload" -lt "$restore" ]] && echo 1 || echo 0)"
    check "писатели остановлены до pg_restore" "1" \
        "$([[ -n "$quiesce" && -n "$restore" && "$quiesce" -lt "$restore" ]] && echo 1 || echo 0)"
    check "сервисы поднимаются после restore" "1" \
        "$([[ -n "$starts" && "$restore" -lt "$starts" ]] && echo 1 || echo 0)"

    # Без подтверждения восстановление не запускается вовсе
    : > "$WORK/order.log"
    restore_database_manually "$dump_dir" <<< "нет" > /dev/null 2>&1 || true
    check "без слова RESTORE ничего не делается" "0" \
        "$(grep -c "^pg_restore$" "$WORK/order.log")"
}

# --- 12. Сборка не впитывает локальное окружение -------------------------
#
# Утечка бывает двух видов, и проверяются они по-разному. В backend/celery
# `COPY . .` кладёт сами файлы: в БОЕВОМ образе лежали `.env.development`
# и `.env.production.example` с ключами ADMIN_PASSWORD и JWT_SECRET_KEY.
# У фронта файла в финальном образе нет вовсе — значения ВКОМПИЛИРОВАНЫ
# в JS, поэтому проверка на `.env*` там была бы вечнозелёной.

test_build_rejects_absorbed_local_env() {
    # shellcheck disable=SC1091
    source "$WORK/lib.sh"
    stub_common
    COMPOSE_FILE="compose.yml"
    cd "$WORK" || return 1

    docker() {
        case "$*" in
            *"baseURL:.{0,50}"*) echo 'baseURL:`/api/v1`' ;;
        esac
        return 0
    }
    local rc=0
    assert_build_absorbed_no_local_env > /dev/null 2>&1 || rc=$?
    check "чистая сборка принимается" "0" "$rc"

    : > "$WORK/errors.log"
    docker() {
        case "$*" in
            *fancai-backend:latest*)   echo ".env.development" ;;
            *"baseURL:.{0,50}"*) echo 'baseURL:`/api/v1`' ;;
        esac
        return 0
    }
    rc=0
    assert_build_absorbed_no_local_env > /dev/null 2>&1 || rc=$?
    check "env-файл в backend отвергается" "1" "$rc"
    check "имя файла названо" "1" "$(grep -c ".env.development" "$WORK/errors.log")"

    : > "$WORK/errors.log"
    docker() {
        case "$*" in
            *"ls -a /app"*)            echo ".env.example" ;;
            *"baseURL:.{0,50}"*) echo 'baseURL:`/api/v1`' ;;
        esac
        return 0
    }
    rc=0
    assert_build_absorbed_no_local_env > /dev/null 2>&1 || rc=$?
    check "образец .env.example допустим" "0" "$rc"

    # Абсолютный адрес — отказ, причём ЛЮБОЙ домен, не только свой
    : > "$WORK/errors.log"
    docker() {
        case "$*" in
            *"baseURL:.{0,50}"*)
                printf 'baseURL:`https://other.example`\nbaseURL:`/api/v1`\n' ;;
        esac
        return 0
    }
    rc=0
    assert_build_absorbed_no_local_env > /dev/null 2>&1 || rc=$?
    check "чужой абсолютный домен отвергается" "1" "$rc"

    # Маркер исчез — тоже отказ, иначе проверка выше вечнозелёная
    : > "$WORK/errors.log"
    docker() { return 0; }
    rc=0
    assert_build_absorbed_no_local_env > /dev/null 2>&1 || rc=$?
    check "пропавший относительный baseURL отвергается" "1" "$rc"
}

# --- 13. Обновившийся скрипт перезапускает сам себя ----------------------
#
# `git merge` заменяет и сам `deploy-production.sh`. Bash читает скрипт
# по мере исполнения, по байтовым смещениям: проверено экспериментом —
# переписавший себя скрипт МОЛЧА прекращает работу с кодом 0. Для выкатки
# это «успешный» прогон, который ничего не сделал. Поэтому после сдвига
# HEAD обязателен `exec`, и обязателен ДО первого изменения прода.

test_update_code_reexecs_after_change() {
    # shellcheck disable=SC1091
    source "$WORK/lib.sh"
    stub_common
    cd "$WORK" || return 1

    # HEAD сдвинулся — обязан быть exec
    : > "$WORK/exec.log"
    # Счётчик файловый: `$(...)` — подоболочка, присваивание в ней теряется,
    # и обе выдачи HEAD оказались бы одинаковыми.
    echo 0 > "$WORK/head_seq"
    git() {
        case "$*" in
            "rev-parse --git-dir") echo ".git" ;;
            "status --porcelain --untracked-files=no") : ;;
            "ls-files --others --exclude-standard -- backend frontend") : ;;
            "ls-files --others --exclude-standard") : ;;
            "rev-parse --short HEAD")
                local n; n=$(cat "$WORK/head_seq")
                echo $((n + 1)) > "$WORK/head_seq"
                if [[ "$n" -eq 0 ]]; then echo "aaaaaaa"; else echo "bbbbbbb"; fi ;;
            *) return 0 ;;
        esac
    }
    exec() { echo "exec $*" >> "$WORK/exec.log"; }
    unset DEPLOY_REEXEC
    update_code > /dev/null 2>&1 || true
    check "сдвиг HEAD вызывает перезапуск" "1" "$(grep -c '^exec bash' "$WORK/exec.log")"

    # HEAD не менялся — перезапуска быть не должно
    : > "$WORK/exec.log"
    git() {
        case "$*" in
            "rev-parse --git-dir") echo ".git" ;;
            "status --porcelain --untracked-files=no") : ;;
            "ls-files --others --exclude-standard"*) : ;;
            "rev-parse --short HEAD") echo "aaaaaaa" ;;
            *) return 0 ;;
        esac
    }
    update_code > /dev/null 2>&1 || true
    check "без изменений перезапуска нет" "0" "$(grep -c '^exec' "$WORK/exec.log")"

    # Повторный заход с маркером — не зацикливаемся
    : > "$WORK/exec.log"
    echo 0 > "$WORK/head_seq"
    git() {
        case "$*" in
            "rev-parse --git-dir") echo ".git" ;;
            "status --porcelain --untracked-files=no") : ;;
            "ls-files --others --exclude-standard"*) : ;;
            "rev-parse --short HEAD")
                local n; n=$(cat "$WORK/head_seq")
                echo $((n + 1)) > "$WORK/head_seq"
                if [[ "$n" -eq 0 ]]; then echo "aaaaaaa"; else echo "bbbbbbb"; fi ;;
            *) return 0 ;;
        esac
    }
    DEPLOY_REEXEC=1 update_code > /dev/null 2>&1 || true
    check "с маркером повторного exec нет" "0" "$(grep -c '^exec' "$WORK/exec.log")"

    unset -f exec
    # Симметрично `exec`: стаб `git` живёт до конца процесса, а `run_case`
    # гоняет все кейсы в одном. Не сняв его здесь, мы ломаем следующий тест.
    unset -f git
}

# --- 13b. Вывод git никогда не уходит в `head` ----------------------------
#
# Регрессия 2026-08-05. `git --no-pager log --oneline "$a..$b" | head -20`
# при выкатке 41 коммита убил скрипт молча: `head` закрывает пайп, git
# получает EPIPE и завершается кодом 141, а `set -Eeuo pipefail` делает
# из этого немедленный выход — ДО `exec` ниже. Выкатка не сделала ничего,
# журнал оборвался на списке коммитов без единого слова об ошибке.
#
# Проверка намеренно ПО ИСХОДНИКУ, а не поведением, и это осознанный выбор.
# Падение — гонка: git должен не успеть дописать вывод до выхода `head`.
# На боевом хосте (git 2.47.3, настоящая история) она воспроизводится
# стабильно, а на macOS и в alpine с git 2.52 на синтетическом репозитории
# из 41 коммита — не воспроизводится вовсе, даже когда вывод заведомо
# больше буфера пайпа. Поведенческая версия этого теста была написана
# и отвергнута измерением: она давала «ok» на заведомо сломанном коде
# в обеих средах, то есть удостоверяла дефект как покрытый.
# Опасна сама конструкция — её и запрещаем.
test_git_output_is_never_piped_to_head() {
    local offenders
    offenders=$(grep -nE '^[^#]*git[^|]*\|[[:space:]]*head' "$DEPLOY_SCRIPT" || true)
    check "вывод git не уходит в head" "" "$offenders"
}

# --- 14. Провал шага действительно вызывает откат -------------------------
#
# `trap rollback ERR` вооружается ВНУТРИ `main()`, то есть внутри функции.
# Без `set -E` (errtrace) ERR-trap функциями НЕ наследуется: провал любого
# шага завершал скрипт по `set -e`, не вызвав откат ни разу. Именно так
# третья попытка выкатки 2026-08-05 оборвалась без единой строки от
# `rollback` и оставила писателей остановленными.
#
# Прогон обязан идти ОТДЕЛЬНЫМ процессом, и `main` в нём вызывается голым.
# Bash подавляет ERR-trap для команды, чей код возврата проверяется:
# `main || true`, `if main`, `! main` — все три глушат trap внутри `main`,
# и тест прошёл бы даже без `-E`. Первая версия этого теста именно так
# и обманулась.
#
# Форма падения тоже принципиальна, и это вторая ловушка. Проверено
# экспериментом:
#
#   вызванная функция делает `return 1`     → trap срабатывает и БЕЗ `-E`
#   команда ВНУТРИ вызванной функции падает → без `-E` НЕ срабатывает
#
# Настоящие шаги падают вторым способом: внутри них падает `docker`,
# `pg_dump` или `alembic`. Поэтому заглушка обязана ронять команду внутри
# себя (`false`), а не возвращать код: на `return 1` тест зеленел бы даже
# со снятым `-E`.

# Пишет самостоятельный прогон выкатки: подключает библиотеку (вместе с её
# собственной строкой `set`), заглушает шаги, роняет названный и зовёт
# `main` голым вызовом.
write_deploy_runner() {
    local runner="$1" failing_step="$2" log_file="$3"
    cat > "$runner" <<RUNNER
source "$WORK/lib.sh"
log() { :; }; step() { :; }; info() { :; }
success() { :; }; warning() { :; }; error() { :; }
DB_USER="fancai"; DB_NAME="fancai"; REDIS_PASSWORD="stub"
BACKUP_DIR="$WORK/backup14"
for s in check_prerequisites validate_environment update_code \\
         preserve_current_images build_images quiesce_writers \\
         create_backup purge_stale_queues run_migrations start_services \\
         health_check verify_frontend_artifact verify_deployment \\
         save_deployment_info; do
    eval "\${s}() { return 0; }"
done
docker() { return 0; }
rollback() { echo rollback >> "$log_file"; }
RUNNER
    if [[ -n "$failing_step" ]]; then
        # `false` внутри тела — как падение docker/alembic в бою.
        echo "${failing_step}() { false; }" >> "$runner"
    fi
    # Голый вызов: никаких `||`, `if` и `!` вокруг него.
    echo 'main' >> "$runner"
}

test_failed_step_triggers_rollback() {
    local log="$WORK/rollback14.log"
    local runner="$WORK/runner14.sh"
    mkdir -p "$WORK/backup14"

    # Падение посреди простоя — самый опасный момент: писатели остановлены,
    # миграции могли примениться, откатывать есть что.
    : > "$log"
    write_deploy_runner "$runner" run_migrations "$log"
    bash "$runner" > /dev/null 2>&1
    check "провал миграций вызывает откат" "1" "$(grep -c '^rollback$' "$log")"

    # Шаг до миграций — тот же путь через trap.
    : > "$log"
    write_deploy_runner "$runner" create_backup "$log"
    bash "$runner" > /dev/null 2>&1
    check "провал бэкапа вызывает откат" "1" "$(grep -c '^rollback$' "$log")"

    : > "$log"
    write_deploy_runner "$runner" quiesce_writers "$log"
    bash "$runner" > /dev/null 2>&1
    check "провал остановки писателей вызывает откат" "1" "$(grep -c '^rollback$' "$log")"

    # Провал проверок обрабатывается ЯВНЫМ вызовом, а не trap'ом, и обязан
    # дать РОВНО один откат: если trap не снять, получилось бы два.
    : > "$log"
    write_deploy_runner "$runner" health_check "$log"
    bash "$runner" > /dev/null 2>&1
    check "провал проверок даёт ровно один откат" "1" "$(grep -c '^rollback$' "$log")"

    # Успешный прогон откат не зовёт.
    : > "$log"
    write_deploy_runner "$runner" "" "$log"
    bash "$runner" > /dev/null 2>&1
    check "успешная выкатка откат не зовёт" "0" "$(grep -c '^rollback$' "$log")"
}

# --- 15. Откат не вызывает сам себя --------------------------------------
#
# С `errtrace` trap действует и внутри функций, а в самом откате есть
# падающие команды и два `return 1`. Не сняв trap первым действием,
# откат ушёл бы в рекурсию. Проверка снова отдельным процессом и голым
# вызовом — по той же причине, что в тесте 14.

test_rollback_does_not_reenter() {
    local log="$WORK/reentry.log"
    local runner="$WORK/runner15.sh"
    : > "$log"

    cat > "$runner" <<RUNNER
source "$WORK/lib.sh"
log() { :; }; step() { :; }; info() { :; }
success() { :; }; warning() { :; }; error() { :; }
DB_USER="fancai"; DB_NAME="fancai"; REDIS_PASSWORD="stub"
BACKUP_DIR="$WORK/backup15"
COMPOSE_FILE="compose.yml"
cd "$WORK"
# Ни \`.last_image_tag\`, ни образов: откат уходит в \`return 1\` — ровно тот
# путь, на котором вооружённый trap позвал бы его повторно.
rm -f .last_image_tag
outer() {
    trap 'echo trap >> "$log"' ERR
    rollback
}
outer
RUNNER
    bash "$runner" > /dev/null 2>&1

    check "trap внутри отката не срабатывает" "0" "$(grep -c '^trap$' "$log")"
}

# --- 16. Caddy пересоздаётся безусловно ----------------------------------
#
# `Caddyfile` смонтирован одиночным файлом: после `git pull` на хосте новый
# inode, а контейнер держит старый. `up -d` при неизменном образе ничего
# не пересоздаёт, поэтому правки маршрутов и allowlist'а не применялись.

test_start_services_recreates_caddy() {
    # shellcheck disable=SC1091
    source "$WORK/lib.sh"
    stub_common
    COMPOSE_FILE="compose.yml"
    cd "$WORK" || return 1

    docker() { echo "$*" >> "$WORK/docker.log"; return 0; }
    publish_frontend_artifact() { :; }

    start_services > /dev/null 2>&1 || true

    check "caddy пересоздаётся" "1" \
        "$(grep -c -- "up -d --force-recreate caddy$" "$WORK/docker.log")"
    # Адресно: безусловный recreate всего стека уронил бы Postgres и Redis,
    # с которых снимать точку восстановления уже неоткуда.
    check "остальные сервисы не пересоздаются насильно" "0" \
        "$(grep -cE -- "up -d --force-recreate$" "$WORK/docker.log")"
}

# --- 17. Состояние выкатки не отслеживается git ---------------------------
#
# `create_backup` пишет `.last_backup`, `preserve_current_images` —
# `.last_image_tag`. Пока эти файлы отслеживались, КАЖДАЯ выкатка оставляла
# после себя грязное дерево, а `update_code` отказывается работать на
# грязном дереве. То есть вторая выкатка на любом хосте не стартовала
# из-за следов первой. Найдено на живом проде 2026-08-06: `M .last_backup`
# при HEAD 8047e12c.

test_deploy_state_is_untracked() {
    # `command git`, а не `git`: предыдущие кейсы подменяют `git` функцией,
    # и она переживает возврат из них. Стаб вернул бы пустую выдачу с кодом 0,
    # то есть тест зеленел бы, ничего не проверив.
    local root="$SCRIPT_DIR/.."
    local tracked
    tracked=$(cd "$root" && command git ls-files -- .last_backup .last_image_tag)

    check "состояние выкатки не в индексе git" "" "$tracked"

    # И его же обязан покрывать .gitignore — иначе `update_code` ругался бы
    # на неотслеживаемые файлы при каждом прогоне.
    local ignored
    ignored=$(cd "$root" && command git check-ignore .last_backup .last_image_tag | tr '\n' ' ')
    check "состояние выкатки в .gitignore" ".last_backup .last_image_tag " "$ignored"
}

main() {
    prepare_sourceable
    echo "Стенд deploy-production.sh"
    run_case "1. бэкап"            test_backup_rejects_empty_dump
    run_case "2-3. образы"         test_images_preserved_before_build
    run_case "4. health_check"     test_health_check_ignores_frontend
    run_case "5. публикация SPA"   test_frontend_publication
    run_case "5b. артефакт фронта" test_frontend_artifact_verification
    run_case "6. откат"            test_rollback_restores_images_only
    run_case "7. доставка кода"    test_update_code_refuses_dirty_tree
    run_case "8. порядок шагов"    test_deploy_step_order
    run_case "9. восстановление"   test_restore_quiesces_writers_first
    run_case "10. чужие контейнеры" test_no_step_touches_foreign_containers
    run_case "11. снимок Redis"    test_redis_snapshot_before_purge
    run_case "12. env в сборке"    test_build_rejects_absorbed_local_env
    run_case "13. перезапуск"      test_update_code_reexecs_after_change
    run_case "13b. git не в head"     test_git_output_is_never_piped_to_head
    run_case "14. откат при провале" test_failed_step_triggers_rollback
    run_case "15. откат без рекурсии" test_rollback_does_not_reenter
    run_case "16. пересоздание Caddy" test_start_services_recreates_caddy
    run_case "17. состояние вне git" test_deploy_state_is_untracked

    echo
    echo "итог: $PASS пройдено, $FAIL провалено"
    [[ "$FAIL" -eq 0 ]]
}

main "$@"
