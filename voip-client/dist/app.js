function getTauri() {
  return window.__TAURI__
    ? {
        invoke: window.__TAURI__.core?.invoke || window.__TAURI__.invoke,
        listen: window.__TAURI__.event?.listen || window.__TAURI__.listen,
      }
    : null;
}

const AVATARS = [
  { id: 'scholar', emoji: '🎓', label: 'Uczeń' },
  { id: 'fox', emoji: '🦊', label: 'Lis' },
  { id: 'panda', emoji: '🐼', label: 'Panda' },
  { id: 'lion', emoji: '🦁', label: 'Lew' },
  { id: 'cat', emoji: '🐱', label: 'Kot' },
  { id: 'robot', emoji: '🤖', label: 'Robot' },
  { id: 'gamer', emoji: '👾', label: 'Gracz' },
  { id: 'rocket', emoji: '🚀', label: 'Rakieta' },
  { id: 'music', emoji: '🎧', label: 'Muzyk' },
  { id: 'lightning', emoji: '⚡', label: 'Błyskawica' },
  { id: 'artist', emoji: '🎨', label: 'Artysta' },
  { id: 'owl', emoji: '🦉', label: 'Sowa' },
];

let selectedAvatarId = localStorage.getItem('voip_avatar') || 'scholar';
let tempSelectedAvatarId = selectedAvatarId;
let currentHardwareId = '';

function getAvatarEmoji(id) {
  const found = AVATARS.find((a) => a.id === id);
  return found ? found.emoji : '🎓';
}

function getAvatarLabel(id) {
  const found = AVATARS.find((a) => a.id === id);
  return found ? found.label : 'Uczeń';
}

function updateAvatarUI() {
  const emoji = getAvatarEmoji(selectedAvatarId);
  const profileEmoji = document.getElementById('profile-avatar-emoji');
  if (profileEmoji) profileEmoji.innerText = emoji;

  const btnPreview = document.getElementById('btn-avatar-preview');
  if (btnPreview) btnPreview.innerText = emoji;

  const joinEmoji = document.getElementById('join-avatar-emoji');
  if (joinEmoji) joinEmoji.innerText = emoji;
}

function renderAvatarsGrid() {
  const grid = document.getElementById('avatars-grid');
  if (!grid) return;

  grid.innerHTML = AVATARS.map((a) => {
    const isSel = a.id === tempSelectedAvatarId;
    return `
      <button type="button" onclick="selectTempAvatar('${a.id}')"
        class="avatar-option p-2.5 rounded-2xl border flex flex-col items-center justify-center cursor-pointer transition ${
          isSel
            ? 'selected border-[#16a34a] bg-emerald-50 text-[#16a34a] ring-2 ring-emerald-400'
            : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
        }">
        <span class="text-2xl select-none mb-1">${a.emoji}</span>
        <span class="text-[10px] font-bold truncate max-w-full">${a.label}</span>
      </button>
    `;
  }).join('');

  const previewIcon = document.getElementById('modal-preview-icon');
  const previewLabel = document.getElementById('modal-preview-label');
  if (previewIcon) previewIcon.innerText = getAvatarEmoji(tempSelectedAvatarId);
  if (previewLabel) previewLabel.innerText = getAvatarLabel(tempSelectedAvatarId);
}

function openAvatarModal() {
  tempSelectedAvatarId = selectedAvatarId;
  renderAvatarsGrid();
  document.getElementById('avatar-modal')?.classList.remove('hidden');
}

function closeAvatarModal() {
  document.getElementById('avatar-modal')?.classList.add('hidden');
}

function selectTempAvatar(id) {
  tempSelectedAvatarId = id;
  renderAvatarsGrid();
}

function saveAvatarSelection() {
  selectedAvatarId = tempSelectedAvatarId;
  localStorage.setItem('voip_avatar', selectedAvatarId);
  updateAvatarUI();
  closeAvatarModal();

  // Zaktualizuj nazwę na serwerze z nowym awatarem jeśli uczeń jest zalogowany
  const rawName = (localStorage.getItem('voip_username') || '').trim();
  if (rawName && rawName !== 'Uczeń') {
    const tauri = getTauri();
    if (tauri && tauri.invoke) {
      const fullDisplayName = `${getAvatarEmoji(selectedAvatarId)} ${rawName}`;
      tauri.invoke('set_username', { name: fullDisplayName });
    }
  }
}

// -------------------------------------------------------------
// LOGIKA AKTYWACJI I OCHRONY PRZED KOPIOWANIEM
// -------------------------------------------------------------
async function checkActivationStatus() {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) {
    document.getElementById('activation-modal')?.classList.remove('hidden');
    document.getElementById('join-modal')?.classList.add('hidden');
    return false;
  }

  try {
    currentHardwareId = await tauri.invoke('get_hardware_id');
    const hwElem = document.getElementById('client-hw-id');
    if (hwElem) hwElem.innerText = currentHardwareId;

    const isAct = await tauri.invoke('check_activation');
    if (!isAct) {
      document.getElementById('activation-modal')?.classList.remove('hidden');
      document.getElementById('join-modal')?.classList.add('hidden');
      return false;
    } else {
      document.getElementById('activation-modal')?.classList.add('hidden');
      return true;
    }
  } catch (e) {
    console.error('Błąd sprawdzania aktywacji:', e);
    document.getElementById('activation-modal')?.classList.remove('hidden');
    document.getElementById('join-modal')?.classList.add('hidden');
    return false;
  }
}

function handleTitlebarDrag(e) {
  if (e.target.closest('button')) return;
  if (e.button === 0) {
    const tauri = getTauri();
    if (tauri && tauri.invoke) {
      tauri.invoke('window_start_dragging');
    }
  }
}

function windowMinimize() {
  const tauri = getTauri();
  if (tauri && tauri.invoke) tauri.invoke('window_minimize');
}

function windowClose() {
  const tauri = getTauri();
  if (tauri && tauri.invoke) tauri.invoke('window_close');
}

async function copyHardwareId() {
  if (!currentHardwareId) return;
  try {
    await navigator.clipboard.writeText(currentHardwareId);
    const btn = document.getElementById('copy-hw-btn');
    if (btn) {
      const orig = btn.innerText;
      btn.innerText = 'Skopiowano!';
      btn.classList.add('text-emerald-600');
      setTimeout(() => {
        btn.innerText = orig;
        btn.classList.remove('text-emerald-600');
      }, 2000);
    }
  } catch (err) {
    console.error('Błąd kopiowania:', err);
  }
}

async function submitActivation() {
  const input = document.getElementById('activation-code-input');
  const errorMsg = document.getElementById('activation-error-msg');
  const btn = document.getElementById('submit-act-btn');
  const code = (input?.value || '').trim().toUpperCase();

  if (!code) {
    if (errorMsg) {
      errorMsg.innerText = 'Wpisz kod aktywacyjny (np. ROLE-XXXX-XXXX).';
      errorMsg.classList.remove('hidden');
    }
    return;
  }

  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>Weryfikacja kodu...</span>';
  }

  try {
    const res = await tauri.invoke('activate_license', { code });
    if (errorMsg) errorMsg.classList.add('hidden');
    document.getElementById('activation-modal')?.classList.add('hidden');
    initStudentProfile();
  } catch (err) {
    if (errorMsg) {
      errorMsg.innerText = err.message || err || 'Niepoprawny kod aktywacyjny dla tego komputera!';
      errorMsg.classList.remove('hidden');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
        <span>Aktywuj to stanowisko</span>
      `;
    }
  }
}

// -------------------------------------------------------------
// LOGIKA UCZNIA / PROFILU
// -------------------------------------------------------------
function confirmJoin() {
  const input = document.getElementById('join-name-input');
  const rawName = input.value.trim();
  if (rawName.length > 0 && rawName !== 'Uczeń') {
    localStorage.setItem('voip_username', rawName);
    document.getElementById('username-input').value = rawName;
    document.getElementById('display-name').innerText = rawName;
    document.getElementById('join-modal').classList.add('hidden');

    const tauri = getTauri();
    if (tauri && tauri.invoke) {
      const fullDisplayName = `${getAvatarEmoji(selectedAvatarId)} ${rawName}`;
      tauri.invoke('set_username', { name: fullDisplayName });
    }
  } else {
    input.classList.add('ring-2', 'ring-red-500');
    input.focus();
  }
}

function saveUsername() {
  const rawName = document.getElementById('username-input').value.trim();
  if (rawName.length > 0 && rawName !== 'Uczeń') {
    localStorage.setItem('voip_username', rawName);
    document.getElementById('display-name').innerText = rawName;
    const tauri = getTauri();
    if (tauri && tauri.invoke) {
      const fullDisplayName = `${getAvatarEmoji(selectedAvatarId)} ${rawName}`;
      tauri.invoke('set_username', { name: fullDisplayName });
    }
  }
}

function raiseHand() {
  const tauri = getTauri();
  if (tauri && tauri.invoke) tauri.invoke('raise_hand');

  const btn = document.getElementById('raise-hand-btn');
  const originalContent = btn.innerHTML;
  btn.innerHTML = `
    <svg class="w-5 h-5 fill-current animate-bounce" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
    <span class="text-sm font-bold">Zgłoszono do nauczyciela!</span>
  `;
  btn.classList.replace('from-amber-500', 'from-[#16a34a]');
  btn.classList.replace('to-amber-600', 'to-emerald-600');
  btn.classList.replace('shadow-amber-500/20', 'shadow-emerald-500/20');

  setTimeout(() => {
    btn.innerHTML = originalContent;
    btn.classList.replace('from-[#16a34a]', 'from-amber-500');
    btn.classList.replace('to-emerald-600', 'to-amber-600');
    btn.classList.replace('shadow-emerald-500/20', 'shadow-amber-500/20');
  }, 3500);
}

function updateMicState(isSpeaking) {
  const micIconBox = document.getElementById('mic-icon-box');
  const micStatusLabel = document.getElementById('mic-status-label');
  const bars = [
    document.getElementById('bar-1'),
    document.getElementById('bar-2'),
    document.getElementById('bar-3'),
    document.getElementById('bar-4'),
  ];

  if (isSpeaking) {
    micIconBox.className = 'w-8 h-8 rounded-xl bg-[#16a34a] text-white shadow-md shadow-[#16a34a]/30 flex items-center justify-center transition-all duration-200';
    micStatusLabel.innerText = 'Mówisz teraz (Aktywny)';
    micStatusLabel.className = 'text-xs font-bold text-[#16a34a]';

    bars[0].className = 'w-1.5 h-3.5 bg-[#16a34a] rounded-full animate-pulse';
    bars[1].className = 'w-1.5 h-5 bg-[#16a34a] rounded-full animate-pulse delay-75';
    bars[2].className = 'w-1.5 h-4 bg-[#16a34a] rounded-full animate-pulse delay-150';
    bars[3].className = 'w-1.5 h-3 bg-[#16a34a] rounded-full animate-pulse delay-100';
  } else {
    micIconBox.className = 'w-8 h-8 rounded-xl bg-slate-200 text-slate-400 flex items-center justify-center transition-all duration-200';
    micStatusLabel.innerText = 'Czuwanie (VAD)';
    micStatusLabel.className = 'text-xs font-semibold text-slate-500';

    bars[0].className = 'w-1.5 h-2 bg-slate-300 rounded-full transition-all duration-150';
    bars[1].className = 'w-1.5 h-3 bg-slate-300 rounded-full transition-all duration-150';
    bars[2].className = 'w-1.5 h-4 bg-slate-300 rounded-full transition-all duration-150';
    bars[3].className = 'w-1.5 h-2 bg-slate-300 rounded-full transition-all duration-150';
  }
}

function initStudentProfile() {
  updateAvatarUI();
  const savedName = (localStorage.getItem('voip_username') || '').trim();
  const joinModal = document.getElementById('join-modal');
  const joinInput = document.getElementById('join-name-input');

  if (!savedName || savedName === 'Uczeń') {
    joinModal.classList.remove('hidden');
    joinInput.focus();
  } else {
    joinModal.classList.add('hidden');
    document.getElementById('username-input').value = savedName;
    document.getElementById('display-name').innerText = savedName;
    const tauri = getTauri();
    if (tauri && tauri.invoke) {
      const fullDisplayName = `${getAvatarEmoji(selectedAvatarId)} ${savedName}`;
      tauri.invoke('set_username', { name: fullDisplayName });
    }
  }
}

async function initClientListener() {
  const tauri = getTauri();
  if (!tauri || !tauri.listen) {
    setTimeout(initClientListener, 100);
    return;
  }

  const isActivated = await checkActivationStatus();
  if (isActivated) {
    initStudentProfile();
  }

  await tauri.listen('client_status', (event) => {
    const data = event.payload;
    document.getElementById('server-ip').innerText = data.server_ip;
    document.getElementById('group-name').innerText = data.group;

    const badge = document.getElementById('status-badge');
    const statusDot = document.getElementById('status-dot');

    if (data.connected) {
      badge.innerText = 'Połączono';
      badge.className = 'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[#16a34a]/20 text-emerald-300 border border-[#16a34a]/40 shadow-sm';
      statusDot.className = 'absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-[#16a34a] rounded-full border-2 border-[#1e3a5f] shadow-sm';
    } else {
      badge.innerText = data.server_ip.includes('Wpisz') ? 'Brak imienia' : 'Szukanie...';
      badge.className = 'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30';
      statusDot.className = 'absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-amber-500 rounded-full border-2 border-[#1e3a5f] shadow-sm';
    }

    updateMicState(data.is_speaking);
  });
}

// -------------------------------------------------------------
// SYSTEM AKTUALIZACJI APLIKACJI UCZNIA (FTP / HTTP)
// -------------------------------------------------------------
let pendingClientUpdateInfo = null;

async function initClientAppVersion() {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;
  try {
    const version = await tauri.invoke('get_app_version');
    const badge = document.getElementById('client-version-badge');
    const modalV = document.getElementById('update-modal-current-v');
    if (badge) badge.innerText = `v${version}`;
    if (modalV) modalV.innerText = `v${version}`;
  } catch (err) {
    console.error('Błąd pobierania wersji klienta:', err);
  }
}

function openUpdateModal() {
  const modal = document.getElementById('update-modal');
  const input = document.getElementById('update-server-url-input');
  const savedUrl = localStorage.getItem('voip_update_url') || '';
  if (input && !input.value) {
    input.value = savedUrl;
  }
  modal?.classList.remove('hidden');
}

function closeUpdateModal() {
  document.getElementById('update-modal')?.classList.add('hidden');
}

async function checkForUpdates(manual = false) {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;

  const input = document.getElementById('update-server-url-input');
  const updateUrl = (input?.value || '').trim() || localStorage.getItem('voip_update_url');

  if (!updateUrl) {
    if (manual) alert('Wpisz adres URL serwera FTP lub HTTP z aktualizacją (np. http://.../version.json).');
    return;
  }

  localStorage.setItem('voip_update_url', updateUrl);

  const btnCheck = document.getElementById('btn-check-updates');
  const statusBox = document.getElementById('update-status-box');
  const alertBanner = document.getElementById('update-alert-banner');
  const changelogBox = document.getElementById('update-changelog-box');
  const changelogText = document.getElementById('update-changelog-text');
  const btnInstall = document.getElementById('btn-install-update');

  if (btnCheck) {
    btnCheck.disabled = true;
    btnCheck.innerText = 'Sprawdzanie...';
  }

  try {
    const info = await tauri.invoke('check_for_updates', { updateUrl });
    pendingClientUpdateInfo = info;

    if (statusBox) statusBox.classList.remove('hidden');

    if (info.has_update) {
      if (alertBanner) {
        alertBanner.className = 'p-3.5 rounded-2xl border mb-3 bg-emerald-50 border-emerald-300 text-emerald-900 text-left';
        alertBanner.innerHTML = `
          <div class="flex items-center gap-2 font-bold text-xs">
            <span class="w-2.5 h-2.5 rounded-full bg-[#16a34a] animate-ping"></span>
            <span>Dostępna nowa wersja: <b>v${info.latest_version}</b></span>
          </div>
          <div class="text-[11px] text-emerald-700 mt-1">
            Data wydania: ${info.release_date || 'Najnowsza'}
          </div>
        `;
      }

      if (info.changelog && changelogBox && changelogText) {
        changelogText.innerText = info.changelog;
        changelogBox.classList.remove('hidden');
      }

      if (btnInstall) {
        btnInstall.classList.remove('hidden');
        btnInstall.disabled = false;
        btnInstall.innerHTML = `
          <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
          <span>Zaktualizuj do v${info.latest_version}</span>
        `;
      }

      if (!manual) openUpdateModal();
    } else {
      if (alertBanner) {
        alertBanner.className = 'p-3.5 rounded-2xl border mb-3 bg-slate-100 border-slate-300 text-slate-700 text-left';
        alertBanner.innerHTML = `
          <div class="font-bold text-xs flex items-center gap-1.5">
            <svg class="w-4 h-4 text-[#16a34a] fill-current" viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
            <span>Posiadasz najnowszą wersję (v${info.current_version}).</span>
          </div>
        `;
      }
      changelogBox?.classList.add('hidden');
      btnInstall?.classList.add('hidden');
      if (manual) alert('Twoja aplikacja jest aktualna!');
    }
  } catch (err) {
    console.error('Błąd sprawdzania aktualizacji:', err);
    if (statusBox) statusBox.classList.remove('hidden');
    if (alertBanner) {
      alertBanner.className = 'p-3.5 rounded-2xl border mb-3 bg-red-50 border-red-200 text-red-700 text-left';
      alertBanner.innerText = `Błąd: ${err}`;
    }
    if (manual) alert(`Błąd sprawdzania aktualizacji: ${err}`);
  } finally {
    if (btnCheck) {
      btnCheck.disabled = false;
      btnCheck.innerText = 'Sprawdź';
    }
  }
}

async function applyUpdateNow() {
  if (!pendingClientUpdateInfo || !pendingClientUpdateInfo.download_url) {
    alert('Brak adresu URL do pobrania pliku aktualizacji!');
    return;
  }

  const btnInstall = document.getElementById('btn-install-update');
  const btnClose = document.getElementById('btn-close-update');
  const alertBanner = document.getElementById('update-alert-banner');

  if (btnInstall) {
    btnInstall.disabled = true;
    btnInstall.innerHTML = `
      <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="10" stroke-width="4" class="opacity-25"></circle>
        <path fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" class="opacity-75"></path>
      </svg>
      <span>Pobieranie i restart...</span>
    `;
  }
  if (btnClose) btnClose.disabled = true;

  if (alertBanner) {
    alertBanner.className = 'p-3.5 rounded-2xl border mb-3 bg-sky-50 border-sky-300 text-sky-900 text-left';
    alertBanner.innerText = 'Pobieranie nowej wersji programu... Aplikacja zrestartuje się za chwilę automatycznie.';
  }

  try {
    const tauri = getTauri();
    const res = await tauri.invoke('install_update', { downloadUrl: pendingClientUpdateInfo.download_url });
    alert(res);
    setTimeout(() => {
      window.close();
    }, 1500);
  } catch (err) {
    console.error('Błąd instalacji aktualizacji:', err);
    alert(`Błąd instalacji: ${err}`);
    if (btnInstall) {
      btnInstall.disabled = false;
      btnInstall.innerText = 'Spróbuj ponownie';
    }
    if (btnClose) btnClose.disabled = false;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  initClientListener();
  initClientAppVersion();
  // Sprawdź aktualizację po starcie jeśli jest zapisany URL
  setTimeout(() => {
    const savedUrl = localStorage.getItem('voip_update_url');
    if (savedUrl) checkForUpdates(false);
  }, 3500);
});
