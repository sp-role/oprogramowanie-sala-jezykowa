let roomsList = [];
let globalClientsData = [];
let activeListenRoom = null;
let currentHardwareId = '';

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
        message: event.message || 'Błąd JS w widoku serwera',
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


// -------------------------------------------------------------
// PROFILE KOLORYSTYCZNE I AWATARY UCZNIÓW (MICROSOFT TEAMS STYLE)
// -------------------------------------------------------------
const AVATAR_PALETTES = [
  { id: 'blue', gradient: 'from-blue-600 to-indigo-700', text: 'text-white' },
  { id: 'emerald', gradient: 'from-emerald-600 to-teal-700', text: 'text-white' },
  { id: 'indigo', gradient: 'from-indigo-600 to-violet-800', text: 'text-white' },
  { id: 'violet', gradient: 'from-violet-600 to-purple-800', text: 'text-white' },
  { id: 'amber', gradient: 'from-amber-500 to-orange-600', text: 'text-white' },
  { id: 'rose', gradient: 'from-rose-600 to-pink-700', text: 'text-white' },
  { id: 'cyan', gradient: 'from-cyan-600 to-blue-700', text: 'text-white' },
  { id: 'slate', gradient: 'from-slate-700 to-slate-900', text: 'text-white' },
];

function getInitials(name) {
  if (!name) return 'U';
  const clean = name.replace(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\p{Emoji})\s*/u, '').trim();
  if (!clean) return 'U';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return clean.slice(0, Math.min(2, clean.length)).toUpperCase();
}

function getDeterministicPalette(name) {
  if (!name) return AVATAR_PALETTES[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_PALETTES.length;
  return AVATAR_PALETTES[index];
}

// -------------------------------------------------------------
// LOGIKA AKTYWACJI SERWERA I OCHRONY PRZED KOPIOWANIEM
// -------------------------------------------------------------
async function checkActivationStatus() {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) {
    document.getElementById('activation-modal')?.classList.remove('hidden');
    document.getElementById('start-modal')?.classList.add('hidden');
    return false;
  }

  try {
    currentHardwareId = await tauri.invoke('get_hardware_id');
    const hwElem = document.getElementById('server-hw-id');
    if (hwElem) hwElem.innerText = currentHardwareId;

    const isAct = await tauri.invoke('check_activation');
    if (!isAct) {
      document.getElementById('activation-modal')?.classList.remove('hidden');
      document.getElementById('start-modal')?.classList.add('hidden');
      document.getElementById('main-dashboard')?.classList.add('opacity-0', 'pointer-events-none');
      return false;
    } else {
      document.getElementById('activation-modal')?.classList.add('hidden');
      document.getElementById('start-modal')?.classList.remove('hidden');
      return true;
    }
  } catch (e) {
    console.error('Błąd sprawdzania aktywacji:', e);
    document.getElementById('activation-modal')?.classList.remove('hidden');
    document.getElementById('start-modal')?.classList.add('hidden');
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

function windowToggleMaximize() {
  const tauri = getTauri();
  if (tauri && tauri.invoke) tauri.invoke('window_toggle_maximize');
}

function windowClose() {
  openExitModal();
}

function openExitModal() {
  document.getElementById('exit-modal')?.classList.remove('hidden');
}

function closeExitModal() {
  document.getElementById('exit-modal')?.classList.add('hidden');
}

function confirmExitApp() {
  const tauri = getTauri();
  if (tauri && tauri.invoke) {
    tauri.invoke('window_close');
  } else {
    window.close();
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
    document.getElementById('start-modal')?.classList.remove('hidden');
    showToast(res, 'success');
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
        <span>Aktywuj Serwer</span>
      `;
    }
  }
}

function selectRoomPreset(count) {
  document.getElementById('rooms-count-input').value = count;
  document.querySelectorAll('.room-preset-btn').forEach((btn) => {
    if (parseInt(btn.dataset.count) === count) {
      btn.className = 'room-preset-btn py-2 px-3 rounded-xl border border-[#1e3a5f] bg-[#1e3a5f] text-white text-sm font-bold shadow-sm transition';
    } else {
      btn.className = 'room-preset-btn py-2 px-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 hover:border-[#1e3a5f] hover:bg-slate-50 transition';
    }
  });
}

function adjustRooms(delta) {
  const input = document.getElementById('rooms-count-input');
  let val = (parseInt(input.value) || 4) + delta;
  if (val < 1) val = 1;
  if (val > 16) val = 16;
  input.value = val;
  selectRoomPreset(val);
}

async function startServerAction() {
  const tauri = getTauri();
  if (tauri && tauri.invoke) {
    try {
      const isAct = await tauri.invoke('check_activation');
      if (!isAct) {
        document.getElementById('start-modal')?.classList.add('hidden');
        document.getElementById('activation-modal')?.classList.remove('hidden');
        showToast('Wymagana jest aktywacja serwera!', 'warning');
        return;
      }
    } catch (err) {
      document.getElementById('start-modal')?.classList.add('hidden');
      document.getElementById('activation-modal')?.classList.remove('hidden');
      return;
    }
  }

  const numRooms = parseInt(document.getElementById('rooms-count-input').value) || 4;
  roomsList = [];
  for (let i = 1; i <= numRooms; i++) roomsList.push(`Pokój ${i}`);
  document.getElementById('start-modal').classList.add('hidden');
  document.getElementById('main-dashboard').classList.remove('opacity-0', 'pointer-events-none');
  renderRooms();
  initAdminCheck();
  initDashboardListener();
  checkAndPromptFirewall();
  showToast(`Uruchomiono serwer z ${numRooms} pokojami`, 'success');
}

async function checkAndPromptFirewall() {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;
  try {
    const isConfigured = await tauri.invoke('check_firewall_rule');
    if (!isConfigured) {
      await tauri.invoke('add_firewall_rule');
    }
  } catch (e) {
    console.warn('Firewall auto-check:', e);
  }
}

async function handleFirewall() {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;
  try {
    showToast('Konfigurowanie Zapory Windows...', 'info');
    const res = await tauri.invoke('add_firewall_rule');
    showToast(res, 'success');
  } catch (err) {
    showToast(`Błąd zapory: ${err.message || err}`, 'error');
  }
}

function addNewRoom() {
  const name = `Pokój ${roomsList.length + 1}`;
  roomsList.push(name);
  renderRooms();
  showToast(`Utworzono nową grupę: ${name}`, 'info');
}

async function autoPairStudents() {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;

  if (globalClientsData.length === 0) {
    showToast('Brak połączonych uczniów do rozlosowania w pary!', 'warning');
    return;
  }

  const neededRooms = Math.ceil(globalClientsData.length / 2);
  while (roomsList.length < neededRooms) {
    roomsList.push(`Pokój ${roomsList.length + 1}`);
  }
  pendingRoomAssignments.clear();
  renderRooms();

  try {
    await tauri.invoke('auto_pair_clients', { rooms: roomsList });
    showToast(`Rozlosowano ${globalClientsData.length} uczniów w pary!`, 'success');
  } catch (err) {
    showToast(`Błąd losowania par: ${err.message || err}`, 'error');
  }
}

async function resetAllToPool() {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;

  pendingRoomAssignments.clear();
  globalClientsData.forEach((c) => {
    c.group = 'Brak';
    c.hand_raised = false;
  });
  lastRenderedClientsHash = '';
  updateUIWithData(globalClientsData);

  try {
    await tauri.invoke('reset_all_to_pool');
    showToast('Wszyscy uczniowie zostali przeniesieni do Poczekalni', 'info');
  } catch (err) {
    showToast(`Błąd resetowania: ${err.message || err}`, 'error');
  }
}


function toggleBroadcast(active) {
  const btn = document.getElementById('broadcast-btn');
  const text = document.getElementById('broadcast-text');
  if (active) {
    btn.classList.replace('bg-amber-500', 'bg-red-600');
    btn.classList.replace('hover:bg-amber-600', 'hover:bg-red-700');
    btn.classList.replace('border-amber-600/50', 'border-red-700/50');
    btn.classList.replace('shadow-amber-500/20', 'shadow-red-600/30');
    text.innerText = 'Nadawanie do wszystkich uczniów...';
  } else {
    btn.classList.replace('bg-red-600', 'bg-amber-500');
    btn.classList.replace('hover:bg-red-700', 'hover:bg-amber-600');
    btn.classList.replace('border-red-700/50', 'border-amber-600/50');
    btn.classList.replace('shadow-red-600/30', 'shadow-amber-500/20');
    text.innerText = 'Przytrzymaj, aby mówić do wszystkich';
  }
  getTauri().invoke('set_broadcast', { active }).catch(console.error);
}

function toggleListen(room) {
  activeListenRoom = activeListenRoom === room ? null : room;
  getTauri().invoke('set_listen_room', { room: activeListenRoom }).catch(console.error);
  renderRooms();
  if (activeListenRoom) {
    showToast(`Włączono podsłuch: ${room}`, 'warning');
  } else {
    showToast('Wyłączono podsłuch sal', 'info');
  }
}

function clearHand(ip) {
  getTauri().invoke('clear_hand', { ip }).catch(console.error);
  showToast('Zgłoszenie ucznia zostało odznaczone', 'info');
}

function renderRooms() {
  document.getElementById('rooms-container').innerHTML = roomsList
    .map((room) => {
      const isListen = activeListenRoom === room;
      return `
      <div class="room-card bg-white rounded-2xl border ${isListen ? 'border-2 border-red-500 shadow-xl ring-4 ring-red-100' : 'border-slate-200/90 shadow-sm'} flex flex-col min-h-[16rem] h-64 transition-all duration-200 overflow-hidden"
           data-room="${room}"
           ondragover="allowDrop(event)" ondrop="dropToRoom(event, '${room}')">
        
        <!-- NAGŁÓWEK POKOJU -->
        <div class="px-4 py-3 border-b flex justify-between items-center ${isListen ? 'bg-red-50/80 border-red-200' : 'bg-slate-50/90 border-slate-200'}">
          <div class="flex items-center gap-2">
            <span class="w-8 h-8 rounded-xl ${isListen ? 'bg-red-100 text-red-600' : 'bg-slate-200/80 text-[#1e3a5f]'} flex items-center justify-center">
              <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 3s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
            </span>
            <div>
              <span class="font-bold text-slate-800 text-sm block leading-tight">${room}</span>
              ${isListen ? '<span class="text-[10px] font-bold text-red-600 flex items-center gap-1 leading-none mt-0.5"><span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span> ODSŁUCH NA ŻYWO</span>' : ''}
            </div>
          </div>
          
          <div class="flex items-center gap-1.5">
            <button onclick="toggleListen('${room}')" class="text-xs px-3 py-1.5 rounded-xl shadow-sm border transition font-semibold flex items-center gap-1.5 cursor-pointer ${isListen ? 'bg-red-600 hover:bg-red-700 text-white border-red-700' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}">
              ${isListen 
                ? '<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg><span>Wyłącz</span>' 
                : '<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h1a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H5v-2a7 7 0 1 1 14 0v2h-2a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9z"/></svg><span>Podsłuch</span>'}
            </button>
            <button onclick="promptDeleteRoom('${room}')" title="Usuń ${room}" class="p-1.5 rounded-xl border border-slate-300 hover:border-red-300 bg-white hover:bg-red-50 text-slate-400 hover:text-red-600 transition active:scale-95 cursor-pointer flex items-center justify-center">
              <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
          </div>
        </div>

        <!-- STREFA ZRZUTU UCZNIÓW -->
        <div class="flex-1 overflow-y-auto p-2 space-y-1.5 room-drop-zone bg-white transition" data-room="${room}"
             ondragover="allowDrop(event)" ondrop="dropToRoom(event, '${room}')"></div>
      </div>
    `;
    })
    .join('');
  updateUIWithData(globalClientsData);
  updateMediaTargetSelect();
}

let roomToDelete = null;

function promptDeleteRoom(room) {
  const studentsInRoom = globalClientsData.filter((c) => c.group === room);
  if (studentsInRoom.length > 0) {
    roomToDelete = room;
    const title = document.getElementById('delete-room-title');
    const desc = document.getElementById('delete-room-desc');
    if (title) title.innerText = `Usunąć ${room}?`;
    if (desc) {
      const names = studentsInRoom.map((s) => s.name).join(', ');
      desc.innerHTML = `W pokoju znajduje się <b>${studentsInRoom.length}</b> uczniów (${names}).<br>Czy na pewno chcesz go usunąć? Uczniowie zostaną przeniesieni do <b>Poczekalni</b>.`;
    }
    document.getElementById('delete-room-modal')?.classList.remove('hidden');
  } else {
    executeDeleteRoom(room);
  }
}

function closeDeleteRoomModal() {
  roomToDelete = null;
  document.getElementById('delete-room-modal')?.classList.add('hidden');
}

function confirmDeleteRoom() {
  if (roomToDelete) {
    const r = roomToDelete;
    closeDeleteRoomModal();
    executeDeleteRoom(r);
  } else {
    closeDeleteRoomModal();
  }
}

async function executeDeleteRoom(room) {
  if (activeListenRoom === room) {
    toggleListen(room);
  }
  roomsList = roomsList.filter((r) => r !== room);

  // Przenieś lokalnie uczniów w tym pokoju do Poczekalni
  globalClientsData.forEach((c) => {
    if (c.group === room) {
      c.group = 'Brak';
    }
  });

  renderRooms();
  showToast(`Usunięto ${room}`, 'info');

  const tauri = getTauri();
  if (tauri && tauri.invoke) {
    try {
      await tauri.invoke('delete_room', { room });
    } catch (err) {
      console.error('Błąd usuwania pokoju:', err);
    }
  }
}

const pendingRoomAssignments = new Map();

let isDragging = false;
let isInteractingWithCard = false;
let currentDraggedIp = null;
let dragStartTime = 0;
let pointerDragState = null;

function cleanupPointerDrag() {
  window.removeEventListener('pointermove', onWindowPointerMove);
  window.removeEventListener('pointerup', onWindowPointerUp);
  window.removeEventListener('pointercancel', onWindowPointerCancel);

  if (pointerDragState?.ghostEl) {
    pointerDragState.ghostEl.remove();
  }
  if (pointerDragState?.card) {
    pointerDragState.card.classList.remove('opacity-35', 'scale-[0.98]');
  }

  document.body.classList.remove('is-dragging');
  document.querySelectorAll('.room-card, #clients-pool').forEach((rc) => {
    rc.classList.remove('drag-over');
  });

  pointerDragState = null;
}

function initCardDrag(ev, ip, clientName) {
  if (ev.button !== 0 && ev.pointerType === 'mouse') return;
  if (ev.target.closest('button') || ev.target.closest('select') || ev.target.closest('input')) {
    return;
  }

  const card = ev.currentTarget || ev.target.closest('[data-ip]');
  if (!card) return;

  cleanupPointerDrag();

  isInteractingWithCard = true;
  pointerDragState = {
    ip,
    name: clientName,
    card,
    startX: ev.clientX,
    startY: ev.clientY,
    hasStartedDrag: false,
    ghostEl: null,
  };

  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('pointercancel', onWindowPointerCancel);
}

function onWindowPointerMove(ev) {
  if (!pointerDragState) return;

  const dist = Math.hypot(ev.clientX - pointerDragState.startX, ev.clientY - pointerDragState.startY);

  if (!pointerDragState.hasStartedDrag && dist > 5) {
    pointerDragState.hasStartedDrag = true;
    isDragging = true;
    currentDraggedIp = pointerDragState.ip;
    dragStartTime = Date.now();
    document.body.classList.add('is-dragging');

    if (pointerDragState.card) {
      pointerDragState.card.classList.add('opacity-35', 'scale-[0.98]');
    }

    const cleanName = pointerDragState.name || 'Uczeń';
    const initials = getInitials(cleanName);
    const palette = getDeterministicPalette(cleanName);

    const ghost = document.createElement('div');
    ghost.id = 'pointer-drag-ghost';
    ghost.className = 'fixed z-[99999] pointer-events-none px-3.5 py-2.5 rounded-2xl bg-[#1e3a5f] text-white shadow-2xl border-2 border-emerald-400 flex items-center gap-2.5 text-xs font-bold select-none cursor-grabbing';
    ghost.style.transform = 'translate(-50%, -50%)';
    ghost.style.left = `${ev.clientX}px`;
    ghost.style.top = `${ev.clientY}px`;
    ghost.innerHTML = `
      <div class="w-6 h-6 rounded-lg bg-gradient-to-br ${palette.gradient} text-white flex items-center justify-center text-[10px] font-bold shadow-xs flex-shrink-0 border border-white/20">
        ${initials}
      </div>
      <div class="flex flex-col min-w-0 pr-1">
        <span class="font-bold text-white text-xs truncate max-w-[130px] leading-tight">${cleanName}</span>
        <span class="text-[9px] text-emerald-300 font-semibold uppercase tracking-wider mt-0.5">Przeciągnij do pokoju</span>
      </div>
    `;
    document.body.appendChild(ghost);
    pointerDragState.ghostEl = ghost;
  }

  if (pointerDragState.hasStartedDrag) {
    if (pointerDragState.ghostEl) {
      pointerDragState.ghostEl.style.left = `${ev.clientX}px`;
      pointerDragState.ghostEl.style.top = `${ev.clientY}px`;
    }

    const elementsUnder = document.elementsFromPoint(ev.clientX, ev.clientY);
    let targetRoomCard = null;
    let isOverPool = false;

    for (const el of elementsUnder) {
      if (el.id === 'pointer-drag-ghost' || el.closest('#pointer-drag-ghost')) continue;
      const rc = el.closest('.room-card');
      if (rc && rc.dataset.room) {
        targetRoomCard = rc;
        break;
      }
      if (el.id === 'clients-pool' || el.closest('#clients-pool') || el.closest('aside')) {
        isOverPool = true;
        break;
      }
    }

    document.querySelectorAll('.room-card').forEach((rc) => {
      if (rc === targetRoomCard) {
        rc.classList.add('drag-over');
      } else {
        rc.classList.remove('drag-over');
      }
    });

    const pool = document.getElementById('clients-pool');
    if (pool) {
      if (isOverPool) {
        pool.classList.add('drag-over');
      } else {
        pool.classList.remove('drag-over');
      }
    }
  }
}

function onWindowPointerUp(ev) {
  if (!pointerDragState) return;

  const state = pointerDragState;
  const didDrag = state.hasStartedDrag;
  cleanupPointerDrag();

  isDragging = false;
  isInteractingWithCard = false;
  currentDraggedIp = null;

  if (didDrag) {
    const elementsUnder = document.elementsFromPoint(ev.clientX, ev.clientY);
    let targetRoom = null;
    let isPool = false;

    for (const el of elementsUnder) {
      if (el.id === 'pointer-drag-ghost' || el.closest('#pointer-drag-ghost')) continue;
      const rc = el.closest('.room-card');
      if (rc && rc.dataset.room) {
        targetRoom = rc.dataset.room;
        break;
      }
      if (el.id === 'clients-pool' || el.closest('#clients-pool') || el.closest('aside')) {
        isPool = true;
        break;
      }
    }

    if (targetRoom) {
      assignClientToRoom(state.ip, targetRoom);
    } else if (isPool) {
      assignClientToRoom(state.ip, 'Brak');
    } else {
      updateUIWithData(globalClientsData);
    }
  }
}

function onWindowPointerCancel() {
  cleanupPointerDrag();
  isDragging = false;
  isInteractingWithCard = false;
  currentDraggedIp = null;
  updateUIWithData(globalClientsData);
}

function allowDrop(ev) {
  ev.preventDefault();
  if (ev.dataTransfer) {
    ev.dataTransfer.dropEffect = 'move';
  }
}

function dropToRoom(ev, roomName) {
  ev.preventDefault();
  ev.stopPropagation();
  const targetRoom = roomName || ev.target.closest('[data-room]')?.dataset?.room || ev.currentTarget?.dataset?.room;
  const ip = currentDraggedIp || (ev.dataTransfer && (ev.dataTransfer.getData('text/plain') || ev.dataTransfer.getData('text')));
  if (ip && ip !== 'undefined' && targetRoom) {
    assignClientToRoom(ip, targetRoom);
  }
}

function dropToPool(ev) {
  ev.preventDefault();
  ev.stopPropagation();
  const ip = currentDraggedIp || (ev.dataTransfer && (ev.dataTransfer.getData('text/plain') || ev.dataTransfer.getData('text')));
  if (ip && ip !== 'undefined') {
    assignClientToRoom(ip, 'Brak');
  }
}

window.addEventListener('dragover', (ev) => {
  ev.preventDefault();
  if (ev.dataTransfer) {
    ev.dataTransfer.dropEffect = 'move';
  }
});

window.addEventListener('drop', (ev) => {
  ev.preventDefault();
});

function assignClientToRoom(ip, room) {
  const client = globalClientsData.find((c) => c.ip === ip);
  if (client) {
    if (client.group === room) {
      updateUIWithData(globalClientsData);
      return;
    }
    client.group = room;
    client.hand_raised = false;
    pendingRoomAssignments.set(ip, { room, timestamp: Date.now() });
    lastRenderedClientsHash = '';
    updateUIWithData(globalClientsData);
    clearHand(ip);
    showToast(`Przeniesiono ${client.name} do: ${room === 'Brak' ? 'Poczekalni' : room}`, 'success');
  }
  const tauri = getTauri();
  if (tauri && tauri.invoke) {
    tauri.invoke('assign_client_room', { ip, room }).catch(console.error);
  }
}

async function initAdminCheck() {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;
  try {
    const isAdmin = await tauri.invoke('check_admin');
    if (!isAdmin) {
      showToast('Aplikacja uruchomiona bez uprawnień administratora (Zapora może wymagać potwierdzenia)', 'warning');
    }
  } catch (err) {
    console.error('Błąd sprawdzania uprawnień:', err);
  }
}

async function handleFirewall() {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;
  try {
    const res = await tauri.invoke('add_firewall_rule');
    showToast(res, 'success');
  } catch (err) {
    showToast(err, 'warning');
  }
}

// --- ODTWARZACZ CZYTANKI / LEKCJI (LISTENING COMPREHENSION) ---
let isMediaSeeking = false;

function formatAudioTime(secs) {
  if (isNaN(secs) || secs < 0) secs = 0;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

async function handleMediaFileSelect(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;

  showToast(`Wczytywanie i dekodowanie: ${file.name}...`, 'info');

  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = Array.from(new Uint8Array(arrayBuffer));
    const status = await tauri.invoke('media_load_bytes', { name: file.name, data: bytes });
    updateMediaUI(status);
    showToast(`Pomyślnie wczytano czytankę: ${file.name}`, 'success');
  } catch (err) {
    showToast(`Błąd wczytywania audio: ${err}`, 'warning');
  } finally {
    event.target.value = '';
  }
}

async function toggleMediaPlay() {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;

  const playBtn = document.getElementById('media-play-btn');
  const isPlaying = playBtn?.dataset.playing === 'true';

  try {
    if (isPlaying) {
      await tauri.invoke('media_pause');
    } else {
      await tauri.invoke('media_play');
    }
  } catch (err) {
    showToast(err, 'warning');
  }
}

async function stopMediaPlay() {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;
  try {
    await tauri.invoke('media_stop');
  } catch (err) {
    showToast(err, 'warning');
  }
}

function handleMediaSeekInput(value) {
  isMediaSeeking = true;
  const seekSlider = document.getElementById('media-seek-slider');
  const duration = parseFloat(seekSlider?.dataset.duration || '0');
  const curSecs = (parseFloat(value) / 100) * duration;
  const timeDisplay = document.getElementById('media-track-time');
  if (timeDisplay) {
    timeDisplay.innerText = `${formatAudioTime(curSecs)} / ${formatAudioTime(duration)}`;
  }
}

async function handleMediaSeekChange(value) {
  isMediaSeeking = false;
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;

  const seekSlider = document.getElementById('media-seek-slider');
  const duration = parseFloat(seekSlider?.dataset.duration || '0');
  const curSecs = (parseFloat(value) / 100) * duration;

  try {
    await tauri.invoke('media_seek', { positionSecs: curSecs });
  } catch (err) {
    showToast(err, 'warning');
  }
}

async function handleMediaVolume(value) {
  const vol = parseFloat(value) / 100.0;
  document.getElementById('media-volume-text').innerText = `${Math.round(value)}%`;
  const tauri = getTauri();
  if (tauri && tauri.invoke) {
    tauri.invoke('media_set_volume', { volume: vol }).catch(console.error);
  }
}

async function handleMediaTargetChange(target) {
  const tauri = getTauri();
  if (tauri && tauri.invoke) {
    tauri.invoke('media_set_target', { target }).catch(console.error);
    showToast(`Odbiorcy czytanki: ${target === 'all' ? 'Cała klasa' : target}`, 'info');
  }
}

function updateMediaUI(status) {
  if (!status) return;

  const titleElem = document.getElementById('media-track-title');
  const timeElem = document.getElementById('media-track-time');
  const playBtn = document.getElementById('media-play-btn');
  const stopBtn = document.getElementById('media-stop-btn');
  const seekSlider = document.getElementById('media-seek-slider');
  const playIcon = document.getElementById('media-play-icon');

  if (titleElem) {
    titleElem.innerText = status.file_name ? status.file_name : 'Brak wczytanego nagrania';
  }

  if (timeElem) {
    timeElem.innerText = `${formatAudioTime(status.current_time_secs)} / ${formatAudioTime(status.total_duration_secs)}`;
  }

  if (playBtn) {
    playBtn.disabled = !status.is_loaded;
    playBtn.dataset.playing = status.is_playing ? 'true' : 'false';
  }

  if (stopBtn) {
    stopBtn.disabled = !status.is_loaded;
  }

  if (seekSlider) {
    seekSlider.disabled = !status.is_loaded;
    seekSlider.dataset.duration = status.total_duration_secs.toString();
    if (!isMediaSeeking && status.total_duration_secs > 0) {
      const pct = (status.current_time_secs / status.total_duration_secs) * 100;
      seekSlider.value = pct;
    }
  }

  if (playIcon) {
    if (status.is_playing) {
      // Pause icon
      playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
      playBtn?.classList.replace('bg-emerald-600', 'bg-amber-600');
      playBtn?.classList.replace('hover:bg-emerald-500', 'hover:bg-amber-500');
    } else {
      // Play icon
      playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
      playBtn?.classList.replace('bg-amber-600', 'bg-emerald-600');
      playBtn?.classList.replace('hover:bg-amber-500', 'hover:bg-emerald-500');
    }
  }
}

function updateMediaTargetSelect() {
  const sel = document.getElementById('media-target-select');
  if (!sel) return;
  const currentVal = sel.value || 'all';

  let opts = '<option value="all">Wszyscy (Cała klasa)</option>';
  roomsList.forEach((r) => {
    opts += `<option value="${r}">${r}</option>`;
  });
  sel.innerHTML = opts;
  if (roomsList.includes(currentVal)) {
    sel.value = currentVal;
  } else {
    sel.value = 'all';
  }
}

let dashboardListenerInitialized = false;

function applyDashboardData(data) {
  if (!data) return;
  const mbpsElem = document.getElementById('mbps');
  if (mbpsElem && data.mbps !== undefined) {
    mbpsElem.innerText = data.mbps.toFixed(2) + ' Mbps';
  }
  const countElem = document.getElementById('count');
  if (countElem && data.active_clients) {
    countElem.innerText = data.active_clients.length;
  }
  const pingElem = document.getElementById('avg-ping');
  if (pingElem && data.avg_latency !== undefined) {
    const p = Math.round(data.avg_latency);
    pingElem.innerText = p + ' ms';
    if (p < 25) {
      pingElem.className = 'font-mono text-emerald-400 text-xs';
    } else if (p < 60) {
      pingElem.className = 'font-mono text-sky-400 text-xs';
    } else if (p < 100) {
      pingElem.className = 'font-mono text-amber-400 text-xs font-bold';
    } else {
      pingElem.className = 'font-mono text-red-400 text-xs font-bold animate-pulse';
    }
  }
  const now = Date.now();
  const rawClients = data.active_clients || [];

  // Zastosuj optymistyczne przypisania pokoi (chroni przed cofaniem przez odpytywanie 200ms)
  globalClientsData = rawClients.map((c) => {
    const pending = pendingRoomAssignments.get(c.ip);
    if (pending) {
      if (c.group === pending.room || now - pending.timestamp > 3000) {
        pendingRoomAssignments.delete(c.ip);
      } else {
        c.group = pending.room;
      }
    }
    return c;
  });

  // Watchdog: jeśli drag wisiał za długo, zresetuj
  if (isDragging && Date.now() - dragStartTime > 8000) {
    cleanupPointerDrag();
    isDragging = false;
    isInteractingWithCard = false;
    currentDraggedIp = null;
  }

  updateUIWithData(globalClientsData);
  if (data.media_status) {
    updateMediaUI(data.media_status);
  }
}

async function initDashboardListener() {
  if (dashboardListenerInitialized) return;
  dashboardListenerInitialized = true;
  const tauri = getTauri();

  // 1. Zdarzenie czasu rzeczywistego (push)
  if (tauri && tauri.listen) {
    try {
      await tauri.listen('request_close', () => {
        openExitModal();
      });

      await tauri.listen('dashboard_update', (event) => {
        applyDashboardData(event.payload);
      });
    } catch (err) {
      console.error('Błąd rejestracji listenera dashboard_update:', err);
    }
  }

  // 2. Cykliczne odpytywanie stanu (pull fallback) - gwarancja odświeżania
  setInterval(async () => {
    if (isDragging || isInteractingWithCard) return;
    const t = getTauri();
    if (t && t.invoke) {
      try {
        const data = await t.invoke('get_dashboard_data');
        if (data) {
          applyDashboardData(data);
        }
      } catch (e) {}
    }
  }, 500);
}

let lastRenderedClientsHash = '';

function getSignalBarsSvg(quality) {
  let active = 4;
  let color = '#10b981';
  if (quality === 'poor') {
    active = 1;
    color = '#ef4444';
  } else if (quality === 'fair') {
    active = 2;
    color = '#f59e0b';
  } else if (quality === 'good') {
    active = 3;
    color = '#0284c7';
  }
  return `
    <svg class="w-3.5 h-3 flex-shrink-0" viewBox="0 0 16 14" fill="none">
      <rect x="1"  y="10" width="2.5" height="4"  rx="0.5" fill="${active >= 1 ? color : '#cbd5e1'}" />
      <rect x="5"  y="7"  width="2.5" height="7"  rx="0.5" fill="${active >= 2 ? color : '#cbd5e1'}" />
      <rect x="9"  y="4"  width="2.5" height="10" rx="0.5" fill="${active >= 3 ? color : '#cbd5e1'}" />
      <rect x="13" y="1"  width="2.5" height="13" rx="0.5" fill="${active >= 4 ? color : '#cbd5e1'}" />
    </svg>
  `;
}

function updateUIWithData(clients) {
  if (isDragging || isInteractingWithCard) return;

  const currentHash = JSON.stringify(
    clients.map((c) => [c.ip, c.name, c.group, c.hand_raised, c.is_speaking, c.ping_ms, c.loss_pct, c.quality])
  );
  if (currentHash === lastRenderedClientsHash) {
    return;
  }
  lastRenderedClientsHash = currentHash;

  const roomZones = document.querySelectorAll('.room-drop-zone');
  roomZones.forEach((z) => (z.innerHTML = ''));

  let poolHtml = '';
  let poolCount = 0;

  clients.forEach((client) => {
    const h = client.hand_raised;
    const s = client.is_speaking;
    const ping = client.ping_ms || 0;
    const loss = client.loss_pct || 0;
    const q = client.quality || 'excellent';

    let pingBadgeClass = 'text-emerald-700 bg-emerald-50 border-emerald-200';
    let dotClass = 'bg-emerald-500';
    let statusText = 'Połączenie stabilne';

    if (q === 'poor') {
      pingBadgeClass = 'text-red-700 bg-red-50 border-red-300 animate-pulse';
      dotClass = 'bg-red-500';
      statusText = 'Słaba jakość sieci (duże opóźnienie/utrata pakietów)';
    } else if (q === 'fair') {
      pingBadgeClass = 'text-amber-700 bg-amber-50 border-amber-300';
      dotClass = 'bg-amber-500';
      statusText = 'Średnia jakość sieci';
    } else if (q === 'good') {
      pingBadgeClass = 'text-sky-700 bg-sky-50 border-sky-300';
      dotClass = 'bg-sky-500';
      statusText = 'Dobra jakość sieci';
    }

    const signalSvg = getSignalBarsSvg(q);
    const networkBadge = `
      <div class="flex items-center gap-1.5 px-2 py-0.5 rounded-lg border text-[10px] font-mono font-bold ${pingBadgeClass} flex-shrink-0 shadow-xs"
           title="Jakość połączenia: ${statusText}&#10;Ping: ${ping} ms&#10;Utrata pakietów: ${loss}%&#10;Adres IP: ${client.ip}">
        ${signalSvg}
        <span>${ping} ms</span>
        ${loss > 0 ? `<span class="text-red-600 font-extrabold ml-0.5">(${loss}%)</span>` : ''}
      </div>
    `;


    const bgRow = h
      ? 'bg-amber-50 border-amber-300 shadow-sm ring-1 ring-amber-300'
      : 'bg-white hover:bg-slate-50 border-slate-200 shadow-sm';

    const avatarGlow = s
      ? 'border-[#16a34a] bg-emerald-50 text-emerald-600 ring-2 ring-emerald-400'
      : 'border-slate-200 bg-slate-100 text-slate-400';

    let roomOptions = `<option value="Brak"${client.group === 'Brak' ? ' selected' : ''}>Poczekalnia</option>`;
    roomsList.forEach((r) => {
      roomOptions += `<option value="${r}"${client.group === r ? ' selected' : ''}>${r}</option>`;
    });

    const roomSelect = `
      <select onchange="assignClientToRoom('${client.ip}', this.value)"
              onmousedown="event.stopPropagation()"
              class="text-[10px] bg-slate-50 hover:bg-white border border-slate-300 hover:border-[#1e3a5f] rounded-lg px-1.5 py-0.5 font-bold text-[#1e3a5f] cursor-pointer focus:outline-none shadow-xs"
              title="Szybka zmiana pokoju dla tego ucznia">
        ${roomOptions}
      </select>
    `;

    const cleanName = (client.name || 'Uczeń').replace(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\p{Emoji})\s*/u, '').trim() || 'Uczeń';
    const initials = getInitials(cleanName);
    const palette = getDeterministicPalette(cleanName);
    const safeClientName = cleanName.replace(/'/g, "\\'");

    const cardHtml = `
      <div onpointerdown="initCardDrag(event, '${client.ip}', '${safeClientName}')"
           data-ip="${client.ip}"
           class="group flex items-center p-2 rounded-xl cursor-grab active:cursor-grabbing transition border ${bgRow} select-none"
           style="touch-action: none; -webkit-user-select: none; user-select: none;">
        
        <!-- DRAG HANDLE -->
        <svg class="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-600 mr-1.5 flex-shrink-0 fill-current pointer-events-none" viewBox="0 0 24 24">
          <path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
        </svg>

        <!-- AWATAR ZE WSKAŹNIKIEM MOWY -->
        <div class="relative w-7 h-7 rounded-lg mr-2 flex items-center justify-center font-bold text-[11px] bg-gradient-to-br ${palette.gradient} text-white shadow-xs border border-white/20 flex-shrink-0 pointer-events-none select-none">
          ${initials}
          <div class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 ${s ? 'bg-emerald-500 animate-pulse ring-2 ring-white' : 'bg-slate-300'} rounded-full"></div>
        </div>
        
        <!-- DANE UCZNIA + DIAGNOSTYKA SIECI -->
        <div class="flex-1 overflow-hidden min-w-0 pr-1 pointer-events-none">
          <div class="flex items-center justify-between gap-1">
            <span class="font-bold text-xs text-slate-800 truncate leading-tight">${cleanName}</span>
            ${networkBadge}
          </div>
          <div class="text-[10px] truncate mt-0.5">
            ${
              h
                ? '<span class="inline-flex items-center gap-1 font-bold text-amber-700"><svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M23 5.5V20c0 2.2-1.8 4-4 4h-7.3c-1.1 0-2.1-.4-2.8-1.2L2 15.9l1.4-1.4c.4-.4.9-.6 1.4-.6h.4l5.2 2.1V5.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5V12h1V3.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5V12h1V2c0-.8.7-1.5 1.5-1.5S20 1.2 20 2v10h1V5.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5z"/></svg> Prośba o pomoc</span>'
                : s
                ? '<span class="text-emerald-600 font-bold">Mówi w pokoju...</span>'
                : `<span class="text-slate-400 font-medium">${client.group !== 'Brak' ? client.group : 'Poczekalnia'}</span>`
            }
          </div>
        </div>

        <!-- SZYBKI WYBÓR POKOJU (ALTERNATYWA DLA DRAG&DROP) -->
        <div class="ml-1 flex-shrink-0 flex items-center gap-1">
          ${roomSelect}
          ${
            h
              ? `
            <button onclick="clearHand('${client.ip}')" class="p-1 rounded-md bg-amber-200 hover:bg-amber-300 text-amber-900 transition active:scale-95 cursor-pointer flex-shrink-0" title="Odznacz pomoc">
              <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M23 5.5V20c0 2.2-1.8 4-4 4h-7.3c-1.1 0-2.1-.4-2.8-1.2L2 15.9l1.4-1.4c.4-.4.9-.6 1.4-.6h.4l5.2 2.1V5.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5V12h1V3.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5V12h1V2c0-.8.7-1.5 1.5-1.5S20 1.2 20 2v10h1V5.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5z"/></svg>
            </button>
          `
              : ''
          }
        </div>
      </div>
    `;

    const roomZone = document.querySelector(`.room-drop-zone[data-room="${client.group}"]`);
    if (roomZone) {
      roomZone.innerHTML += cardHtml;
    } else {
      poolHtml += cardHtml;
      poolCount++;
    }
  });

  // Uzupełnienie pustych pokoi estetycznym placeholderem
  roomZones.forEach((z) => {
    if (!z.innerHTML.trim()) {
      z.innerHTML = `
        <div class="h-full border border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center p-3 text-center text-slate-400 select-none pointer-events-none">
          <svg class="w-5 h-5 text-slate-300 mb-1 fill-current pointer-events-none" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          <span class="text-[11px] text-slate-400 pointer-events-none">Przeciągnij uczniów tutaj</span>
        </div>
      `;
    }
  });

  const poolBadge = document.getElementById('pool-count-badge');
  if (poolBadge) poolBadge.innerText = poolCount;

  document.getElementById('clients-pool').innerHTML =
    poolHtml ||
    `
    <div class="h-40 border border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center p-4 text-center text-slate-400 select-none pointer-events-none">
      <svg class="w-6 h-6 text-slate-300 mb-1.5 fill-current pointer-events-none" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
      </svg>
      <span class="text-xs font-semibold text-slate-500 pointer-events-none">Poczekalnia jest pusta</span>
      <span class="text-[10px] text-slate-400 mt-0.5 pointer-events-none">Uczniowie pojawią się po połączeniu</span>
    </div>
  `;
}

// -------------------------------------------------------------
// POWIADOMIENIA TOAST (FLOATING ALERTS)
// -------------------------------------------------------------
function showToast(message, type = 'info') {
  let toastContainer = document.getElementById('global-toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'global-toast-container';
    toastContainer.className = 'fixed bottom-5 right-5 z-50 flex flex-col-reverse gap-2 max-w-sm pointer-events-none select-none';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  let bgClass = 'bg-slate-900/95 border-slate-700 text-white';
  let iconSvg = '<svg class="w-4 h-4 text-sky-400 fill-current flex-shrink-0" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>';

  if (type === 'success') {
    bgClass = 'bg-slate-900/95 border-emerald-500/60 text-emerald-100 shadow-emerald-950/40';
    iconSvg = '<svg class="w-4 h-4 text-emerald-400 fill-current flex-shrink-0" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>';
  } else if (type === 'warning') {
    bgClass = 'bg-slate-900/95 border-amber-500/60 text-amber-100 shadow-amber-950/40';
    iconSvg = '<svg class="w-4 h-4 text-amber-400 fill-current flex-shrink-0" viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>';
  } else if (type === 'error') {
    bgClass = 'bg-slate-900/95 border-red-500/60 text-red-100 shadow-red-950/40';
    iconSvg = '<svg class="w-4 h-4 text-red-400 fill-current flex-shrink-0" viewBox="0 0 24 24"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/></svg>';
  } else if (type === 'info') {
    bgClass = 'bg-slate-900/95 border-sky-500/60 text-sky-100 shadow-sky-950/40';
    iconSvg = '<svg class="w-4 h-4 text-sky-400 fill-current flex-shrink-0" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>';
  }

  toast.className = `flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border shadow-xl backdrop-blur-md text-xs font-semibold transform transition-all duration-300 pointer-events-auto opacity-0 translate-y-3 ${bgClass}`;
  toast.innerHTML = `
    ${iconSvg}
    <span class="flex-1">${message}</span>
  `;

  toastContainer.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.remove('opacity-0', 'translate-y-3');
  });

  // Auto remove after 4s
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-3');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}

// -------------------------------------------------------------
// SYSTEM AKTUALIZACJI APLIKACJI (OFICJALNY TAURI UPDATER)
// -------------------------------------------------------------
let pendingTauriUpdate = null;
let isUpdatingApp = false;

async function initAppVersion() {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;
  try {
    const version = await tauri.invoke('get_app_version');
    const badge = document.getElementById('header-version-badge');
    if (badge) badge.innerText = `v${version}`;
  } catch (err) {
    console.error('Błąd pobierania wersji aplikacji:', err);
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
      pendingTauriUpdate = res;
      showUpdateToast(res.latest_version, res.body);
      showToast(`Dostępna nowa wersja serwera: v${res.latest_version}!`, 'info');
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
    text.innerText = `Dostępna jest nowa wersja v${version}.${changelog ? ' ' + changelog.slice(0, 100) : ''}`;
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

  if (title) title.innerText = 'Pobieranie aktualizacji serwera...';
  if (subtitle) subtitle.innerText = version ? `Przygotowywanie nowej wersji v${version}` : 'Przygotowywanie nowej wersji programu';
  if (progressBar) {
    progressBar.style.width = '0%';
    progressBar.className = 'h-full bg-gradient-to-r from-emerald-600 to-teal-500 rounded-full transition-all duration-150';
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
  isUpdatingApp = false;
  const btn = document.getElementById('btn-install-tauri-update');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<span>Aktualizuj teraz</span>';
  }
}

function initServerUpdateListeners() {
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
  if (isUpdatingApp) return;
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;

  isUpdatingApp = true;
  openUpdateProgressModal(pendingTauriUpdate?.latest_version);

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
  checkActivationStatus();
  initDashboardListener();
  initAppVersion();
  initServerUpdateListeners();
  // Sprawdź aktualizacje automatycznie przy starcie aplikacji (600ms po zainicjowaniu widoku)
  setTimeout(() => {
    checkForAppUpdate(false);
  }, 600);
});


