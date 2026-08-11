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
    ownedParcels: {}, // cadid -> { cadid, lotnumber, planlabel, area, price, development, purchaseDate }
    ownedBlocks: {},  // blockId -> { id, cadids:[], originalParcels:{cadid->parcel}, area, price, development, purchaseDate }
    pendingMergers: [], // { id, cadids:[], status, targetBlockId, deconstruction }
    dismissedMergeKeys: [], // signatures of merges the player declined
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

  migrateSave();

  function saveGame() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState));
    } catch (e) {
      console.error("Save error", e);
    }
  }

  function migrateSave() {
    if (!gameState.ownedBlocks) gameState.ownedBlocks = {};
    if (!gameState.pendingMergers) gameState.pendingMergers = [];
    if (!gameState.dismissedMergeKeys) gameState.dismissedMergeKeys = [];

    Object.values(gameState.ownedParcels).forEach(prop => {
      if (prop.development) return;
      let floors = [];
      let status = 'complete';
      let construction = null;

      if (prop.building === 'residential') {
        floors = Array(5).fill('residential');
      } else if (prop.building === 'commercial') {
        floors = Array(20).fill('commercial');
      } else if (prop.construction) {
        const t = prop.construction.targetBuilding || 'residential';
        const f = prop.construction.floors || 0;
        floors = Array(Math.max(0, f)).fill(t === 'vacant' ? 'residential' : t);
        status = 'constructing';
        construction = {
          startedAt: prop.construction.startedAt,
          completeAt: prop.construction.completeAt,
          totalCost: prop.construction.cost || 0
        };
      }

      prop.development = { status, floors, construction };
      delete prop.building;
      delete prop.construction;
    });
  }

  // --- Building Types & Multipliers ---
  const FLOOR_TYPES = {
    residential: { name: 'Residential', short: 'Apts', icon: '🏠', factor: 0.6, costPerFloor: 5000, buildTimePerFloor: 2000 },
    commercial:  { name: 'Commercial',  short: 'Biz',  icon: '🏢', factor: 0.4, costPerFloor: 5000, buildTimePerFloor: 2000 }
  };

  const DEVELOPMENT_TEMPLATES = {
    vacant:         { name: 'Vacant Land',     icon: '🏞️', defaultFloors: 0,  defaultType: null },
    apartmentblock: { name: 'Apartment Block', icon: '🏠', defaultFloors: 5,  defaultType: 'residential' },
    officetower:    { name: 'Office Tower',    icon: '🏢', defaultFloors: 20, defaultType: 'commercial' }
  };

  function formatMs(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  function calculateDevelopmentYield(area, development) {
    if (!development || development.floors.length === 0) {
      return Math.max(1, Math.round(area * 0.05));
    }
    const totalFactor = development.floors.reduce((sum, type) => {
      return sum + (FLOOR_TYPES[type]?.factor || 0);
    }, 0);
    return Math.max(1, Math.round(area * 0.05 * totalFactor));
  }

  function getDevelopmentCost(development) {
    if (!development) return 0;
    return development.floors.reduce((sum, type) => {
      return sum + (FLOOR_TYPES[type]?.costPerFloor || 0);
    }, 0);
  }

  function getDevelopmentBuildTime(development) {
    if (!development) return 0;
    return development.floors.reduce((sum, type) => {
      return sum + (FLOOR_TYPES[type]?.buildTimePerFloor || 0);
    }, 0);
  }

  // --- Land Block Helpers ---
  function getPlayerOwnedCadids() {
    const set = new Set();
    Object.keys(gameState.ownedParcels).forEach(id => set.add(parseInt(id)));
    Object.values(gameState.ownedBlocks).forEach(block => {
      block.cadids.forEach(id => set.add(parseInt(id)));
    });
    return Array.from(set);
  }

  function isCadidInBlock(cadid) {
    return !!getBlockForCadid(cadid);
  }

  function getBlockForCadid(cadid) {
    const id = parseInt(cadid);
    return Object.values(gameState.ownedBlocks).find(b => b.cadids.includes(id));
  }

  function getBlockById(blockId) {
    return gameState.ownedBlocks[blockId];
  }

  function getOwnerStatusForCadid(cadid) {
    if (gameState.ownedParcels[cadid] || isCadidInBlock(cadid)) return 'player';
    if (gameState.rivalOwnedParcels[cadid]) return 'rival';
    return 'unclaimed';
  }

  function bboxOverlap(coordsA, coordsB) {
    const ringA = coordsA[0];
    const ringB = coordsB[0];
    let minAx = Infinity, maxAx = -Infinity, minAy = Infinity, maxAy = -Infinity;
    let minBx = Infinity, maxBx = -Infinity, minBy = Infinity, maxBy = -Infinity;
    for (let i = 0; i < ringA.length; i++) {
      const c = ringA[i];
      if (c[0] < minAx) minAx = c[0];
      if (c[0] > maxAx) maxAx = c[0];
      if (c[1] < minAy) minAy = c[1];
      if (c[1] > maxAy) maxAy = c[1];
    }
    for (let i = 0; i < ringB.length; i++) {
      const c = ringB[i];
      if (c[0] < minBx) minBx = c[0];
      if (c[0] > maxBx) maxBx = c[0];
      if (c[1] < minBy) minBy = c[1];
      if (c[1] > maxBy) maxBy = c[1];
    }
    return maxAx >= minBx && maxBx >= minAx && maxAy >= minBy && maxBy >= minAy;
  }

  function polygonsShareEdge(coordsA, coordsB) {
    // coords are Polygon coordinates arrays [outerRing, ...holes]
    // Fast exact-edge check first.
    const ringA = coordsA[0];
    const ringB = coordsB[0];
    const edgesA = new Set();
    for (let i = 0; i < ringA.length - 1; i++) {
      edgesA.add(edgeKey(ringA[i], ringA[i + 1]));
    }
    for (let i = 0; i < ringB.length - 1; i++) {
      if (edgesA.has(edgeKey(ringB[i], ringB[i + 1])) || edgesA.has(edgeKey(ringB[i + 1], ringB[i]))) return true;
    }

    // Robust fallback: if bounding boxes don't overlap, they can't share an edge.
    if (!bboxOverlap(coordsA, coordsB)) return false;

    // Two parcels are adjacent when their boundaries share a line segment.
    // turf.lineOverlap handles shared edges that have different intermediate
    // vertices, which the exact-edge check above misses.
    try {
      const lineA = turf.lineString(coordsA[0]);
      const lineB = turf.lineString(coordsB[0]);
      const overlap = turf.lineOverlap(lineA, lineB);
      return overlap && overlap.features && overlap.features.length > 0;
    } catch (e) {
      return false;
    }
  }

  function edgeKey(a, b) {
    return `${a[0].toFixed(6)},${a[1].toFixed(6)}|${b[0].toFixed(6)},${b[1].toFixed(6)}`;
  }

  function getMergeKey(cadids) {
    return [...cadids].map(Number).sort((a, b) => a - b).join(',');
  }

  function isMergeDismissed(cadids) {
    return gameState.dismissedMergeKeys.includes(getMergeKey(cadids));
  }

  function dismissMerge(cadids) {
    const key = getMergeKey(cadids);
    if (!gameState.dismissedMergeKeys.includes(key)) {
      gameState.dismissedMergeKeys.push(key);
      saveGame();
    }
  }

  function clearDismissedMergesForCadid(cadid) {
    const cid = String(cadid);
    gameState.dismissedMergeKeys = gameState.dismissedMergeKeys.filter(k => !k.split(',').includes(cid));
  }

  function findAdjacentOwnedParcelGroups() {
    const ownedCadids = getPlayerOwnedCadids();
    const features = currentLoadedFeatures.filter(f => ownedCadids.includes(parseInt(f.properties.cadid)));
    const groups = [];
    const visited = new Set();

    for (const feat of features) {
      const cid = parseInt(feat.properties.cadid);
      if (visited.has(cid)) continue;
      // Only standalone parcels can form a new block.
      if (isCadidInBlock(cid)) continue;
      const group = [feat];
      const queue = [feat];
      visited.add(cid);

      while (queue.length) {
        const current = queue.shift();
        for (const other of features) {
          const otherId = parseInt(other.properties.cadid);
          if (visited.has(otherId)) continue;
          // Only grow through other standalone parcels.
          if (isCadidInBlock(otherId)) continue;
          if (polygonsShareEdge(current.geometry.coordinates, other.geometry.coordinates)) {
            visited.add(otherId);
            group.push(other);
            queue.push(other);
          }
        }
      }

      if (group.length > 1) groups.push(group);
    }

    return groups;
  }

  function getPendingMergeForGroup(cadids) {
    const set = new Set(cadids.map(String));
    return gameState.pendingMergers.find(m => {
      const mset = new Set(m.cadids.map(String));
      return mset.size === set.size && [...mset].every(id => set.has(id));
    });
  }

  function hasBuildings(cadids) {
    return cadids.some(cid => {
      const parcel = gameState.ownedParcels[cid];
      const block = getBlockForCadid(cid);
      const dev = parcel ? parcel.development : (block ? block.development : null);
      return dev && dev.floors && dev.floors.length > 0;
    });
  }

  function deconstructionTimeForGroup(cadids) {
    let floors = 0;
    cadids.forEach(cid => {
      const parcel = gameState.ownedParcels[cid];
      const block = getBlockForCadid(cid);
      const dev = parcel ? parcel.development : (block ? block.development : null);
      if (dev && dev.floors) floors += dev.floors.length;
    });
    // 2 seconds per floor, min 3s
    return Math.max(3000, floors * 2000);
  }

  function generateBlockId() {
    return Date.now() + Math.floor(Math.random() * 100000);
  }

  function createBlockFromCadids(cadids) {
    const originalParcels = {};
    const memberGeometries = {};
    let totalArea = 0;
    let totalPrice = 0;
    let lotNumbers = [];
    let planLabels = [];

    // If any cadids belong to existing blocks, dissolve those blocks first so
    // all parcels can be combined into one new block.
    const blocksToDissolve = new Map();
    cadids.forEach(cid => {
      const block = getBlockForCadid(cid);
      if (block) blocksToDissolve.set(block.id, block);
    });
    blocksToDissolve.forEach(block => {
      Object.entries(block.originalParcels).forEach(([cid, parcel]) => {
        gameState.ownedParcels[parseInt(cid)] = parcel;
      });
      Object.entries(block.memberGeometries || {}).forEach(([cid, geom]) => {
        memberGeometries[parseInt(cid)] = geom;
      });
      delete gameState.ownedBlocks[block.id];
    });

    cadids.forEach(cid => {
      const parcel = gameState.ownedParcels[cid];
      if (parcel) {
        originalParcels[cid] = JSON.parse(JSON.stringify(parcel));
        totalArea += parcel.area;
        totalPrice += parcel.price;
        lotNumbers.push(parcel.lotnumber);
        planLabels.push(parcel.planlabel);
        delete gameState.ownedParcels[cid];
      }
    });

    // Pull any member geometries we don't already have from the current view.
    const memberFeatures = currentLoadedFeatures.filter(f => cadids.includes(parseInt(f.properties.cadid)));
    memberFeatures.forEach(f => {
      const cid = parseInt(f.properties.cadid);
      if (!memberGeometries[cid]) memberGeometries[cid] = f.geometry;
    });

    const geometry = unionFeatureGeometries(cadids.map(cid => memberGeometries[cid] ? { geometry: memberGeometries[cid] } : null).filter(Boolean));

    const blockId = generateBlockId();
    const block = {
      id: blockId,
      cadids: cadids.map(id => parseInt(id)),
      originalParcels,
      memberGeometries,
      area: totalArea,
      price: totalPrice,
      development: { status: 'complete', floors: [] },
      purchaseDate: new Date().toISOString(),
      label: `Block (${cadids.length} lots)`,
      geometry: geometry
    };

    gameState.ownedBlocks[blockId] = block;
    saveGame();
    applyFeatureOwnershipStates();
    updateBlockLayer();
    updateHUD();
    renderPortfolio();
    showToast(`Merged ${cadids.length} parcels into a single block`, 'success');
    playSound('buy');
    return block;
  }

  function dissolveBlock(blockId) {
    const block = gameState.ownedBlocks[blockId];
    if (!block) return;

    Object.values(block.originalParcels).forEach(parcel => {
      gameState.ownedParcels[parcel.cadid] = parcel;
      clearDismissedMergesForCadid(parcel.cadid);
    });

    delete gameState.ownedBlocks[blockId];
    saveGame();
    applyFeatureOwnershipStates();
    updateBlockLayer();
    updateHUD();
    renderPortfolio();
    showToast('Block split back into original parcels', 'info');
  }

  function calculateBlockYield(block) {
    // Base yield from development
    let yieldVal = calculateDevelopmentYield(block.area, block.development);
    // Size bonus: +5% per parcel beyond the first
    yieldVal = Math.round(yieldVal * (1 + (block.cadids.length - 1) * 0.05));
    // Waterfront bonus: check if any member parcel is adjacent to a large water body
    if (isBlockWaterfront(block)) yieldVal = Math.round(yieldVal * 1.25);
    return Math.max(1, yieldVal);
  }

  function isBlockWaterfront(block) {
    // Heuristic: a block is waterfront if any member parcel shares an edge with an unowned
    // parcel whose area is > 50,000 m² (likely water or public land).
    const memberIds = new Set(block.cadids.map(String));
    const memberFeatures = currentLoadedFeatures.filter(f => memberIds.has(String(f.properties.cadid)));
    const otherFeatures = currentLoadedFeatures.filter(f => !memberIds.has(String(f.properties.cadid)) && f.properties.area > 50000);

    for (const member of memberFeatures) {
      for (const other of otherFeatures) {
        if (polygonsShareEdge(member.geometry.coordinates, other.geometry.coordinates)) return true;
      }
    }
    return false;
  }

  function showMergeProposalsModal(proposals) {
    currentMergeProposals = proposals;

    const modal = document.getElementById('merge-modal');
    const body = document.getElementById('merge-modal-body');

    const renderGroup = (p, idx) => {
      const totalArea = p.features.reduce((sum, f) => sum + (f.properties.area || 0), 0);
      const combinedValue = p.features.reduce((sum, f) => sum + calculateParcelPrice(f.properties.area || 0), 0);
      const listItems = p.features.map(f => {
        const prop = gameState.ownedParcels[f.properties.cadid];
        const floors = prop && prop.development && prop.development.floors ? prop.development.floors.length : 0;
        return `<li><strong>Lot ${f.properties.lotnumber}</strong> (${f.properties.planlabel}) — ${f.properties.area?.toLocaleString()} m² ${floors > 0 ? `• ${floors} floors` : ''}</li>`;
      }).join('');
      return `
        <div class="merge-proposal">
          <label class="merge-proposal-header">
            <input type="checkbox" class="merge-proposal-check" data-index="${idx}" checked>
            <span>New block — ${p.features.length} lots — ${totalArea.toLocaleString()} m² — $${combinedValue.toLocaleString()}</span>
          </label>
          <ul class="merge-parcel-list">${listItems}</ul>
          ${p.needsDecon ? '<div class="merge-note"><i class="fa-solid fa-triangle-exclamation"></i> Existing buildings must be deconstructed before merging.</div>' : ''}
        </div>
      `;
    };

    const renderExpand = (p, idx) => {
      const parcel = gameState.ownedParcels[p.parcelCadid];
      return `
        <div class="merge-proposal">
          <label class="merge-proposal-header">
            <input type="checkbox" class="merge-proposal-check" data-index="${idx}" checked>
            <span>Expand ${p.block.label} with Lot ${p.parcelFeature.properties.lotnumber} (${p.parcelFeature.properties.planlabel}) — ${(p.block.area + p.parcelFeature.properties.area).toLocaleString()} m²</span>
          </label>
          ${p.needsDecon ? '<div class="merge-note"><i class="fa-solid fa-triangle-exclamation"></i> Existing buildings must be deconstructed before merging.</div>' : ''}
        </div>
      `;
    };

    const items = proposals.map((p, idx) => p.type === 'group' ? renderGroup(p, idx) : renderExpand(p, idx)).join('');

    body.innerHTML = `
      <p>The following adjacent parcels can be merged into larger blocks. Select the ones you want to merge:</p>
      <div class="merge-proposals-list">${items}</div>
    `;

    document.getElementById('btn-confirm-merge').innerHTML = '<i class="fa-solid fa-object-group"></i> Merge Selected';
    modal.style.display = 'flex';
  }

  function startMergeDeconstruction(cadids) {
    const mergeId = generateBlockId();
    const time = deconstructionTimeForGroup(cadids);

    // Reset buildings immediately; the timer represents the deconstruction phase
    cadids.forEach(cid => {
      const parcel = gameState.ownedParcels[cid];
      if (parcel) parcel.development = { status: 'complete', floors: [] };
    });
    saveGame();
    updateHUD();
    renderPortfolio();

    const pending = {
      id: mergeId,
      cadids: cadids.map(id => parseInt(id)),
      status: 'deconstructing',
      deconstruction: {
        startedAt: Date.now(),
        completeAt: Date.now() + time,
        totalCost: 0
      }
    };
    gameState.pendingMergers.push(pending);
    saveGame();
    updatePendingDeconLayer();
    showToast('Deconstructing buildings before merge…', 'warning');
  }

  function openDeconstructModal() {
    const modal = document.getElementById('deconstruct-modal');
    const body = document.getElementById('deconstruct-modal-body');
    const progressList = document.getElementById('deconstruct-progress-list');

    const decons = gameState.pendingMergers.filter(m => m.status === 'deconstructing');
    if (decons.length === 0) {
      modal.style.display = 'none';
      return;
    }

    body.innerHTML = `<p>Deconstructing buildings before merges. You can close this and keep playing.</p>`;

    progressList.innerHTML = decons.map((d, idx) => {
      const lotList = d.cadids.map(cid => {
        const feat = currentLoadedFeatures.find(f => parseInt(f.properties.cadid) === cid);
        if (feat) return `Lot ${feat.properties.lotnumber} (${feat.properties.planlabel})`;
        const parcel = gameState.ownedParcels[cid];
        if (parcel) return `Lot ${parcel.lotnumber} (${parcel.planlabel})`;
        return `Parcel ${cid}`;
      }).join(', ');
      return `
        <div class="deconstruct-item" data-decon-id="${d.id}">
          <div style="font-size:12px; color:var(--warning); margin-bottom:4px;">${lotList}</div>
          <div class="progress-bar">
            <div class="progress-fill deconstruct-progress" data-decon-id="${d.id}" style="width:0%"></div>
          </div>
          <div class="construction-time deconstruct-time" data-decon-id="${d.id}"></div>
        </div>
      `;
    }).join('');

    modal.style.display = 'block';
    decons.forEach(updateDeconstructProgress);
  }

  function closeDeconstructModal() {
    document.getElementById('deconstruct-modal').style.display = 'none';
  }

  function processPendingMergers() {
    const now = Date.now();
    let changed = false;

    gameState.pendingMergers = gameState.pendingMergers.filter(pending => {
      if (pending.status !== 'deconstructing') return false;
      if (now < pending.deconstruction.completeAt) {
        updateDeconstructProgress(pending);
        return true;
      }

      // Deconstruction complete
      if (pending.targetBlockId) {
        // Expansion: find the parcel that is not yet in the block
        const block = getBlockById(pending.targetBlockId);
        const newCadid = pending.cadids.find(id => !block || !block.cadids.includes(id));
        if (block && newCadid) {
          expandBlockWithCadid(block, newCadid);
        }
      } else {
        createBlockFromCadids(pending.cadids);
      }
      // Only hide the status card if no other deconstructions are running
      const stillDeconstructing = gameState.pendingMergers.some(m => m !== pending && m.status === 'deconstructing');
      if (!stillDeconstructing) closeDeconstructModal();
      changed = true;
      return false;
    });

    if (changed) saveGame();
    updatePendingDeconLayer();
  }

  function updateDeconstructProgress(pending) {
    const bar = document.querySelector(`.deconstruct-progress[data-decon-id="${pending.id}"]`);
    const timeEl = document.querySelector(`.deconstruct-time[data-decon-id="${pending.id}"]`);
    if (!bar || !timeEl) return;

    const total = pending.deconstruction.completeAt - pending.deconstruction.startedAt;
    const elapsed = Math.max(0, Date.now() - pending.deconstruction.startedAt);
    const remaining = Math.max(0, pending.deconstruction.completeAt - Date.now());
    const pct = total > 0 ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : 100;

    bar.style.width = `${pct}%`;
    timeEl.innerText = remaining > 0 ? `${formatMs(remaining)} remaining` : 'Completing...';
  }

  function findStandaloneParcelAdjacentToBlock() {
    const ownedCadids = getPlayerOwnedCadids();
    const features = currentLoadedFeatures.filter(f => ownedCadids.includes(parseInt(f.properties.cadid)));

    for (const feat of features) {
      const cid = parseInt(feat.properties.cadid);
      if (isCadidInBlock(cid)) continue;
      if (!gameState.ownedParcels[cid]) continue;

      for (const other of features) {
        const otherId = parseInt(other.properties.cadid);
        if (cid === otherId) continue;
        const block = getBlockForCadid(otherId);
        if (!block) continue;
        if (polygonsShareEdge(feat.geometry.coordinates, other.geometry.coordinates)) {
          return { block, parcelFeature: feat, parcelCadid: cid };
        }
      }
    }
    return null;
  }

  function startBlockExpansionDeconstruction(block, parcelCadid) {
    const allTargets = [...block.cadids, parcelCadid];
    const time = deconstructionTimeForGroup(allTargets);

    // Reset buildings immediately; the timer represents the deconstruction phase
    const parcel = gameState.ownedParcels[parcelCadid];
    if (parcel) parcel.development = { status: 'complete', floors: [] };
    block.development = { status: 'complete', floors: [] };
    saveGame();
    updateHUD();
    renderPortfolio();

    const mergeId = generateBlockId();
    const pending = {
      id: mergeId,
      cadids: allTargets.map(id => parseInt(id)),
      status: 'deconstructing',
      targetBlockId: block.id,
      deconstruction: {
        startedAt: Date.now(),
        completeAt: Date.now() + time,
        totalCost: 0
      }
    };
    gameState.pendingMergers.push(pending);
    saveGame();
    updatePendingDeconLayer();
    showToast('Deconstructing buildings before block expansion…', 'warning');
  }

  function expandBlockWithCadid(block, parcelCadid) {
    const parcel = gameState.ownedParcels[parcelCadid];
    if (!parcel || !block) return;

    const parcelFeature = currentLoadedFeatures.find(f => parseInt(f.properties.cadid) === parcelCadid);
    if (parcelFeature) {
      block.memberGeometries[parcelCadid] = parcelFeature.geometry;
    }

    // Recompute the block outline from all member geometries so sequential
    // expansions don't accumulate turf union artefacts.
    const allMemberFeatures = block.cadids.map(cid => {
      const geom = block.memberGeometries[cid];
      return geom ? { geometry: geom } : null;
    }).filter(Boolean);
    if (parcelFeature) allMemberFeatures.push(parcelFeature);
    block.geometry = unionFeatureGeometries(allMemberFeatures);

    block.originalParcels[parcelCadid] = JSON.parse(JSON.stringify(parcel));
    block.cadids.push(parcelCadid);
    block.area += parcel.area;
    block.price += parcel.price;
    delete gameState.ownedParcels[parcelCadid];

    saveGame();
    applyFeatureOwnershipStates();
    updateBlockLayer();
    updateHUD();
    renderPortfolio();
    showToast('Parcel merged into block', 'success');
    playSound('buy');
  }

  function isMergeModalOpen() {
    return document.getElementById('merge-modal').style.display === 'flex';
  }

  function proposalCadids(p) {
    return p.type === 'group' ? p.cadids : [...p.block.cadids, p.parcelCadid];
  }

  function checkForMergeOpportunities() {
    if (isMergeModalOpen()) return;

    const proposals = [];
    const usedCadids = new Set();

    // First collect standalone parcel groups that can form a new block
    const groups = findAdjacentOwnedParcelGroups();
    for (const group of groups) {
      const cadids = group.map(f => parseInt(f.properties.cadid));
      // Skip if all are already in the same block
      const block = getBlockForCadid(cadids[0]);
      if (block && cadids.every(id => block.cadids.includes(id))) continue;
      // Skip if there's already a pending merge for this exact group
      if (getPendingMergeForGroup(cadids)) continue;
      // Skip if the player has dismissed this merge
      if (isMergeDismissed(cadids)) continue;

      cadids.forEach(id => usedCadids.add(id));
      proposals.push({
        type: 'group',
        cadids,
        features: group,
        needsDecon: hasBuildings(cadids)
      });
    }

    // Then collect standalone parcels that can expand an existing block
    const expansion = findStandaloneParcelAdjacentToBlock();
    if (expansion) {
      const expandCadids = [...expansion.block.cadids, expansion.parcelCadid];
      // Skip if any parcel in this expansion is already used by a group proposal
      if (!expandCadids.some(id => usedCadids.has(id))) {
        const expandKey = `expand:${expansion.block.id}:${expansion.parcelCadid}`;
        const alreadyPending = gameState.pendingMergers.some(m => m.targetBlockId === expansion.block.id && m.cadids.includes(expansion.parcelCadid));
        const alreadyDismissed = gameState.dismissedMergeKeys.includes(expandKey);
        if (!alreadyPending && !alreadyDismissed) {
          proposals.push({
            type: 'expand',
            block: expansion.block,
            parcelCadid: expansion.parcelCadid,
            parcelFeature: expansion.parcelFeature,
            cadids: expandCadids,
            needsDecon: hasBuildings([expansion.parcelCadid]) || (expansion.block.development && expansion.block.development.floors.length > 0)
          });
        }
      }
    }

    if (proposals.length > 0) {
      showMergeProposalsModal(proposals);
    }
  }

  function truncateGeometry(geometry, precision = 6) {
    return turf.truncate(turf.feature(geometry), { precision, coordinates: 2 }).geometry;
  }

  function cleanGeometryFeature(feature) {
    if (!feature || !feature.geometry) return null;
    if (typeof turf.cleanCoords === 'function') {
      try {
        feature = turf.cleanCoords(feature);
      } catch (e) {
        // ignore clean failure
      }
    }
    return feature.geometry;
  }

  function logGeometry(prefix, geometry) {
    if (!geometry) return;
    const type = geometry.type;
    let parts = 1;
    if (type === 'MultiPolygon') parts = geometry.coordinates.length;
    if (type === 'Polygon') parts = geometry.coordinates.length; // includes holes
    console.log(`${prefix}: ${type} (${parts} part${parts === 1 ? '' : 's'})`);
  }

  function unionFeatureGeometries(features) {
    if (features.length === 0) return null;
    if (features.length === 1) return truncateGeometry(features[0].geometry);

    // Snap all coordinates to a common grid first.
    const snapped = features.map(f => turf.feature(truncateGeometry(f.geometry), { dissolve: 1 }));

    try {
      // turf.dissolve is designed to merge adjacent polygons and usually handles
      // shared edges with mismatched vertices better than iterative union.
      if (typeof turf.dissolve === 'function') {
        const dissolved = turf.dissolve(turf.featureCollection(snapped), { propertyName: 'dissolve' });
        if (dissolved && dissolved.features && dissolved.features.length > 0) {
          if (dissolved.features.length === 1) {
            const geom = cleanGeometryFeature(dissolved.features[0]);
            logGeometry('unionFeatureGeometries (dissolve)', geom);
            return geom;
          }
          // If dissolve still produced multiple parts, they are probably separated
          // by tiny gaps. Buffer them together slightly and unbuffer to close gaps.
          const combined = turf.combine(dissolved);
          const buffered = turf.buffer(combined, 0.5, { units: 'meters' });
          const closed = turf.buffer(buffered, -0.5, { units: 'meters' });
          const geom = cleanGeometryFeature(closed);
          logGeometry('unionFeatureGeometries (buffered)', geom);
          return geom;
        }
      }
    } catch (e) {
      console.warn('Dissolve failed, falling back to iterative union', e);
    }

    try {
      let union = snapped[0];
      for (let i = 1; i < snapped.length; i++) {
        union = turf.union(union, snapped[i]);
      }
      const geom = cleanGeometryFeature(union);
      logGeometry('unionFeatureGeometries (iterative)', geom);
      return geom;
    } catch (e) {
      console.warn('Union failed', e);
      return null;
    }
  }

  function getBlockUnionGeoJSON() {
    const features = Object.values(gameState.ownedBlocks).map(block => {
      // Use the cached dissolved outline; it is recomputed from all member
      // geometries whenever the block is created or expanded so sequential
      // merges don't accumulate turf union artefacts.
      let geometry = block.geometry;

      if (!geometry && block.memberGeometries) {
        const allMemberFeatures = block.cadids.map(cid => {
          const geom = block.memberGeometries[cid];
          return geom ? { geometry: geom } : null;
        }).filter(Boolean);
        geometry = unionFeatureGeometries(allMemberFeatures);
      }

      if (!geometry) {
        const memberFeatures = currentLoadedFeatures.filter(f => block.cadids.includes(parseInt(f.properties.cadid)));
        geometry = unionFeatureGeometries(memberFeatures);
      }

      if (!geometry) return null;
      logGeometry(`getBlockUnionGeoJSON block ${block.id}`, geometry);
      return {
        type: 'Feature',
        id: block.id,
        properties: {
          blockId: block.id,
          area: block.area,
          price: block.price,
          label: block.label,
          cadids: block.cadids
        },
        geometry: geometry
      };
    }).filter(Boolean);

    return { type: 'FeatureCollection', features };
  }

  function initBlockLayers() {
    if (!map) return;
    if (!map.getSource('player-blocks')) {
      map.addSource('player-blocks', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        generateId: true
      });
    }

    if (!map.getLayer('block-fill')) {
      map.addLayer({
        id: 'block-fill',
        type: 'fill',
        source: 'player-blocks',
        paint: {
          'fill-color': '#10b981',
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false], 0.92,
            0.78
          ]
        }
      });
    }

    if (!map.getLayer('block-outline')) {
      map.addLayer({
        id: 'block-outline',
        type: 'line',
        source: 'player-blocks',
        paint: {
          'line-color': '#fbbf24',
          'line-width': 4,
          'line-opacity': 0.95
        }
      });
    }

    if (!map.getLayer('block-hover')) {
      map.addLayer({
        id: 'block-hover',
        type: 'line',
        source: 'player-blocks',
        paint: {
          'line-color': '#fbbf24',
          'line-width': 6,
          'line-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false], 1,
            0
          ]
        }
      });
    }

    if (!map.getLayer('block-selected')) {
      map.addLayer({
        id: 'block-selected',
        type: 'line',
        source: 'player-blocks',
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

    if (!map.getLayer('block-label')) {
      map.addLayer({
        id: 'block-label',
        type: 'symbol',
        source: 'player-blocks',
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 12,
          'text-anchor': 'center'
        },
        paint: {
          'text-color': '#fbbf24',
          'text-halo-color': '#000',
          'text-halo-width': 2
        }
      });
    }

    // Pending deconstruction highlight layers
    if (!map.getSource('pending-decon')) {
      map.addSource('pending-decon', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }

    if (!map.getLayer('pending-decon-fill')) {
      map.addLayer({
        id: 'pending-decon-fill',
        type: 'fill',
        source: 'pending-decon',
        paint: {
          'fill-color': '#f59e0b',
          'fill-opacity': 0.3
        }
      });
    }

    if (!map.getLayer('pending-decon-line')) {
      map.addLayer({
        id: 'pending-decon-line',
        type: 'line',
        source: 'pending-decon',
        paint: {
          'line-color': '#f59e0b',
          'line-width': 2,
          'line-dasharray': [2, 2]
        }
      });
    }

    updatePendingDeconLayer();

    if (blockListenersAdded) return;
    blockListenersAdded = true;

    function highlightBlock(feature) {
      map.getCanvas().style.cursor = 'pointer';
      if (hoveredBlockId !== null) {
        map.setFeatureState({ source: 'player-blocks', id: hoveredBlockId }, { hover: false });
      }
      hoveredBlockId = parseInt(feature.properties.blockId);
      map.setFeatureState({ source: 'player-blocks', id: hoveredBlockId }, { hover: true });
    }

    function clearBlockHover() {
      map.getCanvas().style.cursor = '';
      if (hoveredBlockId !== null) {
        map.setFeatureState({ source: 'player-blocks', id: hoveredBlockId }, { hover: false });
        hoveredBlockId = null;
      }
    }

    function clickBlock(feature) {
      playSound('click');
      const blockId = parseInt(feature.properties.blockId);
      const block = getBlockById(blockId);
      if (!block) return;
      const feat = currentLoadedFeatures.find(f => block.cadids.includes(parseInt(f.properties.cadid)));
      if (feat) onParcelClicked(feat);
    }

    // Block hover interactions (outline and fill)
    map.on('mousemove', 'block-outline', (e) => {
      if (e.features.length > 0) highlightBlock(e.features[0]);
    });
    map.on('mousemove', 'block-fill', (e) => {
      if (e.features.length > 0) highlightBlock(e.features[0]);
    });

    map.on('mouseleave', 'block-outline', clearBlockHover);
    map.on('mouseleave', 'block-fill', clearBlockHover);

    map.on('click', 'block-outline', (e) => {
      if (e.features.length > 0) clickBlock(e.features[0]);
    });
    map.on('click', 'block-fill', (e) => {
      if (e.features.length > 0) clickBlock(e.features[0]);
    });
  }

  function updateBlockLayer() {
    if (!map) return;
    const source = map.getSource('player-blocks');
    if (!source) return;
    source.setData(getBlockUnionGeoJSON());
  }

  function clearBlockSelection() {
    if (selectedBlockId !== null && map) {
      map.setFeatureState({ source: 'player-blocks', id: selectedBlockId }, { selected: false });
      selectedBlockId = null;
    }
  }

  function setBlockSelection(blockId) {
    if (!map) return;
    clearBlockSelection();
    selectedBlockId = blockId;
    map.setFeatureState({ source: 'player-blocks', id: blockId }, { selected: true });
  }

  function clearParcelSelection() {
    if (selectedParcelId !== null && map) {
      map.setFeatureState({ source: 'nsw-cadastre', id: selectedParcelId }, { selected: false });
      selectedParcelId = null;
    }
  }

  function setParcelSelection(featureId) {
    if (!map) return;
    clearParcelSelection();
    selectedParcelId = featureId;
    map.setFeatureState({ source: 'nsw-cadastre', id: featureId }, { selected: true });
  }

  function updatePendingDeconLayer() {
    if (!map) return;
    const source = map.getSource('pending-decon');
    if (!source) return;

    const deconCadids = new Set();
    gameState.pendingMergers.forEach(m => {
      if (m.status === 'deconstructing') {
        m.cadids.forEach(id => deconCadids.add(parseInt(id)));
      }
    });

    const features = currentLoadedFeatures
      .filter(f => deconCadids.has(parseInt(f.properties.cadid)))
      .map(f => ({
        ...f,
        properties: {
          ...f.properties,
          status: 'deconstructing'
        }
      }));

    source.setData({ type: 'FeatureCollection', features });
  }

  // Map & Feature State variables
  let map;
  let currentLoadedFeatures = [];
  let selectedParcel = null;
  let selectedBlock = null;
  let selectedBlockId = null;
  let selectedParcelId = null;
  let currentSplitBlock = null;
  let currentMergeProposals = []; // { type:'group'|'expand', cadids:[], features?:[], block?, parcelCadid?, parcelFeature?, needsDecon:bool }
  let hoveredParcelId = null;
  let hoveredBlockId = null;
  let debounceTimer = null;
  let blockListenersAdded = false;
  let searchTimer = null;
  let basemapIndex = 0;
  let heatmapActive = false;

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

  // --- Handle Parcel Selection & Card Details ---
  function onParcelClicked(feature) {
    const props = feature.properties;
    const cadid = props.cadid;
    const area = props.area || 350;
    const price = calculateParcelPrice(area);

    const block = getBlockForCadid(cadid);
    const isOwnedByPlayer = !!gameState.ownedParcels[cadid] || !!block;
    const isOwnedByRival = !!gameState.rivalOwnedParcels[cadid];
    const rivalName = isOwnedByRival ? gameState.rivalOwnedParcels[cadid] : null;

    selectedBlock = block || null;
    if (selectedBlock) {
      setBlockSelection(selectedBlock.id);
      clearParcelSelection();
    } else {
      clearBlockSelection();
      setParcelSelection(feature.id);
    }

    const prop = isOwnedByPlayer
      ? (block || gameState.ownedParcels[cadid])
      : null;
    const dev = prop ? (prop.development || { status: 'complete', floors: [] }) : { status: 'complete', floors: [] };
    const rentYield = block
      ? calculateBlockYield(block)
      : calculateDevelopmentYield(area, dev);

    selectedParcel = {
      cadid: cadid,
      featureId: feature.id,
      lotnumber: props.lotnumber,
      planlabel: props.planlabel,
      area: area,
      price: price,
      isOwnedByPlayer: isOwnedByPlayer,
      isOwnedByRival: isOwnedByRival,
      rivalName: rivalName,
      blockId: block ? block.id : null
    };

    // Update UI Inspector Card Elements
    if (block) {
      document.getElementById('card-lot-number').innerText = block.label;
      document.getElementById('card-plan-label').innerText = `${block.cadids.length} merged lots`;
      document.getElementById('card-area').innerText = `${block.area.toLocaleString()} m²`;
      document.getElementById('card-price').innerText = `$${block.price.toLocaleString()}`;
    } else {
      document.getElementById('card-lot-number').innerText = `Lot ${props.lotnumber || 'N/A'}`;
      document.getElementById('card-plan-label').innerText = props.planlabel || 'NSW Cadastre';
      document.getElementById('card-area').innerText = `${area.toLocaleString()} m²`;
      document.getElementById('card-price').innerText = `$${price.toLocaleString()}`;
    }
    document.getElementById('card-yield').innerText = `$${rentYield.toLocaleString()} / sec`;

    const badge = document.getElementById('card-status-badge');
    const badgeText = document.getElementById('card-status-text');
    const ownerText = document.getElementById('card-owner');
    const btnBuy = document.getElementById('btn-buy-parcel');
    const btnSell = document.getElementById('btn-sell-parcel');
    const devSection = document.getElementById('development-section');

    if (isOwnedByPlayer) {
      btnBuy.style.display = 'none';
      btnSell.style.display = dev.status === 'constructing' ? 'none' : 'block';
      btnSell.innerHTML = block
        ? '<i class="fa-solid fa-scissors"></i> Split Block'
        : '<i class="fa-solid fa-hand-holding-dollar"></i> Sell Property';
      devSection.style.display = 'block';

      if (dev.status === 'constructing') {
        badge.className = 'parcel-status-badge status-construction';
        badgeText.innerText = 'Under Construction';
        ownerText.innerText = `${dev.floors.length} floors planned`;
      } else if (dev.status === 'planning') {
        badge.className = 'parcel-status-badge status-planning';
        badgeText.innerText = 'Planning Development';
        ownerText.innerText = 'Player (You)';
        btnSell.style.display = 'none';
      } else {
        badge.className = 'parcel-status-badge status-owned';
        badgeText.innerText = block ? 'Owned Block' : 'Owned by You';
        ownerText.innerText = 'Player (You)';
      }

      renderDevelopmentSection(dev);
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

  // --- Development Planning & Construction ---

  function getSelectedDevelopment() {
    if (!selectedParcel) return null;
    if (selectedBlock) return selectedBlock.development;
    const prop = gameState.ownedParcels[selectedParcel.cadid];
    return prop ? prop.development : null;
  }

  function getSelectedProperty() {
    if (!selectedParcel) return null;
    if (selectedBlock) return selectedBlock;
    return gameState.ownedParcels[selectedParcel.cadid];
  }

  function startPlanning(templateKey) {
    const prop = getSelectedProperty();
    if (!prop) return;
    const template = DEVELOPMENT_TEMPLATES[templateKey];
    if (!template) return;

    const previousDevelopment = (prop.development && prop.development.status === 'complete')
      ? JSON.parse(JSON.stringify(prop.development))
      : { status: 'complete', floors: [] };

    prop.development = {
      status: 'planning',
      template: templateKey,
      floors: template.defaultFloors > 0
        ? Array(template.defaultFloors).fill(template.defaultType)
        : [],
      previousDevelopment: previousDevelopment
    };

    saveGame();
    updateHUD();
    renderDevelopmentSection(prop.development);
    renderPortfolio();
  }

  function addFloor() {
    const dev = getSelectedDevelopment();
    if (!dev || dev.status === 'complete') return;
    const floorType = dev.floors.length > 0 ? dev.floors[dev.floors.length - 1] : 'residential';
    dev.floors.push(floorType);

    if (dev.status === 'constructing' && dev.construction) {
      const cost = FLOOR_TYPES[floorType].costPerFloor;
      const time = FLOOR_TYPES[floorType].buildTimePerFloor;
      gameState.balance -= cost;
      dev.construction.completeAt += time;
      dev.construction.totalCost += cost;
      showToast(`Added ${FLOOR_TYPES[floorType].short} floor (+$${(cost/1000).toFixed(0)}k)`, 'info');
    }

    saveGame();
    updateHUD();
    renderDevelopmentSection(dev);
    renderPortfolio();
  }

  function removeFloor() {
    const dev = getSelectedDevelopment();
    if (!dev || dev.status === 'complete' || dev.floors.length === 0) return;
    const floorType = dev.floors.pop();

    if (dev.status === 'constructing' && dev.construction) {
      const cost = FLOOR_TYPES[floorType].costPerFloor;
      const time = FLOOR_TYPES[floorType].buildTimePerFloor;
      gameState.balance += cost;
      dev.construction.completeAt -= time;
      dev.construction.totalCost -= cost;
      if (dev.construction.completeAt < Date.now()) dev.construction.completeAt = Date.now();
      showToast(`Removed ${FLOOR_TYPES[floorType].short} floor (+$${(cost/1000).toFixed(0)}k refunded)`, 'info');
    }

    saveGame();
    updateHUD();
    renderDevelopmentSection(dev);
    renderPortfolio();
  }

  function toggleFloor(index) {
    const dev = getSelectedDevelopment();
    if (!dev || dev.status === 'complete' || !dev.floors[index]) return;
    const currentType = dev.floors[index];
    const nextType = currentType === 'residential' ? 'commercial' : 'residential';
    dev.floors[index] = nextType;

    if (dev.status === 'constructing' && dev.construction) {
      const costDelta = FLOOR_TYPES[nextType].costPerFloor - FLOOR_TYPES[currentType].costPerFloor;
      const timeDelta = FLOOR_TYPES[nextType].buildTimePerFloor - FLOOR_TYPES[currentType].buildTimePerFloor;
      gameState.balance -= costDelta;
      dev.construction.completeAt += timeDelta;
      dev.construction.totalCost += costDelta;
    }

    saveGame();
    updateHUD();
    renderDevelopmentSection(dev);
    renderPortfolio();
  }

  function startConstructionFromPlan() {
    const prop = getSelectedProperty();
    if (!prop || !prop.development || prop.development.status !== 'planning') return;

    const dev = prop.development;
    const buildCost = getDevelopmentCost(dev);
    const buildTime = getDevelopmentBuildTime(dev);
    const previousFloors = dev.previousDevelopment ? dev.previousDevelopment.floors.length : 0;
    const demolitionTime = Math.max(0, previousFloors - dev.floors.length) * 1000;
    const totalTime = buildTime + demolitionTime;
    const totalCost = buildCost;

    if (gameState.balance < totalCost) {
      showToast(`Need $${totalCost.toLocaleString()} to start construction`, 'danger');
      playSound('error');
      return;
    }

    gameState.balance -= totalCost;
    dev.status = 'constructing';
    dev.construction = {
      startedAt: Date.now(),
      completeAt: Date.now() + totalTime,
      totalCost: totalCost
    };
    delete dev.previousDevelopment;

    playSound('buy');
    const timeMsg = totalTime > 0 ? formatMs(totalTime) : 'instant';
    showToast(`Construction started: ${dev.floors.length} floors (${timeMsg})`, 'success');
    saveGame();
    updateHUD();
    renderDevelopmentSection(dev);
    renderPortfolio();
  }

  function cancelPlanning() {
    const prop = getSelectedProperty();
    if (!prop || !prop.development) return;
    if (prop.development.status !== 'planning') return;
    prop.development = prop.development.previousDevelopment || { status: 'complete', floors: [] };
    saveGame();
    updateHUD();
    renderDevelopmentSection(prop.development);
    renderPortfolio();
  }

  function renderDevelopmentSection(dev) {
    const optionsEl = document.getElementById('development-options');
    const plannerEl = document.getElementById('development-planner');
    if (!optionsEl || !plannerEl) return;

    if (dev.status === 'planning' || dev.status === 'constructing') {
      optionsEl.style.display = 'none';
      plannerEl.style.display = 'block';
      renderPlanner(dev);
    } else {
      optionsEl.style.display = 'grid';
      plannerEl.style.display = 'none';
    }
  }

  function renderPlanner(dev) {
    const titleEl = document.getElementById('planner-title');
    const statusEl = document.getElementById('planner-status');
    const stackEl = document.getElementById('floor-stack');
    const summaryEl = document.getElementById('planner-summary');
    const startBtn = document.getElementById('btn-start-construction');
    const cancelBtn = document.getElementById('btn-cancel-planning');
    const addBtn = document.getElementById('btn-add-floor');
    const removeBtn = document.getElementById('btn-remove-floor');
    if (!titleEl || !stackEl) return;

    const tmpl = DEVELOPMENT_TEMPLATES[dev.template] || DEVELOPMENT_TEMPLATES.vacant;
    titleEl.innerText = dev.floors.length > 0
      ? `${tmpl.name} — ${dev.floors.length} floors`
      : tmpl.name;

    if (dev.status === 'planning') {
      statusEl.innerText = 'Planning';
      statusEl.className = 'planner-status status-planning';
      startBtn.style.display = 'block';
      startBtn.innerHTML = `<i class="fa-solid fa-hammer"></i> Start Construction`;
      cancelBtn.style.display = 'block';
      addBtn.style.display = 'inline-flex';
      removeBtn.style.display = 'inline-flex';
    } else {
      statusEl.innerText = 'Under Construction';
      statusEl.className = 'planner-status status-construction';
      startBtn.style.display = 'none';
      cancelBtn.style.display = 'none';
      addBtn.style.display = 'inline-flex';
      removeBtn.style.display = 'inline-flex';
    }

    renderFloorStack(dev);
    summaryEl.innerHTML = renderPlannerSummary(dev);

    if (dev.status === 'constructing') {
      updateConstructionProgress(dev);
    } else {
      const cs = document.getElementById('construction-status');
      if (cs) cs.style.display = 'none';
    }
  }

  function renderFloorStack(dev) {
    const stackEl = document.getElementById('floor-stack');
    if (!stackEl) return;
    stackEl.innerHTML = '';
    if (dev.floors.length === 0) {
      stackEl.innerHTML = '<div class="floor-empty">No floors planned</div>';
      return;
    }
    [...dev.floors].reverse().forEach((type, reverseIdx) => {
      const idx = dev.floors.length - 1 - reverseIdx;
      const ft = FLOOR_TYPES[type];
      const div = document.createElement('div');
      div.className = `floor-tile floor-${type}`;
      div.dataset.index = idx;
      div.innerHTML = `
        <span class="floor-num">F${idx + 1}</span>
        <span class="floor-icon">${ft.icon}</span>
        <span class="floor-name">${ft.name}</span>
        <button class="btn-floor-toggle" data-index="${idx}" title="Switch to ${type === 'residential' ? 'Commercial' : 'Residential'}">
          <i class="fa-solid fa-shuffle"></i>
        </button>
      `;
      stackEl.appendChild(div);
    });
  }

  function renderPlannerSummary(dev) {
    const cost = getDevelopmentCost(dev);
    const time = getDevelopmentBuildTime(dev);
    const previousFloors = dev.previousDevelopment ? dev.previousDevelopment.floors.length : 0;
    const demolishTime = dev.status === 'planning'
      ? Math.max(0, previousFloors - dev.floors.length) * 1000
      : 0;
    const totalTime = time + demolishTime;
    const baseArea = selectedBlock ? selectedBlock.area : selectedParcel.area;
    const yieldPerSec = selectedBlock
      ? (dev.floors.length ? calculateBlockYield({ ...selectedBlock, development: dev }) : 0)
      : calculateDevelopmentYield(dev.floors.length ? baseArea : 0, dev);
    const resFloors = dev.floors.filter(t => t === 'residential').length;
    const commFloors = dev.floors.filter(t => t === 'commercial').length;

    return `
      <div class="summary-row">
        <span>${resFloors} 🏠 Residential</span>
        <span>${commFloors} 🏢 Commercial</span>
      </div>
      <div class="summary-row">
        <span>Cost: <strong>$${cost.toLocaleString()}</strong></span>
        <span>Time: <strong>${totalTime > 0 ? formatMs(totalTime) : 'Instant'}</strong></span>
      </div>
      <div class="summary-row yield">
        <span>Projected income: <strong>$${yieldPerSec.toLocaleString()}/sec</strong></span>
      </div>
    `;
  }

  function updateConstructionProgress(dev) {
    const cs = document.getElementById('construction-status');
    const bar = document.getElementById('construction-progress');
    const timeEl = document.getElementById('construction-time');
    if (!cs || !bar || !timeEl || !dev.construction) return;

    const now = Date.now();
    const total = dev.construction.completeAt - dev.construction.startedAt;
    const elapsed = Math.max(0, now - dev.construction.startedAt);
    const remaining = Math.max(0, dev.construction.completeAt - now);
    const pct = total > 0 ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : 100;

    bar.style.width = `${pct}%`;
    timeEl.innerText = remaining > 0 ? `${formatMs(remaining)} remaining` : 'Completing...';
    cs.style.display = 'block';
  }

  function openSplitModal(block) {
    currentSplitBlock = block;
    const modal = document.getElementById('split-modal');
    const designer = document.getElementById('split-designer');

    const parcelList = Object.values(block.originalParcels).map(p =>
      `<li><strong>Lot ${p.lotnumber}</strong> (${p.planlabel}) — ${p.area.toLocaleString()} m²</li>`
    ).join('');

    designer.innerHTML = `
      <div style="padding: 16px;">
        <p style="margin-bottom: 12px;"><strong>${block.label}</strong> — ${block.area.toLocaleString()} m²</p>
        <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 12px;">Original parcels in this block:</p>
        <ul class="merge-parcel-list">${parcelList}</ul>
        <p style="color: var(--warning); font-size: 12px; margin-top: 12px;">
          <i class="fa-solid fa-triangle-exclamation"></i> Custom split designer (road-touching cuts) is coming soon. For now you can restore the original parcels.
        </p>
      </div>
    `;

    modal.style.display = 'flex';
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
      development: { status: 'complete', floors: [] },
      purchaseDate: new Date().toISOString()
    };

    playSound('buy');
    showToast(`Purchased Lot ${selectedParcel.lotnumber} for $${selectedParcel.price.toLocaleString()}!`, 'success');
    saveGame();
    updateHUD();
    applyFeatureOwnershipStates();
    updateBlockLayer();
    onParcelClicked({ properties: selectedParcel, id: selectedParcel.featureId });
    renderPortfolio();

    // Check if this new purchase can merge with adjacent owned land
    setTimeout(checkForMergeOpportunities, 400);
  }

  function sellSelectedParcel() {
    if (selectedBlock) {
      openSplitModal(selectedBlock);
      return;
    }

    if (!selectedParcel || !gameState.ownedParcels[selectedParcel.cadid]) return;
    const dev = gameState.ownedParcels[selectedParcel.cadid].development;
    if (dev && (dev.status === 'constructing' || dev.status === 'planning')) {
      showToast('Cannot sell while developing', 'warning');
      return;
    }

    const sellRefund = Math.round(selectedParcel.price * 0.85); // 85% resale value
    gameState.balance += sellRefund;
    delete gameState.ownedParcels[selectedParcel.cadid];
    clearDismissedMergesForCadid(selectedParcel.cadid);

    playSound('sell');
    showToast(`Sold Lot ${selectedParcel.lotnumber} for $${sellRefund.toLocaleString()}`, 'warning');
    saveGame();
    updateHUD();
    applyFeatureOwnershipStates();
    updateBlockLayer();
    onParcelClicked({ properties: selectedParcel, id: selectedParcel.featureId });
    renderPortfolio();
  }

  // --- Construction Completion Tick ---
  function processConstruction() {
    const now = Date.now();
    let changed = false;

    Object.values(gameState.ownedParcels).forEach(prop => {
      const dev = prop.development;
      if (!dev || dev.status !== 'constructing' || !dev.construction || now < dev.construction.completeAt) return;

      dev.status = 'complete';
      delete dev.construction;
      changed = true;

      playSound('buy');
      const res = dev.floors.filter(t => t === 'residential').length;
      const comm = dev.floors.filter(t => t === 'commercial').length;
      showToast(`Construction complete: ${dev.floors.length} floors (${res} res, ${comm} comm)`, 'success');
    });

    Object.values(gameState.ownedBlocks).forEach(block => {
      const dev = block.development;
      if (!dev || dev.status !== 'constructing' || !dev.construction || now < dev.construction.completeAt) return;

      dev.status = 'complete';
      delete dev.construction;
      changed = true;

      playSound('buy');
      const res = dev.floors.filter(t => t === 'residential').length;
      const comm = dev.floors.filter(t => t === 'commercial').length;
      showToast(`Block construction complete: ${dev.floors.length} floors (${res} res, ${comm} comm)`, 'success');
    });

    if (changed) {
      saveGame();
      updateHUD();
      renderPortfolio();
      if (selectedParcel) {
        onParcelClicked({ properties: selectedParcel, id: selectedParcel.featureId });
      }
    }
  }

  // --- Economy Engine Income Loop (1 Tick / Second) ---
  function gameIncomeTick() {
    let incomePerSec = 0;
    Object.values(gameState.ownedParcels).forEach(prop => {
      incomePerSec += calculateDevelopmentYield(prop.area, prop.development);
    });
    Object.values(gameState.ownedBlocks).forEach(block => {
      incomePerSec += calculateBlockYield(block);
    });

    gameState.balance += incomePerSec;
    updateHUD(incomePerSec);
  }

  // Simulate Rival AI Investors purchasing random unclaimed parcels
  function rivalMarketTick() {
    if (currentLoadedFeatures.length === 0) return;
    const unclaimed = currentLoadedFeatures.filter(f => {
      const cid = f.properties.cadid;
      return !gameState.ownedParcels[cid] && !gameState.rivalOwnedParcels[cid] && !isCadidInBlock(cid);
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
      totalYield += calculateDevelopmentYield(prop.area, prop.development);
    });

    Object.values(gameState.ownedBlocks).forEach(block => {
      totalPortfolioVal += block.price;
      totalYield += calculateBlockYield(block);
    });

    const netWorth = gameState.balance + totalPortfolioVal;

    document.getElementById('hud-balance').innerText = `$${Math.round(gameState.balance).toLocaleString()}`;
    document.getElementById('hud-income').innerHTML = `$${totalYield.toLocaleString()} <span class="income-pulse">/sec</span>`;
    document.getElementById('hud-networth').innerText = `$${Math.round(netWorth).toLocaleString()}`;

    if (heatmapActive) updatePriceHeatmap();

    const dev = getSelectedDevelopment();
    if (dev && dev.status === 'constructing') {
      updateConstructionProgress(dev);
    }
  }

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

  // --- Initialize App ---
  window.addEventListener('DOMContentLoaded', () => {
    initMap();
    setupSearch();
    setupUIEventListeners();
    updateHUD();

    // Resume any in-progress deconstruction UI
    if (gameState.pendingMergers.length > 0) {
      openDeconstructModal();
    }

    // Start 1-second game tick: construction, mergers, then income
    setInterval(() => {
      processConstruction();
      processPendingMergers();
      gameIncomeTick();
    }, 1000);

    // Start 15-second rival market AI tick
    setInterval(rivalMarketTick, 15000);
  });

  // Expose key internals for testing and debugging.
  window.CL = {
    state: gameState,
    saveGame,
    migrateSave,
    config: { FLOOR_TYPES, DEVELOPMENT_TEMPLATES, BASEMAPS },
    utils: {
      formatMs,
      calculateDevelopmentYield,
      getDevelopmentCost,
      getDevelopmentBuildTime,
      calculateParcelPrice,
      calculateParcelYield
    },
    blocks: {
      getPlayerOwnedCadids,
      isCadidInBlock,
      getBlockForCadid,
      getBlockById,
      getOwnerStatusForCadid,
      bboxOverlap,
      polygonsShareEdge,
      edgeKey,
      getMergeKey,
      isMergeDismissed,
      dismissMerge,
      clearDismissedMergesForCadid,
      findAdjacentOwnedParcelGroups,
      getPendingMergeForGroup,
      hasBuildings,
      deconstructionTimeForGroup,
      generateBlockId,
      createBlockFromCadids,
      dissolveBlock,
      calculateBlockYield,
      isBlockWaterfront,
      startMergeDeconstruction,
      openDeconstructModal,
      closeDeconstructModal,
      processPendingMergers,
      updateDeconstructProgress,
      findStandaloneParcelAdjacentToBlock,
      startBlockExpansionDeconstruction,
      expandBlockWithCadid,
      isMergeModalOpen,
      proposalCadids,
      checkForMergeOpportunities,
      truncateGeometry,
      cleanGeometryFeature,
      logGeometry,
      unionFeatureGeometries,
      getBlockUnionGeoJSON,
      get currentMergeProposals() { return currentMergeProposals; },
      set currentMergeProposals(value) { currentMergeProposals = value; }
    },
    map: {
      initMap,
      updateCadastreLayer,
      esriToGeoJSON,
      applyFeatureOwnershipStates,
      updatePriceHeatmap,
      togglePriceHeatmap,
      checkZoomLevel,
      initBlockLayers,
      updateBlockLayer,
      clearBlockSelection,
      setBlockSelection,
      clearParcelSelection,
      setParcelSelection,
      updatePendingDeconLayer,
      get currentLoadedFeatures() { return currentLoadedFeatures; },
      set currentLoadedFeatures(value) { currentLoadedFeatures = value; }
    },
    development: {
      onParcelClicked,
      getSelectedDevelopment,
      getSelectedProperty,
      startPlanning,
      addFloor,
      removeFloor,
      toggleFloor,
      startConstructionFromPlan,
      cancelPlanning,
      renderDevelopmentSection,
      renderPlanner,
      renderFloorStack,
      renderPlannerSummary,
      updateConstructionProgress,
      openSplitModal,
      // Test helpers
      _selectParcelByCadid: (cadid) => { selectedParcel = gameState.ownedParcels[cadid] || null; selectedParcelId = cadid; selectedBlock = null; selectedBlockId = null; },
      _selectBlockById: (id) => { selectedBlock = gameState.ownedBlocks[id] || null; selectedBlockId = id; selectedParcel = null; selectedParcelId = null; },
      _clearSelection: () => { selectedParcel = null; selectedParcelId = null; selectedBlock = null; selectedBlockId = null; }
    },
    economy: {
      buySelectedParcel,
      sellSelectedParcel,
      processConstruction,
      gameIncomeTick,
      rivalMarketTick,
      updateHUD
    },
    ui: {
      renderPortfolio,
      renderLeaderboard,
      setupSearch,
      setupUIEventListeners
    },
    audio: {
      initAudioContext,
      playSound,
      showToast,
      get audioCtx() { return audioCtx; },
      set audioCtx(value) { audioCtx = value; }
    }
  };

})();
