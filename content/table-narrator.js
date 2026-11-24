// Lumina Read Aloud — Smart Table & SVG Graph Narrator
// Turns raw HTML tables and SVG/DOM charts into clear, structured, human-friendly spoken narration
// so a listener who isn't looking at the screen understands the data effortlessly.

window.LuminaTableNarrator = (() => {
  function cleanText(str) {
    return (str || '').replace(/\s+/g, ' ').trim();
  }

  function joinNatural(items) {
    if (!items.length) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
  }

  function findTableTitle(table) {
    const caption = table.querySelector('caption');
    if (caption && cleanText(caption.innerText)) return cleanText(caption.innerText);

    const ariaLabel = cleanText(table.getAttribute('aria-label'));
    if (ariaLabel) return ariaLabel;

    const labelledBy = table.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ref = document.getElementById(labelledBy);
      if (ref && cleanText(ref.innerText)) return cleanText(ref.innerText);
    }

    // Look for nearest preceding heading or figure caption
    const fig = table.closest('figure');
    if (fig) {
      const fc = fig.querySelector('figcaption');
      if (fc && cleanText(fc.innerText)) return cleanText(fc.innerText);
    }

    let prev = table.previousElementSibling;
    for (let i = 0; i < 3 && prev; i++) {
      if (/^H[1-6]$/.test(prev.tagName) && cleanText(prev.innerText)) {
        return cleanText(prev.innerText);
      }
      prev = prev.previousElementSibling;
    }
    return '';
  }

  function parseNumber(text) {
    const cleaned = cleanText(text).replace(/[$,€£¥%,\s]/g, '');
    if (!cleaned || isNaN(Number(cleaned))) return null;
    // Ignore 4-digit years when finding "highest/lowest" metrics unless needed
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }

  function describeTable(table) {
    if (!table || table.tagName !== 'TABLE') {
      return { summary: 'No readable table was found.', chunks: [] };
    }

    const title = findTableTitle(table);
    const allRows = Array.from(table.querySelectorAll('tr')).filter((tr) => {
      const text = cleanText(tr.innerText);
      return text.length > 0;
    });

    if (allRows.length === 0) {
      return { summary: 'This table appears to be empty.', chunks: [] };
    }

    // Determine header row(s)
    let headers = [];
    let dataStartIdx = 0;

    const thead = table.querySelector('thead');
    if (thead) {
      const headRows = Array.from(thead.querySelectorAll('tr'));
      const lastHeadRow = headRows[headRows.length - 1];
      if (lastHeadRow) {
        headers = Array.from(lastHeadRow.querySelectorAll('th, td')).map((c) => cleanText(c.innerText));
      }
      const tbodyRows = Array.from(table.querySelectorAll('tbody tr')).filter((tr) => cleanText(tr.innerText));
      if (tbodyRows.length > 0) {
        return buildNarration(title, headers, tbodyRows);
      }
      dataStartIdx = headRows.length;
    } else {
      const firstCells = Array.from(allRows[0].children);
      const hasTh = firstCells.some((c) => c.tagName === 'TH');
      if (hasTh || allRows.length > 1) {
        headers = firstCells.map((c) => cleanText(c.innerText));
        dataStartIdx = 1;
      }
    }

    const dataRows = allRows.slice(dataStartIdx);
    return buildNarration(title, headers, dataRows);
  }

  function buildNarration(title, headers, dataRows) {
    const parsedRows = dataRows
      .map((tr) => Array.from(tr.querySelectorAll('th, td')).map((c) => cleanText(c.innerText)))
      .filter((cells) => cells.some((v) => v.length > 0));

    const rowCount = parsedRows.length;
    const colCount = Math.max(headers.length, ...parsedRows.map((r) => r.length), 0);

    // Ensure every column has a friendly name
    const colNames = [];
    for (let i = 0; i < colCount; i++) {
      colNames.push(headers[i] || `Column ${i + 1}`);
    }

    const introParts = [];
    if (title) {
      introParts.push(`Here is a table titled "${title}".`);
    } else {
      introParts.push('Here is a data table.');
    }
    introParts.push(
      `It has ${rowCount} ${rowCount === 1 ? 'row' : 'rows'} and ${colCount} ${colCount === 1 ? 'column' : 'columns'}.`
    );
    if (colNames.length > 0 && colNames.length <= 8) {
      introParts.push(`The columns are ${joinNatural(colNames)}.`);
    } else if (colNames.length > 8) {
      introParts.push(`The main columns start with ${joinNatural(colNames.slice(0, 6))}, plus ${colNames.length - 6} more.`);
    }

    // Smart numeric highlights (find highest and lowest in the first meaningful numeric column)
    const highlightParts = [];
    if (rowCount >= 3 && colCount >= 2) {
      for (let c = 1; c < Math.min(colCount, 6); c++) {
        const colName = colNames[c];
        if (/year|date|id|#|no\.|rank/i.test(colName)) continue;
        const nums = [];
        parsedRows.forEach((r, idx) => {
          const val = parseNumber(r[c]);
          if (val !== null) {
            nums.push({ val, raw: r[c], label: r[0] || `Row ${idx + 1}` });
          }
        });
        if (nums.length >= Math.max(3, Math.floor(rowCount * 0.6))) {
          nums.sort((a, b) => b.val - a.val);
          const highest = nums[0];
          const lowest = nums[nums.length - 1];
          if (highest.val !== lowest.val) {
            highlightParts.push(
              `For ${colName}, the highest is ${highest.raw} (${highest.label}), and the lowest is ${lowest.raw} (${lowest.label}).`
            );
            break; // Keep the executive highlight crisp and focused
          }
        }
      }
    }

    const chunks = [];
    chunks.push([...introParts, ...highlightParts].join(' '));

    // Read rows cleanly by pairing each header with its value
    const maxRowsToRead = 12;
    const rowsToNarrate = parsedRows.slice(0, maxRowsToRead);

    rowsToNarrate.forEach((row, idx) => {
      const rowLabel = row[0] ? `${colNames[0]}: ${row[0]}` : `Row ${idx + 1}`;
      const details = [];
      for (let c = 1; c < row.length; c++) {
        if (!row[c]) continue;
        const hName = colNames[c] || `Column ${c + 1}`;
        details.push(`${hName} is ${row[c]}`);
      }
      if (details.length > 0) {
        chunks.push(`Row ${idx + 1}, ${rowLabel}. ${details.join('; ')}.`);
      } else {
        chunks.push(`Row ${idx + 1}: ${rowLabel}.`);
      }
    });

    if (rowCount > maxRowsToRead) {
      chunks.push(
        `That covers the first ${maxRowsToRead} rows. There are ${rowCount - maxRowsToRead} more rows in this table.`
      );
    }

    return {
      title: title || 'Data Table',
      summary: chunks.join(' '),
      chunks
    };
  }

  // Smart local SVG / DOM Graph & Chart Analyzer (works immediately offline!)
  function describeSvgOrChart(el) {
    const parts = [];
    const ariaLabel = cleanText(el.getAttribute('aria-label'));
    const titleEl = el.querySelector('title');
    const descEl = el.querySelector('desc');
    const fig = el.closest('figure');
    const figCaption = fig ? cleanText(fig.querySelector('figcaption')?.innerText) : '';

    // Check nearby heading
    let heading = '';
    let prev = (fig || el).previousElementSibling;
    for (let i = 0; i < 3 && prev; i++) {
      if (/^H[1-6]$/.test(prev.tagName) && cleanText(prev.innerText)) {
        heading = cleanText(prev.innerText);
        break;
      }
      prev = prev.previousElementSibling;
    }

    const chartTitle = ariaLabel || cleanText(titleEl?.textContent) || figCaption || heading;
    if (chartTitle) {
      parts.push(`This is a graph or visual chart titled "${chartTitle}".`);
    } else {
      parts.push('This is a visual chart or diagram on the page.');
    }

    if (descEl && cleanText(descEl.textContent)) {
      parts.push(cleanText(descEl.textContent));
    }

    // Collect SVG text labels (axes, legend, data labels)
    if (el.tagName.toLowerCase() === 'svg' || el.querySelector('svg')) {
      const svg = el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg');
      const texts = Array.from(svg.querySelectorAll('text'))
        .map((t) => cleanText(t.textContent))
        .filter((t) => t.length > 0 && t.length < 80);
      const uniqueTexts = [...new Set(texts)];

      if (uniqueTexts.length > 0) {
        const numericLabels = uniqueTexts.filter((t) => /^[-+]?[$€£¥]?\d[\d.,]*%?$/.test(t));
        const wordLabels = uniqueTexts.filter((t) => !/^[-+]?[$€£¥]?\d[\d.,]*%?$/.test(t));

        if (wordLabels.length > 0) {
          parts.push(`The chart labels include: ${joinNatural(wordLabels.slice(0, 12))}.`);
        }
        if (numericLabels.length >= 2) {
          parts.push(
            `The scale values shown range around ${numericLabels[0]} to ${numericLabels[numericLabels.length - 1]}.`
          );
        }
      }
    }

    if (parts.length <= 1) {
      parts.push(
        'For an even deeper AI explanation of the exact visual trends and bars in this chart, add your free Gemini API key in Nour Read settings.'
      );
    }

    return parts.join(' ');
  }

  return {
    describeTable,
    describeSvgOrChart
  };
})();
