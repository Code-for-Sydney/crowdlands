/**
 * Crowdlands - Game State & Persistence
 */
'use strict';

const STORAGE_KEY = 'crowdlands_save_v1';

let gameState = {
  balance: 10000000,
  ownedParcels: {},
  ownedBlocks: {},
  pendingMergers: [],
  dismissedMergeKeys: [],
  rivals: [
    { name: 'Apex Properties', balance: 25000000, color: '#8b5cf6', parcelsCount: 3 },
    { name: 'Pacific Capital', balance: 15000000, color: '#ec4899', parcelsCount: 2 },
    { name: 'Terra Holdings', balance: 40000000, color: '#f59e0b', parcelsCount: 5 }
  ],
  rivalOwnedParcels: {},
  audioMuted: false
};

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    gameState = { ...gameState, ...parsed };
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
