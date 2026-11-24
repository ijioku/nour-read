// Nour Read — Optional Local 24kHz Natural Voice Bridge (Personal / Non-Commercial Use)
// Runs privately on http://127.0.0.1:47821 so Nour Read can play 7 studio-quality 24kHz voices.

import http from 'node:http';
import crypto from 'node:crypto';
import { EdgeTTS, Constants } from '@andresaya/edge-tts';

// Bind strictly to localhost (127.0.0.1) so no external device on your network can reach it
const HOST = '127.0.0.1';
const PORT = 47821;

// The 7 supported 24kHz natural voices (US & UK, female & male)
const VOICE_MAP = {
  ava_us:    { shortName: 'en-US-AvaMultilingualNeural',    label: 'Microsoft Ava HD (US Female)' },
  aria_us:   { shortName: 'en-US-AriaNeural',               label: 'Microsoft Aria (US Female)' },
  jenny_us:  { shortName: 'en-US-JennyNeural',              label: 'Microsoft Jenny (US Female)' },
  sonia_gb:  { shortName: 'en-GB-SoniaNeural',              label: 'Microsoft Sonia (UK Female)' },
  andrew_us: { shortName: 'en-US-AndrewMultilingualNeural', label: 'Microsoft Andrew HD (US Male)' },
  guy_us:    { shortName: 'en-US-GuyNeural',                label: 'Microsoft Guy (US Male)' },
  ryan_gb:   { shortName: 'en-GB-RyanNeural',               label: 'Microsoft Ryan (UK Male)' },
};

// Create the TTS client with a 25-second timeout and an in-memory LRU cache of 60 clips
const tts = new EdgeTTS({ timeout: 25000 });
const CACHE_LIMIT = 60;
const audioCache = new Map();

// Look up a cached audio clip and refresh its recency
function cacheGet(key) {
  if (!audioCache.has(key)) return null;
  const val = audioCache.get(key);
  audioCache.delete(key);
  audioCache.set(key, val);
  return val;
}

// Store a newly synthesized clip in memory and evict the oldest entry when full
function cacheSet(key, buf) {
  if (audioCache.has(key)) audioCache.delete(key);
  audioCache.set(key, buf);
  if (audioCache.size > CACHE_LIMIT) {
    const oldest = audioCache.keys().next().value;
    audioCache.delete(oldest);
  }
}

// Allow the browser extension to talk to localhost cleanly
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

// Read and parse a JSON request body with a strict size limit (100 KB) to prevent abuse
function readJsonBody(req, maxBytes = 100000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Start the local HTTP server handling /health and /tts
const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  // Health check endpoint used by Nour Read to detect whether 24kHz voices are online
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      engine: 'Microsoft Edge Neural 24kHz',
      port: PORT,
      voices: VOICE_MAP
    }));
    return;
  }

  // Synthesize text into a 24kHz MP3 clip
  if (req.method === 'POST' && url.pathname === '/tts') {
    try {
      const body = await readJsonBody(req);
      const text = String(body.text || '').trim();
      const voiceId = String(body.voiceId || 'ava_us');
      const voiceInfo = VOICE_MAP[voiceId] || VOICE_MAP.ava_us;

      if (!text) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Empty text' }));
        return;
      }

      // Hash voice + text to reuse cached MP3 clips instantly
      const cacheKey = crypto.createHash('sha256').update(`${voiceInfo.shortName}|${text}`).digest('hex');
      let mp3Buf = cacheGet(cacheKey);

      if (!mp3Buf) {
        const result = await tts.generate(text, voiceInfo.shortName, {
          outputFormat: Constants.OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3,
        });
        mp3Buf = Buffer.from(result.audio);
        if (!mp3Buf.length) throw new Error('No audio bytes returned');
        cacheSet(cacheKey, mp3Buf);
      }

      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': mp3Buf.length,
        'X-TTS-Voice': voiceInfo.shortName,
        'X-TTS-Label': voiceInfo.label,
        'Cache-Control': 'no-store'
      });
      res.end(mp3Buf);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message || 'Synthesis failed' }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Exit quietly if the bridge is already running on port 47821
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Nour Read voice bridge is already running on http://${HOST}:${PORT}`);
    process.exit(0);
  }
  console.error('Bridge server error:', err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Nour Read 24kHz Voice Bridge listening on http://${HOST}:${PORT}`);
});
