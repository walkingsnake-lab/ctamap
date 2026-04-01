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

  // Minimal line-art hazard triangle SVG
  function hazardSvg(color) {
    return `<svg class="aw-hazard" viewBox="0 0 20 18" fill="none" aria-hidden="true">
      <path d="M10 1 L19 17 H1 Z" stroke="${color}" stroke-width="1.5"
            stroke-linejoin="round" fill="none"/>
      <line x1="10" y1="7" x2="10" y2="11.5" stroke="${color}"
            stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="10" cy="14" r="1.1" fill="${color}"/>
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
      html += `<span class="aw-text">Major delays!</span>`;
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
