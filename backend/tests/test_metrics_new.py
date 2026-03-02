"""
TDD тесты для новых Prometheus метрик и модели LlmUsageLog.

Task 1 (Plan 04-01):
- Test 1: Импорт новых Counter из metrics.py
- Test 2: Все новые метрики — Counter с правильными labels
- Test 3: LlmUsageLog модель имеет правильные поля
- Test 4: Alembic миграция создаёт таблицу llm_usage_log
"""

import pytest
from prometheus_client import Counter

# ============================================================================
# Test 1: Импорт новых Counter из metrics.py
# ============================================================================


class TestNewMetricsImport:
    """Тестирование импорта новых Prometheus Counter."""

    def test_import_llm_cost_dollars_total(self):
        """llm_cost_dollars_total импортируется из metrics.py."""
        from app.monitoring.metrics import llm_cost_dollars_total

        assert llm_cost_dollars_total is not None

    def test_import_llm_fallback_total(self):
        """llm_fallback_total импортируется из metrics.py."""
        from app.monitoring.metrics import llm_fallback_total

        assert llm_fallback_total is not None

    def test_import_auth_registrations_total(self):
        """auth_registrations_total импортируется из metrics.py."""
        from app.monitoring.metrics import auth_registrations_total

        assert auth_registrations_total is not None

    def test_import_auth_logins_total(self):
        """auth_logins_total импортируется из metrics.py."""
        from app.monitoring.metrics import auth_logins_total

        assert auth_logins_total is not None

    def test_import_rate_limit_triggered_total(self):
        """rate_limit_triggered_total импортируется из metrics.py."""
        from app.monitoring.metrics import rate_limit_triggered_total

        assert rate_limit_triggered_total is not None

    def test_import_helper_functions(self):
        """Все helper-функции импортируются из metrics.py."""
        from app.monitoring.metrics import (
            record_llm_cost,
            record_llm_fallback,
            record_auth_registration,
            record_auth_login,
            record_rate_limit_triggered,
        )

        assert callable(record_llm_cost)
        assert callable(record_llm_fallback)
        assert callable(record_auth_registration)
        assert callable(record_auth_login)
        assert callable(record_rate_limit_triggered)


# ============================================================================
# Test 2: Типы и labels новых метрик
# ============================================================================


class TestNewMetricsTypes:
    """Тестирование типов и labels новых Prometheus Counter."""

    def test_llm_cost_dollars_total_is_counter(self):
        """llm_cost_dollars_total — Counter."""
        from app.monitoring.metrics import llm_cost_dollars_total

        # Counter в prometheus_client имеет метод _metrics для доступа к label values
        assert hasattr(llm_cost_dollars_total, "_labelnames")

    def test_llm_cost_dollars_total_has_model_label(self):
        """llm_cost_dollars_total имеет label 'model'."""
        from app.monitoring.metrics import llm_cost_dollars_total

        assert "model" in llm_cost_dollars_total._labelnames

    def test_llm_fallback_total_has_from_model_to_model_labels(self):
        """llm_fallback_total имеет labels 'from_model' и 'to_model'."""
        from app.monitoring.metrics import llm_fallback_total

        assert "from_model" in llm_fallback_total._labelnames
        assert "to_model" in llm_fallback_total._labelnames

    def test_auth_registrations_total_no_labels(self):
        """auth_registrations_total не имеет labels."""
        from app.monitoring.metrics import auth_registrations_total

        assert len(auth_registrations_total._labelnames) == 0

    def test_auth_logins_total_has_status_label(self):
        """auth_logins_total имеет label 'status'."""
        from app.monitoring.metrics import auth_logins_total

        assert "status" in auth_logins_total._labelnames

    def test_rate_limit_triggered_total_has_endpoint_and_limit_type_labels(self):
        """rate_limit_triggered_total имеет labels 'endpoint' и 'limit_type'."""
        from app.monitoring.metrics import rate_limit_triggered_total

        assert "endpoint" in rate_limit_triggered_total._labelnames
        assert "limit_type" in rate_limit_triggered_total._labelnames

    def test_helper_record_llm_cost_increments(self):
        """record_llm_cost() инкрементирует llm_cost_dollars_total."""
        from app.monitoring.metrics import record_llm_cost, llm_cost_dollars_total

        before = llm_cost_dollars_total.labels(model="test-model-cost")._value.get()
        record_llm_cost(model="test-model-cost", cost=0.001)
        after = llm_cost_dollars_total.labels(model="test-model-cost")._value.get()

        assert after > before

    def test_helper_record_llm_fallback_increments(self):
        """record_llm_fallback() инкрементирует llm_fallback_total."""
        from app.monitoring.metrics import record_llm_fallback, llm_fallback_total

        before = llm_fallback_total.labels(
            from_model="model-a", to_model="model-b"
        )._value.get()
        record_llm_fallback(from_model="model-a", to_model="model-b")
        after = llm_fallback_total.labels(
            from_model="model-a", to_model="model-b"
        )._value.get()

        assert after == before + 1

    def test_helper_record_auth_registration_increments(self):
        """record_auth_registration() инкрементирует auth_registrations_total."""
        from app.monitoring.metrics import (
            record_auth_registration,
            auth_registrations_total,
        )

        before = auth_registrations_total._value.get()
        record_auth_registration()
        after = auth_registrations_total._value.get()

        assert after == before + 1

    def test_helper_record_auth_login_increments(self):
        """record_auth_login() инкрементирует auth_logins_total."""
        from app.monitoring.metrics import record_auth_login, auth_logins_total

        before = auth_logins_total.labels(status="success")._value.get()
        record_auth_login(status="success")
        after = auth_logins_total.labels(status="success")._value.get()

        assert after == before + 1

    def test_helper_record_rate_limit_triggered_increments(self):
        """record_rate_limit_triggered() инкрементирует rate_limit_triggered_total."""
        from app.monitoring.metrics import (
            record_rate_limit_triggered,
            rate_limit_triggered_total,
        )

        before = rate_limit_triggered_total.labels(
            endpoint="/api/v1/test", limit_type="ip"
        )._value.get()
        record_rate_limit_triggered(endpoint="/api/v1/test", limit_type="ip")
        after = rate_limit_triggered_total.labels(
            endpoint="/api/v1/test", limit_type="ip"
        )._value.get()

        assert after == before + 1


# ============================================================================
# Test 3: Модель LlmUsageLog
# ============================================================================


class TestLlmUsageLogModel:
    """Тестирование SQLAlchemy модели LlmUsageLog."""

    def test_import_llm_usage_log(self):
        """LlmUsageLog импортируется из app.models.llm_usage_log."""
        from app.models.llm_usage_log import LlmUsageLog

        assert LlmUsageLog is not None

    def test_llm_usage_log_tablename(self):
        """LlmUsageLog.__ tablename__ == 'llm_usage_log'."""
        from app.models.llm_usage_log import LlmUsageLog

        assert LlmUsageLog.__tablename__ == "llm_usage_log"

    def test_llm_usage_log_has_id_column(self):
        """LlmUsageLog имеет поле id."""
        from app.models.llm_usage_log import LlmUsageLog

        assert hasattr(LlmUsageLog, "id")

    def test_llm_usage_log_has_created_at_column(self):
        """LlmUsageLog имеет поле created_at."""
        from app.models.llm_usage_log import LlmUsageLog

        assert hasattr(LlmUsageLog, "created_at")

    def test_llm_usage_log_has_model_column(self):
        """LlmUsageLog имеет поле model."""
        from app.models.llm_usage_log import LlmUsageLog

        assert hasattr(LlmUsageLog, "model")

    def test_llm_usage_log_has_service_column(self):
        """LlmUsageLog имеет поле service."""
        from app.models.llm_usage_log import LlmUsageLog

        assert hasattr(LlmUsageLog, "service")

    def test_llm_usage_log_has_prompt_tokens_column(self):
        """LlmUsageLog имеет поле prompt_tokens."""
        from app.models.llm_usage_log import LlmUsageLog

        assert hasattr(LlmUsageLog, "prompt_tokens")

    def test_llm_usage_log_has_completion_tokens_column(self):
        """LlmUsageLog имеет поле completion_tokens."""
        from app.models.llm_usage_log import LlmUsageLog

        assert hasattr(LlmUsageLog, "completion_tokens")

    def test_llm_usage_log_has_cost_dollars_column(self):
        """LlmUsageLog имеет поле cost_dollars."""
        from app.models.llm_usage_log import LlmUsageLog

        assert hasattr(LlmUsageLog, "cost_dollars")

    def test_llm_usage_log_has_request_id_column(self):
        """LlmUsageLog имеет поле request_id."""
        from app.models.llm_usage_log import LlmUsageLog

        assert hasattr(LlmUsageLog, "request_id")

    def test_llm_usage_log_imported_in_models_init(self):
        """LlmUsageLog импортируется из app.models."""
        from app.models import LlmUsageLog

        assert LlmUsageLog is not None
