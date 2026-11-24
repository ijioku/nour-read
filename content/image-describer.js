// Lumina Read Aloud — Smart Picture & Visual Chart Describer
// Works instantly offline using rich DOM/alt/figcaption/SVG extraction, AND upgrades
// automatically to Gemini Vision when the user provides their own API key in Settings.

window.LuminaImageDescriber = (() => {
  function cleanText(str) {
    return (str || '').replace(/\s+/g, ' ').trim();
  }

  function getSurroundingContext(el) {
    const pieces = [];
    const fig = el.closest('figure');
    if (fig) {
      const cap = fig.querySelector('figcaption');
      if (cap && cleanText(cap.innerText)) pieces.push(`Caption: ${cleanText(cap.innerText)}`);
    }
    const alt = cleanText(el.getAttribute('alt'));
    if (alt) pieces.push(`Alt text: ${alt}`);
    const title = cleanText(el.getAttribute('title'));
    if (title && title !== alt) pieces.push(`Title: ${title}`);
    const aria = cleanText(el.getAttribute('aria-label'));
    if (aria && aria !== alt) pieces.push(`Label: ${aria}`);

    // Nearest heading or paragraph for context
    const parent = (fig || el).parentElement;
    if (parent) {
      const prev = (fig || el).previousElementSibling;
      if (prev && cleanText(prev.innerText)) {
        pieces.push(`Nearby text: ${cleanText(prev.innerText).slice(0, 220)}`);
      }
    }
    return pieces.join('. ');
  }

  // Check whether an image, canvas, or SVG looks like a chart, graph, or math diagram
  function isLikelyChartOrGraph(el) {
    // Get the element's lowercase HTML tag name
    const tag = el.tagName.toLowerCase();
    // Canvas and SVG visuals are almost always charts, graphs, or diagrams
    if (tag === 'canvas' || tag === 'svg') return true;
    // Also inspect the nearest figure caption or parent container for chart hints
    const fig = el.closest('figure');
    const figText = fig ? cleanText(fig.querySelector('figcaption')?.innerText) : '';
    const parentHint = el.parentElement
      ? `${el.parentElement.className || ''} ${el.parentElement.id || ''} ${el.parentElement.getAttribute('aria-label') || ''}`
      : '';
    // Combine all text clues from the image, its wrapper, and its caption
    const textHint = `${el.className || ''} ${el.id || ''} ${el.getAttribute('alt') || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('src') || ''} ${parentHint} ${figText}`;
    // Match common chart, graph, data visualization, and math diagram keywords
    return /\b(chart|graph|plot|diagram|histogram|bar[-_\s]?chart|pie[-_\s]?chart|line[-_\s]?chart|infographic|stats|scatter|boxplot|heatmap|candlestick|analytics|trend|flowchart|mermaid|equation|formula|matrix|axis|axes|curve|highcharts|echarts|plotly|recharts|chartjs|d3)\b/i.test(
      textHint
    );
  }

  function buildLocalImageDescription(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'svg') {
      return window.LuminaTableNarrator.describeSvgOrChart(el);
    }

    const alt = cleanText(el.getAttribute('alt'));
    const title = cleanText(el.getAttribute('title'));
    const aria = cleanText(el.getAttribute('aria-label'));
    const fig = el.closest('figure');
    const figcaption = fig ? cleanText(fig.querySelector('figcaption')?.innerText) : '';
    const isChart = isLikelyChartOrGraph(el);

    const parts = [];
    if (isChart) {
      parts.push('This looks like a chart or graph.');
    } else {
      parts.push('Here is a description of this picture.');
    }

    if (alt && alt.length > 2) {
      parts.push(alt.endsWith('.') ? alt : `${alt}.`);
    }
    if (figcaption && figcaption !== alt) {
      parts.push(`The caption says: ${figcaption}.`);
    } else if (title && title !== alt) {
      parts.push(`Its title is: ${title}.`);
    } else if (aria && aria !== alt) {
      parts.push(`It is labeled: ${aria}.`);
    }

    // If no alt/caption exists, try deriving a clue from filename & nearby context
    if (parts.length === 1) {
      const src = el.getAttribute('src') || '';
      const filenameMatch = src.split('/').pop()?.split('?')[0]?.replace(/\.[a-z0-9]+$/i, '');
      const readableName = filenameMatch
        ? filenameMatch.replace(/[-_]+/g, ' ').replace(/\b\d{4,}\b/g, '').trim()
        : '';
      if (readableName && readableName.length >= 4 && !/^(img|image|photo|pic|unnamed|download)$/i.test(readableName)) {
        parts.push(`The image file is named "${readableName}".`);
      } else {
        parts.push('This website did not include written alt-text for this image.');
      }
      parts.push(
        'Tip: Add your own Gemini API key in the Nour Read popup settings to unlock full AI visual descriptions of any picture or graph.'
      );
    }

    return parts.join(' ');
  }

  // Capture an element as base64 PNG (works even for cross-origin images & <canvas> graphs!)
  async function captureElementAsBase64(el) {
    // Fast path 1: <canvas> direct export
    if (el.tagName.toLowerCase() === 'canvas') {
      try {
        const dataUrl = el.toDataURL('image/png');
        return { base64: dataUrl.split(',')[1], mimeType: 'image/png' };
      } catch (e) {
        // Tainted canvas — fall through to tab capture crop
      }
    }

    // Fast path 2: scroll element into view and crop a viewport screenshot from the service worker
    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    await new Promise((r) => setTimeout(r, 120));

    const rect = el.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return null;

    const captureRes = await chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' });
    if (!captureRes || !captureRes.ok || !captureRes.dataUrl) return null;

    return await cropDataUrl(captureRes.dataUrl, rect);
  }

  function cropDataUrl(dataUrl, rect) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const dpr = window.devicePixelRatio || 1;
        const sx = Math.max(0, Math.round(rect.left * dpr));
        const sy = Math.max(0, Math.round(rect.top * dpr));
        const sw = Math.min(img.width - sx, Math.round(rect.width * dpr));
        const sh = Math.min(img.height - sy, Math.round(rect.height * dpr));
        if (sw <= 4 || sh <= 4) {
          resolve(null);
          return;
        }
        // Cap max dimension at 1024px for fast AI vision processing
        const scale = Math.min(1, 1024 / Math.max(sw, sh));
        const cw = Math.max(1, Math.round(sw * scale));
        const ch = Math.max(1, Math.round(sh * scale));

        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
        const out = canvas.toDataURL('image/jpeg', 0.85);
        resolve({ base64: out.split(',')[1], mimeType: 'image/jpeg' });
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  async function describeElement(el) {
    const kind = isLikelyChartOrGraph(el) ? 'chart' : 'image';
    const contextText = getSurroundingContext(el);

    // Safely read the optional Gemini API key (prevents "Extension context invalidated" if a tab wasn't refreshed after Reload)
    let geminiApiKey = '';
    try {
      if (chrome?.runtime?.id && chrome?.storage?.local) {
        const stored = await chrome.storage.local.get(['geminiApiKey']);
        geminiApiKey = stored?.geminiApiKey || '';
      }
    } catch (e) {
      // Extension was reloaded while this tab stayed open — fall back cleanly to local description
      geminiApiKey = '';
    }

    if (geminiApiKey && geminiApiKey.trim()) {
      try {
        const captured = await captureElementAsBase64(el);
        if (captured && captured.base64) {
          const aiRes = await chrome.runtime.sendMessage({
            type: 'AI_DESCRIBE_VISUAL',
            imageBase64: captured.base64,
            mimeType: captured.mimeType,
            contextText,
            kind
          });
          if (aiRes && aiRes.ok && aiRes.description) {
            return {
              source: 'ai-vision',
              kind,
              text: aiRes.description
            };
          }
        }
      } catch (err) {
        // Gracefully fall back to local describer
      }
    }

    return {
      source: 'local',
      kind,
      text: buildLocalImageDescription(el)
    };
  }

  return {
    describeElement,
    isLikelyChartOrGraph,
    buildLocalImageDescription
  };
})();
