@echo off
chcp 65001 >nul
rem 규로마 GYUROMA launcher for Windows. Double-click this file.
cd /d "%~dp0"
echo == 규로마 GYUROMA ==
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.
  start https://nodejs.org
  pause
  exit /b 1
)
if exist .git (
  where git >nul 2>nul && (echo 최신 버전 확인 중... / checking for updates... & set GIT_TERMINAL_PROMPT=0& git pull --ff-only)
)
if not exist node_modules (
  echo 처음 실행입니다. 필요한 패키지를 설치합니다 ^(1~2분^)... / First run: installing packages...
)
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo 설치에 실패했습니다 / install failed
  pause
  exit /b 1
)
rem The app runs as a build (rodin-pipeline\dist): much smoother than the dev server.
rem Building takes about a second; if it fails, the dev server is used as before.
echo.
echo 앱을 준비합니다... / Building the app...
set MODE=build
call npm run build:app --workspace rodin-pipeline >"%TEMP%\rodin-pipeline-build.log" 2>&1
if errorlevel 1 (
  set MODE=dev
  type "%TEMP%\rodin-pipeline-build.log"
  echo 빌드에 실패해서 개발 모드로 켭니다 ^(조금 느립니다^). / Build failed; starting the dev server instead.
)
netstat -ano | findstr /R /C:":5173 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo.
  echo 앱이 이미 켜져 있습니다. 브라우저에서 엽니다: http://localhost:5173/
  echo The app is already running; opening it in the browser: http://localhost:5173/
  start http://localhost:5173/
  timeout /t 2 >nul
  exit /b 0
)
echo.
echo 앱을 켭니다. 브라우저가 자동으로 열립니다. 이 창을 닫으면 앱이 꺼집니다.
echo Starting the app; the browser opens automatically. Closing this window stops the app.
echo 설정과 작업은 rodin-pipeline\user-data 폴더에 저장됩니다. / Settings and work are saved in rodin-pipeline\user-data.
echo.
if "%MODE%"=="build" (
  call npm run serve --workspace rodin-pipeline
) else (
  call npm start
)
pause
