"""Тесты для модели ChapterEmbedding."""

import uuid

from app.models.chapter_embedding import ChapterEmbedding


class TestChapterEmbeddingModel:
    """Тесты для модели ChapterEmbedding."""

    def test_chapter_embedding_table_name(self):
        """Тест что правильное имя таблицы."""
        assert ChapterEmbedding.__tablename__ == "chapter_embeddings"

    def test_chapter_embedding_creation(self):
        """Тест создания экземпляра ChapterEmbedding."""
        chapter_id = uuid.uuid4()
        embedding = ChapterEmbedding(
            chapter_id=chapter_id,
            chunk_index=0,
            chunk_text="Тестовый текст главы для embedding",
            embedding=[0.1] * 384,
        )
        assert embedding.chapter_id == chapter_id
        assert embedding.chunk_index == 0
        assert embedding.chunk_text == "Тестовый текст главы для embedding"
        assert len(embedding.embedding) == 384

    def test_chapter_embedding_repr(self):
        """Тест строкового представления."""
        test_id = uuid.uuid4()
        chapter_id = uuid.uuid4()
        embedding = ChapterEmbedding(
            id=test_id,
            chapter_id=chapter_id,
            chunk_index=3,
        )
        repr_str = repr(embedding)
        assert "ChapterEmbedding" in repr_str
        assert str(test_id) in repr_str
        assert str(chapter_id) in repr_str

    def test_chapter_embedding_vector_dimension(self):
        """Тест что embedding колонка поддерживает 384 измерения."""
        embedding = ChapterEmbedding(
            chapter_id=uuid.uuid4(),
            chunk_index=0,
            chunk_text="Test",
            embedding=[0.0] * 384,
        )
        assert len(embedding.embedding) == 384

    def test_chapter_embedding_hnsw_index_defined(self):
        """Тест что HNSW индекс определён в table_args."""
        table_args = ChapterEmbedding.__table_args__
        index_names = [
            arg.name
            for arg in table_args
            if hasattr(arg, "name") and arg.name and "hnsw" in arg.name
        ]
        assert "ix_chapter_embeddings_embedding_hnsw" in index_names

    def test_chapter_embedding_unique_constraint(self):
        """Тест что unique constraint на (chapter_id, chunk_index) определён."""
        table_args = ChapterEmbedding.__table_args__
        constraint_names = [
            arg.name
            for arg in table_args
            if hasattr(arg, "name") and arg.name and "uq_" in arg.name
        ]
        assert "uq_chapter_embeddings_chapter_chunk" in constraint_names


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
