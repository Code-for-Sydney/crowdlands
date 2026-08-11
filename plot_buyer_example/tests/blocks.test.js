/**
 * Tests for block/merge logic and geometry helpers.
 */
describe('blocks', () => {
  const { blocks, state } = window.CL;

  beforeEach(() => {
    resetGameState();
    blocks.currentMergeProposals = [];
    const modal = document.getElementById('merge-modal');
    if (modal) modal.style.display = 'none';
  });

  test('edgeKey is deterministic and directional', () => {
    const a = [151.2, -33.8];
    const b = [151.3, -33.9];
    expect(blocks.edgeKey(a, b)).not.toBe(blocks.edgeKey(b, a));
    expect(blocks.edgeKey(a, b)).toBe(blocks.edgeKey(a, b));
  });

  test('polygonsShareEdge detects exact shared edge', () => {
    const squareA = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    const squareB = [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]];
    expect(blocks.polygonsShareEdge(squareA, squareB)).toBe(true);
  });

  test('polygonsShareEdge detects shared edge with different vertices', () => {
    const squareA = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    // Same right edge but split into two segments
    const squareB = [[[10, 0], [10, 5], [10, 10], [20, 10], [20, 0], [10, 0]]];
    expect(blocks.polygonsShareEdge(squareA, squareB)).toBe(true);
  });

  test('polygonsShareEdge rejects diagonal corner touch', () => {
    const squareA = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    const squareB = [[[10, 10], [20, 10], [20, 20], [10, 20], [10, 10]]];
    expect(blocks.polygonsShareEdge(squareA, squareB)).toBe(false);
  });

  test('unionFeatureGeometries returns single polygon for adjacent squares', () => {
    const squareA = { geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } };
    const squareB = { geometry: { type: 'Polygon', coordinates: [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]] } };
    const result = blocks.unionFeatureGeometries([squareA, squareB]);
    expect(result.type).toBe('Polygon');
  });

  test('unionFeatureGeometries returns single polygon for four adjacent squares', () => {
    const features = [
      { geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } },
      { geometry: { type: 'Polygon', coordinates: [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]] } },
      { geometry: { type: 'Polygon', coordinates: [[[0, 10], [10, 10], [10, 20], [0, 20], [0, 10]]] } },
      { geometry: { type: 'Polygon', coordinates: [[[10, 10], [20, 10], [20, 20], [10, 20], [10, 10]]] } }
    ];
    const result = blocks.unionFeatureGeometries(features);
    expect(result.type).toBe('Polygon');
  });

  test('createBlockFromCadids merges standalone parcels', () => {
    state.ownedParcels[1] = { cadid: 1, lotnumber: '1', planlabel: 'DP1', area: 100, price: 150000, development: { floors: [] } };
    state.ownedParcels[2] = { cadid: 2, lotnumber: '2', planlabel: 'DP1', area: 200, price: 300000, development: { floors: [] } };

    const block = blocks.createBlockFromCadids([1, 2]);

    expect(block.cadids).toEqual([1, 2]);
    expect(block.area).toBe(300);
    expect(block.price).toBe(450000);
    expect(state.ownedBlocks[block.id]).toBe(block);
    expect(state.ownedParcels[1]).toBeUndefined();
    expect(state.ownedParcels[2]).toBeUndefined();
  });

  test('expandBlockWithCadid adds parcel to existing block', () => {
    state.ownedParcels[1] = { cadid: 1, lotnumber: '1', planlabel: 'DP1', area: 100, price: 150000, development: { floors: [] } };
    state.ownedParcels[2] = { cadid: 2, lotnumber: '2', planlabel: 'DP1', area: 200, price: 300000, development: { floors: [] } };

    const block = blocks.createBlockFromCadids([1]);
    blocks.expandBlockWithCadid(block, 2);

    expect(block.cadids).toEqual([1, 2]);
    expect(block.area).toBe(300);
    expect(state.ownedParcels[2]).toBeUndefined();
  });

  test('dissolveBlock restores original parcels', () => {
    state.ownedParcels[1] = { cadid: 1, lotnumber: '1', planlabel: 'DP1', area: 100, price: 150000, development: { floors: [] } };
    state.ownedParcels[2] = { cadid: 2, lotnumber: '2', planlabel: 'DP1', area: 200, price: 300000, development: { floors: [] } };

    const block = blocks.createBlockFromCadids([1, 2]);
    blocks.dissolveBlock(block.id);

    expect(state.ownedBlocks[block.id]).toBeUndefined();
    expect(state.ownedParcels[1]).toBeDefined();
    expect(state.ownedParcels[2]).toBeDefined();
  });

  test('getOwnerStatusForCadid respects ownership', () => {
    state.ownedParcels[1] = { cadid: 1 };
    state.rivalOwnedParcels[2] = 'Apex Properties';

    expect(blocks.getOwnerStatusForCadid(1)).toBe('player');
    expect(blocks.getOwnerStatusForCadid(2)).toBe('rival');
    expect(blocks.getOwnerStatusForCadid(3)).toBe('unclaimed');
  });

  test('hasBuildings detects floors in parcels and blocks', () => {
    state.ownedParcels[1] = { cadid: 1, development: { floors: ['residential'] } };
    expect(blocks.hasBuildings([1])).toBe(true);

    state.ownedParcels[1] = { cadid: 1, development: { floors: [] } };
    expect(blocks.hasBuildings([1])).toBe(false);
  });

  test('calculateBlockYield applies size bonus', () => {
    state.ownedParcels[1] = { cadid: 1, area: 100, price: 150000, development: { floors: [] } };
    state.ownedParcels[2] = { cadid: 2, area: 100, price: 150000, development: { floors: [] } };
    const block = blocks.createBlockFromCadids([1, 2]);
    // Base yield for 200m2 vacant = 10, +5% for second parcel = 11
    expect(blocks.calculateBlockYield(block)).toBe(11);
  });

  test('dismissMerge and isMergeDismissed work together', () => {
    blocks.dismissMerge([1, 2, 3]);
    expect(blocks.isMergeDismissed([3, 2, 1])).toBe(true);
    expect(blocks.isMergeDismissed([1, 2])).toBe(false);
  });

  test('findAdjacentOwnedParcelGroups groups adjacent parcels', () => {
    // Use a 2x2 grid of adjacent squares.
    state.ownedParcels = {
      1: { cadid: 1, area: 100, price: 150000, development: { floors: [] } },
      2: { cadid: 2, area: 100, price: 150000, development: { floors: [] } },
      3: { cadid: 3, area: 100, price: 150000, development: { floors: [] } },
      4: { cadid: 4, area: 100, price: 150000, development: { floors: [] } }
    };

    window.CL.map.currentLoadedFeatures = [
      { properties: { cadid: 1 }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } },
      { properties: { cadid: 2 }, geometry: { type: 'Polygon', coordinates: [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]] } },
      { properties: { cadid: 3 }, geometry: { type: 'Polygon', coordinates: [[[0, 10], [10, 10], [10, 20], [0, 20], [0, 10]]] } },
      { properties: { cadid: 4 }, geometry: { type: 'Polygon', coordinates: [[[10, 10], [20, 10], [20, 20], [10, 20], [10, 10]]] } }
    ];

    const groups = blocks.findAdjacentOwnedParcelGroups();

    expect(groups.length).toBe(1);
    expect(groups[0].map(f => parseInt(f.properties.cadid)).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  test('findStandaloneParcelAdjacentToBlock detects adjacency', () => {
    state.ownedParcels[1] = { cadid: 1, lotnumber: '1', planlabel: 'DP1', area: 100, price: 150000, development: { floors: [] } };
    state.ownedParcels[2] = { cadid: 2, lotnumber: '2', planlabel: 'DP1', area: 100, price: 150000, development: { floors: [] } };

    window.CL.map.currentLoadedFeatures = [
      { properties: { cadid: 1 }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } },
      { properties: { cadid: 2 }, geometry: { type: 'Polygon', coordinates: [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]] } }
    ];

    const block = blocks.createBlockFromCadids([1]);
    const adjacent = blocks.findStandaloneParcelAdjacentToBlock();
    expect(adjacent.parcelCadid).toBe(2);
    expect(adjacent.block.id).toBe(block.id);
  });

  test('expandBlockWithCadid merges adjacent standalone parcel', () => {
    state.ownedParcels[1] = { cadid: 1, area: 100, price: 150000, development: { floors: [] } };
    state.ownedParcels[2] = { cadid: 2, area: 100, price: 150000, development: { floors: [] } };

    const block = blocks.createBlockFromCadids([1]);
    blocks.expandBlockWithCadid(block, 2);

    expect(block.cadids).toContain(2);
    expect(state.ownedParcels[2]).toBeUndefined();
  });

  test('createBlockFromCadids dissolves adjacent existing blocks into one', () => {
    state.ownedParcels[1] = { cadid: 1, lotnumber: '1', planlabel: 'DP1', area: 100, price: 150000, development: { floors: [] } };
    state.ownedParcels[2] = { cadid: 2, lotnumber: '2', planlabel: 'DP1', area: 100, price: 150000, development: { floors: [] } };
    state.ownedParcels[3] = { cadid: 3, lotnumber: '3', planlabel: 'DP1', area: 100, price: 150000, development: { floors: [] } };

    window.CL.map.currentLoadedFeatures = [
      { properties: { cadid: 1 }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } },
      { properties: { cadid: 2 }, geometry: { type: 'Polygon', coordinates: [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]] } },
      { properties: { cadid: 3 }, geometry: { type: 'Polygon', coordinates: [[[20, 0], [30, 0], [30, 10], [20, 10], [20, 0]]] } }
    ];

    const blockA = blocks.createBlockFromCadids([1]);
    const blockB = blocks.createBlockFromCadids([2]);

    // Create a new block from all three cadids; existing blocks should be dissolved first.
    const merged = blocks.createBlockFromCadids([1, 2, 3]);

    expect(state.ownedBlocks[blockA.id]).toBeUndefined();
    expect(state.ownedBlocks[blockB.id]).toBeUndefined();
    expect(merged.cadids.sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  test('deconstructionTimeForGroup has minimum time', () => {
    state.ownedParcels[1] = { cadid: 1, area: 100, price: 150000, development: { floors: [] } };
    expect(blocks.deconstructionTimeForGroup([1])).toBe(3000);
  });

  test('deconstructionTimeForGroup scales with floors', () => {
    state.ownedParcels[1] = { cadid: 1, area: 100, price: 150000, development: { floors: ['residential', 'commercial'] } };
    expect(blocks.deconstructionTimeForGroup([1])).toBe(4000);
  });

  test('checkForMergeOpportunities proposes adjacent standalone group', () => {
    state.ownedParcels = {
      1: { cadid: 1, area: 100, price: 150000, development: { floors: [] } },
      2: { cadid: 2, area: 100, price: 150000, development: { floors: [] } }
    };
    window.CL.map.currentLoadedFeatures = [
      { properties: { cadid: 1 }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } },
      { properties: { cadid: 2 }, geometry: { type: 'Polygon', coordinates: [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]] } }
    ];
    blocks.currentMergeProposals = [];

    blocks.checkForMergeOpportunities();

    expect(blocks.currentMergeProposals.length).toBeGreaterThan(0);
    expect(blocks.currentMergeProposals[0].type).toBe('group');
    expect(blocks.currentMergeProposals[0].cadids.sort((a, b) => a - b)).toEqual([1, 2]);
  });

  test('checkForMergeOpportunities proposes block expansion', () => {
    state.ownedParcels[1] = { cadid: 1, lotnumber: '1', planlabel: 'DP1', area: 100, price: 150000, development: { floors: [] } };
    state.ownedParcels[2] = { cadid: 2, lotnumber: '2', planlabel: 'DP1', area: 100, price: 150000, development: { floors: [] } };

    window.CL.map.currentLoadedFeatures = [
      { properties: { cadid: 1, lotnumber: '1', planlabel: 'DP1', area: 100 }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } },
      { properties: { cadid: 2, lotnumber: '2', planlabel: 'DP1', area: 100 }, geometry: { type: 'Polygon', coordinates: [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]] } }
    ];

    blocks.createBlockFromCadids([1]);
    blocks.currentMergeProposals = [];

    const standalone = blocks.findStandaloneParcelAdjacentToBlock();
    expect(standalone).not.toBeNull();

    blocks.checkForMergeOpportunities();

    const expandProposal = blocks.currentMergeProposals.find(p => p.type === 'expand');
    expect(expandProposal).toBeDefined();
    expect(expandProposal.parcelCadid).toBe(2);
  });

  test('dismissed group merge is not proposed again', () => {
    state.ownedParcels = {
      1: { cadid: 1, area: 100, price: 150000, development: { floors: [] } },
      2: { cadid: 2, area: 100, price: 150000, development: { floors: [] } }
    };
    window.CL.map.currentLoadedFeatures = [
      { properties: { cadid: 1 }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } },
      { properties: { cadid: 2 }, geometry: { type: 'Polygon', coordinates: [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]] } }
    ];
    blocks.dismissMerge([1, 2]);
    blocks.currentMergeProposals = [];

    blocks.checkForMergeOpportunities();

    expect(blocks.currentMergeProposals.length).toBe(0);
  });
});
