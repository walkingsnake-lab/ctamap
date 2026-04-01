// CTA Alerts — minimal floating labels per affected line.
// Each alert shows a small hazard triangle + "Major delays!" in the line color.
// Fades out when zoomed in past a threshold.

(function () {
  const POLL_INTERVAL = 120000;
  const mockMode = new URLSearchParams(window.location.search).get('mock') === '1';
  const ALERTS_ENDPOINT = mockMode ? '/api/alerts?mock=1' : '/api/alerts';

  // Zoom level above which alerts fade out (k=1 is full city view)
  const ZOOM_FADE_K = 2.5;

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

  const SERVICE_NAMES = {
    red:  'Red',
    blue: 'Blue',
    brn:  'Brown',
    g:    'Green',
    org:  'Orange',
    pink: 'Pink',
    p:    'Purple',
    pexp: 'Purple Exp',
    y:    'Yellow',
  };

  // Hazard triangle SVG — rounded corners, filled white, thick stroke
  function hazardSvg(color) {
    return `<svg class="aw-hazard" viewBox="0 0 100 92" fill="none" aria-hidden="true">
      <path d="M20 84 Q8 84 13.8 73.5 L44.2 18.5 Q50 8 55.8 18.5 L86.2 73.5 Q92 84 80 84 Z"
            stroke="${color}" stroke-width="7" fill="none"/>
      <line x1="50" y1="32" x2="50" y2="57"
            stroke="${color}" stroke-width="7" stroke-linecap="round"/>
      <circle cx="50" cy="70" r="4.5" fill="${color}"/>
    </svg>`;
  }

  let alerts = [];
  const widget = document.getElementById('alerts-widget');

  // --- Zoom-aware visibility ---

  let zoomFaded = false;

  function checkZoom() {
    const mapEl = document.getElementById('map');
    if (!mapEl || typeof d3 === 'undefined') return;
    const k = d3.zoomTransform(mapEl).k || 1;
    const shouldFade = k > ZOOM_FADE_K;
    if (shouldFade !== zoomFaded) {
      zoomFaded = shouldFade;
      widget.classList.toggle('alerts-zoom-hidden', zoomFaded);
    }
  }

  // Poll zoom state on animation frames (cheap — just reads a cached transform)
  let rafId = null;
  function zoomLoop() {
    checkZoom();
    rafId = requestAnimationFrame(zoomLoop);
  }
  zoomLoop();

  // --- Render ---

  function affectedLines() {
    const set = new Set();
    for (const a of alerts) {
      if (a.service) set.add(a.service);
    }
    return [...set];
  }

  function render() {
    const lines = affectedLines();

    if (lines.length === 0) {
      widget.classList.remove('alerts-visible');
      widget.innerHTML = '';
      return;
    }

    widget.classList.add('alerts-visible');

    let html = '';
    for (const svc of lines) {
      const color = SERVICE_COLORS[svc] || '#888';
      const name  = SERVICE_NAMES[svc] || svc;

      html += `<div class="aw-label" style="--c:${color}" aria-label="${name} line: major delays">`;
      html += hazardSvg(color);
      html += `<span class="aw-text">Major delays</span>`;
      html += `</div>`;
    }

    widget.innerHTML = html;
  }

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
      // silently ignore
    }
  }

  fetchAlerts();
  setInterval(fetchAlerts, POLL_INTERVAL);

  // --- Hide when a train is selected ---

  const closeBtn = document.getElementById('close-btn');
  if (closeBtn) {
    const obs = new MutationObserver(() => {
      const trainSelected = closeBtn.classList.contains('visible');
      widget.classList.toggle('alerts-train-selected', trainSelected);
    });
    obs.observe(closeBtn, { attributes: true, attributeFilter: ['class'] });
  }
})();
