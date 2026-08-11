/**
 * Crowdlands - Economy, Buy/Sell & Ticks
 */
'use strict';

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

