/**
 * Tests for map helpers.
 */
describe('map', () => {
  const { map, state, blocks } = window.CL;

  beforeEach(() => {
    resetGameState();
  });

  test('esriToGeoJSON returns empty feature collection for empty input', () => {
    expect(map.esriToGeoJSON(null)).toEqual({ type: 'FeatureCollection', features: [] });
    expect(map.esriToGeoJSON({ features: [] })).toEqual({ type: 'FeatureCollection', features: [] });
  });

  test('esriToGeoJSON converts rings and computes price', () => {
    const esri = {
      features: [{
        attributes: { cadid: 1, lotnumber: '5', planlabel: 'DP100', Shape__Area: 500 },
        geometry: { rings: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] }
      }]
    };
    const fc = map.esriToGeoJSON(esri);
    expect(fc.features.length).toBe(1);
    expect(fc.features[0].properties.cadid).toBe(1);
    expect(fc.features[0].properties.area).toBe(500);
    expect(fc.features[0].properties.price).toBe(750000);
    expect(fc.features[0].properties.status).toBe('unclaimed');
  });

  test('esriToGeoJSON marks player-owned parcels', () => {
    state.ownedParcels[1] = { cadid: 1 };
    const esri = {
      features: [{
        attributes: { cadid: 1, lotnumber: '1', planlabel: 'DP1', Shape__Area: 100 },
        geometry: { rings: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }
      }]
    };
    const fc = map.esriToGeoJSON(esri);
    expect(fc.features[0].properties.status).toBe('player');
  });

  test('esriToGeoJSON marks parcels inside player blocks', () => {
    state.ownedParcels[1] = { cadid: 1, area: 100, price: 150000, development: { floors: [] } };
    state.ownedParcels[2] = { cadid: 2, area: 100, price: 150000, development: { floors: [] } };
    blocks.createBlockFromCadids([1, 2]);

    const esri = {
      features: [
        { attributes: { cadid: 1, lotnumber: '1', planlabel: 'DP1', Shape__Area: 100 }, geometry: { rings: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } },
        { attributes: { cadid: 2, lotnumber: '2', planlabel: 'DP1', Shape__Area: 100 }, geometry: { rings: [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]] } }
      ]
    };
    const fc = map.esriToGeoJSON(esri);
    expect(fc.features[0].properties.inBlock).toBe(true);
    expect(fc.features[1].properties.inBlock).toBe(true);
  });
});
