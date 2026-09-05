function getTauri() {
  return window.__TAURI__
    ? {
        invoke: window.__TAURI__.core?.invoke || window.__TAURI__.invoke,
        listen: window.__TAURI__.event?.listen || window.__TAURI__.listen,
      }
    : null;
}

// Przechwytywanie błędów JavaScript do Sentry
window.addEventListener('error', (event) => {
  try {
    const tauri = getTauri();
    if (tauri && tauri.invoke) {
      tauri.invoke('report_frontend_error', {
        message: event.message || 'Błąd JS w widoku klienta',
        stack: event.error ? event.error.stack : `${event.filename || ''}:${event.lineno || 0}:${event.colno || 0}`
      }).catch(() => {});
    }
  } catch (e) {}
});

window.addEventListener('unhandledrejection', (event) => {
  try {
    const tauri = getTauri();
    if (tauri && tauri.invoke) {
      tauri.invoke('report_frontend_error', {
        message: `Unhandled Promise: ${event.reason?.message || event.reason}`,
        stack: event.reason?.stack || null
      }).catch(() => {});
    }
  } catch (e) {}
});


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
  if (!btn) return;
  const originalContent = btn.innerHTML;
  btn.innerHTML = `
    <svg class="w-5 h-5 fill-current animate-bounce" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
    <span class="text-xs font-bold uppercase tracking-wide">Zgłoszono do nauczyciela!</span>
  `;
  btn.classList.replace('bg-[#1e3a5f]', 'bg-[#16a34a]');
  btn.classList.replace('hover:bg-[#152843]', 'hover:bg-[#15803d]');

  setTimeout(() => {
    btn.innerHTML = originalContent;
    btn.classList.replace('bg-[#16a34a]', 'bg-[#1e3a5f]');
    btn.classList.replace('hover:bg-[#15803d]', 'hover:bg-[#152843]');
  }, 3500);
}

function updateMicState(isSpeaking, isMutedByTeacher = false, isMicTest = false) {
  const micIconBox = document.getElementById('mic-icon-box');
  const micStatusLabel = document.getElementById('mic-status-label');
  const broadcastBanner = document.getElementById('teacher-broadcast-banner');
  const bars = [
    document.getElementById('bar-1'),
    document.getElementById('bar-2'),
    document.getElementById('bar-3'),
    document.getElementById('bar-4'),
  ];

  if (isMutedByTeacher) {
    if (broadcastBanner) broadcastBanner.classList.remove('hidden');
    if (micIconBox) micIconBox.className = 'w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center transition-all duration-200 shadow-sm';
    if (micStatusLabel) {
      micStatusLabel.innerText = 'Wyciszony (Ogłoszenie)';
      micStatusLabel.className = 'text-xs font-bold text-amber-700';
    }
    bars.forEach((b) => b && (b.className = 'w-1 h-2 bg-amber-300 rounded-full'));
    return;
  }

  if (broadcastBanner) broadcastBanner.classList.add('hidden');

  if (isMicTest) {
    if (micIconBox) micIconBox.className = 'w-9 h-9 rounded-xl bg-purple-600 text-white flex items-center justify-center transition-all duration-200 shadow-sm';
    if (micStatusLabel) {
      micStatusLabel.innerText = 'Test mikrofonu (Odsłuch)';
      micStatusLabel.className = 'text-xs font-bold text-purple-700';
    }
    if (bars[0]) bars[0].className = 'w-1 h-3.5 bg-purple-500 rounded-full animate-pulse';
    if (bars[1]) bars[1].className = 'w-1 h-5 bg-purple-500 rounded-full animate-pulse delay-75';
    if (bars[2]) bars[2].className = 'w-1 h-4 bg-purple-500 rounded-full animate-pulse delay-150';
    if (bars[3]) bars[3].className = 'w-1 h-3 bg-purple-500 rounded-full animate-pulse delay-100';
    return;
  }

  if (isSpeaking) {
    if (micIconBox) micIconBox.className = 'w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center transition-all duration-200 shadow-sm';
    if (micStatusLabel) {
      micStatusLabel.innerText = 'Mówisz teraz (Aktywny)';
      micStatusLabel.className = 'text-xs font-bold text-emerald-700';
    }
    if (bars[0]) bars[0].className = 'w-1 h-3.5 bg-emerald-500 rounded-full animate-pulse';
    if (bars[1]) bars[1].className = 'w-1 h-5 bg-emerald-500 rounded-full animate-pulse delay-75';
    if (bars[2]) bars[2].className = 'w-1 h-4 bg-emerald-500 rounded-full animate-pulse delay-150';
    if (bars[3]) bars[3].className = 'w-1 h-3 bg-emerald-500 rounded-full animate-pulse delay-100';
  } else {
    if (micIconBox) micIconBox.className = 'w-9 h-9 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center transition-all duration-200';
    if (micStatusLabel) {
      micStatusLabel.innerText = 'Czuwanie (VAD)';
      micStatusLabel.className = 'text-xs font-bold text-slate-700';
    }
    if (bars[0]) bars[0].className = 'w-1 h-2 bg-slate-300 rounded-full transition-all duration-150';
    if (bars[1]) bars[1].className = 'w-1 h-3 bg-slate-300 rounded-full transition-all duration-150';
    if (bars[2]) bars[2].className = 'w-1 h-4 bg-slate-300 rounded-full transition-all duration-150';
    if (bars[3]) bars[3].className = 'w-1 h-2 bg-slate-300 rounded-full transition-all duration-150';
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

let lastAssignedGroup = null;

function applyClientStatus(data) {
  if (!data) return;
  const ipElem = document.getElementById('server-ip');
  if (ipElem) ipElem.innerText = data.server_ip;
  const groupElem = document.getElementById('group-name');
  if (groupElem && data.group) {
    const isRoom = data.group !== 'Poczekalnia' && data.group !== 'Brak' && data.group !== 'Zablokowany';
    groupElem.innerText = isRoom ? data.group : 'Poczekalnia';

    const roomCard = document.getElementById('room-card');
    const roomBadge = document.getElementById('room-badge');
    if (roomBadge) {
      if (isRoom) {
        roomBadge.innerText = 'Aktywny pokój';
        roomBadge.className = 'text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-300';
      } else {
        roomBadge.innerText = 'Poczekalnia';
        roomBadge.className = 'text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500';
      }
    }
    if (roomCard) {
      if (isRoom) {
        roomCard.className = 'bg-emerald-50/40 border border-emerald-300 rounded-2xl p-3.5 shadow-sm flex flex-col justify-between transition-all';
      } else {
        roomCard.className = 'bg-white border border-slate-200/90 rounded-2xl p-3.5 shadow-sm flex flex-col justify-between transition-all';
      }
    }

    if (lastAssignedGroup !== null && lastAssignedGroup !== data.group) {
      if (isRoom) {
        showToast(`Przydzielono Cię do: ${data.group}`, 'success');
        roomCard?.classList.add('ring-2', 'ring-emerald-400');
        setTimeout(() => roomCard?.classList.remove('ring-2', 'ring-emerald-400'), 3500);
      } else {
        showToast('Przeniesiono Cię do Poczekalni', 'info');
      }
    }
    lastAssignedGroup = data.group;
  }

  const badge = document.getElementById('status-badge');
  const statusDot = document.getElementById('status-dot');

  if (data.connected) {
    if (badge) {
      badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span><span>Połączono</span>';
      badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200';
    }
    if (statusDot) statusDot.className = 'absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-white shadow-sm';
  } else {
    const msg = data.server_ip.includes('Wpisz')
      ? 'Brak imienia'
      : data.server_ip.includes('brak odp')
      ? 'Brak odp.'
      : 'Szukanie...';
    if (badge) {
      badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span><span>${msg}</span>`;
      badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200';
    }
    if (statusDot) statusDot.className = 'absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-amber-500 rounded-full border-2 border-white shadow-sm';
  }

  updateMicState(data.is_speaking, data.is_muted_by_teacher, data.is_mic_test_active);

  if (data.mic_level !== undefined) {
    updateSettingsMicMeter(data.mic_level);
  }
}

async function initClientListener() {
  const tauri = getTauri();
  if (!tauri) return;

  const isActivated = await checkActivationStatus();
  if (isActivated) {
    initStudentProfile();
  }

  initSavedAudioSettings();

  const savedServerIp = (localStorage.getItem('voip_manual_server_ip') || '').trim();
  if (savedServerIp && tauri && tauri.invoke) {
    tauri.invoke('set_server_ip', { ip: savedServerIp }).catch(() => {});
  }

  // 1. Zdarzenie czasu rzeczywistego (push)
  if (tauri.listen) {
    tauri.listen('client_status', (event) => {
      applyClientStatus(event.payload);
    }).catch((err) => {
      console.warn('Błąd rejestracji client_status listenera:', err);
    });
  }

  // 2. Cykliczne odpytywanie stanu (pull fallback) - gwarancja odświeżania
  setInterval(async () => {
    const t = getTauri();
    if (t && t.invoke) {
      try {
        const st = await t.invoke('get_client_status');
        if (st) applyClientStatus(st);
      } catch (e) {}
    }
  }, 500);
}

// -------------------------------------------------------------
// USTAWIENIA URZĄDZEŃ AUDIO (MIKROFON / SŁUCHAWKI / TEST)
// -------------------------------------------------------------
let isTestingAudioOutput = false;

function updateSettingsMicMeter(level) {
  const bar = document.getElementById('settings-mic-level-bar');
  const pctLabel = document.getElementById('settings-mic-pct');
  if (!bar) return;
  const pct = Math.min(100, Math.round((level || 0) * 100));
  bar.style.width = `${pct}%`;
  if (pctLabel) pctLabel.innerText = `${pct}%`;
}

let audioDevicePollInterval = null;

async function openSettingsModal() {
  document.getElementById('settings-modal')?.classList.remove('hidden');
  await loadAudioDevices();
  await loadServerSettings();
  const savedVad = localStorage.getItem('voip_vad_threshold');
  if (savedVad !== null) {
    handleVadThresholdChange(savedVad);
  }
  if (audioDevicePollInterval) clearInterval(audioDevicePollInterval);
  audioDevicePollInterval = setInterval(loadAudioDevices, 1500);
}

function closeSettingsModal() {
  document.getElementById('settings-modal')?.classList.add('hidden');
  if (audioDevicePollInterval) {
    clearInterval(audioDevicePollInterval);
    audioDevicePollInterval = null;
  }
  if (isTestingMicLoopback) {
    testMicLoopback();
  }
}

async function loadServerSettings() {
  const input = document.getElementById('settings-server-ip-input');
  if (!input) return;
  const saved = localStorage.getItem('voip_manual_server_ip') || '';
  input.value = saved;
}

async function saveServerIpSetting() {
  const input = document.getElementById('settings-server-ip-input');
  const ip = (input?.value || '').trim();
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;

  try {
    const res = await tauri.invoke('set_server_ip', { ip });
    if (ip && ip.toLowerCase() !== 'auto') {
      localStorage.setItem('voip_manual_server_ip', ip);
    } else {
      localStorage.removeItem('voip_manual_server_ip');
    }
    showToast(res, 'success');
  } catch (err) {
    showToast(`Błąd: ${err.message || err}`, 'error');
  }
}

async function resetServerIpToAuto() {
  const input = document.getElementById('settings-server-ip-input');
  if (input) input.value = '';
  localStorage.removeItem('voip_manual_server_ip');
  const tauri = getTauri();
  if (tauri && tauri.invoke) {
    try {
      const res = await tauri.invoke('set_server_ip', { ip: 'auto' });
      showToast(res, 'info');
    } catch (e) {}
  }
}

async function loadAudioDevices() {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;

  try {
    const devices = await tauri.invoke('get_audio_devices');
    const inputSelect = document.getElementById('settings-input-select');
    const outputSelect = document.getElementById('settings-output-select');
    const micWarning = document.getElementById('settings-no-mic-warning');
    const micTestBtn = document.getElementById('settings-test-mic-btn');
    const micTestText = document.getElementById('settings-test-mic-text');

    const savedInput = localStorage.getItem('voip_input_device') || devices.selected_input || 'default';
    const savedOutput = localStorage.getItem('voip_output_device') || devices.selected_output || 'default';

    if (inputSelect) {
      if (!devices.input_devices || devices.input_devices.length === 0) {
        inputSelect.innerHTML = '<option value="" disabled selected>⚠️ Brak podłączonego mikrofonu</option>';
        inputSelect.dataset.renderedDevices = 'empty';
        if (micWarning) micWarning.classList.remove('hidden');
        if (micTestBtn) {
          micTestBtn.disabled = true;
          micTestBtn.classList.add('opacity-50', 'cursor-not-allowed');
          if (!isTestingMicLoopback && micTestText) {
            micTestText.innerText = 'Podłącz mikrofon, aby przetestować';
          }
        }
      } else {
        if (micWarning) micWarning.classList.add('hidden');
        if (micTestBtn) {
          micTestBtn.disabled = false;
          micTestBtn.classList.remove('opacity-50', 'cursor-not-allowed');
          if (!isTestingMicLoopback && micTestText) {
            micTestText.innerText = 'Testuj mikrofon (Odsłuch w słuchawkach)';
          }
        }

        const serialized = JSON.stringify(devices.input_devices);
        if (inputSelect.dataset.renderedDevices !== serialized) {
          let html = '<option value="default">Domyślny mikrofon systemowy</option>';
          devices.input_devices.forEach((dev) => {
            html += `<option value="${dev}">${dev}</option>`;
          });
          inputSelect.innerHTML = html;
          inputSelect.dataset.renderedDevices = serialized;
          if (devices.input_devices.includes(savedInput) || savedInput === 'default') {
            inputSelect.value = savedInput;
          } else if (devices.input_devices.length > 0) {
            inputSelect.value = devices.input_devices[0];
          }
        }
      }
    }

    if (outputSelect) {
      const serializedOut = JSON.stringify(devices.output_devices || []);
      if (outputSelect.dataset.renderedDevices !== serializedOut) {
        let html = '<option value="default">Domyślne słuchawki systemowe</option>';
        if (devices.output_devices) {
          devices.output_devices.forEach((dev) => {
            html += `<option value="${dev}">${dev}</option>`;
          });
        }
        outputSelect.innerHTML = html;
        outputSelect.dataset.renderedDevices = serializedOut;
        outputSelect.value = savedOutput;
      }
    }
  } catch (err) {
    console.error('Błąd pobierania urządzeń audio:', err);
  }
}

async function handleInputDeviceChange(devName) {
  localStorage.setItem('voip_input_device', devName);
  const tauri = getTauri();
  if (tauri && tauri.invoke) {
    tauri.invoke('set_input_device', { deviceName: devName }).catch(console.error);
  }
}

async function handleOutputDeviceChange(devName) {
  localStorage.setItem('voip_output_device', devName);
  const tauri = getTauri();
  if (tauri && tauri.invoke) {
    tauri.invoke('set_output_device', { deviceName: devName }).catch(console.error);
  }
}

let isTestingMicLoopback = false;
let micTestTimeout = null;

async function testMicLoopback() {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;

  const btn = document.getElementById('settings-test-mic-btn');
  const text = document.getElementById('settings-test-mic-text');

  if (isTestingMicLoopback) {
    isTestingMicLoopback = false;
    if (micTestTimeout) clearTimeout(micTestTimeout);
    try {
      await tauri.invoke('stop_mic_test');
    } catch (e) {}
    if (btn && text) {
      btn.classList.replace('bg-emerald-100', 'bg-slate-50');
      btn.classList.replace('text-emerald-900', 'text-slate-700');
      btn.classList.replace('border-emerald-300', 'border-slate-300');
      text.innerText = 'Testuj mikrofon (Odsłuch w słuchawkach)';
    }
    return;
  }

  isTestingMicLoopback = true;
  if (btn && text) {
    btn.classList.replace('bg-slate-50', 'bg-emerald-100');
    btn.classList.replace('text-slate-700', 'text-emerald-900');
    btn.classList.replace('border-slate-300', 'border-emerald-300');
    text.innerText = '🎤 Mów do mikrofonu (Odsłuch aktywny 5s)...';
  }

  try {
    await tauri.invoke('start_mic_test', { durationSecs: 5.0 });
  } catch (err) {
    console.error('Błąd startu testu mikrofonu:', err);
  }

  let remaining = 5;
  const interval = setInterval(() => {
    remaining--;
    if (remaining > 0 && isTestingMicLoopback && text) {
      text.innerText = `🎤 Mów do mikrofonu (Odsłuch aktywny ${remaining}s)...`;
    } else {
      clearInterval(interval);
    }
  }, 1000);

  micTestTimeout = setTimeout(async () => {
    clearInterval(interval);
    isTestingMicLoopback = false;
    try {
      await tauri.invoke('stop_mic_test');
    } catch (e) {}
    if (btn && text) {
      btn.classList.replace('bg-emerald-100', 'bg-slate-50');
      btn.classList.replace('text-emerald-900', 'text-slate-700');
      btn.classList.replace('border-emerald-300', 'border-slate-300');
      text.innerText = 'Testuj mikrofon (Odsłuch w słuchawkach)';
    }
  }, 5200);
}

async function testAudioOutput() {
  if (isTestingAudioOutput) return;
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;

  const btn = document.getElementById('settings-test-audio-btn');
  const text = document.getElementById('settings-test-audio-text');
  isTestingAudioOutput = true;

  if (btn && text) {
    btn.classList.replace('bg-sky-50', 'bg-emerald-100');
    btn.classList.replace('text-sky-800', 'text-emerald-900');
    btn.classList.replace('border-sky-200', 'border-emerald-300');
    text.innerText = '🎵 Odtwarzanie dźwięku testowego...';
  }

  try {
    await tauri.invoke('play_test_sound');
  } catch (err) {
    console.error('Błąd odtwarzania testu:', err);
  } finally {
    setTimeout(() => {
      isTestingAudioOutput = false;
      if (btn && text) {
        btn.classList.replace('bg-emerald-100', 'bg-sky-50');
        btn.classList.replace('text-emerald-900', 'text-sky-800');
        btn.classList.replace('border-emerald-300', 'border-sky-200');
        text.innerText = 'Odtwórz dźwięk testowy w słuchawkach';
      }
    }, 1200);
  }
}

function handleClientVolumeChange(val) {
  const num = parseInt(val) || 100;
  const pctElem = document.getElementById('client-volume-pct');
  const sliderElem = document.getElementById('client-volume-slider');
  if (pctElem) pctElem.innerText = `${num}%`;
  if (sliderElem) sliderElem.value = num;
  localStorage.setItem('voip_client_volume', num);

  const tauri = getTauri();
  if (tauri && tauri.invoke) {
    tauri.invoke('set_client_volume', { volume: num / 100.0 }).catch(console.error);
  }
}

function handleVadThresholdChange(val) {
  const num = parseInt(val) || 25;
  const labelElem = document.getElementById('settings-vad-pct');
  const sliderElem = document.getElementById('settings-vad-slider');
  if (sliderElem) sliderElem.value = num;

  let labelText = `Średnia (${num})`;
  if (num <= 15) labelText = `Czuła / Szept (${num})`;
  else if (num >= 40) labelText = `Wysoka redukcja (${num})`;

  if (labelElem) labelElem.innerText = labelText;
  localStorage.setItem('voip_vad_threshold', num);

  const tauri = getTauri();
  if (tauri && tauri.invoke) {
    tauri.invoke('set_vad_threshold', { threshold: num / 1000.0 }).catch(console.error);
  }
}

async function initSavedAudioSettings() {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;
  const savedInput = localStorage.getItem('voip_input_device');
  const savedOutput = localStorage.getItem('voip_output_device');
  if (savedInput) {
    tauri.invoke('set_input_device', { deviceName: savedInput }).catch(console.error);
  }
  if (savedOutput) {
    tauri.invoke('set_output_device', { deviceName: savedOutput }).catch(console.error);
  }
  const savedServerIp = localStorage.getItem('voip_manual_server_ip');
  if (savedServerIp) {
    tauri.invoke('set_server_ip', { ip: savedServerIp }).catch(console.error);
  }

  const savedVol = localStorage.getItem('voip_client_volume');
  if (savedVol !== null) {
    handleClientVolumeChange(savedVol);
  }

  const savedVad = localStorage.getItem('voip_vad_threshold');
  if (savedVad !== null) {
    handleVadThresholdChange(savedVad);
  }
}

// -------------------------------------------------------------
// POWIADOMIENIA TOAST DLA KLIENTA
// -------------------------------------------------------------
function showToast(message, type = 'info') {
  let toastContainer = document.getElementById('global-toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'global-toast-container';
    toastContainer.className = 'fixed bottom-4 left-4 right-4 z-50 flex flex-col-reverse gap-2 max-w-xs mx-auto pointer-events-none select-none';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  let bgClass = 'bg-slate-900/95 border-slate-700 text-white';
  let icon = '🚀';

  if (type === 'success') {
    bgClass = 'bg-emerald-950/95 border-emerald-500/60 text-emerald-100 shadow-emerald-950/50';
    icon = '✅';
  } else if (type === 'warning') {
    bgClass = 'bg-amber-950/95 border-amber-500/60 text-amber-100 shadow-amber-950/50';
    icon = '⚠️';
  } else if (type === 'error') {
    bgClass = 'bg-red-950/95 border-red-500/60 text-red-100 shadow-red-950/50';
    icon = '❌';
  } else if (type === 'info') {
    bgClass = 'bg-sky-950/95 border-sky-500/60 text-sky-100 shadow-sky-950/50';
    icon = 'ℹ️';
  }

  toast.className = `flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border shadow-xl backdrop-blur-md text-xs font-semibold transform transition-all duration-300 pointer-events-auto opacity-0 translate-y-3 ${bgClass}`;
  toast.innerHTML = `
    <span class="text-sm flex-shrink-0">${icon}</span>
    <span class="flex-1">${message}</span>
  `;

  toastContainer.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('opacity-0', 'translate-y-3');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-3');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3500);
}

// -------------------------------------------------------------
// SYSTEM AKTUALIZACJI APLIKACJI UCZNIA (OFICJALNY TAURI UPDATER)
// -------------------------------------------------------------
let pendingClientTauriUpdate = null;
let isUpdatingClientApp = false;

async function initClientAppVersion() {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;
  try {
    const version = await tauri.invoke('get_app_version');
    const badge = document.getElementById('client-version-badge');
    if (badge) badge.innerText = `v${version}`;
  } catch (err) {
    console.error('Błąd pobierania wersji klienta:', err);
  }
}

async function checkForAppUpdate(manual = false) {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;

  if (manual) {
    showToast('Sprawdzanie dostępności nowej wersji...', 'info');
  }

  try {
    const res = await tauri.invoke('check_for_updates');
    if (res && res.available) {
      pendingClientTauriUpdate = res;
      showUpdateToast(res.latest_version, res.body);
      showToast(`Dostępna nowa wersja: v${res.latest_version}!`, 'info');
    } else {
      if (manual) {
        const curVer = res ? res.current_version : await tauri.invoke('get_app_version');
        showToast(`Posiadasz najnowszą wersję programu (v${curVer}).`, 'success');
      }
    }
  } catch (err) {
    console.warn('Sprawdzanie aktualizacji w tle:', err);
    if (manual) {
      const curVer = await tauri.invoke('get_app_version').catch(() => '1.0.0');
      showToast(`Aktualna wersja: v${curVer} (Brak połączenia z serwerem aktualizacji GitHub)`, 'warning');
    }
  }
}

function showUpdateToast(version, changelog) {
  const toast = document.getElementById('update-notification-toast');
  const text = document.getElementById('update-toast-text');
  if (text) {
    text.innerText = `Dostępna jest nowa wersja v${version}.${changelog ? ' ' + changelog.slice(0, 80) : ''}`;
  }
  toast?.classList.remove('hidden');
}

function dismissUpdateToast() {
  document.getElementById('update-notification-toast')?.classList.add('hidden');
}

async function applyTauriUpdate() {
  if (isUpdatingClientApp) return;
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;

  const btn = document.getElementById('btn-install-tauri-update');
  isUpdatingClientApp = true;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="10" stroke-width="4" class="opacity-25"></circle>
        <path fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" class="opacity-75"></path>
      </svg>
      <span>Pobieranie i restart...</span>
    `;
  }

  try {
    await tauri.invoke('install_update');
  } catch (err) {
    console.error('Błąd instalacji aktualizacji:', err);
    showToast(`Błąd aktualizacji: ${err}`, 'warning');
    isUpdatingClientApp = false;
    if (btn) {
      btn.disabled = false;
      btn.innerText = 'Spróbuj ponownie';
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  initClientListener();
  initClientAppVersion();
  initSavedAudioSettings();
  // Sprawdź aktualizację automatycznie w tle po 3.5 sekundach od startu
  setTimeout(() => {
    checkForAppUpdate(false);
  }, 3500);
});


