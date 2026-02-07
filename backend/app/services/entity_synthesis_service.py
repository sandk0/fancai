"""
Entity Synthesis Service — Phase 2 post-book processing.

Генерирует biography milestones, roles, relationship evolution
на основе EntityEvents и visual_summary.
"""

import json
import logging
from typing import Any, Optional

from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.json_utils import parse_json_safe

logger = logging.getLogger(__name__)


SYNTHESIS_PROMPT_TEMPLATE = """Ты — литературный аналитик. Создай энциклопедию персонажей книги.

Жанр книги: {genre}. Язык книги: {language}.
Генерируй biography, events, dynamic_role на языке книги.

Жанровые акценты:
- DETECTIVE: мотивы, подозрения, алиби, улики, допросы
- FANTASY: способности, фракции, магические свойства, битвы
- ROMANCE: эмоции, развитие отношений, ключевые моменты
- THRILLER: угрозы, решения под давлением, конфликты
- HISTORICAL: исторический контекст, социальные роли
- Для остальных жанров: общий фокус на действиях и развитии

Адаптируй контент по типу entity:
- character: biography = биография, events = действия + чувства
- location: biography = история и атмосфера места, events = что здесь происходит
- object: biography = значимость в сюжете, events = найден/использован/упомянут

Полный список имён всех entities в книге:
{all_entity_names}

Данные entities (с events и visual_summary):
{entities_data}

ЗАДАЧА:
Для КАЖДОЙ entity из данных:
1. Определи base_role: protagonist, antagonist, supporting, episodic
2. Создай milestones — ключевые моменты развития (3-10 штук)
3. Каждый milestone:
   - up_to_chapter: до какой главы актуально
   - biography: краткая биография на этот момент (1-3 предложения)
   - visual_summary_clean: чистое описание внешности (без спойлеров, детали)
   - dynamic_role: текущая роль (на языке книги)
   - importance: важность 1-10

4. Для ПАРЫ entities определи relationship_milestones:
   - up_to_chapter, type (KINSHIP/ALLY/ENEMY/FRIEND/MENTOR/STUDENT/ROMANCE/RIVAL), weight (-100..100)

ПРАВИЛА:
- НЕ выдумывай факты, которых нет в предоставленных данных
- Первое появление — обязательный milestone
- biography должна быть spoiler-free для читателя на данной главе
- Язык всего контента = {language}

OUTPUT JSON:
{{
  "entities": [
    {{
      "name": "Имя",
      "base_role": "protagonist|antagonist|supporting|episodic",
      "milestones": [
        {{
          "up_to_chapter": 1,
          "biography": "...",
          "visual_summary_clean": "...",
          "dynamic_role": "...",
          "importance": 8
        }}
      ]
    }}
  ],
  "relationship_milestones": [
    {{
      "source": "Имя1",
      "target": "Имя2",
      "milestones": [
        {{ "up_to_chapter": 3, "type": "FRIEND", "weight": 30 }}
      ]
    }}
  ]
}}
"""


class EntitySynthesisService:
    def __init__(self, gemini_client: Any = None):
        self.gemini_client = gemini_client

    @staticmethod
    def _build_synthesis_prompt(
        entities_data: list[dict],
        all_entity_names: list[str],
        genre: str,
        language: str,
    ) -> str:
        """Формирует prompt для synthesis LLM-вызова."""
        return SYNTHESIS_PROMPT_TEMPLATE.format(
            genre=genre,
            language=language,
            all_entity_names=json.dumps(all_entity_names, ensure_ascii=False),
            entities_data=json.dumps(entities_data, ensure_ascii=False, indent=2),
        )

    @staticmethod
    def _batch_entities(
        entities: list[dict], batch_size: int = 50
    ) -> list[list[dict]]:
        """Разбивает entities на batch'и для LLM-вызовов."""
        return [
            entities[i: i + batch_size]
            for i in range(0, len(entities), batch_size)
        ]

    @staticmethod
    def _parse_synthesis_response(response: dict) -> dict:
        """Валидация и парсинг JSON ответа synthesis."""
        entities = response.get("entities", [])
        relationship_milestones = response.get("relationship_milestones", [])

        parsed_entities = []
        for e in entities:
            if not isinstance(e, dict) or "name" not in e:
                continue
            parsed_entities.append({
                "name": e["name"],
                "base_role": e.get("base_role", "episodic"),
                "milestones": e.get("milestones", []),
            })

        return {
            "entities": parsed_entities,
            "relationship_milestones": relationship_milestones,
        }

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
    async def _call_gemini(self, prompt: str) -> dict:
        """Вызов Gemini с retry."""
        if not self.gemini_client:
            from app.services.gemini_extractor import get_gemini_extractor

            extractor = get_gemini_extractor()
            if not extractor.is_available():
                logger.warning("Gemini not available for synthesis")
                return {"entities": [], "relationship_milestones": []}

            import google.genai.types as types

            client = extractor._client
            model = extractor.config.model_reduce

            response = await client.aio.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json"
                ),
            )

            raw = parse_json_safe(response.text)
            return raw if isinstance(raw, dict) else {}

        return {}

    async def synthesize_book_entities(
        self,
        book_id: str,
        entities: list[dict],
        events: list[dict],
        genre: str,
        language: str,
    ) -> dict:
        """
        Основной метод: batching → LLM calls → parse → return results.

        Args:
            book_id: ID книги
            entities: список entity dicts с visual_summary и прочими данными
            events: список event dicts с chapter_number, action, inner_state
            genre: жанр книги
            language: язык книги

        Returns:
            Parsed synthesis response with milestones and relationship_milestones
        """
        if not entities:
            return {"entities": [], "relationship_milestones": []}

        # Merge events into entities data
        events_by_entity: dict[str, list] = {}
        for ev in events:
            name = ev.get("entity_name", "").lower()
            if name not in events_by_entity:
                events_by_entity[name] = []
            events_by_entity[name].append(ev)

        entities_data = []
        for e in entities:
            name = e.get("name", "")
            entity_events = events_by_entity.get(name.lower(), [])
            entities_data.append({
                "name": name,
                "type": e.get("type", "character"),
                "visual_summary": e.get("visual_summary", ""),
                "events": entity_events,
            })

        all_entity_names = [e["name"] for e in entities_data]

        # Batching
        batches = self._batch_entities(entities_data)
        logger.info(
            f"Book {book_id}: Synthesis — {len(entities_data)} entities in {len(batches)} batch(es)"
        )

        all_results: dict = {"entities": [], "relationship_milestones": []}

        for batch_idx, batch in enumerate(batches):
            try:
                prompt = self._build_synthesis_prompt(
                    entities_data=batch,
                    all_entity_names=all_entity_names,
                    genre=genre,
                    language=language,
                )
                raw_response = await self._call_gemini(prompt)
                parsed = self._parse_synthesis_response(raw_response)
                all_results["entities"].extend(parsed["entities"])
                all_results["relationship_milestones"].extend(
                    parsed["relationship_milestones"]
                )
                logger.info(
                    f"Book {book_id}: Synthesis batch {batch_idx + 1}/{len(batches)} — "
                    f"{len(parsed['entities'])} entities processed"
                )
            except Exception as e:
                logger.error(
                    f"Book {book_id}: Synthesis batch {batch_idx + 1} failed: {e}",
                    exc_info=True,
                )

        return all_results
