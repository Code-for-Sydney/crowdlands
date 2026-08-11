/**
 * Crowdlands - Application Entry Point
 */
'use strict';

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

