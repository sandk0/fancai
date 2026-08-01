#!/usr/bin/env bash
#
# Действующий гейт покрытия бэкенда.
#
# Порог намеренно живёт здесь, а не в `addopts` из pytest.ini: там он применялся
# к любому прогону, включая запуск одного теста, где 70 % недостижимы по
# построению, — и падал по покрытию вместо результата самого теста.
#
# Этот же скрипт вызывает .github/workflows/ci.yml. Пока GitHub Actions на
# репозитории выключены, действующим гейтом остаётся только локальный запуск.
#
# Использование:
#   backend/check-coverage.sh                     # полный прогон с порогом
#   backend/check-coverage.sh --cov-report=xml    # + отчёт для Codecov (так делает CI)
#   COV_MIN=75 backend/check-coverage.sh          # разовое ужесточение порога
#   PYTEST="uv run pytest" backend/check-coverage.sh
#
# Выход: 0 — тесты прошли и покрытие не ниже порога; иначе код возврата pytest.

set -euo pipefail

cd "$(dirname "$0")"

COV_MIN="${COV_MIN:-70}"

if [[ -n "${PYTEST:-}" ]]; then
    read -r -a pytest_cmd <<< "${PYTEST}"
elif [[ -x .venv/bin/python ]]; then
    pytest_cmd=(.venv/bin/python -m pytest)
else
    pytest_cmd=(python -m pytest)
fi

# Набор тестов — весь testpaths из pytest.ini. Прежняя команда CI несла
# --ignore=tests/test_integration.py: такого файла в репозитории никогда не было
# (интеграционные тесты лежат в tests/integration/), то есть флаг был no-op.
exec "${pytest_cmd[@]}" \
    --cov=app \
    --cov-report=term \
    "--cov-fail-under=${COV_MIN}" \
    "$@"
