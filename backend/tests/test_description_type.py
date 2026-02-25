"""
Tests for DescriptionType StrEnum.

Verifies:
1. StrEnum properties (lowercase string values)
2. _missing_() classmethod for case-insensitive backward compat
3. All expected members exist
4. Value-based lookup

Run with: pytest tests/test_description_type.py -v --no-cov
"""

import pytest
from app.models.description import DescriptionType


class TestDescriptionTypeEnum:
    """Tests for DescriptionType StrEnum."""

    def test_is_str_enum(self) -> None:
        """DescriptionType members are strings (StrEnum)."""
        for member in DescriptionType:
            assert isinstance(member, str)
            assert isinstance(member.value, str)

    def test_all_values_lowercase(self) -> None:
        """All enum values must be lowercase."""
        for member in DescriptionType:
            assert member.value == member.value.lower(), (
                f"{member.name} has non-lowercase value: {member.value!r}"
            )

    def test_expected_members(self) -> None:
        """All 5 expected members exist."""
        expected = {"LOCATION", "CHARACTER", "ATMOSPHERE", "OBJECT", "ACTION"}
        actual = {m.name for m in DescriptionType}
        assert actual == expected

    def test_expected_values(self) -> None:
        """Values match expected lowercase strings."""
        assert DescriptionType.LOCATION.value == "location"
        assert DescriptionType.CHARACTER.value == "character"
        assert DescriptionType.ATMOSPHERE.value == "atmosphere"
        assert DescriptionType.OBJECT.value == "object"
        assert DescriptionType.ACTION.value == "action"

    def test_str_value_equals_member(self) -> None:
        """StrEnum member == its string value."""
        assert DescriptionType.LOCATION == "location"
        assert DescriptionType.CHARACTER == "character"
        assert DescriptionType.ATMOSPHERE == "atmosphere"
        assert DescriptionType.OBJECT == "object"
        assert DescriptionType.ACTION == "action"

    def test_lookup_by_lowercase_value(self) -> None:
        """Lookup by lowercase string value works."""
        assert DescriptionType("location") is DescriptionType.LOCATION
        assert DescriptionType("character") is DescriptionType.CHARACTER
        assert DescriptionType("atmosphere") is DescriptionType.ATMOSPHERE
        assert DescriptionType("object") is DescriptionType.OBJECT
        assert DescriptionType("action") is DescriptionType.ACTION


class TestDescriptionTypeMissing:
    """Tests for _missing_() case-insensitive backward compatibility."""

    def test_uppercase_lookup(self) -> None:
        """UPPERCASE strings resolve via _missing_()."""
        assert DescriptionType("LOCATION") is DescriptionType.LOCATION
        assert DescriptionType("CHARACTER") is DescriptionType.CHARACTER
        assert DescriptionType("ATMOSPHERE") is DescriptionType.ATMOSPHERE
        assert DescriptionType("OBJECT") is DescriptionType.OBJECT
        assert DescriptionType("ACTION") is DescriptionType.ACTION

    def test_mixed_case_lookup(self) -> None:
        """Mixed case strings resolve via _missing_()."""
        assert DescriptionType("Location") is DescriptionType.LOCATION
        assert DescriptionType("ChArAcTeR") is DescriptionType.CHARACTER

    def test_invalid_value_raises(self) -> None:
        """Invalid string raises ValueError."""
        with pytest.raises(ValueError):
            DescriptionType("nonexistent")

    def test_non_string_raises(self) -> None:
        """Non-string input raises ValueError."""
        with pytest.raises(ValueError):
            DescriptionType(42)  # type: ignore[arg-type]
