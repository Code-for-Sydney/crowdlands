/**
 * Crowdlands - UI Rendering & Event Listeners
 */
'use strict';

  // --- Render Portfolio Drawer List ---
  function renderPortfolio() {
    const listEl = document.getElementById('portfolio-list');
    const countEl = document.getElementById('portfolio-count');
    const areaEl = document.getElementById('portfolio-total-area');

    if (!listEl) return;
    const propsArr = Object.values(gameState.ownedParcels);
    const blocksArr = Object.values(gameState.ownedBlocks);
    const totalItems = propsArr.length + blocksArr.length;
    countEl.innerText = totalItems;

    let totalArea = 0;
    listEl.innerHTML = '';

    if (totalItems === 0) {
      listEl.innerHTML = `<div style="text-align:center; padding: 30px; color: var(--text-muted); font-size: 14px;">No properties owned yet.<br>Click on land parcels on the map to purchase!</div>`;
      areaEl.innerText = `0 m²`;
      return;
    }

    // Render blocks first
    blocksArr.forEach(block => {
      totalArea += block.area;
      const dev = block.development || { status: 'complete', floors: [] };
      const resFloors = dev.floors.filter(t => t === 'residential').length;
      const commFloors = dev.floors.filter(t => t === 'commercial').length;
      const yieldPerSec = calculateBlockYield(block);

      let statusSub = `${dev.floors.length} floors (${resFloors} 🏠, ${commFloors} 🏢) &bull; $${yieldPerSec.toLocaleString()}/sec`;
      if (dev.status === 'constructing') {
        const remaining = Math.max(0, dev.construction.completeAt - Date.now());
        statusSub = `🚧 ${dev.floors.length} floors &bull; ${formatMs(remaining)}`;
      } else if (dev.status === 'planning') {
        statusSub = `📐 Planning ${dev.floors.length} floors`;
      }

      const icon = dev.status === 'constructing' ? '🚧' : (dev.status === 'planning' ? '📐' : '🏢');
      const item = document.createElement('div');
      item.className = 'property-item';
      item.innerHTML = `
        <div>
          <div class="prop-info-title">${icon} ${block.label}</div>
          <div class="prop-info-sub">${block.area.toLocaleString()} m² &bull; ${block.cadids.length} lots &bull; ${statusSub} &bull; $${block.price.toLocaleString()}</div>
        </div>
        <div class="prop-actions">
          <button class="btn-icon-small btn-fly-block" data-blockid="${block.id}"><i class="fa-solid fa-crosshairs"></i> View</button>
        </div>
      `;
      listEl.appendChild(item);
    });

    propsArr.forEach(prop => {
      totalArea += prop.area;
      const dev = prop.development || { status: 'complete', floors: [] };
      const resFloors = dev.floors.filter(t => t === 'residential').length;
      const commFloors = dev.floors.filter(t => t === 'commercial').length;
      const yieldPerSec = calculateDevelopmentYield(prop.area, dev);

      let statusSub = `${dev.floors.length} floors (${resFloors} 🏠, ${commFloors} 🏢) &bull; $${yieldPerSec.toLocaleString()}/sec`;
      if (dev.status === 'constructing') {
        const remaining = Math.max(0, dev.construction.completeAt - Date.now());
        statusSub = `🚧 ${dev.floors.length} floors &bull; ${formatMs(remaining)}`;
      } else if (dev.status === 'planning') {
        statusSub = `📐 Planning ${dev.floors.length} floors`;
      }

      const icon = dev.status === 'constructing' ? '🚧' : (dev.status === 'planning' ? '📐' : '🏙️');
      const item = document.createElement('div');
      item.className = 'property-item';
      item.innerHTML = `
        <div>
          <div class="prop-info-title">${icon} Lot ${prop.lotnumber} (${prop.planlabel})</div>
          <div class="prop-info-sub">${prop.area.toLocaleString()} m² &bull; ${statusSub} &bull; $${prop.price.toLocaleString()}</div>
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

    listEl.querySelectorAll('.btn-fly-block').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const blockId = parseInt(e.currentTarget.dataset.blockid);
        const block = getBlockById(blockId);
        if (!block) return;
        const feat = currentLoadedFeatures.find(f => block.cadids.includes(parseInt(f.properties.cadid)));
        if (feat && feat.geometry.coordinates[0][0]) {
          const pt = feat.geometry.coordinates[0][0];
          map.flyTo({ center: pt, zoom: 17, pitch: 35 });
          onParcelClicked(feat);
          document.getElementById('portfolio-drawer').classList.remove('active');
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
    Object.values(gameState.ownedBlocks).forEach(b => playerNetWorth += b.price);

    const competitors = [
      { name: 'You (Player)', worth: playerNetWorth, land: Object.keys(gameState.ownedParcels).length + Object.keys(gameState.ownedBlocks).length, isPlayer: true },
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
      clearBlockSelection();
      clearParcelSelection();
    });

    // Modal close buttons
    document.getElementById('btn-close-merge').addEventListener('click', () => {
      document.getElementById('merge-modal').style.display = 'none';
    });
    document.getElementById('btn-close-split').addEventListener('click', () => {
      document.getElementById('split-modal').style.display = 'none';
    });

    // Deconstruct status close button
    document.getElementById('btn-close-deconstruct').addEventListener('click', () => {
      document.getElementById('deconstruct-modal').style.display = 'none';
    });

    // Merge modal actions
    document.getElementById('btn-confirm-merge').addEventListener('click', () => {
      const modal = document.getElementById('merge-modal');
      const checkedIndexes = Array.from(modal.querySelectorAll('.merge-proposal-check:checked')).map(cb => parseInt(cb.dataset.index, 10));
      modal.style.display = 'none';

      let anyDecon = false;
      checkedIndexes.forEach(idx => {
        const p = currentMergeProposals[idx];
        if (!p) return;
        if (p.type === 'group') {
          if (p.needsDecon) {
            startMergeDeconstruction(p.cadids);
            anyDecon = true;
          } else {
            createBlockFromCadids(p.cadids);
          }
        } else if (p.type === 'expand') {
          if (p.needsDecon) {
            startBlockExpansionDeconstruction(p.block, p.parcelCadid);
            anyDecon = true;
          } else {
            expandBlockWithCadid(p.block, p.parcelCadid);
          }
        }
      });

      if (anyDecon) openDeconstructModal();
      currentMergeProposals = [];
    });
    document.getElementById('btn-decline-merge').addEventListener('click', () => {
      document.getElementById('merge-modal').style.display = 'none';
      // Dismiss all proposals shown so they don't immediately reappear
      currentMergeProposals.forEach(p => {
        if (p.type === 'group') {
          dismissMerge(p.cadids);
        } else if (p.type === 'expand') {
          const expandKey = `expand:${p.block.id}:${p.parcelCadid}`;
          if (!gameState.dismissedMergeKeys.includes(expandKey)) {
            gameState.dismissedMergeKeys.push(expandKey);
          }
        }
      });
      saveGame();
      currentMergeProposals = [];
    });

    // Split modal actions
    document.getElementById('btn-confirm-split').addEventListener('click', () => {
      if (currentSplitBlock) {
        dissolveBlock(currentSplitBlock.id);
        currentSplitBlock = null;
      }
      document.getElementById('split-modal').style.display = 'none';
      document.getElementById('parcel-card').classList.remove('active');
    });
    document.getElementById('btn-reset-split').addEventListener('click', () => {
      showToast('Reset split line', 'info');
    });

    // Buy & Sell buttons
    document.getElementById('btn-buy-parcel').addEventListener('click', buySelectedParcel);
    document.getElementById('btn-sell-parcel').addEventListener('click', sellSelectedParcel);

    // Development template chooser
    document.getElementById('development-options').addEventListener('click', (e) => {
      const option = e.target.closest('.building-option');
      if (!option) return;
      const template = option.dataset.template;
      if (template) startPlanning(template);
    });

    // Planner controls
    document.getElementById('btn-add-floor').addEventListener('click', addFloor);
    document.getElementById('btn-remove-floor').addEventListener('click', removeFloor);
    document.getElementById('btn-start-construction').addEventListener('click', startConstructionFromPlan);
    document.getElementById('btn-cancel-planning').addEventListener('click', cancelPlanning);

    // Floor stack toggle (event delegation)
    document.getElementById('floor-stack').addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-floor-toggle');
      if (!btn) return;
      const idx = parseInt(btn.dataset.index, 10);
      toggleFloor(idx);
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

    // Price Heatmap Toggle
    document.getElementById('btn-toggle-heatmap').addEventListener('click', () => {
      togglePriceHeatmap();
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

