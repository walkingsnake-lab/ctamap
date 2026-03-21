/**
 * Main application: initializes the map, places trains, handles animation and resize.
 * On each API refresh, trains smoothly slide to their new positions over 2.5s, then sit still.
 * Clicking a train dot zooms in, tracks the train, and shows live detail from the follow API.
 */
(async function () {
  let width = window.innerWidth;
  let height = window.innerHeight;

  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgEl.id = 'map';
  svgEl.setAttribute('width', width);
  svgEl.setAttribute('height', height);
  svgEl.classList.add('map-loading');
  document.body.appendChild(svgEl);
  const svg = d3.select(svgEl);

  // ---- Load map lines ----
  let mapState;
  try {
    mapState = await loadMap(svg, width, height);
  } catch (e) {
    console.error('Failed to load CTA map data:', e);
    return;
  }

  const { geojson, geoScaleReference } = mapState;
  let { projection, mapContainer, visualScale } = mapState;

  // Cap at the reference viewport size — prevents labels ballooning on large monitors.
  // visualScale > 1 on big screens means the map is spread wider, but labels don't need
  // to grow with it; we never want them larger than they are at 1440×900.
  let labelScale = Math.min(1, visualScale);

  // Base visual sizes at zoom k=1, scaled relative to the reference viewport.
  // Declared as lets so the resize handler can update them after redrawMap().
  let baseTrainRadius = TRAIN_RADIUS * visualScale;
  let baseGlowRadius  = TRAIN_GLOW_RADIUS * visualScale;
  let baseSpread      = BASE_SPREAD * visualScale;   // SVG units between spread centers

  // Build per-line segment lookup for path-following animation
  // lineSegments: full track (shared + ML) for animation/snapping
  // lineOwnSegments: line's own colored segments only (for terminal detection)
  const { segments: lineSegments, ownSegments: lineOwnSegments } = buildLineSegments(geojson);
  const lineTerminals = buildLineTerminals(lineOwnSegments, lineSegments);

  // Precompute segment neighbor maps per line for affinity snapping.
  // This avoids trains snapping to topologically distant but geographically
  // close segments at corners, crossings, and junctions.
  const lineNeighborMaps = {};
  for (const [legend, segs] of Object.entries(lineSegments)) {
    lineNeighborMaps[legend] = buildSegmentNeighborMap(segs);
  }

  // Build unique stations list for the overlay
  const stations = buildUniqueStations(geojson);

  // Build station position lookups and ordered sequences for ETA-AI mode
  const stationPositions = buildStationPositions(geojson);
  const stationSequences = buildStationSequences(lineSegments, stations, stationPositions);

  // ---- D3 zoom behavior ----
  const zoom = d3.zoom()
    .scaleExtent([1, 10])
    .on('zoom', (event) => {
      if (zoomAnim) return;
      if (selectedTrain && !isZoomTransitioning) {
        // User is adjusting zoom while tracking — capture their chosen scale and
        // immediately re-center on the train at that scale so positioning is never lost.
        trackingScale = event.transform.k;
        const pt = projection([selectedTrain.lon, selectedTrain.lat]);
        if (pt) {
          const tx = width / 2 - trackingScale * pt[0];
          const ty = height / 2 - trackingScale * pt[1];
          const t = d3.zoomIdentity.translate(tx, ty).scale(trackingScale);
          svgEl.__zoom = t;
          mapContainer.attr('transform', t.toString());
        }
      } else {
        svg.select('.map-container').attr('transform', event.transform);
      }
    });

  // Long-press to toggle stations — registered on the raw DOM element BEFORE
  // svg.call(zoom) so our listener fires first, before D3 zoom's pointerdown
  // handler calls stopImmediatePropagation(). Uses pointer events so it works
  // correctly with touch-action: none. toggleStations() is hoisted as a
  // function declaration so calling it from the setTimeout is safe.
  {
    let lpTimer = null;
    let lpOrigin = null;
    // LP_THRESHOLD and LONG_PRESS_MS defined in config.js
    svgEl.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch' || !event.isPrimary) return;
      lpOrigin = { x: event.clientX, y: event.clientY };
      lpTimer = setTimeout(() => { lpTimer = null; toggleStations(); }, LONG_PRESS_MS);
    }, { passive: true });
    svgEl.addEventListener('pointermove', (event) => {
      if (!lpTimer || !lpOrigin) return;
      const dx = event.clientX - lpOrigin.x;
      const dy = event.clientY - lpOrigin.y;
      if (dx * dx + dy * dy > LP_THRESHOLD * LP_THRESHOLD) {
        clearTimeout(lpTimer); lpTimer = null; lpOrigin = null;
      }
    }, { passive: true });
    svgEl.addEventListener('pointerup', () => {
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
      lpOrigin = null;
    });
    svgEl.addEventListener('pointercancel', () => {
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
      lpOrigin = null;
    });
  }

  svg.call(zoom);

  // ---- URL parameter handling (part 1: embed mode) ----
  // ?embed=true (or ?chrome=false) — non-interactive backdrop mode for iframes.
  //   Hides the close button and train-label overlay; disables pointer events so
  //   the SVG stays animating but doesn't respond to clicks or touch gestures.
  // ?lat=<lat>&lng=<lng>&zoom=<k> — set the initial viewport (applied below,
  //   after tracking-state variables are declared, to avoid a TDZ error).
  const _urlParams = new URLSearchParams(window.location.search);
  {
    const _embed = _urlParams.get('embed') === 'true' || _urlParams.get('chrome') === 'false';
    if (_embed) {
      document.body.classList.add('embed-mode');
      // Disable all pointer events so the SVG is a pure animation backdrop.
      svgEl.style.pointerEvents = 'none';
    }
  }

  // Render stations into the stations layer (created hidden by loadMap)
  let stationsVisible = false;
  renderStations(svg.select('.stations-layer'), stations, projection, geojson, LINE_WIDTH * labelScale);

  function scaleStationDots(k) {
    if (!stationsVisible) return;
    const dotScale = 1 / Math.pow(k, 0.6);
    svg.selectAll('.station-dot').each(function () {
      const el = d3.select(this);
      const baseR = parseFloat(el.attr('data-base-r'));
      el.attr('r', baseR * dotScale);
    });
  }

  function toggleStations() {
    stationsVisible = !stationsVisible;
    svg.select('.stations-layer').style('display', stationsVisible ? null : 'none');
    // Scale dots to current zoom level when toggled on
    scaleStationDots(d3.zoomTransform(svgEl).k);
    // Show/hide ETA table in train info panel
    labelEl.classList.toggle('show-stops', stationsVisible);
    dismissWelcome();
  }

  // Create spread-connector layer (below trains so lines sit behind dots)
  mapContainer.append('g').attr('class', 'spread-lines-layer');
  // Create train layer on top (inside the zoom container)
  mapContainer.append('g').attr('class', 'trains-layer');

  // ---- DOM label overlay ----
  const labelEl = document.createElement('div');
  labelEl.id = 'train-label';
  labelEl.innerHTML = '<div class="tl-badge"><span class="tl-dest"></span></div>' +
    '<div class="tl-info"></div>' +
    '<div class="tl-status"></div>' +
    '<div class="tl-stops"></div>';
  document.body.appendChild(labelEl);

  // ---- Close button ----
  const closeBtn = document.getElementById('close-btn');

  // ---- Train selection / tracking state ----
  let selectedTrain = null;
  let selectedTrainRn = null;
  let preSelectTransform = null;
  let detailFetchInterval = null;
  let isZoomTransitioning = false;
  let zoomAnim = null;

  // ---- URL parameter handling (part 2: initial viewport) ----
  // Applied here so the zoom event handler can safely read zoomAnim / selectedTrain.
  // lat/lng are WGS-84 decimal degrees; zoom is the D3 scale factor (1 = full city,
  // 10 = max zoom). For the Loop area zoom=4–5 works well.
  // Values are kept in outer scope so the resize handler can re-apply them after
  // redrawMap() recalculates the projection.
  const _urlLat  = parseFloat(_urlParams.get('lat'));
  const _urlLng  = parseFloat(_urlParams.get('lng') ?? _urlParams.get('lon'));
  const _urlZoom = parseFloat(_urlParams.get('zoom'));

  function applyUrlViewport() {
    if (isNaN(_urlLat) || isNaN(_urlLng) || isNaN(_urlZoom)) return false;
    const _pt = projection([_urlLng, _urlLat]);
    if (!_pt) return false;
    const _k  = Math.max(1, Math.min(10, _urlZoom));
    const _tx = width  / 2 - _k * _pt[0];
    const _ty = height / 2 - _k * _pt[1];
    svg.call(zoom.transform, d3.zoomIdentity.translate(_tx, _ty).scale(_k));
    return true;
  }

  applyUrlViewport();

  let lastETAs = null;
  let lastRenderedStopNames = null;
  // TRACK_ZOOM_SCALE defined in config.js
  let trackingScale = TRACK_ZOOM_SCALE;
  let lastLineK = -1; // tracks last zoom k at which line stroke-widths were updated

  // ---- Train spreading (overlap disambiguation) ----
  // When a train is clicked, nearby overlapping trains fan out perpendicular to
  // the track so they become individually visible and clickable.
  // SPREAD_SVG_THRESHOLD defined in config.js

  /**
   * Detect trains overlapping the selected train and assign spread target offsets.
   * Offsets are stored in SCREEN pixels (_spreadTargetPxX/Y) so the visual spread
   * stays constant regardless of zoom.  The animate loop converts to SVG units.
   *
   * On data refresh, trains that were previously spread keep their current
   * animation position so they don't "poke out" again.  Trains that have moved
   * out of the overlap zone smoothly animate back to the track.
   */
  function spreadOverlappingTrains(useTargetK) {
    if (!selectedTrain || !realTrains) return;

    const currentK = d3.zoomTransform(svgEl).k || 1;
    // When zooming in toward a train, use the target scale so spreads activate
    // immediately instead of waiting for the zoom animation to finish.
    const effectiveK = (useTargetK && zoomAnim) ? trackingScale : currentK;

    // Spread at any zoom level so overlapping trains are always visible.
    const selPt = projection([selectedTrain.lon, selectedTrain.lat]);
    if (!selPt) return;

    // Gather trains whose SVG-space position is within threshold.
    // Using SVG units (not screen pixels) keeps the overlap group stable
    // across zoom levels — prevents trains from spreading then immediately
    // collapsing as the zoom-in animation increases screen distance.
    const nearby = [];
    const allTrains = realTrains.concat(retiringTrains);
    for (const train of allTrains) {
      if (train._retiring && train._retireComplete) continue;
      const pt = projection([train.lon, train.lat]);
      if (!pt) continue;
      const dx = pt[0] - selPt[0];
      const dy = pt[1] - selPt[1];
      if (Math.sqrt(dx * dx + dy * dy) < SPREAD_SVG_THRESHOLD * visualScale) {
        nearby.push(train);
      }
    }

    // Collapse trains that were spread but are no longer in the overlap zone
    for (const train of allTrains) {
      if (train._spreading && !nearby.includes(train)) {
        // Animate back to track
        train._spreadDirX = 0;
        train._spreadDirY = 0;
        train._spreadRing = 0;
      }
    }

    if (nearby.length <= 1) {
      // No overlap — clear anchor's spreading flag too
      if (selectedTrain._spreading) {
        selectedTrain._spreading = false;
      }
      return;
    }

    // Spread directions: cardinals + diagonals (normalized)
    const D = Math.SQRT1_2; // ~0.707
    const ALL_DIRS = [
      [ 0, -1],   // above
      [ 0,  1],   // below
      [-1,  0],   // left
      [ 1,  0],   // right
      [-D, -D],   // upper-left
      [ D, -D],   // upper-right
      [-D,  D],   // lower-left
      [ D,  D],   // lower-right
    ];

    // Compute track tangent at anchor so we can avoid overlapping the current line.
    let tangentSX = 0, tangentSY = 1; // default: vertical track
    const segs = lineSegments[selectedTrain.legend];
    if (selectedTrain._trackPos && segs) {
      const dir = selectedTrain._direction || 1;
      const ahead = advanceOnTrack(selectedTrain._trackPos, 0.001, dir, segs);
      const aheadPt = projection([ahead.lon, ahead.lat]);
      if (aheadPt) {
        const tdx = aheadPt[0] - selPt[0];
        const tdy = aheadPt[1] - selPt[1];
        const len = Math.sqrt(tdx * tdx + tdy * tdy);
        if (len > 0.001) { tangentSX = tdx / len; tangentSY = tdy / len; }
      }
    }

    // Separate anchor from the rest; stable sort by run number to avoid flicker
    nearby.sort((a, b) => a.rn.localeCompare(b.rn));
    const ordered = [selectedTrain];
    for (const t of nearby) {
      if (t !== selectedTrain) ordered.push(t);
    }

    // Track which directions have been claimed so trains spread apart
    const usedDirs = [];   // array of [dx, dy] already assigned

    // Assign spread direction per train:
    //   1. Penalise alignment with the current line's track tangent (avoid own-line overlap)
    //   2. Heavily prefer the direction closest to the train's natural offset from anchor
    //      so nearby trains don't visually swap sides
    for (let i = 0; i < ordered.length; i++) {
      const train = ordered[i];
      if (i === 0) {
        // Selected train stays in place (anchor)
        train._spreadDirX = 0;
        train._spreadDirY = 0;
        train._spreadRing = 0;
        train._spreadAnchor = true;
      } else {
        // Compute this train's natural offset from the anchor in SVG space
        const trainPt = projection([train.lon, train.lat]);
        let offsetX = 0, offsetY = -1; // fallback: above
        if (trainPt) {
          const odx = trainPt[0] - selPt[0];
          const ody = trainPt[1] - selPt[1];
          const olen = Math.sqrt(odx * odx + ody * ody);
          if (olen > 0.0001) { offsetX = odx / olen; offsetY = ody / olen; }
        }

        // Score each candidate direction: low = better
        const scored = ALL_DIRS.map(([cx, cy]) => {
          // Penalty for aligning with the train's own track (overlaps the line)
          const alongTrack = Math.abs(cx * tangentSX + cy * tangentSY); // 0–1

          // Preference for direction closest to the train's natural offset.
          // dot product: 1 = same direction, -1 = opposite; invert so closer = lower score
          const closeness = -(cx * offsetX + cy * offsetY); // -1 to 1, lower = closer

          // Penalty for directions already claimed by other trains
          let claimedPenalty = 0;
          for (const [ux, uy] of usedDirs) {
            const dot = cx * ux + cy * uy;
            if (dot > 0.95) { claimedPenalty = 2; break; }  // exact match — strongly avoid
            if (dot > 0.5) { claimedPenalty = Math.max(claimedPenalty, 0.5); } // nearby
          }

          // Weight: avoid own-line overlap first, then prefer natural offset direction
          return { dx: cx, dy: cy, score: alongTrack * 1.5 + closeness * 1.0 + claimedPenalty };
        });
        scored.sort((a, b) => a.score - b.score);

        const best = scored[0];
        train._spreadDirX = best.dx;
        train._spreadDirY = best.dy;
        train._spreadRing = 1;
        usedDirs.push([best.dx, best.dy]);
      }
      // Preserve current animation position if already spreading (avoids re-poke on refresh)
      if (train._spreadX === undefined) train._spreadX = 0;
      if (train._spreadY === undefined) train._spreadY = 0;
      train._spreading = true;
    }

    // Apply CSS class immediately so spread trains get boosted visibility
    svg.selectAll('.train-group')
      .classed('train-spread', d => !!d._spreading);
  }

  /**
   * Animate all spread trains back to their natural (non-spread) positions.
   * If `instant` is true, snap immediately instead of animating.
   */
  function clearTrainSpreads(instant) {
    const allTrains = (realTrains || []).concat(retiringTrains);
    for (const train of allTrains) {
      if (!train._spreading) continue;
      train._spreadDirX = 0;
      train._spreadDirY = 0;
      train._spreadRing = 0;
      if (instant) {
        train._spreadX = 0;
        train._spreadY = 0;
        train._spreading = false;
        train._spreadAnchor = false;
      }
      // When not instant, the lerp in animate() will bring it back to 0
    }
    if (instant) {
      svg.selectAll('.train-group').classed('train-spread', false);
    }
  }

  // ---- Initialize trains ----
  let realTrains = null;
  let retiringTrains = [];

  const fetched = await fetchTrains();
  if (fetched && fetched.length > 0) {
    realTrains = fetched;
    initRealTrainAnimation(realTrains, lineSegments, null, lineTerminals, stations, lineNeighborMaps);
    console.log(`[CTA] Loaded ${realTrains.length} trains`);
  }

  // ---- Heading → SVG rotation ----
  // CTA heading: 0=N, 90=E, 180=S, 270=W (clockwise from north)
  // SVG rotation: 0=right (east), rotates clockwise
  // So SVG angle = heading - 90
  function headingToSVGAngle(heading) {
    return ((heading || 0) - 90 + 360) % 360;
  }

  // ---- Render trains (DOM management only — positions handled by animation loop) ----
  function renderTrains() {
    // Force the zoom-dependent block in animate() to re-sync glow/dot radii for any
    // newly added trains on the next animation frame.
    lastLineK = -1;

    const allTrains = (realTrains || []).concat(retiringTrains);
    const layer = svg.select('.trains-layer');

    const groups = layer.selectAll('.train-group')
      .data(allTrains, d => d.rn);

    // Enter — new trains
    const enter = groups.enter()
      .append('g')
      .attr('class', 'train-group')
      .style('opacity', 0);

    // Invisible hit area for click detection — sized to ~12px on screen.
    // Dividing by the current zoom keeps the target consistent at all zoom levels.
    enter.append('circle')
      .attr('class', 'train-hit')
      .attr('r', 12 / (d3.zoomTransform(svgEl).k || 1))
      .attr('fill', 'transparent')
      .attr('stroke', 'none');

    // Outer glow circle — stagger pulse by run number so delay is stable across refreshes
    // Stroke is used for the radar ring when selected; fill gradient for unselected pulse
    enter.append('circle')
      .attr('class', 'train-glow')
      .attr('r', baseGlowRadius)
      .attr('fill', d => `url(#train-glow-${d.legend})`)
      .attr('stroke', d => LINE_COLORS[d.legend] || '#fff')
      .style('animation-delay', d => `${((parseInt(d.rn, 10) || 0) % 25) * 0.1}s`);

    // Direction triangles — rendered before dot so they pass "behind" the circle
    // ARROW_COUNT defined in config.js
    const arrowSize = LINE_WIDTH * visualScale / 1.6;
    const arrowPath = `M ${arrowSize},0 L ${-arrowSize},${-arrowSize * 0.8} L ${-arrowSize},${arrowSize * 0.8} Z`;
    for (let i = 0; i < ARROW_COUNT; i++) {
      enter.append('path')
        .attr('class', `train-arrow train-arrow-${i}`)
        .attr('d', arrowPath)
        .attr('fill', d => LINE_COLORS[d.legend] || '#fff')
        .style('opacity', 0);
    }

    // Train dot — circle shape
    enter.append('circle')
      .attr('class', 'train-dot')
      .attr('r', baseTrainRadius)
      .attr('fill', d => LINE_COLORS[d.legend] || '#fff');

    // Heading direction triangle — overlays the circle, visible only when stations are shown
    const ht = baseTrainRadius * 0.75;
    const headingTriPath = `M ${ht},0 L ${-ht * 0.6},${-ht * 0.7} L ${-ht * 0.6},${ht * 0.7} Z`;
    enter.append('path')
      .attr('class', 'train-heading')
      .attr('d', headingTriPath)
      .attr('fill', d => d.legend === 'YL' ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.75)')
      .style('opacity', 0);

    // Click handler on new train groups
    enter.on('click', function (event, d) {
      event.stopPropagation();
      selectTrain(d);
    });

    // Position new trains immediately, then fade in
    enter.each(function (d) {
      const pt = projection([d.lon, d.lat]);
      if (!pt) return;
      d3.select(this).attr('transform', `translate(${pt[0]}, ${pt[1]})`);
    });
    enter.transition().duration(800).style('opacity', 1);

    // Maintain selected / retiring classes on merged selection
    const merged = groups.merge(enter);
    merged.classed('selected', d => d.rn === selectedTrainRn);
    merged.classed('train-retiring', d => !!d._retiring);
    merged.classed('train-spread', d => !!d._spreading);

    if (selectedTrain) {
      applyLineFocus(selectedTrain.legend);
    }

    // Exit — trains no longer in active or exiting lists
    groups.exit()
      .classed('train-exiting', true)
      .on('click', null)
      .select('.train-hit').attr('r', 0);
    groups.exit()
      .transition()
      .duration(2000)
      .style('opacity', 0)
      .remove();
  }

  renderTrains();

  // ---- Reveal map now that everything is ready ----
  // Force a layout calc so the browser registers the opacity:0 state before
  // the transition starts — without this the fade-in may be skipped.
  void svgEl.offsetWidth;
  svgEl.classList.remove('map-loading');
  svgEl.classList.add('map-ready');

  // ---- Welcome hint (fade in after map ready, auto-dismiss) ----
  const _welcomeEl = document.getElementById('welcome-hint');
  let _welcomeTimer = null;
  if (_welcomeEl && !document.body.classList.contains('embed-mode')) {
    // Small delay so the map fade-in finishes first
    setTimeout(() => {
      _welcomeEl.classList.remove('welcome-hidden');
      _welcomeTimer = setTimeout(() => { _welcomeEl.classList.add('welcome-hidden'); }, 6000);
    }, 800);
  }

  function dismissWelcome() {
    if (_welcomeEl) {
      _welcomeEl.classList.add('welcome-hidden');
      if (_welcomeTimer) { clearTimeout(_welcomeTimer); _welcomeTimer = null; }
    }
  }

  // ---- DOM label helpers ----

  function showTrainLabel(train) {
    updateTrainLabelContent(train, null);
    labelEl.classList.remove('visible');
    labelEl.classList.toggle('show-stops', stationsVisible);
    void labelEl.offsetWidth; // force reflow to restart animation
    labelEl.classList.add('visible');
  }

  function hideTrainLabel() {
    labelEl.classList.remove('visible');
  }

  function updateTrainLabelContent(train, etas) {
    const dest = labelEl.querySelector('.tl-dest');
    const badge = labelEl.querySelector('.tl-badge');
    const info = labelEl.querySelector('.tl-info');
    const status = labelEl.querySelector('.tl-status');
    const stops = labelEl.querySelector('.tl-stops');

    dest.innerHTML = formatDestName(train.destNm);

    const inverted = isInvertedBadge(train.legend, train.destNm);
    const lineColor = LINE_COLORS[train.legend] || '#888';
    badge.style.background = inverted ? '#fff' : lineColor;
    dest.style.color = inverted ? lineColor : (train.legend === 'YL' ? '#000' : '#fff');

    // Set glow color as CSS variable — animated by glow-flicker keyframes via --glow-i
    const glowColor = inverted ? lineColor : (train.legend === 'YL' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.3)');
    dest.style.setProperty('--glow-color', glowColor);

    const lineName = LEGEND_TO_LINE_NAME[train.legend] || '';
    info.textContent = `${lineName} Line \u00b7 #${train.rn}`;

    if (train._retiring) {
      status.innerHTML = '<span class="tl-limited">Arrived at terminal</span>';
    } else {
      const st = getTrainStatus(train, etas);
      if (st.prefix || st.station) {
        status.innerHTML = st.prefix + (st.station ? `<strong>${st.station}</strong>` : '');
      } else if (st.delayed) {
        status.innerHTML = '<span class="tl-delayed">Delayed</span><span class="tl-limited">Limited tracking on this train</span>';
      } else if (st.limited) {
        status.innerHTML = '<span class="tl-limited">Limited tracking on this train</span>';
      } else {
        status.textContent = '';
      }
    }

    // Upcoming stops (etas[1..5])
    const upcomingEtas = (etas && etas.length > 1)
      ? etas.slice(1, 6).filter(e => e.staNm)
      : [];
    const newStopNames = upcomingEtas.map(e => cleanStationName(e.staNm)).join(',');

    if (newStopNames !== lastRenderedStopNames) {
      // Station list changed — full rebuild (triggers entry animation)
      lastRenderedStopNames = newStopNames;
      stops.innerHTML = '';
      upcomingEtas.forEach((eta, i) => {
        const row = document.createElement('div');
        row.className = 'tl-stop-row';
        row.style.animationDelay = `${0.65 + i * 0.07}s`;
        const name = document.createElement('span');
        name.className = 'tl-stop-name';
        name.textContent = cleanStationName(eta.staNm);
        const time = document.createElement('span');
        time.className = 'tl-stop-time';
        time.textContent = formatEtaTime(eta.arrT);
        row.appendChild(name);
        row.appendChild(time);
        stops.appendChild(row);
      });
    } else {
      // Same stations — update times in place, no re-animation
      const timeEls = stops.querySelectorAll('.tl-stop-time');
      upcomingEtas.forEach((eta, i) => {
        if (timeEls[i]) timeEls[i].textContent = formatEtaTime(eta.arrT);
      });
    }
  }

  function formatEtaTime(arrT) {
    if (!arrT) return '';
    // CTA arrT is ISO 8601: "2026-03-12T18:58:22"
    const arrival = new Date(arrT);
    if (isNaN(arrival)) return '';
    const mins = Math.round((arrival - Date.now()) / 60000);
    if (mins < 1) return 'Due';
    if (mins === 1) return '1 min';
    return `${mins} min`;
  }

  function positionTrainLabel() {
    if (!selectedTrain) return;
    const pt = projection([selectedTrain.lon, selectedTrain.lat]);
    if (!pt) return;
    const t = d3.zoomTransform(svgEl);
    const sx = t.applyX(pt[0]);
    const sy = t.applyY(pt[1]);
    const scaledR = baseTrainRadius / Math.pow(t.k, 0.55);
    const offset = (scaledR + 3.0) * 1.3 * t.k + 12;
    labelEl.style.left = sx + 'px';
    labelEl.style.top = (sy + offset) + 'px';
  }

  // ---- Dim / undim helpers ----

  const lineGlow = document.getElementById('line-glow');

  function applyLineFocus(legend) {
    lastLineK = -1; // force stroke-width recalc for selected line thickening
    // Dim line paths that don't match
    svg.selectAll('.line-path')
      .classed('dimmed', function () {
        return d3.select(this).attr('data-legend') !== legend;
      });

    // Show PR express dashed paths only when Purple is focused
    svg.selectAll('.pr-express-path')
      .classed('pr-express-active', legend === 'PR');

    // Dim train groups that don't match
    svg.selectAll('.train-group')
      .classed('dimmed', d => d.legend !== legend);

    // Dim station markers that don't serve the selected line
    svg.selectAll('.station-marker')
      .classed('dimmed', function () {
        const legends = d3.select(this).attr('data-legends') || '';
        return !legends.split(',').includes(legend);
      });

    // Show bottom gradient in the selected line's color
    lineGlow.style.setProperty('--glow-line-color', LINE_COLORS[legend]);
    lineGlow.classList.add('visible');
  }

  function clearLineFocus() {
    lastLineK = -1; // force stroke-width recalc to restore normal line widths
    svg.selectAll('.line-path, .train-group, .station-marker')
      .classed('dimmed', false);
    svg.selectAll('.pr-express-path')
      .classed('pr-express-active', false);
    lineGlow.classList.remove('visible');
  }

  // ---- Train selection functions ----

  function selectTrain(train) {
    // Toggle off if already selected
    if (selectedTrainRn === train.rn) {
      deselectTrain();
      return;
    }

    const wasTracking = !!selectedTrain;

    // Save zoom state for later restoration (only on first select)
    if (!wasTracking) {
      preSelectTransform = d3.zoomTransform(svgEl);
      trackingScale = TRACK_ZOOM_SCALE;
    }

    selectedTrainRn = train.rn;
    selectedTrain = train;
    lastETAs = null;
    lastRenderedStopNames = null;
    closeBtn.classList.add('visible');

    // Highlight selected and dim other lines/trains
    svg.selectAll('.train-group')
      .classed('selected', d => d.rn === selectedTrainRn);
    applyLineFocus(train.legend);

    // Show DOM label
    showTrainLabel(train);

    // Animate zoom to the train (shorter duration when switching between trains).
    // Interpolates the train's SCREEN position from wherever it currently appears
    // to screen center, so the camera always moves toward the train rather than
    // zooming into the map center first.
    svg.interrupt('zoom-track');
    const fromTransform = d3.zoomTransform(svgEl);
    const clickPt = projection([train.lon, train.lat]);
    isZoomTransitioning = true;
    zoomAnim = {
      startTime: performance.now(),
      duration: wasTracking ? 200 : 750,
      fromK: fromTransform.k,
      fromScreenX: clickPt ? (fromTransform.k * clickPt[0] + fromTransform.x) : width / 2,
      fromScreenY: clickPt ? (fromTransform.k * clickPt[1] + fromTransform.y) : height / 2,
    };

    // Spread apart overlapping trains near the selection.
    // Don't spread yet if we're zooming in from far away — the spread will
    // activate once the zoom animation crosses the threshold (see animate()).
    clearTrainSpreads(true);
    spreadOverlappingTrains(true);  // useTargetK: treat zoom target as current k

    // Fetch detailed ETA data (skip for retiring trains — API won't have them)
    if (!train._retiring) {
      fetchTrainDetail(train.rn);

      // Periodic refresh of detail data
      if (detailFetchInterval) clearInterval(detailFetchInterval);
      detailFetchInterval = setInterval(() => {
        if (selectedTrainRn) fetchTrainDetail(selectedTrainRn);
      }, REFRESH_INTERVAL);
    } else {
      if (detailFetchInterval) clearInterval(detailFetchInterval);
      detailFetchInterval = null;
    }
  }

  function deselectTrain() {
    if (!selectedTrain) return;

    // Collapse spread trains back to their natural positions (animated)
    clearTrainSpreads(false);

    selectedTrain = null;
    selectedTrainRn = null;
    lastETAs = null;
    closeBtn.classList.remove('visible');

    // Remove highlight and restore full opacity
    svg.selectAll('.train-group')
      .classed('selected', false);
    clearLineFocus();

    // Hide DOM label
    hideTrainLabel();

    // Stop detail refresh
    if (detailFetchInterval) {
      clearInterval(detailFetchInterval);
      detailFetchInterval = null;
    }

    // Cancel any in-progress zoom animation / transition
    zoomAnim = null;
    svg.interrupt('zoom-track');

    // Zoom back to previous view
    isZoomTransitioning = true;
    const restoreTo = preSelectTransform || d3.zoomIdentity;
    svg.transition('zoom-track').duration(750)
      .call(zoom.transform, restoreTo)
      .on('end', () => {
        isZoomTransitioning = false;
      })
      .on('interrupt', () => {
        isZoomTransitioning = false;
      });
    preSelectTransform = null;
    isZoomedToLoop = false;
  }

  async function fetchTrainDetail(rn) {
    try {
      const data = await d3.json(`/api/train/${rn}`);
      if (data && data.eta) {
        lastETAs = data.eta;
        if (selectedTrain && selectedTrainRn === rn) {
          updateTrainLabelContent(selectedTrain, data.eta);
        }

      }
    } catch (e) {
      console.warn('Failed to fetch train detail:', e);
    }
  }

  /**
   * Formats destination name with airplane symbol for airport terminals.
   */
  function formatDestName(name) {
    const text = cleanStationName(name) || '';
    if (/O'?HARE/i.test(name) || /MIDWAY/i.test(name)) {
      return text + ' <span class="tl-plane">\u2708</span>';
    }
    return text;
  }

  /**
   * Derives status parts from ETA data or train-level flags.
   * Returns { prefix, station } where station should be rendered bold.
   */
  function getTrainStatus(train, etas) {
    if (etas && etas.length > 0) {
      const eta = etas[0];
      if (eta.isApp === '1' && eta.staNm) return { prefix: 'Approaching ', station: cleanStationName(eta.staNm) };
      if (eta.staNm) return { prefix: 'Next: ', station: cleanStationName(eta.staNm) };
    }
    if (train.isApp === '1') return { prefix: 'Approaching station', station: '' };
    if (train.isDly === '1') return { prefix: '', station: '', delayed: true };
    return { prefix: '', station: '', limited: true };
  }

  // Close button handler
  closeBtn.addEventListener('click', () => {
    if (selectedTrain && !isZoomTransitioning) deselectTrain();
  });

  // Click background to deselect
  svg.on('click.deselect', function (event) {
    if (selectedTrain && !isZoomTransitioning && !event.target.closest('.train-group')) {
      deselectTrain();
    }
  });

  // ---- Unified animation loop ----
  let lastTime = performance.now();

  function animate(now) {
    let dt = now - lastTime;
    lastTime = now;

    // Cap dt to prevent huge jumps when tab returns from background
    if (dt > 100) dt = 16;

    // Advance real trains
    if (realTrains) {
      advanceRealTrains(realTrains, lineSegments, dt);
    }

    // Advance retiring trains toward terminal, then hold, then remove
    if (retiringTrains.length > 0) {
      advanceRetiringTrains(retiringTrains, lineSegments, dt);
      const prevCount = retiringTrains.length;
      retiringTrains = retiringTrains.filter(t => !t._retireComplete);
      if (retiringTrains.length < prevCount) renderTrains();
    }

    // Re-evaluate spread every 500ms so trains that drift apart collapse promptly
    if (selectedTrain) {
      if (!animate._lastSpreadCheck) animate._lastSpreadCheck = 0;
      animate._lastSpreadCheck += dt;
      if (animate._lastSpreadCheck > 500) {
        animate._lastSpreadCheck = 0;
        spreadOverlappingTrains(!!zoomAnim);
      }
    }

    // Update ALL train positions directly (no D3 transitions — frame-by-frame is smoother)
    // Scale dots inversely with zoom so they don't grow unboundedly when zoomed in.
    // Exponent 0.6 gives partial compensation: dots shrink at high zoom but keep visual weight.
    // The "larger on mobile" feel is preserved — it comes from the map being compressed into
    // fewer pixels, not from r being different.
    const currentK = d3.zoomTransform(svgEl).k;
    const scaledRadius     = baseTrainRadius / Math.pow(currentK, 0.45);
    const scaledGlowRadius = baseGlowRadius  / Math.pow(currentK, 0.5);

    // Thin lines slightly as zoom increases — only recalculate when k changes.
    if (currentK !== lastLineK) {
      lastLineK = currentK;
      // Keep hit area a fixed screen size (~12px) regardless of zoom level.
      // Without this, the hit circle (r=12 SVG units) grows with the zoom
      // transform, reaching 96px screen radius at k=8 and causing accidental
      // taps and overlapping targets at high zoom.
      const scaledHitRadius = 12 / currentK;
      svg.selectAll('.train-hit').attr('r', scaledHitRadius);
      const scaledLineWidth = LINE_WIDTH * visualScale / Math.pow(currentK, 0.6);
      const selLegend = selectedTrain?.legend;
      svg.selectAll('.line-path').attr('stroke-width', function () {
        return selLegend && d3.select(this).attr('data-legend') === selLegend
          ? scaledLineWidth * 2.2
          : scaledLineWidth;
      });
      svg.selectAll('.pr-express-path')
        .attr('stroke-dasharray', `${scaledLineWidth * 3} ${scaledLineWidth * 2}`);
      // Keep arrow width in sync with the selected (thicker) line width.
      const arrowLineWidth = selLegend ? scaledLineWidth * 2.2 : scaledLineWidth;
      const sas = arrowLineWidth / 2.0;
      const sap = `M ${sas},0 L ${-sas},${-sas * 0.8} L ${-sas},${sas * 0.8} Z`;
      svg.selectAll('.train-arrow').attr('d', sap);

      // Scale station dots to match line width at every zoom level
      scaleStationDots(currentK);

      // Update glow radius for zoom level — only when k changes, not every frame.
      // Changing an SVG attribute on a CSS-animated element every frame invalidates
      // its compositor layer and causes the pulse animation to flicker in Chrome.
      svg.selectAll('.train-glow').attr('r', scaledGlowRadius);
    }

    // Spread interpolation factor — framerate-independent exponential ease.
    // pow(0.00005, dt/1000) ≈ 0.85 at 60fps → alpha ≈ 0.15 per frame, snappy ~200ms settle.
    const spreadLerp = 1 - Math.pow(0.00005, dt / 1000);

    // Collect spread train positions for connector lines
    let spreadAnchorPos = null;
    const spreadChildPositions = [];

    // Pre-compute anchor SVG position so spread children can pin to it
    let anchorPt = null;
    if (selectedTrain) {
      anchorPt = projection([selectedTrain.lon, selectedTrain.lat]);
    }

    svg.select('.trains-layer').selectAll('.train-group')
      .each(function (d) {
        const pt = projection([d.lon, d.lat]);
        if (!pt) return;
        const g = d3.select(this);

        // Interpolate spread offset — target recomputed each frame so it
        // tracks dot size as the user zooms in/out
        let sdx = 0, sdy = 0;
        if (d._spreading) {
          const spreadScale = baseSpread / Math.pow(currentK, 0.55);
          const targetX = (d._spreadDirX || 0) * spreadScale * (d._spreadRing || 0);
          const targetY = (d._spreadDirY || 0) * spreadScale * (d._spreadRing || 0);
          d._spreadX += (targetX - d._spreadX) * spreadLerp;
          d._spreadY += (targetY - d._spreadY) * spreadLerp;
          // Snap to zero when collapsing and close enough.
          // Keep _spreading true for the selected train (spread anchor) so its
          // heading triangle stays visible while other trains are fanned out.
          if (targetX === 0 && targetY === 0 &&
              Math.abs(d._spreadX) < 0.001 && Math.abs(d._spreadY) < 0.001) {
            // Don't clear anchor while children are still collapsing —
            // connectors need the anchor position until all offsets reach zero.
            if (d._spreadAnchor && d.rn !== selectedTrainRn) {
              // Anchor after deselect: keep alive until no other train is spreading
              // (checked below after the .each loop)
            } else if (d.rn !== selectedTrainRn) {
              d._spreadX = 0;
              d._spreadY = 0;
              d._spreading = false;
              d._spreadAnchor = false;
              g.classed('train-spread', false);
            }
          }
          sdx = d._spreadX;
          sdy = d._spreadY;
        }

        // Position spread children relative to the anchor so the visual
        // separation is consistent regardless of the train's own track offset.
        let finalX = pt[0] + sdx;
        let finalY = pt[1] + sdy;
        if (d._spreading && anchorPt && d.rn !== selectedTrainRn &&
            (d._spreadDirX !== 0 || d._spreadDirY !== 0)) {
          finalX = anchorPt[0] + sdx;
          finalY = anchorPt[1] + sdy;
        }

        g.attr('transform', `translate(${finalX}, ${finalY})`);

        // Track positions for spread connector lines.
        // _spreadAnchor persists after deselect so connectors stay visible
        // while children lerp back to center.
        if (d._spreading && d._spreadAnchor) {
          spreadAnchorPos = [finalX, finalY];
        } else if (d._spreading && (sdx !== 0 || sdy !== 0)) {
          spreadChildPositions.push([finalX, finalY]);
        }

        // Animate direction triangles: steady stream flowing along the track
        const segs = lineSegments[d.legend];
        const showArrows = d.rn === selectedTrainRn
          && d._trackPos && segs;

        if (showArrows) {
          if (d._arrowPhase === undefined) d._arrowPhase = 0;
          d._arrowPhase = (d._arrowPhase + dt / 3600) % 1;

          const dir = (d._correcting ? (d._trackPos.direction ?? d._corrDirection) : d._direction) || 1;
          const behindDist = 0.005; // start this far behind the dot
          const totalDist = 0.010;  // total travel distance (behind + ahead)

          // Target hint for junction selection: when correcting, the correction
          // target guides forward arrows toward the correct segment at Loop junctions
          // (where arrival-direction alignment would pick the wrong branch).
          // Trailing arrows (dist < 0) must NOT use this forward target — it would
          // cause them to pick the wrong branch at junctions the train just passed.
          // They rely on the arrival-direction heuristic instead, which correctly
          // selects the segment the train came from.
          const arrowTarget = d._corrToTrackPos
            ? { targetLon: d._corrToTrackPos.lon, targetLat: d._corrToTrackPos.lat }
            : undefined;

          for (let i = 0; i < 6; i++) {
            const arrow = g.select(`.train-arrow-${i}`);
            const phase = (d._arrowPhase + i / 6) % 1;
            // Start behind the dot, move forward through it
            const dist = -behindDist + totalDist * phase;

            // Forward arrows use the correction target; trailing arrows do not.
            const fwdTarget = dist >= 0 ? arrowTarget : undefined;

            // Advance along track; negative = behind dot
            const advDir = dist >= 0 ? dir : -dir;
            const advPos = advanceOnTrack(d._trackPos, Math.abs(dist), advDir, segs, fwdTarget);
            const advPt = projection([advPos.lon, advPos.lat]);

            if (advPt) {
              const dx = advPt[0] - pt[0];
              const dy = advPt[1] - pt[1];

              // Compute rotation angle from a small look-ahead along the track.
              // advPos.direction reflects any direction flip from segment boundary
              // crossings (e.g. two GeoJSON segments stored end-to-end).
              // For arrows ahead of the dot (dist >= 0) the look-ahead continues
              // in advPos.direction (the effective forward direction in that segment).
              // For arrows behind the dot (dist < 0) the look-ahead must be inverted
              // because we arrived by going backward; -advPos.direction is the
              // train's forward direction from that position.
              const lookAheadDir = dist >= 0 ? advPos.direction : -advPos.direction;
              const aheadPos = advanceOnTrack(advPos, 0.0005, lookAheadDir, segs, fwdTarget);
              const aheadPt = projection([aheadPos.lon, aheadPos.lat]);
              let angle = 0;
              if (aheadPt) {
                const adx = aheadPt[0] - advPt[0];
                const ady = aheadPt[1] - advPt[1];
                if (adx !== 0 || ady !== 0) {
                  angle = Math.atan2(ady, adx) * 180 / Math.PI;
                }
              }

              // Smooth phase-based opacity: 0 at edges, peak ~0.85 in the middle
              // sin^0.6 stays high longer for a slower fade
              const opacity = 0.85 * Math.pow(Math.sin(phase * Math.PI), 0.6);

              arrow
                .attr('transform', `translate(${dx},${dy}) rotate(${angle})`)
                .style('opacity', opacity);
            }
          }
        } else {
          d._arrowPhase = undefined;
          for (let i = 0; i < 6; i++) {
            g.select(`.train-arrow-${i}`).style('opacity', 0);
          }
        }

        // Rotate the combined dot+pointer shape to face the heading direction
        const dotEl = g.select('.train-dot');
        const headingEl = g.select('.train-heading');
        dotEl.attr('r', scaledRadius);
        const dotScale = d.rn === selectedTrainRn ? 1.8 : 1;
        const headingScale = dotScale / Math.pow(currentK, 0.55);
        let headingVisible = stationsVisible;
        if (d._trackPos && segs) {
          const hdir = (d._correcting ? (d._trackPos.direction ?? d._corrDirection) : d._direction) || 1;
          // Cache heading computation: advanceOnTrack is expensive at ~100 trains × 60fps.
          // Skip recompute when the track position (segIdx, ptIdx, t) and direction are unchanged
          // — trains are stationary ~87% of the time (2.5s correction / 20s interval).
          const hCacheKey = d._trackPos.segIdx * 1e8 + d._trackPos.ptIdx * 1e4 + Math.round(d._trackPos.t * 9999);
          if (hCacheKey !== d._hCacheKey || hdir !== d._hCacheDir) {
            d._hCacheKey = hCacheKey;
            d._hCacheDir = hdir;
            const headingTarget = d._corrToTrackPos
              ? { targetLon: d._corrToTrackPos.lon, targetLat: d._corrToTrackPos.lat }
              : undefined;
            const aheadPos = advanceOnTrack(d._trackPos, 0.001, hdir, segs, headingTarget);
            const aheadPt = projection([aheadPos.lon, aheadPos.lat]);
            if (aheadPt) {
              const hdx = aheadPt[0] - pt[0];
              const hdy = aheadPt[1] - pt[1];
              if (hdx !== 0 || hdy !== 0) {
                d._lastHeadingAngle = Math.atan2(hdy, hdx) * 180 / Math.PI;
              }
            }
          }
          if (d._lastHeadingAngle !== undefined) {
            const angle = d._lastHeadingAngle;
            dotEl.attr('transform', `rotate(${angle}) scale(${dotScale})`);
            headingEl.attr('transform', `rotate(${angle}) scale(${headingScale})`);
          } else {
            dotEl.attr('transform', `scale(${dotScale})`);
            headingEl.attr('transform', `scale(${headingScale})`);
          }
        } else if (d.heading !== undefined) {
          const angle = headingToSVGAngle(d.heading);
          dotEl.attr('transform', `rotate(${angle}) scale(${dotScale})`);
          headingEl.attr('transform', `rotate(${angle}) scale(${headingScale})`);
        } else {
          dotEl.attr('transform', `scale(${dotScale})`);
          headingEl.attr('transform', `scale(${headingScale})`);
        }
        // Smooth heading opacity: lerp toward target so it fades in/out
        // instead of popping.  Uses the same exponential ease as spread.
        const headingTarget = headingVisible ? 1 : 0;
        if (d._headingOpacity === undefined) d._headingOpacity = headingTarget;
        d._headingOpacity += (headingTarget - d._headingOpacity) * spreadLerp;
        // Snap to exact 0/1 when close enough to avoid lingering sub-pixel draws
        if (Math.abs(d._headingOpacity - headingTarget) < 0.01) d._headingOpacity = headingTarget;
        headingEl.style('opacity', d._headingOpacity);
      });

    // Draw connector lines from spread anchor to each fanned-out train
    const linesLayer = svg.select('.spread-lines-layer');
    const lineData = (spreadAnchorPos && spreadChildPositions.length > 0)
      ? spreadChildPositions : [];
    const connectors = linesLayer.selectAll('.spread-connector').data(lineData);
    connectors.enter().append('line')
      .attr('class', 'spread-connector')
      .merge(connectors)
      .attr('x1', spreadAnchorPos ? spreadAnchorPos[0] : 0)
      .attr('y1', spreadAnchorPos ? spreadAnchorPos[1] : 0)
      .attr('x2', d => d[0])
      .attr('y2', d => d[1]);
    connectors.exit().remove();

    // Clean up spread anchor after all children have finished collapsing.
    // The anchor stays alive during collapse so connectors have a source point.
    if (spreadChildPositions.length === 0 && !selectedTrainRn) {
      const allT = (realTrains || []).concat(retiringTrains);
      for (const t of allT) {
        if (t._spreadAnchor && t._spreading) {
          t._spreading = false;
          t._spreadAnchor = false;
          svg.selectAll('.train-group')
            .filter(d => d.rn === t.rn)
            .classed('train-spread', false);
        }
      }
    }

    // Camera tracking / zoom-in animation for selected train
    if (zoomAnim && selectedTrain) {
      // Interpolate the train's screen position from its starting location
      // to screen center while simultaneously zooming in. This keeps the
      // camera moving directly toward the train at all times.
      const elapsed = now - zoomAnim.startTime;
      const progress = Math.min(elapsed / zoomAnim.duration, 1);
      const eased = progress * progress * (3 - 2 * progress); // smoothstep

      const pt = projection([selectedTrain.lon, selectedTrain.lat]);
      if (pt) {
        const k = zoomAnim.fromK + (trackingScale - zoomAnim.fromK) * eased;
        const sx = zoomAnim.fromScreenX + (width / 2 - zoomAnim.fromScreenX) * eased;
        const sy = zoomAnim.fromScreenY + (height / 2 - zoomAnim.fromScreenY) * eased;
        const tx = sx - k * pt[0];
        const ty = sy - k * pt[1];
        const t = d3.zoomIdentity.translate(tx, ty).scale(k);
        svgEl.__zoom = t;
        mapContainer.attr('transform', t.toString());
      }
      if (progress >= 1) {
        zoomAnim = null;
        isZoomTransitioning = false;
      }
    } else if (selectedTrain && !isZoomTransitioning) {
      const pt = projection([selectedTrain.lon, selectedTrain.lat]);
      if (pt) {
        const tx = width / 2 - trackingScale * pt[0];
        const ty = height / 2 - trackingScale * pt[1];
        const t = d3.zoomIdentity.translate(tx, ty).scale(trackingScale);
        svgEl.__zoom = t;
        mapContainer.attr('transform', t.toString());
      }
    }

    // Position DOM label over the selected train
    positionTrainLabel();

    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);

  // ---- Handle background tab ----
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      lastTime = performance.now();
    }
  });

  // ---- Periodic refresh for real API data ----
  if (API_KEY) {
    setInterval(async () => {
      const fetched = await fetchTrains();
      if (fetched && fetched.length > 0) {
        // Build prev map from current real trains for velocity + drift calculation
        const prevMap = new Map();
        if (realTrains) {
          for (const t of realTrains) prevMap.set(t.rn, t);
        }

        // Detect trains going out of service near a terminal — retire them
        // instead of letting them vanish immediately.
        // Uses the line's OWN segments only (no shared/ML) so trains like
        // Purple don't bleed past Howard onto Red line track.
        if (realTrains) {
          const newRns = new Set(fetched.map(t => t.rn));
          const retireRns = new Set(retiringTrains.map(t => t.rn));
          for (const train of realTrains) {
            if (newRns.has(train.rn) || train._retiring || retireRns.has(train.rn)) continue;

            const ownSegs = lineOwnSegments[train.legend];
            if (!ownSegs || ownSegs.length === 0) continue;

            // Re-snap to the line's own segments (excludes shared/ML track)
            const ownPos = snapToTrackPosition(train.lon, train.lat, ownSegs);

            // Walk both directions to find the nearest dead-end terminal
            const endFwd = advanceOnTrack(ownPos, 0.5, +1, ownSegs);
            const endBwd = advanceOnTrack(ownPos, 0.5, -1, ownSegs);
            const dFwd = endFwd.stopped ? geoDist(train.lon, train.lat, endFwd.lon, endFwd.lat) : Infinity;
            const dBwd = endBwd.stopped ? geoDist(train.lon, train.lat, endBwd.lon, endBwd.lat) : Infinity;

            let terminalPos, slideDir;
            if (dFwd <= dBwd) {
              if (dFwd >= TERMINAL_PROXIMITY_THRESHOLD) continue;
              terminalPos = endFwd;
              slideDir = +1;
            } else {
              if (dBwd >= TERMINAL_PROXIMITY_THRESHOLD) continue;
              terminalPos = endBwd;
              slideDir = -1;
            }

            train._retiring = true;
            train._retireTime = null;
            train._retireSegs = ownSegs; // slide along own segments only

            const dist = Math.min(dFwd, dBwd);

            // If already extremely close, skip the approach slide
            if (dist < 1e-4) {
              train._correcting = false;
              train._trackPos = terminalPos;
              train.lon = terminalPos.lon;
              train.lat = terminalPos.lat;
              train._retireTime = Date.now();
            } else {
              // Set up correction slide toward terminal
              train._corrFromTrackPos = ownPos;
              train._corrToTrackPos = terminalPos;
              train._corrDirection = slideDir;
              train._corrTotalDist = trackDistanceBetween(
                ownPos, terminalPos, slideDir, ownSegs
              );
              train._correcting = true;
              train._corrStartTime = Date.now();
            }

            retiringTrains.push(train);
          }

          // Remove any retiring trains that somehow reappeared in fresh data
          if (retiringTrains.length > 0) {
            retiringTrains = retiringTrains.filter(t => !newRns.has(t.rn));
          }
        }

        realTrains = fetched;

        // Carry over spread animation state from previous train objects so
        // already-spread trains don't "re-poke" from center on each refresh.
        if (prevMap) {
          for (const train of realTrains) {
            const prev = prevMap.get(train.rn);
            if (prev && prev._spreading) {
              train._spreadX = prev._spreadX;
              train._spreadY = prev._spreadY;
              train._spreadDirX = prev._spreadDirX;
              train._spreadDirY = prev._spreadDirY;
              train._spreadRing = prev._spreadRing;
              train._spreading = true;
            }
          }
        }

        // Initialize track position and drift correction
        initRealTrainAnimation(realTrains, lineSegments, prevMap, lineTerminals, stations, lineNeighborMaps);

        // Spawn animation for new trains: slide from start-of-line to tracked position,
        // but only if the train is close to the start terminal (same threshold as retirement).
        // Trains that appear deep into their route just pop in normally.
        if (prevMap && prevMap.size > 0) {
          for (const train of realTrains) {
            if (prevMap.has(train.rn)) continue; // existing train, not new
            const segs = lineSegments[train.legend];
            if (!segs || !train._trackPos) continue;

            // Walk backward along the track to find the start terminal
            const dir = train._direction || 1;
            const startPos = advanceOnTrack(train._trackPos, 0.5, -dir, segs);
            if (!startPos.stopped) continue; // no dead-end found (disconnected segments)

            const dist = geoDist(train.lon, train.lat, startPos.lon, startPos.lat);
            if (dist >= TERMINAL_PROXIMITY_THRESHOLD) continue; // too far from start, just appear

            // Save target (current API position) and set up slide from start terminal
            const targetPos = { ...train._trackPos };
            train._corrFromTrackPos = startPos;
            train._corrToTrackPos = targetPos;
            train._corrDirection = dir;
            train._corrTotalDist = trackDistanceBetween(startPos, targetPos, dir, segs);
            train._correcting = true;
            train._corrStartTime = Date.now();
            train._spawning = true;

            // Place train at start terminal initially
            train.lon = startPos.lon;
            train.lat = startPos.lat;
            train._trackPos = startPos;
          }
        }

        // Update selected train reference if tracking
        if (selectedTrainRn) {
          const newSelected = realTrains.find(t => t.rn === selectedTrainRn)
            || retiringTrains.find(t => t.rn === selectedTrainRn);
          if (newSelected) {
            selectedTrain = newSelected;
            updateTrainLabelContent(selectedTrain, lastETAs);
            // Re-spread with new train objects (positions may have shifted)
            spreadOverlappingTrains();
          } else {
            // Train disappeared from data
            deselectTrain();
          }
        }

        console.log(`[CTA] Refreshed train data (${realTrains.length} trains)`);

        // Update DOM (enter/exit management)
        renderTrains();
      }
    }, REFRESH_INTERVAL);
  }

  // ---- Keyboard shortcuts ----
  // LOOP_CENTER and LOOP_ZOOM_SCALE defined in config.js
  let isZoomedToLoop = false;

  document.addEventListener('keydown', (event) => {
    // Escape: deselect train
    if (event.key === 'Escape' && selectedTrain && !isZoomTransitioning) {
      deselectTrain();
      return;
    }

    // S key: toggle station name overlay
    if (event.key === 's' || event.key === 'S') {
      toggleStations();
      return;
    }

    // F key: toggle cursor flashlight effect
    if (event.key === 'f' || event.key === 'F') {
      flashlightOn = !flashlightOn;
      cursorLight.classList.toggle('active', flashlightOn);
      return;
    }

    // L key: zoom to The Loop (deselects train first if tracking)
    if (event.key === 'l' || event.key === 'L') {
      if (selectedTrain) {
        deselectTrain();
        return;
      }

      if (isZoomedToLoop) {
        svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
        isZoomedToLoop = false;
      } else {
        const pt = projection([LOOP_CENTER.lon, LOOP_CENTER.lat]);
        if (!pt) return;
        const tx = width / 2 - LOOP_ZOOM_SCALE * pt[0];
        const ty = height / 2 - LOOP_ZOOM_SCALE * pt[1];
        svg.transition().duration(750).call(
          zoom.transform,
          d3.zoomIdentity.translate(tx, ty).scale(LOOP_ZOOM_SCALE)
        );
        isZoomedToLoop = true;
      }
    }
  });

  // ---- Resize handler ----
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      width = svgEl.clientWidth || window.innerWidth;
      height = svgEl.clientHeight || window.innerHeight;
      svg.attr('width', width).attr('height', height);

      const result = redrawMap(svg, width, height, geojson, geoScaleReference);
      projection = result.projection;
      visualScale = result.visualScale;
      labelScale = Math.min(1, visualScale);
      baseTrainRadius = TRAIN_RADIUS * visualScale;
      baseGlowRadius  = TRAIN_GLOW_RADIUS * visualScale;
      baseSpread      = BASE_SPREAD * visualScale;
      mapContainer = svg.select('.map-container');

      // Recreate spread-connector and trains layers (redrawMap wipes SVG)
      mapContainer.append('g').attr('class', 'spread-lines-layer');
      mapContainer.append('g').attr('class', 'trains-layer');

      // Re-render stations overlay
      renderStations(svg.select('.stations-layer'), stations, projection, geojson, LINE_WIDTH * labelScale);
      if (!stationsVisible) svg.select('.stations-layer').style('display', 'none');

      isZoomedToLoop = false;
      lastLineK = -1; // force stroke-width recalc on fresh DOM elements

      if (selectedTrain) {
        // Keep tracking through resize (e.g. mobile address bar toggle)
        zoomAnim = null;
        isZoomTransitioning = false;
        svg.interrupt('zoom-track');
        preSelectTransform = null;
        const pt = projection([selectedTrain.lon, selectedTrain.lat]);
        if (pt) {
          const tx = width / 2 - trackingScale * pt[0];
          const ty = height / 2 - trackingScale * pt[1];
          const t = d3.zoomIdentity.translate(tx, ty).scale(trackingScale);
          svgEl.__zoom = t;
          mapContainer.attr('transform', t.toString());
        }
      } else {
        // Re-apply URL viewport if present (projection changed, so transform must be
        // recalculated), otherwise reset to identity as before.
        if (!applyUrlViewport()) {
          svg.call(zoom.transform, d3.zoomIdentity);
        }
      }

      renderTrains();
    }, 200);
  });

  // Cursor flashlight effect — toggled with F, repositions gradient on mouse move.
  const cursorLight = document.getElementById('cursor-light');
  let flashlightOn = false;
  document.addEventListener('mousemove', (e) => {
    if (!flashlightOn) return;
    cursorLight.style.background =
      `radial-gradient(circle 850px at ${e.clientX}px ${e.clientY}px, transparent 0%, rgba(0,0,0,0.9) 100%)`;
  });

  // Console debug helper — select any active train by run number.
  // Useful when a hold/snap log mentions an rn you want to inspect on the map.
  // Usage: ctaTrain('020')  ← always quote zero-padded run numbers;
  //        ctaTrain(523)    ← bare numbers without leading zeros are fine too.
  window.ctaTrain = (rn) => {
    // Numeric inputs are padded to 3 digits to match CTA's zero-padded rn strings.
    // Note: bare octal literals like 020 are interpreted by JS before we see them
    // (020 octal = 16 decimal → "016", not "020"). Always quote zero-padded rns.
    const rns = typeof rn === 'number' ? String(rn).padStart(3, '0') : String(rn);
    const train = [...(realTrains || []), ...retiringTrains].find(t => t.rn === rns);
    if (!train) {
      console.warn(`[CTA] ctaTrain: no active train with rn=${rns}` +
        (typeof rn === 'number' && String(rn) !== rns ? ` (searched as "${rns}")` : '') +
        ' — if the rn has a leading zero, quote it: ctaTrain(\'020\')');
      return;
    }
    selectTrain(train);
  };
})();
