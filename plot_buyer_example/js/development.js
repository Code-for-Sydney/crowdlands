/**
 * Crowdlands - Parcel Selection & Development
 */
'use strict';

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

