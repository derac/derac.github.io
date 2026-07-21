const canvas = document.querySelector("#liquid-light");

const pendingSplats = [];
const pointerState = new Map();
const pointerDyePolarity = new Map();
const activeTouchCards = new Map();
const activeTouchPointers = new Set();
let lastTouchTime = -Infinity;
let requestFluidFrame = () => {};
let touchDyePolarity = 1;
let mouseDyePolarity = 1;
let touchTravelSinceDyeChange = 0;
let mouseTravelSinceDyeChange = 0;
let clickAudioContext;
let clickNoiseBuffer;

const MOUSE_DYE_CHANGE_DISTANCE = 220;
const TOUCH_DYE_CHANGE_DISTANCE = 120;
const TOUCH_SPLAT_SPACING = 14;

function dyeDensity(polarity, strength = 1) {
  return (polarity > 0 ? 0.36 : -0.35) * strength;
}

function playRumblyClick() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  clickAudioContext ??= new AudioContextClass();
  if (clickAudioContext.state === "suspended") clickAudioContext.resume();

  const now = clickAudioContext.currentTime;
  const master = clickAudioContext.createGain();
  const thump = clickAudioContext.createOscillator();
  const thumpGain = clickAudioContext.createGain();
  const noise = clickAudioContext.createBufferSource();
  const noiseFilter = clickAudioContext.createBiquadFilter();
  const noiseGain = clickAudioContext.createGain();

  if (!clickNoiseBuffer) {
    clickNoiseBuffer = clickAudioContext.createBuffer(1, Math.ceil(clickAudioContext.sampleRate * 0.12), clickAudioContext.sampleRate);
    const samples = clickNoiseBuffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.random() * 2 - 1;
    }
  }

  master.gain.setValueAtTime(0.38, now);
  thump.type = "triangle";
  thump.frequency.setValueAtTime(92, now);
  thump.frequency.exponentialRampToValueAtTime(42, now + 0.11);
  thumpGain.gain.setValueAtTime(0.0001, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.3, now + 0.006);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);

  noise.buffer = clickNoiseBuffer;
  noiseFilter.type = "lowpass";
  noiseFilter.frequency.setValueAtTime(220, now);
  noiseFilter.Q.setValueAtTime(0.8, now);
  noiseGain.gain.setValueAtTime(0.11, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);

  thump.connect(thumpGain).connect(master);
  noise.connect(noiseFilter).connect(noiseGain).connect(master);
  master.connect(clickAudioContext.destination);
  thump.start(now);
  noise.start(now);
  thump.stop(now + 0.14);
  noise.stop(now + 0.08);
}

for (const link of document.querySelectorAll("a[href]")) {
  link.addEventListener("pointerdown", (event) => {
    if (event.button === 0) playRumblyClick();
  }, { passive: true });
  link.addEventListener("keydown", (event) => {
    if (event.key === "Enter") playRumblyClick();
  });
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

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

  card.style.setProperty("--tilt-x", ((0.5 - y) * 10 * touchAmount) + "deg");
  card.style.setProperty("--tilt-y", ((x - 0.5) * 12 * touchAmount) + "deg");
  card.style.setProperty("--foil-x", (x * 100) + "%");
  card.style.setProperty("--foil-y", (y * 100) + "%");
}

function resetCardFoil(card) {
  card.classList.remove("is-touching");
  card.classList.remove("is-mousing");
  card.style.setProperty("--tilt-x", "0deg");
  card.style.setProperty("--tilt-y", "0deg");
  card.style.setProperty("--foil-x", "50%");
  card.style.setProperty("--foil-y", "45%");
}

function releaseTouchCard(identifier) {
  const card = activeTouchCards.get(identifier);
  if (!card) return;

  activeTouchCards.delete(identifier);
  if (![...activeTouchCards.values()].includes(card)) resetCardFoil(card);
}

function releaseAllTouchCards() {
  const cards = new Set(activeTouchCards.values());
  activeTouchCards.clear();
  activeTouchPointers.clear();
  for (const card of cards) resetCardFoil(card);
}

function cardAtPointer(pointer) {
  return document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest(".project-card") ?? null;
}

function updateTouchCard(pointer) {
  const previousCard = activeTouchCards.get(pointer.pointerId);
  const currentCard = cardAtPointer(pointer);

  if (previousCard !== currentCard) {
    activeTouchCards.delete(pointer.pointerId);
    if (previousCard && ![...activeTouchCards.values()].includes(previousCard)) {
      resetCardFoil(previousCard);
    }
    if (currentCard) activeTouchCards.set(pointer.pointerId, currentCard);
  }

  if (currentCard) {
    currentCard.classList.add("is-touching");
    setCardFoil(currentCard, pointer, 2);
  }
}

function startTouchPointer(event) {
  if (event.pointerType !== "touch") return;
  lastTouchTime = performance.now();
  activeTouchPointers.add(event.pointerId);
  updateTouchCard(event);
}

function moveTouchPointer(event) {
  if (event.pointerType !== "touch" || !activeTouchPointers.has(event.pointerId)) return;
  lastTouchTime = performance.now();
  updateTouchCard(event);
}

function finishTouchPointer(event) {
  if (event.pointerType !== "touch") return;
  lastTouchTime = performance.now();
  activeTouchPointers.delete(event.pointerId);
  releaseTouchCard(event.pointerId);
}

window.addEventListener("pointerdown", startTouchPointer, { passive: true, capture: true });
window.addEventListener("pointermove", moveTouchPointer, { passive: true, capture: true });
window.addEventListener("pointerup", finishTouchPointer, { passive: true, capture: true });
window.addEventListener("pointercancel", finishTouchPointer, { passive: true, capture: true });

for (const card of document.querySelectorAll(".project-card")) {
  card.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "pen") return;

    card.classList.add("is-touching");
    setCardFoil(card, event, 0.88);
  }, { passive: true });

  card.addEventListener("pointermove", (event) => {
    if (event.pointerType === "pen" && card.classList.contains("is-touching")) {
      setCardFoil(card, event, 0.88);
    }
  }, { passive: true });

  card.addEventListener("pointerup", (event) => {
    if (event.pointerType === "pen") resetCardFoil(card);
  }, { passive: true });
  card.addEventListener("pointercancel", (event) => {
    if (event.pointerType === "pen") resetCardFoil(card);
  }, { passive: true });
  card.addEventListener("lostpointercapture", () => resetCardFoil(card), { passive: true });

  card.addEventListener("mousemove", (event) => {
    if (performance.now() - lastTouchTime < 800) return;
    card.classList.add("is-mousing");
    setCardFoil(card, event);
  }, { passive: true });
  card.addEventListener("mouseleave", () => resetCardFoil(card), { passive: true });
}

const githubLink = document.querySelector(".github-link");
if (githubLink) {
  githubLink.addEventListener("mousemove", (event) => {
    githubLink.classList.add("is-mousing");
    setCardFoil(githubLink, event, 0.82);
  }, { passive: true });
  githubLink.addEventListener("mouseleave", () => resetCardFoil(githubLink), { passive: true });
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
