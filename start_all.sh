#!/usr/bin/env bash
# Suno AI Adaptive Mastering Platform - one-shot launcher
# Installs deps (first run only), starts backend (FastAPI/uvicorn) and
# frontend (Next.js) in the background, and opens the dashboard in your browser.
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "== [1/4] Backend: Python venv & dependencies =="
cd "$DIR/backend"
if [ ! -d venv ]; then
  python3 -m venv venv
fi
source venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt
deactivate

echo "== [2/4] Frontend: npm dependencies =="
cd "$DIR/frontend"
if [ ! -d node_modules ]; then
  npm install
fi

echo "== [3/4] Starting servers in background =="
cd "$DIR/backend"
source venv/bin/activate
nohup uvicorn main:app --host 0.0.0.0 --port 8000 > "$DIR/backend.log" 2>&1 &
echo $! > "$DIR/backend.pid"
deactivate
echo "  backend  -> http://localhost:8000  (pid $(cat "$DIR/backend.pid"))"

cd "$DIR/frontend"
nohup npm run dev > "$DIR/frontend.log" 2>&1 &
echo $! > "$DIR/frontend.pid"
echo "  frontend -> http://localhost:3000  (pid $(cat "$DIR/frontend.pid"))"

echo "== [4/4] Waiting for frontend to boot, then opening browser =="
for i in $(seq 1 30); do
  if curl -s -o /dev/null "http://localhost:3000"; then
    break
  fi
  sleep 1
done

if command -v open >/dev/null 2>&1; then
  open "http://localhost:3000"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:3000"
fi

echo ""
echo "완료! 대시보드: http://localhost:3000  |  API: http://localhost:8000/docs"
echo "종료하려면: ./stop_all.sh"
