# 🔑 Serwer Licencji i Generator Kodów VoIP (PHP)
**Szkoła Podstawowa w Rolach** • **Autor: Bartosz Miazek**

---

## 🚀 Jak to działa (Wygodny model Voucherów):

1. **Wchodzisz do panelu PHP w przeglądarce:**  
   Otwierasz swój serwer: `https://twoj-serwer.pl/licencje/index.php`  
   *(Hasło administratora: `admin123` – możesz zmienić w `config.php`)*

2. **Generujesz kody jednym kliknięciem:**  
   - Klikasz np. `+ Wygeneruj 16 kodów (dla całej sali)`
   - W panelu pojawiają się kody licencji (np. `ROLE-A8F2-3C91`, `ROLE-7K4M-9P2X`, itd.) ze statusem **🟢 Wolny (do użycia)**.

3. **Wpisujesz kod w aplikacji (na serwerze lub u ucznia):**  
   - W aplikacji wpisujesz wygenerowany kod (np. `ROLE-A8F2-3C91`) i klikasz **Aktywuj**.
   - Aplikacja łączy się z Twoim serwerem PHP:
     - Kod automatycznie **przypisuje się do tego konkretnego komputera** (`Hardware ID`).
     - W panelu PHP status kodu natychmiast zmienia się na: **🔵 Przypisany do PC (SPR-XXXX-XXXX)**.
     - Aplikacja zostaje trwale odblokowana.

4. **🛡️ Ochrona przed kopiowaniem:**  
   - Jeśli ktoś skopiuje program na inny komputer i spróbuje użyć tego samego kodu, serwer PHP odrzuci aktywację:  
     `"Ten kod został już aktywowany na innym komputerze! Kopiowanie na inne stanowiska jest zablokowane."`
   - Jeśli ktoś skopiuje pliki licencji na inny komputer, lokalna weryfikacja sprzętowa natychmiast zablokuje program.

5. **🔄 Wymiana komputera w szkole:**  
   - Jeśli szkoła wymieni komputer na nowy, w panelu PHP przy danym kodzie klikasz **Odepnij PC** i możesz ponownie użyć tego kodu na nowej maszynie.
