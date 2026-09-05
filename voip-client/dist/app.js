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

let isHandRaised = false;

function raiseHand() {
  const tauri = getTauri();
  if (tauri && tauri.invoke) tauri.invoke('raise_hand');

  isHandRaised = true;
  const skypeBtn = document.getElementById('skype-raise-hand-btn');
  if (skypeBtn) {
    skypeBtn.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-amber-500 hover:bg-amber-600 text-white flex items-center justify-center transition shadow-lg shadow-amber-500/30 cursor-pointer animate-bounce';
    skypeBtn.title = 'Ręka podniesiona! Nauczyciel widzi Twoje zgłoszenie';
  }
  showToast('Poproszono nauczyciela o pomoc! ✋', 'info');

  setTimeout(() => {
    isHandRaised = false;
    if (skypeBtn) {
      skypeBtn.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition shadow-md cursor-pointer';
      skypeBtn.title = 'Poproś nauczyciela o pomoc (Podnieś rękę)';
    }
  }, 4000);
}

async function toggleSelfMute() {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;
  try {
    const isMuted = await tauri.invoke('toggle_self_mute');
    showToast(isMuted ? 'Mikrofon został wyciszony' : 'Mikrofon włączony', isMuted ? 'info' : 'success');
    const st = await tauri.invoke('get_client_status');
    if (st) applyClientStatus(st);
  } catch (e) {
    console.error('Błąd toggle_self_mute:', e);
  }
}

async function handleHangupClick() {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;
  try {
    await tauri.invoke('leave_room');
    showToast('Rozłączono z pokojem. Przeniesiono do Poczekalni.', 'info');
    const st = await tauri.invoke('get_client_status');
    if (st) applyClientStatus(st);
  } catch (e) {
    console.error('Błąd leave_room:', e);
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

function parseUserAvatarAndName(rawName) {
  if (!rawName) return { emoji: '🎓', name: 'Uczeń' };
  const trimmed = rawName.trim();
  const match = trimmed.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\p{Emoji})\s*(.*)$/u);
  if (match) {
    return {
      emoji: match[1],
      name: match[2].trim() || 'Uczeń',
    };
  }
  return { emoji: '🎓', name: trimmed };
}

function renderParticipantCardHtml(card) {
  return `
    <div class="relative w-full aspect-[4/3] max-h-[220px] rounded-3xl bg-slate-900/90 border-2 ${
      card.is_speaking
        ? 'border-emerald-400 ring-4 ring-emerald-500/30 shadow-xl shadow-emerald-500/25 bg-slate-900'
        : 'border-slate-800/90 hover:border-slate-700'
    } flex flex-col items-center justify-between p-3.5 shadow-2xl transition-all duration-150 overflow-hidden group select-none">
      
      <!-- Górne plakietki statusu -->
      <div class="w-full flex items-center justify-between pointer-events-none z-10">
        <div>
          ${card.hand_raised ? `<div class="bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 shadow animate-bounce">✋ Pomoc</div>` : ''}
        </div>
        <div>
          ${card.is_speaking ? `<div class="bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 shadow animate-pulse"><span class="w-1.5 h-1.5 rounded-full bg-white"></span>Mówi</div>` : ''}
        </div>
      </div>

      <!-- Awatar -->
      <div class="relative flex items-center justify-center my-auto">
        ${card.is_speaking ? `<div class="absolute -inset-2 rounded-full border-2 border-emerald-400 animate-ping opacity-60 pointer-events-none"></div>` : ''}
        <div class="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-slate-800 border-2 ${card.is_speaking ? 'border-emerald-400 ring-4 ring-emerald-500/20' : 'border-slate-700'} flex items-center justify-center text-3xl sm:text-4xl shadow-xl transition-transform duration-150 group-hover:scale-105">
          ${card.emoji}
        </div>
      </div>

      <!-- Pigułka z imieniem i ikoną mikrofonu -->
      <div class="bg-black/70 backdrop-blur-md px-3.5 py-1.5 rounded-xl border border-white/10 flex items-center gap-2 max-w-[90%] shadow-md">
        <span class="text-xs font-bold text-slate-100 truncate">${card.is_self ? `Ty (${card.name})` : card.name}</span>
        ${card.is_muted
          ? `<span class="text-xs text-red-400" title="Wyciszony">🔇</span>`
          : card.is_speaking
          ? `<span class="text-xs text-emerald-400 animate-pulse" title="Mówi">🔊</span>`
          : `<span class="text-[11px] text-slate-400" title="Mikrofon aktywny">🎤</span>`}
      </div>

    </div>
  `;
}

function renderSkypeGrid(data) {
  const grid = document.getElementById('skype-grid');
  if (!grid) return;

  const rawSelfName = (localStorage.getItem('voip_username') || 'Uczeń').trim();
  const selfAvatar = getAvatarEmoji(selectedAvatarId);
  const isRoom = data.group && data.group !== 'Poczekalnia' && data.group !== 'Brak' && data.group !== 'Zablokowany';

  // 1. Uczestnik "Ty"
  const selfCard = {
    name: rawSelfName,
    emoji: selfAvatar,
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
        emoji: parsed.emoji,
        is_speaking: m.is_speaking,
        is_muted: data.is_muted_by_teacher,
        is_self: false,
        hand_raised: m.hand_raised,
      };
    });

  // Jeżeli jesteśmy w Poczekalni
  if (!isRoom) {
    grid.className = 'w-full h-full flex flex-col items-center justify-center max-w-sm mx-auto text-center';
    grid.innerHTML = `
      <div class="relative w-full aspect-[4/3] max-h-[250px] rounded-3xl bg-slate-900/90 border-2 ${
        selfCard.is_speaking ? 'border-emerald-400 ring-4 ring-emerald-500/30 shadow-xl shadow-emerald-500/20' : 'border-slate-800'
      } flex flex-col items-center justify-between p-4 shadow-2xl transition-all duration-200 overflow-hidden group">
        
        <div class="w-full flex items-center justify-between pointer-events-none z-10">
          <div>
            ${selfCard.hand_raised ? `<div class="bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 shadow animate-bounce">✋ Prosisz o pomoc</div>` : ''}
          </div>
          <div>
            ${selfCard.is_speaking ? `<div class="bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 shadow animate-pulse"><span class="w-1.5 h-1.5 rounded-full bg-white"></span>Mówisz</div>` : ''}
          </div>
        </div>

        <div class="relative flex items-center justify-center my-auto">
          ${selfCard.is_speaking ? `<div class="absolute -inset-2 rounded-full border-2 border-emerald-400 animate-ping opacity-60"></div>` : ''}
          <div class="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-slate-800 border-2 ${selfCard.is_speaking ? 'border-emerald-400 ring-4 ring-emerald-500/20' : 'border-slate-700'} flex items-center justify-center text-4xl sm:text-5xl shadow-xl transition-transform duration-150 group-hover:scale-105">
            ${selfCard.emoji}
          </div>
        </div>

        <div class="bg-black/70 backdrop-blur-md px-3.5 py-1.5 rounded-xl border border-white/10 flex items-center gap-2 max-w-[90%] shadow-md">
          <span class="text-xs font-bold text-white truncate">Ty (${selfCard.name})</span>
          ${selfCard.is_muted
            ? `<span class="text-xs text-red-400" title="Wyciszony">🔇</span>`
            : selfCard.is_speaking
            ? `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>`
            : `<span class="text-[11px] text-slate-400">🎤</span>`}
        </div>
      </div>

      <div class="mt-3 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-3 text-slate-400 text-xs">
        <span class="text-amber-400 font-bold block mb-0.5">🟡 Poczekalnia lekcyjna</span>
        <span>Czekasz na przydział do pokoju. Gdy nauczyciel dołączy Cię do pary lub grupy, natychmiast połączysz się z drugą osobą.</span>
      </div>
    `;
    return;
  }

  // Jesteśmy w pokoju roboczym (np. Pokój 1)
  const allCards = [selfCard, ...otherMembers];

  if (allCards.length === 1) {
    grid.className = 'w-full h-full grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-center justify-center max-w-xl mx-auto';
    grid.innerHTML = `
      ${renderParticipantCardHtml(selfCard)}
      <div class="relative w-full aspect-[4/3] max-h-[220px] rounded-3xl border-2 border-dashed border-slate-700/80 bg-slate-900/40 flex flex-col items-center justify-center p-4 text-center text-slate-400">
        <div class="w-14 h-14 rounded-full bg-slate-800/60 border border-slate-700/60 flex items-center justify-center text-2xl mb-2 text-slate-500 animate-pulse">
          ⏳
        </div>
        <span class="text-xs font-bold text-slate-300 mb-0.5">Oczekiwanie na partnera</span>
        <span class="text-[11px] text-slate-500 leading-snug">Gdy nauczyciel dołączy drugą osobę, jej kafelek pojawi się tutaj.</span>
      </div>
    `;
  } else if (allCards.length === 2) {
    grid.className = 'w-full h-full grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-center justify-center max-w-xl mx-auto';
    grid.innerHTML = allCards.map(renderParticipantCardHtml).join('');
  } else if (allCards.length <= 4) {
    grid.className = 'w-full h-full grid grid-cols-2 gap-3 items-center justify-center max-w-xl mx-auto';
    grid.innerHTML = allCards.map(renderParticipantCardHtml).join('');
  } else {
    grid.className = 'w-full h-full grid grid-cols-2 sm:grid-cols-3 gap-2.5 items-center justify-center max-w-2xl mx-auto';
    grid.innerHTML = allCards.map(renderParticipantCardHtml).join('');
  }
}

function applyClientStatus(data) {
  if (!data) return;

  const roomTitle = document.getElementById('skype-room-title');
  const countBadge = document.getElementById('skype-participant-count');
  const statusDot = document.getElementById('skype-room-status-dot');

  const isRoom = data.group && data.group !== 'Poczekalnia' && data.group !== 'Brak' && data.group !== 'Zablokowany';
  const groupDisplay = isRoom ? data.group : 'Poczekalnia';

  if (roomTitle) roomTitle.innerText = groupDisplay;

  if (statusDot) {
    if (data.connected) {
      statusDot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
    } else {
      statusDot.className = 'w-2 h-2 rounded-full bg-amber-500 animate-pulse';
    }
  }

  // Liczba uczestników
  const membersCount = isRoom ? Math.max(1, (data.room_members || []).length) : 1;
  if (countBadge) {
    countBadge.innerText = membersCount === 1 ? '1 uczestnik' : `${membersCount} uczestników`;
  }

  // Podgląd własnego profilu na pasku
  const selfAvatarPreview = document.getElementById('skype-self-avatar-preview');
  const selfNamePreview = document.getElementById('skype-self-name-preview');
  if (selfAvatarPreview) selfAvatarPreview.innerText = getAvatarEmoji(selectedAvatarId);
  if (selfNamePreview) selfNamePreview.innerText = (localStorage.getItem('voip_username') || 'Uczeń').trim();

  // Baner ogłoszenia nauczyciela
  const broadcastBanner = document.getElementById('skype-broadcast-banner');
  if (broadcastBanner) {
    if (data.is_muted_by_teacher) {
      broadcastBanner.classList.remove('hidden');
    } else {
      broadcastBanner.classList.add('hidden');
    }
  }

  // Przycisk wyciszenia mikrofonu
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

  // Suwak głośności w doku
  const volSlider = document.getElementById('skype-volume-slider');
  const volPct = document.getElementById('skype-volume-pct');
  const pctValue = Math.round((data.volume || 1.0) * 100);
  if (volSlider && document.activeElement !== volSlider) {
    volSlider.value = pctValue;
  }
  if (volPct) volPct.innerText = `${pctValue}%`;

  // Powiadomienie toast o zmianie pokoju
  if (lastAssignedGroup !== null && lastAssignedGroup !== data.group) {
    if (isRoom) {
      showToast(`Przydzielono Cię do: ${data.group}`, 'success');
    } else {
      showToast('Przeniesiono Cię do Poczekalni', 'info');
    }
  }
  lastAssignedGroup = data.group;

  // Renderowanie kafelków Skype
  renderSkypeGrid(data);

  // Aktualizacja wskaźnika mikrofonu w ustawieniach
  if (data.mic_level !== undefined) {
    updateSettingsMicMeter(data.mic_level);
  }

  // Aktualizacja stanu przycisku testu mikrofonu (Nagrywanie 5s -> Czysty odsłuch 5s -> Gotowe)
  const micTestBtn = document.getElementById('settings-test-mic-btn');
  const micTestText = document.getElementById('settings-test-mic-text');
  if (micTestBtn && micTestText && !micTestBtn.disabled) {
    const phase = data.mic_test_phase || (data.is_mic_test_active ? 'recording' : 'idle');
    const countdown = Math.ceil(data.mic_test_countdown || 0);

    if (phase === 'recording') {
      micTestBtn.className = 'mt-2.5 w-full bg-red-100 hover:bg-red-200 text-red-900 border-2 border-red-500 font-bold py-2.5 px-3 rounded-xl text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-md animate-pulse';
      micTestText.innerText = `🔴 Mów do mikrofonu (${countdown > 0 ? countdown : 5}s)...`;
    } else if (phase === 'playing') {
      micTestBtn.className = 'mt-2.5 w-full bg-emerald-100 hover:bg-emerald-200 text-emerald-950 border-2 border-emerald-500 font-bold py-2.5 px-3 rounded-xl text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-md';
      micTestText.innerText = `🔊 Odsłuch w słuchawkach (${countdown > 0 ? countdown : 5}s)...`;
    } else {
      if (micTestBtn.dataset.prevPhase && micTestBtn.dataset.prevPhase !== 'idle') {
        micTestBtn.className = 'mt-2.5 w-full bg-emerald-50 text-emerald-800 border border-emerald-300 font-bold py-2.5 px-3 rounded-xl text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-sm';
        micTestText.innerText = '✅ Test zakończony pomyślnie!';
        setTimeout(() => {
          if (!micTestBtn.dataset.prevPhase || micTestBtn.dataset.prevPhase === 'idle') {
            micTestBtn.className = 'mt-2.5 w-full bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-300 active:scale-[0.98] font-bold py-2.5 px-3 rounded-xl text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-sm';
            micTestText.innerText = 'Testuj mikrofon (5s nagranie i odsłuch)';
          }
        }, 2200);
      } else if (!micTestBtn.dataset.prevPhase || micTestBtn.dataset.prevPhase === 'idle') {
        micTestBtn.className = 'mt-2.5 w-full bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-300 active:scale-[0.98] font-bold py-2.5 px-3 rounded-xl text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-sm';
        micTestText.innerText = 'Testuj mikrofon (5s nagranie i odsłuch)';
      }
    }
    micTestBtn.dataset.prevPhase = phase;
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

  const btn = document.getElementById('settings-test-mic-btn');
  const currentPhase = btn?.dataset?.prevPhase || 'idle';

  if (currentPhase === 'recording' || currentPhase === 'playing') {
    try {
      await tauri.invoke('stop_mic_test');
    } catch (e) {
      console.error('Błąd stop_mic_test:', e);
    }
    return;
  }

  try {
    await tauri.invoke('start_mic_test', { durationSecs: 5.0 });
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


