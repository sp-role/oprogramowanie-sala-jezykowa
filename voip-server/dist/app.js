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

// System nowoczesnych powiadomień Toast (zastępuje surowe alerty)
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const bg =
    type === 'success'
      ? 'bg-slate-900/90 border-emerald-500/50 text-white'
      : type === 'warning'
      ? 'bg-slate-900/90 border-amber-500/50 text-white'
      : 'bg-slate-900/90 border-slate-700 text-white';

  const icon =
    type === 'success'
      ? '<svg class="w-5 h-5 text-emerald-400 fill-current" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>'
      : '<svg class="w-5 h-5 text-sky-400 fill-current" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>';

  toast.className = `flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-xl backdrop-blur-md text-xs font-semibold transform transition-all duration-300 translate-y-4 opacity-0 pointer-events-auto ${bg}`;
  toast.innerHTML = `${icon}<span>${message}</span>`;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-4', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('translate-y-4', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
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
  const serverUrlInput = document.getElementById('license-server-url');
  const code = (input?.value || '').trim().toUpperCase();

  if (!code) {
    if (errorMsg) {
      errorMsg.innerText = 'Wpisz kod aktywacyjny (np. ROLE-XXXX-XXXX).';
      errorMsg.classList.remove('hidden');
    }
    return;
  }

  const serverUrl = (serverUrlInput?.value || '').trim() || localStorage.getItem('voip_license_server_url') || 'http://localhost/php-licensing-server/api.php';
  localStorage.setItem('voip_license_server_url', serverUrl);

  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>Weryfikacja kodu...</span>';
  }

  try {
    let token = null;

    // Próba weryfikacji online przez serwer PHP
    try {
      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'activate',
          code: code,
          hardware_id: currentHardwareId,
          computer_name: 'Panel Nauczyciela (Serwer)'
        })
      });

      const data = await response.json();
      if (response.ok && data.status === 'success') {
        token = data.token;
      } else if (data && data.message) {
        throw new Error(data.message);
      }
    } catch (netErr) {
      if (netErr.message && (netErr.message.includes('użyty') || netErr.message.includes('innym komputerze') || netErr.message.includes('Nieprawidłowy kod'))) {
        throw netErr;
      }
      console.warn('Tryb offline/błąd połączenia z serwerem PHP:', netErr);
    }

    const res = await tauri.invoke('activate_license', { code, token });
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
  showToast(`Uruchomiono serwer z ${numRooms} pokojami`, 'success');
}

function addNewRoom() {
  const name = `Pokój ${roomsList.length + 1}`;
  roomsList.push(name);
  renderRooms();
  showToast(`Utworzono nową grupę: ${name}`, 'info');
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
      <div class="bg-white rounded-2xl border ${isListen ? 'border-2 border-red-500 shadow-xl ring-4 ring-red-100' : 'border-slate-200/90 shadow-sm'} flex flex-col h-64 transition-all duration-200 overflow-hidden"
           ondragover="allowDrop(event)" ondrop="dropToRoom(event, '${room}')">
        
        <!-- NAGŁÓWEK POKOJU -->
        <div class="px-4 py-3 border-b flex justify-between items-center ${isListen ? 'bg-red-50/80 border-red-200' : 'bg-slate-50/90 border-slate-200'}">
          <div class="flex items-center gap-2">
            <span class="w-8 h-8 rounded-xl ${isListen ? 'bg-red-100 text-red-600' : 'bg-slate-200/80 text-[#1e3a5f]'} flex items-center justify-center">
              <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 3s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
            </span>
            <div>
              <span class="font-bold text-slate-800 text-sm block leading-tight">${room}</span>
              ${isListen ? '<span class="text-[10px] font-bold text-red-600 flex items-center gap-1 leading-none mt-0.5"><span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping"></span> ODSŁUCH NA ŻYWO</span>' : ''}
            </div>
          </div>
          
          <button onclick="toggleListen('${room}')" class="text-xs px-3 py-1.5 rounded-xl shadow-sm border transition font-semibold flex items-center gap-1.5 cursor-pointer ${isListen ? 'bg-red-600 hover:bg-red-700 text-white border-red-700' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}">
            ${isListen 
              ? '<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg><span>Wyłącz</span>' 
              : '<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M17 20c-.29 0-.56-.06-.76-.15-.71-.37-1.21-.88-1.71-2.38-.51-1.56-1.29-2.39-3-.79-.61-1.61-1.24-2.32-2.53C9.29 10.98 9 9.93 9 9c0-2.8 2.2-5 5-5s5 2.2 5 5h2c0-3.9-3.1-7-7-7s-7 3.1-7 7c0 1.3.4 2.7 1.1 3.9.9 1.6 2 2.5 2.9 3.2.7.6 1.3 1.1 1.6 1.9.4 1.2.7 2.1 1.7 2.6.4.3.9.4 1.4.4 1.1 0 2.1-.9 2.1-2h-2c0 .6-.4 1-.8 1z"/></svg><span>Podsłuch</span>'}
          </button>
        </div>

        <!-- STREFA ZRZUTU UCZNIÓW -->
        <div class="flex-1 overflow-y-auto p-2 space-y-1.5 room-drop-zone bg-white" data-room="${room}"></div>
      </div>
    `;
    })
    .join('');
  updateUIWithData(globalClientsData);
}

function drag(ev) {
  ev.dataTransfer.setData('text/plain', ev.target.dataset.ip);
}

function allowDrop(ev) {
  ev.preventDefault();
}

function dropToRoom(ev, roomName) {
  ev.preventDefault();
  assignClientToRoom(ev.dataTransfer.getData('text/plain'), roomName);
}

function dropToPool(ev) {
  ev.preventDefault();
  assignClientToRoom(ev.dataTransfer.getData('text/plain'), 'Brak');
}

function assignClientToRoom(ip, room) {
  const client = globalClientsData.find((c) => c.ip === ip);
  if (client) {
    const oldRoom = client.group;
    client.group = room;
    client.hand_raised = false;
    updateUIWithData(globalClientsData);
    clearHand(ip);
    showToast(`Przeniesiono ${client.name} do ${room === 'Brak' ? 'Poczekalni' : room}`, 'success');
  }
  getTauri().invoke('assign_client_room', { ip, room }).catch(console.error);
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

async function initDashboardListener() {
  const tauri = getTauri();
  if (!tauri || !tauri.listen) {
    setTimeout(initDashboardListener, 100);
    return;
  }
  await tauri.listen('dashboard_update', (event) => {
    const data = event.payload;
    document.getElementById('mbps').innerText = data.mbps.toFixed(2) + ' Mbps';
    document.getElementById('count').innerText = data.active_clients.length;
    globalClientsData = data.active_clients;
    updateUIWithData(globalClientsData);
  });
}

function updateUIWithData(clients) {
  const roomZones = document.querySelectorAll('.room-drop-zone');
  roomZones.forEach((z) => (z.innerHTML = ''));

  let poolHtml = '';
  let poolCount = 0;

  clients.forEach((client) => {
    const h = client.hand_raised;
    const s = client.is_speaking;

    const bgRow = h
      ? 'bg-amber-50/90 border-amber-300 shadow-md ring-2 ring-amber-200'
      : 'bg-white hover:bg-slate-50 border-slate-200/80 hover:border-slate-300 shadow-sm';

    const avatarGlow = s
      ? 'border-[#16a34a] shadow-[0_0_12px_rgba(22,163,74,0.8)] scale-105'
      : 'border-slate-200 shadow-inner';

    const cardHtml = `
      <div draggable="true" ondragstart="drag(event)" data-ip="${client.ip}"
           class="group flex items-center p-2.5 rounded-xl cursor-grab active:cursor-grabbing transition-all duration-150 border transform hover:-translate-y-0.5 ${bgRow}">
        
        <!-- UCHWYT DRAG INDICATOR (6 KROPEK) -->
        <svg class="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 mr-2 flex-shrink-0 fill-current transition-colors" viewBox="0 0 24 24">
          <path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
        </svg>

        <!-- AWATAR ZE WSKAŹNIKIEM MOWY -->
        <div class="relative w-9 h-9 bg-slate-100 rounded-xl mr-3 flex items-center justify-center transition-all duration-150 border ${avatarGlow}">
          <svg class="w-5 h-5 ${s ? 'text-[#16a34a]' : 'text-slate-400'} fill-current transition-colors" viewBox="0 0 24 24">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
          </svg>
          <div class="absolute -bottom-1 -right-1 w-3 h-3 ${s ? 'bg-[#16a34a] animate-pulse' : 'bg-emerald-500'} rounded-full border-2 border-white shadow-sm"></div>
        </div>
        
        <!-- DANE UCZNIA -->
        <div class="flex-1 overflow-hidden">
          <div class="font-bold text-[13px] text-slate-800 truncate leading-tight">${client.name}</div>
          <div class="text-[11px] ${h ? 'text-amber-600 font-bold animate-pulse' : s ? 'text-[#16a34a] font-bold' : 'text-slate-500'} truncate mt-0.5">
            ${h ? '✋ Zgłasza się po pomoc!' : s ? 'Mówi w pokoju...' : client.group !== 'Brak' ? 'W grupie' : client.ip}
          </div>
        </div>

        ${
          h
            ? `
          <button onclick="clearHand('${client.ip}')" class="p-1.5 ml-2 rounded-lg bg-amber-200/80 hover:bg-amber-300 text-amber-800 transition active:scale-95 cursor-pointer" title="Odznacz pomoc">
            <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M23 5.5V20c0 2.2-1.8 4-4 4h-7.3c-1.1 0-2.1-.4-2.8-1.2L2 15.9l1.4-1.4c.4-.4.9-.6 1.4-.6h.4l5.2 2.1V5.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5V12h1V3.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5V12h1V2c0-.8.7-1.5 1.5-1.5S20 1.2 20 2v10h1V5.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5z"/></svg>
          </button>
        `
            : ''
        }
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
        <div class="h-full border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center p-4 text-center text-slate-400 select-none">
          <svg class="w-6 h-6 text-slate-300 mb-1.5 fill-current" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          <span class="text-xs font-medium text-slate-400">Przeciągnij uczniów tutaj</span>
        </div>
      `;
    }
  });

  const poolBadge = document.getElementById('pool-count-badge');
  if (poolBadge) poolBadge.innerText = poolCount;

  document.getElementById('clients-pool').innerHTML =
    poolHtml ||
    `
    <div class="h-48 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center p-6 text-center text-slate-400 select-none">
      <svg class="w-8 h-8 text-slate-300 mb-2 fill-current" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
      <span class="text-xs font-semibold text-slate-500">Poczekalnia jest pusta</span>
      <span class="text-[11px] text-slate-400 mt-1">Uczniowie pojawią się po włączeniu aplikacji</span>
    </div>
  `;
}

// -------------------------------------------------------------
// SYSTEM AKTUALIZACJI APLIKACJI (FTP / HTTP)
// -------------------------------------------------------------
let pendingUpdateInfo = null;

async function initAppVersion() {
  const tauri = getTauri();
  if (!tauri || !tauri.invoke) return;
  try {
    const version = await tauri.invoke('get_app_version');
    const badge = document.getElementById('header-version-badge');
    const modalV = document.getElementById('update-modal-current-v');
    if (badge) badge.innerText = `v${version}`;
    if (modalV) modalV.innerText = `v${version}`;
  } catch (err) {
    console.error('Błąd pobierania wersji aplikacji:', err);
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
    if (manual) showToast('Wpisz adres serwera aktualizacji FTP lub HTTP (np. http://.../version.json)', 'warning');
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
    pendingUpdateInfo = info;

    if (statusBox) statusBox.classList.remove('hidden');

    if (info.has_update) {
      if (alertBanner) {
        alertBanner.className = 'p-3.5 rounded-2xl border mb-3 bg-emerald-50 border-emerald-300 text-emerald-900';
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
          <span>Zainstaluj i zrestartuj teraz (v${info.latest_version})</span>
        `;
      }

      showToast(`Dostępna nowa wersja serwera: v${info.latest_version}!`, 'info');
      if (!manual) openUpdateModal();
    } else {
      if (alertBanner) {
        alertBanner.className = 'p-3.5 rounded-2xl border mb-3 bg-slate-100 border-slate-300 text-slate-700';
        alertBanner.innerHTML = `
          <div class="font-bold text-xs flex items-center gap-1.5">
            <svg class="w-4 h-4 text-[#16a34a] fill-current" viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
            <span>Posiadasz najnowszą wersję programu (v${info.current_version}).</span>
          </div>
        `;
      }
      changelogBox?.classList.add('hidden');
      btnInstall?.classList.add('hidden');
      if (manual) showToast('Aplikacja jest aktualna!', 'success');
    }
  } catch (err) {
    console.error('Błąd sprawdzania aktualizacji:', err);
    if (statusBox) statusBox.classList.remove('hidden');
    if (alertBanner) {
      alertBanner.className = 'p-3.5 rounded-2xl border mb-3 bg-red-50 border-red-200 text-red-700';
      alertBanner.innerText = `Błąd: ${err}`;
    }
    if (manual) showToast(`Błąd aktualizacji: ${err}`, 'warning');
  } finally {
    if (btnCheck) {
      btnCheck.disabled = false;
      btnCheck.innerText = 'Sprawdź';
    }
  }
}

async function applyUpdateNow() {
  if (!pendingUpdateInfo || !pendingUpdateInfo.download_url) {
    showToast('Brak adresu pliku aktualizacji!', 'warning');
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
      <span>Pobieranie i restartowanie...</span>
    `;
  }
  if (btnClose) btnClose.disabled = true;

  if (alertBanner) {
    alertBanner.className = 'p-3.5 rounded-2xl border mb-3 bg-sky-50 border-sky-300 text-sky-900';
    alertBanner.innerText = 'Pobieranie nowej wersji z serwera FTP/HTTP. Program zamknie się i zaktualizuje za chwilę...';
  }

  try {
    const tauri = getTauri();
    const res = await tauri.invoke('install_update', { downloadUrl: pendingUpdateInfo.download_url });
    showToast(res, 'success');
    setTimeout(() => {
      // Zamknięcie aplikacji w celu umożliwienia podmiany pliku
      window.close();
    }, 1500);
  } catch (err) {
    console.error('Błąd instalacji aktualizacji:', err);
    showToast(`Błąd instalacji: ${err}`, 'warning');
    if (btnInstall) {
      btnInstall.disabled = false;
      btnInstall.innerText = 'Spróbuj ponownie';
    }
    if (btnClose) btnClose.disabled = false;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  checkActivationStatus();
  initAppVersion();
  // Sprawdź aktualizacje po 3 sekundach od startu jeśli jest zapisany URL
  setTimeout(() => {
    const savedUrl = localStorage.getItem('voip_update_url');
    if (savedUrl) checkForUpdates(false);
  }, 3000);
});
