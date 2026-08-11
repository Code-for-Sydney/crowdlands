/**
 * Crowdlands - Audio Engine
 */
'use strict';

  // --- Robust Sound Engine ---
  let audioCtx = null;

  function initAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  // Unlock Web Audio Context on first user interaction anywhere
  document.addEventListener('click', initAudioContext, { passive: true });
  document.addEventListener('keydown', initAudioContext, { passive: true });
  document.addEventListener('touchstart', initAudioContext, { passive: true });

  function playSound(type) {
    if (gameState.audioMuted) return;
    initAudioContext();
    if (!audioCtx) return;

    try {
      const now = audioCtx.currentTime;
      const gainNode = audioCtx.createGain();
      gainNode.connect(audioCtx.destination);

      if (type === 'buy') {
        // High-pitched ascending success chord (C5 -> E5 -> G5)
        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(523.25, now);
        osc1.frequency.exponentialRampToValueAtTime(783.99, now + 0.2);

        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(659.25, now);
        osc2.frequency.exponentialRampToValueAtTime(1046.50, now + 0.2);

        gainNode.gain.setValueAtTime(0.25, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

        osc1.connect(gainNode);
        osc2.connect(gainNode);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.28);
        osc2.stop(now + 0.28);
      } else if (type === 'sell') {
        // Coin chime (A5 -> E5)
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(659.25, now + 0.09);

        gainNode.gain.setValueAtTime(0.2, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

        osc.connect(gainNode);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === 'click') {
        // Soft UI click
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(700, now);
        osc.frequency.exponentialRampToValueAtTime(350, now + 0.05);

        gainNode.gain.setValueAtTime(0.12, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

        osc.connect(gainNode);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (type === 'error') {
        // Low warning sound
        const osc = audioCtx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.linearRampToValueAtTime(110, now + 0.2);

        gainNode.gain.setValueAtTime(0.15, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

        osc.connect(gainNode);
        osc.start(now);
        osc.stop(now + 0.2);
      }
    } catch (e) {
      console.warn("Audio playback error:", e);
    }
  }

