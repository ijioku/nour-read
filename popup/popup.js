// Lumina Read Aloud — Popup Controller

const NEURAL_VOICES = [
  { id: 'ava_us', label: '👩 ✨ Ava HD — US Female (24kHz Default)', lang: 'en-US' },
  { id: 'aria_us', label: '👩 ✨ Aria — US Female (Warm)', lang: 'en-US' },
  { id: 'jenny_us', label: '👩 ✨ Jenny — US Female (Friendly)', lang: 'en-US' },
  { id: 'sonia_gb', label: '👩 ✨ Sonia — UK British Female (24kHz)', lang: 'en-GB' },
  { id: 'andrew_us', label: '👨 ✨ Andrew HD — US Male (24kHz)', lang: 'en-US' },
  { id: 'guy_us', label: '👨 ✨ Guy — US Male (Storyteller)', lang: 'en-US' },
  { id: 'ryan_gb', label: '👨 ✨ Ryan — UK British Male (24kHz)', lang: 'en-GB' }
];

const $ = (id) => document.getElementById(id);

let currentSettings = {
  theme: 'auto',
  voiceId: 'ava_us',
  rate: 1.0,
  hoverButtonsEnabled: true,
  selectionPillEnabled: true,
  autoScroll: true,
  highlightReading: true,
  describeImagesAndTables: true,
  skipLinksAndCode: true,
  // Hostnames where hover buttons are paused by the user
  mutedHosts: [],
  languageFilter: 'all',
  geminiApiKey: ''
};
let bridgeOnline = false;
let speechVoices = [];
// Track the active tab's hostname for the per-site mute toggle
let activeHostname = '';

function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(pref) {
  document.documentElement.setAttribute('data-theme', resolveTheme(pref));
  document.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeVal === pref);
  });
}

function getLangDisplayName(code) {
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'language' });
    return `${dn.of(code)} (${code})`;
  } catch (e) {
    return code;
  }
}

function populateLanguagesAndVoices() {
  speechVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];

  // Build unique language codes
  const langSet = new Set(['en-US', 'en-GB']);
  speechVoices.forEach((v) => {
    if (v.lang) langSet.add(v.lang);
  });
  const sortedLangs = Array.from(langSet).sort();

  const langFilter = $('langFilter');
  langFilter.innerHTML = '';
  const allOpt = document.createElement('option');
  allOpt.value = 'all';
  allOpt.textContent = `🌍 All Languages (${sortedLangs.length} available)`;
  langFilter.appendChild(allOpt);

  sortedLangs.forEach((code) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = getLangDisplayName(code);
    langFilter.appendChild(opt);
  });
  langFilter.value = sortedLangs.includes(currentSettings.languageFilter) ? currentSettings.languageFilter : 'all';

  renderVoiceOptions();
}

function renderVoiceOptions() {
  const filter = $('langFilter').value || 'all';
  const voiceSelect = $('voiceSelect');
  voiceSelect.innerHTML = '';

  const matchingNeural = NEURAL_VOICES.filter((v) => filter === 'all' || v.lang.toLowerCase().startsWith(filter.toLowerCase()));
  if (matchingNeural.length > 0) {
    const grp = document.createElement('optgroup');
    grp.label = bridgeOnline ? '✨ 24kHz Natural Studio Voices (Active)' : '✨ 24kHz Natural Voices (Auto Fallback if Bridge Off)';
    matchingNeural.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.label;
      grp.appendChild(opt);
    });
    voiceSelect.appendChild(grp);
  }

  const matchingSpeech = speechVoices.filter((v) => filter === 'all' || (v.lang || '').toLowerCase().startsWith(filter.toLowerCase()));
  if (matchingSpeech.length > 0) {
    const grp = document.createElement('optgroup');
    grp.label = `🌐 Browser & OS Voices (${matchingSpeech.length})`;
    matchingSpeech.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = `speech:${v.voiceURI}`;
      opt.textContent = `${v.name} — ${v.lang}`;
      grp.appendChild(opt);
    });
    voiceSelect.appendChild(grp);
  }

  if (Array.from(voiceSelect.options).some((o) => o.value === currentSettings.voiceId)) {
    voiceSelect.value = currentSettings.voiceId;
  } else if (voiceSelect.options.length > 0) {
    voiceSelect.selectedIndex = 0;
  }
}

async function sendToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch (e) {
    // Restricted page like chrome://extensions
  }
}

async function init() {
  const stored = await chrome.storage.local.get(Object.keys(currentSettings));
  currentSettings = { ...currentSettings, ...stored };

  applyTheme(currentSettings.theme);
  $('rateSlider').value = currentSettings.rate;
  $('rateValue').textContent = `${Number(currentSettings.rate).toFixed(2).replace(/\.00$/, '.0')}x`;
  $('toggleHover').checked = Boolean(currentSettings.hoverButtonsEnabled);
  $('toggleSelectionPill').checked = Boolean(currentSettings.selectionPillEnabled);
  $('toggleVisuals').checked = Boolean(currentSettings.describeImagesAndTables);
  $('toggleSkipLinks').checked = currentSettings.skipLinksAndCode !== false;
  $('toggleHighlight').checked = Boolean(currentSettings.highlightReading);

  // Detect the active tab's hostname so the per-site mute toggle reflects this website
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && /^https?:\/\//i.test(tab.url)) {
      activeHostname = new URL(tab.url).hostname;
      const mutedList = Array.isArray(currentSettings.mutedHosts) ? currentSettings.mutedHosts : [];
      $('siteMuteHost').textContent = `Mute hover buttons on ${activeHostname}`;
      $('toggleSiteMute').checked = mutedList.includes(activeHostname);
      $('toggleSiteMute').disabled = false;
    } else {
      $('siteMuteHost').textContent = 'Open a regular webpage to mute by site';
      $('toggleSiteMute').disabled = true;
    }
  } catch (e) {
    $('toggleSiteMute').disabled = true;
  }

  if (currentSettings.geminiApiKey && currentSettings.geminiApiKey.trim()) {
    $('geminiKeyInput').value = currentSettings.geminiApiKey;
    $('aiBadge').textContent = 'AI Vision Active';
    $('aiBadge').classList.add('active');
  }

  populateLanguagesAndVoices();
  if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = populateLanguagesAndVoices;
  }

  // Check 24kHz local bridge health
  chrome.runtime.sendMessage({ type: 'TTS_BRIDGE_HEALTH' }, (res) => {
    bridgeOnline = Boolean(res && res.ok);
    const dot = $('bridgeDot');
    const lbl = $('bridgeLabel');
    if (bridgeOnline) {
      dot.classList.add('online');
      lbl.textContent = '✨ 24kHz Natural Bridge Online';
    } else {
      dot.classList.remove('online');
      lbl.textContent = '🌐 Browser Voices Mode (Bridge Off)';
    }
    renderVoiceOptions();
  });
}

// Event Listeners
document.querySelectorAll('.seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const val = btn.dataset.themeVal;
    currentSettings.theme = val;
    applyTheme(val);
    chrome.storage.local.set({ theme: val });
  });
});

$('langFilter').addEventListener('change', () => {
  currentSettings.languageFilter = $('langFilter').value;
  chrome.storage.local.set({ languageFilter: currentSettings.languageFilter });
  renderVoiceOptions();
});

$('voiceSelect').addEventListener('change', () => {
  currentSettings.voiceId = $('voiceSelect').value;
  chrome.storage.local.set({ voiceId: currentSettings.voiceId });
});

$('rateSlider').addEventListener('input', () => {
  const val = parseFloat($('rateSlider').value);
  $('rateValue').textContent = `${val.toFixed(2).replace(/\.00$/, '.0')}x`;
  currentSettings.rate = val;
  chrome.storage.local.set({ rate: val });
});

$('toggleHover').addEventListener('change', () => {
  chrome.storage.local.set({ hoverButtonsEnabled: $('toggleHover').checked });
});
// Save or remove the current website's hostname from the mutedHosts list
$('toggleSiteMute').addEventListener('change', () => {
  if (!activeHostname) return;
  const mutedList = Array.isArray(currentSettings.mutedHosts) ? [...currentSettings.mutedHosts] : [];
  const nextSet = new Set(mutedList);
  if ($('toggleSiteMute').checked) nextSet.add(activeHostname);
  else nextSet.delete(activeHostname);
  currentSettings.mutedHosts = Array.from(nextSet);
  chrome.storage.local.set({ mutedHosts: currentSettings.mutedHosts });
});
$('toggleSelectionPill').addEventListener('change', () => {
  chrome.storage.local.set({ selectionPillEnabled: $('toggleSelectionPill').checked });
});
$('toggleVisuals').addEventListener('change', () => {
  chrome.storage.local.set({ describeImagesAndTables: $('toggleVisuals').checked });
});
$('toggleSkipLinks').addEventListener('change', () => {
  chrome.storage.local.set({ skipLinksAndCode: $('toggleSkipLinks').checked });
});
$('toggleHighlight').addEventListener('change', () => {
  const on = $('toggleHighlight').checked;
  chrome.storage.local.set({ highlightReading: on, autoScroll: on });
});

$('btnSaveKey').addEventListener('click', async () => {
  const key = $('geminiKeyInput').value.trim();
  await chrome.storage.local.set({ geminiApiKey: key });
  const badge = $('aiBadge');
  const status = $('keyStatus');
  if (key) {
    badge.textContent = 'AI Vision Active';
    badge.classList.add('active');
    status.textContent = 'Saved locally on your device!';
  } else {
    badge.textContent = 'Local Mode';
    badge.classList.remove('active');
    status.textContent = 'Key cleared (using offline local mode).';
  }
  setTimeout(() => {
    status.textContent = '';
  }, 2500);
});

$('btnReadSelection').addEventListener('click', () => sendToActiveTab({ type: 'CMD_READ_SELECTION' }));
$('btnReadPage').addEventListener('click', () => sendToActiveTab({ type: 'CMD_READ_PAGE' }));
$('btnToggleDock').addEventListener('click', () => sendToActiveTab({ type: 'CMD_TOGGLE_PLAYER' }));
$('btnStop').addEventListener('click', () => sendToActiveTab({ type: 'CMD_STOP' }));

init();
