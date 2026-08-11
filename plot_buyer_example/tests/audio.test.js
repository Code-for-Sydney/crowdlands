/**
 * Tests for audio helpers.
 */
describe('audio', () => {
  const { audio } = window.CL;

  test('initAudioContext creates audio context', () => {
    audio.audioCtx = null;
    audio.initAudioContext();
    expect(audio.audioCtx).toBeDefined();
    expect(audio.audioCtx.state).toBe('running');
  });

  test('playSound returns early for unknown sound', () => {
    audio.audioCtx = null;
    expect(() => audio.playSound('unknown')).not.toThrow();
  });

  test('playSound creates oscillator for known sound', () => {
    audio.audioCtx = null;
    audio.initAudioContext();
    const ctx = audio.audioCtx;
    audio.playSound('buy');
    expect(ctx.createOscillator).toHaveBeenCalled();
  });
});
