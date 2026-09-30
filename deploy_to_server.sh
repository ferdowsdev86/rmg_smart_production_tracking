#!/bin/bash
# Deploy Smart Finishing Floor to 172.16.101.5 (HTTPS board on :9443)
#
#   ./deploy_to_server.sh
#   SFF_SSH_PASS='redhat' ./deploy_to_server.sh
set -euo pipefail

HOST="${SFF_HOST:-172.16.101.5}"
USER="${SFF_SSH_USER:-root}"
PASS="${SFF_SSH_PASS:-redhat}"
REMOTE_DIR="${SFF_REMOTE_DIR:-/opt/smart_finishing_floor}"
PROJECT="$(cd "$(dirname "$0")" && pwd)"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

SSH_OPTS=(-T -o StrictHostKeyChecking=no -o ConnectTimeout=20)
ssh_cmd() { sshpass -p "$PASS" ssh "${SSH_OPTS[@]}" "${USER}@${HOST}" "$@"; }

echo "==> Syncing code → ${USER}@${HOST}:${REMOTE_DIR}"
sshpass -p "$PASS" rsync -az \
  -e "ssh ${SSH_OPTS[*]}" \
  --exclude '.git' \
  --exclude '.venv' \
  --exclude 'backend/.venv' \
  --exclude 'backend/venv' \
  --exclude 'backend/db.sqlite3' \
  --exclude 'frontend/node_modules' \
  --exclude 'frontend/dist' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude '.DS_Store' \
  --exclude '.env' \
  "$PROJECT/backend/" "${USER}@${HOST}:${REMOTE_DIR}/backend/"

sshpass -p "$PASS" rsync -az \
  -e "ssh ${SSH_OPTS[*]}" \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.DS_Store' \
  "$PROJECT/frontend/" "${USER}@${HOST}:${REMOTE_DIR}/frontend/"

sshpass -p "$PASS" scp "${SSH_OPTS[@]}" \
  "$PROJECT/docker-compose.prod.yml" \
  "${USER}@${HOST}:${REMOTE_DIR}/docker-compose.prod.yml"

if [ -d "$PROJECT/mosquitto" ]; then
  sshpass -p "$PASS" rsync -az -e "ssh ${SSH_OPTS[*]}" \
    "$PROJECT/mosquitto/" "${USER}@${HOST}:${REMOTE_DIR}/mosquitto/"
fi
if [ -d "$PROJECT/proxysql" ]; then
  sshpass -p "$PASS" rsync -az -e "ssh ${SSH_OPTS[*]}" \
    "$PROJECT/proxysql/" "${USER}@${HOST}:${REMOTE_DIR}/proxysql/"
fi

echo "==> Ensuring server .env exists"
if ! ssh_cmd "test -f ${REMOTE_DIR}/.env"; then
  sshpass -p "$PASS" scp "${SSH_OPTS[@]}" \
    "$PROJECT/.env.server" "${USER}@${HOST}:${REMOTE_DIR}/.env"
fi

echo "==> Ensure CORS includes https://${HOST}:9443"
ssh_cmd "grep -q '9443' ${REMOTE_DIR}/.env || \
  sed -i 's|^CORS_ALLOWED_ORIGINS=.*|CORS_ALLOWED_ORIGINS=https://${HOST}:9443,http://${HOST}:8080,http://${HOST},http://127.0.0.1:5173,http://localhost:5173|' ${REMOTE_DIR}/.env"

echo "==> Rebuild & restart docker compose prod"
ssh_cmd "cd ${REMOTE_DIR} && docker compose -f docker-compose.prod.yml up --build -d --remove-orphans && docker compose -f docker-compose.prod.yml ps"

echo "==> Done"
echo "    Board : https://${HOST}:9443"
echo "    API   : http://${HOST}:8000  (also https://${HOST}:9443/api/)"
echo "    WS    : wss://${HOST}:9443/ws/sewing-board/"
