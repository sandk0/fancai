# План доработки Backend для Entity Cards (v3: Final Implementation Spec)

**Дата:** 24.01.2026
**Статус:** Ready for Development
**Цель:** Реализовать API для Entity Cards с защитой от спойлеров и дедупликацией.

## 1. Архитектура: Service Layer Pattern

Мы используем стандартный для проекта паттерн **Service Layer**. Вся логика, связанная с графом и сущностями, инкапсулируется в `EntityService`.

### Новые компоненты
| Компонент | Путь | Назначение |
| :--- | :--- | :--- |
| **Schema** | `app/schemas/responses/entities.py` | Pydantic модели ответа (Network, Node, Edge). |
| **Service** | `app/services/entity_service.py` | Бизнес-логика: слияние дублей, кэширование, сборка графа. |
| **Router** | `app/routers/books/entities.py` | REST API endpoint `GET /network`. |

---

## 2. Логика "Soft Merge" (Дедупликация)

**Проблема:** Экстрактор создает дубли ("Геральт", "Геральта", "Ведьмак").
**Решение:** Слияние на чтении (Read-time Merge).

**Алгоритм `EntityService._merge_entities(entities)`:**
1.  **Normalization**: `normalize(name) -> lower().strip()`.
2.  **Grouping**: Группируем сущности по ключу нормализованного имени.
3.  **Master Election**:
    *   Если есть `visual_summary` -> Побеждает.
    *   Иначе -> Тот, у кого выше `importance`.
    *   Иначе -> Тот, у кого больше `relations`.
4.  **Remapping**:
    *   Создаем карту `remap_map: {duplicate_id: master_id}`.
    *   Проходим по всем связям (`edges`) и заменяем `source`/`target`, если они в `remap_map`.
    *   Проходим по всем описаниям (`descriptions`) и собираем их в список Master Entity.

---

## 3. Схема данных (Response Schema)

Файл: `app/schemas/responses/entities.py`

```python
from pydantic import BaseModel
from typing import List, Dict, Optional
from uuid import UUID

class EntityNoteSchema(BaseModel):
    """Описание или упоминание"""
    text: str
    chapter_index: int  # Для спойлер-фильтра
    type: str           # CHARACTER / ACTION

class EntityDetailSchema(BaseModel):
    id: UUID
    name: str              # Имя "Мастера"
    type: str              # CHARACTER
    avatar_url: Optional[str]
    importance: int        # 1-10
    
    mentions: List[int]    # Главы появления [1, 5, 10]
    notes: List[EntityNoteSchema] # Смерженные описания

class NetworkEdgeSchema(BaseModel):
    source: UUID
    target: UUID
    type: str              # ALLY / ENEMY
    description: Optional[str]

class EntityNetworkResponse(BaseModel):
    entities: Dict[UUID, EntityDetailSchema] # Key = UUID
    edges: List[NetworkEdgeSchema]
```

---

## 4. План Реализации (Пошаговый)

### Step 1: Schemas (`app/schemas/responses/entities.py`) [DONE]
*   [x] Создать Pydantic модели.
*   [x] Убедиться в совместимости с Pydantic v2 (`model_config`).

### Step 2: Service (`app/services/entity_service.py`) [DONE]
*   [x] Метод `get_network(book_id)`:
    *   SQL: `select(Entity).options(selectinload(Entity.descriptions).joinedload(Description.chapter))`
    *   SQL: `select(EntityRelationship)`
    *   Logic: Вызов `_merge_entities`.
    *   Cache: `@cache_manager.cache("book:{id}:network", ttl=3600)`

### Step 3: Router (`app/routers/books/entities.py`) [DONE]
*   [x] Endpoint: `GET /{book_id}/entities/network`
*   [x] Dependency: `user: User = Depends(get_current_active_user)` (проверка доступа к книге).

### Step 4: Main Integration [DONE]
*   [x] В `app/main.py` подключить роутер: `app.include_router(entities_router, prefix="/api/v1/books", tags=["entities"])`.

---

## 5. Оптимизации (Checklist)
*   [ ] **SQL**: Использовать `selectinload` для коллекций, чтобы избежать декартова произведения.
*   [ ] **Payload**: Исключить `master_portrait_url` и тяжелые поля, если они не нужны для UI списка. (Но для карточки нужны).
*   [ ] **Redis**: Кэшировать результат слияния. Инвалидация кэша должна происходить при перезапуске экстракции (`process_book_task`).
