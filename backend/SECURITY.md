# Security Implementation Guide

**fancai - Application Security Documentation**

This document describes the security features implemented in fancai and provides guidance for secure deployment and operations.

---

## Table of Contents

1. [Security Overview](#security-overview)
2. [Rate Limiting](#rate-limiting)
3. [Security Headers](#security-headers)
4. [Secrets Management](#secrets-management)
5. [Input Validation](#input-validation)
6. [CORS Configuration](#cors-configuration)
7. [Authentication & Authorization](#authentication--authorization)
8. [Security Best Practices](#security-best-practices)
9. [Security Checklist](#security-checklist)
10. [Incident Response](#incident-response)

---

## Security Overview

fancai implements multiple layers of security (defense-in-depth):

| Layer | Protection | Status |
|-------|------------|--------|
| Rate Limiting | DDoS, brute-force attacks | ✅ Active |
| Security Headers | XSS, clickjacking, MIME sniffing | ✅ Active |
| Secrets Validation | Credential leaks, weak secrets | ✅ Active |
| Input Validation | Injection attacks, XSS | ✅ Active |
| CORS | Unauthorized cross-origin requests | ✅ Active |
| JWT Auth | Unauthorized access | ✅ Active |
| HTTPS (Production) | Man-in-the-middle attacks | ⚠️ Required |

**Security Risk Assessment:**
- Development: Low risk (localhost only)
- Production: Medium risk → High security required

---

## Rate Limiting

### Overview

Rate limiting protects API from abuse using Redis-based distributed rate limiter with sliding window algorithm.

### Configuration

Different endpoints have different rate limits based on their purpose:

```python
RATE_LIMIT_PRESETS = {
    "auth": {
        "max_requests": 5,
        "window_seconds": 60
    },  # 5 requests/minute
    "high_frequency": {
        "max_requests": 60,
        "window_seconds": 60
    },  # 60/min
    "normal": {
        "max_requests": 30,
        "window_seconds": 60
    },  # 30/min
    "low_frequency": {
        "max_requests": 10,
        "window_seconds": 60
    },  # 10/min
}
```

### Rate Limit by Endpoint Type

| Endpoint Type | Limit | Reasoning |
|---------------|-------|-----------|
| `/auth/login`, `/auth/register` | 5/min | Prevent brute-force attacks |
| `/health`, `/` (public) | 20/min | Prevent abuse of public endpoints |
| `/api/v1/books` (GET) | 100/min | Normal CRUD operations |
| `/api/v1/books/{id}/process` | 10/min | Resource-intensive operations |
| `/api/v1/admin/*` | 1000/min | Admin operations (trusted users) |

### Usage in Endpoints

```python
from app.middleware.rate_limit import rate_limit, RATE_LIMIT_PRESETS

@router.post("/auth/login")
@rate_limit(**RATE_LIMIT_PRESETS["auth"])
async def login_user(
    request: Request,
    ...
):
    ...
```

### Response Headers

Rate-limited endpoints include headers:

```
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 3
X-RateLimit-Reset: 45
```

### 429 Too Many Requests Response

```json
{
  "detail": "Rate limit exceeded. Try again in 45 seconds."
}
```

### Bypass for Testing

**Development only:**

```bash
# Disable rate limiting (NOT FOR PRODUCTION!)
export RATE_LIMIT_DISABLED=true
```

### Graceful Degradation

If Redis is unavailable, rate limiter allows requests (logs warning).

---

## Security Headers

### Overview

Security headers protect against common web vulnerabilities:

- **XSS** (Cross-Site Scripting)
- **Clickjacking**
- **MIME sniffing**
- **Information disclosure**

### Implemented Headers

#### 1. Strict-Transport-Security (HSTS)

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

**Purpose:** Force HTTPS for all future requests (1 year)

**Requirements:**
- ✅ Development: Optional
- ⚠️ Production: **Required** (HTTPS must be configured)

#### 2. Content-Security-Policy (CSP)

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; ...
```

**Purpose:** Restrict resource loading to prevent XSS

**Current Policy:**
- `default-src 'self'` - Only load from same origin by default
- `script-src 'self' 'unsafe-inline' 'unsafe-eval'` - TODO: Remove unsafe-* after audit
- `img-src 'self' data: https:` - Allow images from pollinations.ai
- `connect-src 'self' https://pollinations.ai` - Allow API calls to image generation
- `frame-ancestors 'none'` - Prevent embedding in iframes

**⚠️ TODO:** Remove `'unsafe-inline'` and `'unsafe-eval'` after moving scripts to separate files.

#### 3. X-Frame-Options

```
X-Frame-Options: DENY
```

**Purpose:** Prevent clickjacking - site cannot be embedded in iframes

#### 4. X-Content-Type-Options

```
X-Content-Type-Options: nosniff
```

**Purpose:** Prevent MIME sniffing - browser respects Content-Type header

#### 5. X-XSS-Protection

```
X-XSS-Protection: 1; mode=block
```

**Purpose:** Enable browser's built-in XSS protection (legacy, but doesn't hurt)

#### 6. Referrer-Policy

```
Referrer-Policy: strict-origin-when-cross-origin
```

**Purpose:** Control referrer information leakage

#### 7. Permissions-Policy

```
Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=()
```

**Purpose:** Disable unnecessary browser features

### Validation

Test security headers:

```bash
curl -I http://localhost:8000/health
```

Expected output should include all security headers listed above.

---

## Secrets Management

### Overview

Secure management of sensitive credentials and API keys.

### Required Secrets

**CRITICAL** - Application will NOT start without these:

| Secret | Description | Min Length | Validation |
|--------|-------------|------------|------------|
| `SECRET_KEY` | JWT signing key | 32 chars | Strength check |
| `DATABASE_URL` | PostgreSQL connection | - | No test credentials |
| `REDIS_URL` | Redis connection | - | No test credentials |

### Recommended Secrets

For production deployment:

| Secret | Description | Required in Prod |
|--------|-------------|------------------|
| `SENTRY_DSN` | Error tracking | ✅ Yes |
| `SMTP_PASSWORD` | Email service | ⚠️ If email enabled |

### Optional Secrets

For extended functionality:

| Secret | Description | Purpose |
|--------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API | DALL-E image generation |
| `MIDJOURNEY_API_KEY` | Midjourney API | Alternative image generation |
| `YOOKASSA_SHOP_ID` | YooKassa | Payment processing |
| `YOOKASSA_SECRET_KEY` | YooKassa | Payment processing |

### Secret Strength Requirements

**SECRET_KEY must:**
- Be at least 32 characters
- Contain uppercase letters
- Contain lowercase letters
- Contain digits
- **Recommended:** Contain special characters

### Generate Strong Secret Key

```bash
# Generate cryptographically secure secret key
openssl rand -hex 32

# Output (example):
# 4a7d1ed414474e4033ac29ccb8653d9b1e7b7d1f1b7a5e3c9f8a6d4e2b1c3a5f
```

### Setting Secrets

#### Development (.env file)

```bash
# .env
SECRET_KEY=4a7d1ed414474e4033ac29ccb8653d9b1e7b7d1f1b7a5e3c9f8a6d4e2b1c3a5f
DATABASE_URL=postgresql+asyncpg://user:secure_password@postgres:5432/bookreader
REDIS_URL=redis://:secure_redis_password@redis:6379
```

**⚠️ NEVER commit .env to git!** (.env is in .gitignore)

#### Production (Environment Variables)

```bash
# Docker
docker run -e SECRET_KEY=... -e DATABASE_URL=... app

# Kubernetes
kubectl create secret generic bookreader-secrets \
  --from-literal=SECRET_KEY=... \
  --from-literal=DATABASE_URL=...

# Cloud (AWS, GCP, Azure)
# Use their secret management services:
# - AWS Secrets Manager
# - GCP Secret Manager
# - Azure Key Vault
```

### Startup Validation

On application start, secrets are validated:

```
🔐 SECRETS VALIDATION REPORT
======================================================================
✅ Status: PASSED
======================================================================
```

If validation fails:

```
❌ CRITICAL: Missing required secrets:
   - SECRET_KEY
   - DATABASE_URL

💡 Set missing secrets in .env or environment variables
💡 Generate strong SECRET_KEY with: openssl rand -hex 32
```

Application will **exit with code 1** if required secrets are missing.

---

## Input Validation

### Overview

All user inputs are validated and sanitized to prevent:

- Path traversal attacks (`../../etc/passwd`)
- Command injection (`; rm -rf /`)
- XSS (Cross-Site Scripting)
- SQL injection (additional to ORM protection)

### Validation Functions

#### 1. Filename Sanitization

```python
from app.core.validation import sanitize_filename

# Dangerous filename
filename = "../../etc/passwd; rm -rf /"

# Sanitized
safe_filename = sanitize_filename(filename)
# Result: "etc_passwd_rm_-rf_"
```

#### 2. Email Validation

```python
from app.core.validation import validate_email

is_valid, error = validate_email("user@example.com")
# is_valid: True
# error: None

is_valid, error = validate_email("invalid@")
# is_valid: False
# error: "Invalid email format"
```

#### 3. Password Strength

```python
from app.core.validation import validate_password_strength

is_valid, error = validate_password_strength("weak")
# is_valid: False
# error: "Password must be at least 8 characters long"

is_valid, error = validate_password_strength("Strong123!")
# is_valid: True
# error: None
```

**Requirements:**
- At least 8 characters
- Contains uppercase letter
- Contains lowercase letter
- Contains digit
- Contains special character (!@#$%^&*...)

#### 4. URL Validation

```python
from app.core.validation import validate_url

is_valid, error = validate_url("https://example.com")
# is_valid: True

is_valid, error = validate_url("javascript:alert('xss')")
# is_valid: False
# error: "URL scheme must be one of: http, https"
```

#### 5. UUID Validation

```python
from app.core.validation import validate_uuid

is_valid, error = validate_uuid("550e8400-e29b-41d4-a716-446655440000")
# is_valid: True

is_valid, error = validate_uuid("not-a-uuid")
# is_valid: False
# error: "Invalid UUID format"
```

### Using InputValidator in Endpoints

```python
from app.core.validation import InputValidator

@router.post("/users/register")
async def register_user(email: str, password: str):
    # Create validator
    validator = InputValidator()

    # Validate inputs
    validator.validate_email(email)
    validator.validate_password(password)

    # Raise HTTPException if any errors
    validator.raise_if_errors()

    # Inputs are valid - proceed
    ...
```

### File Upload Security

```python
from app.core.validation import (
    sanitize_filename,
    validate_file_extension,
    validate_filepath_security
)

# Sanitize filename
safe_name = sanitize_filename(user_provided_filename)

# Validate extension
is_valid, error = validate_file_extension(
    safe_name,
    allowed_extensions=['.epub', '.fb2']
)

# Validate path doesn't escape base directory
is_valid, error = validate_filepath_security(
    filepath=f"/uploads/{safe_name}",
    allowed_base="/uploads"
)
```

---

## CORS Configuration

### Overview

Cross-Origin Resource Sharing (CORS) controls which domains can access the API.

### Current Configuration

```python
# backend/app/core/config.py
CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"
```

### Allowed Origins

- Development: `http://localhost:3000` (frontend dev server)
- Production: Update `CORS_ORIGINS` environment variable

### Production CORS Setup

```bash
# .env or environment variables
CORS_ORIGINS=https://bookreader.example.com,https://www.bookreader.example.com
```

**⚠️ NEVER use `*` (allow all origins) in production!**

### CORS Headers

```
Access-Control-Allow-Origin: http://localhost:3000
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Max-Age: 600
```

---

## Authentication & Authorization

### JWT Tokens

- **Access Token:** 12 hours validity
- **Refresh Token:** 7 days validity
- **Algorithm:** HS256 (HMAC-SHA256)

### Token Security

1. **Secure Storage:**
   - Frontend: HttpOnly cookies or localStorage (with XSS protection)
   - Never expose tokens in URLs or logs

2. **Token Rotation:**
   - Use refresh tokens to get new access tokens
   - Invalidate old tokens on password change

3. **Password Security:**
   - Bcrypt hashing with salt
   - Minimum 8 characters with complexity requirements

### Protected Endpoints

```python
from app.core.auth import get_current_active_user

@router.get("/users/me")
async def get_current_user(
    current_user: User = Depends(get_current_active_user)
):
    # Only authenticated users can access
    return current_user
```

---

## Security Best Practices

### Development

1. **Never commit secrets to git**
   - Use .env files (in .gitignore)
   - Use git-secrets or similar tools

2. **Use HTTPS in production**
   - Configure TLS/SSL certificates
   - Enable HSTS

3. **Keep dependencies updated**
   ```bash
   pip list --outdated
   pip install -U package_name
   ```

4. **Run security scanners**
   ```bash
   # Dependency vulnerabilities
   pip install safety
   safety check

   # Code security issues
   pip install bandit
   bandit -r backend/app/
   ```

### Production

1. **Set DEBUG=false**
   ```bash
   DEBUG=false
   ```

2. **Use strong secrets**
   - Generate with `openssl rand -hex 32`
   - Rotate periodically

3. **Enable monitoring**
   - Sentry for error tracking
   - Prometheus for metrics
   - Log aggregation (ELK, Datadog)

4. **Regular backups**
   - Database backups (daily)
   - Encryption for backup files

5. **Security headers**
   - All headers must be present
   - Test with: https://securityheaders.com/

6. **Rate limiting**
   - Monitor Redis for rate limit metrics
   - Adjust limits based on traffic patterns

---

## Security Checklist

### Pre-Deployment Checklist

- [ ] All required secrets set
- [ ] SECRET_KEY is strong (32+ chars)
- [ ] DEBUG=false in production
- [ ] CORS origins restricted (no `*`)
- [ ] HTTPS configured and working
- [ ] Security headers active
- [ ] Rate limiting enabled
- [ ] Input validation applied to all endpoints
- [ ] Dependencies updated (no known vulnerabilities)
- [ ] Error tracking configured (Sentry)
- [ ] Database backups configured
- [ ] Monitoring and alerting set up

### Regular Security Maintenance

**Weekly:**
- [ ] Review application logs for suspicious activity
- [ ] Check rate limit metrics

**Monthly:**
- [ ] Update dependencies (`pip list --outdated`)
- [ ] Run security scanners (safety, bandit)
- [ ] Review and rotate secrets if needed

**Quarterly:**
- [ ] Security audit of new features
- [ ] Penetration testing
- [ ] Review CORS and rate limit configurations

---

## Incident Response

### In Case of Security Breach

1. **Immediate Actions:**
   - Isolate affected systems
   - Rotate all secrets immediately
   - Block malicious IPs/users
   - Enable additional logging

2. **Investigation:**
   - Analyze logs for breach timeline
   - Identify attack vector
   - Assess data exposure

3. **Recovery:**
   - Patch vulnerabilities
   - Restore from clean backups
   - Notify affected users (if required by law)

4. **Post-Incident:**
   - Document incident and response
   - Update security measures
   - Conduct lessons learned review

### Security Contact

For security issues, contact:
- Email: security@bookreader.ai (fictional - update with real contact)
- GitHub: Create private security advisory

---

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP Cheat Sheets](https://cheatsheetseries.owasp.org/)
- [FastAPI Security](https://fastapi.tiangolo.com/tutorial/security/)
- [Mozilla Web Security Guidelines](https://infosec.mozilla.org/guidelines/web_security)

---

**Document Version:** 1.0
**Last Updated:** 2025-10-29
**Next Review:** 2025-11-29
