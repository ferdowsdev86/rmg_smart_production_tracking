# from .celery import app as celery_app

# __all__ = ("celery_app",)
from core.env import config

# PyMySQL is only needed for MySQL/MariaDB. SQLite dev skips this import.
if not config("USE_SQLITE", default=False, cast=bool):
    try:
        import pymysql
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            "PyMySQL is required when USE_SQLITE=False. "
            "From the backend folder run: python -m pip install PyMySQL"
        ) from exc
    pymysql.install_as_MySQLdb()