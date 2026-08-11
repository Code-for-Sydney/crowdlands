/**
 * Crowdlands - Map, Cadastre & Layers
 */
'use strict';

  // --- Initialize Map ---
  function initMap() {
    map = new maplibregl.Map({
      container: 'map',
      style: BASEMAPS[0].style,
      center: [151.2093, -33.8688], // Sydney CBD
      zoom: 16,
      pitch: 20
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-left');

    function initCadastreLayers() {
      if (!map.getSource('nsw-cadastre')) {
        map.addSource('nsw-cadastre', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          generateId: true
        });
      }

      if (!map.getLayer('cadastre-fill')) {
        map.addLayer({
          id: 'cadastre-fill',
          type: 'fill',
          source: 'nsw-cadastre',
          paint: {
            'fill-color': [
              'match',
              ['get', 'status'],
              'player', '#10b981', // Vibrant Emerald green for player owned
              'rival', '#8b5cf6',  // Purple for rival AI owned
              '#00f0ff'            // Cyan for unclaimed
            ],
            'fill-opacity': [
              'case',
              ['boolean', ['get', 'inBlock'], false], 0,
              [
                'match',
                ['get', 'status'],
                'player', 0.65,
                'rival', 0.50,
                0.22
              ]
            ]
          }
        });
      }

      if (!map.getLayer('price-heatmap')) {
        map.addLayer({
          id: 'price-heatmap',
          type: 'fill',
          source: 'nsw-cadastre',
          layout: { visibility: 'none' },
          paint: {
            'fill-color': '#22c55e',
            'fill-opacity': 0.55
          }
        });
      }

      if (!map.getLayer('cadastre-line')) {
        map.addLayer({
          id: 'cadastre-line',
          type: 'line',
          source: 'nsw-cadastre',
          filter: ['!=', ['get', 'inBlock'], true],
          paint: {
            'line-color': [
              'match',
              ['get', 'status'],
              'player', '#047857', // Dark emerald border
              'rival', '#6d28d9',  // Dark purple border
              '#00a6ff'
            ],
            'line-width': [
              'match',
              ['get', 'status'],
              'player', 3,
              'rival', 2,
              1.5
            ],
            'line-opacity': 0.95
          }
        });
      }

      if (!map.getLayer('cadastre-hover')) {
        map.addLayer({
          id: 'cadastre-hover',
          type: 'line',
          source: 'nsw-cadastre',
          filter: ['!=', ['get', 'inBlock'], true],
          paint: {
            'line-color': '#f59e0b',
            'line-width': 4,
            'line-opacity': [
              'case',
              ['boolean', ['feature-state', 'hover'], false], 1,
              0
            ]
          }
        });
      }

      if (!map.getLayer('cadastre-selected')) {
        map.addLayer({
          id: 'cadastre-selected',
          type: 'line',
          source: 'nsw-cadastre',
          filter: ['!=', ['get', 'inBlock'], true],
          paint: {
            'line-color': '#ffffff',
            'line-width': 5,
            'line-opacity': [
              'case',
              ['boolean', ['feature-state', 'selected'], false], 1,
              0
            ]
          }
        });
      }

      if (currentLoadedFeatures.length > 0) {
        applyFeatureOwnershipStates();
      }

      initBlockLayers();
      updateBlockLayer();

      // Restore selection highlights after a style change rebuilds layers.
      if (selectedParcelId !== null && map) {
        map.setFeatureState({ source: 'nsw-cadastre', id: selectedParcelId }, { selected: true });
      }
      if (selectedBlockId !== null && map) {
        map.setFeatureState({ source: 'player-blocks', id: selectedBlockId }, { selected: true });
      }
    }

    map.on('load', () => {
      initCadastreLayers();
      updateCadastreLayer();
    });

    map.on('style.load', () => {
      blockListenersAdded = false;
      initCadastreLayers();
      if (heatmapActive) {
        map.setLayoutProperty('cadastre-fill', 'visibility', 'none');
        map.setLayoutProperty('price-heatmap', 'visibility', 'visible');
        updatePriceHeatmap();
      }
    });

    // Map Event Listeners
    map.on('moveend', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(updateCadastreLayer, 300);
      checkZoomLevel();
    });

    // Hover Mouse Effects
    map.on('mousemove', 'cadastre-fill', (e) => {
      if (e.features.length > 0) {
        map.getCanvas().style.cursor = 'pointer';
        if (hoveredParcelId !== null) {
          map.setFeatureState({ source: 'nsw-cadastre', id: hoveredParcelId }, { hover: false });
        }
        hoveredParcelId = e.features[0].id;
        map.setFeatureState({ source: 'nsw-cadastre', id: hoveredParcelId }, { hover: true });

        // When hovering a parcel that belongs to a block, highlight the whole block
        const cadid = e.features[0].properties.cadid;
        const block = getBlockForCadid(cadid);
        if (block) {
          if (hoveredBlockId !== null && hoveredBlockId !== block.id) {
            map.setFeatureState({ source: 'player-blocks', id: hoveredBlockId }, { hover: false });
          }
          hoveredBlockId = block.id;
          map.setFeatureState({ source: 'player-blocks', id: hoveredBlockId }, { hover: true });
        } else if (hoveredBlockId !== null) {
          map.setFeatureState({ source: 'player-blocks', id: hoveredBlockId }, { hover: false });
          hoveredBlockId = null;
        }
      }
    });

    map.on('mouseleave', 'cadastre-fill', () => {
      map.getCanvas().style.cursor = '';
      if (hoveredParcelId !== null) {
        map.setFeatureState({ source: 'nsw-cadastre', id: hoveredParcelId }, { hover: false });
      }
      hoveredParcelId = null;
      if (hoveredBlockId !== null) {
        map.setFeatureState({ source: 'player-blocks', id: hoveredBlockId }, { hover: false });
        hoveredBlockId = null;
      }
    });

    // Click Parcel Selection
    map.on('click', 'cadastre-fill', (e) => {
      if (e.features.length > 0) {
        playSound('click');
        onParcelClicked(e.features[0]);
      }
    });
  }

  // --- Fetch NSW Cadastre Parcel Data ---
  async function updateCadastreLayer() {
    if (!map || map.getZoom() < 15) return;

    const bounds = map.getBounds();
    const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
    const url = `https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Land_Parcel_Property_Theme/FeatureServer/8/query?where=1%3D1&geometry=${bbox}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=lotnumber,planlabel,cadid,Shape__Area&returnGeometry=true&outSR=4326&f=json`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      if (data && data.features) {
        const geojson = esriToGeoJSON(data);
        currentLoadedFeatures = geojson.features;
        const source = map.getSource('nsw-cadastre');
        if (source) {
          source.setData(geojson);
          applyFeatureOwnershipStates();
        }
      }
    } catch (err) {
      console.error("Failed to query NSW Spatial Services cadastre layer", err);
    }

    if (heatmapActive) updatePriceHeatmap();
    updateBlockLayer();
    updatePendingDeconLayer();
    // Re-check for merge opportunities when map data updates
    if (Object.keys(gameState.ownedParcels).length > 0) {
      setTimeout(checkForMergeOpportunities, 600);
    }
  }

  // Convert Esri JSON query results to standard GeoJSON FeatureCollection
  function esriToGeoJSON(esriData) {
    if (!esriData || !esriData.features) return { type: 'FeatureCollection', features: [] };
    
    const features = [];
    esriData.features.forEach((f, idx) => {
      if (f.geometry && f.geometry.rings) {
        const cadid = f.attributes ? f.attributes.cadid : idx + 1;
        const area = Math.round(f.attributes.Shape__Area || 350);
        const price = calculateParcelPrice(area);
        const status = getOwnerStatusForCadid(cadid);
        const isPlayer = status === 'player';
        const isRival = status === 'rival';
        const inBlock = isPlayer && !!getBlockForCadid(cadid);

        features.push({
          type: 'Feature',
          id: cadid,
          properties: {
            cadid: cadid,
            lotnumber: f.attributes.lotnumber || 'Parcel',
            planlabel: f.attributes.planlabel || 'DP',
            area: area,
            price: price,
            status: status,
            inBlock: inBlock
          },
          geometry: {
            type: 'Polygon',
            coordinates: f.geometry.rings
          }
        });
      }
    });

    return { type: 'FeatureCollection', features };
  }

  // Apply feature states (Player / Rival ownership colors) to MapLibre GL layer
  function applyFeatureOwnershipStates() {
    if (!map || !map.getSource('nsw-cadastre')) return;
    currentLoadedFeatures.forEach((feat) => {
      const cadid = feat.properties.cadid;
      const status = getOwnerStatusForCadid(cadid);
      const isPlayer = status === 'player';
      const isRival = status === 'rival';
      const inBlock = isPlayer && !!getBlockForCadid(cadid);
      feat.properties.status = status;
      feat.properties.inBlock = inBlock;

      map.setFeatureState(
        { source: 'nsw-cadastre', id: feat.id },
        { isPlayerOwned: isPlayer, isRivalOwned: isRival }
      );
    });

    // Re-push updated GeoJSON features to MapLibre source
    map.getSource('nsw-cadastre').setData({
      type: 'FeatureCollection',
      features: currentLoadedFeatures
    });
  }

  // --- Price Heatmap ---
  function updatePriceHeatmap() {
    if (!map || !map.getLayer('price-heatmap') || !heatmapActive) return;

    const balance = Math.max(1, gameState.balance);
    const maxPrice = currentLoadedFeatures.reduce((max, f) => {
      return Math.max(max, f.properties.price || 0);
    }, balance);

    let colorExpr;
    if (maxPrice <= balance) {
      colorExpr = '#22c55e';
    } else {
      const mid1 = balance + (maxPrice - balance) * 0.33;
      const mid2 = balance + (maxPrice - balance) * 0.66;
      colorExpr = [
        'interpolate',
        ['linear'],
        ['get', 'price'],
        0, '#22c55e',
        balance, '#22c55e',
        mid1, '#eab308',
        mid2, '#f97316',
        maxPrice, '#ef4444'
      ];
    }

    map.setPaintProperty('price-heatmap', 'fill-color', colorExpr);
  }

  function togglePriceHeatmap() {
    heatmapActive = !heatmapActive;
    if (!map) return;

    const heatmapLayer = 'price-heatmap';
    const statusLayer = 'cadastre-fill';
    const btn = document.getElementById('btn-toggle-heatmap');

    if (heatmapActive) {
      if (map.getLayer(heatmapLayer)) map.setLayoutProperty(heatmapLayer, 'visibility', 'visible');
      if (map.getLayer(statusLayer)) map.setLayoutProperty(statusLayer, 'visibility', 'none');
      updatePriceHeatmap();
      showToast('Price heatmap enabled', 'info');
    } else {
      if (map.getLayer(heatmapLayer)) map.setLayoutProperty(heatmapLayer, 'visibility', 'none');
      if (map.getLayer(statusLayer)) map.setLayoutProperty(statusLayer, 'visibility', 'visible');
      showToast('Price heatmap disabled', 'info');
    }

    if (btn) btn.classList.toggle('active', heatmapActive);
  }

  // Check map zoom level and display zoom helper alert if zoomed out
  function checkZoomLevel() {
    const warningEl = document.getElementById('zoom-warning');
    if (!warningEl) return;
    if (map.getZoom() < 15) {
      warningEl.classList.add('active');
    } else {
      warningEl.classList.remove('active');
    }
  }

  // --- Calculate Parcel Price & Revenue Yield ---
  function calculateParcelPrice(area) {
    // Valuation formula: Base rate $1,500/m², minimum $15,000
    const base = Math.round(area * 1500);
    return Math.max(15000, base);
  }

  function calculateParcelYield(area, buildingType = 'vacant') {
    // Legacy wrapper — new code uses development objects directly
    const dev = { status: 'complete', floors: [] };
    if (buildingType === 'residential') dev.floors = Array(5).fill('residential');
    if (buildingType === 'commercial') dev.floors = Array(20).fill('commercial');
    return calculateDevelopmentYield(area, dev);
  }

