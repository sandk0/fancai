"""
Secrets Management и Validation для fancai.

Валидирует критические secrets на старте приложения и обеспечивает
security best practices для управления конфиденциальными данными.

Features:
- Валидация required secrets
- Проверка strength для SECRET_KEY
- Детекция default/test credentials в production
- Предупреждения об отсутствующих optional secrets
"""

import os
import sys
import re
from typing import List, Tuple, Optional, Dict, Any
from enum import Enum

import aiofiles
from app.core.logging import logger

# ============================================================================
# Secret Categories
# ============================================================================


class SecretCategory(str, Enum):
    """Категории secrets по критичности."""

    REQUIRED = "required"  # Обязательные для запуска
    RECOMMENDED = "recommended"  # Настоятельно рекомендуются
    OPTIONAL = "optional"  # Опциональные, но улучшают функциональность


# ============================================================================
# Secrets Configuration
# ============================================================================

SECRETS_CONFIG = {
    # Критически важные secrets (обязательны)
    SecretCategory.REQUIRED: [
        {
            "name": "SECRET_KEY",
            "description": "JWT signing key",
            "min_length": 32,
            "validate_strength": True,
            "allow_dev_default": True,  # Allow dev-secret-key in development
        },
        {
            "name": "DATABASE_URL",
            "description": "PostgreSQL connection string",
            "forbidden_values": ["postgres123", "fancai_dev"],
            "forbidden_in_production_only": True,  # Allow dev credentials in dev mode
        },
        {
            "name": "REDIS_URL",
            "description": "Redis connection string",
            "forbidden_values": ["redis123"],
            "forbidden_in_production_only": True,  # Allow dev credentials in dev mode
        },
    ],
    # Рекомендуемые secrets (для production)
    SecretCategory.RECOMMENDED: [
        {
            "name": "HAWK_TOKEN",
            "description": "Hawk Tracker error tracking token",
            "required_in_production": True,
            "required_in_development": False,  # Optional in development/staging
        },
        {
            "name": "SMTP_PASSWORD",
            "description": "Email service password",
            "required_in_production": False,
        },
    ],
    # Опциональные secrets (расширенные функции)
    SecretCategory.OPTIONAL: [
        {
            "name": "OPENAI_API_KEY",
            "description": "OpenAI API key для DALL-E image generation",
        },
        {
            "name": "MIDJOURNEY_API_KEY",
            "description": "Midjourney API key для image generation",
        },
        {
            "name": "YOOKASSA_SHOP_ID",
            "description": "YooKassa payment shop ID",
        },
        {
            "name": "YOOKASSA_SECRET_KEY",
            "description": "YooKassa payment secret key",
        },
        {
            "name": "CLOUDPAYMENTS_PUBLIC_ID",
            "description": "CloudPayments public ID",
        },
    ],
}


# ============================================================================
# Validation Functions
# ============================================================================


def validate_secret_exists(secret_name: str) -> bool:
    """
    Проверяет, установлен ли secret в environment variables.

    Args:
        secret_name: Имя secret (environment variable)

    Returns:
        True если secret установлен и не пустой
    """
    value = os.getenv(secret_name)
    return value is not None and value.strip() != ""


def validate_secret_strength(
    secret_value: str, min_length: int = 32
) -> Tuple[bool, Optional[str]]:
    """
    Валидирует strength секрета (например, SECRET_KEY).

    Requirements для strong secret:
    - Минимальная длина (default: 32 символа)
    - Содержит uppercase буквы
    - Содержит lowercase буквы
    - Содержит цифры
    - Содержит специальные символы (опционально, но рекомендуется)

    Args:
        secret_value: Значение секрета
        min_length: Минимальная длина

    Returns:
        Tuple: (is_valid, error_message)
    """
    if len(secret_value) < min_length:
        return False, f"Secret is too short (minimum {min_length} characters)"

    has_upper = any(c.isupper() for c in secret_value)
    has_lower = any(c.islower() for c in secret_value)
    has_digit = any(c.isdigit() for c in secret_value)

    if not has_upper:
        return False, "Secret must contain at least one uppercase letter"

    if not has_lower:
        return False, "Secret must contain at least one lowercase letter"

    if not has_digit:
        return False, "Secret must contain at least one digit"

    # Special characters - recommended but not required
    special_chars = r"!@#$%^&*()_+-=[]{}|;:,.<>?"
    has_special = any(c in special_chars for c in secret_value)
    if not has_special:
        return True, "WARNING: Secret recommended to contain special characters"

    return True, None


def validate_secret_not_default(
    secret_value: str, forbidden_values: List[str]
) -> Tuple[bool, Optional[str]]:
    """
    Проверяет, что secret не содержит forbidden default/test значения.

    Args:
        secret_value: Значение секрета
        forbidden_values: Список запрещенных подстрок

    Returns:
        Tuple: (is_valid, error_message)
    """
    for forbidden in forbidden_values:
        if forbidden.lower() in secret_value.lower():
            return False, f"Secret contains forbidden default value: '{forbidden}'"

    return True, None


def validate_email_format(email: str) -> bool:
    """
    Валидирует email format.

    Args:
        email: Email address string

    Returns:
        True если email валидный
    """
    pattern = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
    return re.match(pattern, email) is not None


# ============================================================================
# Comprehensive Secrets Validator
# ============================================================================


class SecretsValidator:
    """
    Comprehensive validator для всех application secrets.

    Проверяет:
    1. Наличие required secrets
    2. Strength секретов (длина, сложность)
    3. Отсутствие default/test значений в production
    4. Рекомендуемые secrets для production
    """

    def __init__(self, is_production: bool = False):
        """
        Инициализация validator.

        Args:
            is_production: True если запущено в production режиме
        """
        self.is_production = is_production
        self.validation_results: Dict[str, Any] = {}

    def validate_all_secrets(self) -> Tuple[bool, Dict[str, Any]]:
        """
        Выполняет полную валидацию всех secrets.

        Returns:
            Tuple: (is_valid, validation_report)
            - is_valid: True если все required secrets валидны
            - validation_report: Dict с детальными результатами
        """
        report = {
            "valid": True,
            "errors": [],
            "warnings": [],
            "missing_required": [],
            "missing_recommended": [],
            "missing_optional": [],
        }

        # Validate required secrets
        for secret_config in SECRETS_CONFIG[SecretCategory.REQUIRED]:
            result = self._validate_secret(secret_config, required=True)
            if not result["valid"]:
                report["valid"] = False
                report["errors"].extend(result["errors"])
                if not result["exists"]:
                    report["missing_required"].append(secret_config["name"])

            report["warnings"].extend(result["warnings"])

        # Validate recommended secrets
        for secret_config in SECRETS_CONFIG[SecretCategory.RECOMMENDED]:
            if self.is_production:
                required = secret_config.get("required_in_production", False)
            else:
                # In development/staging mode
                required = secret_config.get("required_in_development", False)
            result = self._validate_secret(secret_config, required=required)

            if not result["exists"]:
                report["missing_recommended"].append(secret_config["name"])
                if required:
                    report["valid"] = False
                    report["errors"].extend(result["errors"])
                else:
                    report["warnings"].append(
                        f"Recommended secret not set: {secret_config['name']} ({secret_config['description']})"
                    )

        # Check optional secrets
        for secret_config in SECRETS_CONFIG[SecretCategory.OPTIONAL]:
            if not validate_secret_exists(secret_config["name"]):
                report["missing_optional"].append(secret_config["name"])

        self.validation_results = report
        return report["valid"], report

    def _validate_secret(
        self, secret_config: dict, required: bool = True
    ) -> Dict[str, Any]:
        """
        Валидирует отдельный secret согласно конфигурации.

        Args:
            secret_config: Конфигурация secret (name, description, constraints)
            required: Является ли secret обязательным

        Returns:
            Dict с результатами валидации
        """
        result = {
            "valid": True,
            "exists": False,
            "errors": [],
            "warnings": [],
        }

        secret_name = secret_config["name"]
        secret_value = os.getenv(secret_name)

        # Check existence
        if not secret_value or not secret_value.strip():
            result["valid"] = False if required else True
            result["exists"] = False
            if required:
                result["errors"].append(
                    f"Required secret not set: {secret_name} ({secret_config.get('description', 'No description')})"
                )
            return result

        result["exists"] = True

        # Validate strength (if specified)
        if secret_config.get("validate_strength", False):
            min_length = secret_config.get("min_length", 32)
            is_strong, error_msg = validate_secret_strength(secret_value, min_length)

            # Allow dev defaults in development mode
            allow_dev_default = secret_config.get("allow_dev_default", False)
            is_dev_default = "dev-secret-key" in secret_value.lower()

            if not is_strong:
                # Skip strength validation for dev defaults in development
                if is_dev_default and allow_dev_default and not self.is_production:
                    result["warnings"].append(
                        f"{secret_name}: Using development default (not suitable for production)"
                    )
                elif error_msg.startswith("WARNING"):
                    result["warnings"].append(f"{secret_name}: {error_msg}")
                else:
                    result["valid"] = False
                    result["errors"].append(f"{secret_name}: {error_msg}")

        # Validate not default (if specified)
        if "forbidden_values" in secret_config:
            forbidden_in_prod_only = secret_config.get(
                "forbidden_in_production_only", False
            )

            is_valid, error_msg = validate_secret_not_default(
                secret_value, secret_config["forbidden_values"]
            )

            if not is_valid:
                # Allow forbidden values in development if flag is set
                if forbidden_in_prod_only and not self.is_production:
                    result["warnings"].append(
                        f"{secret_name}: Using development credentials (not suitable for production)"
                    )
                else:
                    result["valid"] = False
                    result["errors"].append(f"{secret_name}: {error_msg}")

        return result

    def print_report(self) -> None:
        """Logs validation report using structured logging."""
        report = self.validation_results

        if report["valid"]:
            logger.info("Secrets validation passed")
        else:
            logger.error("Secrets validation failed")

        # Log errors
        for error in report["errors"]:
            logger.error("Secrets validation error", message=error)

        # Log warnings
        for warning in report["warnings"]:
            logger.warning("Secrets validation warning", message=warning)

        # Log missing secrets summary
        if report["missing_required"]:
            logger.error(
                "Missing required secrets",
                secrets=report["missing_required"],
                count=len(report["missing_required"]),
            )

        if report["missing_recommended"]:
            logger.warning(
                "Missing recommended secrets",
                secrets=report["missing_recommended"],
                count=len(report["missing_recommended"]),
            )

        if report["missing_optional"]:
            logger.info(
                "Missing optional secrets",
                secrets=report["missing_optional"],
                count=len(report["missing_optional"]),
            )


# ============================================================================
# Startup Secrets Check
# ============================================================================


def startup_secrets_check(is_production: bool = None) -> None:
    """
    Выполняет полную проверку secrets при старте приложения.

    Если валидация failed для required secrets - останавливает приложение.
    Если только warnings - продолжает с предупреждениями.

    В development mode разрешает использование dev credentials с warnings.
    В production mode требует строгого соблюдения всех правил.
    В CI/CD mode (test, GitHub Actions) пропускает strict validation для test credentials.

    Args:
        is_production: True если production режим (если None - определяется по DEBUG)

    Raises:
        SystemExit: Если required secrets не валидны
    """
    if is_production is None:
        # Определяем production режим по DEBUG environment variable
        is_production = os.getenv("DEBUG", "true").lower() not in ["true", "1", "yes"]

    # Проверка на CI/CD окружение (GitHub Actions, GitLab CI, CircleCI, etc.)
    is_ci = (
        os.getenv("CI") == "true"
        or os.getenv("GITHUB_ACTIONS") == "true"
        or os.getenv("GITLAB_CI") == "true"
        or os.getenv("CIRCLECI") == "true"
        or os.getenv("ENVIRONMENT") in ["test", "ci"]
    )

    # Skip strict secrets validation in CI/test environments
    if is_ci:
        logger.info("CI/Test mode: Skipping strict secrets validation")
        return

    mode = "PRODUCTION" if is_production else "DEVELOPMENT"
    logger.info("Running secrets validation", mode=mode)

    # Выполняем валидацию (как в dev, так и в production)
    validator = SecretsValidator(is_production=is_production)
    is_valid, report = validator.validate_all_secrets()

    # Print report
    validator.print_report()

    # Exit if validation failed
    if not is_valid:
        logger.critical(
            "Secrets validation failed - cannot start application",
            help="Set missing secrets in .env file or use: openssl rand -hex 32",
        )
        sys.exit(1)

    if report["warnings"]:
        if not is_production:
            logger.warning("Development mode: Using dev credentials")
        else:
            logger.warning("Application started with warnings - review secrets")
    else:
        logger.info("All secrets validated successfully")


def generate_secret_key() -> str:
    """
    Генерирует cryptographically secure secret key.

    Returns:
        Random hex string (64 characters)
    """
    import secrets

    return secrets.token_hex(32)


# ============================================================================
# Helper Functions
# ============================================================================


def get_secret_template() -> str:
    """
    Возвращает template для .env файла со всеми secrets.

    Returns:
        String с template .env файла
    """
    template = []
    template.append("# fancai - Environment Variables")
    template.append("# Generated secrets template")
    template.append("")

    for category, secrets_list in SECRETS_CONFIG.items():
        template.append(f"\n# {category.value.upper()} secrets")
        for secret in secrets_list:
            template.append(f"# {secret['description']}")
            template.append(f"{secret['name']}=")
            template.append("")

    return "\n".join(template)


async def check_secrets_in_file(filepath: str) -> Tuple[bool, List[str]]:
    """
    Проверяет .env файл на наличие hardcoded secrets в git-tracked файлах.

    ВНИМАНИЕ: Никогда не коммитьте .env файлы в git!

    Args:
        filepath: Путь к файлу для проверки

    Returns:
        Tuple: (has_secrets, secret_keys_found)
    """
    if not os.path.exists(filepath):
        return False, []

    secret_keys = [
        s["name"]
        for category in SECRETS_CONFIG.values()
        for s in category
        if category != SecretCategory.OPTIONAL
    ]

    found_secrets = []
    try:
        async with aiofiles.open(filepath, "r") as f:
            content = await f.read()
            for key in secret_keys:
                # Pattern: KEY=value (не пустое)
                pattern = rf"^{key}=.+$"
                if re.search(pattern, content, re.MULTILINE):
                    found_secrets.append(key)
    except Exception as e:
        logger.error("Error checking file for secrets", error=str(e))

    return len(found_secrets) > 0, found_secrets
