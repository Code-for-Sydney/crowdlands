/**
 * Tests for utility helpers.
 */
describe('utils', () => {
  const { utils } = window.CL;

  test('formatMs formats seconds only', () => {
    expect(utils.formatMs(4500)).toBe('5s');
  });

  test('formatMs formats minutes and seconds', () => {
    expect(utils.formatMs(125000)).toBe('2m 5s');
  });

  test('calculateDevelopmentYield returns base yield for vacant land', () => {
    expect(utils.calculateDevelopmentYield(1000, { floors: [] })).toBe(50);
  });

  test('calculateDevelopmentYield applies floor factors', () => {
    const dev = { floors: ['residential', 'residential', 'commercial'] };
    // 1000 * 0.05 * (0.6 + 0.6 + 0.4) = 80
    expect(utils.calculateDevelopmentYield(1000, dev)).toBe(80);
  });

  test('getDevelopmentCost sums floor costs', () => {
    const dev = { floors: ['residential', 'commercial'] };
    expect(utils.getDevelopmentCost(dev)).toBe(10000);
  });

  test('getDevelopmentBuildTime sums floor build times', () => {
    const dev = { floors: ['residential', 'commercial'] };
    expect(utils.getDevelopmentBuildTime(dev)).toBe(4000);
  });

  test('calculateParcelPrice uses area rate with minimum', () => {
    expect(utils.calculateParcelPrice(10)).toBe(15000);
    expect(utils.calculateParcelPrice(1000)).toBe(1500000);
  });

  test('calculateParcelYield wraps development yield', () => {
    expect(utils.calculateParcelYield(1000, 'vacant')).toBe(50);
    expect(utils.calculateParcelYield(1000, 'residential')).toBe(150);
  });
});
