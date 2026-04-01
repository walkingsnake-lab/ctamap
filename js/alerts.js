// CTA Alerts — unified notification drawer, top-left.
// Single trigger button with colored line dots; expands into a
// glassmorphic panel with staggered section reveals.

(function () {
  const POLL_INTERVAL = 60000;
  const mockMode = new URLSearchParams(window.location.search).get('mock') === '1';
  const ALERTS_ENDPOINT = mockMode ? '/api/alerts?mock=1' : '/api/alerts';

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

  let alerts = [];
  let drawerOpen = false;
  let collapsedSections = new Set();   // lines the user collapsed
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

  function esc(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
    const totalCount = alerts.length;
    const lineKeys = [...byService.keys()];

    let html = '';

    // ─── Trigger button ───
    html += `<button class="aw-trigger${drawerOpen ? ' aw-trigger-active' : ''}"
      aria-expanded="${drawerOpen}" aria-label="${totalCount} service alert${totalCount !== 1 ? 's' : ''}">`;
    // Line dots
    html += `<span class="aw-dots">`;
    for (const svc of lineKeys) {
      html += `<span class="aw-dot" style="background:${SERVICE_COLORS[svc] || '#888'}"></span>`;
    }
    html += `</span>`;
    // Alert icon
    html += `<svg class="aw-trigger-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.5l6.5 11.5H1.5L8 1.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none"/>
      <line x1="8" y1="6.2" x2="8" y2="9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="8" cy="11.3" r="0.9" fill="currentColor"/>
    </svg>`;
    // Count
    html += `<span class="aw-trigger-count">${totalCount}</span>`;
    html += `</button>`;

    // ─── Drawer panel ───
    if (drawerOpen) {
      html += `<div class="aw-drawer">`;
      html += `<div class="aw-drawer-inner">`;

      // Header
      html += `<div class="aw-header">`;
      html += `<span class="aw-header-title">Service Alerts</span>`;
      html += `<span class="aw-header-count">${totalCount}</span>`;
      html += `</div>`;

      // Sections — one per line
      let sectionIdx = 0;
      for (const [svc, svcAlerts] of byService) {
        const color = SERVICE_COLORS[svc] || '#888';
        const name  = SERVICE_NAMES[svc] || svc;
        const isCollapsed = collapsedSections.has(svc);
        const delay = Math.min(sectionIdx * 60, 300);

        html += `<div class="aw-section" style="--accent:${color};animation-delay:${delay}ms" data-svc="${escAttr(svc)}">`;

        // Section header (clickable to collapse)
        html += `<button class="aw-section-header" aria-expanded="${!isCollapsed}">`;
        html += `<span class="aw-section-dot" style="background:${color}"></span>`;
        html += `<span class="aw-section-name">${esc(name)}</span>`;
        html += `<span class="aw-section-count">${svcAlerts.length}</span>`;
        html += `<svg class="aw-chevron${isCollapsed ? ' aw-chevron-collapsed' : ''}" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>`;
        html += `</button>`;

        // Alert items
        if (!isCollapsed) {
          html += `<div class="aw-items">`;
          for (let i = 0; i < svcAlerts.length; i++) {
            const a = svcAlerts[i];
            const itemDelay = delay + (i + 1) * 40;
            html += `<div class="aw-item" style="animation-delay:${itemDelay}ms">`;
            html += `<div class="aw-headline">${esc(a.headline)}</div>`;
            if (a.short) {
              html += `<div class="aw-desc">${esc(a.short)}</div>`;
            }
            html += `</div>`;
          }
          html += `</div>`;
        }

        html += `</div>`;
        sectionIdx++;
      }

      html += `</div>`;
      html += `</div>`;
    }

    widget.innerHTML = html;

    // --- Event wiring ---

    const trigger = widget.querySelector('.aw-trigger');
    if (trigger) {
      trigger.addEventListener('click', e => {
        e.stopPropagation();
        drawerOpen = !drawerOpen;
        render();
      });
    }

    widget.querySelectorAll('.aw-section-header').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const svc = btn.closest('.aw-section').dataset.svc;
        if (collapsedSections.has(svc)) collapsedSections.delete(svc);
        else collapsedSections.add(svc);
        render();
      });
    });
  }

  // Collapse drawer on outside click
  document.addEventListener('click', e => {
    if (drawerOpen && !widget.contains(e.target)) {
      drawerOpen = false;
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
      if (trainSelected) {
        drawerOpen = false;
        render();
      }
    });
    obs.observe(closeBtn, { attributes: true, attributeFilter: ['class'] });
  }
})();
