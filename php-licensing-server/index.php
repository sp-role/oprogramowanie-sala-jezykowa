<?php
session_start();
require_once __DIR__ . '/config.php';

$is_authenticated = empty(ADMIN_PASSWORD) || (isset($_SESSION['logged_in']) && $_SESSION['logged_in'] === true);

$error = '';
$success = '';

if (isset($_POST['action'])) {
    if ($_POST['action'] === 'login') {
        if ($_POST['password'] === ADMIN_PASSWORD) {
            $_SESSION['logged_in'] = true;
            $is_authenticated = true;
        } else {
            $error = 'Nieprawidłowe hasło administratora!';
        }
    } else if ($_POST['action'] === 'logout') {
        session_destroy();
        header('Location: index.php');
        exit;
    } else if ($is_authenticated) {
        $licenses = get_all_licenses();

        if ($_POST['action'] === 'generate_custom') {
            $count = max(1, min(50, intval($_POST['count'] ?? 1)));
            $label_prefix = trim($_POST['label_prefix'] ?? 'Stanowisko');
            $new_codes = [];

            for ($i = 1; $i <= $count; $i++) {
                $code = generate_new_code();
                while (isset($licenses[$code])) {
                    $code = generate_new_code();
                }
                $licenses[$code] = [
                    'label' => $count > 1 ? "{$label_prefix} " . sprintf('%02d', $i) : $label_prefix,
                    'created_at' => date('Y-m-d H:i:s'),
                    'status' => 'unused',
                    'hardware_id' => null,
                    'computer_name' => null,
                    'activated_at' => null,
                    'ip' => null
                ];
                $new_codes[] = $code;
            }

            save_all_licenses($licenses);
            $success = "Wygenerowano {$count} nowych kodów licencyjnych!";
        } else if ($_POST['action'] === 'reset_license') {
            $target_code = strtoupper(trim($_POST['target_code'] ?? ''));
            if (isset($licenses[$target_code])) {
                $licenses[$target_code]['status'] = 'unused';
                $licenses[$target_code]['hardware_id'] = null;
                $licenses[$target_code]['computer_name'] = null;
                $licenses[$target_code]['activated_at'] = null;
                $licenses[$target_code]['ip'] = null;
                save_all_licenses($licenses);
                $success = "Zresetowano powiązanie sprzętowe dla kodu {$target_code} (kod jest znów wolny)!";
            }
        } else if ($_POST['action'] === 'delete_license') {
            $target_code = strtoupper(trim($_POST['target_code'] ?? ''));
            if (isset($licenses[$target_code])) {
                unset($licenses[$target_code]);
                save_all_licenses($licenses);
                $success = "Usunięto kod {$target_code}.";
            }
        }
    }
}

$all_licenses = $is_authenticated ? get_all_licenses() : [];
$total_count = count($all_licenses);
$active_count = count(array_filter($all_licenses, fn($l) => ($l['status'] ?? '') === 'active'));
$unused_count = $total_count - $active_count;
?>
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Panel Licencji VoIP - <?php echo htmlspecialchars(SCHOOL_NAME); ?></title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-950 text-slate-100 font-sans min-h-screen flex flex-col justify-between">

  <!-- GÓRNY PASEK -->
  <header class="bg-slate-900/90 border-b border-slate-800 backdrop-blur px-6 py-4 sticky top-0 z-30 shadow-lg">
    <div class="max-w-6xl mx-auto flex justify-between items-center">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-gradient-to-br from-[#16a34a] to-emerald-600 rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-lg">
          🔑
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-base font-bold text-white leading-tight">Serwer Licencji Pracowni</h1>
            <span class="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">Online</span>
          </div>
          <p class="text-xs text-slate-400 mt-0.5"><b><?php echo htmlspecialchars(SCHOOL_NAME); ?></b> • Autor: <b><?php echo htmlspecialchars(AUTHOR_NAME); ?></b></p>
        </div>
      </div>
      <?php if ($is_authenticated && !empty(ADMIN_PASSWORD)): ?>
        <form method="POST">
          <input type="hidden" name="action" value="logout">
          <button type="submit" class="text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3.5 py-2 rounded-xl transition cursor-pointer">
            Wyloguj
          </button>
        </form>
      <?php endif; ?>
    </div>
  </header>

  <!-- GŁÓWNA ZAWARTOŚĆ -->
  <main class="max-w-6xl mx-auto w-full px-4 py-8 flex-1">
    
    <?php if (!$is_authenticated): ?>
      <!-- EKRAN LOGOWANIA -->
      <div class="max-w-md mx-auto bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl mt-12 text-center">
        <div class="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-2xl mx-auto flex items-center justify-center text-3xl mb-4 shadow-inner">
          🔒
        </div>
        <h2 class="text-xl font-bold text-white mb-1">Panel Generatora Licencji</h2>
        <p class="text-xs text-emerald-400 font-semibold mb-6"><?php echo htmlspecialchars(SCHOOL_NAME); ?></p>

        <?php if ($error): ?>
          <div class="bg-red-500/20 border border-red-500/40 text-red-300 text-xs px-4 py-2.5 rounded-xl mb-4 text-left">
            <?php echo htmlspecialchars($error); ?>
          </div>
        <?php endif; ?>

        <form method="POST" class="space-y-4 text-left">
          <input type="hidden" name="action" value="login">
          <div>
            <label class="block text-xs font-semibold text-slate-400 mb-1.5">Hasło administratora:</label>
            <input type="password" name="password" placeholder="Wpisz hasło..." autofocus required
              class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500 transition">
          </div>
          <button type="submit" class="w-full bg-[#16a34a] hover:bg-[#15803d] active:scale-95 text-white font-bold py-3 rounded-xl shadow-lg shadow-emerald-600/20 text-sm transition cursor-pointer">
            Zaloguj do panelu
          </button>
        </form>
      </div>

    <?php else: ?>
      <!-- ZALOGOWANY PANEL -->
      
      <?php if ($success): ?>
        <div class="bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs px-4 py-3 rounded-2xl mb-6 flex items-center gap-2">
          <span>✓</span>
          <span><?php echo htmlspecialchars($success); ?></span>
        </div>
      <?php endif; ?>

      <?php if ($error): ?>
        <div class="bg-red-500/20 border border-red-500/40 text-red-300 text-xs px-4 py-3 rounded-2xl mb-6 flex items-center gap-2">
          <span>✕</span>
          <span><?php echo htmlspecialchars($error); ?></span>
        </div>
      <?php endif; ?>

      <!-- STATYSTYKI -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
          <div>
            <span class="text-xs font-semibold text-slate-400 block uppercase">Wszystkie kody</span>
            <span class="text-2xl font-black text-white"><?php echo $total_count; ?></span>
          </div>
          <div class="w-12 h-12 bg-slate-800 rounded-xl flex items-center justify-center text-xl">📦</div>
        </div>

        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
          <div>
            <span class="text-xs font-semibold text-emerald-400 block uppercase">Wolne kody do użycia</span>
            <span class="text-2xl font-black text-emerald-400"><?php echo $unused_count; ?></span>
          </div>
          <div class="w-12 h-12 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl flex items-center justify-center text-xl">🟢</div>
        </div>

        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
          <div>
            <span class="text-xs font-semibold text-sky-400 block uppercase">Aktywne stanowiska (PC)</span>
            <span class="text-2xl font-black text-sky-400"><?php echo $active_count; ?></span>
          </div>
          <div class="w-12 h-12 bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded-xl flex items-center justify-center text-xl">💻</div>
        </div>
      </div>

      <!-- KAFEL GENERATORA KODÓW -->
      <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl mb-8">
        <h2 class="text-base font-bold text-white mb-1 flex items-center gap-2">
          <span>⚡ Szybkie generowanie kodów licencji</span>
        </h2>
        <p class="text-xs text-slate-400 mb-5">
          Wygenerowane kody możesz przekazać uczniom lub wpisać na stanowiskach w pracowni. Każdy kod automatycznie przypisze się do komputera przy pierwszym wpisaniu.
        </p>

        <div class="flex flex-wrap gap-3 items-center">
          <form method="POST" class="inline">
            <input type="hidden" name="action" value="generate_custom">
            <input type="hidden" name="count" value="1">
            <input type="hidden" name="label_prefix" value="Stanowisko">
            <button type="submit" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition cursor-pointer shadow-md flex items-center gap-1.5">
              <span>+ Wygeneruj 1 kod</span>
            </button>
          </form>

          <form method="POST" class="inline">
            <input type="hidden" name="action" value="generate_custom">
            <input type="hidden" name="count" value="10">
            <input type="hidden" name="label_prefix" value="Uczeń">
            <button type="submit" class="bg-[#1e3a5f] hover:bg-[#284c7a] text-white font-bold px-4 py-2.5 rounded-xl text-xs transition cursor-pointer shadow-md flex items-center gap-1.5">
              <span>+ Wygeneruj 10 kodów (dla uczniów)</span>
            </button>
          </form>

          <form method="POST" class="inline">
            <input type="hidden" name="action" value="generate_custom">
            <input type="hidden" name="count" value="16">
            <input type="hidden" name="label_prefix" value="Sala SP Role">
            <button type="submit" class="bg-purple-600 hover:bg-purple-500 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition cursor-pointer shadow-md flex items-center gap-1.5">
              <span>+ Wygeneruj 16 kodów (dla całej sali)</span>
            </button>
          </form>
        </div>
      </div>

      <!-- TABELA KODÓW I PRZYPISANYCH MASZYN -->
      <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl overflow-hidden">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-base font-bold text-white flex items-center gap-2">
            <span>📋 Lista licencji i stanowisk</span>
          </h2>
          <span class="text-xs text-slate-400">Łącznie: <?php echo count($all_licenses); ?></span>
        </div>

        <?php if (empty($all_licenses)): ?>
          <div class="text-center py-12 text-slate-500 border border-dashed border-slate-800 rounded-2xl">
            <p class="text-sm font-semibold">Brak wygenerowanych kodów.</p>
            <p class="text-xs mt-1">Użyj przycisków powyżej, aby wygenerować pierwsze kody dla pracowni.</p>
          </div>
        <?php else: ?>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-xs">
              <thead>
                <tr class="border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                  <th class="py-3 px-3">Etykieta</th>
                  <th class="py-3 px-3">Kod licencji</th>
                  <th class="py-3 px-3">Status</th>
                  <th class="py-3 px-3">Przypisany komputer (Hardware ID)</th>
                  <th class="py-3 px-3">Data aktywacji</th>
                  <th class="py-3 px-3 text-right">Akcje</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60 font-mono">
                <?php foreach (array_reverse($all_licenses, true) as $code => $lic): 
                  $is_active = ($lic['status'] ?? '') === 'active';
                ?>
                  <tr class="hover:bg-slate-800/40 transition">
                    <td class="py-3 px-3 font-sans font-semibold text-slate-300">
                      <?php echo htmlspecialchars($lic['label'] ?? 'Stanowisko'); ?>
                    </td>
                    <td class="py-3 px-3 font-bold text-sm text-emerald-300">
                      <div class="flex items-center gap-2">
                        <span><?php echo htmlspecialchars($code); ?></span>
                        <button type="button" onclick="navigator.clipboard.writeText('<?php echo $code; ?>'); alert('Skopiowano kod: <?php echo $code; ?>');" class="text-slate-400 hover:text-white" title="Kopiuj kod">📋</button>
                      </div>
                    </td>
                    <td class="py-3 px-3">
                      <?php if ($is_active): ?>
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                          <span class="w-1.5 h-1.5 rounded-full bg-sky-400"></span> Przypisany do PC
                        </span>
                      <?php else: ?>
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Wolny (do użycia)
                        </span>
                      <?php endif; ?>
                    </td>
                    <td class="py-3 px-3">
                      <?php if ($is_active && !empty($lic['hardware_id'])): ?>
                        <span class="text-slate-200 font-bold"><?php echo htmlspecialchars($lic['hardware_id']); ?></span>
                        <span class="text-slate-500 text-[11px] block font-sans"><?php echo htmlspecialchars($lic['computer_name'] ?? ''); ?> (IP: <?php echo htmlspecialchars($lic['ip'] ?? ''); ?>)</span>
                      <?php else: ?>
                        <span class="text-slate-600 font-sans italic">Oczekuje na wpisanie...</span>
                      <?php endif; ?>
                    </td>
                    <td class="py-3 px-3 font-sans text-slate-400 text-[11px]">
                      <?php echo htmlspecialchars($lic['activated_at'] ?? '—'); ?>
                    </td>
                    <td class="py-3 px-3 text-right font-sans">
                      <div class="flex items-center justify-end gap-2">
                        <?php if ($is_active): ?>
                          <form method="POST" onsubmit="return confirm('Czy na pewno chcesz odpiąć ten komputer? Kod znów stanie się wolny.');" class="inline">
                            <input type="hidden" name="action" value="reset_license">
                            <input type="hidden" name="target_code" value="<?php echo htmlspecialchars($code); ?>">
                            <button type="submit" class="text-amber-400 hover:text-amber-300 hover:underline text-xs cursor-pointer font-semibold" title="Zresetuj przypisanie do komputera">
                              Odepnij PC
                            </button>
                          </form>
                        <?php endif; ?>

                        <form method="POST" onsubmit="return confirm('Czy na pewno chcesz usunąć ten kod?');" class="inline">
                          <input type="hidden" name="action" value="delete_license">
                          <input type="hidden" name="target_code" value="<?php echo htmlspecialchars($code); ?>">
                          <button type="submit" class="text-red-400 hover:text-red-300 hover:underline text-xs cursor-pointer font-semibold ml-2" title="Usuń kod">
                            Usuń
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                <?php endforeach; ?>
              </tbody>
            </table>
          </div>
        <?php endif; ?>
      </div>

    <?php endif; ?>

  </main>

  <!-- STOPKA -->
  <footer class="bg-slate-900/80 border-t border-slate-800 text-center py-4 text-xs text-slate-500">
    <b><?php echo htmlspecialchars(SCHOOL_NAME); ?></b> • Autor: <b><?php echo htmlspecialchars(AUTHOR_NAME); ?></b> • System Zabezpieczeń VoIP
  </footer>

</body>
</html>
