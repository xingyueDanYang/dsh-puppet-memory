@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
title Cloud backup (puppet-memory)

rem Locate node.exe: PATH first, then DSH bundled runtime, then default install dir.
set "NODE_EXE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%i"
if not defined NODE_EXE (
  for /d %%d in ("%USERPROFILE%\.dsh\dsh-runtimes\*") do (
    if not defined NODE_EXE if exist "%%d\dependencies\node\bin\node.exe" set "NODE_EXE=%%d\dependencies\node\bin\node.exe"
  )
)
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE (
  echo [ERROR] node.exe not found. Install Node.js or run this on the machine that has DSH.
  pause
  exit /b 1
)

rem Password: read DSH_MEMORY_BACKUP_PASS, or ask once (input hidden, not written to disk).
if not defined DSH_MEMORY_BACKUP_PASS (
  for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$s=Read-Host -AsSecureString 'Backup password'; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"`) do set "DSH_MEMORY_BACKUP_PASS=%%P"
)
if not defined DSH_MEMORY_BACKUP_PASS (
  echo [ERROR] No password. Set DSH_MEMORY_BACKUP_PASS or type it when asked.
  pause
  exit /b 1
)

pushd "%~dp0.."
"%NODE_EXE%" "tools\cloud-backup.mjs" %*
set "RC=%ERRORLEVEL%"
popd

rem Forget the password in this console session.
set "DSH_MEMORY_BACKUP_PASS="
if not "%RC%"=="0" echo [ERROR] backup failed with exit code %RC%
echo.
pause
exit /b %RC%
