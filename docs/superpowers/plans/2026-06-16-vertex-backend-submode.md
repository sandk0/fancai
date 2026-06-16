# Vertex AI Backend Sub-Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Commit footer:** каждый коммит заканчивать строкой
> `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

**Goal:** Добавить Vertex AI как альтернативный backend существующего `GeminiClient` (под-флаг `GEMINI_BACKEND=developer|vertex`), чтобы задействовать $300 Google Cloud trial-кредиты — Developer API их не принимает, Vertex принимает. Регион `global`.

**Architecture:** Vertex — **не** новый провайдер. `ai_provider_factory` по-прежнему разводит `gemini|openrouter`. Развилка `developer|vertex` живёт в одном месте — singleton `get_gemini_client()` и конструктор `GeminiClient.__init__`: для `vertex` → `genai.Client(vertexai=True, project=, location=)` с аутентификацией через ADC (service-account JSON, env `GOOGLE_APPLICATION_CREDENTIALS`); для `developer` → текущий `genai.Client(api_key=)`. Вызовы `generate_content` идентичны, поэтому `gemini_extractor`/`consistency_manager`/`entity_deduplication` не трогаются. Image-путь (`NanoBananaGenerator`, `PromptTranslator`) наследует singleton автоматически; правится только гард доступности `ImagenService._initialize`, завязанный на `GEMINI_API_KEY`.

**Tech Stack:** google-genai 2.8.0, Vertex AI (`aiplatform.googleapis.com`), pytest + monkeypatch/patch, pydantic settings.

**Отношение к плану v3:** этот документ **переопределяет** решение «Vertex ❌ Нет (пока)» в `docs/plans/2026-06-13-gemini-migration-plan-v3.md` §1 (стр. 53) и §2.4 (стр. 140). Прежняя мотивация была ZDR/приватность (отклонена как избыточная). Новая мотивация — биллинг: $300 trial работает только с Vertex. Всё едет за флагом, прод по умолчанию `AI_PROVIDER=openrouter`.

---

## File Structure

| Файл                                                 | Действие                                               | Ответственность                                            |
| ---------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| `backend/app/core/config.py`                         | Modify (после стр. 73)                                 | +`GEMINI_BACKEND`, `GCP_PROJECT`, `GCP_LOCATION`           |
| `backend/app/core/gemini_client.py`                  | Modify (`__init__` 53-54, `get_gemini_client` 166-171) | развилка backend в конструкторе + singleton                |
| `backend/app/services/imagen_generator.py`           | Modify (`_initialize` 356-360, msg 419, health ~658)   | гард доступности учитывает Vertex (нет ключа)              |
| `backend/tests/core/test_config_gemini.py`           | Modify                                                 | assert новых полей                                         |
| `backend/tests/core/test_gemini_backend_mode.py`     | Create                                                 | развилка клиента: vertex vs developer (мок `genai.Client`) |
| `backend/tests/services/test_imagen_vertex_guard.py` | Create                                                 | ImagenService доступен в Vertex без `GEMINI_API_KEY`       |
| `docs/plans/2026-06-13-gemini-migration-plan-v3.md`  | Modify (§1 стр.53, §2.4 стр.140, A0.1)                 | переопределить решение по Vertex                           |
| Prod compose + secrets                               | Deploy (позже, через `/deploy`)                        | смонтировать SA-JSON, env в backend+celery                 |

**Порядок исполнения:** Task 1 (инфра — делает пользователь, параллельно) → Task 2 → 3 → 4 → 5 (smoke, нужен ключ из Task 1) → 6 (docs) → 7 (deploy, позже).

---

## Task 1: GCP-инфраструктура (ручная, пользователь)

Инфра-задача, не TDD. Создаёт креденшелы, без которых Task 5 не запустится. Выполняется в Google Cloud Console / `gcloud` параллельно с Task 2-4.

**Files:** none (внешняя настройка) → результат: файл `~/fancai-vertex.json` на машине разработчика.

- [ ] **Step 1:** В `console.cloud.google.com` создать проект (или взять созданный под trial). Записать `PROJECT_ID`.
- [ ] **Step 2:** Billing → убедиться, что Free Trial ($300) привязан к этому проекту.
- [ ] **Step 3:** Enable Vertex AI API:

```bash
gcloud config set project PROJECT_ID
gcloud services enable aiplatform.googleapis.com
```

- [ ] **Step 4:** Создать service-account с минимальной ролью `roles/aiplatform.user`:

```bash
gcloud iam service-accounts create fancai-vertex --display-name="fancai Vertex"
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:fancai-vertex@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

- [ ] **Step 5:** Скачать JSON-ключ (не коммитить):

```bash
gcloud iam service-accounts keys create ~/fancai-vertex.json \
  --iam-account=fancai-vertex@PROJECT_ID.iam.gserviceaccount.com
```

- [ ] **Step 6:** Проверить, что ключ читается SDK (быстрый ADC-чек):

Run:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=~/fancai-vertex.json
cd backend && uv run python -c "from google import genai; genai.Client(vertexai=True, project='PROJECT_ID', location='global'); print('client ok')"
```

Expected: `client ok` без ошибок аутентификации.

---

## Task 2: Config — поля Vertex-режима

**Files:**

- Modify: `backend/app/core/config.py` (после строки 73, т.е. после блока `GEMINI_IMAGE_MODEL`)
- Test: `backend/tests/core/test_config_gemini.py`

- [ ] **Step 1: Написать падающий тест**

Добавить в `backend/tests/core/test_config_gemini.py`:

```python
def test_vertex_backend_settings_exist_with_defaults():
    assert settings.GEMINI_BACKEND in ("developer", "vertex")
    assert settings.GCP_LOCATION == "global"
    assert hasattr(settings, "GCP_PROJECT")
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd backend && uv run python -m pytest tests/core/test_config_gemini.py::test_vertex_backend_settings_exist_with_defaults -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'GEMINI_BACKEND'`.

- [ ] **Step 3: Минимальная реализация**

В `backend/app/core/config.py` сразу после строки 73 (закрывающая `)` у `GEMINI_IMAGE_MODEL`) добавить:

```python
    # Vertex AI backend (sub-mode of Gemini provider) — задействует $300 GCP trial
    GEMINI_BACKEND: str = "developer"   # developer | vertex
    GCP_PROJECT: str = ""               # Vertex: ID проекта Google Cloud
    GCP_LOCATION: str = "global"  # Vertex: регион (Нидерланды)
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `cd backend && uv run python -m pytest tests/core/test_config_gemini.py -v`
Expected: PASS (оба теста).

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/config.py backend/tests/core/test_config_gemini.py
git commit -m "feat(ai): add GEMINI_BACKEND/GCP_PROJECT/GCP_LOCATION settings"
```

---

## Task 3: GeminiClient — развилка backend (developer | vertex)

**Files:**

- Modify: `backend/app/core/gemini_client.py` (`__init__` 53-54; `get_gemini_client` 166-171)
- Test: `backend/tests/core/test_gemini_backend_mode.py` (создать)

- [ ] **Step 1: Написать падающий тест**

Создать `backend/tests/core/test_gemini_backend_mode.py`:

```python
from unittest.mock import patch

import app.core.gemini_client as gc
from app.core.gemini_client import GeminiClient


def test_developer_backend_uses_api_key():
    with patch("app.core.gemini_client.genai.Client") as C:
        GeminiClient(api_key="dev-key")
    C.assert_called_once_with(api_key="dev-key")


def test_vertex_backend_uses_project_location():
    with patch("app.core.gemini_client.genai.Client") as C:
        GeminiClient(vertexai=True, project="proj-123", location="global")
    C.assert_called_once_with(
        vertexai=True, project="proj-123", location="global"
    )


def test_singleton_picks_vertex_when_backend_vertex(monkeypatch):
    monkeypatch.setattr(gc.settings, "GEMINI_BACKEND", "vertex")
    monkeypatch.setattr(gc.settings, "GCP_PROJECT", "proj-123")
    monkeypatch.setattr(gc.settings, "GCP_LOCATION", "global")
    gc._client = None
    with patch("app.core.gemini_client.genai.Client") as C:
        gc.get_gemini_client()
    C.assert_called_once_with(
        vertexai=True, project="proj-123", location="global"
    )
    gc._client = None


def test_singleton_picks_developer_when_backend_developer(monkeypatch):
    monkeypatch.setattr(gc.settings, "GEMINI_BACKEND", "developer")
    monkeypatch.setattr(gc.settings, "GEMINI_API_KEY", "dev-key")
    gc._client = None
    with patch("app.core.gemini_client.genai.Client") as C:
        gc.get_gemini_client()
    C.assert_called_once_with(api_key="dev-key")
    gc._client = None
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd backend && uv run python -m pytest tests/core/test_gemini_backend_mode.py -v`
Expected: FAIL — `TypeError: __init__() got an unexpected keyword argument 'vertexai'`.

- [ ] **Step 3: Реализация — конструктор**

В `backend/app/core/gemini_client.py` заменить `__init__` (строки 53-54):

```python
    def __init__(
        self,
        api_key: str = "",
        *,
        vertexai: bool = False,
        project: str = "",
        location: str = "",
    ):
        if vertexai:
            self._client = genai.Client(
                vertexai=True, project=project, location=location
            )
        else:
            self._client = genai.Client(api_key=api_key)
```

- [ ] **Step 4: Реализация — singleton**

В том же файле заменить `get_gemini_client` (строки 166-171):

```python
def get_gemini_client() -> GeminiClient:
    """Singleton GeminiClient. Backend по settings.GEMINI_BACKEND (developer|vertex)."""
    global _client
    if _client is None:
        if settings.GEMINI_BACKEND == "vertex":
            _client = GeminiClient(
                vertexai=True,
                project=settings.GCP_PROJECT,
                location=settings.GCP_LOCATION,
            )
        else:
            _client = GeminiClient(api_key=settings.GEMINI_API_KEY)
    return _client
```

- [ ] **Step 5: Запустить — убедиться, что проходит (и не сломаны соседние)**

Run: `cd backend && uv run python -m pytest tests/core/test_gemini_backend_mode.py tests/core/test_ai_provider_factory.py tests/services/test_gemini_extractor.py -v`
Expected: PASS. (Совместимость: `GeminiClient(api_key="x")` в `test_ai_provider_factory.py` по-прежнему работает — `api_key` остался первым позиционным.)

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/gemini_client.py backend/tests/core/test_gemini_backend_mode.py
git commit -m "feat(ai): route GeminiClient to Vertex backend via GEMINI_BACKEND"
```

---

## Task 4: ImagenService — гард доступности для Vertex

В Vertex-режиме `GEMINI_API_KEY` пуст, но сервис должен работать (аутентификация через ADC). Сейчас `_initialize` (стр. 358) гасит сервис при пустом ключе.

**Files:**

- Modify: `backend/app/services/imagen_generator.py` (`_initialize` 356-360; сообщение 419; health ~658)
- Test: `backend/tests/services/test_imagen_vertex_guard.py` (создать)

- [ ] **Step 1: Написать падающий тест**

Создать `backend/tests/services/test_imagen_vertex_guard.py`:

```python
from unittest.mock import patch

import app.core.gemini_client as gc
import app.services.imagen_generator as ig
from app.services.imagen_generator import ImagenService


def test_imagen_available_in_vertex_without_api_key(monkeypatch):
    monkeypatch.setattr(ig.settings, "GEMINI_BACKEND", "vertex")
    monkeypatch.setattr(ig.settings, "GCP_PROJECT", "proj-123")
    monkeypatch.setattr(ig.settings, "GEMINI_API_KEY", "")
    gc._client = None
    with patch("app.core.gemini_client.genai.Client"):
        svc = ImagenService()
    assert svc.is_available() is True
    gc._client = None


def test_imagen_disabled_developer_without_key(monkeypatch):
    monkeypatch.setattr(ig.settings, "GEMINI_BACKEND", "developer")
    monkeypatch.setattr(ig.settings, "GEMINI_API_KEY", "")
    gc._client = None
    svc = ImagenService()
    assert svc.is_available() is False
    gc._client = None
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd backend && uv run python -m pytest tests/services/test_imagen_vertex_guard.py -v`
Expected: FAIL — `test_imagen_available_in_vertex_without_api_key` падает (сервис disabled, т.к. ключ пуст).

- [ ] **Step 3: Реализация — хелпер креденшелов**

В `backend/app/services/imagen_generator.py` добавить функцию-модуль (рядом с `logger`, после строки 36):

```python
def _gemini_credentials_present() -> bool:
    """Vertex аутентифицируется через ADC (нужен GCP_PROJECT), Developer — через ключ."""
    if settings.GEMINI_BACKEND == "vertex":
        return bool(settings.GCP_PROJECT)
    return bool(settings.GEMINI_API_KEY)
```

- [ ] **Step 4: Реализация — применить хелпер в трёх местах**

Заменить гард `_initialize` (строки 358-360):

```python
        if not _gemini_credentials_present():
            logger.warning("No Gemini credentials — ImagenService disabled")
            return
```

Заменить сообщение об ошибке (строка 419):

```python
                error_message="ImagenService не доступен. Проверьте Gemini credentials (GEMINI_API_KEY или GCP_PROJECT).",
```

Заменить значение в health (строка 658, имя ключа сохранить для обратной совместимости мониторинга):

```python
            "has_api_key": _gemini_credentials_present(),
```

- [ ] **Step 5: Запустить — убедиться, что проходит**

Run: `cd backend && uv run python -m pytest tests/services/test_imagen_vertex_guard.py tests/services/test_imagen_generator.py -v`
Expected: PASS (новые + существующие image-тесты).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/imagen_generator.py backend/tests/services/test_imagen_vertex_guard.py
git commit -m "fix(images): enable ImagenService in Vertex mode (ADC, no api key)"
```

---

## Task 5: Live smoke на Vertex (ручная, требует ключа из Task 1)

Юнит-тесты мокают `genai.Client` — они слепы к реальным Vertex-различиям (callable model-id, casing `thinking_level`, JSON-mode, image). Эта задача закрывает «верифицировать на ключе» из плана v3, но на Vertex.

**Files:** none (ручной прогон). Результат — при необходимости правка `GEMINI_IMAGE_MODEL` в `config.py`.

- [ ] **Step 1: Текст**

Run:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=~/fancai-vertex.json
cd backend && uv run python -c "
from google import genai
c = genai.Client(vertexai=True, project='PROJECT_ID', location='global')
print(c.models.generate_content(model='gemini-3.5-flash', contents='Скажи одно слово').text)
"
```

Expected: непустой русский ответ.

- [ ] **Step 2: Structured + thinking_level (проверить casing)**

Run:

```bash
cd backend && AI_PROVIDER=gemini GEMINI_BACKEND=vertex GCP_PROJECT=PROJECT_ID \
  GOOGLE_APPLICATION_CREDENTIALS=~/fancai-vertex.json \
  uv run python -c "
import asyncio
from pydantic import BaseModel
from app.core.gemini_client import get_gemini_client
class S(BaseModel):
    name: str
print(asyncio.run(get_gemini_client().generate_structured('Верни имя: Геральт', S)))
"
```

Expected: `{'name': 'Геральт'}` без ошибок про `thinking_level` (если Vertex требует иной casing/значение — зафиксировать и поправить `generate_structured` в отдельном фиксе).

- [ ] **Step 3: Image-ID (подтвердить callable на Vertex)**

Run:

```bash
cd backend && uv run python -c "
from google import genai
from google.genai import types
c = genai.Client(vertexai=True, project='PROJECT_ID', location='global')
for m in ('gemini-3.1-flash-image', 'gemini-2.5-flash-image'):
    try:
        r = c.models.generate_content(model=m, contents='a red apple on a table',
            config=types.GenerateContentConfig(response_modalities=['IMAGE']))
        print(m, 'OK', bool(r.candidates))
    except Exception as e:
        print(m, 'FAIL', type(e).__name__, str(e)[:120])
"
```

Expected: хотя бы один `OK`. Если callable id отличается от `settings.GEMINI_IMAGE_MODEL` — обновить `config.py:71-73` и закоммитить:

```bash
git commit -am "fix(images): set Vertex-callable image model id"
```

- [ ] **Step 4: Записать результат** в `docs/reports/2026-06-16-vertex-smoke.md` (модели, latency, refusal на «тёмном» промпте — связь с A3.2 safety-риском).

---

## Task 6: Обновить план миграции v3 (переопределить решение по Vertex)

**Files:**

- Modify: `docs/plans/2026-06-13-gemini-migration-plan-v3.md` (§1 стр. 53, §2.4 стр. 140, A0.1 стр. 195-210)

- [ ] **Step 1:** В §1 (таблица возможностей, строка 53) заменить строку `Vertex AI` на:

```markdown
| **Vertex AI** (backend-режим Gemini) | ✅ Да (под `GEMINI_BACKEND=vertex`) | A0/A1/A3 | Задействует $300 GCP trial (Developer API его не принимает). Регион `global`. ZDR — побочный бонус, не мотивация. План: `docs/superpowers/plans/2026-06-16-vertex-backend-submode.md` |
```

- [ ] **Step 2:** В §2.4 (стр. 140) добавить строку:

```markdown
- **Backend:** Vertex AI (`GEMINI_BACKEND=vertex`), регион `global`, аутентификация через service-account ADC (`GOOGLE_APPLICATION_CREDENTIALS`). $300 trial — 90 дней / см. cutover.
```

- [ ] **Step 3:** В A0.1 добавить Step 3b — поля Vertex (ссылка на Task 2 этого плана), чтобы исполнитель v3 не пропустил.

- [ ] **Step 4: Commit**

```bash
git add docs/plans/2026-06-13-gemini-migration-plan-v3.md
git commit -m "docs(plan): adopt Vertex backend sub-mode, supersede 'Vertex: no'"
```

---

## Task 7: Deploy-обвязка (позже, через `/deploy`)

Прод-cutover. Выполняется ПОСЛЕ Task 2-6 и зелёного smoke. Механика compose — в `/deploy` skill (compose-файл живёт на проде, не в репо).

**Files:** prod compose (backend + celery сервисы), `secrets/` на сервере, `.gitignore`.

- [ ] **Step 1:** Положить `fancai-vertex.json` на прод-сервер в `secrets/vertex-sa.json` (НЕ в git). Добавить `secrets/` в `.gitignore`, если отсутствует.
- [ ] **Step 2:** В сервисах **backend** и **celery** прод-compose добавить:
  - volume: `./secrets/vertex-sa.json:/secrets/vertex-sa.json:ro`
  - env: `GOOGLE_APPLICATION_CREDENTIALS=/secrets/vertex-sa.json`, `GEMINI_BACKEND=vertex`, `GCP_PROJECT=<PROJECT_ID>`, `GCP_LOCATION=global`
  - (cutover) `AI_PROVIDER=gemini` — переключать **последним**, после прогона книги за флагом.
- [ ] **Step 3:** Деплой через `/deploy`. Smoke на проде: обработать одну книгу, проверить illustrations + glossary.
- [ ] **Step 4:** Зафиксировать дату cutover-дедлайна на paid billing (**trial = 90 дней с старта**), чтобы сервис не встал по истечении кредита.

---

## Self-Review

**Spec coverage:**

- $300 trial → Vertex: Task 1 (инфра) + Task 3 (backend-развилка). ✅
- Регион `global`: Task 2 (дефолт `GCP_LOCATION`). ✅
- Image-путь не ломается: Task 4 (гард) + Task 5 Step 3 (callable id). ✅
- Прод за флагом, без регресса: `GEMINI_BACKEND` default `developer`, `AI_PROVIDER` default `openrouter`; cutover — Task 7 Step 2. ✅
- Переопределение решения v3: Task 6. ✅
- Деплой позже: Task 7. ✅

**Placeholder scan:** код приведён полностью в каждом code-шаге; `PROJECT_ID` — реальный плейсхолдер среды (значение из Task 1), не пропуск логики. ✅

**Type consistency:** `GEMINI_BACKEND`/`GCP_PROJECT`/`GCP_LOCATION` именуются одинаково в config (Task 2), клиенте (Task 3), гарде (Task 4), smoke (Task 5), deploy (Task 7). Хелпер `_gemini_credentials_present()` определён в Task 4 Step 3 и используется в трёх местах Task 4 Step 4. Конструктор `GeminiClient(api_key="", *, vertexai, project, location)` — сигнатура из Task 3 Step 3 совпадает с вызовами в тестах Task 3 Step 1 и singleton Task 3 Step 4. ✅

---

## Execution Handoff

После сохранения плана — выбор способа исполнения (см. ниже в чате).
