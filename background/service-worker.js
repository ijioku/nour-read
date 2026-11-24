// Lumina Read Aloud — Background Service Worker (Manifest V3)
// Handles: 24kHz Local Neural TTS Bridge proxy, Context Menus, Keyboard Shortcuts,
// Optional BYOK Gemini Vision descriptions, and Cross-Origin Image/Chart capture.

const BRIDGE_URL = 'http://127.0.0.1:47821';

const DEFAULT_SETTINGS = {
  theme: 'auto', // 'light' | 'dark' | 'auto'
  voiceId: 'ava_us',
  rate: 1.0,
  hoverButtonsEnabled: true,
  selectionPillEnabled: true,
  autoScroll: true,
  highlightReading: true,
  describeImagesAndTables: true,
  skipLinksAndCode: true,
  // List of hostnames where hover buttons are muted by the user
  mutedHosts: [],
  languageFilter: 'all',
  geminiApiKey: ''
};

// Initialize defaults & context menus on install/update
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const merged = { ...DEFAULT_SETTINGS, ...existing };
  await chrome.storage.local.set(merged);

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'lumina-read-selection',
      title: '▶ Nour Read: Read Selected Text',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'lumina-start-from-here',
      title: '📍 Nour Read: Start Reading From Here',
      contexts: ['page', 'selection']
    });
    chrome.contextMenus.create({
      id: 'lumina-describe-image',
      title: '🖼️ Nour Read: Describe Picture / Graph',
      contexts: ['image']
    });
    chrome.contextMenus.create({
      id: 'lumina-toggle-player',
      title: '🎧 Nour Read: Show / Hide Player',
      contexts: ['all']
    });
  });
});

// Forward context menu clicks to the active tab's content script
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;
  if (info.menuItemId === 'lumina-read-selection') {
    sendToTab(tab.id, { type: 'CMD_READ_SELECTION', text: info.selectionText || '' });
  } else if (info.menuItemId === 'lumina-start-from-here') {
    sendToTab(tab.id, { type: 'CMD_START_FROM_CONTEXT' });
  } else if (info.menuItemId === 'lumina-describe-image') {
    sendToTab(tab.id, { type: 'CMD_DESCRIBE_IMAGE_URL', srcUrl: info.srcUrl || '' });
  } else if (info.menuItemId === 'lumina-toggle-player') {
    sendToTab(tab.id, { type: 'CMD_TOGGLE_PLAYER' });
  }
});

// Forward keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  if (command === 'toggle-play-pause') {
    sendToTab(tab.id, { type: 'CMD_TOGGLE_PLAY_PAUSE' });
  } else if (command === 'read-selection') {
    sendToTab(tab.id, { type: 'CMD_READ_SELECTION' });
  }
});

function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // Content script may not be injected on chrome:// or restricted pages
  });
}

// Convert ArrayBuffer to Base64 safely without call-stack overflow
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Message handler for content scripts & popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === 'TTS_BRIDGE_HEALTH') {
    fetch(`${BRIDGE_URL}/health`, { method: 'GET' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => sendResponse({ ok: Boolean(data && data.ok), data }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === 'TTS_BRIDGE_SYNTHESIZE') {
    const { text, voiceId } = msg;
    if (!text || typeof text !== 'string') {
      sendResponse({ ok: false, error: 'Empty text' });
      return false;
    }
    fetch(`${BRIDGE_URL}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId: voiceId || 'ava_us' })
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Bridge HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const mime = res.headers.get('content-type') || 'audio/mpeg';
        const dataUrl = `data:${mime};base64,${arrayBufferToBase64(buf)}`;
        sendResponse({ ok: true, dataUrl });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: err && err.message ? err.message : 'Bridge unavailable' });
      });
    return true;
  }

  if (msg.type === 'CAPTURE_VISIBLE_TAB') {
    const windowId = sender && sender.tab ? sender.tab.windowId : undefined;
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        sendResponse({ ok: false, error: chrome.runtime.lastError?.message || 'Capture failed' });
      } else {
        sendResponse({ ok: true, dataUrl });
      }
    });
    return true;
  }

  if (msg.type === 'AI_DESCRIBE_VISUAL') {
    handleAiVisualDescription(msg)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: err?.message || 'AI description failed' }));
    return true;
  }

  return false;
});

async function handleAiVisualDescription({ imageBase64, mimeType, contextText, kind }) {
  const { geminiApiKey } = await chrome.storage.local.get(['geminiApiKey']);
  const apiKey = (geminiApiKey || '').trim();
  if (!apiKey) {
    return { ok: false, needsKey: true, error: 'No Gemini API key configured' };
  }

  const rolePrompt =
    kind === 'chart'
      ? 'You are narrating a chart or graph aloud for a listener who cannot see the screen. Clearly explain: (1) what type of chart it is and its title, (2) what the axes or categories represent, (3) the highest values, lowest values, and key trends or comparisons, and (4) the main takeaway in simple, natural spoken English. Do not use markdown, bullet symbols, or asterisks.'
      : kind === 'table'
      ? 'You are narrating a data table aloud for a listener who cannot see the screen. Give a clear, simple, well-structured spoken summary: state what the table is about, its main columns, the most important rows or comparisons, and the key takeaway. Use plain spoken English with zero markdown or bullet characters.'
      : 'You are describing a picture aloud for a listener who cannot see the screen. Describe the main subject, setting, notable details, any readable text inside the image, and overall mood or purpose clearly and concisely in 2 to 4 natural spoken sentences. Use plain English with no markdown or asterisks.';

  const parts = [
    {
      text: `${rolePrompt}\n\nSurrounding webpage context (if helpful): ${(contextText || 'None').slice(0, 600)}`
    }
  ];

  if (imageBase64) {
    parts.push({
      inline_data: {
        mime_type: mimeType || 'image/png',
        data: imageBase64
      }
    });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 320
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API HTTP ${res.status}: ${errText.slice(0, 140)}`);
  }

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || '')
    .join(' ')
    .replace(/[*#_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    throw new Error('Empty response from Gemini Vision');
  }
  return { ok: true, description: text };
}
