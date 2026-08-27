function getTauri() {
  return window.__TAURI__
    ? {
        invoke: window.__TAURI__.core?.invoke || window.__TAURI__.invoke,
        listen: window.__TAURI__.event?.listen || window.__TAURI__.listen,
      }
    : null;
}

function confirmJoin() {
  const input = document.getElementById('join-name-input');
  const name = input.value.trim();
  if (name.length > 0 && name !== 'Uczeń') {
    localStorage.setItem('voip_username', name);
    document.getElementById('username-input').value = name;
    document.getElementById('display-name').innerText = name;
    document.getElementById('join-modal').classList.add('hidden');

    const tauri = getTauri();
    if (tauri && tauri.invoke) {
      tauri.invoke('set_username', { name });
    }
  } else {
    input.classList.add('ring-2', 'ring-red-500');
    input.focus();
  }
}

function saveUsername() {
  const name = document.getElementById('username-input').value.trim();
  if (name.length > 0 && name !== 'Uczeń') {
    localStorage.setItem('voip_username', name);
    document.getElementById('display-name').innerText = name;
    const tauri = getTauri();
    if (tauri && tauri.invoke) {
      tauri.invoke('set_username', { name });
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

async function initClientListener() {
  const tauri = getTauri();
  if (!tauri || !tauri.listen) {
    setTimeout(initClientListener, 100);
    return;
  }

  const savedName = (localStorage.getItem('voip_username') || '').trim();
  const joinModal = document.getElementById('join-modal');
  const joinInput = document.getElementById('join-name-input');

  // Weryfikacja: jeśli brak imienia, zablokuj ekran modalem
  if (!savedName || savedName === 'Uczeń') {
    joinModal.classList.remove('hidden');
    joinInput.focus();
  } else {
    joinModal.classList.add('hidden');
    document.getElementById('username-input').value = savedName;
    document.getElementById('display-name').innerText = savedName;
    if (tauri.invoke) tauri.invoke('set_username', { name: savedName });
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

window.addEventListener('DOMContentLoaded', initClientListener);
