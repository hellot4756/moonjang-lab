@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js 가 설치되어 있지 않아요.
  echo https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요.
  echo.
  pause
  exit /b 1
)
node server.js
echo.
echo 프로그램이 멈췄어요. 위 내용을 확인해 주세요.
pause
