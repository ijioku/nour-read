# Nour Read — Browser Read-Aloud Extension (Chrome / Edge / Brave)

**Nour Read** is a clean, clutter-free Manifest V3 browser extension that turns any webpage into an effortless listening experience. Hover over any paragraph, table, picture, or graph, click once, and listen in natural voices with automatic System / Light / Dark mode, live reading time remaining, and smart visual narration.

---

## Quick Install (30 Seconds — Works Out of the Box)

Nour Read works immediately with every voice built into your browser and operating system:

1. Download or clone this repository:
   ```bash
   git clone https://github.com/ijioku/nour-read.git
   ```
   *(Or click the green **Code** button above → **Download ZIP** and extract it.)*
2. Open your browser's extensions page:
   - **Chrome:** `chrome://extensions`
   - **Edge:** `edge://extensions`
   - **Brave:** `brave://extensions`
3. Turn **ON** **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `nour-read` folder.
5. Pin **Nour Read** to your toolbar and open any webpage!

---

## How to Use Nour Read

### 1. Hover & Click to Listen Anywhere
- Move your mouse over **any paragraph, heading, card, or article** on a webpage.
- A single floating pill (**▶ From here**) glides right beside your cursor and freezes still so you can click it easily.
- Click **▶ From here** to start reading from that exact spot down the page.

### 2. Read Only Highlighted Text
- Highlight any sentence or phrase with your mouse.
- Click **▶ Read Selection** to hear *only* the words you highlighted, or **📍 From Here** to keep reading onward.

### 3. Describe Pictures, Graphs & Data Tables
- Hover over any **picture**, **chart/graph**, or **table** (including on Google Images, Wikipedia, and dashboards).
- Click **🖼️ Describe Picture**, **📈 Describe Graph**, or **📊 Read Table** (or right-click any image → **🖼️ Nour Read: Describe Picture / Graph**).
- **Offline by default:** Tables and SVG charts are narrated automatically offline.
- **Optional Free AI Vision Upgrade:** Want Nour Read to look at raw pixels of complex math graphs or unlabeled photos?
  1. Get a free Gemini API key at [Google AI Studio](https://aistudio.google.com/apikey).
  2. Click the **Nour Read** toolbar icon → open **🧠 Optional AI Vision for Pictures & Graphs**.
  3. Paste your key and click **Save** (stored privately in your browser only).

### 4. Control Playback From the Floating Dock
- **Play / Pause / Prev / Next / Stop** and **Speed (`0.75x` – `2.0x`)**.
- **Live Reading Time Remaining** (e.g., `3 / 18 · ~2 min left`) updates automatically when you change speed.
- **Copy Button:** Click **Copy** inside the transcript box to copy any AI picture/graph description or spoken quote to your clipboard.
- **Drag & Minimize:** Drag the dock header anywhere on screen, switch **Light / Dark** mode, or minimize it to a tiny pill.

### 5. Pause Hover on Specific Websites
- Don't want hover buttons on Google Docs, Figma, or a web app?
- Open the **Nour Read** popup on that site and switch on **Pause Hover on This Site**—hover stays active everywhere else.

### 6. Keyboard Shortcuts
- `Alt + Shift + R` (`Cmd + Shift + R` on Mac) — Play / Pause
- `Alt + Shift + S` (`Cmd + Shift + S` on Mac) — Read Selected Text

---

## Optional: Unlock 7 Studio 24kHz Natural Voices (Local Bridge)

Want 7 studio-quality 24kHz natural voices (**Ava HD, Aria, Jenny, Sonia UK, Andrew HD, Guy, Ryan UK**) alongside your browser's built-in voices? Run the optional local voice bridge included in `bridge/` (requires [Node.js](https://nodejs.org/) 18+):

```bash
cd bridge
npm install
npm start
```

Once running on `http://127.0.0.1:47821`, open the **Nour Read** popup—the status dot will turn green (**✨ 24kHz Natural Bridge Online**) automatically.

> **Note:** The optional local bridge uses the open-source `@andresaya/edge-tts` package for **personal, non-commercial use only**. This project is not affiliated with or endorsed by Microsoft. If the bridge is not running, Nour Read seamlessly uses your browser's built-in voices.

---

## Privacy & Security

- **100% Local:** No analytics, no tracking, and no server collecting your browsing history.
- **Private Localhost Bridge:** The optional voice bridge binds strictly to `127.0.0.1` so no other device on your network can reach it.
- **BYOK (Bring Your Own Key):** If you optionally add a Gemini API key, it stays strictly inside `chrome.storage.local` on your device and is sent directly to Google's Gemini API only when you ask Nour Read to describe a picture or graph.
