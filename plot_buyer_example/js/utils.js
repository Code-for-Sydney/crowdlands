/**
 * Crowdlands - Utility Helpers
 */
'use strict';

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
