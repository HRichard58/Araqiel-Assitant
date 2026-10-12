@echo off
setlocal
cd /d "%~dp0"
echo ================================================
echo ARAQIEL - Installation du tunnel distant
 echo ================================================
echo.
echo Cette version utilise Cloudflare Quick Tunnel.
echo Installe cloudflared puis relance Araqiel.
echo.
echo Option 1 - avec winget (si disponible) :
echo   winget install Cloudflare.cloudflared
 echo.
echo Option 2 - telecharger cloudflared depuis la documentation officielle Cloudflare,
echo puis placer cloudflared.exe dans ce dossier, a cote de main.js.
echo.
echo Verification :
if exist "cloudflared.exe" (
  echo [OK] cloudflared.exe trouve dans le dossier Araqiel.
  "cloudflared.exe" --version
) else (
  where cloudflared >nul 2>&1
  if %errorlevel%==0 (
    echo [OK] cloudflared est disponible dans le PATH.
    cloudflared --version
  ) else (
    echo [ERREUR] cloudflared est introuvable.
  )
)
echo.
pause
