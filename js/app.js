/**
 * Main application: initializes the map, places trains, handles animation and resize.
 * Real trains animate continuously between API refreshes using speed estimation.
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

  const { geojson } = mapState;
  let { projection } = mapState;

  // Build per-line segment lookup for path-following animation
  const lineSegments = buildLineSegments(geojson);

  // Build station position lookup for speed estimation
  const stationPositions = buildStationPositions(geojson);
  console.log(`[CTA] Station positions: ${stationPositions.byLine.size} line-specific, ${stationPositions.byName.size} unique names`);

  // Create train layer on top
  svg.append('g').attr('class', 'trains-layer');

  // ---- Initialize trains ----
  let dummyTrains = null;
  let realTrains = null;
  let exitingTrains = []; // Trains removed from API that coast to terminal

  const fetched = await fetchTrains();
  if (fetched && fetched.length > 0) {
    realTrains = fetched;
    initRealTrainAnimation(realTrains, lineSegments, stationPositions, null);
    console.log(`[CTA] Using REAL train data (${realTrains.length} trains)`);
  } else {
    dummyTrains = generateDummyTrains(geojson);
    console.log(`[CTA] Using DUMMY train data (${dummyTrains.length} trains)`);
  }

  // ---- Render trains (DOM management only — positions handled by animation loop) ----
  function renderTrains() {
    const activeTrains = realTrains || dummyTrains || [];
    // Combine active trains with exiting trains for rendering
    const allTrains = activeTrains.concat(exitingTrains);
    const layer = svg.select('.trains-layer');

    const groups = layer.selectAll('.train-group')
      .data(allTrains, d => d.rn);

    // Enter — new trains
    const enter = groups.enter()
      .append('g')
      .attr('class', 'train-group')
      .style('opacity', 0);

    // Outer glow circle
    enter.append('circle')
      .attr('class', 'train-glow')
      .attr('r', TRAIN_GLOW_RADIUS)
      .attr('fill', d => LINE_COLORS[d.legend] || '#fff');

    // Inner solid dot
    enter.append('circle')
      .attr('class', 'train-dot')
      .attr('r', TRAIN_RADIUS)
      .attr('fill', d => LINE_COLORS[d.legend] || '#fff');

    // Position new trains immediately, then fade in
    enter.each(function (d) {
      const pt = projection([d.lon, d.lat]);
      if (!pt) return;
      d3.select(this).attr('transform', `translate(${pt[0]}, ${pt[1]})`);
    });
    enter.transition().duration(800).style('opacity', 1);

    // Exit — trains no longer in active or exiting lists
    groups.exit()
      .transition()
      .duration(2000)
      .style('opacity', 0)
      .remove();
  }

  renderTrains();

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

    // Advance real trains continuously along track
    if (realTrains) {
      advanceRealTrains(realTrains, lineSegments, dt);
    }

    // Advance exiting trains (coasting to terminal)
    if (exitingTrains.length > 0) {
      advanceExitingTrains(exitingTrains, lineSegments, dt);

      // Check for trains that should be removed (timed out or reached terminal)
      const nowMs = Date.now();
      const toRemove = [];
      for (const t of exitingTrains) {
        const elapsed = nowMs - t._exitStartTime;
        if (elapsed > EXIT_COAST_TIMEOUT || t._reachedTerminal) {
          toRemove.push(t.rn);
        }
      }
      if (toRemove.length > 0) {
        exitingTrains = exitingTrains.filter(t => !toRemove.includes(t.rn));
        // Trigger DOM update to fade out removed trains
        renderTrains();
      }
    }

    // Update ALL train positions directly (no D3 transitions — frame-by-frame is smoother)
    svg.select('.trains-layer').selectAll('.train-group')
      .each(function (d) {
        const pt = projection([d.lon, d.lat]);
        if (!pt) return;
        d3.select(this).attr('transform', `translate(${pt[0]}, ${pt[1]})`);
      });

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

        // Identify trains that disappeared from the API
        if (realTrains) {
          const newRns = new Set(fetched.map(t => t.rn));
          for (const oldTrain of realTrains) {
            if (!newRns.has(oldTrain.rn) && oldTrain._trackPos && oldTrain._speed > 0) {
              // Train disappeared — let it coast to terminal
              oldTrain._exitStartTime = Date.now();
              oldTrain._exiting = true;
              exitingTrains.push(oldTrain);
            }
          }
        }

        realTrains = fetched;
        dummyTrains = null;

        // Initialize animation state (speed, track position, drift correction)
        initRealTrainAnimation(realTrains, lineSegments, stationPositions, prevMap);

        console.log(`[CTA] Refreshed REAL train data (${realTrains.length} active, ${exitingTrains.length} coasting)`);

        // Update DOM (enter/exit management)
        renderTrains();
      } else if (!realTrains && !dummyTrains) {
        dummyTrains = generateDummyTrains(geojson);
        console.log(`[CTA] Refresh failed, falling back to DUMMY data (${dummyTrains.length} trains)`);
        renderTrains();
      }
    }, REFRESH_INTERVAL);
  }

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

      // Re-generate dummy trains if using them (segments may differ after reproject)
      if (!realTrains) {
        dummyTrains = generateDummyTrains(geojson);
      }
      renderTrains();
    }, 200);
  });
})();
