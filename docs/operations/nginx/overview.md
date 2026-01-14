# Nginx Configuration Files

This directory contains nginx configuration files for BookReader AI.

## Production Configuration

**CANONICAL FILE:** `nginx.prod.conf.template`

This is the main production configuration file that uses environment variable substitution for dynamic domain configuration.

### Environment Variables

- `DOMAIN_NAME` - Your domain name (e.g., `fancai.ru` or `localhost`)

### How It Works

1. `docker-entrypoint.sh` processes the template file
2. Replaces `${DOMAIN_NAME}` with actual domain from environment
3. Generates final `/etc/nginx/nginx.conf` inside container
4. Starts nginx with processed configuration

### Usage

In `docker-compose.production.yml`:

```yaml
nginx:
  environment:
    - DOMAIN_NAME=yourdomain.com
  volumes:
    - ./nginx/nginx.prod.conf.template:/etc/nginx/nginx.conf.template:ro
    - ./nginx/docker-entrypoint.sh:/docker-entrypoint.d/00-envsubst.sh:ro
```

In `.env.production`:

```bash
DOMAIN_NAME=yourdomain.com
```

## Deprecated Files

- `prod.conf.DEPRECATED_USE_NGINX_PROD_CONF_TEMPLATE` - Old static configuration (replaced by template)

## Directory Structure

```
nginx/
├── README.md                                    # This file
├── nginx.prod.conf.template                     # ✅ Production template (USE THIS)
├── docker-entrypoint.sh                         # Template processor script
├── conf.d/                                      # Additional nginx configs
├── ssl/                                         # SSL certificates
└── prod.conf.DEPRECATED_USE_NGINX_PROD_CONF_TEMPLATE  # Deprecated backup
```

## Development vs Production

- **Development:** Uses `prod.conf` or similar simple configs
- **Production:** Uses `nginx.prod.conf.template` with environment substitution

## SSL/TLS Configuration

SSL certificates are expected in `ssl/` directory:

- `ssl/fullchain.pem` - Certificate chain
- `ssl/privkey.pem` - Private key

### Let's Encrypt Setup

For automatic SSL certificates with Let's Encrypt, see:
- `/docs/guides/deployment/production-deployment.md`
- `/scripts/setup-ssl.sh`

## Security Features

The production nginx configuration includes:

1. **Rate Limiting**
   - API: 10 req/sec
   - Login: 5 req/min
   - Register: 2 req/min

2. **Security Headers**
   - HSTS (HTTP Strict Transport Security)
   - CSP (Content Security Policy)
   - X-Frame-Options
   - X-XSS-Protection
   - X-Content-Type-Options

3. **SSL/TLS**
   - TLS 1.2 and 1.3 only
   - Modern cipher suites
   - OCSP stapling

4. **Request Protection**
   - Large file upload limits (50MB)
   - Connection limits per IP
   - Blocked common exploit patterns

## Performance Optimizations

- Gzip compression for text/json/javascript
- Static file caching (1 year for immutable assets)
- HTTP/2 support
- Keepalive connections
- Upstream connection pooling

## Troubleshooting

### Template Variables Not Substituting

Check that:
1. `DOMAIN_NAME` is set in environment
2. `docker-entrypoint.sh` is mounted to `/docker-entrypoint.d/`
3. Entrypoint script has execute permissions (`chmod +x`)

### Nginx Fails to Start

```bash
# Check nginx configuration syntax
docker-compose exec nginx nginx -t

# View nginx logs
docker-compose logs nginx

# Verify template was processed
docker-compose exec nginx cat /etc/nginx/nginx.conf | grep server_name
```

### Domain Not Working

1. Verify DNS points to server IP
2. Check `DOMAIN_NAME` environment variable
3. Verify SSL certificates are valid
4. Check firewall allows ports 80/443

## References

- [Nginx Official Documentation](https://nginx.org/en/docs/)
- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/)
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
