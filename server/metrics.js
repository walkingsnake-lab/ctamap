// Prometheus-compatible metrics for CTAMap.
// Call recordPoll() after each train poll; updateSseClients() on connect/disconnect.
// renderMetrics() returns Prometheus text format for the /metrics endpoint.

const pollErrors  = { total: 0 };
const pollDuration = { ms: 0 };
let sseClientCount = 0;

// Per-line gauges reset on each poll
const perLine = {};

function recordPoll(trains, durationMs, errorCount = 0) {
  pollDuration.ms = durationMs;
  pollErrors.total += errorCount;

  // Reset per-line gauges
  for (const key of Object.keys(perLine)) {
    perLine[key] = { active: 0, delayed: 0, held: 0 };
  }

  for (const t of trains) {
    const line = t.legend || t.rt || 'unknown';
    if (!perLine[line]) perLine[line] = { active: 0, delayed: 0, held: 0 };
    perLine[line].active++;
    if (t.isDly === '1' || t.isDly === 1 || t.isDly === true) perLine[line].delayed++;
    if (t.held) perLine[line].held++;
  }
}

function updateSseClients(delta) {
  sseClientCount = Math.max(0, sseClientCount + delta);
}

function renderMetrics() {
  const lines = [];

  lines.push('# HELP ctamap_trains_active Active trains per line');
  lines.push('# TYPE ctamap_trains_active gauge');
  for (const [line, v] of Object.entries(perLine)) {
    lines.push(`ctamap_trains_active{line="${line}"} ${v.active}`);
  }

  lines.push('# HELP ctamap_trains_delayed Delayed trains per line');
  lines.push('# TYPE ctamap_trains_delayed gauge');
  for (const [line, v] of Object.entries(perLine)) {
    lines.push(`ctamap_trains_delayed{line="${line}"} ${v.delayed}`);
  }

  lines.push('# HELP ctamap_trains_held Held (position-suspect) trains per line');
  lines.push('# TYPE ctamap_trains_held gauge');
  for (const [line, v] of Object.entries(perLine)) {
    lines.push(`ctamap_trains_held{line="${line}"} ${v.held}`);
  }

  lines.push('# HELP ctamap_sse_clients Current SSE client connections');
  lines.push('# TYPE ctamap_sse_clients gauge');
  lines.push(`ctamap_sse_clients ${sseClientCount}`);

  lines.push('# HELP ctamap_poll_errors_total Cumulative CTA API poll errors');
  lines.push('# TYPE ctamap_poll_errors_total counter');
  lines.push(`ctamap_poll_errors_total ${pollErrors.total}`);

  lines.push('# HELP ctamap_poll_duration_ms Duration of the last CTA poll in milliseconds');
  lines.push('# TYPE ctamap_poll_duration_ms gauge');
  lines.push(`ctamap_poll_duration_ms ${pollDuration.ms}`);

  return lines.join('\n') + '\n';
}

module.exports = { recordPoll, updateSseClients, renderMetrics };
