/**
 * Crowdlands - Application Entry Point
 */
'use strict';

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

