/**
 * Crowdlands - Block & Merge Logic
 */
'use strict';

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



