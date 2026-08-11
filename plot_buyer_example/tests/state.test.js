/**
 * Tests for state persistence and migration.
 */
describe('state', () => {
  const { state, blocks, audio } = window.CL;

  beforeEach(() => {
    resetGameState();
    localStorage.clear?.() || (localStorage.removeItem('crowdlands_save_v1'));
  });

  test('gameState has expected defaults', () => {
    expect(state.balance).toBe(10000000);
    expect(state.ownedParcels).toEqual({});
    expect(state.ownedBlocks).toEqual({});
  });

  test('saveGame writes to localStorage', () => {
    state.balance = 5000000;
    window.CL.saveGame();
    const saved = JSON.parse(localStorage.getItem('crowdlands_save_v1'));
    expect(saved.balance).toBe(5000000);
  });

  test('migrateSave converts old building field to development', () => {
    const legacy = {
      ownedParcels: {
        1: { cadid: 1, building: 'residential' }
      }
    };
    // Re-run migration logic on a fresh copy
    const gs = { ...state, ownedParcels: legacy.ownedParcels };
    Object.assign(state, gs);
    window.CL.migrateSave();
    expect(state.ownedParcels[1].development.floors).toEqual(['residential', 'residential', 'residential', 'residential', 'residential']);
    expect(state.ownedParcels[1].building).toBeUndefined();
  });

  test('save and load roundtrip preserves state', () => {
    state.balance = 1234567;
    state.ownedParcels[5] = { cadid: 5, area: 100, price: 150000, development: { floors: [] } };
    window.CL.saveGame();

    // Simulate reload by clearing in-memory state and loading from storage.
    const saved = localStorage.getItem('crowdlands_save_v1');
    state.balance = 0;
    state.ownedParcels = {};

    Object.assign(state, JSON.parse(saved));
    window.CL.migrateSave();
    expect(state.balance).toBe(1234567);
    expect(state.ownedParcels[5]).toBeDefined();
  });
});
