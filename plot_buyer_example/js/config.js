/**
 * Crowdlands - Game Configuration & Constants
 */
'use strict';

const FLOOR_TYPES = {
  residential: { name: 'Residential', short: 'Apts', icon: '🏠', factor: 0.6, costPerFloor: 5000, buildTimePerFloor: 2000 },
  commercial:  { name: 'Commercial',  short: 'Biz',  icon: '🏢', factor: 0.4, costPerFloor: 5000, buildTimePerFloor: 2000 }
};

const DEVELOPMENT_TEMPLATES = {
  vacant:         { name: 'Vacant Land',     icon: '🏞️', defaultFloors: 0,  defaultType: null },
  apartmentblock: { name: 'Apartment Block', icon: '🏠', defaultFloors: 5,  defaultType: 'residential' },
  officetower:    { name: 'Office Tower',    icon: '🏢', defaultFloors: 20, defaultType: 'commercial' }
};

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
