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

  // Build station position lookup for terminal proximity checks
  const stationPositions = buildStationPositions(geojson);

  // ---- D3 zoom behavior ----
  const zoom = d3.zoom()
    .scaleExtent([1, 10])
    .on('zoom', (event) => {
      svg.select('.map-container').attr('transform', event.transform);
    });
  svg.call(zoom);

  // Create train layer on top (inside the zoom container)
  mapContainer.append('g').attr('class', 'trains-layer');

  // ---- DOM label overlay ----
  const labelEl = document.createElement('div');
  labelEl.id = 'train-label';
  labelEl.innerHTML = '<div class="tl-badge"><span class="tl-dest"></span></div>' +
    '<div class="tl-info"></div>' +
    '<div class="tl-status"></div>';
  document.body.appendChild(labelEl);

  // ---- Close button ----
  const closeBtn = document.getElementById('close-btn');

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
  let retiringTrains = [];

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
    const allTrains = (realTrains || dummyTrains || []).concat(retiringTrains);
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
    // Stroke is used for the radar ring when selected; fill gradient for unselected pulse
    enter.append('circle')
      .attr('class', 'train-glow')
      .attr('r', TRAIN_GLOW_RADIUS)
      .attr('fill', d => `url(#train-glow-${d.legend})`)
      .attr('stroke', d => LINE_COLORS[d.legend] || '#fff')
      .style('animation-delay', d => `${((parseInt(d.rn, 10) || 0) % 25) * 0.1}s`);

    // Direction dots — rendered before dot so they pass "behind" the circle
    const ARROW_COUNT = 6;
    for (let i = 0; i < ARROW_COUNT; i++) {
      enter.append('circle')
        .attr('class', `train-arrow train-arrow-${i}`)
        .attr('r', LINE_WIDTH / 2)
        .attr('fill', d => LINE_COLORS[d.legend] || '#fff')
        .style('opacity', 0);
    }

    // Inner solid dot (on top of direction dots)
    enter.append('circle')
      .attr('class', 'train-dot')
      .attr('r', TRAIN_RADIUS)
      .attr('fill', d => LINE_COLORS[d.legend] || '#fff');

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

  // ---- DOM label helpers ----

  function showTrainLabel(train) {
    updateTrainLabelContent(train, null);
    labelEl.classList.remove('visible');
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

    const st = getTrainStatus(train, etas);
    if (st.prefix || st.station) {
      status.innerHTML = st.prefix + (st.station ? `<strong>${st.station}</strong>` : '');
    } else {
      status.textContent = '';
    }
  }

  function positionTrainLabel() {
    if (!selectedTrain) return;
    const pt = projection([selectedTrain.lon, selectedTrain.lat]);
    if (!pt) return;
    const t = d3.zoomTransform(svgEl);
    const sx = t.applyX(pt[0]);
    const sy = t.applyY(pt[1]);
    const offset = TRAIN_RADIUS * 1.5 * t.k + 10;
    labelEl.style.left = sx + 'px';
    labelEl.style.top = (sy + offset) + 'px';
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
    }

    selectedTrainRn = train.rn;
    selectedTrain = train;
    lastETAs = null;
    closeBtn.classList.add('visible');

    // Highlight selected
    svg.selectAll('.train-group')
      .classed('selected', d => d.rn === selectedTrainRn);

    // Show DOM label
    showTrainLabel(train);

    // Animate zoom to the train (shorter duration when switching between trains)
    const pt = projection([train.lon, train.lat]);
    if (pt) {
      // Cancel any in-progress zoom transition cleanly
      svg.interrupt('zoom-track');

      // Disable zoom interaction while tracking
      svg.on('.zoom', null);

      isZoomTransitioning = true;
      const tx = width / 2 - TRACK_ZOOM_SCALE * pt[0];
      const ty = height / 2 - TRACK_ZOOM_SCALE * pt[1];
      svg.transition('zoom-track').duration(wasTracking ? 300 : 750)
        .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(TRACK_ZOOM_SCALE))
        .on('end', () => {
          isZoomTransitioning = false;
        })
        .on('interrupt', () => {
          isZoomTransitioning = false;
        });
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
    closeBtn.classList.remove('visible');

    // Remove highlight
    svg.selectAll('.train-group')
      .classed('selected', false);

    // Hide DOM label
    hideTrainLabel();

    // Stop detail refresh
    if (detailFetchInterval) {
      clearInterval(detailFetchInterval);
      detailFetchInterval = null;
    }

    // Re-enable zoom interaction
    svg.call(zoom);

    // Cancel any in-progress zoom transition cleanly
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
    const text = name || '';
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
      if (eta.isApp === '1' && eta.staNm) return { prefix: 'Approaching ', station: eta.staNm };
      if (eta.staNm) return { prefix: 'Next: ', station: eta.staNm };
    }
    if (train.isApp === '1') return { prefix: 'Approaching station', station: '' };
    return { prefix: '', station: '' };
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

    // Advance dummy trains
    if (dummyTrains) {
      advanceDummyTrains(dummyTrains, geojson, dt);
    }

    // Advance real trains (correction slides on refresh, then sit still)
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

    // Update ALL train positions directly (no D3 transitions — frame-by-frame is smoother)
    svg.select('.trains-layer').selectAll('.train-group')
      .each(function (d) {
        const pt = projection([d.lon, d.lat]);
        if (!pt) return;
        const g = d3.select(this);
        g.attr('transform', `translate(${pt[0]}, ${pt[1]})`);

        // Animate direction dots: steady stream of circles flowing along the track
        const segs = lineSegments[d.legend];
        const atTerminal = d.rn === selectedTrainRn
          && lastETAs !== null && lastETAs.length === 0;
        const showArrows = d.rn === selectedTrainRn
          && d._trackPos && segs && !atTerminal;

        if (showArrows) {
          if (d._arrowPhase === undefined) d._arrowPhase = 0;
          d._arrowPhase = (d._arrowPhase + dt / 3600) % 1;

          const dir = d._direction || 1;
          const behindDist = 0.005; // start this far behind the dot
          const totalDist = 0.009;  // total travel distance (behind + ahead)

          for (let i = 0; i < 6; i++) {
            const arrow = g.select(`.train-arrow-${i}`);
            const phase = (d._arrowPhase + i / 6) % 1;
            // Start behind the dot, move forward through it
            const dist = -behindDist + totalDist * phase;

            // Advance along track; negative = behind dot
            const advDir = dist >= 0 ? dir : -dir;
            const advPos = advanceOnTrack(d._trackPos, Math.abs(dist), advDir, segs);
            const advPt = projection([advPos.lon, advPos.lat]);

            if (advPt) {
              const dx = advPt[0] - pt[0];
              const dy = advPt[1] - pt[1];

              // Smooth phase-based opacity: 0 at edges, peak ~0.85 in the middle
              // sin^0.6 stays high longer for a slower fade
              const opacity = 0.85 * Math.pow(Math.sin(phase * Math.PI), 0.6);

              arrow
                .attr('cx', dx)
                .attr('cy', dy)
                .style('opacity', opacity);
            }
          }
        } else {
          d._arrowPhase = undefined;
          for (let i = 0; i < 6; i++) {
            g.select(`.train-arrow-${i}`).style('opacity', 0);
          }
        }
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
        // instead of letting them vanish immediately
        if (realTrains) {
          const newRns = new Set(fetched.map(t => t.rn));
          const retireRns = new Set(retiringTrains.map(t => t.rn));
          for (const train of realTrains) {
            if (newRns.has(train.rn) || train._retiring || retireRns.has(train.rn)) continue;

            const terminalCoord = lookupStation(train.destNm, train.legend, stationPositions);
            if (!terminalCoord) {
              console.warn(`[CTA] Cannot find terminal for retiring train rn=${train.rn} dest="${train.destNm}" line=${train.legend}`);
              continue;
            }

            const dist = geoDist(train.lon, train.lat, terminalCoord[0], terminalCoord[1]);
            if (dist >= TERMINAL_PROXIMITY_THRESHOLD) continue;

            const segs = lineSegments[train.legend];
            if (!segs || segs.length === 0) continue;

            train._retiring = true;
            train._retireTime = null;

            // Snap terminal to track
            const termTrackPos = snapToTrackPosition(terminalCoord[0], terminalCoord[1], segs);

            // If already extremely close, skip the approach slide
            if (dist < 1e-4) {
              train._correcting = false;
              train._trackPos = termTrackPos;
              train.lon = termTrackPos.lon;
              train.lat = termTrackPos.lat;
              train._retireTime = Date.now();
            } else {
              // Set up correction slide toward terminal
              train._corrFromTrackPos = train._trackPos
                ? { ...train._trackPos }
                : snapToTrackPosition(train.lon, train.lat, segs);
              train._corrToTrackPos = termTrackPos;

              // Pick approach direction (toward terminal)
              const testStep = Math.max(dist * 0.1, 1e-5);
              const fwdTest = advanceOnTrack(train._corrFromTrackPos, testStep, +1, segs);
              const bwdTest = advanceOnTrack(train._corrFromTrackPos, testStep, -1, segs);
              const fwdDist = geoDist(fwdTest.lon, fwdTest.lat, termTrackPos.lon, termTrackPos.lat);
              const bwdDist = geoDist(bwdTest.lon, bwdTest.lat, termTrackPos.lon, termTrackPos.lat);
              train._corrDirection = fwdDist <= bwdDist ? 1 : -1;

              train._corrTotalDist = trackDistanceBetween(
                train._corrFromTrackPos, train._corrToTrackPos, train._corrDirection, segs
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
        dummyTrains = null;

        // Initialize track position and drift correction
        initRealTrainAnimation(realTrains, lineSegments, prevMap);

        // Update selected train reference if tracking
        if (selectedTrainRn) {
          const newSelected = realTrains.find(t => t.rn === selectedTrainRn);
          if (newSelected) {
            selectedTrain = newSelected;
            updateTrainLabelContent(selectedTrain, lastETAs);
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
        closeBtn.classList.remove('visible');
        hideTrainLabel();
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
