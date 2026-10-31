#!/bin/bash
# 규로마 GYUROMA launcher for macOS. Double-click this file in Finder.
# 맥에서 이 파일을 더블클릭하면 앱이 켜지고 브라우저가 자동으로 열립니다.

export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/current/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

# Find the project folder: next to this file (following a shortcut to it), or the usual clone locations.
SELF="$0"
while [ -L "$SELF" ]; do
  LINK="$(readlink "$SELF")"
  case "$LINK" in /*) SELF="$LINK" ;; *) SELF="$(dirname "$SELF")/$LINK" ;; esac
done
DIR="$(cd "$(dirname "$SELF")" && pwd)"
for candidate in "$DIR" "$HOME/gyuroma" "$HOME/Desktop/gyuroma" "$HOME/Documents/gyuroma"; do
  if [ -f "$candidate/package.json" ] && [ -d "$candidate/rodin-pipeline" ]; then
    DIR="$candidate"
    break
  fi
done
cd "$DIR" || exit 1

echo "== 규로마 GYUROMA =="
echo "폴더 / folder: $DIR"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요."
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org and run this again."
  open "https://nodejs.org"
  read -n 1 -s -r -p "아무 키나 누르면 닫힙니다 / press any key to close"
  exit 1
fi

# Pull the latest version when this folder is a git checkout (harmless if offline).
# The repository is private: without a saved login, skip rather than stop and ask for one.
if [ -d .git ] && command -v git >/dev/null 2>&1; then
  echo "최신 버전 확인 중… / checking for updates…"
  GIT_TERMINAL_PROMPT=0 git pull --ff-only 2>/dev/null || echo "(업데이트를 건너뜁니다 / update skipped)"
fi

if [ ! -d node_modules ]; then
  echo
  echo "처음 실행입니다. 필요한 패키지를 설치합니다 (1~2분)… / First run: installing packages (1–2 min)…"
fi
npm install --no-audit --no-fund || {
  echo "설치에 실패했습니다 / install failed"
  read -n 1 -s -r -p "아무 키나 누르면 닫힙니다 / press any key to close"
  exit 1
}

# The app runs as a build (rodin-pipeline/dist): much smoother than the dev server on a
# million-face model. Building takes about a second, so it is redone on every start and
# always matches the code. If the build fails, the dev server is used as before.
echo
echo "앱을 준비합니다… / Building the app…"
BUILD_LOG="${TMPDIR:-/tmp}/rodin-pipeline-build.log"
if npm run build:app --workspace rodin-pipeline >"$BUILD_LOG" 2>&1; then
  MODE=build
else
  MODE=dev
  tail -n 15 "$BUILD_LOG"
  echo "빌드에 실패해서 개발 모드로 켭니다 (조금 느립니다). / Build failed; starting the dev server instead."
fi

# Already running (e.g. an earlier window is still open)? Just open the browser there.
# The port is fixed so the browser address (and everything saved for it) never changes.
if lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  OURS=$(curl -s --max-time 3 http://localhost:5173/__rodin/ping)
  KIND=$(curl -s -o /dev/null --max-time 3 -w "%{content_type}" http://localhost:5173/@vite/client)
  # When the server started (none from servers older than this check), against the newest
  # server code: an update to the server itself (say, the local Claude) needs a restart.
  STARTED=$(curl -s -D - -o /dev/null --max-time 3 http://localhost:5173/__rodin/ping | tr -d '\r' | awk -F': ' 'tolower($1)=="x-rodin-started"{print $2}')
  NEWEST=$(stat -f %m rodin-pipeline/vite.user-data.mjs rodin-pipeline/vite.ai.mjs rodin-pipeline/vite.config.js 2>/dev/null | sort -n | tail -1)
  STALE=no
  if [ "$OURS" = ok ] && { [ -z "$STARTED" ] || [ "${NEWEST:-0}" -gt "$STARTED" ]; }; then STALE=yes; fi
  if [ "$MODE" = build ] && [ "$OURS" = ok ] && { [[ "$KIND" == *javascript* ]] || [ "$STALE" = yes ]; }; then
    # Our own dev server from the old launcher, or a server older than its code: start it again.
    echo
    echo "앱 서버를 새 버전으로 다시 켭니다. 열려 있는 앱 탭은 새로고침(⌘R)해 주세요."
    echo "Restarting the app server with the new version. Reload the open app tab (⌘R)."
    kill $(lsof -tiTCP:5173 -sTCP:LISTEN) 2>/dev/null
    for _ in $(seq 1 25); do
      lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1 || break
      sleep 0.2
    done
  else
    echo
    if [ "$OURS" != ok ]; then
      echo "5173 포트를 다른 프로그램이 쓰고 있습니다. 그 프로그램을 끈 뒤 다시 실행하세요."
      echo "Another program is using port 5173. Close it and run this again."
      read -n 1 -s -r -p "아무 키나 누르면 닫힙니다 / press any key to close"
      exit 1
    fi
    echo "앱이 이미 켜져 있습니다. 브라우저에서 엽니다: http://localhost:5173/"
    echo "The app is already running; opening it in the browser: http://localhost:5173/"
    open "http://localhost:5173/"
    sleep 2
    exit 0
  fi
fi

echo
echo "앱을 켭니다. 브라우저가 자동으로 열립니다 (안 열리면 http://localhost:5173/ 로 접속)."
echo "Starting the app; the browser opens automatically (or go to http://localhost:5173/)."
echo "설정과 작업은 rodin-pipeline/user-data 폴더에 저장됩니다. / Settings and work are saved in rodin-pipeline/user-data."
echo "이 창을 닫으면 앱이 꺼집니다. / Closing this window stops the app."
echo
if [ "$MODE" = build ]; then
  npm run serve --workspace rodin-pipeline
else
  npm start
fi
