/**
 * Tests for UI rendering helpers.
 */
describe('ui', () => {
  const { ui, state, blocks, development } = window.CL;

  beforeEach(() => {
    resetGameState();
    development._clearSelection();
  });

  test('renderPortfolio shows owned parcels', () => {
    state.ownedParcels[1] = { cadid: 1, area: 100, price: 150000, lotnumber: '1', planlabel: 'DP1', development: { floors: [] } };
    ui.renderPortfolio();
    const listEl = document.getElementById('portfolio-list');
    expect(listEl.innerHTML).toContain('Lot 1');
    expect(document.getElementById('portfolio-count').innerText).toBe(1);
  });

  test('renderPortfolio shows owned blocks', () => {
    state.ownedParcels[1] = { cadid: 1, lotnumber: '1', planlabel: 'DP1', area: 100, price: 150000, development: { floors: [] } };
    state.ownedParcels[2] = { cadid: 2, lotnumber: '2', planlabel: 'DP1', area: 100, price: 150000, development: { floors: [] } };
    blocks.createBlockFromCadids([1, 2]);

    ui.renderPortfolio();
    const listEl = document.getElementById('portfolio-list');
    expect(listEl.innerHTML).toContain('Block');
    expect(document.getElementById('portfolio-count').innerText).toBe(1);
  });

  test('renderLeaderboard renders rival rows', () => {
    state.rivals = [
      { name: 'Apex Properties', balance: 1000000, parcelsCount: 5 },
      { name: 'Zenith Estates', balance: 2000000, parcelsCount: 10 }
    ];
    ui.renderLeaderboard();
    const listEl = document.getElementById('leaderboard-list');
    expect(listEl.innerHTML).toContain('Apex Properties');
    expect(listEl.innerHTML).toContain('Zenith Estates');
  });
});
