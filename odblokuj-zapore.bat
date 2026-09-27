@echo off
chcp 65001 >nul
:: ============================================================================
:: Automatyczna konfiguracja Zapory Windows Defender dla Pracowni VoIP
:: Wymaga uprawnień administratora (skrypt sam wymusza podniesienie uprawnień)
:: ============================================================================

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Wymagane uprawnienia administratora. Uruchamiam okno autoryzacji UAC...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

title VoIP Pracownia - Konfiguracja Zapory Windows Defender
cls
echo ============================================================================
echo   VoIP Pracownia - Automatyczna konfiguracja Zapory Windows Defender
echo ============================================================================
echo.
echo [1/4] Konfigurowanie reguł portów UDP dla audio i wykrywania...

:: 1. Audio UDP 5005
netsh advfirewall firewall delete rule name="VoIP Pracownia Audio" >nul 2>&1
netsh advfirewall firewall add rule name="VoIP Pracownia Audio" dir=in action=allow protocol=UDP localport=5005 profile=any enable=yes >nul
echo   - Port 5005 UDP (Transmisja dźwięku): ZEZWOLONO

:: 2. Discovery UDP 5006
netsh advfirewall firewall delete rule name="VoIP Pracownia Discovery" >nul 2>&1
netsh advfirewall firewall add rule name="VoIP Pracownia Discovery" dir=in action=allow protocol=UDP localport=5006 profile=any enable=yes >nul
echo   - Port 5006 UDP (Wykrywanie serwera): ZEZWOLONO

:: 3. mDNS UDP 5353
netsh advfirewall firewall delete rule name="VoIP Pracownia mDNS" >nul 2>&1
netsh advfirewall firewall add rule name="VoIP Pracownia mDNS" dir=in action=allow protocol=UDP localport=5353 profile=any enable=yes >nul
echo   - Port 5353 UDP (Multicast DNS Zeroconf): ZEZWOLONO

echo.
echo [2/4] Zezwalanie na odpowiedzi na Ping (ICMPv4)...
netsh advfirewall firewall delete rule name="VoIP Pracownia Ping ICMPv4" >nul 2>&1
netsh advfirewall firewall add rule name="VoIP Pracownia Ping ICMPv4" dir=in action=allow protocol=icmpv4:8,any profile=any enable=yes >nul
echo   - Ping (ICMPv4 Echo): ZEZWOLONO

echo.
echo [3/4] Zezwalanie na ruch dla plików wykonywalnych aplikacji...
if exist "%~dp0target\release\voip-server.exe" (
    netsh advfirewall firewall delete rule name="VoIP Serwer Release" >nul 2>&1
    netsh advfirewall firewall add rule name="VoIP Serwer Release" dir=in action=allow program="%~dp0target\release\voip-server.exe" profile=any enable=yes >nul
    echo   - voip-server.exe (release): ZEZWOLONO
)
if exist "%~dp0voip-server.exe" (
    netsh advfirewall firewall delete rule name="VoIP Serwer Portable" >nul 2>&1
    netsh advfirewall firewall add rule name="VoIP Serwer Portable" dir=in action=allow program="%~dp0voip-server.exe" profile=any enable=yes >nul
    echo   - voip-server.exe (portable): ZEZWOLONO
)
if exist "%~dp0target\release\voip-client.exe" (
    netsh advfirewall firewall delete rule name="VoIP Klient Release" >nul 2>&1
    netsh advfirewall firewall add rule name="VoIP Klient Release" dir=in action=allow program="%~dp0target\release\voip-client.exe" profile=any enable=yes >nul
    echo   - voip-client.exe (release): ZEZWOLONO
)
if exist "%~dp0voip-client.exe" (
    netsh advfirewall firewall delete rule name="VoIP Klient Portable" >nul 2>&1
    netsh advfirewall firewall add rule name="VoIP Klient Portable" dir=in action=allow program="%~dp0voip-client.exe" profile=any enable=yes >nul
    echo   - voip-client.exe (portable): ZEZWOLONO
)
netsh advfirewall firewall delete rule name="VoIP Klient ProgramFiles" >nul 2>&1
netsh advfirewall firewall add rule name="VoIP Klient ProgramFiles" dir=in action=allow program="%ProgramFiles%\VoIP Client\VoIP Client.exe" profile=any enable=yes >nul
netsh advfirewall firewall delete rule name="VoIP Serwer ProgramFiles" >nul 2>&1
netsh advfirewall firewall add rule name="VoIP Serwer ProgramFiles" dir=in action=allow program="%ProgramFiles%\Serwer VoIP\Serwer VoIP.exe" profile=any enable=yes >nul


echo.
echo [4/4] Przełączanie aktywnej sieci na profil Prywatny...
powershell -NoProfile -Command "Get-NetConnectionProfile | Set-NetConnectionProfile -NetworkCategory Private -ErrorAction SilentlyContinue"
echo   - Profil sieci: PRYWATNY (odblokowano odnajdowanie sieci w LAN)

echo.
echo ============================================================================
echo   [SUKCES] Zapora Windows Defender została pomyślnie skonfigurowana!
echo   Możesz teraz bezpiecznie włączyć Zaporę Windows Defender z powrotem.
echo   Komunikacja między serwerem a laptopami będzie działać bez przeszkód.
echo ============================================================================
echo.
pause
