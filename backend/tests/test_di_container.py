"""
Tests for Dependency Injection Container.

These tests verify:
1. Container correctly creates service instances
2. Dependency overrides work for testing
3. LRU cache provides singleton behavior
4. Cleanup functions work correctly

Run with: pytest tests/test_di_container.py -v
"""

from unittest.mock import MagicMock, AsyncMock

from app.main import app
from app.core.container import (
    DependencyContainer,
    get_book_parser,
    get_auth_service,
    get_book_parser_dep,
    get_auth_service_dep,
    get_book_service_dep,
    get_image_generator_service_dep,
)


class TestDependencyContainer:
    """Tests for DependencyContainer class."""

    def setup_method(self):
        """Clean up before each test."""
        DependencyContainer.reset_all()
        DependencyContainer.clear_caches()
        app.dependency_overrides.clear()

    def teardown_method(self):
        """Clean up after each test."""
        DependencyContainer.reset_all()
        DependencyContainer.clear_caches()
        app.dependency_overrides.clear()

    def test_override_and_get(self):
        """Test that overrides work correctly."""
        # Create mock
        mock_parser = MagicMock()
        mock_parser.parse_book = AsyncMock(return_value={"title": "Mock Book"})

        # Override
        DependencyContainer.override(get_book_parser, mock_parser)

        # Get should return the mock
        result = DependencyContainer.get(get_book_parser)
        assert result is mock_parser

    def test_override_with_callable(self):
        """Test that callable overrides are called."""
        mock_parser = MagicMock()

        # Override with callable
        DependencyContainer.override(get_book_parser, lambda: mock_parser)

        # Get should call the lambda and return result
        result = DependencyContainer.get(get_book_parser)
        assert result is mock_parser

    def test_reset_specific_override(self):
        """Test resetting a specific override."""
        mock = MagicMock()
        DependencyContainer.override(get_book_parser, mock)

        # Verify override is set
        assert DependencyContainer.get(get_book_parser) is mock

        # Reset
        DependencyContainer.reset(get_book_parser)

        # Now it should return the real service (clear cache to force recreation)
        DependencyContainer.clear_caches()
        result = DependencyContainer.get(get_book_parser)
        assert result is not mock

    def test_reset_all_overrides(self):
        """Test resetting all overrides at once."""
        mock1 = MagicMock()
        mock2 = MagicMock()

        DependencyContainer.override(get_book_parser, mock1)
        DependencyContainer.override(get_auth_service, mock2)

        # Verify overrides
        assert DependencyContainer.get(get_book_parser) is mock1
        assert DependencyContainer.get(get_auth_service) is mock2

        # Reset all
        DependencyContainer.reset_all()
        DependencyContainer.clear_caches()

        # Now they should return real services
        assert DependencyContainer.get(get_book_parser) is not mock1
        assert DependencyContainer.get(get_auth_service) is not mock2


class TestFastAPIIntegration:
    """Tests for FastAPI dependency_overrides integration."""

    def setup_method(self):
        """Clean up before each test."""
        app.dependency_overrides.clear()

    def teardown_method(self):
        """Clean up after each test."""
        app.dependency_overrides.clear()

    def test_fastapi_dependency_override(self):
        """Test that FastAPI dependency overrides work."""
        mock_parser = MagicMock()
        mock_parser.parse_book = AsyncMock(return_value={"title": "Test"})

        # Set override via FastAPI mechanism
        app.dependency_overrides[get_book_parser_dep] = lambda: mock_parser

        # Verify it's set
        assert get_book_parser_dep in app.dependency_overrides

        # Get the override
        result = app.dependency_overrides[get_book_parser_dep]()
        assert result is mock_parser

    def test_multiple_overrides(self):
        """Test multiple simultaneous overrides."""
        mock_parser = MagicMock()
        mock_auth = MagicMock()
        mock_book_svc = MagicMock()

        app.dependency_overrides[get_book_parser_dep] = lambda: mock_parser
        app.dependency_overrides[get_auth_service_dep] = lambda: mock_auth
        app.dependency_overrides[get_book_service_dep] = lambda: mock_book_svc

        assert len(app.dependency_overrides) == 3
        assert app.dependency_overrides[get_book_parser_dep]() is mock_parser
        assert app.dependency_overrides[get_auth_service_dep]() is mock_auth
        assert app.dependency_overrides[get_book_service_dep]() is mock_book_svc


class TestLRUCacheBehavior:
    """Tests for LRU cache singleton behavior."""

    def setup_method(self):
        """Clean up before each test."""
        DependencyContainer.clear_caches()

    def teardown_method(self):
        """Clean up after each test."""
        DependencyContainer.clear_caches()

    def test_singleton_behavior(self):
        """Test that factory functions return same instance."""
        parser1 = get_book_parser()
        parser2 = get_book_parser()

        # Should be exact same instance
        assert parser1 is parser2

    def test_cache_clear_creates_new_instance(self):
        """Test that clearing cache creates new instance."""
        parser1 = get_book_parser()
        DependencyContainer.clear_caches()
        parser2 = get_book_parser()

        # Should be different instances
        assert parser1 is not parser2


class TestProtocols:
    """Tests for Protocol/Interface compliance."""

    def test_book_parser_has_required_methods(self):
        """Test that BookParser has methods defined in IBookParser."""
        from app.services.book_parser import BookParser

        parser = BookParser()

        # Check required methods exist
        assert hasattr(parser, "parse_book")
        assert hasattr(parser, "detect_format")
        assert callable(parser.parse_book)
        assert callable(parser.detect_format)

    def test_auth_service_has_required_methods(self):
        """Test that AuthService has methods defined in IAuthService."""
        from app.services.auth_service import AuthService

        auth = AuthService()

        # Check required methods exist
        assert hasattr(auth, "verify_password")
        assert hasattr(auth, "get_password_hash")
        assert hasattr(auth, "create_access_token")
        assert hasattr(auth, "create_refresh_token")
        assert hasattr(auth, "verify_token")


# Example integration test using DI mocks
class TestExampleDIUsage:
    """Example tests showing DI usage patterns."""

    def setup_method(self):
        """Clean up before each test."""
        app.dependency_overrides.clear()
        DependencyContainer.reset_all()
        DependencyContainer.clear_caches()

    def teardown_method(self):
        """Clean up after each test."""
        app.dependency_overrides.clear()
        DependencyContainer.reset_all()
        DependencyContainer.clear_caches()

    def test_mock_image_generator_in_route(self):
        """
        Example: Mock ImageGeneratorService for testing image generation endpoint.

        This pattern can be used in actual integration tests.
        """
        # Create mock
        mock_gen = MagicMock()
        mock_gen.get_generation_stats = AsyncMock(
            return_value={
                "queue_size": 5,
                "is_processing": True,
                "supported_types": ["location", "character"],
                "api_status": "operational",
            }
        )

        # Set override
        app.dependency_overrides[get_image_generator_service_dep] = lambda: mock_gen

        # In a real test, you would call the endpoint via TestClient
        # and verify the mock was used
        result = app.dependency_overrides[get_image_generator_service_dep]()
        assert result is mock_gen

    def test_mock_book_parser_for_upload(self):
        """
        Example: Mock BookParser for testing upload without parsing real files.
        """
        from dataclasses import dataclass
        from typing import List, Optional

        @dataclass
        class MockMetadata:
            title: str = "Mocked Book"
            author: str = "Mock Author"
            genre: str = "fiction"
            language: str = "en"
            description: str = ""
            isbn: Optional[str] = None
            publisher: Optional[str] = None
            publish_date: Optional[str] = None
            cover_image_data: Optional[bytes] = None
            cover_image_type: Optional[str] = None

        @dataclass
        class MockParsedBook:
            metadata: MockMetadata = None
            chapters: List = None
            file_format: str = "epub"
            total_pages: int = 100
            estimated_reading_time: int = 50

            def __post_init__(self):
                if self.metadata is None:
                    self.metadata = MockMetadata()
                if self.chapters is None:
                    self.chapters = []

        mock_parser = MagicMock()
        mock_parser.parse_book = AsyncMock(return_value=MockParsedBook())

        app.dependency_overrides[get_book_parser_dep] = lambda: mock_parser

        # Verify override
        parser = app.dependency_overrides[get_book_parser_dep]()
        assert parser is mock_parser
