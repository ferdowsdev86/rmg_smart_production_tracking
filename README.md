# Smart Finishing Floor

Full-stack operations console: **Django + Django REST Framework + JWT**, **MariaDB**, **Redis + Celery + Channels (WebSockets)**, **React (Vite) + Tailwind + React Query + Zustand**, and a separate **OpenCV + DeepFace** camera worker package.

## Stack

| Layer | Technology |
| --- | --- |
| API | Django 4.2+, DRF, SimpleJWT, `channels`, `daphne`, Celery |
| DB | MariaDB / MySQL (`django.db.backends.mysql`, `mysqlclient`) |
| Cache / broker | Redis (Channels layer + Celery) |
| Realtime | WebSockets: `/ws/floor/`, `/ws/line/<id>/`, `/ws/camera/` |
| Frontend | Vite, React 18, Tailwind, React Query, Zustand, React Flow, ECharts, `@dnd-kit` |
| Camera ML | `camera_service/` (OpenCV + DeepFace; optional heavy deps) |

## Repository layout

- `backend/` — project `core`, apps `floors`, `employees`, `attendance`, `reports`, `websocket`
- `frontend/` — SPA with sidebar, login, dashboards, reports, station setup
- `camera_service/` — `CameraDetector` worker posting to `/api/camera/alert/`

## Quick start (SQLite, no MariaDB)

For schema/API work without Docker:

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export USE_SQLITE=True
export SECRET_KEY=dev
python manage.py migrate
python manage.py seed_floor_layout
python manage.py seed_sample_employees
python manage.py seed_demo_production
python manage.py createsuperuser
python manage.py runserver
```

JWT: `POST /api/auth/token/` with Django **username/password** (superuser).  
Health (no auth): `GET /api/health/`

## Quick start (Docker: MariaDB + Redis + API + Celery + Beat + Vite)

```bash
cp .env.example .env
docker compose up --build
```

- API: `http://localhost:8000`
- Vite (proxied API/WebSocket): `http://localhost:5173`
- MariaDB: `localhost:3306` (see compose env)

Services: `db` (MariaDB), `redis`, `backend` (Daphne), `celery`, `celery-beat` (30s floor broadcast), `frontend`.

## Key HTTP endpoints

| Area | Method | Path |
| --- | --- | --- |
| Dashboard | GET | `/api/floors/dashboard/` |
| Floor map | GET | `/api/floors/map/` |
| Operations list | GET | `/api/floors/operations/` |
| Lines | GET | `/api/floors/lines/` |
| Line stations | GET | `/api/floors/lines/{id}/stations/` |
| Bulk update | POST | `/api/floors/lines/{id}/stations/bulk/` |
| Apply template | POST | `/api/floors/lines/{id}/apply-template/` |
| Stations | GET/PATCH | `/api/floors/stations/` (filter `?line=`) |
| Layout templates | GET/POST/DELETE | `/api/floors/layout-templates/` |
| Finishing processes | GET | `/api/floors/finishing-processes/` (table `finishing_process`) |
| Finishing dashboard | GET | `/api/floors/finishing-dashboard/?floor_id=&line_id=` (`floors_floor` + `floors_line` + `finishing_process`) |
| Floors list | GET | `/api/floors/floors/` |
| Camera alert | POST | `/api/camera/alert/` |
| Camera status | GET | `/api/camera/status/` |
| Reports | GET | `/api/reports/daily/`, `hourly/`, `efficiency/`, `mismatch/` |
| Export | GET | `/api/reports/export/daily.xlsx`, `daily.pdf` |

## WebSockets

- **Floor**: KPI snapshot on connect + Celery beat every **30s** (`core.tasks.broadcast_floor_dashboard`).
- **Line**: snapshot on connect + pushed line payloads from the same task.
- **Camera**: mismatch payloads from `POST /api/camera/alert/`.

## Frontend

1. Open `http://localhost:5173`, sign in with Django user credentials.
2. **Floor Dashboard** — KPI cards, line grid, live socket updates.
3. **Line Diagram** — React Flow map; click a line → station grid.
4. **Station View** — 50 cards, modal with hourly ECharts.
5. **Station Setup** — drag-and-drop reorder (`@dnd-kit`), bulk save, templates.
6. **Camera Monitor** — alerts + optional sound.
7. **Reports** — daily/hourly/efficiency/mismatch + Excel/PDF export.

## Camera worker

Install `camera_service/requirements.txt` in a dedicated environment. Configure `api_base` and JWT, then run `CameraDetector` (see `camera_service/detector.py`).

## Rules implemented

- DRF serializers + APIViews / viewsets with JWT (except health).
- React function components, hooks, React Query, Zustand, Tailwind design tokens (`#F0F2F7`, cards, sidebar `#1E293B`).
- Loading skeletons on heavy pages, error boundary in `main.jsx`.
- Structured Django logging in `core/settings.py`.
