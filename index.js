const canvas = document.querySelector("#liquid-light");
const isChromium = /(?:Chrome|Chromium|CriOS)\//.test(navigator.userAgent)
  && !/(?:Firefox|FxiOS)\//.test(navigator.userAgent);
document.documentElement.classList.toggle("is-chromium", isChromium);

const pendingSplats = [];
const pointerState = new Map();
const pointerDyePolarity = new Map();
const activeTouchCards = new Map();
const activeTouchPointers = new Set();
const activePads = new Map();
const projectCards = [...document.querySelectorAll(".project-card")];
const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
let lastTouchTime = -Infinity;
let touchChordActive = false;
let suppressTouchClicksUntil = 0;
let requestFluidFrame = () => {};
let touchDyePolarity = 1;
let mouseDyePolarity = 1;
let touchTravelSinceDyeChange = 0;
let mouseTravelSinceDyeChange = 0;
let clickNoiseBuffer;
let musicContext;
let musicMaster;
let siteMix;
let ambientBus;
let ambientFilter;
let ambientPanner;
let ambientMotionGain;
let ambientSend;
let padBus;
let musicReverb;
let sceneReverbSend;
let airyStringWave;
let bowedStringWave;
let isSiteMuted = false;
let lastBellTime = -Infinity;
let lastAmbientPointerX = null;
let lastAmbientPointerY = null;
let lastAmbientPointerTime = 0;

const MOUSE_DYE_CHANGE_DISTANCE = 220;
const TOUCH_DYE_CHANGE_DISTANCE = 120;
const TOUCH_SPLAT_SPACING = 14;

function dyeDensity(polarity, strength = 1) {
  return (polarity > 0 ? 0.36 : -0.35) * strength;
}

const PAD_CHORDS = [
  [146.83, 185.0, 220.0, 277.18],
  [130.81, 164.81, 196.0, 293.66],
  [164.81, 207.65, 246.94, 329.63],
  [110.0, 138.59, 164.81, 220.0],
  [185.0, 233.08, 277.18, 369.99],
];

function createStringWave(context, airy = false) {
  const harmonics = airy
    ? [0, 1, 0.3, 0.12, 0.055, 0.026, 0.012]
    : [0, 1, 0.52, 0.28, 0.16, 0.09, 0.052, 0.03];
  const real = new Float32Array(harmonics.length);
  const imaginary = new Float32Array(harmonics.length);
  for (let index = 1; index < harmonics.length; index += 1) {
    imaginary[index] = harmonics[index];
  }
  return context.createPeriodicWave(real, imaginary, { disableNormalization: false });
}

function createReverbImpulse(context) {
  const length = Math.floor(context.sampleRate * 2.8);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      const decay = Math.pow(1 - index / length, 2.7);
      data[index] = (Math.random() * 2 - 1) * decay;
    }
  }
  return impulse;
}

function ensureSoundscape() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (musicContext) return musicContext;

  musicContext = new AudioContextClass();
  musicMaster = musicContext.createGain();
  siteMix = musicContext.createGain();
  ambientBus = musicContext.createGain();
  padBus = musicContext.createGain();
  musicReverb = musicContext.createConvolver();
  sceneReverbSend = musicContext.createGain();
  const reverbGain = musicContext.createGain();
  const outputLimiter = musicContext.createDynamicsCompressor();
  const outputCeiling = musicContext.createGain();
  const ambientHighpass = musicContext.createBiquadFilter();
  ambientFilter = musicContext.createBiquadFilter();
  ambientPanner = musicContext.createStereoPanner ? musicContext.createStereoPanner() : musicContext.createGain();
  ambientMotionGain = musicContext.createGain();
  ambientSend = musicContext.createGain();
  airyStringWave = createStringWave(musicContext, true);
  bowedStringWave = createStringWave(musicContext);
  const mobileAmbientBoost = isCoarsePointer ? 2.15 : 1;

  musicMaster.gain.value = isSiteMuted ? 0 : 0.68;
  siteMix.gain.value = 1;
  ambientBus.gain.value = 0.11 * mobileAmbientBoost;
  ambientMotionGain.gain.value = 0.92;
  padBus.gain.value = isCoarsePointer ? 0.52 : 1.05;
  reverbGain.gain.value = 0.26;
  sceneReverbSend.gain.value = 0.2;
  musicReverb.buffer = createReverbImpulse(musicContext);
  sceneReverbSend.connect(musicReverb);
  musicReverb.connect(reverbGain).connect(musicMaster);
  ambientBus.connect(musicMaster);
  ambientBus.connect(sceneReverbSend);
  padBus.connect(musicMaster);
  padBus.connect(sceneReverbSend);
  outputLimiter.threshold.value = isCoarsePointer ? -10 : -8;
  outputLimiter.knee.value = 1;
  outputLimiter.ratio.value = isCoarsePointer ? 20 : 16;
  outputLimiter.attack.value = 0.002;
  outputLimiter.release.value = 0.22;
  outputCeiling.gain.value = isCoarsePointer ? 0.82 : 1;
  musicMaster.connect(siteMix);
  siteMix.connect(outputLimiter).connect(outputCeiling).connect(musicContext.destination);

  ambientHighpass.type = "highpass";
  ambientHighpass.frequency.value = 170;
  ambientHighpass.Q.value = 0.38;
  ambientFilter.type = "lowpass";
  ambientFilter.frequency.value = 1900;
  ambientFilter.Q.value = 0.18;
  ambientFilter.connect(ambientPanner).connect(ambientMotionGain).connect(ambientBus);
  ambientSend.gain.value = 0.24;
  ambientMotionGain.connect(ambientSend).connect(musicReverb);

  const stringVibrato = musicContext.createOscillator();
  const stringVibratoDepth = musicContext.createGain();
  const stringSwell = musicContext.createOscillator();
  const stringSwellDepth = musicContext.createGain();
  stringVibrato.frequency.value = 0.11;
  stringVibratoDepth.gain.value = 2.2;
  stringSwell.frequency.value = 0.025;
  stringSwellDepth.gain.setValueAtTime(0, musicContext.currentTime);
  stringSwellDepth.gain.linearRampToValueAtTime(0.00055, musicContext.currentTime + 5.5);
  stringVibrato.connect(stringVibratoDepth);
  stringSwell.connect(stringSwellDepth);
  for (const [toneIndex, frequency] of [349.23, 440, 523.25, 698.46].entries()) {
    for (const detune of [-7, 7]) {
      const string = musicContext.createOscillator();
      const stringGain = musicContext.createGain();
      string.setPeriodicWave(airyStringWave);
      string.frequency.value = frequency;
      string.detune.value = detune + (toneIndex - 1.5) * 1.5;
      const voiceLevel = toneIndex < 2 ? 0.0055 : 0.0042;
      stringGain.gain.setValueAtTime(0.0001, musicContext.currentTime);
      stringGain.gain.linearRampToValueAtTime(voiceLevel, musicContext.currentTime + 2.4 + toneIndex * 0.35);
      stringVibratoDepth.connect(string.detune);
      stringSwellDepth.connect(stringGain.gain);
      string.connect(stringGain).connect(ambientHighpass);
      string.start();
    }
  }
  stringVibrato.start();
  stringSwell.start();

  const breeze = musicContext.createBufferSource();
  const breezeBuffer = musicContext.createBuffer(1, musicContext.sampleRate * 5, musicContext.sampleRate);
  const breezeData = breezeBuffer.getChannelData(0);
  let breezeValue = 0;
  for (let index = 0; index < breezeData.length; index += 1) {
    const whiteNoise = Math.random() * 2 - 1;
    breezeValue = breezeValue * 0.98 + whiteNoise * 0.02;
    breezeData[index] = (whiteNoise * 0.012 + breezeValue * 0.988) * 0.14;
  }
  breeze.buffer = breezeBuffer;
  breeze.loop = true;
  breeze.connect(ambientHighpass).connect(ambientFilter);
  breeze.start();

  const ambientLfo = musicContext.createOscillator();
  const ambientLfoDepth = musicContext.createGain();
  ambientLfo.frequency.value = 0.012;
  ambientLfoDepth.gain.value = 180;
  ambientLfo.connect(ambientLfoDepth).connect(ambientFilter.frequency);
  ambientLfo.start();

  const noise = musicContext.createBufferSource();
  const noiseBuffer = musicContext.createBuffer(1, musicContext.sampleRate * 3, musicContext.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let index = 0; index < noiseData.length; index += 1) noiseData[index] = Math.random() * 2 - 1;
  const shimmerFilter = musicContext.createBiquadFilter();
  const shimmerGain = musicContext.createGain();
  noise.buffer = noiseBuffer;
  noise.loop = true;
  shimmerFilter.type = "bandpass";
  shimmerFilter.frequency.value = 3600;
  shimmerFilter.Q.value = 0.28;
  shimmerGain.gain.value = 0.0005;
  noise.connect(shimmerFilter).connect(shimmerGain).connect(ambientPanner);
  noise.start();

  return musicContext;
}

function resumeSoundscape() {
  let context;
  try {
    context = ensureSoundscape();
  } catch {
    return;
  }
  if (context?.state === "suspended") context.resume().catch(() => {});
}

function releaseProjectVoice(voice) {
  const now = voice.context.currentTime;
  if (voice.gain.gain.cancelAndHoldAtTime) {
    voice.gain.gain.cancelAndHoldAtTime(now);
  } else {
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
  }
  voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);
  for (const source of voice.sources) source.stop(now + 1.4);
}

function setProjectVoiceLevel(voice, level) {
  const now = voice.context.currentTime;
  if (voice.gain.gain.cancelAndHoldAtTime) {
    voice.gain.gain.cancelAndHoldAtTime(now);
  } else {
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
  }
  voice.gain.gain.setTargetAtTime(Math.max(0.0001, level), now, 0.12);
}

function rebalanceProjectPads() {
  const voiceScale = 1 / Math.sqrt(Math.max(1, activePads.size));
  for (const voice of activePads.values()) {
    setProjectVoiceLevel(voice, voice.baseLevel * voiceScale);
  }
}

function stopProjectPad(card) {
  if (card) {
    const voice = activePads.get(card);
    if (!voice) return;
    activePads.delete(card);
    releaseProjectVoice(voice);
    rebalanceProjectPads();
    return;
  }

  const voices = [...activePads.values()];
  activePads.clear();
  for (const voice of voices) releaseProjectVoice(voice);
}

function morphProjectPad(card, event) {
  const voice = activePads.get(card);
  if (!voice) return;
  const bounds = card.getBoundingClientRect();
  const x = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
  const y = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
  const now = voice.context.currentTime;
  voice.filter.frequency.setTargetAtTime(1300 + (1 - y) * 3900, now, 0.08);
  const reverbScale = isCoarsePointer ? 0.36 : 1;
  voice.reverbSend.gain.setTargetAtTime((0.28 + y * 0.52) * reverbScale, now, 0.1);
  voice.lfoDepth.gain.setTargetAtTime(7 + x * 18, now, 0.1);
  if (voice.panner.pan) voice.panner.pan.setTargetAtTime((x - 0.5) * 1.55, now, 0.08);
  for (const source of voice.tones) {
    source.oscillator.detune.setTargetAtTime(source.baseDetune + (x - 0.5) * 24 + (0.5 - y) * 8, now, 0.08);
  }
}

function startProjectPad(card, index, event) {
  let context;
  try {
    context = ensureSoundscape();
  } catch {
    return;
  }
  if (!context) return;
  resumeSoundscape();
  if (activePads.has(card)) {
    morphProjectPad(card, event);
    return;
  }

  const now = context.currentTime;
  const gain = context.createGain();
  const highpass = context.createBiquadFilter();
  const filter = context.createBiquadFilter();
  const panner = context.createStereoPanner ? context.createStereoPanner() : context.createGain();
  const reverbSend = context.createGain();
  const lfo = context.createOscillator();
  const lfoDepth = context.createGain();
  const sources = [lfo];
  const tones = [];

  const voiceLevel = isCoarsePointer ? 0.56 + index * 0.012 : 0.8 + index * 0.018;
  gain.gain.setValueAtTime(0.0001, now);
  highpass.type = "highpass";
  highpass.frequency.value = isCoarsePointer ? 190 : 70;
  highpass.Q.value = 0.45;
  filter.type = "lowpass";
  filter.frequency.value = 2350;
  filter.Q.value = 0.45 + index * 0.08;
  reverbSend.gain.value = isCoarsePointer ? 0.16 : 0.44;
  gain.connect(highpass).connect(filter).connect(panner);
  panner.connect(padBus);
  panner.connect(reverbSend).connect(musicReverb);

  const bowNoise = context.createBufferSource();
  const bowNoiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * 1.2), context.sampleRate);
  const bowNoiseData = bowNoiseBuffer.getChannelData(0);
  for (let sample = 0; sample < bowNoiseData.length; sample += 1) {
    bowNoiseData[sample] = Math.random() * 2 - 1;
  }
  const bowFilter = context.createBiquadFilter();
  const bowGain = context.createGain();
  bowNoise.buffer = bowNoiseBuffer;
  bowNoise.loop = true;
  bowFilter.type = "bandpass";
  bowFilter.frequency.value = 1750;
  bowFilter.Q.value = 0.42;
  bowGain.gain.value = 0.012;
  bowNoise.connect(bowFilter).connect(bowGain).connect(gain);
  bowNoise.start(now);
  sources.push(bowNoise);

  for (const [toneIndex, frequency] of PAD_CHORDS[index % PAD_CHORDS.length].entries()) {
    for (const octave of [1, 2]) {
      const oscillator = context.createOscillator();
      const toneGain = context.createGain();
      const baseDetune = (toneIndex - 1.5) * 2.5 + (octave === 1 ? -4 : 5);
      oscillator.setPeriodicWave(bowedStringWave);
      oscillator.frequency.value = frequency * octave;
      oscillator.detune.value = baseDetune;
      toneGain.gain.value = octave === 1 ? 0.034 : 0.015;
      oscillator.connect(toneGain).connect(gain);
      oscillator.start(now);
      sources.push(oscillator);
      tones.push({ oscillator, baseDetune });
    }
  }

  lfo.frequency.value = 0.09 + index * 0.023;
  lfoDepth.gain.value = 8;
  lfo.connect(lfoDepth);
  for (const tone of tones) lfoDepth.connect(tone.oscillator.detune);
  lfo.start(now);

  const voice = {
    card,
    context,
    gain,
    filter,
    panner,
    reverbSend,
    lfoDepth,
    sources,
    tones,
    baseLevel: voiceLevel,
  };
  activePads.set(card, voice);
  gain.gain.exponentialRampToValueAtTime(
    voiceLevel / Math.sqrt(activePads.size),
    now + 0.48,
  );
  for (const otherVoice of activePads.values()) {
    if (otherVoice !== voice) {
      setProjectVoiceLevel(otherVoice, otherVoice.baseLevel / Math.sqrt(activePads.size));
    }
  }
  morphProjectPad(card, event);
}

function playRumblyClick(force = false) {
  if (isSiteMuted && !force) return;
  let context;
  try {
    context = ensureSoundscape();
  } catch {
    return;
  }
  if (!context || !siteMix) return;
  if (context.state === "suspended") context.resume().catch(() => {});

  const now = context.currentTime;
  const master = context.createGain();
  const speakerHighpass = context.createBiquadFilter();
  const thump = context.createOscillator();
  const thumpGain = context.createGain();
  const snap = context.createOscillator();
  const snapGain = context.createGain();
  const pebble = context.createOscillator();
  const pebbleGain = context.createGain();
  const noise = context.createBufferSource();
  const noiseFilter = context.createBiquadFilter();
  const noiseGain = context.createGain();
  const chip = context.createBufferSource();
  const chipFilter = context.createBiquadFilter();
  const chipGain = context.createGain();

  if (!clickNoiseBuffer) {
    clickNoiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.12), context.sampleRate);
    const samples = clickNoiseBuffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.random() * 2 - 1;
    }
  }

  master.gain.setValueAtTime(isCoarsePointer ? 0.38 : 0.42, now);
  speakerHighpass.type = "highpass";
  speakerHighpass.frequency.value = isCoarsePointer ? 145 : 55;
  speakerHighpass.Q.value = 0.55;
  thump.type = "triangle";
  thump.frequency.setValueAtTime(118, now);
  thump.frequency.exponentialRampToValueAtTime(54, now + 0.085);
  thumpGain.gain.setValueAtTime(0.0001, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.24, now + 0.004);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

  snap.type = "triangle";
  snap.frequency.setValueAtTime(620, now);
  snap.frequency.exponentialRampToValueAtTime(455, now + 0.045);
  snapGain.gain.setValueAtTime(0.0001, now);
  snapGain.gain.exponentialRampToValueAtTime(0.12, now + 0.002);
  snapGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.052);

  pebble.type = "sine";
  pebble.frequency.setValueAtTime(970, now + 0.006);
  pebble.frequency.exponentialRampToValueAtTime(715, now + 0.04);
  pebbleGain.gain.setValueAtTime(0.0001, now);
  pebbleGain.gain.exponentialRampToValueAtTime(0.07, now + 0.007);
  pebbleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);

  noise.buffer = clickNoiseBuffer;
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.setValueAtTime(1420, now);
  noiseFilter.Q.setValueAtTime(0.9, now);
  noiseGain.gain.setValueAtTime(0.18, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.058);

  chip.buffer = clickNoiseBuffer;
  chipFilter.type = "highpass";
  chipFilter.frequency.value = 2350;
  chipFilter.Q.value = 0.65;
  chipGain.gain.setValueAtTime(0.0001, now);
  chipGain.gain.setValueAtTime(0.08, now + 0.013);
  chipGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.052);

  thump.connect(thumpGain).connect(master);
  snap.connect(snapGain).connect(master);
  pebble.connect(pebbleGain).connect(master);
  noise.connect(noiseFilter).connect(noiseGain).connect(master);
  chip.connect(chipFilter).connect(chipGain).connect(master);
  // Keep clicks in the shared, limited output path. The mobile high-pass also
  // avoids asking small phone speakers to reproduce the click's sub-bass tail.
  master.connect(speakerHighpass);
  speakerHighpass.connect(siteMix);
  speakerHighpass.connect(musicReverb);
  thump.start(now);
  snap.start(now);
  pebble.start(now);
  noise.start(now);
  chip.start(now, 0.017);
  thump.stop(now + 0.14);
  snap.stop(now + 0.06);
  pebble.stop(now + 0.06);
  noise.stop(now + 0.08);
  chip.stop(now + 0.06);
}

function playMuteBell(intensity = 1) {
  if (isSiteMuted) return;
  let context;
  try {
    context = ensureSoundscape();
  } catch {
    return;
  }
  if (!context || context.currentTime - lastBellTime < 0.16) return;
  if (context.state === "suspended") context.resume().catch(() => {});
  lastBellTime = context.currentTime;

  const now = context.currentTime;
  const output = context.createGain();
  output.gain.value = 0.48 * intensity;
  output.connect(musicMaster);
  output.connect(sceneReverbSend);

  for (const [index, frequency] of [760, 1168, 1576].entries()) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = now + index * 0.012;
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12 / (index + 1), start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.72 + index * 0.12);
    oscillator.connect(gain).connect(output);
    oscillator.start(start);
    oscillator.stop(start + 1.1);
  }

  const rattle = context.createBufferSource();
  const rattleBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.09), context.sampleRate);
  const rattleData = rattleBuffer.getChannelData(0);
  for (let index = 0; index < rattleData.length; index += 1) rattleData[index] = Math.random() * 2 - 1;
  const rattleFilter = context.createBiquadFilter();
  const rattleGain = context.createGain();
  rattle.buffer = rattleBuffer;
  rattleFilter.type = "bandpass";
  rattleFilter.frequency.value = 1850;
  rattleFilter.Q.value = 1.3;
  rattleGain.gain.setValueAtTime(0.08, now);
  rattleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  rattle.connect(rattleFilter).connect(rattleGain).connect(output);
  rattle.start(now);

  if (muteButton) {
    muteButton.classList.remove("is-ringing");
    void muteButton.offsetWidth;
    muteButton.classList.add("is-ringing");
    setTimeout(() => muteButton.classList.remove("is-ringing"), 480);
  }
}

const muteButton = document.querySelector(".mute-button");
const fingertipCue = document.querySelector(".mobile-fingertip-cue");
const fingertip = document.querySelector(".mobile-fingertip");
let muteOffsetX = 0;
let muteOffsetY = 0;
let muteOriginRect = muteButton?.getBoundingClientRect();
let fingerTriggerLocked = false;
let bellAngle = 0;
let bellVelocity = 0;
let clapperAngle = 0;
let clapperVelocity = 0;
let bellPhysicsFrame = 0;
let bellPhysicsTime = 0;
let lastBellPointerX = null;
let lastBellPointerY = null;
let lastBellPointerTime = 0;

function animateBellPhysics(time) {
  if (!muteButton) return;
  const step = bellPhysicsTime ? Math.min((time - bellPhysicsTime) / 16.667, 2) : 1;
  bellPhysicsTime = time;

  bellVelocity += -bellAngle * 0.075 * step;
  bellVelocity *= Math.pow(0.875, step);
  bellAngle = clamp(bellAngle + bellVelocity * step, -24, 24);
  clapperVelocity += -(clapperAngle + bellAngle * 0.58) * 0.12 * step;
  clapperVelocity *= Math.pow(0.82, step);
  clapperAngle = clamp(clapperAngle + clapperVelocity * step, -32, 32);
  muteButton.style.setProperty("--bell-angle", bellAngle.toFixed(2) + "deg");
  muteButton.style.setProperty("--clapper-angle", clapperAngle.toFixed(2) + "deg");

  if (Math.abs(bellAngle) + Math.abs(bellVelocity) + Math.abs(clapperAngle) + Math.abs(clapperVelocity) > 0.18) {
    bellPhysicsFrame = requestAnimationFrame(animateBellPhysics);
  } else {
    bellPhysicsFrame = 0;
    bellPhysicsTime = 0;
  }
}

function kickBellPhysics(deltaX, deltaY = 0, pointerSpeed = 0) {
  const velocityScale = clamp(pointerSpeed / 0.65, 0.08, 1.5);
  bellVelocity += clamp((deltaX * 0.055 + deltaY * 0.012) * velocityScale, -10, 10);
  clapperVelocity -= clamp(deltaX * 0.085 * velocityScale, -14, 14);
  if (!bellPhysicsFrame) bellPhysicsFrame = requestAnimationFrame(animateBellPhysics);
}

function setMuteTarget(offsetX, offsetY) {
  if (!muteButton || !muteOriginRect) return;
  const margin = 10;
  muteOffsetX = clamp(
    offsetX,
    margin - muteOriginRect.left,
    window.innerWidth - margin - muteOriginRect.right,
  );
  muteOffsetY = clamp(
    offsetY,
    margin - muteOriginRect.top,
    window.innerHeight - margin - muteOriginRect.bottom,
  );
  muteButton.style.setProperty("--mute-x", muteOffsetX + "px");
  muteButton.style.setProperty("--mute-y", muteOffsetY + "px");
}

function toggleSiteMute() {
  isSiteMuted = !isSiteMuted;
  if (!isSiteMuted) resumeSoundscape();
  if (musicMaster && musicContext) {
    musicMaster.gain.setTargetAtTime(isSiteMuted ? 0.0001 : 0.68, musicContext.currentTime, 0.08);
  }
  muteButton?.setAttribute("aria-pressed", String(isSiteMuted));
  if (muteButton) muteButton.setAttribute("aria-label", isSiteMuted ? "Unmute sound" : "Mute sound");
  muteButton?.classList.toggle("is-muted", isSiteMuted);
}

function triggerFingerMute() {
  if (fingerTriggerLocked || !muteButton || !fingertipCue || !fingertip) return;
  fingerTriggerLocked = true;
  const bellRect = muteButton.getBoundingClientRect();
  const fingerTip = fingerTipPosition();
  const bellContact = closestBellPoint(bellRect, fingerTip);
  const contactX = bellContact.x - fingerTip.x;
  const contactY = bellContact.y - fingerTip.y;
  fingertip.style.animationPlayState = "paused";
  fingertipCue.classList.add("is-clicking");

  function moveFinger(x, y, duration, easing) {
    fingertipCue.style.transition = `transform ${duration}ms ${easing}`;
    fingertipCue.style.setProperty("--finger-press-x", x + "px");
    fingertipCue.style.setProperty("--finger-press-y", y + "px");
  }

  moveFinger(contactX, contactY, 240, "cubic-bezier(0.16, 0.82, 0.24, 1)");
  setTimeout(() => {
    fingertipCue.classList.add("is-pressing");
    muteButton.classList.add("is-triggered");
    moveFinger(contactX - 4, contactY, 70, "cubic-bezier(0.35, 0, 0.65, 1)");
  }, 240);
  setTimeout(() => {
    playRumblyClick(true);
    toggleSiteMute();
  }, 310);
  setTimeout(() => {
    fingertipCue.classList.remove("is-pressing");
    muteButton.classList.remove("is-triggered");
    moveFinger(contactX + 6, contactY + 4, 150, "cubic-bezier(0.16, 0.82, 0.3, 1)");
  }, 325);
  setTimeout(() => {
    moveFinger(contactX + 28, contactY + 8, 220, "cubic-bezier(0.18, 0.72, 0.24, 1)");
  }, 520);
  setTimeout(() => {
    moveFinger(contactX - 30, contactY - 2, 170, "cubic-bezier(0.55, 0, 0.92, 0.48)");
  }, 860);
  setTimeout(() => {
    muteButton.classList.add("is-flicking");
    void muteButton.offsetWidth;
    setMuteTarget(muteOffsetX - 132, muteOffsetY - 10);
    kickBellPhysics(-132, -10, 1.5);
    playMuteBell(0.72);
  }, 970);
  setTimeout(() => {
    moveFinger(contactX + 10, contactY + 5, 220, "cubic-bezier(0.16, 0.82, 0.3, 1)");
  }, 1110);
  setTimeout(() => {
    muteButton.classList.remove("is-flicking");
  }, 1260);
  setTimeout(() => {
    moveFinger(0, 0, 480, "cubic-bezier(0.16, 0.82, 0.3, 1)");
  }, 1360);
  setTimeout(() => {
    fingertipCue.classList.remove("is-clicking");
    fingertipCue.style.removeProperty("transition");
    fingertipCue.style.removeProperty("--finger-press-x");
    fingertipCue.style.removeProperty("--finger-press-y");
    fingertip.style.removeProperty("animation-play-state");
    fingerTriggerLocked = false;
  }, 1900);
}

function fingerPointPosition(xFraction, yFraction) {
  if (!fingertip || !fingertipCue) return null;
  const cueRect = fingertipCue.getBoundingClientRect();
  const style = getComputedStyle(fingertip);
  const origin = style.transformOrigin.split(" ").map(Number.parseFloat);
  const localX = fingertip.offsetWidth * xFraction;
  const localY = fingertip.offsetHeight * yFraction;
  if (window.DOMMatrixReadOnly && style.transform !== "none") {
    const matrix = new DOMMatrixReadOnly(style.transform);
    const x = localX - origin[0];
    const y = localY - origin[1];
    return {
      x: cueRect.left + origin[0] + matrix.a * x + matrix.c * y + matrix.e,
      y: cueRect.top + origin[1] + matrix.b * x + matrix.d * y + matrix.f,
    };
  }
  return { x: cueRect.left + localX, y: cueRect.top + localY };
}

function fingerTipPosition() {
  return fingerPointPosition(0.5, 0.08);
}

function closestBellPoint(rect, point) {
  return {
    x: clamp(point.x, rect.left + 9, rect.right - 9),
    y: clamp(point.y, rect.top + 6, rect.bottom - 7),
  };
}

function checkFingerMuteProximity(targetCenter) {
  if (!muteButton || !fingertip || fingerTriggerLocked) return;
  const buttonRect = muteButton.getBoundingClientRect();
  const fingerTip = fingerTipPosition();
  if (!buttonRect.width || !fingerTip) return;
  const bellPoint = targetCenter ?? closestBellPoint(buttonRect, fingerTip);
  if (Math.hypot(bellPoint.x - fingerTip.x, bellPoint.y - fingerTip.y) < 18) {
    triggerFingerMute();
  }
}

function evadeMuteButton(event) {
  if (!muteButton || !muteOriginRect) return;
  const pointerTime = performance.now();
  const pointerElapsed = pointerTime - lastBellPointerTime;
  const pointerSpeed = lastBellPointerX !== null && pointerElapsed > 0 && pointerElapsed < 100
    ? Math.hypot(event.clientX - lastBellPointerX, event.clientY - lastBellPointerY) / pointerElapsed
    : 0;
  lastBellPointerX = event.clientX;
  lastBellPointerY = event.clientY;
  lastBellPointerTime = pointerTime;

  const rect = muteButton.getBoundingClientRect();
  const center = { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
  let dx = center.x - event.clientX;
  let dy = center.y - event.clientY;
  let distance = Math.hypot(dx, dy);
  const clearance = event.pointerType === "touch" ? 86 : 70;
  if (distance >= clearance) return;

  if (distance < 1) {
    dx = 0.7;
    dy = -0.7;
    distance = 1;
  }
  const previousX = muteOffsetX;
  const previousY = muteOffsetY;
  const originCenterX = muteOriginRect.left + muteOriginRect.width * 0.5;
  const originCenterY = muteOriginRect.top + muteOriginRect.height * 0.5;
  const mouseFling = event.pointerType === "touch"
    ? 0
    : clamp((pointerSpeed - 0.32) * 32, 0, 48);
  const targetDistance = clearance + mouseFling;
  const targetCenterX = event.clientX + dx / distance * targetDistance;
  const targetCenterY = event.clientY + dy / distance * targetDistance;
  const desiredX = targetCenterX - originCenterX;
  const desiredY = targetCenterY - originCenterY;
  const follow = event.pointerType === "touch"
    ? clamp(0.28 + pointerSpeed * 0.12, 0.28, 0.52)
    : clamp(0.32 + pointerSpeed * 0.18, 0.32, 0.68);
  const requestedX = muteOffsetX + (desiredX - muteOffsetX) * follow;
  const requestedY = muteOffsetY + (desiredY - muteOffsetY) * follow;
  setMuteTarget(requestedX, requestedY);

  const hitBoundary = Math.hypot(muteOffsetX - requestedX, muteOffsetY - requestedY) > 1;
  if (hitBoundary) {
    const options = [
      { x: muteOffsetX + 46, y: muteOffsetY },
      { x: muteOffsetX - 46, y: muteOffsetY },
      { x: muteOffsetX, y: muteOffsetY - 46 },
      { x: muteOffsetX, y: muteOffsetY + 46 },
    ];
    let best = null;
    for (const option of options) {
      const x = clamp(option.x, 10 - muteOriginRect.left, window.innerWidth - 10 - muteOriginRect.right);
      const y = clamp(option.y, 10 - muteOriginRect.top, window.innerHeight - 10 - muteOriginRect.bottom);
      const score = Math.hypot(
        muteOriginRect.left + muteOriginRect.width * 0.5 + x - event.clientX,
        muteOriginRect.top + muteOriginRect.height * 0.5 + y - event.clientY,
      );
      if (!best || score > best.score) best = { x, y, score };
    }
    if (best) setMuteTarget(best.x, best.y);
  }
  const movement = Math.hypot(muteOffsetX - previousX, muteOffsetY - previousY);
  if (movement > 2) {
    kickBellPhysics(muteOffsetX - previousX, muteOffsetY - previousY, pointerSpeed);
    const chimeStrength = clamp((pointerSpeed - 0.12) / 1.35, 0, 1);
    if (chimeStrength > 0.035) playMuteBell(chimeStrength);
  }
}

if (muteButton) {
  window.addEventListener("pointermove", evadeMuteButton, { passive: true });
  muteButton.addEventListener("pointerenter", evadeMuteButton, { passive: true });
  muteButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    evadeMuteButton(event);
  });
  muteButton.addEventListener("click", (event) => event.preventDefault());
  window.addEventListener("resize", () => {
    muteOffsetX = 0;
    muteOffsetY = 0;
    muteButton.style.transition = "none";
    muteButton.style.setProperty("--mute-x", "0px");
    muteButton.style.setProperty("--mute-y", "0px");
    requestAnimationFrame(() => {
      muteOriginRect = muteButton.getBoundingClientRect();
      requestAnimationFrame(() => muteButton.style.removeProperty("transition"));
    });
  }, { passive: true });
  setInterval(checkFingerMuteProximity, 180);
}

try {
  ensureSoundscape();
} catch {
  // The visual experience remains available when Web Audio is unsupported.
}
window.addEventListener("pointerdown", resumeSoundscape, { capture: true, passive: true });
window.addEventListener("keydown", resumeSoundscape, { capture: true });

for (const link of document.querySelectorAll("a[href]")) {
  link.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch" && link.matches(".project-card, .github-link")) return;
    if (event.button === 0) playRumblyClick();
  }, { passive: true });
  link.addEventListener("keydown", (event) => {
    if (event.key === "Enter") playRumblyClick();
  });
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function modulateBackgroundSound(event) {
  const hoveredElement = document.elementFromPoint(event.clientX, event.clientY);
  if (hoveredElement?.closest(".project-card, .github-link, .mute-button")) return;

  const pointerTime = performance.now();
  const elapsed = pointerTime - lastAmbientPointerTime;
  const speed = lastAmbientPointerX !== null && elapsed > 0 && elapsed < 120
    ? clamp(Math.hypot(event.clientX - lastAmbientPointerX, event.clientY - lastAmbientPointerY) / elapsed, 0, 1.5)
    : 0;
  lastAmbientPointerX = event.clientX;
  lastAmbientPointerY = event.clientY;
  lastAmbientPointerTime = pointerTime;
  if (!musicContext || !ambientFilter || !ambientMotionGain || !ambientSend) return;

  const x = clamp(event.clientX / window.innerWidth, 0, 1);
  const y = clamp(event.clientY / window.innerHeight, 0, 1);
  const now = musicContext.currentTime;
  ambientFilter.frequency.setTargetAtTime(1150 + (1 - y) * 1650 + speed * 150, now, 0.22);
  ambientMotionGain.gain.setTargetAtTime(0.84 + speed * 0.09, now, 0.25);
  ambientSend.gain.setTargetAtTime(0.2 + y * 0.16, now, 0.35);
  if (ambientPanner.pan) ambientPanner.pan.setTargetAtTime((x - 0.5) * 1.05, now, 0.24);
}

window.addEventListener("pointerdown", modulateBackgroundSound, { passive: true });
window.addEventListener("pointermove", modulateBackgroundSound, { passive: true });

function queueSplat(splat) {
  pendingSplats.push(splat);
  if (pendingSplats.length > 32) pendingSplats.shift();
  requestFluidFrame();
}

function pointerPosition(event) {
  return {
    x: clamp(event.clientX / window.innerWidth, 0, 1),
    y: clamp(1 - event.clientY / window.innerHeight, 0, 1),
  };
}

window.addEventListener("pointerdown", (event) => {
  const position = pointerPosition(event);
  const isTouch = event.pointerType === "touch";
  const polarity = isTouch ? touchDyePolarity : mouseDyePolarity;

  pointerState.set(event.pointerId, position);
  pointerDyePolarity.set(event.pointerId, polarity);
  queueSplat({
    x: position.x,
    y: position.y,
    dx: 0,
    dy: 0,
    density: dyeDensity(polarity, isTouch ? 1 : 0.8),
    radius: isTouch ? 0.014 : 0.006,
  });
}, { passive: true });

function paintPointerSegment(event, previous, position) {
  const travel = Math.hypot(
    (position.x - previous.x) * window.innerWidth,
    (position.y - previous.y) * window.innerHeight,
  );

  if (event.pointerType === "mouse") {
    mouseTravelSinceDyeChange += travel;
    while (mouseTravelSinceDyeChange >= MOUSE_DYE_CHANGE_DISTANCE) {
      mouseTravelSinceDyeChange -= MOUSE_DYE_CHANGE_DISTANCE;
      mouseDyePolarity *= -1;
    }
    pointerDyePolarity.set(event.pointerId, mouseDyePolarity);
  } else if (event.pointerType === "touch") {
    touchTravelSinceDyeChange += travel;
    while (touchTravelSinceDyeChange >= TOUCH_DYE_CHANGE_DISTANCE) {
      touchTravelSinceDyeChange -= TOUCH_DYE_CHANGE_DISTANCE;
      touchDyePolarity *= -1;
    }
    pointerDyePolarity.set(event.pointerId, touchDyePolarity);
  }

  const scale = event.pointerType === "touch" ? 720 : 920;
  const dx = clamp((position.x - previous.x) * scale, -130, 130);
  const dy = clamp((position.y - previous.y) * scale, -130, 130);
  const movement = Math.abs(dx) + Math.abs(dy);

  if (movement > 0.08) {
    const polarity = pointerDyePolarity.get(event.pointerId) ?? mouseDyePolarity;
    queueSplat({
      x: position.x,
      y: position.y,
      dx,
      dy,
      density: dyeDensity(polarity, event.pointerType === "touch" ? 1 : 0.72),
      radius: event.pointerType === "touch" ? 0.007 : 0.0038,
    });
  }
}

window.addEventListener("pointermove", (event) => {
  const position = pointerPosition(event);
  const previous = pointerState.get(event.pointerId);

  if (!previous) {
    pointerState.set(event.pointerId, position);
    pointerDyePolarity.set(event.pointerId, event.pointerType === "touch" ? touchDyePolarity : mouseDyePolarity);
    return;
  }

  const travel = Math.hypot(
    (position.x - previous.x) * window.innerWidth,
    (position.y - previous.y) * window.innerHeight,
  );
  const steps = event.pointerType === "touch"
    ? Math.max(1, Math.ceil(travel / TOUCH_SPLAT_SPACING))
    : 1;

  let segmentStart = previous;
  for (let step = 1; step <= steps; step += 1) {
    const amount = step / steps;
    const segmentEnd = {
      x: previous.x + (position.x - previous.x) * amount,
      y: previous.y + (position.y - previous.y) * amount,
    };
    paintPointerSegment(event, segmentStart, segmentEnd);
    segmentStart = segmentEnd;
  }

  pointerState.set(event.pointerId, position);
}, { passive: true });

function releasePointer(event) {
  if (event.pointerType !== "mouse") {
    pointerState.delete(event.pointerId);
    pointerDyePolarity.delete(event.pointerId);
  }
}

window.addEventListener("pointerup", releasePointer, { passive: true });
window.addEventListener("pointercancel", releasePointer, { passive: true });

function setCardFoil(card, event, touchAmount = 1) {
  const bounds = card.getBoundingClientRect();
  const x = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
  const y = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);

  const tiltX = (0.5 - y) * 10 * touchAmount;
  const tiltY = (x - 0.5) * 12 * touchAmount;
  card.style.setProperty("--rx", tiltX + "deg");
  card.style.setProperty("--ry", tiltY + "deg");
  card.style.setProperty("--mx", (x * 100) + "%");
  card.style.setProperty("--my", (y * 100) + "%");
  card.style.setProperty("--shine-x", (20 + x * 60) + "%");
  card.style.setProperty("--shine-y", (20 + y * 60) + "%");
  card.style.setProperty("--glare", Math.min(0.68, 0.3 + Math.hypot(x - 0.5, y - 0.5) * 0.48));
  card.style.setProperty("--foil-x", (x * 100) + "%");
  card.style.setProperty("--foil-y", (y * 100) + "%");
}

function resetCardFoil(card) {
  card.classList.remove("is-touching");
  card.classList.remove("is-mousing");
  card.style.setProperty("--rx", "0deg");
  card.style.setProperty("--ry", "0deg");
  card.style.setProperty("--mx", "50%");
  card.style.setProperty("--my", "42%");
  card.style.setProperty("--shine-x", "50%");
  card.style.setProperty("--shine-y", "50%");
  card.style.setProperty("--glare", "0");
  card.style.setProperty("--foil-x", "50%");
  card.style.setProperty("--foil-y", "45%");
}

function releaseTouchCard(identifier) {
  const card = activeTouchCards.get(identifier);
  if (!card) return;

  activeTouchCards.delete(identifier);
  if (![...activeTouchCards.values()].includes(card)) {
    resetCardFoil(card);
    stopProjectPad(card);
  }
}

function releaseAllTouchCards() {
  const cards = new Set(activeTouchCards.values());
  activeTouchCards.clear();
  activeTouchPointers.clear();
  for (const card of cards) resetCardFoil(card);
  stopProjectPad();
}

function interactiveAtPointer(pointer) {
  return document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest(".project-card, .github-link") ?? null;
}

function soundIndexForInteractive(interactive) {
  return interactive.classList.contains("github-link") ? 4 : projectCards.indexOf(interactive);
}

function updateTouchCard(pointer) {
  const previousCard = activeTouchCards.get(pointer.pointerId);
  const currentCard = interactiveAtPointer(pointer);

  if (previousCard !== currentCard) {
    activeTouchCards.delete(pointer.pointerId);
    if (previousCard && ![...activeTouchCards.values()].includes(previousCard)) {
      resetCardFoil(previousCard);
      stopProjectPad(previousCard);
    }
    if (currentCard) {
      activeTouchCards.set(pointer.pointerId, currentCard);
      startProjectPad(currentCard, soundIndexForInteractive(currentCard), pointer);
    }
  }

  if (currentCard) {
    currentCard.classList.add("is-touching");
    setCardFoil(currentCard, pointer, 2);
    morphProjectPad(currentCard, pointer);
  }
}

function registerTouchChord() {
  if (new Set(activeTouchCards.values()).size < 2) return;
  touchChordActive = true;
  suppressTouchClicksUntil = Infinity;
}

function startTouchPointer(event) {
  if (event.pointerType !== "touch") return;
  if (activeTouchPointers.size > 0) event.preventDefault();
  lastTouchTime = performance.now();
  activeTouchPointers.add(event.pointerId);
  if (event.target instanceof Element) {
    const captureTarget = event.target.closest(".project-card, .github-link");
    try {
      captureTarget?.setPointerCapture?.(event.pointerId);
    } catch {
      // Global pointer listeners still provide a complete touch lifecycle.
    }
  }
  updateTouchCard(event);
  registerTouchChord();
}

function moveTouchPointer(event) {
  if (event.pointerType !== "touch" || !activeTouchPointers.has(event.pointerId)) return;
  lastTouchTime = performance.now();
  updateTouchCard(event);
  registerTouchChord();
  if (touchChordActive) event.preventDefault();
}

function finishTouchPointer(event) {
  if (event.pointerType !== "touch") return;
  lastTouchTime = performance.now();
  activeTouchPointers.delete(event.pointerId);
  releaseTouchCard(event.pointerId);
  if (activeTouchPointers.size === 0 && touchChordActive) {
    touchChordActive = false;
    suppressTouchClicksUntil = performance.now() + 500;
  }
}

window.addEventListener("pointerdown", startTouchPointer, { passive: false, capture: true });
window.addEventListener("pointermove", moveTouchPointer, { passive: false, capture: true });
window.addEventListener("pointerup", finishTouchPointer, { passive: true, capture: true });
window.addEventListener("pointercancel", finishTouchPointer, { passive: true, capture: true });

document.addEventListener("click", (event) => {
  if (performance.now() >= suppressTouchClicksUntil) return;
  if (!(event.target instanceof Element)) return;
  if (!event.target.closest(".project-card, .github-link")) return;
  event.preventDefault();
  event.stopPropagation();
}, { capture: true });

for (const [cardIndex, card] of projectCards.entries()) {
  card.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") startProjectPad(card, cardIndex, event);
  }, { passive: true });

  card.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "pen") return;

    startProjectPad(card, cardIndex, event);
    card.classList.add("is-touching");
    setCardFoil(card, event, 0.88);
  }, { passive: true });

  card.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" || event.pointerType === "pen") morphProjectPad(card, event);
    if (event.pointerType === "pen" && card.classList.contains("is-touching")) {
      setCardFoil(card, event, 0.88);
    }
  }, { passive: true });

  card.addEventListener("pointerup", (event) => {
    if (event.pointerType === "pen") stopProjectPad(card);
    if (event.pointerType === "pen") resetCardFoil(card);
  }, { passive: true });
  card.addEventListener("pointercancel", (event) => {
    if (event.pointerType === "pen") stopProjectPad(card);
    if (event.pointerType === "pen") resetCardFoil(card);
  }, { passive: true });
  card.addEventListener("lostpointercapture", () => resetCardFoil(card), { passive: true });

  card.addEventListener("mousemove", (event) => {
    if (performance.now() - lastTouchTime < 800) return;
    card.classList.add("is-mousing");
    setCardFoil(card, event);
    morphProjectPad(card, event);
  }, { passive: true });
  card.addEventListener("mouseleave", () => {
    resetCardFoil(card);
    stopProjectPad(card);
  }, { passive: true });
}

const githubLink = document.querySelector(".github-link");
if (githubLink) {
  githubLink.addEventListener("mouseenter", (event) => startProjectPad(githubLink, 4, event), { passive: true });
  githubLink.addEventListener("mousemove", (event) => {
    githubLink.classList.add("is-mousing");
    setCardFoil(githubLink, event);
    morphProjectPad(githubLink, event);
  }, { passive: true });
  githubLink.addEventListener("mouseleave", () => {
    resetCardFoil(githubLink);
    stopProjectPad(githubLink);
  }, { passive: true });
  githubLink.addEventListener("pointerdown", (event) => startProjectPad(githubLink, 4, event), { passive: true });
  githubLink.addEventListener("pointerup", (event) => {
    if (event.pointerType !== "touch") stopProjectPad(githubLink);
  }, { passive: true });
  githubLink.addEventListener("pointercancel", (event) => {
    if (event.pointerType !== "touch") stopProjectPad(githubLink);
  }, { passive: true });
}

window.addEventListener("blur", releaseAllTouchCards);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseAllTouchCards();
});

function startFluidSimulation() {
  if (!canvas) return;

  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
  });

  const floatColorBuffer = gl && (
    gl.getExtension("EXT_color_buffer_float")
    || gl.getExtension("EXT_color_buffer_half_float")
  );

  if (!gl || !floatColorBuffer) {
    canvas.remove();
    return;
  }

  const vertexSource = `#version 300 es
    layout(location = 0) in vec2 a_position;
    out vec2 vUv;

    void main() {
      vUv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const advectionSource = `#version 300 es
    precision highp float;

    in vec2 vUv;
    out vec4 fragColor;

    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 uVelocityTexelSize;
    uniform vec2 uSourceTexelSize;
    uniform float uDt;
    uniform float uDissipation;

    vec4 bilerp(sampler2D source, vec2 uv, vec2 texelSize) {
      vec2 position = uv / texelSize - 0.5;
      vec2 index = floor(position);
      vec2 fraction = fract(position);
      vec2 base = (index + 0.5) * texelSize;

      vec4 bottomLeft = texture(source, base);
      vec4 bottomRight = texture(source, base + vec2(texelSize.x, 0.0));
      vec4 topLeft = texture(source, base + vec2(0.0, texelSize.y));
      vec4 topRight = texture(source, base + texelSize);

      return mix(
        mix(bottomLeft, bottomRight, fraction.x),
        mix(topLeft, topRight, fraction.x),
        fraction.y
      );
    }

    void main() {
      vec2 velocity = bilerp(uVelocity, vUv, uVelocityTexelSize).xy;
      vec2 coordinate = vUv - uDt * velocity * uVelocityTexelSize;
      fragColor = bilerp(uSource, coordinate, uSourceTexelSize) * uDissipation;
    }
  `;

  const splatSource = `#version 300 es
    precision highp float;

    in vec2 vUv;
    out vec4 fragColor;

    uniform sampler2D uTarget;
    uniform vec2 uPoint;
    uniform vec3 uValue;
    uniform float uAspect;
    uniform float uRadius;

    void main() {
      vec2 point = vUv - uPoint;
      point.x *= uAspect;
      float influence = exp(-dot(point, point) / uRadius);
      fragColor = texture(uTarget, vUv) + vec4(uValue * influence, 0.0);
    }
  `;

  const curlSource = `#version 300 es
    precision highp float;

    in vec2 vUv;
    out vec4 fragColor;

    uniform sampler2D uVelocity;
    uniform vec2 uTexelSize;

    void main() {
      float left = texture(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).y;
      float right = texture(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).y;
      float bottom = texture(uVelocity, vUv - vec2(0.0, uTexelSize.y)).x;
      float top = texture(uVelocity, vUv + vec2(0.0, uTexelSize.y)).x;
      fragColor = vec4(0.5 * (right - left - top + bottom), 0.0, 0.0, 1.0);
    }
  `;

  const vorticitySource = `#version 300 es
    precision highp float;

    in vec2 vUv;
    out vec4 fragColor;

    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform vec2 uTexelSize;
    uniform float uCurlStrength;
    uniform float uDt;

    void main() {
      float left = abs(texture(uCurl, vUv - vec2(uTexelSize.x, 0.0)).x);
      float right = abs(texture(uCurl, vUv + vec2(uTexelSize.x, 0.0)).x);
      float bottom = abs(texture(uCurl, vUv - vec2(0.0, uTexelSize.y)).x);
      float top = abs(texture(uCurl, vUv + vec2(0.0, uTexelSize.y)).x);
      float center = texture(uCurl, vUv).x;

      vec2 force = 0.5 * vec2(top - bottom, right - left);
      force /= length(force) + 0.0001;
      force *= uCurlStrength * center;
      force.y *= -1.0;

      vec2 velocity = texture(uVelocity, vUv).xy + force * uDt;
      fragColor = vec4(velocity, 0.0, 1.0);
    }
  `;

  const divergenceSource = `#version 300 es
    precision highp float;

    in vec2 vUv;
    out vec4 fragColor;

    uniform sampler2D uVelocity;
    uniform vec2 uTexelSize;

    void main() {
      vec2 center = texture(uVelocity, vUv).xy;
      vec2 left = texture(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).xy;
      vec2 right = texture(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).xy;
      vec2 bottom = texture(uVelocity, vUv - vec2(0.0, uTexelSize.y)).xy;
      vec2 top = texture(uVelocity, vUv + vec2(0.0, uTexelSize.y)).xy;

      if (vUv.x < uTexelSize.x) left.x = -center.x;
      if (vUv.x > 1.0 - uTexelSize.x) right.x = -center.x;
      if (vUv.y < uTexelSize.y) bottom.y = -center.y;
      if (vUv.y > 1.0 - uTexelSize.y) top.y = -center.y;

      float divergence = 0.5 * (right.x - left.x + top.y - bottom.y);
      fragColor = vec4(divergence, 0.0, 0.0, 1.0);
    }
  `;

  const pressureSource = `#version 300 es
    precision highp float;

    in vec2 vUv;
    out vec4 fragColor;

    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;
    uniform vec2 uTexelSize;

    void main() {
      float left = texture(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
      float right = texture(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
      float bottom = texture(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
      float top = texture(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
      float divergence = texture(uDivergence, vUv).x;
      float pressure = (left + right + bottom + top - divergence) * 0.25;
      fragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
  `;

  const gradientSource = `#version 300 es
    precision highp float;

    in vec2 vUv;
    out vec4 fragColor;

    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;
    uniform vec2 uTexelSize;

    void main() {
      float left = texture(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
      float right = texture(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
      float bottom = texture(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
      float top = texture(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
      vec2 velocity = texture(uVelocity, vUv).xy;
      velocity -= vec2(right - left, top - bottom) * 0.5;
      fragColor = vec4(velocity, 0.0, 1.0);
    }
  `;

  const seedDyeSource = `#version 300 es
    precision highp float;

    in vec2 vUv;
    out vec4 fragColor;

    uniform float uSeed;

    float random(vec2 point) {
      return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
    }

    float noise(vec2 point) {
      vec2 cell = floor(point);
      vec2 fraction = fract(point);
      fraction = fraction * fraction * (3.0 - 2.0 * fraction);

      return mix(
        mix(random(cell), random(cell + vec2(1.0, 0.0)), fraction.x),
        mix(random(cell + vec2(0.0, 1.0)), random(cell + vec2(1.0)), fraction.x),
        fraction.y
      );
    }

    float cloudNoise(vec2 point) {
      float value = 0.0;
      float weight = 0.55;
      for (int octave = 0; octave < 4; octave += 1) {
        value += noise(point) * weight;
        point = point * 2.03 + vec2(3.7, 1.9);
        weight *= 0.48;
      }
      return value;
    }

    void main() {
      vec2 seed = vec2(uSeed, uSeed * 0.618 + 9.7);
      float broadClouds = cloudNoise(vUv * vec2(4.8, 3.8) + seed);
      float fineClouds = cloudNoise(vUv * vec2(9.0, 7.0) + seed * 1.7 + 12.4);
      float cloudShape = smoothstep(0.34, 0.78, broadClouds * 0.76 + fineClouds * 0.24);
      float patchA = cloudNoise(vUv * vec2(2.7, 2.2) + seed * 0.47 + 3.1);
      float patchB = cloudNoise(vUv.yx * vec2(3.4, 2.6) - seed * 0.31 + 17.6);
      float waveA = sin((vUv.x * 2.0 + vUv.y) * 6.283 + uSeed) * 0.34;
      float waveB = sin((-vUv.x + vUv.y * 2.0) * 6.283 - uSeed * 0.73) * 0.22;
      float organicDrift = (patchA * 0.68 + patchB * 0.32 - 0.5) * 0.3;
      float whiteField = waveA + waveB + organicDrift;
      float whiteMix = smoothstep(-0.09, 0.09, whiteField);
      float blueClouds = 0.01 + cloudShape * 0.32;
      float whiteClouds = 0.48 + cloudShape * 0.62;
      float density = mix(blueClouds, whiteClouds, whiteMix);

      fragColor = vec4(density, 0.0, 0.0, 1.0);
    }
  `;

  const displaySource = `#version 300 es
    precision highp float;

    in vec2 vUv;
    out vec4 fragColor;

    uniform sampler2D uDye;
    uniform vec2 uTexelSize;

    float bilerp(sampler2D source, vec2 uv, vec2 texelSize) {
      vec2 position = uv / texelSize - 0.5;
      vec2 index = floor(position);
      vec2 fraction = fract(position);
      vec2 base = (index + 0.5) * texelSize;

      float bottomLeft = texture(source, base).x;
      float bottomRight = texture(source, base + vec2(texelSize.x, 0.0)).x;
      float topLeft = texture(source, base + vec2(0.0, texelSize.y)).x;
      float topRight = texture(source, base + texelSize).x;

      return mix(
        mix(bottomLeft, bottomRight, fraction.x),
        mix(topLeft, topRight, fraction.x),
        fraction.y
      );
    }

    void main() {
      float density = clamp(bilerp(uDye, vUv, uTexelSize), 0.0, 1.4);
      float cloud = smoothstep(0.13, 0.78, density);

      vec3 horizonBlue = vec3(0.54, 0.76, 0.91);
      vec3 highSkyBlue = vec3(0.34, 0.64, 0.86);
      vec3 sky = mix(horizonBlue, highSkyBlue, smoothstep(0.0, 1.0, vUv.y));
      vec3 cloudWhite = vec3(0.98, 0.99, 1.0);
      vec3 color = mix(sky, cloudWhite, 0.035 + cloud * 0.94);

      fragColor = vec4(color, 1.0);
    }
  `;

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(message || "Unable to compile fluid shader.");
    }

    return shader;
  }

  function createProgram(fragmentSource) {
    const vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    const handle = gl.createProgram();
    gl.attachShader(handle, vertexShader);
    gl.attachShader(handle, fragmentShader);
    gl.linkProgram(handle);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(handle) || "Unable to link fluid shader.");
    }

    return { handle, uniforms: Object.create(null) };
  }

  function uniform(program, name) {
    if (!(name in program.uniforms)) {
      program.uniforms[name] = gl.getUniformLocation(program.handle, name);
    }
    return program.uniforms[name];
  }

  function use(program) {
    gl.useProgram(program.handle);
  }

  function bindTexture(program, name, unit, texture) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uniform(program, name), unit);
  }

  const programs = {
    advection: createProgram(advectionSource),
    splat: createProgram(splatSource),
    curl: createProgram(curlSource),
    vorticity: createProgram(vorticitySource),
    divergence: createProgram(divergenceSource),
    pressure: createProgram(pressureSource),
    gradient: createProgram(gradientSource),
    seedDye: createProgram(seedDyeSource),
    display: createProgram(displaySource),
  };
  const initialDyeSeed = Math.random() * 128;

  const vertexArray = gl.createVertexArray();
  const vertexBuffer = gl.createBuffer();
  gl.bindVertexArray(vertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.BLEND);

  function createTarget(width, height, internalFormat, format) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internalFormat,
      width,
      height,
      0,
      format,
      gl.HALF_FLOAT,
      null,
    );

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Unable to create a fluid render target.");
    }

    return {
      texture,
      framebuffer,
      width,
      height,
      texelSizeX: 1 / width,
      texelSizeY: 1 / height,
    };
  }

  function createDoubleTarget(width, height, internalFormat, format) {
    const target = {
      read: createTarget(width, height, internalFormat, format),
      write: createTarget(width, height, internalFormat, format),
      swap() {
        const previous = this.read;
        this.read = this.write;
        this.write = previous;
      },
    };
    return target;
  }

  function destroyTarget(target) {
    if (!target) return;
    gl.deleteTexture(target.texture);
    gl.deleteFramebuffer(target.framebuffer);
  }

  function destroyDoubleTarget(target) {
    if (!target) return;
    destroyTarget(target.read);
    destroyTarget(target.write);
  }

  function clearTarget(target, red = 0) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.clearColor(red, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  function draw(target) {
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function resolution(base) {
    const aspect = Math.max(window.innerWidth, 1) / Math.max(window.innerHeight, 1);
    if (aspect >= 1) {
      return {
        width: Math.min(320, Math.round(base * aspect)),
        height: base,
      };
    }
    return {
      width: base,
      height: Math.min(320, Math.round(base / aspect)),
    };
  }

  let fluid = null;
  let canvasWidth = 0;
  let canvasHeight = 0;

  function initializeTargets() {
    if (fluid) {
      destroyDoubleTarget(fluid.velocity);
      destroyDoubleTarget(fluid.dye);
      destroyDoubleTarget(fluid.pressure);
      destroyTarget(fluid.divergence);
      destroyTarget(fluid.curl);
    }

    const isPhone = window.innerWidth < 600;
    const simulationSize = resolution(isPhone ? 28 : 36);
    const dyeSize = resolution(isPhone ? 40 : 56);

    fluid = {
      velocity: createDoubleTarget(
        simulationSize.width,
        simulationSize.height,
        gl.RGBA16F,
        gl.RGBA,
      ),
      dye: createDoubleTarget(
        dyeSize.width,
        dyeSize.height,
        gl.RGBA16F,
        gl.RGBA,
      ),
      pressure: createDoubleTarget(
        simulationSize.width,
        simulationSize.height,
        gl.RGBA16F,
        gl.RGBA,
      ),
      divergence: createTarget(
        simulationSize.width,
        simulationSize.height,
        gl.RGBA16F,
        gl.RGBA,
      ),
      curl: createTarget(
        simulationSize.width,
        simulationSize.height,
        gl.RGBA16F,
        gl.RGBA,
      ),
    };

    clearTarget(fluid.velocity.read);
    clearTarget(fluid.velocity.write);
    clearTarget(fluid.pressure.read);
    clearTarget(fluid.pressure.write);
    clearTarget(fluid.divergence);
    clearTarget(fluid.curl);
    use(programs.seedDye);
    gl.uniform1f(uniform(programs.seedDye, "uSeed"), initialDyeSeed);
    draw(fluid.dye.read);
    draw(fluid.dye.write);

    pendingSplats.push(
      { x: 0.16, y: 0.32, dx: 28, dy: 8, density: 0, radius: 0.025 },
      { x: 0.52, y: 0.58, dx: -18, dy: 23, density: 0, radius: 0.032 },
      { x: 0.82, y: 0.42, dx: -25, dy: -11, density: 0, radius: 0.026 },
    );
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const nextWidth = Math.max(1, Math.round(window.innerWidth * dpr));
    const nextHeight = Math.max(1, Math.round(window.innerHeight * dpr));
    if (nextWidth === canvasWidth && nextHeight === canvasHeight) return;

    canvasWidth = nextWidth;
    canvasHeight = nextHeight;
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    initializeTargets();
  }

  function applySplat(splat) {
    const program = programs.splat;
    const aspect = window.innerWidth / Math.max(window.innerHeight, 1);

    use(program);
    gl.uniform2f(uniform(program, "uPoint"), splat.x, splat.y);
    gl.uniform1f(uniform(program, "uAspect"), aspect);
    gl.uniform1f(uniform(program, "uRadius"), splat.radius);

    bindTexture(program, "uTarget", 0, fluid.velocity.read.texture);
    gl.uniform3f(uniform(program, "uValue"), splat.dx, splat.dy, 0);
    draw(fluid.velocity.write);
    fluid.velocity.swap();

    bindTexture(program, "uTarget", 0, fluid.dye.read.texture);
    gl.uniform3f(uniform(program, "uValue"), splat.density, 0, 0);
    draw(fluid.dye.write);
    fluid.dye.swap();
  }

  function simulate(dt) {
    const velocity = fluid.velocity;
    const dye = fluid.dye;
    const pressure = fluid.pressure;
    const texelX = velocity.read.texelSizeX;
    const texelY = velocity.read.texelSizeY;

    while (pendingSplats.length) applySplat(pendingSplats.shift());

    let program = programs.curl;
    use(program);
    bindTexture(program, "uVelocity", 0, velocity.read.texture);
    gl.uniform2f(uniform(program, "uTexelSize"), texelX, texelY);
    draw(fluid.curl);

    program = programs.vorticity;
    use(program);
    bindTexture(program, "uVelocity", 0, velocity.read.texture);
    bindTexture(program, "uCurl", 1, fluid.curl.texture);
    gl.uniform2f(uniform(program, "uTexelSize"), texelX, texelY);
    gl.uniform1f(uniform(program, "uCurlStrength"), 7);
    gl.uniform1f(uniform(program, "uDt"), dt);
    draw(velocity.write);
    velocity.swap();

    program = programs.divergence;
    use(program);
    bindTexture(program, "uVelocity", 0, velocity.read.texture);
    gl.uniform2f(uniform(program, "uTexelSize"), texelX, texelY);
    draw(fluid.divergence);

    clearTarget(pressure.read);
    clearTarget(pressure.write);

    program = programs.pressure;
    use(program);
    bindTexture(program, "uDivergence", 1, fluid.divergence.texture);
    gl.uniform2f(uniform(program, "uTexelSize"), texelX, texelY);

    for (let iteration = 0; iteration < 6; iteration += 1) {
      bindTexture(program, "uPressure", 0, pressure.read.texture);
      draw(pressure.write);
      pressure.swap();
    }

    program = programs.gradient;
    use(program);
    bindTexture(program, "uPressure", 0, pressure.read.texture);
    bindTexture(program, "uVelocity", 1, velocity.read.texture);
    gl.uniform2f(uniform(program, "uTexelSize"), texelX, texelY);
    draw(velocity.write);
    velocity.swap();

    program = programs.advection;
    use(program);
    bindTexture(program, "uVelocity", 0, velocity.read.texture);
    bindTexture(program, "uSource", 1, velocity.read.texture);
    gl.uniform2f(
      uniform(program, "uVelocityTexelSize"),
      velocity.read.texelSizeX,
      velocity.read.texelSizeY,
    );
    gl.uniform2f(
      uniform(program, "uSourceTexelSize"),
      velocity.read.texelSizeX,
      velocity.read.texelSizeY,
    );
    gl.uniform1f(uniform(program, "uDt"), dt * 0.72);
    gl.uniform1f(uniform(program, "uDissipation"), 0.985);
    draw(velocity.write);
    velocity.swap();

    bindTexture(program, "uVelocity", 0, velocity.read.texture);
    bindTexture(program, "uSource", 1, dye.read.texture);
    gl.uniform2f(
      uniform(program, "uVelocityTexelSize"),
      velocity.read.texelSizeX,
      velocity.read.texelSizeY,
    );
    gl.uniform2f(
      uniform(program, "uSourceTexelSize"),
      dye.read.texelSizeX,
      dye.read.texelSizeY,
    );
    gl.uniform1f(uniform(program, "uDt"), dt * 0.72);
    gl.uniform1f(uniform(program, "uDissipation"), 0.9985);
    draw(dye.write);
    dye.swap();
  }

  function display() {
    const program = programs.display;
    use(program);
    bindTexture(program, "uDye", 0, fluid.dye.read.texture);
    gl.uniform2f(
      uniform(program, "uTexelSize"),
      fluid.dye.read.texelSizeX,
      fluid.dye.read.texelSizeY,
    );
    draw(null);
  }

  let frameRequest = 0;
  let lastFrame = performance.now();
  let lastDraw = -Infinity;
  let lastAutomaticSplat = -Infinity;
  let automaticPhase = 0;
  let firstFrame = true;
  const frameInterval = 1000 / 30;

  function schedule() {
    if (!frameRequest && !document.hidden) {
      frameRequest = requestAnimationFrame(frame);
    }
  }

  function frame(now) {
    frameRequest = 0;

    if (now - lastDraw < frameInterval) {
      schedule();
      return;
    }

    const dt = clamp((now - lastFrame) / 1000, 0.008, 0.033);
    lastFrame = now;
    lastDraw = now;

    try {
      resize();

      if (now - lastAutomaticSplat > 1800) {
        automaticPhase += 0.72;
        queueSplat({
          x: 0.5 + Math.sin(automaticPhase) * 0.34,
          y: 0.5 + Math.cos(automaticPhase * 0.83) * 0.24,
          dx: Math.cos(automaticPhase) * 24,
          dy: -Math.sin(automaticPhase * 0.83) * 18,
          density: Math.cos(automaticPhase) * 0.18,
          radius: 0.016,
        });
        lastAutomaticSplat = now;
      }

      simulate(dt);
      display();

      if (firstFrame) {
        firstFrame = false;
        document.body.classList.add("webgl-ready");
      }
    } catch {
      canvas.remove();
      return;
    }

    schedule();
  }

  requestFluidFrame = schedule;

  window.addEventListener("resize", schedule, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      lastFrame = performance.now();
      schedule();
    }
  });

  schedule();
}

try {
  startFluidSimulation();
} catch {
  canvas?.remove();
}
