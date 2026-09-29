// Sons générés à la volée avec la Web Audio API (aucun fichier à charger).
window.IdleSilo = window.IdleSilo || {};

(() => {
  'use strict';

  const PREF_KEY = 'idle-silo-sound';
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let pour = null; // bruit continu de la matière qui coule
  let enabled = true;

  try { enabled = localStorage.getItem(PREF_KEY) !== 'off'; } catch { /* préférence par défaut */ }

  // Le navigateur n'autorise le son qu'après une action du joueur.
  function ensure() {
    if (!enabled) return false;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function tone(freq, start, duration, { type = 'sine', gain = 0.2 } = {}) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(g).connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  function noiseBurst(start, duration, freq, gain) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    src.connect(filter).connect(g).connect(master);
    src.start(start);
    src.stop(start + duration + 0.05);
  }

  const sounds = {
    // Godet versé dans le silo : un choc sourd et du grain.
    bucket() {
      const t = ctx.currentTime;
      tone(110 + Math.random() * 20, t, 0.12, { gain: 0.25 });
      noiseBurst(t, 0.18, 2500, 0.12);
    },
    // Klaxon du camion qui part.
    horn() {
      const t = ctx.currentTime;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1200;
      filter.connect(master);
      for (const f of [311, 392]) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
        g.gain.setValueAtTime(0.05, t + 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        osc.connect(g).connect(filter);
        osc.start(t);
        osc.stop(t + 0.45);
      }
    },
    buy() {
      const t = ctx.currentTime;
      tone(660, t, 0.08, { type: 'triangle', gain: 0.12 });
      tone(990, t + 0.06, 0.1, { type: 'triangle', gain: 0.1 });
    },
    order() {
      const t = ctx.currentTime;
      [784, 1047, 1319].forEach((f, i) => tone(f, t + i * 0.09, 0.25, { type: 'triangle', gain: 0.12 }));
    },
    achievement() {
      const t = ctx.currentTime;
      [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.1, 0.35, { gain: 0.15 }));
    },
    // Presse : claquement du moule et petit souffle d'air.
    press() {
      const t = ctx.currentTime;
      tone(80 + Math.random() * 15, t, 0.09, { type: 'square', gain: 0.08 });
      noiseBurst(t + 0.02, 0.12, 4200, 0.07);
    },
    golden() {
      const t = ctx.currentTime;
      [880, 1175, 1480, 1760, 2349].forEach((f, i) => tone(f, t + i * 0.06, 0.3, { type: 'triangle', gain: 0.1 }));
    },
    fail() {
      const t = ctx.currentTime;
      tone(300, t, 0.2, { type: 'sawtooth', gain: 0.06 });
      tone(220, t + 0.18, 0.3, { type: 'sawtooth', gain: 0.06 });
    },
  };

  function play(name) {
    if (!ensure()) return;
    sounds[name]();
  }

  // Bruit de grain qui s'écoule, actif uniquement quand la vis tourne.
  function setPouring(on) {
    if (!ctx || !enabled) on = false;
    if (on && !pour) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1800;
      filter.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.035, ctx.currentTime + 0.2);
      src.connect(filter).connect(g).connect(master);
      src.start();
      pour = { src, g };
    } else if (!on && pour) {
      const { src, g } = pour;
      g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
      src.stop(ctx.currentTime + 0.3);
      pour = null;
    }
  }

  function toggle() {
    enabled = !enabled;
    try { localStorage.setItem(PREF_KEY, enabled ? 'on' : 'off'); } catch { /* ignoré */ }
    if (!enabled) setPouring(false);
    else ensure();
    return enabled;
  }

  window.IdleSilo.audio = { play, setPouring, toggle, isEnabled: () => enabled };
})();
