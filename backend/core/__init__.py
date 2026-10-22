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
    # Django 6 refuses the shim's reported mysqlclient version (1.4.6);
    # PyMySQL implements the needed API, so present a new-enough version.
    if pymysql.version_info < (2, 2, 1):
        pymysql.version_info = (2, 2, 1, "final", 0)