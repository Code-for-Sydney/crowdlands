/**
 * Tests for development planning and construction.
 */
describe('development', () => {
  const { development, state, economy, blocks } = window.CL;

  beforeEach(() => {
    resetGameState();
    development._clearSelection();
  });

  function addParcel(cadid, area = 1000, price = 1500000) {
    state.ownedParcels[cadid] = { cadid, area, price, lotnumber: String(cadid), planlabel: 'DP1', development: { status: 'complete', floors: [] } };
  }

  test('startPlanning sets status to planning with default floors', () => {
    addParcel(1);
    development._selectParcelByCadid(1);
    development.startPlanning('apartmentblock');

    const dev = state.ownedParcels[1].development;
    expect(dev.status).toBe('planning');
    expect(dev.floors.length).toBeGreaterThan(0);
    expect(dev.template).toBe('apartmentblock');
  });

  test('addFloor appends a floor', () => {
    addParcel(1);
    development._selectParcelByCadid(1);
    development.startPlanning('officetower');
    const before = state.ownedParcels[1].development.floors.length;
    development.addFloor();
    expect(state.ownedParcels[1].development.floors.length).toBe(before + 1);
  });

  test('removeFloor removes the last floor', () => {
    addParcel(1);
    development._selectParcelByCadid(1);
    development.startPlanning('apartmentblock');
    development.addFloor();
    const before = state.ownedParcels[1].development.floors.length;
    development.removeFloor();
    expect(state.ownedParcels[1].development.floors.length).toBe(before - 1);
  });

  test('toggleFloor switches residential to commercial', () => {
    addParcel(1);
    development._selectParcelByCadid(1);
    development.startPlanning('officetower');
    state.ownedParcels[1].development.floors[0] = 'residential';
    development.toggleFloor(0);
    expect(state.ownedParcels[1].development.floors[0]).toBe('commercial');
  });

  test('startConstructionFromPlan transitions to constructing', () => {
    addParcel(1);
    development._selectParcelByCadid(1);
    development.startPlanning('apartmentblock');
    const before = state.balance;
    development.startConstructionFromPlan();

    const dev = state.ownedParcels[1].development;
    expect(dev.status).toBe('constructing');
    expect(dev.construction).toBeDefined();
    expect(dev.construction.completeAt).toBeGreaterThan(Date.now());
    expect(state.balance).toBeLessThan(before);
  });

  test('cancelPlanning restores previous development', () => {
    addParcel(1);
    state.ownedParcels[1].development = { status: 'complete', floors: ['residential'] };
    development._selectParcelByCadid(1);
    development.startPlanning('apartment');
    development.cancelPlanning();

    expect(state.ownedParcels[1].development.status).toBe('complete');
    expect(state.ownedParcels[1].development.floors).toEqual(['residential']);
  });

  test('construction completion produces income', () => {
    addParcel(1);
    development._selectParcelByCadid(1);
    development.startPlanning('apartmentblock');
    development.startConstructionFromPlan();

    const before = state.balance;
    // Force completion by backdating completeAt
    state.ownedParcels[1].development.construction.completeAt = Date.now() - 100;
    economy.processConstruction();

    expect(state.ownedParcels[1].development.status).toBe('complete');
    economy.gameIncomeTick();
    expect(state.balance).toBeGreaterThan(before);
  });
});
