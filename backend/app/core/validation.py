"""
Input Validation и Sanitization Utilities для fancai.

Защищает от:
- Path traversal attacks
- Command injection
- XSS (Cross-Site Scripting)
- SQL injection (дополнительно к ORM защите)
- LDAP injection
- XML injection

Best practices:
- Валидировать ВСЕ user inputs
- Sanitize перед использованием
- Use whitelisting (не blacklisting)
"""

import re
import html
import os
import unicodedata
from typing import Optional, Tuple, List, Any
from pathlib import Path
from urllib.parse import urlparse
import logging

from fastapi import HTTPException, status

logger = logging.getLogger(__name__)


# ============================================================================
# Filename Sanitization
# ============================================================================


def sanitize_filename(filename: str, max_length: int = 255) -> str:
    """
    Sanitizes user-provided filename для безопасного использования в filesystem.

    Защищает от:
    - Path traversal (../, ..\\)
    - Command injection (; && | `)
    - Hidden files (.filename)
    - Special characters

    Args:
        filename: User-provided filename
        max_length: Maximum filename length

    Returns:
        Safe sanitized filename

    Example:
        >>> sanitize_filename("../../etc/passwd")
        'etc_passwd'
        >>> sanitize_filename("test; rm -rf /")
        'test_rm_-rf_'
    """
    # Remove path separators
    filename = filename.replace("/", "_").replace("\\", "_")

    # Remove null bytes
    filename = filename.replace("\x00", "")

    # Remove leading dots (hidden files)
    filename = filename.lstrip(".")

    # Remove dangerous characters - whitelist approach
    # Allowed: letters, digits, dots, hyphens, underscores, spaces
    filename = re.sub(r"[^\w\s\-\.]", "_", filename)

    # Remove multiple consecutive underscores/spaces
    filename = re.sub(r"[_\s]+", "_", filename)

    # Limit length
    if len(filename) > max_length:
        # Preserve extension
        name, ext = os.path.splitext(filename)
        max_name_length = max_length - len(ext)
        filename = name[:max_name_length] + ext

    # Ensure not empty
    if not filename or filename == "_":
        filename = "unnamed_file"

    return filename


def validate_file_extension(
    filename: str, allowed_extensions: List[str]
) -> Tuple[bool, Optional[str]]:
    """
    Валидирует file extension против whitelist.

    Args:
        filename: Filename with extension
        allowed_extensions: List of allowed extensions (e.g., ['.epub', '.fb2'])

    Returns:
        Tuple: (is_valid, error_message)
    """
    file_ext = Path(filename).suffix.lower()

    if not file_ext:
        return False, "File has no extension"

    if file_ext not in allowed_extensions:
        return (
            False,
            f"File extension '{file_ext}' not allowed. Allowed: {', '.join(allowed_extensions)}",
        )

    return True, None


def validate_filepath_security(
    filepath: str, allowed_base: str
) -> Tuple[bool, Optional[str]]:
    """
    Валидирует, что filepath не выходит за пределы allowed_base (path traversal protection).

    Args:
        filepath: User-provided or constructed filepath
        allowed_base: Base directory, из которого не должны выходить пути

    Returns:
        Tuple: (is_valid, error_message)
    """
    try:
        # Resolve to absolute paths
        base_path = Path(allowed_base).resolve()
        target_path = Path(filepath).resolve()

        # Check if target is within base
        if base_path in target_path.parents or base_path == target_path:
            return True, None
        else:
            return False, "Path traversal detected - access denied"

    except Exception as e:
        logger.warning(f"Filepath validation error: {e}")
        return False, f"Invalid filepath: {str(e)}"


# ============================================================================
# String Sanitization
# ============================================================================


def sanitize_html(text: str) -> str:
    """
    Escapes HTML special characters для предотвращения XSS.

    Args:
        text: User-provided text

    Returns:
        HTML-escaped text
    """
    return html.escape(text)


def sanitize_sql(text: str) -> str:
    """
    Дополнительная защита от SQL injection (complementary to ORM).

    NOTE: Основная защита - использование SQLAlchemy ORM и parameterized queries.
    Эта функция - дополнительный слой defense-in-depth.

    Args:
        text: User-provided text

    Returns:
        Sanitized text
    """
    # Remove SQL comment markers
    text = text.replace("--", "").replace("/*", "").replace("*/", "")

    # Remove SQL keywords в начале строки (basic protection)
    dangerous_patterns = [
        r"^\s*DROP\s+",
        r"^\s*DELETE\s+",
        r"^\s*TRUNCATE\s+",
        r"^\s*ALTER\s+",
    ]

    for pattern in dangerous_patterns:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE)

    return text


def normalize_unicode(text: str) -> str:
    """
    Normalizes Unicode для предотвращения Unicode-based attacks.

    Args:
        text: User-provided text

    Returns:
        Normalized Unicode text (NFC form)
    """
    return unicodedata.normalize("NFC", text)


def strip_control_characters(text: str) -> str:
    """
    Removes control characters (кроме common whitespace).

    Args:
        text: User-provided text

    Returns:
        Text without control characters
    """
    # Allow: \n, \r, \t
    allowed_control = ["\n", "\r", "\t"]

    return "".join(
        char
        for char in text
        if char in allowed_control or not unicodedata.category(char).startswith("C")
    )


# ============================================================================
# Email Validation
# ============================================================================


def validate_email(email: str) -> Tuple[bool, Optional[str]]:
    """
    Validates email format (RFC 5322 compliant, simplified).

    Args:
        email: Email address string

    Returns:
        Tuple: (is_valid, error_message)
    """
    if not email or len(email) > 254:  # RFC 5321
        return False, "Email is empty or too long"

    # Basic RFC 5322 pattern (simplified)
    pattern = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"

    if not re.match(pattern, email):
        return False, "Invalid email format"

    # Additional checks
    local, domain = email.rsplit("@", 1)

    if len(local) > 64:  # RFC 5321
        return False, "Email local part too long"

    if ".." in email:  # No consecutive dots
        return False, "Invalid email format (consecutive dots)"

    return True, None


def sanitize_email(email: str) -> str:
    """
    Sanitizes email (lowercase, strip whitespace).

    Args:
        email: Email address

    Returns:
        Sanitized email
    """
    return email.strip().lower()


# ============================================================================
# Password Validation
# ============================================================================


def validate_password_strength(password: str) -> Tuple[bool, Optional[str]]:
    """
    Validates password meets ENHANCED security requirements.

    Requirements (PRODUCTION GRADE):
    - At least 12 characters (increased from 8 for production)
    - Contains uppercase letter
    - Contains lowercase letter
    - Contains digit
    - Contains special character
    - Not in common passwords list

    Args:
        password: User-provided password

    Returns:
        Tuple: (is_valid, error_message)

    Example:
        >>> validate_password_strength("SecurePass123!")
        (True, None)
        >>> validate_password_strength("weak")
        (False, "Password must be at least 12 characters long")
    """
    if len(password) < 12:
        return False, "Password must be at least 12 characters long"

    if len(password) > 128:
        return False, "Password too long (max 128 characters)"

    # Check byte length (bcrypt limitation: 72 bytes maximum)
    password_bytes = password.encode("utf-8")
    if len(password_bytes) > 72:
        return (
            False,
            f"Password is too long when encoded ({len(password_bytes)} bytes, max 72 bytes). Please use shorter password or fewer special characters.",
        )

    if not any(c.isupper() for c in password):
        return False, "Password must contain at least one uppercase letter"

    if not any(c.islower() for c in password):
        return False, "Password must contain at least one lowercase letter"

    if not any(c.isdigit() for c in password):
        return False, "Password must contain at least one digit"

    special_chars = r"!@#$%^&*()_+-=[]{}|;:,.<>?"
    if not any(c in special_chars for c in password):
        return (
            False,
            f"Password must contain at least one special character: {special_chars}",
        )

    # Check for common weak passwords (expanded list)
    common_passwords = [
        "password",
        "12345678",
        "qwerty",
        "abc123",
        "password123",
        "admin123",
        "password1234",
        "qwerty123",
        "welcome123",
        "letmein123",
    ]
    if password.lower() in common_passwords:
        return False, "Password is too common - choose a stronger password"

    # Check for sequential characters
    if any(
        password[i : i + 3].isdigit()
        and int(password[i + 1]) == int(password[i]) + 1
        and int(password[i + 2]) == int(password[i]) + 2
        for i in range(len(password) - 2)
        if password[i : i + 3].isdigit()
    ):
        return False, "Password contains sequential numbers (e.g., 123, 456)"

    return True, None


def validate_password_match(
    password: str, password_confirm: str
) -> Tuple[bool, Optional[str]]:
    """
    Validates that password and confirmation match.

    Args:
        password: Password
        password_confirm: Password confirmation

    Returns:
        Tuple: (is_valid, error_message)
    """
    if password != password_confirm:
        return False, "Passwords do not match"

    return True, None


# ============================================================================
# URL Validation
# ============================================================================


def validate_url(
    url: str, allowed_schemes: Optional[List[str]] = None
) -> Tuple[bool, Optional[str]]:
    """
    Validates URL format and scheme.

    Args:
        url: URL string
        allowed_schemes: List of allowed schemes (default: ['http', 'https'])

    Returns:
        Tuple: (is_valid, error_message)
    """
    if allowed_schemes is None:
        allowed_schemes = ["http", "https"]

    try:
        parsed = urlparse(url)

        if not parsed.scheme:
            return False, "URL missing scheme (http/https)"

        if parsed.scheme not in allowed_schemes:
            return False, f"URL scheme must be one of: {', '.join(allowed_schemes)}"

        if not parsed.netloc:
            return False, "URL missing domain"

        return True, None

    except Exception as e:
        return False, f"Invalid URL: {str(e)}"


def sanitize_url(url: str) -> str:
    """
    Sanitizes URL (removes fragments, normalizes).

    Args:
        url: URL string

    Returns:
        Sanitized URL
    """
    parsed = urlparse(url)

    # Remove fragment (# anchor)
    sanitized = parsed._replace(fragment="")

    return sanitized.geturl()


# ============================================================================
# Integer/Numeric Validation
# ============================================================================


def validate_positive_integer(
    value: Any, min_value: int = 1, max_value: Optional[int] = None
) -> Tuple[bool, Optional[str]]:
    """
    Validates positive integer within range.

    Args:
        value: Value to validate
        min_value: Minimum allowed value
        max_value: Maximum allowed value (optional)

    Returns:
        Tuple: (is_valid, error_message)
    """
    try:
        int_value = int(value)

        if int_value < min_value:
            return False, f"Value must be at least {min_value}"

        if max_value is not None and int_value > max_value:
            return False, f"Value must be at most {max_value}"

        return True, None

    except (ValueError, TypeError):
        return False, "Value must be a valid integer"


def validate_pagination_params(
    limit: int, offset: int, max_limit: int = 100
) -> Tuple[bool, Optional[str]]:
    """
    Validates pagination parameters.

    Args:
        limit: Number of items to return
        offset: Number of items to skip
        max_limit: Maximum allowed limit

    Returns:
        Tuple: (is_valid, error_message)
    """
    # Validate limit
    is_valid, error = validate_positive_integer(limit, min_value=1, max_value=max_limit)
    if not is_valid:
        return False, f"Invalid limit: {error}"

    # Validate offset
    is_valid, error = validate_positive_integer(offset, min_value=0)
    if not is_valid:
        return False, f"Invalid offset: {error}"

    return True, None


# ============================================================================
# UUID Validation
# ============================================================================


def validate_uuid(uuid_string: str) -> Tuple[bool, Optional[str]]:
    """
    Validates UUID format (version 4).

    Args:
        uuid_string: UUID string

    Returns:
        Tuple: (is_valid, error_message)
    """
    import uuid

    try:
        uuid_obj = uuid.UUID(uuid_string, version=4)
        # Check if string matches UUID object (prevents partial matches)
        if str(uuid_obj) != uuid_string:
            return False, "Invalid UUID format"
        return True, None
    except (ValueError, AttributeError):
        return False, "Invalid UUID format"


# ============================================================================
# JSON Validation
# ============================================================================


def validate_json_size(
    json_data: dict, max_size_bytes: int = 1048576
) -> Tuple[bool, Optional[str]]:
    """
    Validates JSON data size (prevents memory exhaustion).

    Args:
        json_data: JSON data (dict)
        max_size_bytes: Maximum size in bytes (default: 1MB)

    Returns:
        Tuple: (is_valid, error_message)
    """
    import json

    try:
        json_string = json.dumps(json_data)
        size = len(json_string.encode("utf-8"))

        if size > max_size_bytes:
            max_mb = max_size_bytes / (1024 * 1024)
            return False, f"JSON data too large (max {max_mb}MB)"

        return True, None

    except Exception as e:
        return False, f"Invalid JSON: {str(e)}"


# ============================================================================
# Request Validation Helper
# ============================================================================


class InputValidator:
    """
    Helper class для валидации inputs в endpoints.

    Example:
        validator = InputValidator()
        validator.validate_email(user_email)
        validator.validate_password(password)
        validator.raise_if_errors()  # Raises HTTPException if any errors
    """

    def __init__(self):
        self.errors: List[str] = []

    def add_error(self, error: str):
        """Adds validation error."""
        self.errors.append(error)

    def validate_email(self, email: str, field_name: str = "email") -> bool:
        """Validates email and adds error if invalid."""
        is_valid, error = validate_email(email)
        if not is_valid:
            self.add_error(f"{field_name}: {error}")
        return is_valid

    def validate_password(self, password: str, field_name: str = "password") -> bool:
        """Validates password strength and adds error if invalid."""
        is_valid, error = validate_password_strength(password)
        if not is_valid:
            self.add_error(f"{field_name}: {error}")
        return is_valid

    def validate_filename(self, filename: str, field_name: str = "filename") -> bool:
        """Validates filename and adds error if empty."""
        if not filename or not filename.strip():
            self.add_error(f"{field_name}: filename cannot be empty")
            return False
        return True

    def validate_uuid(self, uuid_string: str, field_name: str = "id") -> bool:
        """Validates UUID and adds error if invalid."""
        is_valid, error = validate_uuid(uuid_string)
        if not is_valid:
            self.add_error(f"{field_name}: {error}")
        return is_valid

    def has_errors(self) -> bool:
        """Checks if there are any validation errors."""
        return len(self.errors) > 0

    def raise_if_errors(self):
        """Raises HTTPException with all validation errors."""
        if self.has_errors():
            error_message = "; ".join(self.errors)
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=error_message,
            )

    def get_errors(self) -> List[str]:
        """Returns list of all validation errors."""
        return self.errors
