/**
 * Main application: initializes the map, places trains, handles animation and resize.
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

  // Create train layer on top
  svg.append('g').attr('class', 'trains-layer');

  // ---- Initialize trains ----
  let dummyTrains = null;
  let realTrains = null;

  const fetched = await fetchTrains();
  if (fetched && fetched.length > 0) {
    realTrains = fetched;
    console.log(`[CTA] Using REAL train data (${realTrains.length} trains)`);
  } else {
    dummyTrains = generateDummyTrains(geojson);
    console.log(`[CTA] Using DUMMY train data (${dummyTrains.length} trains)`);
  }

  // ---- Render trains ----
  function renderTrains(animate) {
    const trains = realTrains || dummyTrains || [];
    const layer = svg.select('.trains-layer');

    const groups = layer.selectAll('.train-group')
      .data(trains, d => d.rn);

    // Enter
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
    enter.transition().duration(animate ? 800 : 0).style('opacity', 1);

    // Exit
    groups.exit()
      .transition().duration(500)
      .style('opacity', 0)
      .remove();

    // Update existing positions
    const merged = layer.selectAll('.train-group');
    if (animate) {
      merged.each(function (d) {
        const pt = projection([d.lon, d.lat]);
        if (!pt) return;
        d3.select(this)
          .transition().duration(2000).ease(d3.easeCubicInOut)
          .attr('transform', `translate(${pt[0]}, ${pt[1]})`);
      });
    } else {
      merged.each(function (d) {
        const pt = projection([d.lon, d.lat]);
        if (!pt) return;
        d3.select(this)
          .attr('transform', `translate(${pt[0]}, ${pt[1]})`);
      });
    }
  }

  renderTrains();

  // ---- Animation loop for dummy trains ----
  let lastTime = performance.now();

  function animate(now) {
    const dt = now - lastTime;
    lastTime = now;

    if (dummyTrains) {
      advanceDummyTrains(dummyTrains, geojson, dt);
      // Update positions directly (no D3 transition — smoother for animation)
      svg.select('.trains-layer').selectAll('.train-group')
        .each(function (d) {
          const pt = projection([d.lon, d.lat]);
          if (!pt) return;
          d3.select(this)
            .attr('transform', `translate(${pt[0]}, ${pt[1]})`);
        });
    }

    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);

  // ---- Periodic refresh for real API data ----
  if (API_KEY) {
    setInterval(async () => {
      const fetched = await fetchTrains();
      if (fetched && fetched.length > 0) {
        const wasDummy = !realTrains;
        realTrains = fetched;
        dummyTrains = null;
        console.log(`[CTA] Refreshed REAL train data (${realTrains.length} trains)`);
        renderTrains(!wasDummy);
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
