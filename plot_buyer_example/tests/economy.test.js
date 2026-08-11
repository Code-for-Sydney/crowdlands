/**
 * Tests for economy functions.
 */
describe('economy', () => {
  const { economy, state, blocks } = window.CL;

  beforeEach(() => {
    resetGameState();
  });

  test('gameIncomeTick adds parcel and block yields to balance', () => {
    state.ownedParcels[1] = { cadid: 1, area: 1000, price: 1500000, development: { floors: [] } };
    state.ownedParcels[2] = { cadid: 2, area: 1000, price: 1500000, development: { floors: [] } };
    blocks.createBlockFromCadids([2]);

    const before = state.balance;
    economy.gameIncomeTick();
    // 1000m2 vacant = 50 each, total 100
    expect(state.balance).toBe(before + 100);
  });

  test('processConstruction completes finished developments', () => {
    const dev = { status: 'constructing', floors: ['residential'], construction: { completeAt: Date.now() - 100 } };
    state.ownedParcels[1] = { cadid: 1, area: 1000, price: 1500000, development: dev };

    economy.processConstruction();

    expect(state.ownedParcels[1].development.status).toBe('complete');
    expect(state.ownedParcels[1].development.construction).toBeUndefined();
  });

  test('buySelectedParcel refuses unaffordable purchase', () => {
    state.balance = 1000;
    window.CL.map.currentLoadedFeatures = [{
      id: 1,
      properties: { cadid: 1, lotnumber: '1', planlabel: 'DP1', area: 100 },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }
    }];
    window.CL.development._selectParcelByCadid(1);
    economy.buySelectedParcel();
    expect(state.ownedParcels[1]).toBeUndefined();
  });

  test('sellSelectedParcel refunds 85% and removes ownership', () => {
    state.ownedParcels[1] = { cadid: 1, area: 100, price: 150000, lotnumber: '1', planlabel: 'DP1', development: { floors: [] } };
    window.CL.development._selectParcelByCadid(1);
    const before = state.balance;
    economy.sellSelectedParcel();
    expect(state.ownedParcels[1]).toBeUndefined();
    expect(state.balance).toBe(before + Math.round(150000 * 0.85));
  });

  test('buySelectedParcel purchases when affordable', () => {
    window.CL.map.currentLoadedFeatures = [{
      id: 1,
      properties: { cadid: 1, lotnumber: '1', planlabel: 'DP1', area: 100 },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }
    }];

    // Simulate selection
    window.CL.development.onParcelClicked(window.CL.map.currentLoadedFeatures[0]);
    const before = state.balance;
    economy.buySelectedParcel();

    expect(state.ownedParcels[1]).toBeDefined();
    expect(state.balance).toBe(before - 150000);
  });
});
