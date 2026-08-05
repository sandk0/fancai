"""Перевод строки в записи лога не должен разрывать её на две.

Пользовательские данные попадают в сообщения по всему приложению: `flag_name`
из админского API, `book_id` из пути WebSocket (объявлен как `str`, не UUID),
текст исключения, промпт иллюстрации. Значение с `\\n` превращает одну запись
в две, и вторая выглядит как самостоятельное событие с любым уровнем и текстом,
какие подберёт атакующий.

**Основной проверяемый путь — stdlib `logging`, а не loguru.** Через
`from loguru import logger` пишет меньшинство модулей; все семь файлов,
где CodeQL нашёл `log-injection`, берут `logging.getLogger(__name__)`.
Тест только на loguru был бы зелёным при полностью незащищённом приложении.
"""

import io
import json
import logging

import pytest
from loguru import logger

from app.core.logging import setup_logging

FORGED = "geralt\nCRITICAL | app.core.auth - admin login succeeded"


@pytest.fixture(autouse=True)
def scrubbers_installed():
    """Ставит обе защиты так же, как это делает приложение при старте."""
    setup_logging(debug=True, log_level="DEBUG")


@pytest.fixture
def stdlib_sink():
    """Хендлер на том же логгере, которым пользуются роутеры и сервисы."""
    sink = io.StringIO()
    handler = logging.StreamHandler(sink)
    handler.setFormatter(logging.Formatter("%(levelname)s | %(message)s"))
    target = logging.getLogger("app.services.feature_flag_manager")
    target.addHandler(handler)
    target.setLevel(logging.DEBUG)
    yield sink, target
    target.removeHandler(handler)


class TestStdlibLogging:
    """`logging.getLogger(__name__)` — путь, по которому идут все находки."""

    def test_forged_line_stays_one_record(self, stdlib_sink):
        """Ключевой инвариант: одно событие — одна строка."""
        sink, target = stdlib_sink

        target.warning(f"Feature flag '{FORGED}' not found")

        written = sink.getvalue()
        assert written.count("\n") == 1, "запись разорвана на несколько строк"

    def test_content_is_escaped_not_dropped(self, stdlib_sink):
        sink, target = stdlib_sink

        target.error(f"Error getting feature flag '{FORGED}'")

        written = sink.getvalue()
        assert "\\n" in written
        assert "geralt" in written
        assert "admin login succeeded" in written

    def test_percent_style_args_are_scrubbed_too(self, stdlib_sink):
        """Ленивое %-форматирование: содержимое приезжает в `args`, не в `msg`."""
        sink, target = stdlib_sink

        target.warning("Feature flag '%s' not found", FORGED)

        written = sink.getvalue()
        assert written.count("\n") == 1
        assert "\\n" in written

    def test_dict_style_args_are_scrubbed(self, stdlib_sink):
        sink, target = stdlib_sink

        target.warning("flag %(name)s missing", {"name": FORGED})

        assert sink.getvalue().count("\n") == 1

    def test_carriage_return_is_escaped(self, stdlib_sink):
        """`\\r` в терминале перезатирает начало строки."""
        sink, target = stdlib_sink

        target.warning("value=a\rWARNING | подделка")

        written = sink.getvalue()
        assert "\r" not in written
        assert "\\r" in written

    def test_clean_message_is_untouched(self, stdlib_sink):
        sink, target = stdlib_sink

        target.warning("Feature flag 'USE_NEW_PARSER' not found")

        assert (
            sink.getvalue().strip()
            == "WARNING | Feature flag 'USE_NEW_PARSER' not found"
        )

    def test_repeated_setup_does_not_nest_factories(self, stdlib_sink):
        """`setup_logging` зовётся при импорте и из тестов — фабрики не вкладываются."""
        sink, target = stdlib_sink
        for _ in range(3):
            setup_logging(debug=True, log_level="DEBUG")

        target.warning(f"flag={FORGED}")

        written = sink.getvalue()
        # Двойное применение дало бы `\\\\n` вместо `\\n`.
        assert "\\\\n" not in written
        assert "\\n" in written


class TestLoguruLogging:
    """Второй путь: `from loguru import logger` (например `routers/images.py`)."""

    @pytest.fixture
    def loguru_sink(self):
        sink = io.StringIO()
        handler_id = logger.add(sink, format="{level} | {message}", level="DEBUG")
        yield sink
        logger.remove(handler_id)

    def test_forged_line_stays_one_record(self, loguru_sink):
        logger.info(f"Accessing image file: {FORGED}")

        assert loguru_sink.getvalue().count("\n") == 1

    def test_json_sink_keeps_single_line_and_full_text(self):
        """Продовый синк — JSON."""
        setup_logging(debug=False, log_level="DEBUG")
        sink = io.StringIO()
        handler_id = logger.add(
            sink, format="{message}", level="DEBUG", serialize=True
        )
        try:
            logger.info(f"flag={FORGED}")
            written = sink.getvalue()
        finally:
            logger.remove(handler_id)

        assert written.count("\n") == 1
        record = json.loads(written)
        assert "geralt" in record["record"]["message"]
        assert "\n" not in record["record"]["message"]
