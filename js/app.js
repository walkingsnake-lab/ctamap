/**
 * Main application: initializes the map, places trains, handles animation and resize.
 * On each API refresh, trains smoothly slide to their new positions over 2.5s, then sit still.
 * Clicking a train dot zooms in, tracks the train, and shows live detail from the follow API.
 */
(async function () {
  const svgEl = document.getElementById('map');
  const svg = d3.select(svgEl);

  let width = window.innerWidth;
  let height = window.innerHeight;

  svg.attr('width', width).attr('height', height);

  // ---- Load map lines ----
  let mapState;
  try {
    mapState = await loadMap(svg, width, height);
  } catch (e) {
    console.error('Failed to load CTA map data:', e);
    return;
  }

  const { geojson, mapContainer } = mapState;
  let { projection } = mapState;

  // Build per-line segment lookup for path-following animation
  const lineSegments = buildLineSegments(geojson);

  // ---- D3 zoom behavior ----
  const zoom = d3.zoom()
    .scaleExtent([1, 10])
    .on('zoom', (event) => {
      svg.select('.map-container').attr('transform', event.transform);
    });
  svg.call(zoom);

  // Create train layer on top (inside the zoom container)
  mapContainer.append('g').attr('class', 'trains-layer');

  // ---- Train selection / tracking state ----
  let selectedTrain = null;
  let selectedTrainRn = null;
  let preSelectTransform = null;
  let detailFetchInterval = null;
  let isZoomTransitioning = false;
  let lastETAs = null;
  const TRACK_ZOOM_SCALE = 8;

  // ---- Initialize trains ----
  let dummyTrains = null;
  let realTrains = null;

  const fetched = await fetchTrains();
  if (fetched && fetched.length > 0) {
    realTrains = fetched;
    initRealTrainAnimation(realTrains, lineSegments, null);
    console.log(`[CTA] Using REAL train data (${realTrains.length} trains)`);
  } else {
    dummyTrains = generateDummyTrains(geojson);
    console.log(`[CTA] Using DUMMY train data (${dummyTrains.length} trains)`);
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
    const allTrains = realTrains || dummyTrains || [];
    const layer = svg.select('.trains-layer');

    const groups = layer.selectAll('.train-group')
      .data(allTrains, d => d.rn);

    // Enter — new trains
    const enter = groups.enter()
      .append('g')
      .attr('class', 'train-group')
      .style('opacity', 0);

    // Invisible hit area for click detection
    enter.append('circle')
      .attr('class', 'train-hit')
      .attr('r', 12)
      .attr('fill', 'transparent')
      .attr('stroke', 'none');

    // Outer glow circle — stagger pulse by run number so delay is stable across refreshes
    enter.append('circle')
      .attr('class', 'train-glow')
      .attr('r', TRAIN_GLOW_RADIUS)
      .attr('fill', d => `url(#train-glow-${d.legend})`)
      .style('animation-delay', d => `${((parseInt(d.rn, 10) || 0) % 25) * 0.1}s`);

    // Inner solid dot
    enter.append('circle')
      .attr('class', 'train-dot')
      .attr('r', TRAIN_RADIUS)
      .attr('fill', d => LINE_COLORS[d.legend] || '#fff');

    // Direction arrow — small chevron anchored at the dot edge
    enter.append('path')
      .attr('class', 'train-arrow')
      .attr('d', 'M-2.2,-1.8 L0,0 L-2.2,1.8')
      .attr('fill', 'none')
      .attr('stroke', d => LINE_COLORS[d.legend] || '#fff')
      .attr('stroke-width', 0.8)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round')
      .attr('transform', d => {
        const angle = headingToSVGAngle(d.heading);
        const r = TRAIN_RADIUS + 2.5;
        const rad = angle * Math.PI / 180;
        const tx = Math.cos(rad) * r;
        const ty = Math.sin(rad) * r;
        return `translate(${tx},${ty}) rotate(${angle})`;
      });

    // Inline label (hidden by default, shown on select)
    const label = enter.append('g')
      .attr('class', 'train-label')
      .style('opacity', 0)
      .attr('transform', 'translate(0, 6)');

    // Destination badge — colored rect + text
    label.append('rect')
      .attr('class', 'label-badge')
      .attr('rx', 1)
      .attr('ry', 1)
      .attr('fill', d => LINE_COLORS[d.legend] || '#fff');

    label.append('text')
      .attr('class', 'label-dest')
      .attr('text-anchor', 'middle')
      .attr('y', 4.5)
      .text(d => (d.destNm || '').toUpperCase());

    // Run number below
    label.append('text')
      .attr('class', 'label-run')
      .attr('text-anchor', 'middle')
      .attr('y', 8.5)
      .text(d => `#${d.rn}`);

    // Size the badge rect to fit the text after insertion
    enter.each(function () {
      sizeLabelBadge(d3.select(this));
    });

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

    // Maintain selected class on merged selection
    const merged = groups.merge(enter);
    merged.classed('selected', d => d.rn === selectedTrainRn);

    // Update label visibility on merged
    merged.select('.train-label')
      .style('opacity', d => d.rn === selectedTrainRn ? 1 : 0);

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

  /**
   * Sizes the label badge rect to fit its text content.
   */
  function sizeLabelBadge(groupSel) {
    const destText = groupSel.select('.label-dest');
    const badge = groupSel.select('.label-badge');
    if (destText.empty() || badge.empty()) return;

    // Use approximate character width since getBBox may not work before render
    const text = destText.text();
    const charW = 2.2;
    const padX = 2;
    const w = Math.max(text.length * charW + padX * 2, 12);
    const h = 5.5;
    badge.attr('x', -w / 2).attr('y', 0.5).attr('width', w).attr('height', h);
  }

  renderTrains();

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
    }

    selectedTrainRn = train.rn;
    selectedTrain = train;
    lastETAs = null;

    // Highlight + show label
    svg.selectAll('.train-group')
      .classed('selected', d => d.rn === selectedTrainRn)
      .select('.train-label')
        .transition().duration(200)
        .style('opacity', d => d.rn === selectedTrainRn ? 1 : 0);

    // Animate zoom to the train (skip if switching between trains — tracking handles it)
    if (!wasTracking) {
      const pt = projection([train.lon, train.lat]);
      if (pt) {
        isZoomTransitioning = true;
        const tx = width / 2 - TRACK_ZOOM_SCALE * pt[0];
        const ty = height / 2 - TRACK_ZOOM_SCALE * pt[1];
        svg.transition('zoom-track').duration(750)
          .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(TRACK_ZOOM_SCALE))
          .on('end', () => {
            isZoomTransitioning = false;
            // Disable zoom interaction while tracking
            svg.on('.zoom', null);
          });
      }
    }

    // Fetch detailed ETA data
    fetchTrainDetail(train.rn);

    // Periodic refresh of detail data
    if (detailFetchInterval) clearInterval(detailFetchInterval);
    detailFetchInterval = setInterval(() => {
      if (selectedTrainRn) fetchTrainDetail(selectedTrainRn);
    }, REFRESH_INTERVAL);
  }

  function deselectTrain() {
    if (!selectedTrain) return;

    selectedTrain = null;
    selectedTrainRn = null;
    lastETAs = null;

    // Remove highlight + hide labels
    svg.selectAll('.train-group')
      .classed('selected', false)
      .select('.train-label')
        .transition().duration(200)
        .style('opacity', 0);

    // Stop detail refresh
    if (detailFetchInterval) {
      clearInterval(detailFetchInterval);
      detailFetchInterval = null;
    }

    // Re-enable zoom interaction
    svg.call(zoom);

    // Zoom back to previous view
    isZoomTransitioning = true;
    const restoreTo = preSelectTransform || d3.zoomIdentity;
    svg.transition('zoom-track').duration(750)
      .call(zoom.transform, restoreTo)
      .on('end', () => {
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
          updateInlineLabel(selectedTrain, data.eta);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch train detail:', e);
    }
  }

  /**
   * Updates the inline label for the currently selected train with ETA info.
   */
  function updateInlineLabel(train, etas) {
    const group = svg.selectAll('.train-group')
      .filter(d => d.rn === train.rn);
    if (group.empty()) return;

    const label = group.select('.train-label');

    // Update destination text
    let destText = (train.destNm || '').toUpperCase();
    if (etas && etas.length > 0) {
      const eta = etas[0];
      const etaMin = getETAMinutes(eta);
      if (eta.isApp === '1') {
        destText += ' · DUE';
      } else if (etaMin !== null) {
        destText += ` · ${etaMin}m`;
      }
    }
    label.select('.label-dest').text(destText);
    label.select('.label-run').text(`#${train.rn}`);

    // Re-size badge
    sizeLabelBadge(group);
  }

  function getETAMinutes(eta) {
    if (!eta.arrT || !eta.prdt) return null;
    try {
      const arr = parseCTATime(eta.arrT);
      const pred = parseCTATime(eta.prdt);
      if (!arr || !pred) return null;
      return Math.round((arr - pred) / 60000);
    } catch {
      return null;
    }
  }

  function parseCTATime(str) {
    if (!str || str.length < 15) return null;
    const formatted = str.substring(0, 4) + '-' + str.substring(4, 6) + '-' +
      str.substring(6, 8) + 'T' + str.substring(9);
    const ms = Date.parse(formatted);
    return isNaN(ms) ? null : ms;
  }

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

    // Advance dummy trains
    if (dummyTrains) {
      advanceDummyTrains(dummyTrains, geojson, dt);
    }

    // Advance real trains (correction slides on refresh, then sit still)
    if (realTrains) {
      advanceRealTrains(realTrains, lineSegments, dt);
    }

    // Update ALL train positions directly (no D3 transitions — frame-by-frame is smoother)
    svg.select('.trains-layer').selectAll('.train-group')
      .each(function (d) {
        const pt = projection([d.lon, d.lat]);
        if (!pt) return;
        const g = d3.select(this);
        g.attr('transform', `translate(${pt[0]}, ${pt[1]})`);

        // Update arrow rotation to match current heading
        const angle = headingToSVGAngle(d.heading);
        const r = TRAIN_RADIUS + 2.5;
        const rad = angle * Math.PI / 180;
        const tx = Math.cos(rad) * r;
        const ty = Math.sin(rad) * r;
        g.select('.train-arrow')
          .attr('transform', `translate(${tx},${ty}) rotate(${angle})`);
      });

    // Camera tracking for selected train
    if (selectedTrain && !isZoomTransitioning) {
      const pt = projection([selectedTrain.lon, selectedTrain.lat]);
      if (pt) {
        const tx = width / 2 - TRACK_ZOOM_SCALE * pt[0];
        const ty = height / 2 - TRACK_ZOOM_SCALE * pt[1];
        const t = d3.zoomIdentity.translate(tx, ty).scale(TRACK_ZOOM_SCALE);
        // Update D3's internal zoom state and DOM directly (no event dispatch)
        svgEl.__zoom = t;
        mapContainer.attr('transform', t.toString());
      }
    }

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

        realTrains = fetched;
        dummyTrains = null;

        // Initialize track position and drift correction
        initRealTrainAnimation(realTrains, lineSegments, prevMap);

        // Update selected train reference if tracking
        if (selectedTrainRn) {
          const newSelected = realTrains.find(t => t.rn === selectedTrainRn);
          if (newSelected) {
            selectedTrain = newSelected;
            updateInlineLabel(selectedTrain, lastETAs);
          } else {
            // Train disappeared from data
            deselectTrain();
          }
        }

        console.log(`[CTA] Refreshed REAL train data (${realTrains.length} trains)`);

        // Update DOM (enter/exit management)
        renderTrains();
      } else if (!realTrains && !dummyTrains) {
        dummyTrains = generateDummyTrains(geojson);
        console.log(`[CTA] Refresh failed, falling back to DUMMY data (${dummyTrains.length} trains)`);
        renderTrains();
      }
    }, REFRESH_INTERVAL);
  }

  // ---- Keyboard shortcuts ----
  const THE_LOOP = [-87.628, 41.882]; // [lon, lat]
  const LOOP_ZOOM_SCALE = 4;
  let isZoomedToLoop = false;

  document.addEventListener('keydown', (event) => {
    // Escape: deselect train
    if (event.key === 'Escape' && selectedTrain && !isZoomTransitioning) {
      deselectTrain();
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
        const pt = projection(THE_LOOP);
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
      width = window.innerWidth;
      height = window.innerHeight;
      svg.attr('width', width).attr('height', height);

      const result = redrawMap(svg, width, height, geojson);
      projection = result.projection;

      // Reset zoom state after redraw
      isZoomedToLoop = false;
      svg.call(zoom.transform, d3.zoomIdentity);

      // Deselect train on resize (projection changes)
      if (selectedTrain) {
        selectedTrain = null;
        selectedTrainRn = null;
        lastETAs = null;
        if (detailFetchInterval) {
          clearInterval(detailFetchInterval);
          detailFetchInterval = null;
        }
        preSelectTransform = null;
        svg.call(zoom);
      }

      // Re-generate dummy trains if using them (segments may differ after reproject)
      if (!realTrains) {
        dummyTrains = generateDummyTrains(geojson);
      }
      renderTrains();
    }, 200);
  });
})();
