/**
 * Crowdlands - Cadastre Real Estate Game Engine
 * Powered by NSW Spatial Services & MapLibre GL
 */

(function () {
  'use strict';

  // --- Game State Defaults & Storage ---
  const STORAGE_KEY = 'crowdlands_save_v1';
  
  let gameState = {
    balance: 10000000,
    ownedParcels: {}, // cadid -> { cadid, lotnumber, planlabel, area, price, building: 'vacant', purchaseDate }
    rivals: [
      { name: 'Apex Properties', balance: 25000000, color: '#8b5cf6', parcelsCount: 3 },
      { name: 'Pacific Capital', balance: 15000000, color: '#ec4899', parcelsCount: 2 },
      { name: 'Terra Holdings', balance: 40000000, color: '#f59e0b', parcelsCount: 5 }
    ],
    rivalOwnedParcels: {}, // cadid -> rivalName
    audioMuted: false
  };

  // Load persistent save if present
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      gameState = { ...gameState, ...parsed };
      // If legacy save has old default balance and no owned parcels, upgrade balance to $10,000,000
      if (gameState.balance === 100000 && Object.keys(gameState.ownedParcels).length === 0) {
        gameState.balance = 10000000;
      }
    }
  } catch (e) {
    console.warn("Failed to parse saved game state, starting fresh", e);
  }

  function saveGame() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState));
    } catch (e) {
      console.error("Save error", e);
    }
  }

  // --- Building Types & Multipliers ---
  const BUILDINGS = {
    vacant: { name: 'Vacant Land', cost: 0, mult: 1, icon: '🏞️' },
    residential: { name: 'Apartment Block', cost: 25000, mult: 3, icon: '🏠' },
    commercial: { name: 'Office Tower', cost: 100000, mult: 8, icon: '🏢' }
  };

  // Map & Feature State variables
  let map;
  let currentLoadedFeatures = [];
  let selectedParcel = null;
  let hoveredParcelId = null;
  let debounceTimer = null;
  let searchTimer = null;
  let basemapIndex = 0;

  const BASEMAPS = [
    {
      name: 'Dark Matter',
      style: {
        version: 8,
        sources: {
          'carto-dark': {
            type: 'raster',
            tiles: ['https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; CartoDB &copy; OpenStreetMap'
          }
        },
        layers: [{ id: 'carto-dark-layer', type: 'raster', source: 'carto-dark' }]
      }
    },
    {
      name: 'OpenStreetMap',
      style: {
        version: 8,
        sources: {
          'osm': {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap contributors'
          }
        },
        layers: [{ id: 'osm-layer', type: 'raster', source: 'osm' }]
      }
    }
  ];

  // --- Robust Sound Engine ---
  let audioCtx = null;

  function initAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  // Unlock Web Audio Context on first user interaction anywhere
  document.addEventListener('click', initAudioContext, { passive: true });
  document.addEventListener('keydown', initAudioContext, { passive: true });
  document.addEventListener('touchstart', initAudioContext, { passive: true });

  function playSound(type) {
    if (gameState.audioMuted) return;
    initAudioContext();
    if (!audioCtx) return;

    try {
      const now = audioCtx.currentTime;
      const gainNode = audioCtx.createGain();
      gainNode.connect(audioCtx.destination);

      if (type === 'buy') {
        // High-pitched ascending success chord (C5 -> E5 -> G5)
        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(523.25, now);
        osc1.frequency.exponentialRampToValueAtTime(783.99, now + 0.2);

        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(659.25, now);
        osc2.frequency.exponentialRampToValueAtTime(1046.50, now + 0.2);

        gainNode.gain.setValueAtTime(0.25, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

        osc1.connect(gainNode);
        osc2.connect(gainNode);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.28);
        osc2.stop(now + 0.28);
      } else if (type === 'sell') {
        // Coin chime (A5 -> E5)
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(659.25, now + 0.09);

        gainNode.gain.setValueAtTime(0.2, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

        osc.connect(gainNode);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === 'click') {
        // Soft UI click
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(700, now);
        osc.frequency.exponentialRampToValueAtTime(350, now + 0.05);

        gainNode.gain.setValueAtTime(0.12, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

        osc.connect(gainNode);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (type === 'error') {
        // Low warning sound
        const osc = audioCtx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.linearRampToValueAtTime(110, now + 0.2);

        gainNode.gain.setValueAtTime(0.15, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

        osc.connect(gainNode);
        osc.start(now);
        osc.stop(now + 0.2);
      }
    } catch (e) {
      console.warn("Audio playback error:", e);
    }
  }

  // --- UI Toast Notifications ---
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'danger') icon = 'fa-triangle-exclamation';
    if (type === 'warning') icon = 'fa-coins';

    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 4000);
  }

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

    map.on('load', () => {
      // Add empty GeoJSON source for NSW Cadastre
      map.addSource('nsw-cadastre', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        generateId: true
      });

      // Layer 1: Polygon Fill color-coded by status property
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
            'match',
            ['get', 'status'],
            'player', 0.65,
            'rival', 0.50,
            0.22
          ]
        }
      });

      // Layer 2: Parcel Boundaries Line
      map.addLayer({
        id: 'cadastre-line',
        type: 'line',
        source: 'nsw-cadastre',
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

      // Layer 3: Hover Outline Highlight
      map.addLayer({
        id: 'cadastre-hover',
        type: 'line',
        source: 'nsw-cadastre',
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

      // Initial Data Fetch
      updateCadastreLayer();
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
      }
    });

    map.on('mouseleave', 'cadastre-fill', () => {
      map.getCanvas().style.cursor = '';
      if (hoveredParcelId !== null) {
        map.setFeatureState({ source: 'nsw-cadastre', id: hoveredParcelId }, { hover: false });
      }
      hoveredParcelId = null;
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
  }

  // Convert Esri JSON query results to standard GeoJSON FeatureCollection
  function esriToGeoJSON(esriData) {
    if (!esriData || !esriData.features) return { type: 'FeatureCollection', features: [] };
    
    const features = [];
    esriData.features.forEach((f, idx) => {
      if (f.geometry && f.geometry.rings) {
        const cadid = f.attributes ? f.attributes.cadid : idx + 1;
        const isPlayer = !!gameState.ownedParcels[cadid];
        const isRival = !!gameState.rivalOwnedParcels[cadid];
        const status = isPlayer ? 'player' : (isRival ? 'rival' : 'unclaimed');

        features.push({
          type: 'Feature',
          id: cadid,
          properties: {
            cadid: cadid,
            lotnumber: f.attributes.lotnumber || 'Parcel',
            planlabel: f.attributes.planlabel || 'DP',
            area: Math.round(f.attributes.Shape__Area || 350),
            status: status
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
      const isPlayer = !!gameState.ownedParcels[cadid];
      const isRival = !!gameState.rivalOwnedParcels[cadid];
      const status = isPlayer ? 'player' : (isRival ? 'rival' : 'unclaimed');
      feat.properties.status = status;

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
    const b = BUILDINGS[buildingType] || BUILDINGS.vacant;
    // Passive rent income per second: $0.05 per m² * building multiplier
    return Math.max(1, Math.round(area * 0.05 * b.mult));
  }

  // --- Handle Parcel Selection & Card Details ---
  function onParcelClicked(feature) {
    const props = feature.properties;
    const cadid = props.cadid;
    const area = props.area || 350;
    const price = calculateParcelPrice(area);

    const isOwnedByPlayer = !!gameState.ownedParcels[cadid];
    const isOwnedByRival = !!gameState.rivalOwnedParcels[cadid];
    const rivalName = isOwnedByRival ? gameState.rivalOwnedParcels[cadid] : null;

    const currentBuilding = isOwnedByPlayer ? gameState.ownedParcels[cadid].building : 'vacant';
    const rentYield = calculateParcelYield(area, currentBuilding);

    selectedParcel = {
      cadid: cadid,
      featureId: feature.id,
      lotnumber: props.lotnumber,
      planlabel: props.planlabel,
      area: area,
      price: price,
      building: currentBuilding,
      isOwnedByPlayer: isOwnedByPlayer,
      isOwnedByRival: isOwnedByRival,
      rivalName: rivalName
    };

    // Update UI Inspector Card Elements
    document.getElementById('card-lot-number').innerText = `Lot ${props.lotnumber || 'N/A'}`;
    document.getElementById('card-plan-label').innerText = props.planlabel || 'NSW Cadastre';
    document.getElementById('card-area').innerText = `${area.toLocaleString()} m²`;
    document.getElementById('card-price').innerText = `$${price.toLocaleString()}`;
    document.getElementById('card-yield').innerText = `$${rentYield.toLocaleString()} / sec`;

    const badge = document.getElementById('card-status-badge');
    const badgeText = document.getElementById('card-status-text');
    const ownerText = document.getElementById('card-owner');
    const btnBuy = document.getElementById('btn-buy-parcel');
    const btnSell = document.getElementById('btn-sell-parcel');
    const devSection = document.getElementById('development-section');

    if (isOwnedByPlayer) {
      badge.className = 'parcel-status-badge status-owned';
      badgeText.innerText = 'Owned by You';
      ownerText.innerText = 'Player (You)';
      btnBuy.style.display = 'none';
      btnSell.style.display = 'block';
      devSection.style.display = 'block';
      updateBuildingOptionsUI(currentBuilding);
    } else if (isOwnedByRival) {
      badge.className = 'parcel-status-badge status-rival';
      badgeText.innerText = `Owned by ${rivalName}`;
      ownerText.innerText = rivalName;
      btnBuy.style.display = 'none';
      btnSell.style.display = 'none';
      devSection.style.display = 'none';
    } else {
      badge.className = 'parcel-status-badge status-unclaimed';
      badgeText.innerText = 'Available For Purchase';
      ownerText.innerText = 'Unclaimed';
      btnBuy.style.display = 'flex';
      btnSell.style.display = 'none';
      devSection.style.display = 'none';
    }

    // Show Card
    document.getElementById('parcel-card').classList.add('active');
  }

  function updateBuildingOptionsUI(activeType) {
    const options = document.querySelectorAll('.building-option');
    options.forEach(opt => {
      if (opt.dataset.type === activeType) {
        opt.classList.add('selected');
      } else {
        opt.classList.remove('selected');
      }
    });
  }

  // --- Buy & Sell Logic ---
  function buySelectedParcel() {
    if (!selectedParcel) return;
    if (gameState.balance < selectedParcel.price) {
      showToast('Insufficient funds to purchase parcel!', 'danger');
      playSound('error');
      return;
    }

    gameState.balance -= selectedParcel.price;
    gameState.ownedParcels[selectedParcel.cadid] = {
      cadid: selectedParcel.cadid,
      lotnumber: selectedParcel.lotnumber,
      planlabel: selectedParcel.planlabel,
      area: selectedParcel.area,
      price: selectedParcel.price,
      building: 'vacant',
      purchaseDate: new Date().toISOString()
    };

    playSound('buy');
    showToast(`Purchased Lot ${selectedParcel.lotnumber} for $${selectedParcel.price.toLocaleString()}!`, 'success');
    saveGame();
    updateHUD();
    applyFeatureOwnershipStates();
    onParcelClicked({ properties: selectedParcel, id: selectedParcel.featureId });
    renderPortfolio();
  }

  function sellSelectedParcel() {
    if (!selectedParcel || !gameState.ownedParcels[selectedParcel.cadid]) return;

    const sellRefund = Math.round(selectedParcel.price * 0.85); // 85% resale value
    gameState.balance += sellRefund;
    delete gameState.ownedParcels[selectedParcel.cadid];

    playSound('sell');
    showToast(`Sold Lot ${selectedParcel.lotnumber} for $${sellRefund.toLocaleString()}`, 'warning');
    saveGame();
    updateHUD();
    applyFeatureOwnershipStates();
    onParcelClicked({ properties: selectedParcel, id: selectedParcel.featureId });
    renderPortfolio();
  }

  function upgradeSelectedParcelBuilding(buildingType) {
    if (!selectedParcel || !gameState.ownedParcels[selectedParcel.cadid]) return;
    const currentProp = gameState.ownedParcels[selectedParcel.cadid];
    if (currentProp.building === buildingType) return;

    const bInfo = BUILDINGS[buildingType];
    if (gameState.balance < bInfo.cost) {
      showToast(`Insufficient funds for ${bInfo.name}! Cost: $${bInfo.cost.toLocaleString()}`, 'danger');
      playSound('error');
      return;
    }

    gameState.balance -= bInfo.cost;
    currentProp.building = buildingType;
    playSound('buy');
    showToast(`Upgraded Lot ${selectedParcel.lotnumber} to ${bInfo.name}!`, 'success');
    saveGame();
    updateHUD();
    onParcelClicked({ properties: selectedParcel, id: selectedParcel.featureId });
    renderPortfolio();
  }

  // --- Economy Engine Income Loop (1 Tick / Second) ---
  function gameIncomeTick() {
    let incomePerSec = 0;
    Object.values(gameState.ownedParcels).forEach(prop => {
      incomePerSec += calculateParcelYield(prop.area, prop.building || 'vacant');
    });

    gameState.balance += incomePerSec;
    updateHUD(incomePerSec);
  }

  // Simulate Rival AI Investors purchasing random unclaimed parcels
  function rivalMarketTick() {
    if (currentLoadedFeatures.length === 0) return;
    const unclaimed = currentLoadedFeatures.filter(f => {
      const cid = f.properties.cadid;
      return !gameState.ownedParcels[cid] && !gameState.rivalOwnedParcels[cid];
    });

    if (unclaimed.length > 0 && Math.random() < 0.4) {
      const randomFeat = unclaimed[Math.floor(Math.random() * unclaimed.length)];
      const randomRival = gameState.rivals[Math.floor(Math.random() * gameState.rivals.length)];
      const cid = randomFeat.properties.cadid;

      gameState.rivalOwnedParcels[cid] = randomRival.name;
      randomRival.parcelsCount += 1;
      randomRival.balance += 25000;
      applyFeatureOwnershipStates();
      renderLeaderboard();
    }
  }

  // --- Update HUD Stats ---
  function updateHUD(incomePerSec = null) {
    let totalPortfolioVal = 0;
    let totalYield = 0;

    Object.values(gameState.ownedParcels).forEach(prop => {
      totalPortfolioVal += prop.price;
      totalYield += calculateParcelYield(prop.area, prop.building || 'vacant');
    });

    const netWorth = gameState.balance + totalPortfolioVal;

    document.getElementById('hud-balance').innerText = `$${Math.round(gameState.balance).toLocaleString()}`;
    document.getElementById('hud-income').innerHTML = `$${totalYield.toLocaleString()} <span class="income-pulse">/sec</span>`;
    document.getElementById('hud-networth').innerText = `$${Math.round(netWorth).toLocaleString()}`;
  }

  // --- Render Portfolio Drawer List ---
  function renderPortfolio() {
    const listEl = document.getElementById('portfolio-list');
    const countEl = document.getElementById('portfolio-count');
    const areaEl = document.getElementById('portfolio-total-area');

    if (!listEl) return;
    const propsArr = Object.values(gameState.ownedParcels);
    countEl.innerText = propsArr.length;

    let totalArea = 0;
    listEl.innerHTML = '';

    if (propsArr.length === 0) {
      listEl.innerHTML = `<div style="text-align:center; padding: 30px; color: var(--text-muted); font-size: 14px;">No properties owned yet.<br>Click on land parcels on the map to purchase!</div>`;
      areaEl.innerText = `0 m²`;
      return;
    }

    propsArr.forEach(prop => {
      totalArea += prop.area;
      const bInfo = BUILDINGS[prop.building || 'vacant'];
      const item = document.createElement('div');
      item.className = 'property-item';
      item.innerHTML = `
        <div>
          <div class="prop-info-title">${bInfo.icon} Lot ${prop.lotnumber} (${prop.planlabel})</div>
          <div class="prop-info-sub">${prop.area.toLocaleString()} m² &bull; ${bInfo.name} &bull; $${prop.price.toLocaleString()}</div>
        </div>
        <div class="prop-actions">
          <button class="btn-icon-small btn-fly" data-cadid="${prop.cadid}"><i class="fa-solid fa-crosshairs"></i> View</button>
        </div>
      `;
      listEl.appendChild(item);
    });

    areaEl.innerText = `${totalArea.toLocaleString()} m²`;

    // Add click event to Fly button
    listEl.querySelectorAll('.btn-fly').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const cadid = parseInt(e.currentTarget.dataset.cadid);
        const feat = currentLoadedFeatures.find(f => f.properties.cadid === cadid);
        if (feat && feat.geometry.coordinates[0][0]) {
          const pt = feat.geometry.coordinates[0][0];
          map.flyTo({ center: pt, zoom: 17, pitch: 35 });
          onParcelClicked(feat);
          document.getElementById('portfolio-drawer').classList.remove('active');
        } else {
          showToast('Property is located in a different area on map', 'info');
        }
      });
    });
  }

  // --- Render Leaderboard Drawer ---
  function renderLeaderboard() {
    const listEl = document.getElementById('leaderboard-list');
    if (!listEl) return;

    let playerNetWorth = gameState.balance;
    Object.values(gameState.ownedParcels).forEach(p => playerNetWorth += p.price);

    const competitors = [
      { name: 'You (Player)', worth: playerNetWorth, land: Object.keys(gameState.ownedParcels).length, isPlayer: true },
      ...gameState.rivals.map(r => ({ name: r.name, worth: r.balance, land: r.parcelsCount, isPlayer: false }))
    ];

    competitors.sort((a, b) => b.worth - a.worth);

    listEl.innerHTML = '';
    competitors.forEach((c, idx) => {
      const item = document.createElement('div');
      item.className = 'leader-item';
      let rankClass = '';
      if (idx === 0) rankClass = 'top1';
      if (idx === 1) rankClass = 'top2';
      if (idx === 2) rankClass = 'top3';

      item.innerHTML = `
        <div class="leader-rank ${rankClass}">#${idx + 1}</div>
        <div class="leader-details">
          <div class="leader-name">${c.name} ${c.isPlayer ? '<span style="color:var(--primary); font-size:11px;">(You)</span>' : ''}</div>
          <div class="leader-land">${c.land} Properties Owned</div>
        </div>
        <div class="leader-worth">$${Math.round(c.worth).toLocaleString()}</div>
      `;
      listEl.appendChild(item);
    });
  }

  // --- Search Geocoding (Nominatim API) ---
  function setupSearch() {
    const input = document.getElementById('search-input');
    const results = document.getElementById('search-results');
    const spinner = document.getElementById('search-spinner');

    if (!input) return;

    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const query = input.value.trim();
      if (query.length < 3) {
        results.style.display = 'none';
        return;
      }

      spinner.style.display = 'inline-block';
      searchTimer = setTimeout(async () => {
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ' NSW Australia')}&limit=5`);
          const data = await res.json();
          spinner.style.display = 'none';
          results.innerHTML = '';

          if (data && data.length > 0) {
            results.style.display = 'block';
            data.forEach(item => {
              const resItem = document.createElement('div');
              resItem.className = 'search-result-item';
              resItem.innerText = item.display_name;
              resItem.addEventListener('click', () => {
                map.flyTo({ center: [parseFloat(item.lon), parseFloat(item.lat)], zoom: 16 });
                results.style.display = 'none';
                input.value = '';
              });
              results.appendChild(resItem);
            });
          } else {
            results.style.display = 'block';
            results.innerHTML = `<div class="search-result-item" style="color:var(--text-muted);">No locations found in NSW</div>`;
          }
        } catch (e) {
          spinner.style.display = 'none';
        }
      }, 400);
    });
  }

  // --- DOM Event Listeners & UI Binding ---
  function setupUIEventListeners() {
    // Close parcel card
    document.getElementById('btn-close-card').addEventListener('click', () => {
      document.getElementById('parcel-card').classList.remove('active');
    });

    // Buy & Sell buttons
    document.getElementById('btn-buy-parcel').addEventListener('click', buySelectedParcel);
    document.getElementById('btn-sell-parcel').addEventListener('click', sellSelectedParcel);

    // Development Selector
    document.querySelectorAll('.building-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        const buildingType = e.currentTarget.dataset.type;
        upgradeSelectedParcelBuilding(buildingType);
      });
    });

    // Drawers Toggles
    const pDrawer = document.getElementById('portfolio-drawer');
    const lDrawer = document.getElementById('leaderboard-drawer');

    document.getElementById('btn-toggle-portfolio').addEventListener('click', () => {
      pDrawer.classList.toggle('active');
      lDrawer.classList.remove('active');
      renderPortfolio();
    });

    document.getElementById('btn-close-portfolio').addEventListener('click', () => {
      pDrawer.classList.remove('active');
    });

    document.getElementById('btn-toggle-leaderboard').addEventListener('click', () => {
      lDrawer.classList.toggle('active');
      pDrawer.classList.remove('active');
      renderLeaderboard();
    });

    document.getElementById('btn-close-leaderboard').addEventListener('click', () => {
      lDrawer.classList.remove('active');
    });

    // Basemap Switcher
    document.getElementById('btn-toggle-basemap').addEventListener('click', () => {
      basemapIndex = (basemapIndex + 1) % BASEMAPS.length;
      map.setStyle(BASEMAPS[basemapIndex].style);
      showToast(`Switched map basemap to ${BASEMAPS[basemapIndex].name}`, 'info');
    });

    // Audio Toggle
    document.getElementById('btn-toggle-audio').addEventListener('click', () => {
      gameState.audioMuted = !gameState.audioMuted;
      const icon = document.getElementById('audio-icon');
      if (gameState.audioMuted) {
        icon.className = 'fa-solid fa-volume-xmark';
        showToast('Audio Muted', 'info');
      } else {
        icon.className = 'fa-solid fa-volume-high';
        showToast('Audio Enabled', 'info');
      }
      saveGame();
    });

    // Reset Game Progress
    document.getElementById('btn-reset-game').addEventListener('click', () => {
      if (confirm('Reset your Crowdlands empire back to starting $10,000,000 cash balance?')) {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
      }
    });

    // Zoom In helper button
    document.getElementById('btn-zoom-in').addEventListener('click', () => {
      map.zoomTo(16.2);
    });

    // Preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const lng = parseFloat(e.target.dataset.lng);
        const lat = parseFloat(e.target.dataset.lat);
        map.flyTo({ center: [lng, lat], zoom: 16 });
      });
    });
  }

  // --- Initialize App ---
  window.addEventListener('DOMContentLoaded', () => {
    initMap();
    setupSearch();
    setupUIEventListeners();
    updateHUD();

    // Start 1-second game income tick
    setInterval(gameIncomeTick, 1000);

    // Start 15-second rival market AI tick
    setInterval(rivalMarketTick, 15000);
  });

})();
