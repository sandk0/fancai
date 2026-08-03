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
    REDIS_PASSWORD="stub"  # pragma: allowlist secret
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
}

# --- 2 и 3. Образы сохраняются до сборки, собираются все три -------------

test_images_preserved_before_build() {
    # shellcheck disable=SC1091
    source "$WORK/lib.sh"
    stub_common
    BACKUP_DIR="$WORK/backup2"; mkdir -p "$BACKUP_DIR"
    COMPOSE_FILE="compose.yml"
    cd "$WORK" || return 1

    docker() {
        echo "$*" >> "$WORK/docker.log"
        case "$*" in
            "image inspect"*) return 0 ;;
            *) return 0 ;;
        esac
    }

    preserve_current_images > /dev/null 2>&1 || true
    local tagged
    tagged=$(grep -c "^tag fancai-.*:latest fancai-.*:rollback-" "$WORK/docker.log")
    check "сохранены все три образа" "3" "$tagged"
    check "список записан рядом с бэкапом" "3" "$(wc -l < "$BACKUP_DIR/images.txt" | tr -d ' ')"

    : > "$WORK/docker.log"
    git() { echo "abc1234"; }
    build_images > /dev/null 2>&1 || true
    for svc in backend celery-worker frontend; do
        check "собирается $svc" "1" "$(grep -c -- "build --no-cache $svc" "$WORK/docker.log")"
    done
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

test_frontend_artifact_verification() {
    # shellcheck disable=SC1091
    source "$WORK/lib.sh"
    stub_common
    COMPOSE_FILE="compose.yml"

    docker() {
        case "$*" in
            *"State.ExitCode"*) echo "0" ;;
            *"test -s /w/index.html"*) return 0 ;;
            *) return 0 ;;
        esac
    }
    local rc=0
    verify_frontend_artifact > /dev/null 2>&1 || rc=$?
    check "успешная сборка принимается" "0" "$rc"

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

    docker() {
        echo "$*" >> "$WORK/docker.log"
        return 0
    }
    rollback > /dev/null 2>&1 || true

    check "образы возвращены" "3" "$(grep -c "^tag fancai-.*:rollback-20260805_120000 fancai-.*:latest" "$WORK/docker.log")"
    check "psql не вызывался" "0" "$(grep -c "psql" "$WORK/docker.log")"
    check "pg_restore не вызывался" "0" "$(grep -c "pg_restore" "$WORK/docker.log")"
}

# --- 7. Грязное дерево останавливает выкатку -----------------------------

test_update_code_refuses_dirty_tree() {
    # shellcheck disable=SC1091
    source "$WORK/lib.sh"
    stub_common

    git() {
        case "$*" in
            "rev-parse --git-dir") echo ".git" ;;
            "status --porcelain")  echo " M Caddyfile" ;;
            "status --short")      echo " M Caddyfile" ;;
            *) return 0 ;;
        esac
    }
    local rc=0
    update_code > /dev/null 2>&1 || rc=$?
    check "грязное дерево останавливает" "1" "$rc"
    check "причина названа" "1" "$(grep -c 'local changes' "$WORK/errors.log")"
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

main() {
    prepare_sourceable
    echo "Стенд deploy-production.sh"
    run_case "1. бэкап"            test_backup_rejects_empty_dump
    run_case "2-3. образы"         test_images_preserved_before_build
    run_case "4. health_check"     test_health_check_ignores_frontend
    run_case "5. артефакт фронта"  test_frontend_artifact_verification
    run_case "6. откат"            test_rollback_restores_images_only
    run_case "7. доставка кода"    test_update_code_refuses_dirty_tree
    run_case "8. порядок шагов"    test_deploy_step_order
    run_case "9. восстановление"   test_restore_quiesces_writers_first

    echo
    echo "итог: $PASS пройдено, $FAIL провалено"
    [[ "$FAIL" -eq 0 ]]
}

main "$@"
