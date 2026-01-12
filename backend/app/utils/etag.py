"""
ETag utilities for HTTP caching support.

Provides functions for computing ETags and handling conditional requests
according to RFC 7232 (Conditional Requests).
"""

import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple


def compute_file_etag(file_path: Path) -> str:
    """
    Compute ETag based on file metadata.

    Uses file name, size, and modification time to generate a unique identifier.
    This is a weak ETag approach (based on metadata, not content) which is
    efficient for large files.

    Args:
        file_path: Path to the file

    Returns:
        ETag string in quotes (e.g., '"abc123def456"')

    Raises:
        FileNotFoundError: If file does not exist
    """
    stat = file_path.stat()
    content = f"{file_path.name}-{stat.st_size}-{stat.st_mtime}"
    hash_value = hashlib.md5(content.encode()).hexdigest()  # nosec B324 - not for security
    return f'"{hash_value}"'


def get_file_last_modified(file_path: Path) -> str:
    """
    Get file's last modified time in HTTP date format.

    Returns the modification time formatted according to RFC 7231
    (HTTP-date format: "Sun, 06 Nov 1994 08:49:37 GMT").

    Args:
        file_path: Path to the file

    Returns:
        HTTP date string for Last-Modified header

    Raises:
        FileNotFoundError: If file does not exist
    """
    stat = file_path.stat()
    mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
    return mtime.strftime("%a, %d %b %Y %H:%M:%S GMT")


def parse_http_date(date_string: str) -> Optional[datetime]:
    """
    Parse an HTTP date string to datetime.

    Supports RFC 7231 format: "Sun, 06 Nov 1994 08:49:37 GMT"

    Args:
        date_string: HTTP date string

    Returns:
        datetime object or None if parsing fails
    """
    try:
        return datetime.strptime(date_string, "%a, %d %b %Y %H:%M:%S GMT").replace(
            tzinfo=timezone.utc
        )
    except ValueError:
        return None


def get_mime_type_from_extension(file_path: Path) -> str:
    """
    Determine MIME type from file extension.

    Args:
        file_path: Path to the file

    Returns:
        MIME type string (defaults to "application/octet-stream")
    """
    extension = file_path.suffix.lower()
    mime_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".bmp": "image/bmp",
        ".ico": "image/x-icon",
    }
    return mime_types.get(extension, "application/octet-stream")


def check_conditional_request(
    file_path: Path,
    if_none_match: Optional[str],
    if_modified_since: Optional[str],
) -> Tuple[bool, str, str]:
    """
    Check if a conditional request should return 304 Not Modified.

    Implements conditional request handling per RFC 7232:
    1. If-None-Match takes precedence over If-Modified-Since
    2. ETag comparison uses strong comparison (exact match)

    Args:
        file_path: Path to the file
        if_none_match: Value of If-None-Match header (ETag)
        if_modified_since: Value of If-Modified-Since header

    Returns:
        Tuple of (should_return_304, etag, last_modified)
    """
    etag = compute_file_etag(file_path)
    last_modified = get_file_last_modified(file_path)

    # Check If-None-Match first (ETag comparison)
    if if_none_match:
        # Handle multiple ETags (comma-separated)
        client_etags = [e.strip() for e in if_none_match.split(",")]
        if etag in client_etags or "*" in client_etags:
            return True, etag, last_modified

    # Check If-Modified-Since (only if If-None-Match not present)
    if if_modified_since and not if_none_match:
        client_date = parse_http_date(if_modified_since)
        if client_date:
            stat = file_path.stat()
            file_mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
            # Compare with second precision (HTTP dates don't have subseconds)
            if file_mtime.replace(microsecond=0) <= client_date.replace(microsecond=0):
                return True, etag, last_modified

    return False, etag, last_modified
