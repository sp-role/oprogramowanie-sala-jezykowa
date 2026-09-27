@echo off
setlocal
chcp 65001 >nul
title Generator Kodów Aktywacyjnych VoIP - Szkoła Podstawowa w Rolach

if exist "%~dp0target\release\keygen.exe" (
    "%~dp0target\release\keygen.exe" %*
    goto :end
)

if exist "%~dp0target\debug\keygen.exe" (
    "%~dp0target\debug\keygen.exe" %*
    goto :end
)

where cargo >nul 2>nul
if %errorlevel% equ 0 (
    cargo run --bin keygen --manifest-path "%~dp0Cargo.toml" --quiet -- %*
    goto :end
)

echo.
echo =======================================================
echo    GENERATOR KODOW AKTYWACYJNYCH OFFLINE - SP ROLE     
echo =======================================================
echo.
set /p "HWID=Wprowadz Hardware ID stanowiska (np. SPR-XXXX-XXXX): "
if "%HWID%"=="" (
    echo Blad: Nie podano Hardware ID.
    goto :end
)

powershell -NoProfile -Command "& { $id = '%HWID%'.Trim().ToUpper(); $s = 'SP_ROLE_BARTOSZ_MIAZEK_VOIP_2026_SECURE_KEY'; $sha = [System.Security.Cryptography.SHA256]::Create(); $bytes = [System.Text.Encoding]::UTF8.GetBytes($id + $s); $hash = $sha.ComputeHash($bytes); $hex = ($hash[0..5] | ForEach-Object { '{0:X2}' -f $_ }) -join ''; $code = 'ROLE-' + $hex.Substring(0,4) + '-' + $hex.Substring(4,4); $alt = 'ACT-' + $hex.Substring(0,4) + '-' + $hex.Substring(4,4); Write-Host ''; Write-Host '-------------------------------------------------------'; Write-Host (' Identyfikator komputera : ' + $id); Write-Host (' Glowny kod aktywacyjny  : ' + $code); Write-Host (' Alternatywny kod        : ' + $alt); Write-Host '-------------------------------------------------------'; Write-Host ''; }"

:end
echo.
pause
