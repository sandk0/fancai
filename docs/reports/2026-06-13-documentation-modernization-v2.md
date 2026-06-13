# Отчёт: модернизация документации, проход v2 (2026-06-13)

Второй системный проход по документации fancai (первый — 2026-04-30). Промпт:
[`../prompts/2026-06-13-documentation-modernization-v2.md`](../prompts/2026-06-13-documentation-modernization-v2.md).
Рабочие артефакты: [`../_drafts/2026-06-13-docs-inventory.md`](../_drafts/2026-06-13-docs-inventory.md),
[`../_drafts/2026-06-13-doc-drift-matrix-v2.md`](../_drafts/2026-06-13-doc-drift-matrix-v2.md),
[`../_drafts/2026-06-13-docs-modernization-plan.md`](../_drafts/2026-06-13-docs-modernization-plan.md).

## Executive summary

Код ушёл вперёд (май-июнь), живые доки были заморожены на состоянии v1; вдобавок v1
оставил два больших долга. Проход v2 зафиксировал AI-пайплайн «как есть», выровнял факты,
заархивировал ~153 устаревших документа и перестроил навигацию. Живых документов осталось
**12** (было — разросшийся mislabeled-набор), битых ссылок **0**.

## Что сделано (9 атомарных коммитов)

| Коммит     | Что                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `8232c434` | C3: архив 133 исторических 2025-х файла из nested Diataxis (`guides/reference/explanations/development/ru` + nested ops)    |
| `4ff37834` | C4: 11 аспирационных Oct-2025 deployment-доков → архив; новый точный `deployment/README.md`; индекс `operations/migration/` |
| `3add83d1` | C2: новые `architecture/ai-pipeline.md` + `overview.md`; перестроен навигатор `docs/README.md`                              |
| `b802af38` | README + README-ru: счётчики, ссылки, снят GSD-абзац                                                                        |
| `ebbecf8d` | CHANGELOG: события мая-июня                                                                                                 |
| `06f33a05` | backend/frontend CLAUDE: факты стека/моделей/тестов                                                                         |
| `77eb027c` | C6: landing-промпты → `design/`, убран мусор                                                                                |
| `2de5f6d3` | C5: 29 untracked-доков взяты в git                                                                                          |
| `cf5c1b01` | C7: архив stale `ci-cd/`, переименование → fancai, починка битых ссылок                                                     |

(GEMINI.md тоже исправлен, но gitignored — правка локальная.)

## Ключевые исправления фактов (ground-truth, проверено кодом)

| Было в доках                                       | Стало (истина)                                                                                                 | Источник                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Противоречие OpenRouter vs Gemini-Direct vs Imagen | **OpenRouter — единственный активный путь** (gemini-2.5-flash + flux.2-klein-4b); `google-genai` = мёртвый код | `openrouter_client.py:58-59`, `config.py:60` |
| backend/CLAUDE: `gemini-3-flash-preview`           | реально `gemini-2.5-flash`                                                                                     | `openrouter_client.py:58`                    |
| «35+ backend / 60+ total» тесты                    | **76 backend / 38 frontend unit / 8 e2e**                                                                      | `backend/tests/`, `frontend/tests/`          |
| Мониторинг Prometheus/Grafana/Loki/Sentry          | **Netdata/VictoriaMetrics/Uptime-Kuma/Dozzle/Flower**                                                          | `docker-compose.monitoring.yml`              |
| 47 миграций                                        | **54**                                                                                                         | `alembic/versions/`                          |
| Vite 7, EpubReader 286 строк                       | **Vite 8, ~910 строк**                                                                                         | `package.json`, `EpubReader.tsx`             |
| Deployment: Nginx/AWS/K8s/multi-region             | **один VPS + Caddy + docker-compose**                                                                          | `Caddyfile`, `docker-compose.prod.yml`       |
| «BookReader AI»                                    | **fancai**                                                                                                     | rename                                       |

**Сервер НЕ мигрировал:** `operations/migration/` (recon 2026-05-10) — пакет аварийной
готовности, не исполненное действие; deployment-доки текущей инфры валидны.

## Принятые решения (чекпоинт «go»)

1. Архивировать все 133 nested-2025 → `_archive/` ✓
2. `docs/ru/` стале-дерево → архив; русский остаётся в `README-ru.md` + живых доках ✓
3. Пустые Diataxis-дир удалены ✓
4. Новые `architecture/ai-pipeline.md` + `overview.md` ✓
5. Работа в `main` ✓
6. AGENTS.md (чист, 0 правок) / GEMINI.md (починен) — факты, структура сохранена ✓

## Метрики

|                              | До                             | После                                  |
| ---------------------------- | ------------------------------ | -------------------------------------- |
| Битые ссылки (живые доки)    | 8                              | **0**                                  |
| Живых доков (non-historical) | mislabeled-набор + 133 зарытых | **12**                                 |
| Заархивировано за проход     | —                              | **153** (.md: 133 diataxis + 20 infra) |
| Untracked доков              | 29                             | 0 (взяты в git)                        |

## Верификация (Фаза 5)

- Линк-чек (живые доки): **0 битых** (Python-скрипт).
- Запрещённые токены в живых: `/gsd:`/`get-shit-done` — только в CHANGELOG (документирует удаление);
  `BookReader AI` — 0; устаревшие модели — только в dead-code-заметках.
- Smoke-тест Quick Start: все пути ✓ (`docker-compose.dev.yml`, `.env.production.example`, …).
- Навигатор = дерево 1:1: все 16 каталогов существуют.

## Отложено / вне scope (рекомендации, требуют решения)

1. **Код, не доки** (drift-matrix §4): убрать `google-genai` из `requirements.txt` (мёртвый код) +
   исправить вводящие в заблуждение комментарии `requirements.txt:22,29-30`.
2. `.pre-commit-config.yaml` устарел (Black 23.11/ruff 0.1.6/mypy 1.7.1).
3. Хук `settings.json SubagentStart` утверждает «Redis DB0/1/2», код по дефолту — один DB0.
4. Отсутствует `LICENSE`-файл (ссылки в README убраны; добавить файл — продуктовое решение).
5. Отсутствует `backend/pyproject.toml` (установка через `requirements.txt`).
6. `docs/security/` (lowercase) — мелкий редундант рядом с `docs/SECURITY.md`; можно свернуть.
7. `docs/research/` gemini-кластер (~22 файла) взят в git как есть; при желании — консолидация дублей.

## Источники истины (для v3)

`backend/requirements.txt` · `frontend/package.json` · `docker-compose.prod.yml` ·
`docker-compose.monitoring.yml` · `Caddyfile` · `backend/app/core/openrouter_client.py` +
`config.py` · `.github/workflows/` · `docs/operations/migration/00-RECON-REPORT.md`.

---

_Подготовил: модернизация документации v2, 2026-06-13. Прошлый проход — [`2026-04-30-documentation-modernization.md`](2026-04-30-documentation-modernization.md)._
