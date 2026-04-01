// CTA Alerts widget — stacked per-line neon icons, top-left.
// Each icon shows a colored circle for an affected line; clicking expands
// an inline panel listing that line's alerts.

(function () {
  const POLL_INTERVAL = 60000;
  const mockMode = new URLSearchParams(window.location.search).get('mock') === '1';
  const ALERTS_ENDPOINT = mockMode ? '/api/alerts?mock=1' : '/api/alerts';

  // Map API service IDs (lowercase) → line colors
  const SERVICE_COLORS = {
    red:  '#C60C30',
    blue: '#00A1DE',
    brn:  '#895129',
    g:    '#009B3A',
    org:  '#F14624',
    pink: '#E27EA6',
    p:    '#7C3AED',
    pexp: '#7C3AED',
    y:    '#F9E300',
  };

  // Human-readable names for aria-labels
  const SERVICE_NAMES = {
    red:  'Red',
    blue: 'Blue',
    brn:  'Brown',
    g:    'Green',
    org:  'Orange',
    pink: 'Pink',
    p:    'Purple',
    pexp: 'Purple Express',
    y:    'Yellow',
  };

  // Inline SVG alert icon: circle with exclamation mark
  const ALERT_SVG = `<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M10 2.5 L18 17 H2 Z" stroke="rgba(255,255,255,0.88)" stroke-width="1.5" stroke-linejoin="round" fill="rgba(255,255,255,0.1)"/>
    <line x1="10" y1="8.5" x2="10" y2="13" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="10" cy="15.5" r="1.15" fill="white"/>
  </svg>`;

  let alerts = [];
  let expandedLines = new Set();
  const widget = document.getElementById('alerts-widget');

  // --- Helpers ---

  function groupByService(list) {
    const map = new Map();
    for (const a of list) {
      const svc = a.service || 'unknown';
      if (!map.has(svc)) map.set(svc, []);
      map.get(svc).push(a);
    }
    return map;
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function escHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escAttr(str) {
    return str.replace(/"/g, '&quot;');
  }

  // --- Render ---

  function render() {
    if (alerts.length === 0) {
      widget.classList.remove('alerts-visible');
      widget.innerHTML = '';
      return;
    }

    widget.classList.add('alerts-visible');
    const byService = groupByService(alerts);

    let html = '';
    for (const [svc, svcAlerts] of byService) {
      const color = SERVICE_COLORS[svc] || '#888';
      const name  = SERVICE_NAMES[svc] || svc;
      const isExp = expandedLines.has(svc);
      const gc    = hexToRgba(color, 0.6);

      html += `<div class="aw-line-row" data-svc="${escAttr(svc)}">`;

      html += `<button class="aw-icon-btn${isExp ? ' aw-expanded' : ''}"
        aria-expanded="${isExp}"
        aria-label="${escAttr(name)} line — ${svcAlerts.length} alert${svcAlerts.length > 1 ? 's' : ''}"
        style="background:${color};--gc:${gc}"
      >${ALERT_SVG}</button>`;

      if (isExp) {
        html += `<div class="aw-panel">`;
        for (const a of svcAlerts) {
          html += `<div class="aw-item" style="--line-color:${color}">`;
          html += `<div class="aw-headline">${escHtml(a.headline)}</div>`;
          if (a.short) {
            html += `<div class="aw-short">${escHtml(a.short)}</div>`;
          }
          html += `</div>`;
        }
        html += `</div>`;
      }

      html += `</div>`;
    }

    widget.innerHTML = html;

    // Attach click handlers to each icon button
    widget.querySelectorAll('.aw-icon-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const svc = btn.closest('.aw-line-row').dataset.svc;
        if (expandedLines.has(svc)) {
          expandedLines.delete(svc);
        } else {
          expandedLines.add(svc);
        }
        render();
      });
    });
  }

  // Collapse all when clicking outside
  document.addEventListener('click', e => {
    if (expandedLines.size > 0 && !widget.contains(e.target)) {
      expandedLines.clear();
      render();
    }
  });

  // --- Fetch ---

  async function fetchAlerts() {
    try {
      const res = await fetch(ALERTS_ENDPOINT);
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data)) return;
      alerts = data;
      render();
    } catch (_) {
      // silently ignore — network errors shouldn't affect the map
    }
  }

  fetchAlerts();
  setInterval(fetchAlerts, POLL_INTERVAL);

  // --- Hide when a train is selected ---
  // Watch #close-btn for the .visible class (added by selectTrain, removed by deselectTrain)

  const closeBtn = document.getElementById('close-btn');
  if (closeBtn) {
    const obs = new MutationObserver(() => {
      const trainSelected = closeBtn.classList.contains('visible');
      widget.classList.toggle('alerts-train-selected', trainSelected);
      if (trainSelected) {
        expandedLines.clear();
        render();
      }
    });
    obs.observe(closeBtn, { attributes: true, attributeFilter: ['class'] });
  }
})();
