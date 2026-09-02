<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/config.php';

$raw_input = file_get_contents('php://input');
$json = json_decode($raw_input, true);

$action = $_REQUEST['action'] ?? ($json['action'] ?? 'activate');
$code = strtoupper(trim($_REQUEST['code'] ?? ($json['code'] ?? '')));
$hardware_id = strtoupper(trim($_REQUEST['hardware_id'] ?? ($json['hardware_id'] ?? '')));
$computer_name = trim($_REQUEST['computer_name'] ?? ($json['computer_name'] ?? ''));

if ($action === 'activate') {
    if (empty($code) || empty($hardware_id)) {
        http_response_code(400);
        echo json_encode([
            'status' => 'error',
            'message' => 'Wymagany jest kod licencji oraz identyfikator komputera (Hardware ID).'
        ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        exit;
    }

    $licenses = get_all_licenses();

    // Sprawdź czy kod istnieje w bazie wygenerowanych kodów
    if (!isset($licenses[$code])) {
        // Sprawdź czy to może bezpośredni klucz algorytmiczny ACT-XXXX-XXXX
        $expected_direct = "ACT-" . substr(strtoupper(hash('sha256', $hardware_id . SECRET_SALT)), 0, 4) . "-" . substr(strtoupper(hash('sha256', $hardware_id . SECRET_SALT)), 4, 4);
        if ($code === $expected_direct) {
            $token = generate_license_token($code, $hardware_id);
            echo json_encode([
                'status' => 'success',
                'message' => 'Stanowisko pomyślnie aktywowane kodem bezpośrednim!',
                'code' => $code,
                'hardware_id' => $hardware_id,
                'token' => $token,
                'school' => SCHOOL_NAME,
                'author' => AUTHOR_NAME
            ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
            exit;
        }

        http_response_code(400);
        echo json_encode([
            'status' => 'error',
            'message' => 'Nieprawidłowy kod licencji. Sprawdź czy kod został poprawnie wpisany.'
        ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        exit;
    }

    $lic = $licenses[$code];

    // Ochrona przed kopiowaniem: Sprawdź czy kod nie jest już przypisany do innego komputera
    if (!empty($lic['hardware_id']) && $lic['hardware_id'] !== $hardware_id) {
        http_response_code(403);
        echo json_encode([
            'status' => 'error',
            'message' => "Ten kod został już aktywowany na innym komputerze ({$lic['hardware_id']}). Kopiowanie na inne stanowiska jest zablokowane.",
            'activated_on' => $lic['hardware_id'],
            'activated_at' => $lic['activated_at']
        ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        exit;
    }

    // Przypisz licencję do tego komputera
    $licenses[$code]['hardware_id'] = $hardware_id;
    $licenses[$code]['computer_name'] = $computer_name ?: ($licenses[$code]['computer_name'] ?? 'Komputer Pracowni');
    $licenses[$code]['activated_at'] = date('Y-m-d H:i:s');
    $licenses[$code]['ip'] = $_SERVER['REMOTE_ADDR'] ?? '';
    $licenses[$code]['status'] = 'active';

    save_all_licenses($licenses);

    $token = generate_license_token($code, $hardware_id);

    echo json_encode([
        'status' => 'success',
        'message' => 'Stanowisko zostało pomyślnie aktywowane i powiązane z tym komputerem!',
        'code' => $code,
        'hardware_id' => $hardware_id,
        'token' => $token,
        'school' => SCHOOL_NAME,
        'author' => AUTHOR_NAME
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

if ($action === 'check') {
    $licenses = get_all_licenses();
    if (isset($licenses[$code]) && $licenses[$code]['hardware_id'] === $hardware_id) {
        echo json_encode([
            'status' => 'success',
            'active' => true,
            'code' => $code,
            'hardware_id' => $hardware_id
        ], JSON_UNESCAPED_UNICODE);
    } else {
        echo json_encode([
            'status' => 'error',
            'active' => false
        ], JSON_UNESCAPED_UNICODE);
    }
    exit;
}

http_response_code(400);
echo json_encode([
    'status' => 'error',
    'message' => 'Nieznana akcja.'
], JSON_UNESCAPED_UNICODE);
