"""Тесты max_length constraints для Modal Pydantic schemas.

Проверяют что JSON Schema содержит maxLength для всех string полей
и ValidationError при превышении лимита.
"""

import os
import sys

import pytest
from pydantic import ValidationError

# modal/ не в PYTHONPATH — добавляем для импорта
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "modal"))

from schemas import (  # noqa: E402
    ModalDescriptionSchema,
    ModalEntitySchema,
    ModalRelationshipSchema,
)


class TestEntitySchemaMaxLength:
    """Проверка maxLength в JSON Schema для ModalEntitySchema."""

    def test_entity_schema_max_length_constraints(self):
        schema = ModalEntitySchema.model_json_schema()
        props = schema["properties"]

        assert props["name"]["maxLength"] == 200
        assert props["type"]["maxLength"] == 50
        assert props["visual_summary"]["maxLength"] == 500

    def test_entity_optional_fields_max_length(self):
        schema = ModalEntitySchema.model_json_schema()
        props = schema["properties"]

        # Optional fields — maxLength in anyOf schema
        for field_name, expected_len in [
            ("chapter_event_action", 300),
            ("chapter_event_inner", 300),
        ]:
            field_schema = props[field_name]
            # Pydantic Optional[str] with max_length uses anyOf
            if "anyOf" in field_schema:
                str_schema = next(
                    s for s in field_schema["anyOf"] if s.get("type") == "string"
                )
                assert (
                    str_schema["maxLength"] == expected_len
                ), f"{field_name} maxLength should be {expected_len}"
            else:
                assert field_schema["maxLength"] == expected_len

    def test_entity_name_too_long_raises_validation_error(self):
        with pytest.raises(ValidationError):
            ModalEntitySchema(name="x" * 201)

    def test_entity_name_at_limit_valid(self):
        entity = ModalEntitySchema(name="x" * 200)
        assert len(entity.name) == 200


class TestDescriptionSchemaMaxLength:
    """Проверка maxLength в JSON Schema для ModalDescriptionSchema."""

    def test_description_schema_max_length_constraints(self):
        schema = ModalDescriptionSchema.model_json_schema()
        props = schema["properties"]

        assert props["content"]["maxLength"] == 2000
        assert props["type"]["maxLength"] == 50
        assert props["image_prompt_en"]["maxLength"] == 300

    def test_description_content_too_long_raises_validation_error(self):
        with pytest.raises(ValidationError):
            ModalDescriptionSchema(content="x" * 2001)

    def test_description_content_at_limit_valid(self):
        desc = ModalDescriptionSchema(content="x" * 2000)
        assert len(desc.content) == 2000


class TestRelationshipSchemaMaxLength:
    """Проверка maxLength в JSON Schema для ModalRelationshipSchema."""

    def test_relationship_schema_max_length_constraints(self):
        schema = ModalRelationshipSchema.model_json_schema()
        props = schema["properties"]

        assert props["source"]["maxLength"] == 200
        assert props["target"]["maxLength"] == 200
        assert props["type"]["maxLength"] == 100
        assert props["context"]["maxLength"] == 300

    def test_relationship_source_too_long_raises_validation_error(self):
        with pytest.raises(ValidationError):
            ModalRelationshipSchema(source="x" * 201, target="a", type="ally")

    def test_relationship_at_limit_valid(self):
        rel = ModalRelationshipSchema(
            source="x" * 200, target="y" * 200, type="z" * 100, context="c" * 300
        )
        assert len(rel.source) == 200
        assert len(rel.target) == 200
        assert len(rel.type) == 100
        assert len(rel.context) == 300
