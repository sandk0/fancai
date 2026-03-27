"""Тесты нового return формата Modal: metrics transport и finish_reason проверка.

Контракт:
- extract_chapter() и reduce_entities() возвращают {"result": ..., "metrics": {...}}
- metrics содержит: cold_start_ms, inference_ms, finish_reason, is_cold_start
- При finish_reason="length": result=None, truncated_text содержит первые 500 символов
- cold_start_ms замеряет реальное время загрузки модели в @enter
"""

import json
import sys
import types
from unittest.mock import MagicMock, patch

import pytest


def _make_mock_output(text: str, finish_reason: str = "stop") -> MagicMock:
    """Создаёт mock vLLM CompletionOutput."""
    output = MagicMock()
    output.text = text
    output.finish_reason = finish_reason
    return output


def _make_mock_chat_result(output: MagicMock) -> list:
    """Создаёт mock результат LLM.chat() — list[RequestOutput]."""
    request_output = MagicMock()
    request_output.outputs = [output]
    return [request_output]


def _create_extractor_instance():
    """Создаёт LLMExtractor с замоканным vLLM и modal.

    Стратегия: мокаем modal декораторы как no-op, затем импортируем
    llm_extractor напрямую. Паттерн из test_modal_integration.py.
    """
    # Mock modal и зависимости до импорта
    mock_modal = MagicMock()
    mock_modal.enter = lambda: lambda fn: fn
    mock_modal.method = lambda: lambda fn: fn
    mock_modal.Volume = MagicMock

    # cls decorator — возвращает класс без изменений
    mock_app = MagicMock()
    mock_app.cls = lambda **kwargs: lambda cls: cls

    # Mock vLLM
    mock_vllm = types.ModuleType("vllm")
    mock_vllm.LLM = MagicMock
    mock_vllm.SamplingParams = MagicMock

    mock_vllm_sampling = types.ModuleType("vllm.sampling_params")
    mock_vllm_sampling.StructuredOutputsParams = MagicMock

    # Inject mocks
    sys.modules["modal"] = mock_modal
    sys.modules["vllm"] = mock_vllm
    sys.modules["vllm.sampling_params"] = mock_vllm_sampling

    # Mock config и app модули из modal/
    mock_config = types.ModuleType("config")
    mock_config.LLM_MODEL_ID = "test-model"
    mock_config.VOLUME_PATH = "/test"
    mock_config.LLM_GPU = "T4"
    mock_config.LLM_TIMEOUT = 60
    mock_config.MAX_MODEL_LEN = 1024
    mock_config.GPU_MEMORY_UTILIZATION = 0.9
    mock_config.KV_CACHE_DTYPE = "auto"
    mock_config.NUM_GPU_BLOCKS_OVERRIDE = None
    sys.modules["config"] = mock_config

    mock_app_module = types.ModuleType("app")
    mock_app_module.app = mock_app
    mock_app_module.llm_image = MagicMock()
    mock_app_module.model_volume = MagicMock()
    mock_app_module.COMMON_CLS_KWARGS = {}
    sys.modules["app"] = mock_app_module

    # Очищаем кэш если был предыдущий импорт
    if "llm_extractor" in sys.modules:
        del sys.modules["llm_extractor"]

    # Добавляем modal/ в sys.path для импорта
    import os

    modal_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "modal")
    modal_dir = os.path.normpath(modal_dir)
    if modal_dir not in sys.path:
        sys.path.insert(0, modal_dir)

    import llm_extractor

    extractor = llm_extractor.LLMExtractor()

    return extractor, mock_vllm


VALID_JSON = json.dumps(
    {"entities": [{"name": "Geralt"}], "descriptions": [], "relationships": []}
)
LONG_TEXT = "A" * 1000  # Для теста truncated_text[:500]
SCHEMA_JSON = '{"type": "object"}'
SYSTEM_PROMPT = "Extract entities."


class TestModalMetricsFormat:
    """Тесты нового формата ответа Modal с metrics transport."""

    def test_extract_chapter_returns_metrics(self):
        """extract_chapter с finish_reason='stop' возвращает dict с 'result' и 'metrics'."""
        extractor, mock_vllm = _create_extractor_instance()
        output = _make_mock_output(VALID_JSON, finish_reason="stop")
        mock_llm = MagicMock()
        mock_llm.chat.return_value = _make_mock_chat_result(output)
        extractor.llm = mock_llm
        # Имитируем cold start
        extractor._cold_start_ms = 1500
        extractor._is_first_call = True

        result = extractor.extract_chapter("Chapter text", SYSTEM_PROMPT, SCHEMA_JSON)

        assert "result" in result, "extract_chapter должен возвращать 'result' ключ"
        assert "metrics" in result, "extract_chapter должен возвращать 'metrics' ключ"
        assert result["result"] is not None
        assert result["result"]["entities"][0]["name"] == "Geralt"

    def test_extract_chapter_metrics_fields(self):
        """metrics содержит cold_start_ms, inference_ms, finish_reason, is_cold_start."""
        extractor, mock_vllm = _create_extractor_instance()
        output = _make_mock_output(VALID_JSON, finish_reason="stop")
        mock_llm = MagicMock()
        mock_llm.chat.return_value = _make_mock_chat_result(output)
        extractor.llm = mock_llm
        extractor._cold_start_ms = 2000
        extractor._is_first_call = True

        result = extractor.extract_chapter("Chapter text", SYSTEM_PROMPT, SCHEMA_JSON)
        metrics = result["metrics"]

        assert "cold_start_ms" in metrics
        assert "inference_ms" in metrics
        assert "finish_reason" in metrics
        assert "is_cold_start" in metrics
        assert isinstance(metrics["cold_start_ms"], int)
        assert metrics["cold_start_ms"] >= 0
        assert isinstance(metrics["inference_ms"], int)
        assert metrics["inference_ms"] >= 0
        assert isinstance(metrics["finish_reason"], str)
        assert isinstance(metrics["is_cold_start"], bool)

    def test_extract_chapter_truncated_on_length(self):
        """При finish_reason='length' result=None и truncated_text содержит первые 500 символов."""
        extractor, mock_vllm = _create_extractor_instance()
        output = _make_mock_output(LONG_TEXT, finish_reason="length")
        mock_llm = MagicMock()
        mock_llm.chat.return_value = _make_mock_chat_result(output)
        extractor.llm = mock_llm
        extractor._cold_start_ms = 0
        extractor._is_first_call = False

        result = extractor.extract_chapter("Chapter text", SYSTEM_PROMPT, SCHEMA_JSON)

        assert result["result"] is None, "При truncation result должен быть None"
        assert "truncated_text" in result, "Должен содержать truncated_text"
        assert (
            len(result["truncated_text"]) == 500
        ), "truncated_text = первые 500 символов"
        assert result["metrics"]["finish_reason"] == "length"

    def test_cold_start_flag(self):
        """Первый вызов после cold start имеет is_cold_start=True, второй — False."""
        extractor, mock_vllm = _create_extractor_instance()
        output = _make_mock_output(VALID_JSON, finish_reason="stop")
        mock_llm = MagicMock()
        mock_llm.chat.return_value = _make_mock_chat_result(output)
        extractor.llm = mock_llm
        extractor._cold_start_ms = 3000
        extractor._is_first_call = True

        # Первый вызов
        result1 = extractor.extract_chapter("Ch1", SYSTEM_PROMPT, SCHEMA_JSON)
        assert result1["metrics"]["is_cold_start"] is True
        assert result1["metrics"]["cold_start_ms"] == 3000

        # Второй вызов — уже не cold start
        result2 = extractor.extract_chapter("Ch2", SYSTEM_PROMPT, SCHEMA_JSON)
        assert result2["metrics"]["is_cold_start"] is False
        assert result2["metrics"]["cold_start_ms"] == 0

    def test_reduce_entities_returns_metrics(self):
        """reduce_entities с finish_reason='stop' возвращает аналогичный формат."""
        extractor, mock_vllm = _create_extractor_instance()
        reduce_json = json.dumps(
            {"entities": [{"name": "Geralt"}, {"name": "Yennefer"}]}
        )
        output = _make_mock_output(reduce_json, finish_reason="stop")
        mock_llm = MagicMock()
        mock_llm.chat.return_value = _make_mock_chat_result(output)
        extractor.llm = mock_llm
        extractor._cold_start_ms = 0
        extractor._is_first_call = False

        result = extractor.reduce_entities(
            '{"entities": [...]}', SYSTEM_PROMPT, SCHEMA_JSON
        )

        assert "result" in result, "reduce_entities должен возвращать 'result' ключ"
        assert "metrics" in result, "reduce_entities должен возвращать 'metrics' ключ"
        assert result["result"] is not None
        assert result["metrics"]["finish_reason"] == "stop"
        assert result["metrics"]["is_cold_start"] is False

    def test_reduce_entities_truncated_on_length(self):
        """reduce_entities с finish_reason='length' возвращает result=None + truncated_text."""
        extractor, mock_vllm = _create_extractor_instance()
        output = _make_mock_output(LONG_TEXT, finish_reason="length")
        mock_llm = MagicMock()
        mock_llm.chat.return_value = _make_mock_chat_result(output)
        extractor.llm = mock_llm
        extractor._cold_start_ms = 0
        extractor._is_first_call = False

        result = extractor.reduce_entities(
            '{"entities": [...]}', SYSTEM_PROMPT, SCHEMA_JSON
        )

        assert result["result"] is None, "При truncation result должен быть None"
        assert "truncated_text" in result
        assert len(result["truncated_text"]) == 500
        assert result["metrics"]["finish_reason"] == "length"
