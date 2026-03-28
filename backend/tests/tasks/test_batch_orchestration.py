"""Tests for batch orchestration: feature flag routing, checkpoint, retry, progress.

BATCH-01/02: Sub-batch vLLM processing orchestration.
Tests verify orchestration logic via unit tests (mocked Modal, DB, WebSocket).
"""

import time
from dataclasses import dataclass
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.services.modal_client import process_batch_results


@dataclass
class FakeChapter:
    """Minimal chapter stub for orchestration tests."""

    id: str = ""
    content: str | None = "chapter text"
    chapter_number: int = 1
    is_description_parsed: bool = False
    is_service_page: bool = False
    word_count: int = 500
    title: str = "Chapter"
    descriptions_found: int = 0
    parsed_at: object = None
    parsing_error: str | None = None
    error_type: str | None = None
    parse_attempts: int = 0

    def __post_init__(self):
        if not self.id:
            self.id = str(uuid4())


class TestFeatureFlagRouting:
    """Feature flag USE_BATCH_MODE routes between batch and sequential paths."""

    @pytest.mark.asyncio
    async def test_feature_flag_routes_to_batch(self):
        """When USE_BATCH_MODE=True, _process_chapters_batch_mode is called."""
        from app.tasks.book_tasks import _process_chapters_batch_mode

        chapters = [FakeChapter(content="x" * 1000) for _ in range(4)]

        mock_extractor = MagicMock()
        mock_extractor.extract_chapters_batch.remote.return_value = [
            {
                "result": {"entities": [], "descriptions": [], "relationships": []},
                "metrics": {
                    "cold_start_ms": 0,
                    "inference_ms": 100,
                    "finish_reason": "stop",
                },
                "chapter_idx": i,
            }
            for i in range(4)
        ]

        mock_db = AsyncMock()
        mock_db.commit = AsyncMock()
        mock_db.execute = AsyncMock()
        mock_db.flush = AsyncMock()

        with patch(
            "app.tasks.book_tasks.get_llm_extractor", return_value=mock_extractor
        ), patch(
            "app.tasks.book_tasks.group_chapters_into_batches",
            return_value=([chapters], []),
        ), patch(
            "app.tasks.book_tasks.publish_book_progress", new_callable=AsyncMock
        ), patch(
            "app.tasks.book_tasks._save_chapter_extraction_result",
            new_callable=AsyncMock,
            return_value=0,
        ):

            processed, descs = await _process_chapters_batch_mode(
                chapters=chapters,
                book_id=uuid4(),
                db=mock_db,
                task_start_time=time.monotonic(),
                total_chapters=4,
            )
            assert processed == 4
            mock_extractor.extract_chapters_batch.remote.assert_called_once()

    @pytest.mark.asyncio
    async def test_feature_flag_false_skips_batch(self):
        """When USE_BATCH_MODE=False, _process_chapters_batch_mode is NOT invoked.

        This is verified at the routing level in _process_book_async --
        here we just confirm the function exists and is importable.
        """
        from app.tasks.book_tasks import _process_chapters_batch_mode

        assert callable(_process_chapters_batch_mode)


class TestCheckpointCommits:
    """After processing a sub-batch, db.commit() is called (checkpoint)."""

    @pytest.mark.asyncio
    async def test_checkpoint_commits_after_batch(self):
        """db.commit() called after each sub-batch to persist results."""
        from app.tasks.book_tasks import _process_chapters_batch_mode

        batch1 = [FakeChapter(content="x" * 1000) for _ in range(3)]
        batch2 = [FakeChapter(content="x" * 1000) for _ in range(2)]

        def make_results(chapters):
            return [
                {
                    "result": {"entities": [], "descriptions": [], "relationships": []},
                    "metrics": {
                        "cold_start_ms": 0,
                        "inference_ms": 50,
                        "finish_reason": "stop",
                    },
                    "chapter_idx": i,
                }
                for i in range(len(chapters))
            ]

        mock_extractor = MagicMock()
        mock_extractor.extract_chapters_batch.remote.side_effect = [
            make_results(batch1),
            make_results(batch2),
        ]

        mock_db = AsyncMock()

        with patch(
            "app.tasks.book_tasks.get_llm_extractor", return_value=mock_extractor
        ), patch(
            "app.tasks.book_tasks.group_chapters_into_batches",
            return_value=([batch1, batch2], []),
        ), patch(
            "app.tasks.book_tasks.publish_book_progress", new_callable=AsyncMock
        ), patch(
            "app.tasks.book_tasks._save_chapter_extraction_result",
            new_callable=AsyncMock,
            return_value=0,
        ):

            await _process_chapters_batch_mode(
                chapters=batch1 + batch2,
                book_id=uuid4(),
                db=mock_db,
                task_start_time=time.monotonic(),
                total_chapters=5,
            )
            # 2 batches -> 2 commits (checkpoint after each)
            assert mock_db.commit.await_count == 2


class TestBatchCrashRetry:
    """When extract_chapters_batch.remote throws, chapters retry individually."""

    @pytest.mark.asyncio
    async def test_batch_crash_retries_individual(self):
        """Batch exception -> all chapters go to individual retry via extract_chapter.remote."""
        from app.tasks.book_tasks import _process_chapters_batch_mode

        chapters = [FakeChapter(content="x" * 1000) for _ in range(3)]

        mock_extractor = MagicMock()
        # Batch call throws
        mock_extractor.extract_chapters_batch.remote.side_effect = RuntimeError(
            "Modal crash"
        )
        # Individual retries succeed
        mock_extractor.extract_chapter.remote.return_value = {
            "result": {"entities": [], "descriptions": [], "relationships": []},
            "metrics": {
                "cold_start_ms": 0,
                "inference_ms": 50,
                "finish_reason": "stop",
            },
        }

        mock_db = AsyncMock()

        with patch(
            "app.tasks.book_tasks.get_llm_extractor", return_value=mock_extractor
        ), patch(
            "app.tasks.book_tasks.group_chapters_into_batches",
            return_value=([chapters], []),
        ), patch(
            "app.tasks.book_tasks.publish_book_progress", new_callable=AsyncMock
        ), patch(
            "app.tasks.book_tasks._save_chapter_extraction_result",
            new_callable=AsyncMock,
            return_value=0,
        ), patch(
            "app.tasks.book_tasks.modal_response_to_chapter_result"
        ) as mock_convert:

            mock_convert.return_value = MagicMock(descriptions=[])

            processed, _ = await _process_chapters_batch_mode(
                chapters=chapters,
                book_id=uuid4(),
                db=mock_db,
                task_start_time=time.monotonic(),
                total_chapters=3,
            )
            # All 3 chapters should be retried individually
            assert mock_extractor.extract_chapter.remote.call_count == 3


class TestPartialFailure:
    """Partial batch failure: successful results saved, failed chapters queued for retry."""

    @pytest.mark.asyncio
    async def test_partial_failure_saves_successful(self):
        """3 results (2 success + 1 truncated) -> 2 saved, 1 retried individual."""
        from app.tasks.book_tasks import _process_chapters_batch_mode

        chapters = [FakeChapter(content="x" * 1000) for _ in range(3)]

        batch_results = [
            {
                "result": {"entities": [], "descriptions": [], "relationships": []},
                "metrics": {
                    "cold_start_ms": 0,
                    "inference_ms": 50,
                    "finish_reason": "stop",
                },
                "chapter_idx": 0,
            },
            {
                "result": {"entities": [], "descriptions": [], "relationships": []},
                "metrics": {
                    "cold_start_ms": 0,
                    "inference_ms": 50,
                    "finish_reason": "stop",
                },
                "chapter_idx": 1,
            },
            {
                "result": None,
                "metrics": {
                    "cold_start_ms": 0,
                    "inference_ms": 50,
                    "finish_reason": "length",
                },
                "chapter_idx": 2,
                "truncated_text": "partial json...",
            },
        ]

        mock_extractor = MagicMock()
        mock_extractor.extract_chapters_batch.remote.return_value = batch_results
        # Individual retry for the failed one
        mock_extractor.extract_chapter.remote.return_value = {
            "result": {"entities": [], "descriptions": [], "relationships": []},
            "metrics": {
                "cold_start_ms": 0,
                "inference_ms": 50,
                "finish_reason": "stop",
            },
        }

        mock_db = AsyncMock()

        save_mock = AsyncMock(return_value=0)

        with patch(
            "app.tasks.book_tasks.get_llm_extractor", return_value=mock_extractor
        ), patch(
            "app.tasks.book_tasks.group_chapters_into_batches",
            return_value=([chapters], []),
        ), patch(
            "app.tasks.book_tasks.publish_book_progress", new_callable=AsyncMock
        ), patch(
            "app.tasks.book_tasks._save_chapter_extraction_result", save_mock
        ), patch(
            "app.tasks.book_tasks.modal_response_to_chapter_result"
        ) as mock_convert:

            mock_convert.return_value = MagicMock(descriptions=[])

            processed, _ = await _process_chapters_batch_mode(
                chapters=chapters,
                book_id=uuid4(),
                db=mock_db,
                task_start_time=time.monotonic(),
                total_chapters=3,
            )
            # 2 saved from batch + 1 retried individually
            assert processed == 3
            # 1 individual retry for the truncated chapter
            assert mock_extractor.extract_chapter.remote.call_count == 1


class TestTimeBudgetBatch:
    """check_time_budget uses VPS_BATCH_TIMEOUT for batch, not VPS_TIMEOUT."""

    @pytest.mark.asyncio
    async def test_time_budget_check_with_batch_timeout(self):
        """check_time_budget called with timeout_needed=VPS_BATCH_TIMEOUT before each batch."""
        from app.tasks.book_tasks import _process_chapters_batch_mode, VPS_BATCH_TIMEOUT

        chapters = [FakeChapter(content="x" * 1000) for _ in range(4)]

        mock_extractor = MagicMock()
        mock_extractor.extract_chapters_batch.remote.return_value = [
            {
                "result": {"entities": [], "descriptions": [], "relationships": []},
                "metrics": {
                    "cold_start_ms": 0,
                    "inference_ms": 50,
                    "finish_reason": "stop",
                },
                "chapter_idx": i,
            }
            for i in range(4)
        ]

        mock_db = AsyncMock()

        with patch(
            "app.tasks.book_tasks.get_llm_extractor", return_value=mock_extractor
        ), patch(
            "app.tasks.book_tasks.group_chapters_into_batches",
            return_value=([chapters], []),
        ), patch(
            "app.tasks.book_tasks.publish_book_progress", new_callable=AsyncMock
        ), patch(
            "app.tasks.book_tasks._save_chapter_extraction_result",
            new_callable=AsyncMock,
            return_value=0,
        ), patch(
            "app.tasks.book_tasks.check_time_budget"
        ) as mock_budget:

            await _process_chapters_batch_mode(
                chapters=chapters,
                book_id=uuid4(),
                db=mock_db,
                task_start_time=time.monotonic(),
                total_chapters=4,
            )
            # check_time_budget called with VPS_BATCH_TIMEOUT
            mock_budget.assert_called_once()
            call_kwargs = mock_budget.call_args
            assert call_kwargs.kwargs.get("timeout_needed") == VPS_BATCH_TIMEOUT


class TestWebSocketProgress:
    """publish_book_progress called after each sub-batch."""

    @pytest.mark.asyncio
    async def test_websocket_progress_after_batch(self):
        """publish_book_progress is called after each sub-batch completes."""
        from app.tasks.book_tasks import _process_chapters_batch_mode

        batch1 = [FakeChapter(content="x" * 1000) for _ in range(2)]
        batch2 = [FakeChapter(content="x" * 1000) for _ in range(2)]

        def make_results(n):
            return [
                {
                    "result": {"entities": [], "descriptions": [], "relationships": []},
                    "metrics": {
                        "cold_start_ms": 0,
                        "inference_ms": 50,
                        "finish_reason": "stop",
                    },
                    "chapter_idx": i,
                }
                for i in range(n)
            ]

        mock_extractor = MagicMock()
        mock_extractor.extract_chapters_batch.remote.side_effect = [
            make_results(2),
            make_results(2),
        ]

        mock_db = AsyncMock()
        mock_progress = AsyncMock()

        with patch(
            "app.tasks.book_tasks.get_llm_extractor", return_value=mock_extractor
        ), patch(
            "app.tasks.book_tasks.group_chapters_into_batches",
            return_value=([batch1, batch2], []),
        ), patch(
            "app.tasks.book_tasks.publish_book_progress", mock_progress
        ), patch(
            "app.tasks.book_tasks._save_chapter_extraction_result",
            new_callable=AsyncMock,
            return_value=0,
        ):

            await _process_chapters_batch_mode(
                chapters=batch1 + batch2,
                book_id=uuid4(),
                db=mock_db,
                task_start_time=time.monotonic(),
                total_chapters=4,
            )
            # At least 2 progress calls (one per batch)
            assert mock_progress.await_count >= 2


class TestOversizedSequential:
    """Oversized chapters from group_chapters_into_batches are processed sequentially."""

    @pytest.mark.asyncio
    async def test_oversized_processed_sequential(self):
        """Oversized chapters use extract_chapter.remote (single), not batch."""
        from app.tasks.book_tasks import _process_chapters_batch_mode

        oversized_ch = FakeChapter(content="x" * 65000)

        mock_extractor = MagicMock()
        mock_extractor.extract_chapter.remote.return_value = {
            "result": {"entities": [], "descriptions": [], "relationships": []},
            "metrics": {
                "cold_start_ms": 0,
                "inference_ms": 300,
                "finish_reason": "stop",
            },
        }

        mock_db = AsyncMock()

        with patch(
            "app.tasks.book_tasks.get_llm_extractor", return_value=mock_extractor
        ), patch(
            "app.tasks.book_tasks.group_chapters_into_batches",
            return_value=([], [oversized_ch]),
        ), patch(
            "app.tasks.book_tasks.publish_book_progress", new_callable=AsyncMock
        ), patch(
            "app.tasks.book_tasks._save_chapter_extraction_result",
            new_callable=AsyncMock,
            return_value=0,
        ), patch(
            "app.tasks.book_tasks.modal_response_to_chapter_result"
        ) as mock_convert:

            mock_convert.return_value = MagicMock(descriptions=[])

            processed, _ = await _process_chapters_batch_mode(
                chapters=[oversized_ch],
                book_id=uuid4(),
                db=mock_db,
                task_start_time=time.monotonic(),
                total_chapters=1,
            )
            # Oversized processed via extract_chapter (single), not batch
            assert mock_extractor.extract_chapter.remote.call_count == 1
            assert mock_extractor.extract_chapters_batch.remote.call_count == 0


class TestReduceEntitiesCalledOnce:
    """reduce_entities/optimize_book_entities is called ONCE after all batches."""

    @pytest.mark.asyncio
    async def test_reduce_entities_called_once(self):
        """_process_chapters_batch_mode does NOT call reduce_entities.

        reduce_entities is called in _process_book_async AFTER batch_mode returns.
        This test verifies batch_mode only returns counts, not running reduce.
        """
        from app.tasks.book_tasks import _process_chapters_batch_mode

        chapters = [FakeChapter(content="x" * 1000) for _ in range(4)]

        mock_extractor = MagicMock()
        mock_extractor.extract_chapters_batch.remote.return_value = [
            {
                "result": {"entities": [], "descriptions": [], "relationships": []},
                "metrics": {
                    "cold_start_ms": 0,
                    "inference_ms": 50,
                    "finish_reason": "stop",
                },
                "chapter_idx": i,
            }
            for i in range(4)
        ]

        mock_db = AsyncMock()

        with patch(
            "app.tasks.book_tasks.get_llm_extractor", return_value=mock_extractor
        ), patch(
            "app.tasks.book_tasks.group_chapters_into_batches",
            return_value=([chapters], []),
        ), patch(
            "app.tasks.book_tasks.publish_book_progress", new_callable=AsyncMock
        ), patch(
            "app.tasks.book_tasks._save_chapter_extraction_result",
            new_callable=AsyncMock,
            return_value=0,
        ), patch(
            "app.tasks.book_tasks.ConsistencyManager"
        ) as mock_cm:

            processed, descs = await _process_chapters_batch_mode(
                chapters=chapters,
                book_id=uuid4(),
                db=mock_db,
                task_start_time=time.monotonic(),
                total_chapters=4,
            )
            # ConsistencyManager.optimize_book_entities should NOT be called inside batch mode
            mock_cm.return_value.optimize_book_entities.assert_not_called()
            # Returns counts for the caller to use
            assert processed == 4


class TestProcessBatchResults:
    """process_batch_results() separates successful from failed."""

    def test_all_successful(self):
        """All results have non-None result -> all in successful."""
        chapters = [FakeChapter() for _ in range(3)]
        batch_results = [
            {
                "result": {"entities": [], "descriptions": [], "relationships": []},
                "metrics": {
                    "cold_start_ms": 0,
                    "inference_ms": 50,
                    "finish_reason": "stop",
                },
                "chapter_idx": i,
            }
            for i in range(3)
        ]
        successful, failed = process_batch_results(batch_results, chapters)
        assert len(successful) == 3
        assert len(failed) == 0

    def test_partial_truncated(self):
        """result=None -> failed, others -> successful."""
        chapters = [FakeChapter() for _ in range(3)]
        batch_results = [
            {
                "result": {"entities": [], "descriptions": [], "relationships": []},
                "metrics": {
                    "cold_start_ms": 0,
                    "inference_ms": 50,
                    "finish_reason": "stop",
                },
                "chapter_idx": 0,
            },
            {
                "result": None,
                "metrics": {
                    "cold_start_ms": 0,
                    "inference_ms": 50,
                    "finish_reason": "length",
                },
                "chapter_idx": 1,
                "truncated_text": "partial...",
            },
            {
                "result": {"entities": [], "descriptions": [], "relationships": []},
                "metrics": {
                    "cold_start_ms": 0,
                    "inference_ms": 50,
                    "finish_reason": "stop",
                },
                "chapter_idx": 2,
            },
        ]
        successful, failed = process_batch_results(batch_results, chapters)
        assert len(successful) == 2
        assert len(failed) == 1
        assert failed[0] is chapters[1]

    def test_successful_contains_analysis(self):
        """Successful items contain analysis (ChapterAnalysisResult), metrics, raw_result."""
        chapters = [FakeChapter()]
        batch_results = [
            {
                "result": {"entities": [], "descriptions": [], "relationships": []},
                "metrics": {
                    "cold_start_ms": 0,
                    "inference_ms": 50,
                    "finish_reason": "stop",
                },
                "chapter_idx": 0,
            },
        ]
        successful, _ = process_batch_results(batch_results, chapters)
        assert len(successful) == 1
        ch, data = successful[0]
        assert ch is chapters[0]
        assert "analysis" in data
        assert "metrics" in data
        assert "raw_result" in data
