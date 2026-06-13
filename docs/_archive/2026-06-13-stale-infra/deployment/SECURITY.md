# Security Guidelines for BookReader AI

## Critical Security Checklist

### Before Production Deployment

- [ ] **Change ALL default passwords** in `.env.production`
- [ ] **Generate strong SECRET_KEY** (minimum 64 characters)
- [ ] **Generate strong JWT_SECRET_KEY** (minimum 64 characters)
- [ ] **Set DEBUG=false** in production
- [ ] **Configure proper CORS_ORIGINS** (no wildcards)
- [ ] **Setup SSL/TLS certificates** (Let's Encrypt)
- [ ] **Review and limit ALLOWED_HOSTS**
- [ ] **Secure database credentials**
- [ ] **Secure Redis password**
- [ ] **Setup firewall rules** (only expose 80/443)
- [ ] **Enable backup automation**
- [ ] **Configure monitoring and alerts**

## Generating Secure Secrets

### Python Method (Recommended)

```bash
# Generate SECRET_KEY
python -c "import secrets; print(secrets.token_urlsafe(64))"

# Generate JWT_SECRET_KEY
python -c "import secrets; print(secrets.token_urlsafe(64))"

# Generate database password
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### OpenSSL Method

```bash
# Generate 64-byte random secret
openssl rand -base64 64
```

## Environment Variables Security

### Development vs Production

**Development (.env):**
- Can use simple passwords for local testing
- DEBUG=true is acceptable
- CORS can be permissive (localhost)

**Production (.env.production):**
- MUST use strong generated secrets
- DEBUG=false (CRITICAL)
- CORS must be restrictive (exact domains only)
- All passwords must be complex and unique

### Never Commit Secrets

Files that should NEVER be committed:
- `.env`
- `.env.local`
- `.env.production`
- `.env.production.local`
- Any file containing API keys, passwords, or secrets

Always use `.env.example` as template (with placeholder values only).

## Docker Security

### Container Security Best Practices

1. **Run as non-root user** (already configured in Dockerfiles)
2. **Limit container resources** (memory, CPU limits)
3. **Use specific image tags** (not `latest`)
4. **Scan images for vulnerabilities** (Trivy in CI/CD)
5. **Keep base images updated**

### Network Security

```yaml
# All services should be on private network
networks:
  bookreader_network:
    driver: bridge
    internal: false  # Only nginx/backend need external access
```

### Volume Security

```yaml
# Protect sensitive data volumes
volumes:
  postgres_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /encrypted/postgres/data  # Use encrypted filesystem
```

## Database Security

### PostgreSQL Hardening

1. **Strong password** (minimum 32 characters, random)
2. **Limit connections** (max_connections in postgresql.conf)
3. **Enable SSL** for remote connections
4. **Regular backups** with encryption
5. **Principle of least privilege** (app user ≠ admin user)

### Recommended pg_hba.conf

```
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             postgres                                peer
host    bookreader_prod bookreader_user 172.18.0.0/16          scram-sha-256
host    all             all             0.0.0.0/0              reject
```

## Redis Security

### Configuration

```conf
# redis.conf security settings
requirepass <strong-random-password>
bind 127.0.0.1 ::1
protected-mode yes
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command CONFIG ""
```

## API Security

### Rate Limiting

Configure in `backend/app/core/config.py`:

```python
RATE_LIMIT_PER_MINUTE = 60  # 60 requests per minute per IP
RATE_LIMIT_BURST = 10  # Allow 10 request burst
```

### Authentication

- JWT tokens with short expiration (1 hour)
- Refresh tokens stored securely
- HTTPS only in production
- CSRF protection enabled

### CORS Configuration

**Production:**
```python
CORS_ORIGINS = [
    "https://bookreader.example.com",
    "https://www.bookreader.example.com",
]
```

**Development:**
```python
CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
```

## SSL/TLS Configuration

### Let's Encrypt Setup

```bash
# Install certbot
apt-get install certbot python3-certbot-nginx

# Obtain certificate
certbot --nginx -d bookreader.example.com -d www.bookreader.example.com

# Auto-renewal (crontab)
0 0 1 * * certbot renew --quiet
```

### Nginx SSL Configuration

```nginx
# Strong SSL configuration
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers HIGH:!aNULL:!MD5;
ssl_prefer_server_ciphers on;

# Security headers
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

## Secrets Management

### GitHub Actions Secrets

Required secrets in GitHub repository settings:

**Production:**
- `PROD_SSH_KEY` - SSH private key for deployment
- `PROD_HOST` - Production server hostname
- `PROD_USER` - SSH username
- `PROD_ENV_FILE` - Base64-encoded .env.production file

**Staging:**
- `STAGING_SSH_KEY`
- `STAGING_HOST`
- `STAGING_USER`
- `STAGING_ENV_FILE`

### Adding Secrets to GitHub

```bash
# Settings → Secrets and variables → Actions → New repository secret

# Encode .env file for secret storage
base64 .env.production > env.production.b64
# Copy contents to PROD_ENV_FILE secret

# Generate SSH key for deployment
ssh-keygen -t ed25519 -C "github-actions-deploy"
# Copy private key to PROD_SSH_KEY secret
# Add public key to server's ~/.ssh/authorized_keys
```

## Monitoring & Auditing

### Security Monitoring

1. **Failed login attempts** (log and alert)
2. **Unusual API usage** (rate limit violations)
3. **Database access patterns** (detect SQL injection attempts)
4. **File upload abuse** (malware scanning)
5. **System resource usage** (detect DoS attempts)

### Security Logs

All security events logged to:
- `/var/log/bookreader/security.log`
- Centralized logging (ELK stack or similar)
- Real-time alerting (PagerDuty, Slack)

## Incident Response

### Security Breach Protocol

1. **Immediately rotate all secrets** (database, API keys, JWT secrets)
2. **Invalidate all active sessions**
3. **Review access logs** (identify scope of breach)
4. **Patch vulnerability** (deploy fix)
5. **Notify affected users** (if PII compromised)
6. **Post-mortem analysis** (prevent recurrence)

### Emergency Contacts

- Security Team: security@example.com
- On-call Engineer: +1-XXX-XXX-XXXX
- Incident Response: incidents@example.com

## Compliance

### GDPR Compliance

- [ ] Data encryption at rest and in transit
- [ ] User data deletion capabilities
- [ ] Privacy policy and terms of service
- [ ] Cookie consent mechanism
- [ ] Data breach notification procedures

### Data Protection

- User passwords hashed with bcrypt (cost factor 12+)
- Sensitive data encrypted in database
- Regular security audits
- Penetration testing before major releases

## Security Checklist for Updates

Before deploying updates:

- [ ] Dependencies scanned for vulnerabilities (Trivy)
- [ ] Code reviewed for security issues
- [ ] All tests pass (including security tests)
- [ ] Secrets not exposed in code or logs
- [ ] Database migrations tested
- [ ] Rollback plan prepared
- [ ] Monitoring alerts configured
- [ ] Security team notified

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [FastAPI Security Best Practices](https://fastapi.tiangolo.com/tutorial/security/)
- [Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)
- [PostgreSQL Security](https://www.postgresql.org/docs/current/security.html)

---

**Last Updated:** 2025-10-24
**Review Schedule:** Monthly security audits
