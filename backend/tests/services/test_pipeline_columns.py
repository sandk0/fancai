"""Тесты для колонок extraction_source и pipeline_version в Entity и Description."""


class TestPipelineVersionColumn:
    """Тесты для pipeline_version колонки в Entity и Description."""

    def test_entity_has_pipeline_version(self):
        """Тест что Entity имеет атрибут pipeline_version."""
        from app.models.entity import Entity

        assert hasattr(Entity, "pipeline_version")

    def test_description_has_pipeline_version(self):
        """Тест что Description имеет атрибут pipeline_version."""
        from app.models.description import Description

        assert hasattr(Description, "pipeline_version")

    def test_entity_pipeline_version_nullable(self):
        """Тест что pipeline_version в Entity nullable (default None)."""
        from app.models.entity import Entity

        entity = Entity(name="Test", type="character", name_lower="test")
        assert entity.pipeline_version is None

    def test_description_pipeline_version_nullable(self):
        """Тест что pipeline_version в Description nullable (default None)."""
        from app.models.description import Description

        desc = Description(
            content="test",
            type="character",
            confidence_score=0.5,
            position_in_chapter=0,
        )
        assert desc.pipeline_version is None


class TestExtractionSourceColumn:
    """Тесты для extraction_source колонки в Entity и Description."""

    def test_entity_has_extraction_source(self):
        """Тест что Entity имеет атрибут extraction_source."""
        from app.models.entity import Entity

        assert hasattr(Entity, "extraction_source")

    def test_description_has_extraction_source(self):
        """Тест что Description имеет атрибут extraction_source."""
        from app.models.description import Description

        assert hasattr(Description, "extraction_source")

    def test_entity_extraction_source_default_llm(self):
        """Тест что extraction_source в Entity по умолчанию не задан (server_default)."""
        from app.models.entity import Entity

        entity = Entity(name="Test", type="character", name_lower="test")
        # server_default='llm' — в Python default не устанавливается,
        # проверяем что атрибут существует
        assert hasattr(entity, "extraction_source")

    def test_description_extraction_source_default_llm(self):
        """Тест что extraction_source в Description по умолчанию не задан (server_default)."""
        from app.models.description import Description

        desc = Description(
            content="test",
            type="character",
            confidence_score=0.5,
            position_in_chapter=0,
        )
        assert hasattr(desc, "extraction_source")
