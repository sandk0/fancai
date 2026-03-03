"""
Gunicorn конфигурация для fancai backend (production).

Использует UvicornWorker для ASGI-совместимой работы с FastAPI.
Настроен для 32GB/12vCPU сервера с учётом memory limits Celery workers.
"""

import os

# Bind
bind = "0.0.0.0:8000"

# Workers
workers = int(os.getenv("WORKERS_COUNT", "2"))
worker_class = "uvicorn.workers.UvicornWorker"

# Timeouts
timeout = int(os.getenv("WORKER_TIMEOUT", "300"))
graceful_timeout = 30
keepalive = 5

# Requests (recycle workers periodically to prevent memory leaks)
max_requests = int(os.getenv("WORKER_MAX_REQUESTS", "1000"))
max_requests_jitter = int(os.getenv("WORKER_MAX_REQUESTS_JITTER", "100"))

# Temp directory (tmpfs for faster heartbeat checks)
worker_tmp_dir = "/dev/shm"

# Logging
accesslog = "-"  # stdout
errorlog = "-"  # stderr
loglevel = os.getenv("LOG_LEVEL", "info").lower()
access_log_format = (
    '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)sus'
)

# Process naming
proc_name = "fancai-backend"
