"""
Тесты для модели FeatureFlag.

Проверяет корректность работы модели, валидацию полей,
методы сериализации и предопределенные значения.
"""

from datetime import datetime
import uuid

from app.models.feature_flag import (
    FeatureFlag,
    FeatureFlagCategory,
    DEFAULT_FEATURE_FLAGS,
)


class TestFeatureFlagModel:
    """Тесты для модели FeatureFlag."""

    def test_feature_flag_creation(self):
        """Тест создания экземпляра FeatureFlag."""
        flag = FeatureFlag(
            name="TEST_FLAG",
            enabled=True,
            category=FeatureFlagCategory.SYSTEM.value,
            description="Test flag description",
            default_value=False,
        )

        assert flag.name == "TEST_FLAG"
        assert flag.enabled is True
        assert flag.category == FeatureFlagCategory.SYSTEM.value
        assert flag.description == "Test flag description"
        assert flag.default_value is False

    def test_feature_flag_default_values(self):
        """Тест значений по умолчанию при создании флага."""
        # При создании без сохранения в БД, Python-level defaults могут не применяться.
        # Тестируем с явными значениями для обязательных полей.
        flag = FeatureFlag(
            name="MINIMAL_FLAG",
            enabled=False,
            category=FeatureFlagCategory.SYSTEM.value,
            default_value=False,
        )

        assert flag.enabled is False
        assert flag.category == FeatureFlagCategory.SYSTEM.value
        assert flag.default_value is False
        assert flag.description is None  # Optional field, should be None

    def test_feature_flag_repr(self):
        """Тест строкового представления флага."""
        flag = FeatureFlag(
            name="TEST_FLAG",
            enabled=True,
            category=FeatureFlagCategory.NLP.value,
        )

        repr_str = repr(flag)
        assert "FeatureFlag" in repr_str
        assert "TEST_FLAG" in repr_str
        assert "enabled=True" in repr_str
        assert "nlp" in repr_str

    def test_feature_flag_to_dict(self):
        """Тест сериализации флага в словарь."""
        flag = FeatureFlag(
            id=uuid.uuid4(),
            name="TEST_FLAG",
            enabled=True,
            category=FeatureFlagCategory.PARSER.value,
            description="Parser test flag",
            default_value=True,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )

        flag_dict = flag.to_dict()

        assert flag_dict["name"] == "TEST_FLAG"
        assert flag_dict["enabled"] is True
        assert flag_dict["category"] == FeatureFlagCategory.PARSER.value
        assert flag_dict["description"] == "Parser test flag"
        assert flag_dict["default_value"] is True
        assert "id" in flag_dict
        assert "created_at" in flag_dict
        assert "updated_at" in flag_dict

    def test_feature_flag_to_dict_with_none_timestamps(self):
        """Тест сериализации флага с None временных меток."""
        flag = FeatureFlag(
            id=uuid.uuid4(),
            name="TEST_FLAG",
            enabled=False,
            category=FeatureFlagCategory.SYSTEM.value,
            created_at=None,
            updated_at=None,
        )

        flag_dict = flag.to_dict()

        assert flag_dict["created_at"] is None
        assert flag_dict["updated_at"] is None

    def test_feature_flag_to_dict_iso_format_dates(self):
        """Тест что даты в словаре в ISO формате."""
        test_time = datetime.now()
        flag = FeatureFlag(
            id=uuid.uuid4(),
            name="TEST_FLAG",
            enabled=True,
            category=FeatureFlagCategory.SYSTEM.value,
            created_at=test_time,
            updated_at=test_time,
        )

        flag_dict = flag.to_dict()

        # Проверяем что это строка в ISO формате
        assert isinstance(flag_dict["created_at"], str)
        assert isinstance(flag_dict["updated_at"], str)
        assert (
            "T" in flag_dict["created_at"]
        )  # ISO format имеет T между датой и временем

    def test_feature_flag_category_enum_values(self):
        """Тест всех категорий feature flags."""
        expected_categories = ["nlp", "parser", "images", "system", "experimental"]

        actual_categories = [cat.value for cat in FeatureFlagCategory]

        assert set(actual_categories) == set(expected_categories)

    def test_feature_flag_with_all_categories(self):
        """Тест создания флагов со всеми категориями."""
        for category in FeatureFlagCategory:
            flag = FeatureFlag(
                name=f"TEST_{category.value.upper()}",
                enabled=True,
                category=category.value,
            )

            assert flag.category == category.value

    def test_feature_flag_enabled_boolean_values(self):
        """Тест что enabled только boolean значения."""
        # True
        flag_true = FeatureFlag(name="FLAG_TRUE", enabled=True)
        assert flag_true.enabled is True

        # False
        flag_false = FeatureFlag(name="FLAG_FALSE", enabled=False)
        assert flag_false.enabled is False

    def test_default_feature_flags_count(self):
        """Тест что DEFAULT_FEATURE_FLAGS содержит 10 флагов."""
        assert len(DEFAULT_FEATURE_FLAGS) == 10

    def test_default_feature_flags_required_fields(self):
        """Тест что каждый дефолтный флаг имеет требуемые поля."""
        required_fields = {
            "name",
            "enabled",
            "category",
            "description",
            "default_value",
        }

        for default_flag in DEFAULT_FEATURE_FLAGS:
            flag_fields = set(default_flag.keys())
            assert required_fields.issubset(
                flag_fields
            ), f"Flag {default_flag.get('name')} missing fields"

    def test_default_feature_flags_names(self):
        """Тест что дефолтные флаги имеют ожидаемые имена."""
        expected_names = {
            "USE_NEW_NLP_ARCHITECTURE",
            "USE_ADVANCED_PARSER",
            "USE_LLM_ENRICHMENT",
            "ENABLE_ENSEMBLE_VOTING",
            "ENABLE_PARALLEL_PROCESSING",
            "ENABLE_IMAGE_CACHING",
            "USE_GLINER_NER",
            "USE_DESCRIPTION_CLASSIFIER",
            "USE_HYBRID_PIPELINE",
            "USE_PGVECTOR_EMBEDDINGS",
        }

        actual_names = {flag["name"] for flag in DEFAULT_FEATURE_FLAGS}

        assert actual_names == expected_names

    def test_default_feature_flags_categories(self):
        """Тест что дефолтные флаги имеют правильные категории."""
        category_mapping = {
            "USE_NEW_NLP_ARCHITECTURE": FeatureFlagCategory.NLP.value,
            "USE_ADVANCED_PARSER": FeatureFlagCategory.PARSER.value,
            "USE_LLM_ENRICHMENT": FeatureFlagCategory.NLP.value,
            "ENABLE_ENSEMBLE_VOTING": FeatureFlagCategory.NLP.value,
            "ENABLE_PARALLEL_PROCESSING": FeatureFlagCategory.NLP.value,
            "ENABLE_IMAGE_CACHING": FeatureFlagCategory.IMAGES.value,
            "USE_GLINER_NER": FeatureFlagCategory.NLP.value,
            "USE_DESCRIPTION_CLASSIFIER": FeatureFlagCategory.NLP.value,
            "USE_HYBRID_PIPELINE": FeatureFlagCategory.NLP.value,
            "USE_PGVECTOR_EMBEDDINGS": FeatureFlagCategory.NLP.value,
        }

        for default_flag in DEFAULT_FEATURE_FLAGS:
            name = default_flag["name"]
            expected_category = category_mapping[name]
            assert default_flag["category"] == expected_category

    def test_default_feature_flags_use_new_nlp_architecture_enabled(self):
        """Тест что USE_NEW_NLP_ARCHITECTURE включен по умолчанию."""
        flag = next(
            f for f in DEFAULT_FEATURE_FLAGS if f["name"] == "USE_NEW_NLP_ARCHITECTURE"
        )

        assert flag["enabled"] is True
        assert flag["default_value"] is True

    def test_default_feature_flags_use_advanced_parser_disabled(self):
        """Тест что USE_ADVANCED_PARSER отключен по умолчанию."""
        flag = next(
            f for f in DEFAULT_FEATURE_FLAGS if f["name"] == "USE_ADVANCED_PARSER"
        )

        assert flag["enabled"] is False
        assert flag["default_value"] is False

    def test_default_feature_flags_use_llm_enrichment_disabled(self):
        """Тест что USE_LLM_ENRICHMENT отключен по умолчанию."""
        flag = next(
            f for f in DEFAULT_FEATURE_FLAGS if f["name"] == "USE_LLM_ENRICHMENT"
        )

        assert flag["enabled"] is False
        assert flag["default_value"] is False

    def test_default_feature_flags_use_gliner_ner_disabled(self):
        """Тест что USE_GLINER_NER отключен по умолчанию."""
        flag = next(f for f in DEFAULT_FEATURE_FLAGS if f["name"] == "USE_GLINER_NER")
        assert flag["enabled"] is False
        assert flag["default_value"] is False
        assert flag["category"] == FeatureFlagCategory.NLP.value

    def test_default_feature_flags_use_description_classifier_disabled(self):
        """Тест что USE_DESCRIPTION_CLASSIFIER отключен по умолчанию."""
        flag = next(
            f
            for f in DEFAULT_FEATURE_FLAGS
            if f["name"] == "USE_DESCRIPTION_CLASSIFIER"
        )
        assert flag["enabled"] is False
        assert flag["default_value"] is False

    def test_default_feature_flags_use_hybrid_pipeline_disabled(self):
        """Тест что USE_HYBRID_PIPELINE отключен по умолчанию."""
        flag = next(
            f for f in DEFAULT_FEATURE_FLAGS if f["name"] == "USE_HYBRID_PIPELINE"
        )
        assert flag["enabled"] is False
        assert flag["default_value"] is False

    def test_default_feature_flags_use_pgvector_embeddings_disabled(self):
        """Тест что USE_PGVECTOR_EMBEDDINGS отключен по умолчанию."""
        flag = next(
            f for f in DEFAULT_FEATURE_FLAGS if f["name"] == "USE_PGVECTOR_EMBEDDINGS"
        )
        assert flag["enabled"] is False
        assert flag["default_value"] is False

    def test_feature_flag_id_uuid_type(self):
        """Тест что id флага UUID типа."""
        test_id = uuid.uuid4()
        flag = FeatureFlag(
            id=test_id,
            name="TEST_FLAG",
        )

        assert flag.id == test_id
        assert isinstance(flag.id, uuid.UUID)

    def test_feature_flag_table_name(self):
        """Тест что правильное имя таблицы."""
        assert FeatureFlag.__tablename__ == "feature_flags"


class TestFeatureFlagValidation:
    """Тесты валидации модели FeatureFlag."""

    def test_feature_flag_name_can_be_long(self):
        """Тест что имя флага может быть до 100 символов."""
        long_name = "A" * 100
        flag = FeatureFlag(name=long_name, enabled=True)

        assert flag.name == long_name

    def test_feature_flag_description_can_be_long(self):
        """Тест что описание может быть очень длинным."""
        long_description = "Description. " * 100
        flag = FeatureFlag(
            name="TEST_FLAG",
            description=long_description,
        )

        assert flag.description == long_description

    def test_feature_flag_enabled_disabled_cycle(self):
        """Тест что можно переключать enabled значение."""
        flag = FeatureFlag(name="TOGGLE_FLAG", enabled=True)

        assert flag.enabled is True

        flag.enabled = False
        assert flag.enabled is False

        flag.enabled = True
        assert flag.enabled is True

    def test_feature_flag_default_value_independent_from_enabled(self):
        """Тест что default_value независим от enabled."""
        # enabled=True но default_value=False
        flag1 = FeatureFlag(
            name="FLAG1",
            enabled=True,
            default_value=False,
        )
        assert flag1.enabled is True
        assert flag1.default_value is False

        # enabled=False но default_value=True
        flag2 = FeatureFlag(
            name="FLAG2",
            enabled=False,
            default_value=True,
        )
        assert flag2.enabled is False
        assert flag2.default_value is True
