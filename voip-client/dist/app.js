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


const AVATAR_PALETTES = [
  { id: 'blue', label: 'Błękit', bg: 'from-blue-600 to-indigo-700', border: 'border-blue-400', hex: '#2563eb' },
  { id: 'emerald', label: 'Szmaragd', bg: 'from-emerald-600 to-teal-700', border: 'border-emerald-400', hex: '#059669' },
  { id: 'indigo', label: 'Indygo', bg: 'from-indigo-600 to-purple-700', border: 'border-indigo-400', hex: '#4f46e5' },
  { id: 'violet', label: 'Fiolet', bg: 'from-violet-600 to-fuchsia-700', border: 'border-violet-400', hex: '#7c3aed' },
  { id: 'amber', label: 'Bursztyn', bg: 'from-amber-500 to-orange-600', border: 'border-amber-400', hex: '#d97706' },
  { id: 'rose', label: 'Koral', bg: 'from-rose-500 to-pink-600', border: 'border-rose-400', hex: '#e11d48' },
  { id: 'cyan', label: 'Morski', bg: 'from-cyan-600 to-blue-600', border: 'border-cyan-400', hex: '#0891b2' },
  { id: 'slate', label: 'Grafit', bg: 'from-slate-600 to-slate-800', border: 'border-slate-400', hex: '#475569' },
];

let selectedAvatarId = localStorage.getItem('voip_avatar') || 'blue';
let tempSelectedAvatarId = selectedAvatarId;
let currentHardwareId = '';

function getPalette(id) {
  if (!id) return AVATAR_PALETTES[0];
  const found = AVATAR_PALETTES.find((p) => p.id === id);
  if (found) return found;
  const legacyMap = {
    scholar: 'blue', fox: 'amber', panda: 'slate', lion: 'amber',
    cat: 'rose', robot: 'cyan', gamer: 'violet', rocket: 'indigo',
    music: 'emerald', lightning: 'amber', artist: 'rose', owl: 'slate'
  };
  const mappedId = legacyMap[id] || 'blue';
  return AVATAR_PALETTES.find((p) => p.id === mappedId) || AVATAR_PALETTES[0];
}

function getInitials(name) {
  if (!name) return 'U';
  const clean = name.replace(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\p{Emoji})\s*/u, '').trim();
  if (!clean) return 'U';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.substring(0, Math.min(2, clean.length)).toUpperCase();
}

function getDeterministicPalette(name) {
  if (!name) return AVATAR_PALETTES[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % AVATAR_PALETTES.length;
  return AVATAR_PALETTES[idx];
}

function updateAvatarUI() {
  const pal = getPalette(selectedAvatarId);
  const rawName = (localStorage.getItem('voip_username') || 'Uczeń').trim();
  const initials = getInitials(rawName);

  const profileContainer = document.getElementById('profile-avatar-container');
  if (profileContainer) {
    profileContainer.className = `w-full h-full rounded-xl bg-gradient-to-br ${pal.bg} text-white font-bold text-sm flex items-center justify-center border border-white/20 select-none`;
    profileContainer.innerText = initials;
  }

  const btnPreview = document.getElementById('btn-avatar-preview');
  if (btnPreview) {
    btnPreview.className = `w-3.5 h-3.5 rounded-full inline-block bg-gradient-to-br ${pal.bg} border border-white/30`;
    btnPreview.innerText = '';
  }

  const skypeAvatar = document.getElementById('skype-self-avatar-preview');
  if (skypeAvatar) {
    skypeAvatar.className = `w-5 h-5 rounded-md bg-gradient-to-br ${pal.bg} text-white font-bold text-[10px] flex items-center justify-center border border-white/20`;
    skypeAvatar.innerText = initials;
  }

  const joinAvatar = document.getElementById('join-avatar-emoji');
  if (joinAvatar) {
    joinAvatar.className = `w-12 h-12 rounded-xl bg-gradient-to-br ${pal.bg} text-white font-bold text-base flex items-center justify-center border border-white/20 shadow-md select-none`;
    joinAvatar.innerText = initials;
  }
}

function renderAvatarsGrid() {
  const grid = document.getElementById('avatars-grid');
  if (!grid) return;

  const currentName = (document.getElementById('modal-username-input')?.value || localStorage.getItem('voip_username') || 'Uczeń').trim();
  const initials = getInitials(currentName);

  grid.innerHTML = AVATAR_PALETTES.map((p) => {
    const isSel = p.id === tempSelectedAvatarId;
    return `
      <button type="button" onclick="selectTempAvatar('${p.id}')"
        class="p-2 rounded-xl border flex flex-col items-center justify-center gap-1.5 cursor-pointer transition ${
          isSel
            ? 'border-emerald-500 bg-emerald-500/15 ring-2 ring-emerald-400 text-emerald-400'
            : 'border-slate-700 bg-slate-800/80 hover:bg-slate-700/80 text-slate-300'
        }">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br ${p.bg} border border-white/20 flex items-center justify-center text-white text-xs font-bold shadow-sm">
          ${initials}
        </div>
        <span class="text-[10px] font-semibold truncate max-w-full">${p.label}</span>
      </button>
    `;
  }).join('');
}

function openAvatarModal() {
  tempSelectedAvatarId = selectedAvatarId;
  const modalInput = document.getElementById('modal-username-input');
  if (modalInput) {
    modalInput.value = localStorage.getItem('voip_username') || '';
  }
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

  const modalInput = document.getElementById('modal-username-input');
  if (modalInput && modalInput.value.trim()) {
    const newName = modalInput.value.trim();
    localStorage.setItem('voip_username', newName);
    const mainInput = document.getElementById('username-input');
    if (mainInput) mainInput.value = newName;
    const dn = document.getElementById('display-name');
    if (dn) dn.innerText = newName;
    const skypeSelf = document.getElementById('skype-self-name-preview');
    if (skypeSelf) skypeSelf.innerText = newName;
  }

  updateAvatarUI();
  closeAvatarModal();

  const rawName = (localStorage.getItem('voip_username') || '').trim();
  if (rawName && rawName !== 'Uczeń') {
    const tauri = getTauri();
    if (tauri && tauri.invoke) {
      tauri.invoke('set_username', { name: rawName });
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
  if (isJoinedState) {
    document.getElementById('exit-confirm-modal')?.classList.remove('hidden');
    return;
  }
  forceWindowClose();
}

function closeExitConfirmModal() {
  document.getElementById('exit-confirm-modal')?.classList.add('hidden');
}

function minimizeAndCloseExitModal() {
  closeExitConfirmModal();
  windowMinimize();
}

function forceWindowClose() {
  const tauri = getTauri();
  if (tauri && tauri.invoke) {
    tauri.invoke('window_close');
  }
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
// -------------------------------------------------------------
// LOGIKA UCZNIA / PROFILU
// -------------------------------------------------------------
let isJoinedState = false;

function confirmJoinFromLobby() {
  const input = document.getElementById('username-input');
  const rawName = (input?.value || '').trim();
  if (rawName.length > 0 && rawName !== 'Uczeń') {
    localStorage.setItem('voip_username', rawName);
    const displayNameElem = document.getElementById('display-name');
    if (displayNameElem) displayNameElem.innerText = rawName;
    const joinInput = document.getElementById('join-name-input');
    if (joinInput) joinInput.value = rawName;
    document.getElementById('join-modal')?.classList.add('hidden');

    isJoinedState = true;
    const tauri = getTauri();
    if (tauri && tauri.invoke) {
      tauri.invoke('join_lesson', { name: rawName }).catch(console.error);
    }
    const viewLobby = document.getElementById('view-lobby');
    const viewSkype = document.getElementById('view-skype-call');
    if (viewLobby) viewLobby.classList.add('hidden');
    if (viewSkype) viewSkype.classList.remove('hidden');
    showToast(`Dołączono do lekcji jako: ${rawName}`, 'success');
  } else {
    input?.classList.add('ring-2', 'ring-red-500');
    input?.focus();
    showToast('Wpisz swoje imię i nazwisko przed dołączeniem do lekcji', 'warning');
  }
}

function confirmJoin() {
  const input = document.getElementById('join-name-input');
  const rawName = (input?.value || '').trim();
  if (rawName.length > 0 && rawName !== 'Uczeń') {
    const lobbyInput = document.getElementById('username-input');
    if (lobbyInput) lobbyInput.value = rawName;
    confirmJoinFromLobby();
  } else {
    input?.classList.add('ring-2', 'ring-red-500');
    input?.focus();
    showToast('Wpisz swoje imię i nazwisko', 'warning');
  }
}

function saveUsername() {
  const rawName = document.getElementById('username-input')?.value.trim();
  if (rawName && rawName.length > 0 && rawName !== 'Uczeń') {
    localStorage.setItem('voip_username', rawName);
    const dn = document.getElementById('display-name');
    if (dn) dn.innerText = rawName;
    showToast('Zapisano profil ucznia', 'info');
  }
}

let isHandRaised = false;

async function raiseHand() {
  const tauri = getTauri();
  let nextState = !isHandRaised;
  if (tauri && tauri.invoke) {
    try {
      nextState = await tauri.invoke('toggle_raise_hand');
    } catch (e) {
      console.error('Błąd toggle_raise_hand:', e);
    }
  }
  isHandRaised = nextState;

  // Przycisk w doku Skype
  const skypeHandBtn = document.getElementById('skype-raise-hand-btn');
  if (skypeHandBtn) {
    if (isHandRaised) {
      skypeHandBtn.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-amber-500 hover:bg-amber-600 ring-4 ring-amber-400/40 text-white flex items-center justify-center transition shadow-lg shadow-amber-500/30 cursor-pointer animate-pulse';
      skypeHandBtn.title = 'Ręka podniesiona (kliknij, aby odwołać)';
      showToast('Zgłoszono prośbę o pomoc do nauczyciela', 'info');
    } else {
      skypeHandBtn.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition shadow-md cursor-pointer';
      skypeHandBtn.title = 'Poproś nauczyciela o pomoc (Podnieś rękę)';
      showToast('Odwołano prośbę o pomoc', 'info');
    }
  }
}


function handleClientVolumeChange(val) {
  const num = parseInt(val, 10) || 100;
  const skypeVol = document.getElementById('skype-volume-slider');
  const skypePct = document.getElementById('skype-volume-pct');
  if (skypeVol && document.activeElement !== skypeVol) skypeVol.value = num;
  if (skypePct) skypePct.innerText = `${num}%`;

  const tauri = getTauri();
  if (tauri && tauri.invoke) {
    tauri.invoke('set_client_volume', { volume: num / 100.0 }).catch(console.error);
  }
}

function handleVadThresholdChange(val) {
  const num = parseInt(val, 10) || 25;
  const vadPct = document.getElementById('settings-vad-pct');
  if (vadPct) {
    let label = 'Średnia (25)';
    if (num <= 15) label = `Czuła (${num})`;
    else if (num >= 45) label = `Mocna (${num})`;
    else label = `Średnia (${num})`;
    vadPct.innerText = label;
  }
  const slider = document.getElementById('settings-vad-slider');
  if (slider && document.activeElement !== slider) {
    slider.value = num;
  }
  localStorage.setItem('voip_vad_threshold', num);
  const tauri = getTauri();
  if (tauri && tauri.invoke) {
    tauri.invoke('set_vad_threshold', { threshold: num / 1000.0 }).catch(console.error);
  }
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
      micStatusLabel.className = 'text-xs font-bold text-emerald-400';
    }
    if (bars[0]) bars[0].className = 'w-1 h-3.5 bg-emerald-500 rounded-full animate-pulse';
    if (bars[1]) bars[1].className = 'w-1 h-5 bg-emerald-500 rounded-full animate-pulse delay-75';
    if (bars[2]) bars[2].className = 'w-1 h-4 bg-emerald-500 rounded-full animate-pulse delay-150';
    if (bars[3]) bars[3].className = 'w-1 h-3 bg-emerald-500 rounded-full animate-pulse delay-100';
  } else {
    if (micIconBox) micIconBox.className = 'w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 flex items-center justify-center transition-all duration-200';
    if (micStatusLabel) {
      micStatusLabel.innerText = 'Czuwanie (VAD)';
      micStatusLabel.className = 'text-xs font-bold text-sky-200';
    }
    if (bars[0]) bars[0].className = 'w-1 h-2 bg-slate-600 rounded-full transition-all duration-150';
    if (bars[1]) bars[1].className = 'w-1 h-3 bg-slate-600 rounded-full transition-all duration-150';
    if (bars[2]) bars[2].className = 'w-1 h-4 bg-slate-600 rounded-full transition-all duration-150';
    if (bars[3]) bars[3].className = 'w-1 h-2 bg-slate-600 rounded-full transition-all duration-150';
  }
}

function initStudentProfile() {
  updateAvatarUI();
  const savedName = (localStorage.getItem('voip_username') || '').trim();
  const joinModal = document.getElementById('join-modal');
  if (joinModal) joinModal.classList.add('hidden');

  if (savedName && savedName !== 'Uczeń') {
    const input = document.getElementById('username-input');
    if (input) input.value = savedName;
    const dn = document.getElementById('display-name');
    if (dn) dn.innerText = savedName;
    const joinInput = document.getElementById('join-name-input');
    if (joinInput) joinInput.value = savedName;
  }
}

let lastAssignedGroup = null;

function parseUserAvatarAndName(rawName) {
  if (!rawName) return { name: 'Uczeń', initials: 'U' };
  const trimmed = rawName.trim();
  const clean = trimmed.replace(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\p{Emoji})\s*/u, '').trim();
  const finalName = clean || 'Uczeń';
  return {
    name: finalName,
    initials: getInitials(finalName),
  };
}

function renderParticipantCardHtml(card) {
  const pal = card.palette || AVATAR_PALETTES[0];
  return `
    <div class="relative w-full aspect-[4/3] max-h-[220px] rounded-2xl bg-[#0f172a] border ${
      card.is_speaking
        ? 'border-emerald-500 ring-2 ring-emerald-500/30 shadow-lg shadow-emerald-500/10'
        : 'border-slate-800 hover:border-slate-700/80'
    } flex flex-col items-center justify-between p-3 transition-all duration-150 overflow-hidden select-none">
      
      <!-- Górne plakietki statusu -->
      <div class="w-full flex items-center justify-between pointer-events-none z-10">
        <div>
          ${card.hand_raised ? `
            <div class="bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 shadow-sm border border-amber-400/30">
              <svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M23 5.5V20c0 2.2-1.8 4-4 4h-7.3c-1.1 0-2.1-.4-2.8-1.2L2 15.9l1.4-1.4c.4-.4.9-.6 1.4-.6h.4l5.2 2.1V5.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5V12h1V3.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5V12h1V2c0-.8.7-1.5 1.5-1.5S20 1.2 20 2v10h1V5.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5z"/></svg>
              <span>Zgłoszenie</span>
            </div>` : ''}
        </div>
        <div>
          ${card.is_speaking ? `
            <div class="bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1.5 shadow-sm border border-emerald-400/30">
              <span class="flex items-center gap-0.5 h-2">
                <span class="w-0.5 h-1.5 bg-white rounded-full animate-pulse"></span>
                <span class="w-0.5 h-2.5 bg-white rounded-full animate-pulse delay-75"></span>
                <span class="w-0.5 h-2 bg-white rounded-full animate-pulse delay-150"></span>
              </span>
              <span>Mówi</span>
            </div>` : ''}
        </div>
      </div>

      <!-- Awatar - Monogram Inicjałów -->
      <div class="relative flex items-center justify-center my-auto">
        <div class="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl bg-gradient-to-br ${pal.bg} border ${card.is_speaking ? 'border-emerald-400 shadow-emerald-500/20 shadow-lg' : 'border-white/10'} flex items-center justify-center text-white text-xl sm:text-2xl font-bold tracking-wider shadow-md transition-transform duration-150">
          ${card.initials}
        </div>
      </div>

      <!-- Pigułka z imieniem i ikoną mikrofonu -->
      <div class="bg-slate-900/90 backdrop-blur-md px-3 py-1 rounded-xl border border-slate-700/60 flex items-center gap-2 max-w-[90%] shadow-sm">
        <span class="text-xs font-semibold text-slate-100 truncate">${card.is_self ? `Ty (${card.name})` : card.name}</span>
        ${card.is_muted
          ? `<svg class="w-3.5 h-3.5 text-red-400 flex-shrink-0 fill-current" viewBox="0 0 24 24" title="Wyciszony"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.14 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>`
          : card.is_speaking
          ? `<svg class="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 fill-current" viewBox="0 0 24 24" title="Mówi"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"/></svg>`
          : `<svg class="w-3.5 h-3.5 text-slate-400 flex-shrink-0 fill-current" viewBox="0 0 24 24" title="Mikrofon aktywny"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"/></svg>`}
      </div>

    </div>
  `;
}

function renderSkypeGrid(data) {
  const grid = document.getElementById('skype-grid');
  if (!grid) return;

  const rawSelfName = (localStorage.getItem('voip_username') || 'Uczeń').trim();
  const isRoom = data.group && data.group !== 'Poczekalnia' && data.group !== 'Brak' && data.group !== 'Zablokowany';

  // 1. Uczestnik "Ty"
  const selfCard = {
    name: rawSelfName,
    initials: getInitials(rawSelfName),
    palette: getPalette(selectedAvatarId),
    is_speaking: data.is_speaking && !data.is_self_muted && !data.is_muted_by_teacher,
    is_muted: data.is_self_muted || data.is_muted_by_teacher,
    is_self: true,
    hand_raised: isHandRaised,
  };

  // 2. Inni uczestnicy z pokoju
  const otherMembers = (data.room_members || [])
    .filter((m) => !m.is_self)
    .map((m) => {
      const parsed = parseUserAvatarAndName(m.name);
      return {
        name: parsed.name,
        initials: parsed.initials,
        palette: getDeterministicPalette(parsed.name),
        is_speaking: m.is_speaking,
        is_muted: data.is_muted_by_teacher,
        is_self: false,
        hand_raised: m.hand_raised,
      };
    });

  const allCards = [selfCard, ...otherMembers];

  const waitingCardHtml = (title, desc) => `
    <div class="relative w-full aspect-[4/3] max-h-[220px] rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/40 flex flex-col items-center justify-center p-4 text-center">
      <div class="w-11 h-11 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-400 mb-2.5 shadow-sm">
        <svg class="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 3s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
      </div>
      <span class="text-xs font-bold text-slate-200 mb-0.5">${title}</span>
      <span class="text-[11px] text-slate-400 leading-snug">${desc}</span>
    </div>
  `;

  if (!isRoom) {
    // Widok Skype w Poczekalni
    if (allCards.length === 1) {
      grid.className = 'w-full h-full grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-center justify-center max-w-xl mx-auto';
      grid.innerHTML = `
        ${renderParticipantCardHtml(selfCard)}
        ${waitingCardHtml('Poczekalnia lekcyjna', 'Oczekujesz na przydział do pokoju przez nauczyciela.')}
      `;
    } else if (allCards.length === 2) {
      grid.className = 'w-full h-full grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-center justify-center max-w-xl mx-auto';
      grid.innerHTML = allCards.map(renderParticipantCardHtml).join('');
    } else if (allCards.length <= 4) {
      grid.className = 'w-full h-full grid grid-cols-2 gap-3 items-center justify-center max-w-xl mx-auto';
      grid.innerHTML = allCards.map(renderParticipantCardHtml).join('');
    } else {
      grid.className = 'w-full h-full grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 items-center justify-center max-w-3xl mx-auto';
      grid.innerHTML = allCards.map(renderParticipantCardHtml).join('');
    }
    return;
  }

  // Jesteśmy w pokoju roboczym
  if (allCards.length === 1) {
    grid.className = 'w-full h-full grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-center justify-center max-w-xl mx-auto';
    grid.innerHTML = `
      ${renderParticipantCardHtml(selfCard)}
      ${waitingCardHtml('Oczekiwanie na partnera', 'Gdy nauczyciel dołączy kolejną osobę do pokoju, jej stanowisko pojawi się tutaj.')}
    `;
  } else if (allCards.length === 2) {
    grid.className = 'w-full h-full grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-center justify-center max-w-xl mx-auto';
    grid.innerHTML = allCards.map(renderParticipantCardHtml).join('');
  } else if (allCards.length <= 4) {
    grid.className = 'w-full h-full grid grid-cols-2 gap-3 items-center justify-center max-w-xl mx-auto';
    grid.innerHTML = allCards.map(renderParticipantCardHtml).join('');
  } else {
    grid.className = 'w-full h-full grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 items-center justify-center max-w-3xl mx-auto';
    grid.innerHTML = allCards.map(renderParticipantCardHtml).join('');
  }
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
      micStatusLabel.innerText = 'Test mikrofonu';
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
      micStatusLabel.className = 'text-xs font-bold text-emerald-400';
    }
    if (bars[0]) bars[0].className = 'w-1 h-3.5 bg-emerald-500 rounded-full animate-pulse';
    if (bars[1]) bars[1].className = 'w-1 h-5 bg-emerald-500 rounded-full animate-pulse delay-75';
    if (bars[2]) bars[2].className = 'w-1 h-4 bg-emerald-500 rounded-full animate-pulse delay-150';
    if (bars[3]) bars[3].className = 'w-1 h-3 bg-emerald-500 rounded-full animate-pulse delay-100';
  } else {
    if (micIconBox) micIconBox.className = 'w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 flex items-center justify-center transition-all duration-200';
    if (micStatusLabel) {
      micStatusLabel.innerText = 'Czuwanie (VAD)';
      micStatusLabel.className = 'text-xs font-bold text-sky-200';
    }
    if (bars[0]) bars[0].className = 'w-1 h-2 bg-slate-600 rounded-full transition-all duration-150';
    if (bars[1]) bars[1].className = 'w-1 h-3 bg-slate-600 rounded-full transition-all duration-150';
    if (bars[2]) bars[2].className = 'w-1 h-4 bg-slate-600 rounded-full transition-all duration-150';
    if (bars[3]) bars[3].className = 'w-1 h-2 bg-slate-600 rounded-full transition-all duration-150';
  }
}
async function toggleSelfMute() {
  const tauri = getTauri();
  if (tauri && tauri.invoke) {
    try {
      const isMuted = await tauri.invoke('toggle_self_mute');
      const muteBtn = document.getElementById('skype-mute-btn');
      const iconUnmuted = document.getElementById('skype-mute-icon-unmuted');
      const iconMuted = document.getElementById('skype-mute-icon-muted');
      if (muteBtn && iconUnmuted && iconMuted) {
        if (isMuted) {
          muteBtn.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-red-600 hover:bg-red-700 ring-4 ring-red-500/30 text-white flex items-center justify-center transition shadow-lg shadow-red-600/25 cursor-pointer';
          iconUnmuted.classList.add('hidden');
          iconMuted.classList.remove('hidden');
          muteBtn.title = 'Mikrofon wyciszony (kliknij, aby włączyć)';
        } else {
          muteBtn.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center transition shadow-md cursor-pointer';
          iconUnmuted.classList.remove('hidden');
          iconMuted.classList.add('hidden');
          muteBtn.title = 'Wycisz mikrofon';
        }
      }
    } catch (e) {
      console.error('Błąd toggle_self_mute:', e);
    }
  }
}

async function handleHangupClick() {
  const tauri = getTauri();
  if (tauri && tauri.invoke) {
    try {
      await tauri.invoke('leave_room');
      showToast('Opuszczono pokój. Powrót do Poczekalni.', 'info');
      const viewLobby = document.getElementById('view-lobby');
      const viewSkype = document.getElementById('view-skype-call');
      if (viewLobby) viewLobby.classList.remove('hidden');
      if (viewSkype) viewSkype.classList.add('hidden');
      const groupElem = document.getElementById('group-name');
      if (groupElem) groupElem.innerText = 'Poczekalnia';
      const roomBadge = document.getElementById('room-badge');
      if (roomBadge) {
        roomBadge.innerText = 'Poczekalnia';
        roomBadge.className = 'text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500';
      }
    } catch (e) {
      console.error('Błąd leave_room:', e);
    }
  }
}

function applyClientStatus(data) {
  if (!data) return;

  const isJoined = data.is_joined !== undefined ? data.is_joined : isJoinedState;
  const isRoom = data.group && data.group !== 'Poczekalnia' && data.group !== 'Brak' && data.group !== 'Zablokowany';
  const groupDisplay = isRoom ? data.group : 'Poczekalnia';

  const viewLobby = document.getElementById('view-lobby');
  const viewSkype = document.getElementById('view-skype-call');

  if (isJoined) {
    if (viewLobby) viewLobby.classList.add('hidden');
    if (viewSkype) viewSkype.classList.remove('hidden');
  } else {
    if (viewLobby) viewLobby.classList.remove('hidden');
    if (viewSkype) viewSkype.classList.add('hidden');
  }

  const ipElem = document.getElementById('server-ip');
  if (ipElem) ipElem.innerText = data.server_ip;
  const groupElem = document.getElementById('group-name');
  if (groupElem) groupElem.innerText = groupDisplay;

  const roomBadge = document.getElementById('room-badge');
  if (roomBadge) {
    roomBadge.innerText = groupDisplay;
    roomBadge.className = isRoom
      ? 'text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-300'
      : 'text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500';
  }

  const badge = document.getElementById('status-badge');
  const statusDot = document.getElementById('status-dot');
  if (data.connected) {
    if (badge) {
      badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span><span>Wykryto serwer</span>';
      badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200';
    }
    if (statusDot) statusDot.className = 'absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-white shadow-sm';
  } else {
    const msg = data.server_ip.includes('Wpisz') ? 'Brak imienia' : data.server_ip.includes('brak odp') ? 'Brak odp.' : 'Szukanie...';
    if (badge) {
      badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span><span>${msg}</span>`;
      badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200';
    }
    if (statusDot) statusDot.className = 'absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-amber-500 rounded-full border-2 border-white shadow-sm';
  }

  updateMicState(data.is_speaking, data.is_muted_by_teacher, data.is_mic_test_active);

  const lobbyVolSlider = document.getElementById('client-volume-slider');
  const lobbyVolPct = document.getElementById('client-volume-pct');
  const pctValue = Math.round((data.volume || 1.0) * 100);
  if (lobbyVolSlider && document.activeElement !== lobbyVolSlider) lobbyVolSlider.value = pctValue;
  if (lobbyVolPct) lobbyVolPct.innerText = `${pctValue}%`;

  const teacherBroadcastBanner = document.getElementById('teacher-broadcast-banner');
  if (teacherBroadcastBanner) {
    if (data.is_muted_by_teacher) teacherBroadcastBanner.classList.remove('hidden');
    else teacherBroadcastBanner.classList.add('hidden');
  }

  const roomTitle = document.getElementById('skype-room-title');
  const countBadge = document.getElementById('skype-participant-count');
  const skypeStatusDot = document.getElementById('skype-room-status-dot');

  if (roomTitle) roomTitle.innerText = groupDisplay;
  if (skypeStatusDot) {
    skypeStatusDot.className = data.connected
      ? 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse'
      : 'w-2 h-2 rounded-full bg-amber-500 animate-pulse';
  }

  const membersCount = Math.max(1, (data.room_members || []).length);
  if (countBadge) countBadge.innerText = membersCount === 1 ? '1 uczestnik' : `${membersCount} uczestników`;

  const selfAvatarPreview = document.getElementById('skype-self-avatar-preview');
  const selfNamePreview = document.getElementById('skype-self-name-preview');
  if (selfAvatarPreview) selfAvatarPreview.innerText = getAvatarEmoji(selectedAvatarId);
  if (selfNamePreview) selfNamePreview.innerText = (localStorage.getItem('voip_username') || 'Uczeń').trim();

  const skypeBroadcastBanner = document.getElementById('skype-broadcast-banner');
  if (skypeBroadcastBanner) {
    if (data.is_muted_by_teacher) skypeBroadcastBanner.classList.remove('hidden');
    else skypeBroadcastBanner.classList.add('hidden');
  }

  const muteBtn = document.getElementById('skype-mute-btn');
  const iconUnmuted = document.getElementById('skype-mute-icon-unmuted');
  const iconMuted = document.getElementById('skype-mute-icon-muted');
  if (muteBtn && iconUnmuted && iconMuted) {
    if (data.is_self_muted) {
      muteBtn.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-red-600 hover:bg-red-700 ring-4 ring-red-500/30 text-white flex items-center justify-center transition shadow-lg shadow-red-600/25 cursor-pointer';
      iconUnmuted.classList.add('hidden');
      iconMuted.classList.remove('hidden');
      muteBtn.title = 'Mikrofon wyciszony (kliknij, aby włączyć)';
    } else {
      muteBtn.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center transition shadow-md cursor-pointer';
      iconUnmuted.classList.remove('hidden');
      iconMuted.classList.add('hidden');
      muteBtn.title = 'Wycisz mikrofon';
    }
  }

  const skypeVolSlider = document.getElementById('skype-volume-slider');
  const skypeVolPct = document.getElementById('skype-volume-pct');
  if (skypeVolSlider && document.activeElement !== skypeVolSlider) skypeVolSlider.value = pctValue;
  if (skypeVolPct) skypeVolPct.innerText = `${pctValue}%`;

  if (lastAssignedGroup !== null && lastAssignedGroup !== data.group) {
    if (isRoom) showToast(`Przydzielono Cię do: ${data.group}`, 'success');
    else if (isJoined) showToast('Przeniesiono Cię do Poczekalni', 'info');
  }
  lastAssignedGroup = data.group;

  if (isJoined) {
    renderSkypeGrid(data);
  }

  if (data.mic_level !== undefined) {
    updateSettingsMicMeter(data.mic_level);
  }

  if (data.agc_enabled !== undefined) {
    const agcCheckbox = document.getElementById('settings-agc-checkbox');
    if (agcCheckbox && document.activeElement !== agcCheckbox) {
      agcCheckbox.checked = !!data.agc_enabled;
    }
  }

  if (data.hand_raised !== undefined && data.hand_raised !== isHandRaised) {
    isHandRaised = data.hand_raised;
    const skypeHandBtn = document.getElementById('skype-raise-hand-btn');
    if (skypeHandBtn) {
      if (isHandRaised) {
        skypeHandBtn.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-amber-500 hover:bg-amber-600 ring-4 ring-amber-400/40 text-white flex items-center justify-center transition shadow-lg shadow-amber-500/30 cursor-pointer animate-pulse';
        skypeHandBtn.title = 'Ręka podniesiona (kliknij, aby odwołać)';
      } else {
        skypeHandBtn.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition shadow-md cursor-pointer';
        skypeHandBtn.title = 'Poproś nauczyciela o pomoc (Podnieś rękę)';
      }
    }
  }

  const phase = data.mic_test_phase || (data.is_mic_test_active ? 'recording' : 'idle');
  const countdown = Math.ceil(data.mic_test_countdown || 0);
  updateMicTestButtons(phase, countdown);
}

let currentMicTestPhase = 'idle';

function updateMicTestButtons(phase, countdown) {
  currentMicTestPhase = phase;
  const buttons = [
    { btn: document.getElementById('settings-test-mic-btn'), text: document.getElementById('settings-test-mic-text') },
    { btn: document.getElementById('lobby-test-mic-btn'), text: document.getElementById('lobby-test-mic-text') }
  ];

  buttons.forEach(({ btn, text }) => {
    if (!btn || !text) return;
    const svg = btn.querySelector('svg');
    btn.dataset.prevPhase = phase;
    if (phase === 'recording') {
      btn.className = 'mt-2 w-full bg-red-950/80 hover:bg-red-900 text-red-200 border border-red-500 font-bold py-2 px-3 rounded-xl text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-md';
      if (svg) svg.classList.add('hidden');
      text.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block mr-1"></span>Nagrywanie głosu (${countdown > 0 ? countdown : 5}s)...`;
    } else if (phase === 'playing') {
      btn.className = 'mt-2 w-full bg-emerald-950/80 hover:bg-emerald-900 text-emerald-200 border border-emerald-500 font-bold py-2 px-3 rounded-xl text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-md';
      if (svg) svg.classList.add('hidden');
      text.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block mr-1"></span>Odsłuch w słuchawkach (${countdown > 0 ? countdown : 5}s)...`;
    } else {
      btn.className = 'mt-2 w-full bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 active:scale-[0.98] font-bold py-2 px-3 rounded-xl text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-sm';
      if (svg) svg.classList.remove('hidden');
      text.innerText = 'Testuj mikrofon (5s nagranie i odsłuch)';
    }
  });
}

async function initClientListener() {
  const tauri = getTauri();
  if (!tauri) return;

  const isActivated = await checkActivationStatus();
  if (isActivated) {
    initStudentProfile();
  }

  initSavedAudioSettings();

  // Serwer pracowni jest wykrywany wyłącznie automatycznie (mDNS / UDP broadcast)
  localStorage.removeItem('voip_manual_server_ip');

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
  const pct = Math.min(100, Math.round((level || 0) * 100));

  const bar = document.getElementById('settings-mic-level-bar');
  const pctLabel = document.getElementById('settings-mic-pct');
  if (bar) bar.style.width = `${pct}%`;
  if (pctLabel) pctLabel.innerText = `${pct}%`;

  const lobbyBar = document.getElementById('lobby-mic-level-bar');
  const lobbyPct = document.getElementById('lobby-mic-pct');
  if (lobbyBar) lobbyBar.style.width = `${pct}%`;
  if (lobbyPct) lobbyPct.innerText = `${pct}%`;
}

let audioDevicePollInterval = null;

async function openSettingsModal() {
  document.getElementById('settings-modal')?.classList.remove('hidden');
  await loadAudioDevices();
  const savedVad = localStorage.getItem('voip_vad_threshold');
  if (savedVad !== null) {
    handleVadThresholdChange(savedVad);
  }
  const savedAgc = localStorage.getItem('voip_agc_enabled');
  const agcCheckbox = document.getElementById('settings-agc-checkbox');
  if (agcCheckbox) {
    agcCheckbox.checked = savedAgc !== null ? savedAgc === 'true' : true;
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
  if (currentMicTestPhase === 'recording' || currentMicTestPhase === 'playing') {
    testMicLoopback();
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
        inputSelect.innerHTML = '<option value="" disabled selected>Brak podłączonego mikrofonu</option>';
        inputSelect.dataset.renderedDevices = 'empty';
        if (micWarning) micWarning.classList.remove('hidden');
        if (micTestBtn) {
          micTestBtn.disabled = true;
          micTestBtn.classList.add('opacity-50', 'cursor-not-allowed');
          if (currentMicTestPhase === 'idle' && micTestText) {
            micTestText.innerText = 'Podłącz mikrofon, aby przetestować';
          }
        }
      } else {
        if (micWarning) micWarning.classList.add('hidden');
        if (micTestBtn) {
          micTestBtn.disabled = false;
          micTestBtn.classList.remove('opacity-50', 'cursor-not-allowed');
          if (currentMicTestPhase === 'idle' && micTestText) {
            micTestText.innerText = 'Testuj mikrofon (5s nagranie i odsłuch)';
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

async function testMicLoopback() {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;

  if (currentMicTestPhase === 'recording' || currentMicTestPhase === 'playing') {
    try {
      await tauri.invoke('stop_mic_test');
    } catch (e) {
      console.error('Błąd stop_mic_test:', e);
    }
    return;
  }

  try {
    await tauri.invoke('start_mic_test', { durationSecs: 5.0, duration_secs: 5.0 });
  } catch (err) {
    console.error('Błąd start_mic_test:', err);
    showToast('Nie udało się uruchomić testu mikrofonu', 'error');
  }
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
    text.innerText = 'Odtwarzanie dźwięku testowego...';
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

function handleAgcToggle(enabled) {
  const agcCheckbox = document.getElementById('settings-agc-checkbox');
  if (agcCheckbox) agcCheckbox.checked = !!enabled;
  localStorage.setItem('voip_agc_enabled', enabled ? 'true' : 'false');
  const tauri = getTauri();
  if (tauri && tauri.invoke) {
    tauri.invoke('set_agc_enabled', { enabled: !!enabled }).catch(console.error);
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

  const savedVol = localStorage.getItem('voip_client_volume');
  if (savedVol !== null) {
    handleClientVolumeChange(savedVol);
  }

  const savedVad = localStorage.getItem('voip_vad_threshold');
  if (savedVad !== null) {
    handleVadThresholdChange(savedVad);
  }

  const savedAgc = localStorage.getItem('voip_agc_enabled');
  if (savedAgc !== null) {
    handleAgcToggle(savedAgc === 'true');
  } else {
    handleAgcToggle(true);
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
  let icon = `
    <svg class="w-4 h-4 text-sky-400 fill-current" viewBox="0 0 24 24">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
    </svg>`;

  if (type === 'success') {
    bgClass = 'bg-slate-900/95 border-emerald-500/50 text-emerald-100 shadow-emerald-950/40';
    icon = `
      <svg class="w-4 h-4 text-emerald-400 fill-current" viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
      </svg>`;
  } else if (type === 'warning') {
    bgClass = 'bg-slate-900/95 border-amber-500/50 text-amber-100 shadow-amber-950/40';
    icon = `
      <svg class="w-4 h-4 text-amber-400 fill-current" viewBox="0 0 24 24">
        <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
      </svg>`;
  } else if (type === 'error') {
    bgClass = 'bg-slate-900/95 border-red-500/50 text-red-100 shadow-red-950/40';
    icon = `
      <svg class="w-4 h-4 text-red-400 fill-current" viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
      </svg>`;
  } else if (type === 'info') {
    bgClass = 'bg-slate-900/95 border-sky-500/50 text-sky-100 shadow-sky-950/40';
    icon = `
      <svg class="w-4 h-4 text-sky-400 fill-current" viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
      </svg>`;
  }

  toast.className = `flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border shadow-xl backdrop-blur-md text-xs font-semibold transform transition-all duration-300 pointer-events-auto opacity-0 translate-y-3 ${bgClass}`;
  toast.innerHTML = `
    <span class="flex-shrink-0 flex items-center justify-center">${icon}</span>
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
    const badge1 = document.getElementById('client-version-badge');
    const badge2 = document.getElementById('client-version-badge-skype');
    if (badge1) badge1.innerText = `v${version}`;
    if (badge2) badge2.innerText = `v${version}`;
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
      const errStr = String(err?.message || err || '');
      let reason = 'Brak połączenia z serwerem aktualizacji GitHub';
      if (errStr.includes('404') || errStr.toLowerCase().includes('not found')) {
        reason = 'Brak opublikowanych wydań na GitHub lub repozytorium jest prywatne';
      }
      showToast(`Wersja: v${curVer} (${reason})`, 'warning');
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

function openUpdateProgressModal(version) {
  dismissUpdateToast();
  const modal = document.getElementById('update-progress-modal');
  if (!modal) return;
  modal.classList.remove('hidden');

  const title = document.getElementById('update-progress-title');
  const subtitle = document.getElementById('update-progress-subtitle');
  const progressBar = document.getElementById('update-progress-bar');
  const pctElem = document.getElementById('update-progress-pct');
  const statusElem = document.getElementById('update-progress-status');
  const errorBox = document.getElementById('update-progress-error-box');
  const iconDownload = document.getElementById('update-progress-icon-download');
  const iconSpinner = document.getElementById('update-progress-icon-spinner');

  if (title) title.innerText = 'Pobieranie aktualizacji...';
  if (subtitle) subtitle.innerText = version ? `Przygotowywanie nowej wersji v${version}` : 'Przygotowywanie nowej wersji programu';
  if (progressBar) {
    progressBar.style.width = '0%';
    progressBar.className = 'h-full bg-gradient-to-r from-blue-600 to-emerald-500 rounded-full transition-all duration-150';
  }
  if (pctElem) pctElem.innerText = '0%';
  if (statusElem) statusElem.innerText = 'Nawiązywanie połączenia...';
  if (errorBox) errorBox.classList.add('hidden');
  if (iconDownload) iconDownload.classList.remove('hidden');
  if (iconSpinner) iconSpinner.classList.add('hidden');
}

function closeUpdateProgressModal() {
  const modal = document.getElementById('update-progress-modal');
  if (modal) modal.classList.add('hidden');
  isUpdatingClientApp = false;
  const btn = document.getElementById('btn-install-tauri-update');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<span>Aktualizuj teraz</span>';
  }
}

function initClientUpdateListeners() {
  const tauri = getTauri();
  if (!tauri || !tauri.listen) return;

  tauri.listen('update-download-progress', (event) => {
    const payload = event.payload;
    if (!payload) return;
    const downloaded = payload.downloaded || 0;
    const total = payload.total || 0;

    const modal = document.getElementById('update-progress-modal');
    if (modal) modal.classList.remove('hidden');

    const progressBar = document.getElementById('update-progress-bar');
    const pctElem = document.getElementById('update-progress-pct');
    const statusElem = document.getElementById('update-progress-status');

    if (total > 0) {
      const pct = Math.min(100, Math.round((downloaded / total) * 100));
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (pctElem) pctElem.innerText = `${pct}%`;
      const dlMb = (downloaded / (1024 * 1024)).toFixed(1);
      const totalMb = (total / (1024 * 1024)).toFixed(1);
      if (statusElem) statusElem.innerText = `${dlMb} MB / ${totalMb} MB`;
    } else {
      const dlMb = (downloaded / (1024 * 1024)).toFixed(1);
      if (progressBar) progressBar.style.width = '60%';
      if (statusElem) statusElem.innerText = `Pobrano: ${dlMb} MB`;
    }
  });

  tauri.listen('update-installing', () => {
    const title = document.getElementById('update-progress-title');
    const subtitle = document.getElementById('update-progress-subtitle');
    const statusElem = document.getElementById('update-progress-status');
    const pctElem = document.getElementById('update-progress-pct');
    const progressBar = document.getElementById('update-progress-bar');
    const iconDownload = document.getElementById('update-progress-icon-download');
    const iconSpinner = document.getElementById('update-progress-icon-spinner');

    if (title) title.innerText = 'Instalowanie aktualizacji...';
    if (subtitle) subtitle.innerText = 'Weryfikacja podpisu cyfrowego i podmiana plików';
    if (statusElem) statusElem.innerText = 'Instalowanie i restart...';
    if (pctElem) pctElem.innerText = '100%';
    if (progressBar) {
      progressBar.style.width = '100%';
      progressBar.className = 'h-full bg-emerald-500 rounded-full transition-all duration-150';
    }
    if (iconDownload) iconDownload.classList.add('hidden');
    if (iconSpinner) iconSpinner.classList.remove('hidden');
  });
}

async function applyTauriUpdate() {
  if (isUpdatingClientApp) return;
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;

  isUpdatingClientApp = true;
  openUpdateProgressModal(pendingClientTauriUpdate?.latest_version);

  try {
    await tauri.invoke('install_update');
  } catch (err) {
    console.error('Błąd instalacji aktualizacji:', err);
    const errorBox = document.getElementById('update-progress-error-box');
    const errorMsg = document.getElementById('update-progress-error-msg');
    if (errorBox && errorMsg) {
      errorMsg.innerText = `${err}`;
      errorBox.classList.remove('hidden');
    } else {
      showToast(`Błąd aktualizacji: ${err}`, 'warning');
      closeUpdateProgressModal();
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  initClientListener();
  initClientAppVersion();
  initSavedAudioSettings();
  initClientUpdateListeners();
  // Sprawdź aktualizację automatycznie przy starcie aplikacji (600ms po zainicjowaniu widoku)
  setTimeout(() => {
    checkForAppUpdate(false);
  }, 600);
});


