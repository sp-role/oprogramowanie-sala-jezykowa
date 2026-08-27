# System VoIP dla Pracowni (Tauri v2 + Rust)

Lokalny system komunikacji głosowej przeznaczony dla pracowni szkolnych i sal komputerowych. System działa w obrębie sieci LAN bez konieczności konfiguracji zewnętrznych serwerów w chmurze.

---

## 📂 Zawartość projektu

1. **`voip-server` (Panel Nauczyciela)**:
   - Zarządzanie pokojami / grupami roboczymi (przeciąganie metodą drag & drop).
   - Odsłuch wybranego pokoju z równoległym miksowaniem wielu rozmówców naraz.
   - Automatyczne wykrywanie rozłączeń i timeout nieaktywnych komputerów.
   - Nadawanie ogłoszeń do wszystkich uczestników jednocześnie (Broadcast Push-to-Talk).
   - Podgląd aktywności mówiących (wizualny wskaźnik mowy) oraz zgłoszeń o pomoc (podniesiona ręka).
   - Statystyki sieciowe na żywo (przepustowość Mbps, liczba połączonych uczniów).
   - Konfiguracja reguł Zapory Windows (Windows Defender Firewall) bezpośrednio z poziomu aplikacji (wymaga uprawnień administratora).

2. **`voip-client` (Klient Ucznia)**:
   - Automatyczne wykrywanie serwera w sieci lokalnej (standard mDNS / Zeroconf z fallbackiem na UDP Broadcast).
   - Inteligentna detekcja mowy (VAD / bramka szumów): transmisja pakietów audio następuje tylko w trakcie mówienia (oszczędność ~90% pasma i brak szumów tła).
   - Niskonarzutowy sygnał keepalive / heartbeat co 2 sekundy utrzymujący sesję ucznia.
   - Płynne, równoległe miksowanie audio wielu uczniów w pokoju roboczym.
   - Możliwość ustawienia własnej nazwy wyświetlanej.
   - Przycisk zgłoszenia się ("Potrzebuję pomocy"), wyróżniający ucznia na tablicy nauczyciela.

---

## 🛠️ Wymagania wstępne

- **System operacyjny**: Windows 10 / 11 (zalecany) z zainstalowanym WebView2 (wbudowany w nowszych wersjach systemu).
- **Node.js**: Wersja 18+ oraz menedżer pakietów `npm`.
- **Rust & Cargo**: Wersja stabilna 1.75+ ([rustup.rs](https://rustup.rs/)).
- **Visual Studio C++ Build Tools**: Wymagane przez kompilator Rusta na Windowsie.
- **Dostęp do sieci LAN**: Otwarta komunikacja w sieci lokalnej:
  - `5005 UDP` — Strumieniowanie pakietów audio.
  - `5353 UDP` — Multicast DNS (mDNS) automatycznego wykrywania usługi `_voip._udp.local.`.
  - `5006 UDP` — Rozgłaszanie zapasowe (Discovery Fallback) oraz sygnały kontrolne.

---

## 🚀 Uruchomienie w trybie deweloperskim

### 1. Serwer VoIP (`voip-server`)
```bash
cd voip-server
npm install
npm run build:css
npm run tauri dev
```

### 2. Klient VoIP (`voip-client`)
W nowym oknie terminala:
```bash
cd voip-client
npm install
npm run build:css
npm run tauri dev
```

---

## 📦 Budowanie gotowych plików wykonywalnych (.exe / .msi)

Aby zbudować zoptymalizowaną wersję produkcyjną:

```bash
# W folderze voip-server lub voip-client:
npm run tauri build
```

Pliki instalacyjne oraz plik wykonywalny `.exe` znajdziesz w:
`target/release/` (oraz `target/release/bundle/msi/` lub `nsis/`).

---

## 📄 Licencja

Projekt udostępniany jest na warunkach licencji [MIT](LICENSE).
