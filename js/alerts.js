// CTA Alerts widget — polls /api/alerts every 60s, shows major/delay alerts
// in a fixed bottom-left badge. Fades out when a train is selected.

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

  let alerts = [];
  let expanded = false;
  const widget = document.getElementById('alerts-widget');

  // --- Render ---

  function render() {
    if (alerts.length === 0) {
      widget.classList.remove('alerts-visible');
      widget.innerHTML = '';
      return;
    }

    widget.classList.add('alerts-visible');

    const badgeLabel = alerts.length === 1
      ? '1 alert'
      : `${alerts.length} alerts`;

    let html = `<button class="aw-badge" aria-expanded="${expanded}" aria-label="Service alerts">`
      + `<span class="aw-icon">⚠</span> ${badgeLabel}`
      + `</button>`;

    if (expanded) {
      html += `<div class="aw-list">`;
      for (const a of alerts) {
        const color = SERVICE_COLORS[a.service] || '#888';
        html += `<div class="aw-item" style="border-left-color:${color}">`
          + `<div class="aw-headline">${escHtml(a.headline)}</div>`
          + (a.short ? `<div class="aw-short">${escHtml(a.short)}</div>` : '')
          + `</div>`;
      }
      html += `</div>`;
    }

    widget.innerHTML = html;

    widget.querySelector('.aw-badge').addEventListener('click', (e) => {
      e.stopPropagation();
      expanded = !expanded;
      render();
    });
  }

  function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Collapse when clicking outside the widget
  document.addEventListener('click', (e) => {
    if (expanded && !widget.contains(e.target)) {
      expanded = false;
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
        expanded = false;
        render();
      }
    });
    obs.observe(closeBtn, { attributes: true, attributeFilter: ['class'] });
  }
})();
