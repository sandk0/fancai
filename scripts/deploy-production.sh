#!/bin/bash

# fancai - Production Deployment Script
# Comprehensive production deployment with safety checks and rollback

set -euo pipefail

# Аргументы запуска сохраняются здесь: `update_code` перезапускает скрипт
# через `exec`, а внутри функции `$@` — это её собственные аргументы.
ORIGINAL_ARGS=("$@")

# Script configuration
PROJECT_NAME="fancai"
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env"
# Пути определяются пробой на запись, а не предположением. Выкатка идёт
# под пользователем `deploy`, у которого нет записи ни в `/var/log`,
# ни в `/backups` — оба принадлежат root. На первом же прогоне скрипт
# упал на `tee: Permission denied`, причём ДО того, как смог сообщить
# хоть что-то внятное.
#
# Sudo здесь сознательно не используется: повышение прав в автоматическом
# пути ломается при смене политики и расширяет поверхность. Вместо этого —
# запасной каталог и явная подсказка, как выровнять при желании.
BACKUP_ROOT="${DEPLOY_BACKUP_ROOT:-}"
BACKUP_ROOT_FALLBACK=""
if [[ -z "$BACKUP_ROOT" ]]; then
    if [[ -w /backups ]]; then
        BACKUP_ROOT=/backups
    else
        BACKUP_ROOT="$HOME/fancai-backups"
        BACKUP_ROOT_FALLBACK=1
    fi
fi
BACKUP_DIR="$BACKUP_ROOT/$(date +%Y%m%d_%H%M%S)"

LOG_FILE="${DEPLOY_LOG_FILE:-}"
if [[ -z "$LOG_FILE" ]]; then
    for candidate in /var/log/fancai-deploy.log "$HOME/fancai-deploy.log"; do
        if : 2>/dev/null >> "$candidate"; then
            LOG_FILE="$candidate"
            break
        fi
    done
    LOG_FILE="${LOG_FILE:-/tmp/fancai-deploy.log}"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Logging functions
log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

error() {
    log "${RED}❌ ERROR: $1${NC}"
}

success() {
    log "${GREEN}✅ SUCCESS: $1${NC}"
}

warning() {
    log "${YELLOW}⚠️  WARNING: $1${NC}"
}

info() {
    log "${BLUE}ℹ️  INFO: $1${NC}"
}

step() {
    log "${PURPLE}🚀 STEP: $1${NC}"
}

# Function to check prerequisites
check_prerequisites() {
    step "Checking prerequisites..."
    
    # Check if running as root or with sudo
    if [[ $EUID -eq 0 ]]; then
        error "This script should not be run as root for security reasons"
        exit 1
    fi
    
    # Check if Docker is installed and running
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed"
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        error "Docker daemon is not running"
        exit 1
    fi
    
    # Check if Docker Compose is available
    if ! docker compose version &> /dev/null; then
        error "Docker Compose (v2) is not available"
        exit 1
    fi
    
    # Check if environment file exists
    if [[ ! -f "$ENV_FILE" ]]; then
        error "Environment file $ENV_FILE does not exist"
        info "Please copy .env.production.example to $ENV_FILE and configure it"
        exit 1
    fi
    
    # Check if required directories exist
    local required_dirs=("logs" "postgres")
    for dir in "${required_dirs[@]}"; do
        if [[ ! -d "$dir" ]]; then
            warning "Creating missing directory: $dir"
            mkdir -p "$dir"
        fi
    done
    
    if [[ -n "$BACKUP_ROOT_FALLBACK" ]]; then
        warning "/backups недоступен на запись — бэкапы пойдут в $BACKUP_ROOT"
        warning "Выровнять при желании: sudo install -d -o $(id -un) /backups/deploy"
        warning "или задать DEPLOY_BACKUP_ROOT перед запуском"
    fi
    info "Журнал: $LOG_FILE   Бэкап: $BACKUP_DIR"

    success "Prerequisites check passed"
}

# Function to validate environment variables
validate_environment() {
    step "Validating environment variables..."
    
    source "$ENV_FILE"
    
    # DB_USER/DB_NAME обязательны наравне с паролями. Раньше их не было
    # в списке, а по коду стояли дефолты `fancai_user`/`fancai_prod` —
    # на этом проде значения другие (`fancai`/`fancai`), и «умолчание»
    # означало обращение к несуществующей базе.
    local required_vars=(
        "DOMAIN_NAME"
        "DB_NAME"
        "DB_USER"
        "DB_PASSWORD"
        "REDIS_PASSWORD"
        "SECRET_KEY"
    )
    
    local missing_vars=()
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            missing_vars+=("$var")
        fi
    done
    
    if [[ ${#missing_vars[@]} -gt 0 ]]; then
        error "Missing required environment variables:"
        printf '%s\n' "${missing_vars[@]}"
        exit 1
    fi
    
    # Check password strength
    if [[ ${#DB_PASSWORD} -lt 16 ]]; then
        warning "DB_PASSWORD should be at least 16 characters long"
    fi
    
    if [[ ${#SECRET_KEY} -lt 32 ]]; then
        error "SECRET_KEY must be at least 32 characters long"
        exit 1
    fi
    
    success "Environment validation passed"
}

# Function to resolve a compose volume name and prove it exists
#
# Имя тома — это `<проект>_<имя>`, а проект здесь `app` (каталог
# /opt/fancai/app), не `fancai`. Ровно на этом обжигались архивы бэкапа:
# они монтировали `fancai_postgres_data`, Docker молча создавал пустой том,
# и получался «успешный» архив пустоты. Поэтому существование проверяется,
# а не предполагается.
compose_volume() {
    local short="$1"
    local project="${COMPOSE_PROJECT_NAME:-$(basename "$PWD")}"
    local name="${project}_${short}"

    if ! docker volume inspect "$name" &> /dev/null; then
        error "Том $name не существует — проверьте COMPOSE_PROJECT_NAME"
        return 1
    fi
    echo "$name"
}

# Function to archive the currently published SPA
#
# Фронт — build-only job: он не «работает», а ПЕРЕЗАПИСЫВАЕТ общий том,
# который читает Caddy. Значит откат образов старую сборку не вернёт:
# образ фронта умеет только собрать заново, а прежний артефакт к тому
# моменту уже затёрт. Единственная копия — этот архив.
backup_frontend_artifact() {
    info "Archiving the published SPA..."

    local volume
    volume=$(compose_volume frontend_build) || return 1

    # `--user`: без него tar внутри контейнера работает от root и создаёт
    # в bind-mount файл, принадлежащий root. Дальше `chmod` от пользователя
    # `deploy` по нему не проходит — именно на этом упал второй боевой
    # прогон, уже ПОСЛЕ успешного бэкапа и с остановленными писателями.
    docker run --rm \
        --user "$(id -u):$(id -g)" \
        -v "$volume":/source:ro \
        -v "$BACKUP_DIR":/backup \
        alpine tar czf /backup/frontend_build.tar.gz -C /source .

    local size
    size=$(wc -c < "$BACKUP_DIR/frontend_build.tar.gz" 2>/dev/null | tr -d ' ' || echo 0)
    if [[ "$size" -lt 1024 ]]; then
        error "Архив SPA подозрительно мал (${size} байт) — прерываю"
        return 1
    fi

    info "SPA archived: ${size} bytes"
}

# Function to snapshot Redis
#
# Нужен именно перед выкаткой: дальше `purge_stale_queues` делает
# необратимый `DEL light`, а раскладка Redis в этом проекте load-bearing —
# DB 0 держит не только кэш, но и `parsing_queue` с `global_parsing_lock`,
# DB 1 это брокер Celery, DB 2 результаты. «Транзиентным» тут ничего
# считать нельзя.
#
# Способ штатный и тот же, что в `scripts/migration-backup.sh`: BGSAVE,
# ожидание смены LASTSAVE, копирование RDB наружу. Копировать файл
# из-под работающего Redis без BGSAVE нельзя — получится рваный снимок.
backup_redis() {
    info "Snapshotting Redis..."

    # Секрет не попадает НИ в один argv. `redis-cli -a` кладёт его в argv
    # процесса внутри контейнера; `-e VAR=value` — в argv самого
    # `docker compose` на хосте, где его видно в `ps`. Поэтому флагу
    # передаётся только ИМЯ, а значение уходит окружением.
    #
    # `local -x`, а не глобальный `export`: атрибут экспорта снимается
    # при возврате из функции, и сборки с `git` его не наследуют.
    local -x REDISCLI_AUTH="${REDIS_PASSWORD:-}"
    local rcli=(docker compose -f "$COMPOSE_FILE" exec -T
                -e REDISCLI_AUTH redis redis-cli)

    local before
    before=$("${rcli[@]}" LASTSAVE 2>/dev/null | tr -d '\r' || echo 0)

    if ! "${rcli[@]}" BGSAVE > /dev/null 2>&1; then
        warning "BGSAVE отклонён, пробую синхронный SAVE"
        "${rcli[@]}" SAVE > /dev/null 2>&1
    fi

    local waited=0
    while [[ "$waited" -lt 60 ]]; do
        local now
        now=$("${rcli[@]}" LASTSAVE 2>/dev/null | tr -d '\r' || echo 0)
        [[ "$now" != "$before" ]] && break
        sleep 1
        waited=$((waited + 1))
    done

    if [[ "$waited" -ge 60 ]]; then
        error "Redis не завершил сохранение за 60 с — снимок недостоверен"
        return 1
    fi

    local container
    container=$(docker compose -f "$COMPOSE_FILE" ps -q redis)
    docker cp "$container:/data/dump.rdb" "$BACKUP_DIR/redis-dump.rdb"

    # AOF включён (`--appendonly yes`), каталог нужен для полного восстановления
    docker cp "$container:/data/appendonlydir" "$BACKUP_DIR/redis-appendonlydir" \
        2>/dev/null || warning "AOF-каталог не найден — восстановление только из RDB"

    local rdb_size
    rdb_size=$(wc -c < "$BACKUP_DIR/redis-dump.rdb" 2>/dev/null | tr -d ' ' || echo 0)
    if [[ "$rdb_size" -lt 64 ]]; then
        error "Redis snapshot is empty (${rdb_size} bytes) — aborting"
        return 1
    fi

    info "Redis snapshot: ${rdb_size} bytes"
}

# Function to create backup
#
# Бэкап — единственная страховка перед `alembic upgrade head`, среди
# миграций которого есть разрушительные. Поэтому здесь НЕТ `|| true`:
# провал бэкапа обязан останавливать выкатку, а не проходить незамеченным.
create_backup() {
    step "Creating backup..."

    # 700, а не umask: внутри полный дамп БД и снимок Redis с очередями.
    install -d -m 700 "$BACKUP_DIR"

    # Backup environment file
    install -m 600 "$ENV_FILE" "$BACKUP_DIR/"

    # Backup database. Формат custom (-Fc): восстанавливается `pg_restore`,
    # умеет частичный restore и не зависит от порядка объектов.
    if ! docker compose -f "$COMPOSE_FILE" ps postgres | grep -q "Up"; then
        error "Postgres is not running — cannot take a backup before migrations"
        return 1
    fi

    info "Creating database backup..."
    docker compose -f "$COMPOSE_FILE" exec -T postgres pg_dump \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -Fc \
        > "$BACKUP_DIR/database.dump"

    # Проверяем не факт создания файла, а его пригодность: редирект
    # создаёт файл даже когда pg_dump упал, и пустой дамп «восстановится»
    # молча и без данных.
    local dump_size
    dump_size=$(wc -c < "$BACKUP_DIR/database.dump" 2>/dev/null | tr -d ' ' || echo 0)
    if [[ "$dump_size" -lt 10000 ]]; then
        error "Database dump is suspiciously small (${dump_size} bytes) — aborting"
        return 1
    fi

    # `pg_restore --list` требует seekable-вход: custom-формат читается
    # с произвольным доступом. Через `docker compose exec -T ... < файл`
    # он получает пайп и падает с «did not find magic string in file
    # header» — на ВАЛИДНОМ дампе. Первый боевой прогон 2026-08-05
    # отклонил именно так: 16 МБ, магия PGDMP на месте, а проверка
    # объявила дамп пустым и откатила выкатку.
    #
    # Поэтому каталог монтируется в одноразовый контейнер того же образа,
    # что и работающий Postgres: там дамп — обычный файл.
    local pg_image table_data
    pg_image=$(docker inspect "$(docker compose -f "$COMPOSE_FILE" ps -q postgres)" \
        --format '{{.Config.Image}}' 2>/dev/null)
    if [[ -z "$pg_image" ]]; then
        error "Не удалось определить образ Postgres для проверки дампа"
        return 1
    fi

    table_data=$(docker run --rm -v "$BACKUP_DIR":/b:ro "$pg_image" \
        pg_restore --list /b/database.dump 2>/dev/null \
        | grep -c "TABLE DATA" || true)
    if [[ "${table_data:-0}" -lt 1 ]]; then
        error "Database dump contains no table data — aborting"
        return 1
    fi
    info "Dump verified: ${dump_size} bytes, ${table_data} tables with data"

    # Архивов ТОМОВ здесь сознательно нет, хотя раньше были два.
    #
    # Во-первых, они монтировали `fancai_postgres_data`/`fancai_redis_data`,
    # а проект называется `app` — реальные тома `app_postgres_data`
    # и `app_redis_data`. Docker молча создаёт отсутствующий именованный том,
    # поэтому получались два «успешных» архива пустоты и два мусорных тома
    # на сервере. Проверено `docker volume ls` на живом проде.
    #
    # Во-вторых, даже с правильным именем это не копия: PGDATA работающего
    # Postgres нельзя брать `tar`'ом — страницы рвутся на лету. Валидная
    # копия базы ровно одна: проверенный выше `pg_dump -Fc`.
    #
    # Redis снимается штатным способом ниже — он нужен, потому что дальше
    # выкатка делает необратимый `DEL light`.
    backup_redis
    backup_frontend_artifact

    success "Backup created at $BACKUP_DIR"
    # Каталог уже создан с правами 700, это дополнительный рубеж: внутри
    # дамп БД и снимок Redis. Выполняется в контейнере от root, чтобы
    # не зависеть от того, какой процесс какой файл записал.
    docker run --rm -v "$BACKUP_DIR":/b alpine chmod -R go-rwx /b

    echo "$BACKUP_DIR" > .last_backup
}

# Три образа, которые собирает выкатка. `fancai-celery` — отдельный
# образ, а не тот же, что у backend: очереди воркера заданы в `CMD`
# стадии `celery` (`Dockerfile.prod`), и без пересборки `docker compose up`
# команду не меняет. Пропуск celery = воркер остаётся на старых очередях,
# а после починки маршрутов парсинг книг перестаёт кем-либо потребляться.
DEPLOY_IMAGES=("fancai-backend" "fancai-celery" "fancai-frontend")

# Function to preserve the currently deployed images for rollback
#
# Тегировать ПОСЛЕ сборки бессмысленно: тег указывал бы на новый образ.
# Прежние сохраняются здесь, до `build_images`, и их имена кладутся
# рядом с бэкапом, чтобы откат знал, на что переключаться.
preserve_current_images() {
    step "Preserving current images for rollback..."

    local timestamp
    timestamp=$(date +%Y%m%d_%H%M%S)
    : > "$BACKUP_DIR/images.txt"

    # Сохраняется образ РАБОТАЮЩЕГО контейнера, а не то, на что сейчас
    # указывает тег `:latest`. Тег — подвижная ссылка: после `build`
    # он станет новым образом, и откат «к latest» вернул бы ровно то,
    # от чего откатываются. Сегодня на проде тег и контейнер совпадают
    # (проверено), но полагаться на это незачем.
    #
    # Соответствие сервисов образам: `fancai-frontend:latest` на проде
    # вообще отсутствует, и это нормально — SPA откатывается не образом,
    # а архивом тома, см. `backup_frontend_artifact`.
    local image service source_id
    for image in "${DEPLOY_IMAGES[@]}"; do
        case "$image" in
            fancai-backend)  service=backend ;;
            fancai-celery)   service=celery-worker ;;
            fancai-frontend) service=frontend ;;
            *)               service="" ;;
        esac

        source_id=""
        if [[ -n "$service" ]]; then
            local cid
            cid=$(docker compose -f "$COMPOSE_FILE" ps -q "$service" 2>/dev/null | head -1)
            if [[ -n "$cid" ]]; then
                source_id=$(docker inspect "$cid" --format '{{.Image}}' 2>/dev/null || true)
            fi
        fi

        # Запасной путь: контейнера нет (например, фронт уже завершился
        # и удалён), но тег существует.
        if [[ -z "$source_id" ]] && docker image inspect "$image:latest" &> /dev/null; then
            source_id="$image:latest"
        fi

        if [[ -n "$source_id" ]]; then
            docker tag "$source_id" "$image:rollback-$timestamp"
            echo "$image:rollback-$timestamp" >> "$BACKUP_DIR/images.txt"
            info "Preserved $image:rollback-$timestamp"
        else
            warning "$image: ни контейнера, ни тега — откатывать нечего"
        fi
    done

    echo "$timestamp" > .last_image_tag
    success "Rollback images tagged with rollback-$timestamp"
}

# Function to pull and build images
build_images() {
    step "Building production images..."

    # Pull base images first
    docker compose -f "$COMPOSE_FILE" pull postgres redis caddy || true

    # Build our custom images. VCS_REF/BUILD_DATE подставляются в ARG,
    # объявленные в обоих Dockerfile.prod.
    VCS_REF="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
    BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    export VCS_REF BUILD_DATE

    info "Building backend image..."
    docker compose -f "$COMPOSE_FILE" build --no-cache backend

    info "Building celery worker image..."
    docker compose -f "$COMPOSE_FILE" build --no-cache celery-worker

    info "Building frontend image..."
    docker compose -f "$COMPOSE_FILE" build --no-cache frontend

    assert_build_absorbed_no_local_env

    success "Images built successfully"
}

# Function to prove the build did not absorb local environment
#
# Утечка бывает двух РАЗНЫХ видов, и проверять их надо по-разному.
#
# Backend и celery: `COPY . .` кладёт сами файлы в образ. Повод конкретный —
# `backend/.dockerignore` исключал `.env` и `.env.local`, но не
# `.env.development` и `.env.production`; оба лежали в БОЕВОМ
# `fancai-backend:latest` вместе с ключами ADMIN_PASSWORD и JWT_SECRET_KEY
# (проверено 2026-08-05; значения оказались dev-плейсхолдерами).
#
# Frontend: файла в финальном образе нет вовсе — он читается Vite на стадии
# builder, и значения ВКОМПИЛИРОВАНЫ в JS. Искать там `.env*` бессмысленно,
# проверка была бы вечнозелёной. Проверяется собранный бандл: адрес API
# обязан быть относительным, абсолютного домена в JS быть не должно.
# Именно так уехал `VITE_IMAGE_CDN_URL=https://fancai.ru`.
assert_build_absorbed_no_local_env() {
    step "Checking images for absorbed local environment..."

    local leaked=0 image found

    for image in fancai-backend:latest fancai-celery:latest; do
        found=$(docker run --rm --entrypoint sh "$image" \
            -c 'ls -a /app 2>/dev/null | grep "^\.env" || true')
        # `.env.example` — образец без значений, он допустим
        found=$(echo "$found" | grep -v '^\.env\.example$' || true)
        if [[ -n "$found" ]]; then
            error "$image содержит env-файлы: $(echo "$found" | tr '\n' ' ')"
            leaked=1
        fi
    done

    # Данные забираются из контейнера сырыми, а классификация делается
    # здесь. Если прятать `grep` с шаблоном внутрь `sh -c`, логику нельзя
    # проверить стендом: подменённый `docker` ответит на любой шаблон.
    local base_urls
    base_urls=$(docker run --rm --entrypoint sh fancai-frontend:latest \
        -c 'grep -hoE "baseURL:.{0,50}" /var/www/html/assets/js/*.js 2>/dev/null | head -20 || true')

    # Любой абсолютный адрес API, а не только `fancai.ru`: чужой домен
    # означает то же самое — сборка взяла локальный `.env` вместо ARG.
    if echo "$base_urls" | grep -qE 'baseURL:.{0,3}https?://'; then
        error "В бандле фронта абсолютный адрес API:" \
              "$(echo "$base_urls" | grep -E 'baseURL:.{0,3}https?://' | head -3 | tr '\n' ' ')"
        error "Значит сборка подхватила локальный .env вместо ARG из compose"
        leaked=1
    fi

    # И наоборот: относительный адрес обязан присутствовать. Если маркер
    # исчез, проверка выше стала бы вечнозелёной — пусть лучше упадёт.
    if ! echo "$base_urls" | grep -qE 'baseURL:.{0,3}/api/v1'; then
        error "В бандле фронта не найден относительный baseURL /api/v1"
        error "Проверьте вручную: маркер мог измениться после смены сборщика"
        leaked=1
    fi

    if [[ "$leaked" -ne 0 ]]; then
        error "Поправьте .dockerignore контекста сборки или ARG в compose"
        return 1
    fi

    success "Images carry no local environment"
}

# Function to perform health checks
#
# `frontend` сюда НЕ входит: по compose это build-only job (`restart: "no"`),
# он пишет артефакт в том `frontend_build` и штатно завершается `Exited (0)`.
# Требовать от него `Up` — значит гарантированно объявить успешную выкатку
# аварией; его результат проверяется отдельно, в `verify_frontend_artifact`.
health_check() {
    step "Performing health checks..."

    local max_attempts=30
    local attempt=1

    info "Waiting for services to become healthy..."

    while [[ $attempt -le $max_attempts ]]; do
        local unhealthy_services=()

        local services=("postgres" "redis" "backend" "celery-worker" "celery-beat" "caddy")
        for service in "${services[@]}"; do
            local health_status
            health_status=$(docker compose -f "$COMPOSE_FILE" ps "$service" --format "{{.Status}}" | tail -n 1)

            if [[ "$health_status" != *"healthy"* ]] && [[ "$health_status" != *"Up"* ]]; then
                unhealthy_services+=("$service")
            fi
        done

        if [[ ${#unhealthy_services[@]} -eq 0 ]]; then
            success "All long-running services are healthy"
            return 0
        fi

        info "Attempt $attempt/$max_attempts - Waiting for services: ${unhealthy_services[*]}"
        sleep 10
        ((attempt++))
    done

    error "Health check timeout - some services are not healthy"
    docker compose -f "$COMPOSE_FILE" ps
    return 1
}

# Function to verify the build-only frontend job
#
# Успех фронта — это код возврата 0 и свежий артефакт в общем томе,
# который читает Caddy. Контейнер к этому моменту уже не существует
# как running, поэтому проверяется именно результат его работы.
verify_frontend_artifact() {
    step "Verifying frontend build artifact..."

    local exit_code
    exit_code=$(docker inspect fancai_frontend --format '{{.State.ExitCode}}' 2>/dev/null || echo "missing")
    if [[ "$exit_code" != "0" ]]; then
        error "Frontend build job did not finish cleanly (exit=$exit_code)"
        docker compose -f "$COMPOSE_FILE" logs --tail 40 frontend || true
        return 1
    fi

    # Наличия файла мало: том мог остаться от прошлой выкатки, и проверка
    # была бы зелёной на старом SPA. Сверяем содержимое тома с содержимым
    # свежесобранного образа — именно это и не выполнялось месяцами.
    local volume image_sum volume_sum
    volume=$(compose_volume frontend_build) || return 1

    image_sum=$(docker run --rm --entrypoint sh fancai-frontend:latest \
        -c 'md5sum /var/www/html/index.html 2>/dev/null | cut -d" " -f1')
    volume_sum=$(docker run --rm -v "$volume":/w:ro --entrypoint sh alpine \
        -c 'md5sum /w/index.html 2>/dev/null | cut -d" " -f1')

    if [[ -z "$volume_sum" ]]; then
        error "Frontend artifact is missing from the shared volume"
        return 1
    fi

    if [[ "$image_sum" != "$volume_sum" ]]; then
        error "Том отдаёт НЕ ту сборку, что в образе:"
        error "  образ=$image_sum том=$volume_sum"
        error "Публикация не сработала — Caddy продолжит отдавать старый SPA"
        return 1
    fi

    success "Published SPA matches the freshly built image ($image_sum)"
}

# Function to stop everything that writes to the database
#
# Порядок здесь важнее, чем кажется. Раньше дамп снимался ДО трёх
# `--no-cache` сборок, а бэкенд и воркер продолжали писать всё это время —
# минуты. Такая точка восстановления недействительна: ручной restore
# потерял бы записи, сделанные за время сборки.
#
# Поэтому писатели останавливаются здесь, ПОСЛЕ сборки кандидатов
# и ПЕРЕД дампом. Postgres и Redis намеренно остаются подняты: дамп
# снимать неоткуда, а лишний перезапуск СУБД ничего не даёт.
quiesce_writers() {
    step "Stopping writers before the backup..."

    docker compose -f "$COMPOSE_FILE" stop --timeout 30 \
        backend celery-worker celery-beat

    # Caddy оставляем: он отдаст 502 на API, но статика и понятный отказ
    # лучше, чем оборванное соединение.
    success "Writers stopped — database is quiet"
}

# Function to drop the stale periodic-task backlog
#
# В `light` на проде скопилось 8074 задачи `close_abandoned_sessions`
# за ~5 месяцев: воркер запускался без `-Q` и эту очередь не слушал.
# У сообщений нет ни `eta`, ни `expires`, поэтому новый воркер с корректными
# очередями выполнил бы их все разом. Задача идемпотентная и давно
# неактуальная — первая же по расписанию сделает ту же работу.
#
# Шаг выполняется при остановленном воркере, иначе он начнёт разгребать
# очередь раньше, чем она будет очищена. Управляется PURGE_STALE_QUEUES.
purge_stale_queues() {
    if [[ "${PURGE_STALE_QUEUES:-false}" != "true" ]]; then
        info "Skipping stale queue purge (set PURGE_STALE_QUEUES=true to enable)"
        return 0
    fi

    step "Purging the stale periodic-task backlog..."

    # Как в `backup_redis`: значение уходит окружением, флагу — только имя.
    local -x REDISCLI_AUTH="${REDIS_PASSWORD:-}"
    local rcli=(docker compose -f "$COMPOSE_FILE" exec -T
                -e REDISCLI_AUTH redis redis-cli)

    local before
    before=$("${rcli[@]}" -n 1 llen light 2>/dev/null | tr -d '\r' || echo 0)

    "${rcli[@]}" -n 1 del light > /dev/null

    success "Purged ${before} stale message(s) from the light queue"
}

# Function to run database migrations
#
# Вызывается при остановленных писателях и сразу после дампа: между
# точкой восстановления и изменением схемы никто не пишет.
run_migrations() {
    step "Running database migrations..."

    docker compose -f "$COMPOSE_FILE" run --rm backend alembic upgrade head

    success "Migrations applied"
}

# Function to publish the freshly built SPA into the shared volume
#
# Без этого шага новая сборка фронта на прод НЕ ПОПАДАЕТ. Docker наполняет
# именованный том из образа только когда том ПУСТ; дальше содержимое тома
# считается пользовательскими данными и не трогается. Сервис `frontend` —
# build-only job с `CMD ["echo", ...]`, он ничего не копирует сам.
#
# Проверено экспериментом 2026-08-05: контейнер из образа с VERSION-2,
# запущенный на томе с VERSION-1, оставляет в томе VERSION-1. Это и есть
# причина, по которой SPA на проде датирован 29 марта при бэкенде
# шестинедельной давности — фронт не обновлялся ни одной выкаткой.
publish_frontend_artifact() {
    step "Publishing the SPA into the shared volume..."

    local volume
    volume=$(compose_volume frontend_build) || return 1

    # Маркер СТАВИТСЯ ДО касания тома: если копирование прервётся
    # на середине, откат обязан узнать, что том уже не прежний.
    touch "$BACKUP_DIR/.spa-published"

    # Монтируем том в /target, чтобы содержимое образа в /var/www/html
    # осталось видимым, а не было закрыто монтированием.
    docker run --rm \
        -v "$volume":/target \
        --entrypoint sh \
        fancai-frontend:latest \
        -c 'rm -rf /target/* /target/.[!.]* 2>/dev/null; cp -a /var/www/html/. /target/'

    success "SPA published"
}

# Function to (re)start the whole stack on the new images
start_services() {
    step "Starting services on the new images..."

    # БЕЗ `--remove-orphans`. Прод и мониторинг живут в ОДНОМ compose-проекте
    # `app`: у `fancai_flower`, `fancai_netdata`, `fancai_victoriametrics`,
    # `fancai_dozzle` и `fancai_uptime_kuma` та же метка
    # `com.docker.compose.project=app`, только другой файл. Compose считает
    # сирот по метке проекта, а не по файлу, поэтому флаг снёс бы весь
    # мониторинг заодно — проверено `docker inspect` на живом проде.
    # Если прод-сервис когда-нибудь удалят из compose, убирайте его адресно
    # по имени, а не флагом.
    docker compose -f "$COMPOSE_FILE" up -d

    # Фронт — build-only job: дожидаемся завершения, чтобы его сообщения
    # не смешивались с проверками. Публикацию он не делает, см. выше.
    docker compose -f "$COMPOSE_FILE" wait frontend > /dev/null 2>&1 || true

    publish_frontend_artifact

    success "Application deployed"
}

# Function to verify deployment
#
# Проверки НЕ ходят через `http://localhost`: Caddyfile объявляет
# единственный сайт `fancai.ru`, поэтому чужой `Host` не матчится ни на один
# блок, а первым в сайте стоит IP-allowlist, где localhost отсутствует.
# Такой запрос всегда получает 404 или 403 и валит успешную выкатку.
# Бэкенд проверяется изнутри контейнера, Caddy — с правильным `Host`
# и разрешённым адресом.
verify_deployment() {
    step "Verifying deployment..."

    # frontend отсутствует намеренно: это build-only job, см. health_check
    local expected_services=("postgres" "redis" "backend" "celery-worker" "celery-beat" "caddy")
    local failed_services=()

    for service in "${expected_services[@]}"; do
        if ! docker compose -f "$COMPOSE_FILE" ps "$service" | grep -q "Up"; then
            failed_services+=("$service")
        fi
    done

    if [[ ${#failed_services[@]} -gt 0 ]]; then
        error "Failed services: ${failed_services[*]}"
        return 1
    fi

    # Backend health — изнутри контейнера, минуя edge целиком
    info "Testing backend health endpoint..."
    if docker compose -f "$COMPOSE_FILE" exec -T backend \
        python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=10).status == 200 else 1)"; then
        success "Backend health endpoint is responding"
    else
        error "Backend health endpoint is not responding"
        return 1
    fi

    # Очереди воркера: после починки маршрутов парсинг уходит в `heavy`,
    # и воркер обязан её слушать, иначе загрузка книги повиснет молча.
    info "Checking worker queues..."
    local queues
    queues=$(docker compose -f "$COMPOSE_FILE" exec -T celery-worker \
        celery -A app.core.celery_app inspect active_queues 2>/dev/null | grep -oE "'name': '(heavy|normal|light)'" | sort -u | wc -l)
    if [[ "${queues:-0}" -lt 3 ]]; then
        error "Worker is not consuming all three queues (found $queues of 3)"
        return 1
    fi
    success "Worker consumes heavy, normal and light"

    # Edge: правильный Host и адрес из allowlist. Обе проверки могут
    # не пройти по причинам, не связанным с выкаткой (сеть, allowlist),
    # поэтому они предупреждают, а не валят.
    info "Testing edge through Caddy..."
    local domain="${DOMAIN_NAME:-fancai.ru}"
    if curl -f -s -o /dev/null --resolve "${domain}:443:127.0.0.1" "https://${domain}/api/v1/health"; then
        success "Edge serves the API"
    else
        warning "Edge check did not pass — вероятно IP-allowlist. Проверьте вручную с разрешённого адреса."
    fi

    success "Deployment verification passed"
}

# Function to roll back the CODE only
#
# Восстановления БД здесь намеренно НЕТ. Trap вооружён до `create_backup`
# и `build_images`, а провал сборки или health-check схему не менял —
# автоматический restore в этом случае откатил бы живые пользовательские
# записи, сделанные уже после бэкапа. Данные восстанавливает человек,
# явной командой, после подтверждённо неудачной миграции: см.
# `restore_database_manually` ниже и docs/operations/BACKUP_AND_RESTORE.md.
rollback() {
    error "Deployment failed, rolling back application images..."

    if [[ ! -f ".last_image_tag" ]]; then
        error "No preserved images found — rollback cannot restore the previous code"
        error "Данные НЕ тронуты. Разбирайтесь вручную, БД в состоянии после миграций."
        return 1
    fi

    local tag
    tag=$(cat .last_image_tag)
    warning "Rolling back to images tagged rollback-$tag"

    # `stop`, а не `down`: проект `app` общий с мониторингом, и `down`
    # пытается снести сеть `fancai_network`, к которой подключены его
    # контейнеры. Останавливаем только свои сервисы; пересоздаст их
    # `up -d` ниже — он всё равно рекреирует контейнер, когда меняется
    # образ под тем же тегом.
    docker compose -f "$COMPOSE_FILE" stop --timeout 30 \
        backend celery-worker celery-beat caddy || true

    local restored=0
    for image in "${DEPLOY_IMAGES[@]}"; do
        if docker image inspect "$image:rollback-$tag" &> /dev/null; then
            docker tag "$image:rollback-$tag" "$image:latest"
            info "Restored $image:latest from rollback-$tag"
            restored=$((restored + 1))
        else
            warning "$image:rollback-$tag not found — $image stays on the new build"
        fi
    done

    if [[ "$restored" -eq 0 ]]; then
        error "Nothing was restored — previous images are gone"
        return 1
    fi

    # SPA возвращается только если ЭТА выкатка успела его тронуть.
    #
    # Опираться на `.last_backup` нельзя: он пишется в самом конце
    # `create_backup`, а trap вооружён раньше. Если упадёт сам бэкап,
    # файл будет указывать на ПРОШЛУЮ выкатку, и откат «вернул» бы SPA
    # на ещё более старую версию — хотя текущий том никто не менял.
    #
    # Маркер ставит `publish_frontend_artifact` перед тем, как коснуться
    # тома, поэтому прерванная на середине публикация тоже покрыта.
    local archive="$BACKUP_DIR/frontend_build.tar.gz"
    if [[ ! -f "$BACKUP_DIR/.spa-published" ]]; then
        info "SPA этой выкаткой не публиковалась — том не трогаем"
    elif [[ ! -s "$archive" ]]; then
        warning "Публикация была, но архива SPA нет — фронт останется на новой сборке"
    else
        local volume
        if volume=$(compose_volume frontend_build); then
            info "Restoring the previous SPA from $archive"
            docker run --rm \
                -v "$volume":/target \
                -v "$BACKUP_DIR":/backup:ro \
                alpine sh -c 'rm -rf /target/* /target/.[!.]* 2>/dev/null; tar xzf /backup/frontend_build.tar.gz -C /target'
        fi
    fi

    docker compose -f "$COMPOSE_FILE" up -d

    warning "Code rolled back to $restored image(s) from rollback-$tag"
    warning "БД НЕ восстанавливалась. Если миграции успели примениться и данные"
    warning "повреждены — запустите: $0 restore-db <путь-к-бэкапу>"
}

# Function to restore the database — MANUAL, never automatic
#
# Дамп снят в формате custom (-Fc), поэтому `psql <` его не прочтёт:
# восстановление только через `pg_restore`. `--clean` обязателен, иначе
# получится слияние поверх текущей схемы, а не восстановление.
#
# Команда вызывается напрямую из разбора аргументов, минуя `main()`.
# Отсюда два требования, которые здесь выполняются явно:
#
#   1. окружение нужно загрузить самим — иначе `DB_USER`/`DB_NAME` пусты,
#      и restore уйдёт в никуда;
#   2. писателей нужно остановить — `--clean` делает DROP/CREATE, и под
#      активными backend/celery это гонки и смешанное состояние. Особенно
#      важно после `rollback`, который поднимает весь стек обратно.
restore_database_manually() {
    local backup_path="${1:-}"

    if [[ -z "$backup_path" || ! -f "$backup_path/database.dump" ]]; then
        error "Usage: $0 restore-db <backup-dir>   (ожидается <backup-dir>/database.dump)"
        return 1
    fi

    check_prerequisites
    validate_environment

    warning "ВОССТАНОВЛЕНИЕ БД ИЗ $backup_path"
    warning "База: $DB_NAME. Текущие данные будут ЗАМЕНЕНЫ. Отменить нельзя."
    warning "Приложение будет остановлено на время восстановления."
    read -r -p "Введите RESTORE для подтверждения: " confirmation
    if [[ "$confirmation" != "RESTORE" ]]; then
        info "Отменено."
        return 1
    fi

    quiesce_writers

    docker compose -f "$COMPOSE_FILE" up -d postgres
    sleep 10

    docker compose -f "$COMPOSE_FILE" exec -T postgres pg_restore \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --clean --if-exists --no-owner \
        < "$backup_path/database.dump"

    success "База восстановлена из $backup_path"

    start_services
    if health_check; then
        success "Приложение поднято после восстановления"
    else
        error "Сервисы не поднялись — разбирайтесь вручную, база уже восстановлена"
        return 1
    fi
}

# Function to save deployment info
save_deployment_info() {
    step "Saving deployment information..."
    
    # Рядом с журналом выкатки, чтобы не зависеть от прав на /var/log
    local deployment_info
    deployment_info="$(dirname "$LOG_FILE")/fancai-deployment-$(date +%Y%m%d_%H%M%S).info"
    
    cat > "$deployment_info" << EOF
Deployment Information
=====================
Date: $(date)
Project: $PROJECT_NAME
Git Commit: $(git rev-parse HEAD 2>/dev/null || echo "Not available")
Git Branch: $(git branch --show-current 2>/dev/null || echo "Not available")

Environment Variables (только имена — значения в лог не пишутся):
$(grep -oE '^[A-Z_][A-Z0-9_]*' "$ENV_FILE" | sort | tr '\n' ' ')

Docker Images:
$(docker compose -f "$COMPOSE_FILE" images)

Running Services:
$(docker compose -f "$COMPOSE_FILE" ps)
EOF
    
    success "Deployment info saved to $deployment_info"
}

# Function to bring the working tree to the deployed revision
#
# Раньше этого шага не было ВООБЩЕ: скрипт собирал образы из того, что
# уже лежит на диске, а как туда попадает новый код — нигде не описано.
# Отсюда же расхождение, найденное 2026-08-05: на сервере годами жили
# незакоммиченные правки `Caddyfile` и `docker-compose.prod.yml`.
update_code() {
    step "Updating working tree..."

    local branch="${DEPLOY_BRANCH:-main}"

    if ! git rev-parse --git-dir &> /dev/null; then
        error "Not a git repository — cannot update code automatically"
        return 1
    fi

    # Правки отслеживаемых файлов блокируют выкатку: они могут быть
    # единственной копией боевой конфигурации, затирать их молча нельзя.
    if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
        error "Working tree has local changes — resolve them before deploying:"
        git status --short --untracked-files=no
        error "Перенесите их в репозиторий или уберите: git stash push"
        return 1
    fi

    # Неотслеживаемые файлы fast-forward не мешают, но внутри контекстов
    # сборки (`./backend`, `./frontend` в docker-compose.prod.yml) они
    # попадают в образ через `COPY . .` и делают сборку невоспроизводимой.
    # Ровно так в этот проект однажды уехал чужой `.env.production`.
    local stray_in_context
    stray_in_context=$(git ls-files --others --exclude-standard -- backend frontend)
    if [[ -n "$stray_in_context" ]]; then
        error "Untracked files inside a Docker build context — they would change the image:"
        printf '  %s\n' $stray_in_context
        return 1
    fi

    # Остальное — бэкапы конфигов и подобное. Не мешают, но пусть будут видны.
    local stray_elsewhere
    stray_elsewhere=$(git ls-files --others --exclude-standard)
    if [[ -n "$stray_elsewhere" ]]; then
        warning "Untracked files outside build contexts (не мешают выкатке):"
        printf '  %s\n' $stray_elsewhere
    fi

    local before
    before=$(git rev-parse --short HEAD)

    git fetch --quiet origin "$branch"
    git checkout --quiet "$branch"
    git merge --ff-only --quiet "origin/$branch"

    local after
    after=$(git rev-parse --short HEAD)

    if [[ "$before" == "$after" ]]; then
        info "Already at $after — nothing to update"
        return 0
    fi

    success "Updated $before -> $after"
    git --no-pager log --oneline "$before..$after" | head -20

    # Продолжать в текущем процессе НЕЛЬЗЯ: `git merge` только что заменил
    # и этот файл тоже, а bash читает скрипт по мере исполнения, по байтовым
    # смещениям. Проверено экспериментом: скрипт, переписавший себя на ходу,
    # молча прекращает исполнение с кодом 0 — строки после перезаписи
    # не выполняются вовсе. Для выкатки это означало бы «успешный» прогон,
    # который ничего не сделал.
    #
    # Маркер одноразовый и переживает exec через окружение: после
    # перезапуска HEAD уже совпадёт с origin, ветка `before == after`
    # вернёт управление, и зацикливания не будет. Но маркер оставлен
    # как явная страховка от гонки, если origin успеет уехать.
    if [[ -n "${DEPLOY_REEXEC:-}" ]]; then
        warning "Скрипт уже перезапускался — продолжаю в текущем процессе"
        return 0
    fi

    info "Перезапускаю обновлённый скрипт..."
    export DEPLOY_REEXEC=1
    exec bash "$0" ${ORIGINAL_ARGS[@]+"${ORIGINAL_ARGS[@]}"}
}

# Main deployment function
main() {
    log "${PURPLE}=================================${NC}"
    log "${PURPLE}🚀 $PROJECT_NAME Production Deployment${NC}"
    log "${PURPLE}=================================${NC}"

    check_prerequisites
    validate_environment
    update_code

    # Всё, что не трогает прод, — до простоя. Сборка трёх образов
    # с `--no-cache` идёт минуты, и делать её при остановленном сервисе
    # незачем. Провал сборки здесь просто завершает скрипт: прод работает
    # на старом коде, откатывать нечего.
    install -d -m 700 "$BACKUP_DIR"
    preserve_current_images
    build_images

    # Дальше начинается простой. Trap вооружаем здесь: с этого момента
    # есть что откатывать.
    trap rollback ERR

    # Порядок обязателен и обоснован: писатели останавливаются ДО дампа,
    # иначе точка восстановления не соответствует состоянию, в котором
    # будет исполнена миграция. Очистка очереди — при остановленном
    # воркере, иначе он начнёт её разгребать раньше времени.
    quiesce_writers
    create_backup
    purge_stale_queues
    run_migrations
    start_services

    # Perform health checks
    if health_check && verify_frontend_artifact && verify_deployment; then
        save_deployment_info

        success "🎉 Deployment completed successfully!"
        info "Application is now running at: https://${DOMAIN_NAME:-localhost}"
        info "API documentation: https://${DOMAIN_NAME:-localhost}/api/v1/docs"

        # Display running services
        log "${BLUE}Running services:${NC}"
        docker compose -f "$COMPOSE_FILE" ps

        # Optional: Start monitoring if requested
        if [[ "${1:-}" == "--with-monitoring" ]]; then
            info "Starting monitoring services..."
            docker compose -f "$COMPOSE_FILE" --profile monitoring up -d
            success "Monitoring available at: https://${DOMAIN_NAME:-localhost}:3001"
        fi

        # Remove trap only on success
        trap - ERR
    else
        # Явный вызов: ERR-trap на `exit` не срабатывает, а на `return`
        # из условия `if` — тоже нет. Без этой строки провал проверок
        # оставлял бы новую сборку без отката.
        trap - ERR
        rollback || true
        error "Health checks failed — code rolled back, database untouched"
        exit 1
    fi
}

# Script usage
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --with-monitoring       Start monitoring services"
    echo "  restore-db <backup-dir> Restore the database from a backup (MANUAL, destructive)"
    echo "  --help                  Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                          # Standard deployment"
    echo "  $0 --with-monitoring        # Deployment with monitoring"
    echo "  $0 restore-db /backups/20260805_120000"
    echo ""
    echo "Восстановление БД НЕ выполняется автоматически при провале выкатки:"
    echo "откатывается только код. Данные возвращает человек этой командой,"
    echo "убедившись, что миграции действительно повредили базу."
}

# Parse command line arguments
case "${1:-}" in
    --help)
        usage
        exit 0
        ;;
    restore-db)
        restore_database_manually "${2:-}"
        ;;
    --with-monitoring)
        main --with-monitoring
        ;;
    "")
        main
        ;;
    *)
        echo "Unknown option: $1"
        usage
        exit 1
        ;;
esac