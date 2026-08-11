/**
 * Crowdlands test setup.
 * Loads the application IIFE in a jsdom environment with mocked browser APIs.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// Provide Node implementations of browser globals that app.js needs.
// Assemble a minimal turf object from individual CJS packages to avoid ESM issues.
global.turf = {
  feature: require('@turf/helpers').feature,
  polygon: require('@turf/helpers').polygon,
  lineString: require('@turf/helpers').lineString,
  featureCollection: require('@turf/helpers').featureCollection,
  combine: require('@turf/combine'),
  lineOverlap: require('@turf/line-overlap').default || require('@turf/line-overlap'),
  dissolve: require('@turf/dissolve').default || require('@turf/dissolve'),
  union: require('@turf/union').default || require('@turf/union'),
  truncate: require('@turf/truncate').default || require('@turf/truncate'),
  buffer: require('@turf/buffer').default || require('@turf/buffer'),
  cleanCoords: require('@turf/clean-coords').default || require('@turf/clean-coords')
};

// Mock localStorage
const localStorageData = {};
global.localStorage = {
  getItem: (key) => localStorageData[key] || null,
  setItem: (key, value) => { localStorageData[key] = String(value); },
  removeItem: (key) => { delete localStorageData[key]; },
  clear: () => { Object.keys(localStorageData).forEach(k => delete localStorageData[k]); }
};

// Mock MapLibre GL
global.maplibregl = {
  Map: jest.fn().mockImplementation(() => ({
    addControl: jest.fn(),
    addSource: jest.fn(),
    addLayer: jest.fn(),
    getSource: jest.fn().mockReturnValue({
      setData: jest.fn()
    }),
    getLayer: jest.fn().mockReturnValue(false),
    getCanvas: jest.fn().mockReturnValue({ style: {} }),
    setFeatureState: jest.fn(),
    getBounds: jest.fn().mockReturnValue({
      getWest: () => 151.2,
      getSouth: () => -33.9,
      getEast: () => 151.3,
      getNorth: () => -33.8
    }),
    getZoom: jest.fn().mockReturnValue(16),
    on: jest.fn(),
    flyTo: jest.fn(),
    setStyle: jest.fn(),
    setLayoutProperty: jest.fn(),
    setPaintProperty: jest.fn()
  })),
  NavigationControl: jest.fn()
};

// Mock Web Audio API
global.AudioContext = jest.fn().mockImplementation(() => ({
  state: 'running',
  resume: jest.fn(),
  currentTime: 0,
  createOscillator: jest.fn().mockReturnValue({
    type: '',
    frequency: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn(), linearRampToValueAtTime: jest.fn() },
    connect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn()
  }),
  createGain: jest.fn().mockReturnValue({
    connect: jest.fn(),
    gain: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() }
  }),
  destination: {}
}));
global.webkitAudioContext = global.AudioContext;

// Load the HTML fixture so getElementById works for HUD/ modal elements.
const htmlPath = path.join(__dirname, '..', 'index.html');
const htmlSource = fs.readFileSync(htmlPath, 'utf8');
// Strip script tags so they don't execute automatically; we'll load app.js manually.
const htmlWithoutScripts = htmlSource.replace(/<script[^>]*>.*?<\/script>/gs, '');
document.body.innerHTML = htmlWithoutScripts;

// Load the application source.
const appPath = path.join(__dirname, '..', 'app.js');
const appSource = fs.readFileSync(appPath, 'utf8');

// Execute the IIFE in the jsdom global context.
const script = document.createElement('script');
script.textContent = appSource;
document.head.appendChild(script);

// Provide a helper to reset game state between tests.
global.resetGameState = () => {
  const gs = window.CL.state;
  gs.balance = 10000000;
  gs.ownedParcels = {};
  gs.ownedBlocks = {};
  gs.pendingMergers = [];
  gs.dismissedMergeKeys = [];
  gs.rivalOwnedParcels = {};
};
