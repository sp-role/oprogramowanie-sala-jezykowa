<?php
// ============================================================================
// SERWER LICENCYJNY VOIP - SZKOŁA PODSTAWOWA W ROLACH
// Autor: Bartosz Miazek
// ============================================================================

define('SECRET_SALT', 'SP_ROLE_BARTOSZ_MIAZEK_VOIP_2026_SECURE_KEY');
define('ADMIN_PASSWORD', 'admin123'); // Zmień na własne silne hasło
define('SCHOOL_NAME', 'Szkoła Podstawowa w Rolach');
define('AUTHOR_NAME', 'Bartosz Miazek');
define('DB_FILE', __DIR__ . '/licenses.json');

/**
 * Pobiera listę wszystkich licencji z pliku JSON
 */
function get_all_licenses() {
    if (!file_exists(DB_FILE)) {
        file_put_contents(DB_FILE, json_encode([], JSON_PRETTY_PRINT));
        return [];
    }
    $content = file_get_contents(DB_FILE);
    $data = json_decode($content, true);
    return is_array($data) ? $data : [];
}

/**
 * Zapisuje listę licencji do pliku JSON
 */
function save_all_licenses($licenses) {
    file_put_contents(DB_FILE, json_encode($licenses, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

/**
 * Generuje nowy, unikalny kod licencji w formacie ROLE-XXXX-XXXX
 */
function generate_new_code() {
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Bez mylących znaków O, 0, 1, I
    $p1 = '';
    $p2 = '';
    for ($i = 0; $i < 4; $i++) {
        $p1 .= $chars[random_int(0, strlen($chars) - 1)];
        $p2 .= $chars[random_int(0, strlen($chars) - 1)];
    }
    return "ROLE-{$p1}-{$p2}";
}

/**
 * Tworzy kryptograficzny token potwierdzający powiązanie kodu ze sprzętem
 */
function generate_license_token($code, $hardware_id) {
    return strtoupper(hash('sha256', $code . ':' . $hardware_id . ':' . SECRET_SALT));
}
