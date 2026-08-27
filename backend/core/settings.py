import logging
import os
from datetime import timedelta
from pathlib import Path

from decouple import Csv

from core.env import config

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = config("SECRET_KEY", default="dev-insecure-change-me-in-production")
DEBUG = config("DEBUG", default=True, cast=bool)
ALLOWED_HOSTS = config("ALLOWED_HOSTS", default="127.0.0.1,localhost", cast=Csv())
# IoT / hotspot testing: accept any Host while DEBUG (avoids DisallowedHost on changing LAN IPs).
if DEBUG:
    ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "channels",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt",
    "floors",
    "employees",
    "attendance",
    "reports",
    "websocket",
    "mbm_automation",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "core.urls"
WSGI_APPLICATION = "core.wsgi.application"
ASGI_APPLICATION = "core.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

if config("USE_SQLITE", default=False, cast=bool):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }
else:
    _mysql_base = {
        "ENGINE": "django.db.backends.mysql",
        "USER": config("MYSQL_USER", default="sff"),
        "PASSWORD": config("MYSQL_PASSWORD", default="sff"),
        "HOST": config("MYSQL_HOST", default="127.0.0.1"),
        "PORT": config("MYSQL_PORT", default="3306"),
        # Reuse connections across requests — critical for the remote/AWS DB
        # where every new connection costs several network round-trips.
        "CONN_MAX_AGE": int(config("DB_CONN_MAX_AGE", default="300")),
        "CONN_HEALTH_CHECKS": True,
        "OPTIONS": {
            "charset": "utf8mb4",
            "init_command": "SET sql_mode='STRICT_TRANS_TABLES'",
        },
    }
    DATABASES = {
        "default": {
            **_mysql_base,
            "NAME": config("MYSQL_DATABASE", default="smart_finishing_floor"),
        },
        "mbm_automation": {
            **_mysql_base,
            "NAME": config("MYSQL_AUTOMATION_DATABASE", default="mbm_automation"),
            "USER": config(
                "MYSQL_AUTOMATION_USER",
                default=config("MYSQL_USER", default="sff"),
            ),
            "PASSWORD": config(
                "MYSQL_AUTOMATION_PASSWORD",
                default=config("MYSQL_PASSWORD", default="sff"),
            ),
            "HOST": config(
                "MYSQL_AUTOMATION_HOST",
                default=config("MYSQL_HOST", default="127.0.0.1"),
            ),
            "PORT": config(
                "MYSQL_AUTOMATION_PORT",
                default=config("MYSQL_PORT", default="3306"),
            ),
        },
        "cuttingedge": {
            **_mysql_base,
            "NAME": config("MYSQL_CUTTINGEDGE_DATABASE", default="cuttingedgedb"),
            "USER": config(
                "MYSQL_CUTTINGEDGE_USER",
                default=config("MYSQL_USER", default="sff"),
            ),
            "PASSWORD": config(
                "MYSQL_CUTTINGEDGE_PASSWORD",
                default=config("MYSQL_PASSWORD", default="sff"),
            ),
            "HOST": config(
                "MYSQL_CUTTINGEDGE_HOST",
                default=config("MYSQL_HOST", default="127.0.0.1"),
            ),
            "PORT": config(
                "MYSQL_CUTTINGEDGE_PORT",
                default=config("MYSQL_PORT", default="3306"),
            ),
        },
    }
    DATABASE_ROUTERS = ["core.db_router.ExternalDbRouter"]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# sewing_log logged_at is factory wall clock (Asia/Dhaka) stored with UTC marker
SEWING_LOG_TIMEZONE = config("SEWING_LOG_TIMEZONE", default="Asia/Dhaka")

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REDIS_URL = config("REDIS_URL", default="redis://127.0.0.1:6379/0")
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [REDIS_URL]},
    },
}

CELERY_BROKER_URL = config("CELERY_BROKER_URL", default=REDIS_URL)
CELERY_RESULT_BACKEND = config("CELERY_RESULT_BACKEND", default=REDIS_URL)
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = TIME_ZONE

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_RENDERER_CLASSES": ("rest_framework.renderers.JSONRenderer",),
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=config("JWT_ACCESS_MINUTES", default=60, cast=int)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=config("JWT_REFRESH_DAYS", default=7, cast=int)),
    "ROTATE_REFRESH_TOKENS": True,
}

CORS_ALLOWED_ORIGINS = config(
    "CORS_ALLOWED_ORIGINS",
    default="http://127.0.0.1:5173,http://localhost:5173",
    cast=Csv(),
)
CORS_ALLOW_CREDENTIALS = True

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "[{levelname}] {asctime} {name} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": os.environ.get("LOG_LEVEL", "INFO"),
    },
    "loggers": {
        "django": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "django.request": {"handlers": ["console"], "level": "WARNING", "propagate": False},
    },
}
