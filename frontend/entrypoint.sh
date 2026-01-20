#!/bin/sh
set -e

# Generate .htpasswd if BASIC_AUTH_PASSWORD is set
if [ -n "$BASIC_AUTH_PASSWORD" ]; then
    echo "Generating .htpasswd for user 'admin'..."
    # Generate MD5 formatted password using openssl (compatible with nginx auth_basic)
    # Alpine's openssl usually supports -nomac (not relevant here) or just standard commands.
    # We use -1 for MD5 based crypt (standard for htpasswd)
    PASSWORD_HASH=$(openssl passwd -1 "$BASIC_AUTH_PASSWORD")
    echo "admin:$PASSWORD_HASH" > /etc/nginx/.htpasswd
    chmod 644 /etc/nginx/.htpasswd
    echo "✓ .htpasswd generated successfully."
else
    echo "WARNING: BASIC_AUTH_PASSWORD is not set. Basic Auth might fail or be insecure."
    # Create empty file to prevent nginx error if file is missing (though auth will fail/deny)
    touch /etc/nginx/.htpasswd
fi

# Execute the CMD passed to docker run (usually nginx)
exec "$@"
