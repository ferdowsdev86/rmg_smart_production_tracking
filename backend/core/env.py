"""Load .env from project root (SmartFinishingFloor/.env) or backend/.env."""
from pathlib import Path

from decouple import Config, RepositoryEnv

BASE_DIR = Path(__file__).resolve().parent.parent

for _env_path in (BASE_DIR.parent / ".env", BASE_DIR / ".env"):
    if _env_path.is_file():
        config = Config(RepositoryEnv(str(_env_path)))
        break
else:
    from decouple import config  # type: ignore[misc, assignment]
