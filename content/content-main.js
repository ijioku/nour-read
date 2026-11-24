// Lumina Read Aloud — Main Content Script
// Isolated Shadow DOM Floating Player, Single Clutter-Free Hover Button,
// Selection Pill, Reading Queue, Dual-Engine 24kHz Neural + All-Language TTS.

(() => {
  if (window.__LUMINA_READ_ALOUD_LOADED__) return;
  window.__LUMINA_READ_ALOUD_LOADED__ = true;

  const NEURAL_VOICES = [
    { id: 'ava_us', label: '👩 ✨ Ava HD — US Female (24kHz)', short: 'Ava HD', lang: 'en-US' },
    { id: 'aria_us', label: '👩 ✨ Aria — US Female (Warm)', short: 'Aria', lang: 'en-US' },
    { id: 'jenny_us', label: '👩 ✨ Jenny — US Female (Friendly)', short: 'Jenny', lang: 'en-US' },
    { id: 'sonia_gb', label: '👩 ✨ Sonia — UK Female (24kHz)', short: 'Sonia UK', lang: 'en-GB' },
    { id: 'andrew_us', label: '👨 ✨ Andrew HD — US Male (24kHz)', short: 'Andrew HD', lang: 'en-US' },
    { id: 'guy_us', label: '👨 ✨ Guy — US Male (Storyteller)', short: 'Guy', lang: 'en-US' },
    { id: 'ryan_gb', label: '👨 ✨ Ryan — UK Male (24kHz)', short: 'Ryan UK', lang: 'en-GB' }
  ];
  const NEURAL_MAP = Object.fromEntries(NEURAL_VOICES.map((v) => [v.id, v]));
  const SPEEDS = [0.75, 0.9, 1.0, 1.15, 1.25, 1.5, 1.75, 2.0];

  const state = {
    settings: {
      theme: 'auto',
      voiceId: 'ava_us',
      rate: 1.0,
      hoverButtonsEnabled: true,
      selectionPillEnabled: true,
      autoScroll: true,
      highlightReading: true,
      describeImagesAndTables: true,
      skipLinksAndCode: true,
      // List of hostnames where the user muted hover buttons
      mutedHosts: [],
      languageFilter: 'all'
    },
    bridgeOnline: false,
    queue: [], // Array<{ text: string, el: Element|null, label: string }>
    currentIndex: 0,
    isPlaying: false,
    isPaused: false,
    activeEngine: 'none', // 'neural' | 'speech' | 'none'
    playerVisible: false,
    playerMinimized: false,
    activeHighlightEl: null,
    hoveredEl: null,
    hoverKind: null, // 'text' | 'table' | 'visual'
    // Track the element waiting for hover-intent so moving inside it doesn't reset the timer
    pendingHoverEl: null,
    pendingHoverKind: null,
    // Remember if the hover button is currently visible so it glides between targets instead of jumping
    hoverBtnVisible: false,
    // Remember the cursor's position and the button's current coordinates for smooth mouse-following
    lastPointerX: 0,
    lastPointerY: 0,
    hoverBtnX: 0,
    hoverBtnY: 0,
    hoverHideTimer: null,
    hoverIntentTimer: null,
    hoverRafPending: false,
    speechTimer: null,
    lastContextTarget: null,
    audioCache: new Map(),
    // Track in-flight TTS requests so clicking Play/Next reuses an already-running fetch
    inFlightAudio: new Map(),
    // Cache decoded Web Audio buffers so replays and Previous/Next jumps start in 0ms
    decodedBufferCache: new Map(),
    playSessionId: 0,
    speechVoices: [],
    // Web Audio API handles for CSP-proof 24kHz playback (never blocked on Google Images / GitHub)
    audioCtx: null,
    webAudioSource: null
  };

  const audioEl = new Audio();
  audioEl.preload = 'auto';

  // Convert a base64 data URL into raw audio bytes for Web Audio API playback
  function dataUrlToArrayBuffer(dataUrl) {
    const base64 = dataUrl.split(',')[1] || '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Play a 24kHz MP3 data URL via Web Audio API so strict website CSP headers never block it
  async function playNeuralViaWebAudio(dataUrl, rate, sessionId, onEnded, cacheKey) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error('Web Audio API unavailable');
    if (!state.audioCtx) state.audioCtx = new AudioCtx();
    if (state.audioCtx.state === 'suspended') {
      await state.audioCtx.resume();
    }
    // Reuse an already-decoded AudioBuffer if we have it (0ms decode latency!)
    let decoded = cacheKey ? state.decodedBufferCache.get(cacheKey) : null;
    if (!decoded) {
      const rawBuf = dataUrlToArrayBuffer(dataUrl);
      decoded = await state.audioCtx.decodeAudioData(rawBuf);
      if (cacheKey) {
        if (state.decodedBufferCache.size > 30) {
          const oldest = state.decodedBufferCache.keys().next().value;
          state.decodedBufferCache.delete(oldest);
        }
        state.decodedBufferCache.set(cacheKey, decoded);
      }
    }
    if (sessionId !== state.playSessionId) return;

    const source = state.audioCtx.createBufferSource();
    source.buffer = decoded;
    source.playbackRate.value = rate;
    source.connect(state.audioCtx.destination);
    source.onended = () => {
      if (state.webAudioSource === source) state.webAudioSource = null;
      if (sessionId !== state.playSessionId) return;
      onEnded();
    };
    state.webAudioSource = source;
    source.start(0);
  }

  // --- 1. Create Isolated Shadow DOM Host ---
  const host = document.createElement('div');
  host.id = 'lumina-read-aloud-root';
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; pointer-events: none; top: 0; left: 0; width: 0; height: 0;';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
      }
      * { box-sizing: border-box; }

      .lumina-root {
        --bg: rgba(255, 255, 255, 0.94);
        --bg-solid: #ffffff;
        --surface: #f4f5f9;
        --border: rgba(15, 23, 42, 0.12);
        --text: #0f172a;
        --muted: #64748b;
        --accent: #0891b2;
        --accent-hover: #0e7490;
        --accent-soft: rgba(6, 182, 212, 0.14);
        --accent-text: #ffffff;
        --shadow: 0 18px 40px -10px rgba(15, 23, 42, 0.22), 0 4px 12px rgba(15, 23, 42, 0.08);
        --pill-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
        color: var(--text);
      }

      .lumina-root[data-theme="dark"] {
        --bg: rgba(15, 23, 32, 0.94);
        --bg-solid: #0f1720;
        --surface: #162230;
        --border: rgba(34, 211, 238, 0.16);
        --text: #f0fdff;
        --muted: #94a3b8;
        --accent: #06b6d4;
        --accent-hover: #22d3ee;
        --accent-soft: rgba(34, 211, 238, 0.18);
        --accent-text: #042f2e;
        --shadow: 0 20px 44px -10px rgba(0, 0, 0, 0.65), 0 4px 14px rgba(0, 0, 0, 0.4);
        --pill-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
      }

      /* Single Clutter-Free Hover Action Button (GPU-accelerated smooth glide & fade) */
      .lumina-hover-btn {
        position: fixed;
        top: 0;
        left: 0;
        pointer-events: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 11px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--bg);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        color: var(--text);
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        white-space: nowrap;
        cursor: pointer;
        box-shadow: var(--pill-shadow);
        opacity: 0;
        transform: translate3d(var(--hx, 0px), var(--hy, 0px), 0) scale(0.92);
        transition:
          transform 0.18s cubic-bezier(0.22, 1, 0.36, 1),
          opacity 0.14s ease,
          background-color 0.15s ease,
          color 0.15s ease,
          border-color 0.15s ease;
        will-change: transform, opacity;
        user-select: none;
        z-index: 2147483645;
      }
      /* Disable position transition on the first reveal so the pill fades in right at the target */
      .lumina-hover-btn.no-glide {
        transition: opacity 0.14s ease, background-color 0.15s ease, color 0.15s ease;
      }
      .lumina-hover-btn.visible {
        opacity: 1;
        pointer-events: auto;
        transform: translate3d(var(--hx, 0px), var(--hy, 0px), 0) scale(1);
      }
      .lumina-hover-btn.visible:hover {
        background: var(--accent);
        color: var(--accent-text);
        border-color: var(--accent);
        transform: translate3d(var(--hx, 0px), calc(var(--hy, 0px) - 1px), 0) scale(1.04);
      }
      .lumina-hover-btn .dot {
        width: 6px; height: 6px; border-radius: 50%; background: var(--accent);
      }
      .lumina-hover-btn:hover .dot { background: #ffffff; }
      @media (prefers-reduced-motion: reduce) {
        .lumina-hover-btn {
          transition: opacity 0.08s ease;
        }
      }

      /* Selection Floating Pill */
      .lumina-selection-pill {
        position: fixed;
        pointer-events: auto;
        display: none;
        align-items: center;
        gap: 4px;
        padding: 4px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--bg);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        box-shadow: var(--pill-shadow);
        z-index: 2147483646;
        animation: luminaPop 0.14s ease-out;
      }
      .lumina-selection-pill.visible { display: inline-flex; }
      @keyframes luminaPop {
        from { opacity: 0; transform: translateY(4px) scale(0.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .lumina-sel-action {
        border: none;
        background: transparent;
        color: var(--text);
        font-size: 12px;
        font-weight: 600;
        padding: 6px 10px;
        border-radius: 999px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        transition: background 0.15s ease, color 0.15s ease;
        white-space: nowrap;
      }
      .lumina-sel-action.primary {
        background: var(--accent);
        color: var(--accent-text);
      }
      .lumina-sel-action.primary:hover { background: var(--accent-hover); }
      .lumina-sel-action:not(.primary):hover { background: var(--surface); }

      /* Floating Premium Mini-Player Dock */
      .lumina-dock {
        position: fixed;
        right: 22px;
        bottom: 22px;
        width: 356px;
        max-width: calc(100vw - 24px);
        pointer-events: auto;
        display: none;
        flex-direction: column;
        gap: 10px;
        padding: 13px 14px;
        border-radius: 18px;
        border: 1px solid var(--border);
        background: var(--bg);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        box-shadow: var(--shadow);
        z-index: 2147483647;
        transition: width 0.2s ease, border-radius 0.2s ease;
      }
      .lumina-dock.visible { display: flex; }
      .lumina-dock.minimized {
        width: auto;
        padding: 8px 12px;
        border-radius: 999px;
        flex-direction: row;
        align-items: center;
        gap: 8px;
      }
      .lumina-dock.minimized .dock-body { display: none; }
      .lumina-dock.minimized .dock-header { gap: 8px; }

      .dock-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        cursor: grab;
        user-select: none;
      }
      .dock-header:active { cursor: grabbing; }
      .brand {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .brand-icon {
        width: 24px; height: 24px; border-radius: 7px;
        background: linear-gradient(135deg, #06b6d4, #0284c7);
        display: inline-flex; align-items: center; justify-content: center;
        color: #fff; font-size: 12px; flex-shrink: 0;
      }
      .brand-title {
        font-size: 13px; font-weight: 700; letter-spacing: -0.01em;
        white-space: nowrap;
      }
      .status-pill {
        font-size: 11px; font-weight: 600;
        padding: 3px 8px; border-radius: 999px;
        background: var(--accent-soft); color: var(--accent);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 145px;
      }
      .header-actions { display: flex; align-items: center; gap: 4px; }
      .icon-btn {
        width: 28px; height: 28px; border-radius: 8px; border: none;
        background: transparent; color: var(--muted);
        display: inline-flex; align-items: center; justify-content: center;
        cursor: pointer; font-size: 13px; transition: background 0.15s, color 0.15s;
      }
      .icon-btn:hover { background: var(--surface); color: var(--text); }

      .dock-body { display: flex; flex-direction: column; gap: 10px; }

      .transcript-box {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 9px 11px;
        font-size: 12.5px;
        line-height: 1.45;
        color: var(--text);
        max-height: 76px;
        overflow-y: auto;
      }
      .transcript-meta {
        font-size: 10.5px; font-weight: 600; color: var(--muted);
        margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; gap: 6px;
      }
      .transcript-meta-right {
        display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
      }
      /* Compact 1-click Copy button for saving AI graph/picture descriptions or quotes */
      .copy-btn {
        border: 1px solid var(--border);
        background: var(--bg-solid);
        color: var(--muted);
        font-size: 10px;
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 6px;
        cursor: pointer;
        line-height: 1.2;
        transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
      }
      .copy-btn:hover { color: var(--text); border-color: var(--accent); }
      .copy-btn.copied { color: var(--accent); border-color: var(--accent); }

      /* Subtle 3-bar animated soundwave that pulses while Nour Read is speaking */
      .soundwave {
        display: inline-flex; align-items: flex-end; gap: 2px; height: 12px; padding: 0 2px;
      }
      .soundwave span {
        width: 2.5px; height: 4px; border-radius: 2px; background: var(--accent); opacity: 0.45;
        transition: height 0.15s ease, opacity 0.15s ease;
      }
      .soundwave.speaking span {
        opacity: 1;
        animation: nourWave 0.75s ease-in-out infinite;
      }
      .soundwave.speaking span:nth-child(2) { animation-delay: 0.18s; }
      .soundwave.speaking span:nth-child(3) { animation-delay: 0.36s; }
      @keyframes nourWave {
        0%, 100% { height: 4px; }
        50% { height: 12px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .soundwave.speaking span { animation: none; height: 9px; }
      }

      .progress-track {
        width: 100%; height: 4px; border-radius: 999px;
        background: var(--surface); overflow: hidden;
      }
      .progress-fill {
        height: 100%; width: 0%;
        background: linear-gradient(90deg, #06b6d4, #22d3ee);
        border-radius: 999px; transition: width 0.25s ease;
      }

      .controls-row {
        display: flex; align-items: center; justify-content: space-between; gap: 6px;
      }
      .transport { display: flex; align-items: center; gap: 5px; }
      .play-btn {
        height: 36px; padding: 0 14px; border-radius: 11px; border: none;
        background: var(--accent); color: var(--accent-text);
        font-size: 13px; font-weight: 600; cursor: pointer;
        display: inline-flex; align-items: center; gap: 6px;
        transition: background 0.15s, transform 0.1s;
      }
      .play-btn:hover { background: var(--accent-hover); }
      .play-btn:active { transform: scale(0.97); }

      .ctrl-btn {
        height: 32px; min-width: 32px; padding: 0 8px;
        border-radius: 9px; border: 1px solid var(--border);
        background: var(--surface); color: var(--text);
        font-size: 12px; font-weight: 600; cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        transition: border-color 0.15s, background 0.15s;
      }
      .ctrl-btn:hover { border-color: var(--accent); }

      .voice-row {
        display: flex; align-items: center; gap: 6px;
      }
      .voice-select {
        flex: 1; min-width: 0;
        height: 30px; padding: 0 8px;
        border-radius: 9px; border: 1px solid var(--border);
        background: var(--surface); color: var(--text);
        font-size: 11.5px; font-weight: 500; outline: none; cursor: pointer;
      }
      .voice-select:focus { border-color: var(--accent); }
    </style>

    <div class="lumina-root" id="luminaRoot" data-theme="light">
      <!-- Single Clutter-Free Hover Button -->
      <button class="lumina-hover-btn" id="hoverBtn" type="button" title="Start reading from here">
        <span class="dot"></span>
        <span id="hoverBtnLabel">▶ Read</span>
      </button>

      <!-- Selection Floating Pill -->
      <div class="lumina-selection-pill" id="selectionPill" role="toolbar" aria-label="Nour Read Selection">
        <button class="lumina-sel-action primary" id="selReadOnlyBtn" type="button">▶ Read Selection</button>
        <button class="lumina-sel-action" id="selStartHereBtn" type="button" title="Read from this paragraph onward">📍 From Here</button>
      </div>

      <!-- Floating Player Dock -->
      <div class="lumina-dock" id="playerDock" role="region" aria-label="Nour Read Player">
        <div class="dock-header" id="dockDragHandle">
          <div class="brand">
            <!-- Open-book + listening icon (replaces the old music note) -->
            <span class="brand-icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 5.5A2.5 2.5 0 0 1 4.5 3H11v16H4.5A2.5 2.5 0 0 0 2 21.5z"/>
                <path d="M22 5.5A2.5 2.5 0 0 0 19.5 3H13v16h6.5a2.5 2.5 0 0 1 2.5 2.5z"/>
                <path d="M16.5 8.5c1 .8 1 2.2 0 3"/>
              </svg>
            </span>
            <span class="brand-title">Nour Read</span>
            <!-- Subtle animated soundwave bars that pulse while speaking -->
            <span class="soundwave" id="dockSoundwave" aria-hidden="true"><span></span><span></span><span></span></span>
            <span class="status-pill" id="statusPill">Ready</span>
          </div>
          <div class="header-actions">
            <button class="icon-btn" id="themeToggleBtn" type="button" title="Switch Light / Dark mode">🌙</button>
            <button class="icon-btn" id="minimizeBtn" type="button" title="Minimize player">–</button>
            <button class="icon-btn" id="closeDockBtn" type="button" title="Close player">✕</button>
          </div>
        </div>

        <div class="dock-body">
          <div class="transcript-box">
            <div class="transcript-meta">
              <span id="transcriptKind">Now Reading</span>
              <span class="transcript-meta-right">
                <span id="transcriptCounter">0 / 0</span>
                <button class="copy-btn" id="copyTranscriptBtn" type="button" title="Copy text or description">Copy</button>
              </span>
            </div>
            <div id="transcriptText">Hover over any paragraph, table, or image — or select text — to start listening right where you want.</div>
          </div>

          <div class="progress-track">
            <div class="progress-fill" id="progressFill"></div>
          </div>

          <div class="controls-row">
            <div class="transport">
              <button class="ctrl-btn" id="prevBtn" type="button" title="Previous block">⏮</button>
              <button class="play-btn" id="playPauseBtn" type="button">
                <span id="playIcon">▶</span>
                <span id="playLabel">Play</span>
              </button>
              <button class="ctrl-btn" id="nextBtn" type="button" title="Next block">⏭</button>
              <button class="ctrl-btn" id="stopBtn" type="button" title="Stop">■</button>
            </div>
            <button class="ctrl-btn" id="speedBtn" type="button" title="Change reading speed">1.0x</button>
          </div>

          <div class="voice-row">
            <select class="voice-select" id="dockVoiceSelect" aria-label="Choose voice"></select>
          </div>
        </div>
      </div>
    </div>
  `;

  // Grab Shadow DOM references
  const $ = (id) => shadow.getElementById(id);
  const rootEl = $('luminaRoot');
  const hoverBtn = $('hoverBtn');
  const hoverBtnLabel = $('hoverBtnLabel');
  const selectionPill = $('selectionPill');
  const selReadOnlyBtn = $('selReadOnlyBtn');
  const selStartHereBtn = $('selStartHereBtn');
  const playerDock = $('playerDock');
  const dockDragHandle = $('dockDragHandle');
  const dockSoundwave = $('dockSoundwave');
  const statusPill = $('statusPill');
  const themeToggleBtn = $('themeToggleBtn');
  const minimizeBtn = $('minimizeBtn');
  const closeDockBtn = $('closeDockBtn');
  const transcriptKind = $('transcriptKind');
  const transcriptCounter = $('transcriptCounter');
  const copyTranscriptBtn = $('copyTranscriptBtn');
  const transcriptText = $('transcriptText');
  const progressFill = $('progressFill');
  const prevBtn = $('prevBtn');
  const playPauseBtn = $('playPauseBtn');
  const playIcon = $('playIcon');
  const playLabel = $('playLabel');
  const nextBtn = $('nextBtn');
  const stopBtn = $('stopBtn');
  const speedBtn = $('speedBtn');
  const dockVoiceSelect = $('dockVoiceSelect');

  // --- 2. Theme & Settings Management ---
  function resolveTheme(pref) {
    if (pref === 'dark' || pref === 'light') return pref;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme() {
    const resolved = resolveTheme(state.settings.theme);
    rootEl.setAttribute('data-theme', resolved);
    themeToggleBtn.textContent = resolved === 'dark' ? '☀️' : '🌙';
  }

  function populateVoiceSelect() {
    const synth = window.speechSynthesis;
    state.speechVoices = synth && synth.getVoices ? synth.getVoices() : [];
    const currentVal = state.settings.voiceId || 'ava_us';

    dockVoiceSelect.innerHTML = '';

    // Group 1: 24kHz Natural Voices (via Local Bridge)
    const neuralGroup = document.createElement('optgroup');
    neuralGroup.label = state.bridgeOnline
      ? '✨ 24kHz Studio Natural Voices (Ready)'
      : '✨ 24kHz Studio Natural Voices (Bridge Offline -> Auto Fallback)';
    NEURAL_VOICES.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.label;
      neuralGroup.appendChild(opt);
    });
    dockVoiceSelect.appendChild(neuralGroup);

    // Group 2: All Browser / OS Languages & Voices
    if (state.speechVoices.length > 0) {
      const byLang = new Map();
      state.speechVoices.forEach((v) => {
        const lang = v.lang || 'Other';
        if (!byLang.has(lang)) byLang.set(lang, []);
        byLang.get(lang).push(v);
      });

      const sortedLangs = Array.from(byLang.keys()).sort();
      sortedLangs.forEach((lang) => {
        const grp = document.createElement('optgroup');
        grp.label = `🌐 ${lang}`;
        byLang.get(lang).forEach((v) => {
          const opt = document.createElement('option');
          opt.value = `speech:${v.voiceURI}`;
          opt.textContent = `${v.name} (${v.lang})`;
          grp.appendChild(opt);
        });
        dockVoiceSelect.appendChild(grp);
      });
    }

    // Restore selected value
    if (Array.from(dockVoiceSelect.options).some((o) => o.value === currentVal)) {
      dockVoiceSelect.value = currentVal;
    } else {
      dockVoiceSelect.value = 'ava_us';
    }
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get(Object.keys(state.settings));
    state.settings = { ...state.settings, ...stored };
    applyTheme();
    speedBtn.textContent = `${Number(state.settings.rate).toFixed(2).replace(/\.00$/, '.0')}x`;
    populateVoiceSelect();
  }

  async function checkBridgeHealth() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'TTS_BRIDGE_HEALTH' });
      state.bridgeOnline = Boolean(res && res.ok);
    } catch (e) {
      state.bridgeOnline = false;
    }
    populateVoiceSelect();
  }

  // Check whether the user muted hover buttons on the current website
  function isCurrentSiteMuted() {
    const list = state.settings.mutedHosts;
    if (!Array.isArray(list) || !list.length) return false;
    return list.includes(window.location.hostname);
  }

  // Estimate remaining reading time based on remaining words and current playback speed
  function formatTimeLeft() {
    if (!state.queue.length || state.currentIndex >= state.queue.length) return '';
    let words = 0;
    for (let i = state.currentIndex; i < state.queue.length; i++) {
      const t = state.queue[i] && state.queue[i].text ? state.queue[i].text : '';
      words += t.split(/\s+/).filter(Boolean).length;
    }
    const rate = Math.max(0.5, Number(state.settings.rate) || 1.0);
    // Average natural speech is ~165 words per minute at 1.0x speed
    const mins = words / (165 * rate);
    if (mins < 0.8) return '<1 min left';
    return `~${Math.ceil(mins)} min left`;
  }

  // React to settings updates from Popup or other tabs
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let themeChanged = false;
    let voiceChanged = false;
    let rateChanged = false;
    for (const [k, { newValue }] of Object.entries(changes)) {
      if (k in state.settings) {
        state.settings[k] = newValue;
        if (k === 'theme') themeChanged = true;
        if (k === 'voiceId') voiceChanged = true;
        if (k === 'rate') rateChanged = true;
      }
    }
    if (themeChanged) applyTheme();
    if (voiceChanged) {
      populateVoiceSelect();
      if (state.isPlaying && !state.isPaused) speakCurrent();
    }
    if (rateChanged) {
      speedBtn.textContent = `${Number(state.settings.rate).toFixed(2).replace(/\.00$/, '.0')}x`;
      // Refresh remaining reading time when speed changes
      if (state.queue.length) {
        const timeLeft = formatTimeLeft();
        transcriptCounter.textContent = timeLeft
          ? `${state.currentIndex + 1} / ${state.queue.length} · ${timeLeft}`
          : `${state.currentIndex + 1} / ${state.queue.length}`;
      }
      if (state.activeEngine === 'neural' && state.isPlaying) {
        const nextRate = Number(state.settings.rate) || 1.0;
        audioEl.playbackRate = nextRate;
        if (state.webAudioSource) state.webAudioSource.playbackRate.value = nextRate;
      } else if (state.activeEngine === 'speech' && state.isPlaying && !state.isPaused) {
        speakCurrent();
      }
    }
    if (!state.settings.hoverButtonsEnabled || isCurrentSiteMuted()) hideHoverButton(true);
    if (!state.settings.selectionPillEnabled) hideSelectionPill();
  });

  if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = populateVoiceSelect;
  }

  // --- 3. Smart Webpage Content Extraction (Skips Nav/Ads/Hidden Junk) ---
  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    // Allow readable sidebars/infoboxes (<aside>); only skip Lumina itself, navbars, footers, and hidden nodes
    if (el.closest('#lumina-read-aloud-root, nav, footer, script, style, noscript, [aria-hidden="true"]')) {
      return false;
    }
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function cleanText(str) {
    return (str || '').replace(/\s+/g, ' ').trim();
  }

  // Strip raw URLs, heading anchor glyphs (#, ¶), and noise for smooth speech
  function sanitizeForSpeech(str) {
    let text = cleanText(str);
    if (state.settings.skipLinksAndCode) {
      // Remove raw http/https/www URLs so TTS never reads "h-t-t-p-s-colon-slash-slash..."
      text = text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '');
    }
    // Strip trailing/leading heading anchor icons like "#" or "¶"
    text = text.replace(/^[#¶§]+\s*|\s*[#¶§]+$/g, '');
    return cleanText(text);
  }

  // Detect elements that are predominantly links (e.g., resource lists, TOCs, breadcrumbs, nav items)
  function isMostlyLinks(el) {
    if (!el || !state.settings.skipLinksAndCode) return false;
    if (el.tagName === 'A' || el.closest('a')) return true;
    const totalLen = cleanText(el.innerText).length;
    if (totalLen === 0) return true;
    const links = el.querySelectorAll('a');
    if (links.length === 0) return false;
    let linkLen = 0;
    links.forEach((a) => {
      linkLen += cleanText(a.innerText).length;
    });
    // If >= 70% of the block is hyperlink text (like a list of external links), skip it
    return linkLen / totalLen >= 0.7;
  }

  // Extract clean prose from an element while optionally excluding nested <code>/<pre> blocks
  function extractReadableText(el) {
    if (!state.settings.skipLinksAndCode) {
      return sanitizeForSpeech(el.innerText);
    }
    // Clone shallowly to strip <pre>, nav/button/svg children without mutating the live page
    const clone = el.cloneNode(true);
    clone.querySelectorAll('pre, button, svg, script, style, .copy-button, [aria-hidden="true"]').forEach((n) => n.remove());
    return sanitizeForSpeech(clone.innerText || clone.textContent || '');
  }

  // Split long paragraphs at natural sentence boundaries so speech starts fast and never stalls
  // First chunk breaks early (~110+ chars) so Time-To-First-Audio is 30-40% faster while chunk 2 prefetches
  function splitIntoChunks(text, maxLen = 280) {
    const clean = cleanText(text);
    if (clean.length <= 140) return clean ? [clean] : [];
    const sentences = clean.match(/[^.!?]+[.!?]+[\])'"”’]*|[^.!?]+$/g) || [clean];
    const chunks = [];
    let current = '';
    for (const rawS of sentences) {
      const s = rawS.trim();
      if (!s) continue;
      // Use a smaller target for the very first chunk so audio begins almost immediately
      const limit = chunks.length === 0 ? Math.min(maxLen, 160) : maxLen;
      if (current && (current.length + s.length + 1 > limit || (chunks.length === 0 && current.length >= 110))) {
        chunks.push(current);
        current = s;
      } else {
        current = current ? `${current} ${s}` : s;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  function collectReadableBlocks() {
    const rootContainer =
      document.querySelector('article, main, [role="main"], .post-content, .article-content, #mw-content-text') ||
      document.body;

    const selectors = state.settings.skipLinksAndCode
      ? 'h1, h2, h3, h4, p, li, blockquote, table'
      : 'h1, h2, h3, h4, p, li, blockquote, pre, table';
    const rawEls = Array.from(rootContainer.querySelectorAll(selectors));
    const blocks = [];

    for (const el of rawEls) {
      if (!isVisible(el)) continue;
      // Avoid duplicate reading of elements nested inside a table, code block, or already-collected blockquote/li
      if (el.tagName !== 'TABLE' && el.closest('table')) continue;
      if (el.tagName === 'P' && el.closest('li, blockquote')) continue;
      if (state.settings.skipLinksAndCode && el.closest('pre, code, .toc, .sidebar, .breadcrumb, [role="navigation"]')) continue;

      if (el.tagName === 'TABLE') {
        const narrated = window.LuminaTableNarrator.describeTable(el);
        if (narrated.chunks.length > 0) {
          narrated.chunks.forEach((chunk, idx) => {
            blocks.push({
              el,
              text: chunk,
              label: idx === 0 ? `📊 Table: ${narrated.title}` : `📊 ${narrated.title} (cont.)`
            });
          });
        }
        continue;
      }

      if (isMostlyLinks(el)) continue;

      const txt = extractReadableText(el);
      if (txt.length < 3) continue;
      const isHeading = /^H[1-4]$/.test(el.tagName);
      const baseLabel = isHeading ? 'Heading' : el.tagName === 'BLOCKQUOTE' ? 'Quote' : 'Paragraph';
      const chunks = splitIntoChunks(txt, 280);
      chunks.forEach((chunk) => {
        blocks.push({
          el,
          text: chunk,
          label: baseLabel
        });
      });
    }
    return blocks;
  }

  function startReadingFromElement(targetEl) {
    const blocks = collectReadableBlocks();
    if (!blocks.length) {
      showDock();
      updateDockUI('No readable text found on this page.', 'Info', 'No text');
      return;
    }

    let startIdx = 0;
    if (targetEl) {
      const exactIdx = blocks.findIndex((b) => b.el === targetEl || (b.el && b.el.contains(targetEl)) || (b.el && targetEl.contains(b.el)));
      if (exactIdx !== -1) {
        startIdx = exactIdx;
      } else {
        // If the user clicked a hovered div/card text block not in the standard list, read it first
        const targetText = extractReadableText(targetEl);
        const afterIdx = blocks.findIndex(
          (b) => b.el && (targetEl.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING)
        );
        if (targetText.length >= 4) {
          const targetChunks = splitIntoChunks(targetText, 280).map((chunk) => ({
            el: targetEl,
            text: chunk,
            label: /^H[1-6]$/.test(targetEl.tagName) ? 'Heading' : 'Text Block'
          }));
          // Insert the hovered block right before the next document block so reading continues smoothly
          const insertAt = afterIdx !== -1 ? afterIdx : blocks.length;
          blocks.splice(insertAt, 0, ...targetChunks);
          startIdx = insertAt;
        } else if (afterIdx !== -1) {
          startIdx = afterIdx;
        }
      }
    }

    state.queue = blocks;
    state.currentIndex = startIdx;
    showDock();
    speakCurrent();
  }

  function readCustomQueue(items) {
    if (!items || !items.length) return;
    state.queue = items;
    state.currentIndex = 0;
    showDock();
    speakCurrent();
  }

  // --- 4. Dual-Engine Speech Playback (24kHz Neural Bridge + All Browser Languages) ---
  function clearActiveHighlight() {
    if (state.activeHighlightEl) {
      state.activeHighlightEl.classList.remove('lumina-active-reading-block');
      state.activeHighlightEl = null;
    }
  }

  function highlightElement(el) {
    clearActiveHighlight();
    if (!el || !state.settings.highlightReading) return;
    el.classList.add('lumina-active-reading-block');
    state.activeHighlightEl = el;
    if (state.settings.autoScroll) {
      const rect = el.getBoundingClientRect();
      const inView = rect.top >= 80 && rect.bottom <= window.innerHeight - 120;
      if (!inView) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  function cancelAudioOnly() {
    state.playSessionId++;
    if (state.speechTimer) {
      clearTimeout(state.speechTimer);
      state.speechTimer = null;
    }
    // Stop any active Web Audio source cleanly
    if (state.webAudioSource) {
      try {
        state.webAudioSource.onended = null;
        state.webAudioSource.stop();
      } catch (e) {}
      state.webAudioSource = null;
    }
    audioEl.onended = null;
    audioEl.onerror = null;
    audioEl.pause();
    try {
      audioEl.currentTime = 0;
    } catch (e) {}
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  function stopPlayback() {
    cancelAudioOnly();
    state.isPlaying = false;
    state.isPaused = false;
    state.activeEngine = 'none';
    clearActiveHighlight();
    updateTransportUI('Stopped');
  }

  // Fetch 24kHz audio from the local bridge with caching + in-flight deduplication
  async function fetchNeuralDataUrl(voiceId, text) {
    const key = `${voiceId}||${text}`;
    if (state.audioCache.has(key)) return state.audioCache.get(key);
    // If this exact clip is already downloading (e.g. from hover pre-warm or prefetch), reuse that promise!
    if (state.inFlightAudio.has(key)) return state.inFlightAudio.get(key);

    const pending = (async () => {
      const res = await chrome.runtime.sendMessage({
        type: 'TTS_BRIDGE_SYNTHESIZE',
        voiceId,
        text
      });
      if (!res || !res.ok || !res.dataUrl) {
        throw new Error(res?.error || 'Bridge offline');
      }
      // Keep cache bounded to 40 clips
      if (state.audioCache.size > 40) {
        const firstKey = state.audioCache.keys().next().value;
        state.audioCache.delete(firstKey);
      }
      state.audioCache.set(key, res.dataUrl);
      return res.dataUrl;
    })();

    state.inFlightAudio.set(key, pending);
    try {
      return await pending;
    } finally {
      state.inFlightAudio.delete(key);
    }
  }

  // Prefetch the next 2 chunks silently in the background so transitions between sentences have 0ms gap
  function prefetchNextNeural(voiceId, nextIdx) {
    if (!NEURAL_MAP[voiceId]) return;
    for (let offset = 0; offset < 2; offset++) {
      const idx = nextIdx + offset;
      if (idx >= state.queue.length) break;
      const item = state.queue[idx];
      if (item && item.text) {
        fetchNeuralDataUrl(voiceId, item.text).catch(() => {});
      }
    }
  }

  function speakWithBrowserSpeech(text, voiceId, rate, sessionId, isFallback) {
    const synth = window.speechSynthesis;
    if (!synth) {
      stopPlayback();
      return;
    }
    if (!state.speechVoices.length) state.speechVoices = synth.getVoices();

    const u = new SpeechSynthesisUtterance(text);
    let chosenVoice = null;

    if (voiceId.startsWith('speech:')) {
      const uri = voiceId.slice('speech:'.length);
      chosenVoice = state.speechVoices.find((v) => v.voiceURI === uri) || null;
    } else {
      // Fallback for neural voice when bridge is off
      const wantsMale = voiceId === 'andrew_us' || voiceId === 'guy_us' || voiceId === 'ryan_gb';
      const wantsUk = voiceId === 'sonia_gb' || voiceId === 'ryan_gb';
      chosenVoice =
        state.speechVoices.find((v) => (wantsUk ? /en-GB/i.test(v.lang) : /en-US/i.test(v.lang)) && (wantsMale ? /mark|david|ryan|guy|male/i.test(v.name) : /zira|aria|ava|jenny|sonia|female/i.test(v.name))) ||
        state.speechVoices.find((v) => /en/i.test(v.lang)) ||
        state.speechVoices[0] ||
        null;
    }

    if (chosenVoice) {
      u.voice = chosenVoice;
      u.lang = chosenVoice.lang;
    }
    u.rate = Math.min(2.5, Math.max(0.5, rate));
    state.activeEngine = 'speech';

    u.onstart = () => {
      if (sessionId !== state.playSessionId) return;
      state.isPlaying = true;
      state.isPaused = false;
      const badge = isFallback
        ? 'Offline Fallback'
        : chosenVoice
        ? `🌐 ${chosenVoice.name.split(' ').slice(0, 2).join(' ')}`
        : 'Speaking';
      updateTransportUI(badge);
    };

    u.onend = () => {
      if (sessionId !== state.playSessionId) return;
      advanceQueue();
    };

    u.onerror = () => {
      if (sessionId !== state.playSessionId) return;
      state.isPlaying = false;
      state.isPaused = false;
      updateTransportUI('Speech Error');
    };

    // Tiny post-cancel delay prevents Chromium's speechSynthesis from dropping onstart/onend
    state.speechTimer = setTimeout(() => {
      state.speechTimer = null;
      if (sessionId !== state.playSessionId) return;
      synth.speak(u);
    }, 45);
  }

  function advanceQueue() {
    if (state.currentIndex < state.queue.length - 1) {
      state.currentIndex++;
      speakCurrent();
    } else {
      state.isPlaying = false;
      state.isPaused = false;
      state.activeEngine = 'none';
      clearActiveHighlight();
      updateTransportUI('Finished');
    }
  }

  async function speakCurrent() {
    if (!state.queue.length) {
      startReadingFromElement(null);
      return;
    }
    cancelAudioOnly();
    const sessionId = state.playSessionId;
    const item = state.queue[state.currentIndex];
    const voiceId = state.settings.voiceId || 'ava_us';
    const rate = Number(state.settings.rate) || 1.0;

    highlightElement(item.el);
    updateDockUI(item.text, item.label || 'Now Reading', 'Loading...');

    if (NEURAL_MAP[voiceId]) {
      state.activeEngine = 'neural';
      state.isPlaying = true;
      state.isPaused = false;
      updateTransportUI(`Loading ${NEURAL_MAP[voiceId].short}...`);
      try {
        const dataUrl = await fetchNeuralDataUrl(voiceId, item.text);
        if (sessionId !== state.playSessionId) return;

        // Play via Web Audio API first so strict site CSP (like Google Images) never blocks 24kHz audio
        try {
          await playNeuralViaWebAudio(dataUrl, rate, sessionId, () => advanceQueue(), `${voiceId}||${item.text}`);
        } catch (webAudioErr) {
          if (sessionId !== state.playSessionId) return;
          // Fallback to standard HTML Audio element if Web Audio decoding fails
          audioEl.src = dataUrl;
          audioEl.playbackRate = rate;
          audioEl.onended = () => {
            if (sessionId !== state.playSessionId) return;
            advanceQueue();
          };
          audioEl.onerror = () => {
            if (sessionId !== state.playSessionId) return;
            speakWithBrowserSpeech(item.text, voiceId, rate, sessionId, true);
          };
          await audioEl.play();
        }
        if (sessionId !== state.playSessionId) return;
        state.bridgeOnline = true;
        updateTransportUI(`✨ ${NEURAL_MAP[voiceId].short} · 24kHz`);
        prefetchNextNeural(voiceId, state.currentIndex + 1);
      } catch (err) {
        if (sessionId !== state.playSessionId) return;
        state.bridgeOnline = false;
        speakWithBrowserSpeech(item.text, voiceId, rate, sessionId, true);
      }
    } else {
      speakWithBrowserSpeech(item.text, voiceId, rate, sessionId, false);
    }
  }

  function togglePlayPause() {
    if (!state.queue.length) {
      startReadingFromElement(null);
      return;
    }
    if (state.isPlaying && !state.isPaused) {
      if (state.activeEngine === 'neural') {
        if (state.webAudioSource && state.audioCtx) state.audioCtx.suspend().catch(() => {});
        else audioEl.pause();
      } else if (window.speechSynthesis) {
        window.speechSynthesis.pause();
      }
      state.isPaused = true;
      updateTransportUI('Paused');
    } else if (state.isPaused) {
      if (state.activeEngine === 'neural') {
        if (state.webAudioSource && state.audioCtx) state.audioCtx.resume().catch(() => {});
        else audioEl.play().catch(() => {});
        state.isPaused = false;
        const v = NEURAL_MAP[state.settings.voiceId];
        updateTransportUI(v ? `✨ ${v.short} · 24kHz` : 'Playing');
      } else if (window.speechSynthesis) {
        window.speechSynthesis.resume();
        state.isPaused = false;
        updateTransportUI('Speaking');
      }
    } else {
      speakCurrent();
    }
  }

  // --- 5. Dock UI Helpers ---
  function showDock() {
    state.playerVisible = true;
    playerDock.classList.add('visible');
  }

  function hideDock() {
    state.playerVisible = false;
    playerDock.classList.remove('visible');
  }

  function updateDockUI(text, kindLabel, statusText) {
    transcriptText.textContent = text;
    transcriptKind.textContent = kindLabel || 'Now Reading';
    const total = state.queue.length;
    const current = total ? state.currentIndex + 1 : 0;
    const timeLeft = total ? formatTimeLeft() : '';
    transcriptCounter.textContent = timeLeft ? `${current} / ${total} · ${timeLeft}` : `${current} / ${total}`;
    const pct = total ? Math.round((current / total) * 100) : 0;
    progressFill.style.width = `${pct}%`;
    if (statusText) statusPill.textContent = statusText;
  }

  function updateTransportUI(statusText) {
    if (statusText) statusPill.textContent = statusText;
    const activelySpeaking = state.isPlaying && !state.isPaused;
    playIcon.textContent = activelySpeaking ? '⏸' : '▶';
    playLabel.textContent = activelySpeaking ? 'Pause' : state.isPaused ? 'Resume' : 'Play';
    // Animate the subtle dock soundwave bars only while actively speaking
    if (dockSoundwave) dockSoundwave.classList.toggle('speaking', activelySpeaking);
  }

  // --- 6. Clutter-Free Single Hover-Reveal Button (Broad Detection + Smooth Glide) ---

  // Check if an image, canvas, or SVG is large enough to be a real visual (not a tiny icon)
  function isMeaningfulVisual(el) {
    if (!el || !(el instanceof Element)) return false;
    // Skip elements inside our own Shadow DOM host or hidden containers
    if (el.closest('#lumina-read-aloud-root, [aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    // Require at least 64x52px so tiny 16-48px toolbar/social icons are skipped
    return r.width >= 64 && r.height >= 52;
  }

  // Count readable text from direct text nodes AND inline formatting tags (span, strong, em, a, etc.)
  function getInlineTextLength(el) {
    let len = 0;
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        len += cleanText(node.textContent).length;
      } else if (
        node.nodeType === Node.ELEMENT_NODE &&
        /^(SPAN|STRONG|B|EM|I|SMALL|MARK|U|S|SUB|SUP|TIME|ABBR|CITE|Q|LABEL|A|CODE|KBD|FONT)$/.test(node.tagName)
      ) {
        len += cleanText(node.innerText || node.textContent).length;
      }
    }
    return len;
  }

  // Check if a generic <div>, <span>, card, or cell holds readable text (React/Google/X/Reddit/Notion/News)
  function findReadableDivBlock(startEl) {
    let cur = startEl;
    // Walk up at most 5 parent levels looking for a focused text container
    for (let depth = 0; depth < 5 && cur && cur !== document.body; depth++) {
      const tag = cur.tagName;
      // Stop if we hit a navigation bar, form control, or Lumina itself
      if (/^(NAV|FOOTER|BUTTON|INPUT|TEXTAREA|SELECT|SCRIPT|STYLE)$/.test(tag)) return null;
      if (cur.id === 'lumina-read-aloud-root') return null;

      // Count text directly inside this container or inside its inline spans/bold/links
      const inlineLen = getInlineTextLength(cur);
      if (inlineLen >= 6) {
        const rect = cur.getBoundingClientRect();
        // Make sure it's a normal-sized text block, not a massive full-page wrapper
        if (rect.width >= 40 && rect.height >= 12 && rect.height <= window.innerHeight * 1.4) {
          if (isVisible(cur) && !isMostlyLinks(cur)) {
            const txt = extractReadableText(cur);
            if (txt.length >= 6 && txt.length <= 3000) return cur;
          }
        }
      }
      cur = cur.parentElement;
    }
    return null;
  }

  // Find the best readable target (table, picture/graph, or text) under the mouse pointer
  function findHoverTarget(el, clientX, clientY) {
    if (!el || !(el instanceof Element)) return null;
    // Never trigger inside Lumina's own UI, site navigation, footers, or form inputs
    if (el.closest('#lumina-read-aloud-root, nav, footer, button, input, textarea, select, [role="navigation"]')) {
      return null;
    }

    // Collect the stack of elements directly under the cursor so we see through transparent overlays (Google Images, charts)
    const stack =
      typeof clientX === 'number' && typeof clientY === 'number' && document.elementsFromPoint
        ? document.elementsFromPoint(clientX, clientY).slice(0, 6)
        : [el];

    // Priority 1: Data Table (checked BEFORE links so linked table cells still work)
    if (state.settings.describeImagesAndTables) {
      for (const node of stack) {
        const table = node.closest('table');
        if (table && isVisible(table)) {
          const rows = table.querySelectorAll('tr').length;
          if (rows >= 2) return { el: table, kind: 'table' };
        }
      }

      // Priority 2: Meaningful Picture, SVG Chart, Canvas Graph, or [role="img"] (checked BEFORE <a> links so Google Images works!)
      for (const node of stack) {
        // Direct match on img, canvas, svg, or ARIA image
        const directVisual = node.closest('img, canvas, svg, [role="img"]');
        if (directVisual && isMeaningfulVisual(directVisual)) {
          return { el: directVisual, kind: 'visual' };
        }
        // Check if hovering a tight wrapper like <figure>, <picture>, or an image card overlay
        const wrapper = node.closest('figure, picture');
        if (wrapper) {
          const innerVisual = wrapper.querySelector('img, canvas, svg');
          if (innerVisual && isMeaningfulVisual(innerVisual)) {
            return { el: innerVisual, kind: 'visual' };
          }
        }
      }
    }

    // Skip standalone <pre> code blocks when "Skip Links & Code" is turned on
    if (state.settings.skipLinksAndCode && el.closest('pre')) {
      return null;
    }

    // Priority 3: Standard semantic text blocks (paragraphs, headings h1-h6, lists, quotes, captions, cells)
    // Checked even if the pointer is over an inline <a> or <code> word inside a normal paragraph!
    const textBlock = el.closest('p, li, blockquote, h1, h2, h3, h4, h5, h6, figcaption, dd, dt, summary, td, th');
    if (textBlock && isVisible(textBlock) && !isMostlyLinks(textBlock)) {
      const txt = extractReadableText(textBlock);
      const isHeading = /^H[1-6]$/.test(textBlock.tagName);
      // Headings can be very short (3+ chars); other semantic blocks need at least 6 chars
      if (txt.length >= (isHeading ? 3 : 6)) {
        return { el: textBlock, kind: 'text' };
      }
    }

    // For non-paragraph standalone links, still respect "Skip Links & Code"
    if (state.settings.skipLinksAndCode && el.closest('a, code')) {
      return null;
    }

    // Priority 4: Modern web-app text blocks inside <div> / <section> / <article> / <span> (X, Reddit, Gmail, Notion, Google)
    const divBlock = findReadableDivBlock(el);
    if (divBlock) {
      return { el: divBlock, kind: 'text' };
    }

    return null;
  }

  // Place the hover button right beside your cursor, and freeze it when you move toward it to click
  function positionHoverButtonNearCursor(forceMove) {
    const btnWidth = hoverBtn.offsetWidth || 132;
    const btnHeight = hoverBtn.offsetHeight || 30;
    const px = state.lastPointerX;
    const py = state.lastPointerY;

    // Smart Freeze-to-Click: if already visible on this target and cursor is within 115px, hold still so clicking is effortless
    if (state.hoverBtnVisible && !forceMove) {
      const btnCenterX = state.hoverBtnX + btnWidth / 2;
      const btnCenterY = state.hoverBtnY + btnHeight / 2;
      const dist = Math.hypot(px - btnCenterX, py - btnCenterY);
      if (dist <= 115) return;
    }

    // Position neatly just above and slightly right of the cursor (flip below if near the top edge)
    let left = px + 14;
    let top = py - btnHeight - 10;
    if (top < 10) {
      top = py + 18;
    }
    if (left + btnWidth > window.innerWidth - 10) {
      left = px - btnWidth - 14;
    }
    // Clamp safely inside the visible viewport
    left = Math.max(8, Math.min(window.innerWidth - btnWidth - 8, Math.round(left)));
    top = Math.max(8, Math.min(window.innerHeight - btnHeight - 8, Math.round(top)));

    state.hoverBtnX = left;
    state.hoverBtnY = top;

    // If the pill was hidden, snap to the cursor first so it fades in right beside your pointer
    if (!state.hoverBtnVisible) {
      hoverBtn.classList.add('no-glide');
      hoverBtn.style.setProperty('--hx', `${left}px`);
      hoverBtn.style.setProperty('--hy', `${top}px`);
      // Force one layout flush so the snap applies before the fade-in starts
      void hoverBtn.offsetWidth;
      hoverBtn.classList.remove('no-glide');
    } else {
      // Already visible: glide smoothly via GPU transform to follow your cursor
      hoverBtn.style.setProperty('--hx', `${left}px`);
      hoverBtn.style.setProperty('--hy', `${top}px`);
    }
  }

  // Smoothly reveal or glide the single hover button to the target element right beside the cursor
  function showHoverButton(target, kind) {
    // Cancel any pending hide countdown because we have a valid target
    if (state.hoverHideTimer) {
      clearTimeout(state.hoverHideTimer);
      state.hoverHideTimer = null;
    }
    // Remove the subtle outline from the previously hovered element
    if (state.hoveredEl && state.hoveredEl !== target) {
      state.hoveredEl.classList.remove('lumina-hover-target-outline');
    }
    state.hoveredEl = target;
    state.hoverKind = kind;
    state.pendingHoverEl = null;
    state.pendingHoverKind = null;

    // Measure the target to make sure it is still on screen
    const rect = target.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      hideHoverButton(true);
      return;
    }

    // Show a soft dashed outline on the element so you know exactly what Lumina will read/describe
    target.classList.add('lumina-hover-target-outline');

    // Choose the clearest label and tooltip for this element type
    if (kind === 'table') {
      hoverBtnLabel.textContent = '📊 Read Table';
      hoverBtn.title = 'Describe this table clearly';
    } else if (kind === 'visual') {
      const isChart = window.LuminaImageDescriber.isLikelyChartOrGraph(target);
      hoverBtnLabel.textContent = isChart ? '📈 Describe Graph' : '🖼️ Describe Picture';
      hoverBtn.title = isChart ? 'Describe this graph or chart' : 'Describe this picture';
    } else {
      hoverBtnLabel.textContent = '▶ From here';
      hoverBtn.title = 'Start reading from this block';
    }

    // Move right beside the user's cursor (forceMove=true because this is a fresh or newly switched target)
    positionHoverButtonNearCursor(true);
    hoverBtn.classList.add('visible');
    state.hoverBtnVisible = true;
  }

  // Smoothly fade out the hover button after a generous grace period so you can reach it easily
  function hideHoverButton(immediate) {
    if (state.hoverIntentTimer) {
      clearTimeout(state.hoverIntentTimer);
      state.hoverIntentTimer = null;
    }
    state.pendingHoverEl = null;
    state.pendingHoverKind = null;
    if (state.hoverHideTimer) clearTimeout(state.hoverHideTimer);
    const doHide = () => {
      hoverBtn.classList.remove('visible');
      state.hoverBtnVisible = false;
      if (state.hoveredEl) {
        state.hoveredEl.classList.remove('lumina-hover-target-outline');
      }
      state.hoveredEl = null;
      state.hoverKind = null;
    };
    // 450ms grace lets you comfortably glide onto the button to click it
    if (immediate) doHide();
    else state.hoverHideTimer = setTimeout(doHide, 450);
  }

  // Smooth, jitter-free mousemove with RAF throttle + mouse-following pill + freeze-to-click
  document.addEventListener(
    'mousemove',
    (e) => {
      if (!state.settings.hoverButtonsEnabled || isCurrentSiteMuted()) return;
      // Always record the latest cursor position
      state.lastPointerX = e.clientX;
      state.lastPointerY = e.clientY;

      // Keep the button rock-solid while the pointer is directly over the hover button itself
      if (e.composedPath().includes(hoverBtn)) {
        if (state.hoverHideTimer) {
          clearTimeout(state.hoverHideTimer);
          state.hoverHideTimer = null;
        }
        return;
      }
      if (state.hoverRafPending) return;
      state.hoverRafPending = true;
      const targetNode = e.target;
      const pointerX = e.clientX;
      const pointerY = e.clientY;
      requestAnimationFrame(() => {
        state.hoverRafPending = false;
        const found = findHoverTarget(targetNode, pointerX, pointerY);
        if (found) {
          // Cancel any hide countdown as soon as the cursor is on a valid target
          if (state.hoverHideTimer) {
            clearTimeout(state.hoverHideTimer);
            state.hoverHideTimer = null;
          }
          // Already showing for this exact element: smoothly follow cursor if you moved far (>115px), or hold still so you can click!
          if (found.el === state.hoveredEl && found.kind === state.hoverKind) {
            positionHoverButtonNearCursor(false);
            return;
          }
          // Already waiting to show for this exact element: let the timer finish (do NOT reset!)
          if (found.el === state.pendingHoverEl && found.kind === state.pendingHoverKind) return;

          if (state.hoverIntentTimer) clearTimeout(state.hoverIntentTimer);
          state.pendingHoverEl = found.el;
          state.pendingHoverKind = found.kind;
          // Snappy 45ms glide when already visible; 70ms intent check when appearing fresh
          const delay = state.hoverBtnVisible ? 45 : 70;
          state.hoverIntentTimer = setTimeout(() => {
            state.hoverIntentTimer = null;
            showHoverButton(found.el, found.kind);
          }, delay);
        } else {
          if (state.hoverIntentTimer) {
            clearTimeout(state.hoverIntentTimer);
            state.hoverIntentTimer = null;
          }
          state.pendingHoverEl = null;
          state.pendingHoverKind = null;
          if (state.hoveredEl) hideHoverButton(false);
        }
      });
    },
    { passive: true }
  );

  // Immediately hide floating hover button & selection pill on scroll/resize so they never float detached
  window.addEventListener(
    'scroll',
    () => {
      if (state.hoveredEl || state.hoverIntentTimer) hideHoverButton(true);
      hideSelectionPill();
    },
    { passive: true }
  );
  window.addEventListener('resize', () => {
    hideHoverButton(true);
    hideSelectionPill();
  });
  // Cleanly stop audio if the user navigates to another page
  window.addEventListener('pagehide', () => {
    stopPlayback();
  });

  hoverBtn.addEventListener('mouseenter', () => {
    if (state.hoverHideTimer) clearTimeout(state.hoverHideTimer);
    if (state.hoveredEl) state.hoveredEl.classList.add('lumina-hover-target-outline');
    // Hover Pre-Warm: silently start fetching the first chunk of a hovered text block before you even click!
    const voiceId = state.settings.voiceId || 'ava_us';
    if (state.hoveredEl && state.hoverKind === 'text' && NEURAL_MAP[voiceId] && state.bridgeOnline) {
      const previewText = extractReadableText(state.hoveredEl);
      const firstChunk = splitIntoChunks(previewText, 280)[0];
      if (firstChunk) {
        fetchNeuralDataUrl(voiceId, firstChunk).catch(() => {});
      }
    }
  });

  hoverBtn.addEventListener('mouseleave', () => {
    hideHoverButton(false);
  });

  hoverBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const target = state.hoveredEl;
    const kind = state.hoverKind;
    hideHoverButton(true);
    if (!target) return;

    if (kind === 'table') {
      const narrated = window.LuminaTableNarrator.describeTable(target);
      readCustomQueue(
        narrated.chunks.map((chunk, i) => ({
          el: target,
          text: chunk,
          label: i === 0 ? `📊 Table: ${narrated.title}` : `📊 ${narrated.title} (${i + 1}/${narrated.chunks.length})`
        }))
      );
    } else if (kind === 'visual') {
      await describeAndSpeakVisual(target);
    } else {
      startReadingFromElement(target);
    }
  });

  async function describeAndSpeakVisual(el) {
    showDock();
    highlightElement(el);
    updateDockUI('Analyzing picture / graph so I can describe it clearly...', 'Visual Narrator', 'Analyzing...');
    const result = await window.LuminaImageDescriber.describeElement(el);
    const label =
      result.kind === 'chart'
        ? result.source === 'ai-vision'
          ? '📈 AI Graph Description'
          : '📈 Graph Description'
        : result.source === 'ai-vision'
        ? '🖼️ AI Picture Description'
        : '🖼️ Picture Description';

    // Split long image/graph descriptions into short chunks so 24kHz synthesis stays fast
    const chunks = splitIntoChunks(result.text, 280);
    readCustomQueue(chunks.map((chunk) => ({ el, text: chunk, label })));
  }

  // --- 7. Instant Text Selection Pill ---
  function hideSelectionPill() {
    selectionPill.classList.remove('visible');
  }

  document.addEventListener('mouseup', (e) => {
    if (!state.settings.selectionPillEnabled) return;
    if (e.composedPath().includes(host)) return;

    setTimeout(() => {
      const sel = window.getSelection();
      const text = cleanText(sel ? sel.toString() : '');
      if (!text || text.length < 3 || !sel.rangeCount) {
        hideSelectionPill();
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        hideSelectionPill();
        return;
      }
      const top = Math.max(8, rect.top - 44);
      const left = Math.max(8, Math.min(window.innerWidth - 230, rect.left + rect.width / 2 - 105));
      selectionPill.style.top = `${top}px`;
      selectionPill.style.left = `${left}px`;
      selectionPill.classList.add('visible');
    }, 20);
  });

  document.addEventListener('mousedown', (e) => {
    if (!e.composedPath().includes(selectionPill)) {
      hideSelectionPill();
    }
  });

  document.addEventListener('contextmenu', (e) => {
    state.lastContextTarget = e.target;
  });

  selReadOnlyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const sel = window.getSelection();
    const text = sanitizeForSpeech(sel ? sel.toString() : '');
    const anchorEl = sel && sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
    hideSelectionPill();
    if (text) {
      const chunks = splitIntoChunks(text, 280);
      readCustomQueue(chunks.map((c) => ({ el: anchorEl, text: c, label: 'Selected Text' })));
    }
  });

  selStartHereBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const sel = window.getSelection();
    const anchorEl = sel && sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
    hideSelectionPill();
    startReadingFromElement(anchorEl);
  });

  // 1-click Copy button so users can save AI picture/graph descriptions or spoken quotes
  copyTranscriptBtn.addEventListener('click', async () => {
    const txt = (transcriptText.textContent || '').trim();
    if (!txt) return;
    try {
      await navigator.clipboard.writeText(txt);
      copyTranscriptBtn.textContent = '✓ Copied';
      copyTranscriptBtn.classList.add('copied');
      setTimeout(() => {
        copyTranscriptBtn.textContent = 'Copy';
        copyTranscriptBtn.classList.remove('copied');
      }, 1500);
    } catch (e) {
      // Clipboard API may be restricted on some non-HTTPS pages
    }
  });

  // --- 8. Dock Controls & Dragging ---
  playPauseBtn.addEventListener('click', togglePlayPause);
  stopBtn.addEventListener('click', stopPlayback);
  prevBtn.addEventListener('click', () => {
    if (!state.queue.length) return;
    state.currentIndex = Math.max(0, state.currentIndex - 1);
    speakCurrent();
  });
  nextBtn.addEventListener('click', () => {
    if (!state.queue.length) return;
    state.currentIndex = Math.min(state.queue.length - 1, state.currentIndex + 1);
    speakCurrent();
  });

  speedBtn.addEventListener('click', () => {
    const cur = Number(state.settings.rate) || 1.0;
    const idx = SPEEDS.findIndex((s) => s >= cur - 0.01);
    const nextSpeed = SPEEDS[(idx + 1) % SPEEDS.length];
    state.settings.rate = nextSpeed;
    speedBtn.textContent = `${nextSpeed.toFixed(2).replace(/\.00$/, '.0')}x`;
    chrome.storage.local.set({ rate: nextSpeed });
  });

  dockVoiceSelect.addEventListener('change', () => {
    const val = dockVoiceSelect.value;
    state.settings.voiceId = val;
    chrome.storage.local.set({ voiceId: val });
    if (state.isPlaying && !state.isPaused) speakCurrent();
  });

  themeToggleBtn.addEventListener('click', () => {
    const curResolved = resolveTheme(state.settings.theme);
    const nextTheme = curResolved === 'dark' ? 'light' : 'dark';
    state.settings.theme = nextTheme;
    applyTheme();
    chrome.storage.local.set({ theme: nextTheme });
  });

  minimizeBtn.addEventListener('click', () => {
    state.playerMinimized = !state.playerMinimized;
    playerDock.classList.toggle('minimized', state.playerMinimized);
    minimizeBtn.textContent = state.playerMinimized ? '▢' : '–';
  });

  closeDockBtn.addEventListener('click', () => {
    stopPlayback();
    hideDock();
  });

  // Smooth draggable dock
  let dragState = null;
  dockDragHandle.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    const rect = playerDock.getBoundingClientRect();
    dragState = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    playerDock.style.right = 'auto';
    playerDock.style.bottom = 'auto';
    playerDock.style.left = `${rect.left}px`;
    playerDock.style.top = `${rect.top}px`;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragState) return;
    const left = Math.max(8, Math.min(window.innerWidth - playerDock.offsetWidth - 8, e.clientX - dragState.dx));
    const top = Math.max(8, Math.min(window.innerHeight - playerDock.offsetHeight - 8, e.clientY - dragState.dy));
    playerDock.style.left = `${left}px`;
    playerDock.style.top = `${top}px`;
  });
  window.addEventListener('mouseup', () => {
    dragState = null;
  });

  // --- 9. Listen for Commands from Popup / Context Menu / Shortcuts ---
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return false;

    if (msg.type === 'CMD_READ_SELECTION') {
      const sel = window.getSelection();
      const text = sanitizeForSpeech(msg.text || (sel ? sel.toString() : ''));
      if (text) {
        const chunks = splitIntoChunks(text, 280);
        readCustomQueue(chunks.map((c) => ({ el: null, text: c, label: 'Selected Text' })));
      } else {
        showDock();
        updateDockUI('Highlight any text first, or hover over a paragraph and click "▶ From here".', 'Tip', 'Ready');
      }
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'CMD_START_FROM_CONTEXT') {
      startReadingFromElement(state.lastContextTarget);
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'CMD_READ_PAGE') {
      startReadingFromElement(null);
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'CMD_TOGGLE_PLAY_PAUSE') {
      showDock();
      togglePlayPause();
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'CMD_STOP') {
      stopPlayback();
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'CMD_TOGGLE_PLAYER') {
      if (state.playerVisible) hideDock();
      else showDock();
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'CMD_DESCRIBE_IMAGE_URL') {
      const img =
        (state.lastContextTarget && state.lastContextTarget.closest('img, canvas, svg')) ||
        Array.from(document.querySelectorAll('img')).find((i) => i.src === msg.srcUrl);
      if (img) {
        describeAndSpeakVisual(img);
      }
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'GET_PLAYER_STATE') {
      sendResponse({
        isPlaying: state.isPlaying,
        isPaused: state.isPaused,
        playerVisible: state.playerVisible,
        bridgeOnline: state.bridgeOnline
      });
      return false;
    }

    return false;
  });

  // Initialize!
  loadSettings().then(checkBridgeHealth);
})();
