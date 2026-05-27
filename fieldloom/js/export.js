export async function exportPng(canvas, status = () => {}, options = {}) {
  const blob = await canvasToBlob(canvas, "image/png");
  downloadBlob(blob, `field-loom-${timestamp()}.png`);
  status("PNG exported.");
}

export async function exportWebm(canvas, options, status = () => {}) {
  if (!canvas.captureStream || !window.MediaRecorder) {
    throw new Error("WebM export is not supported in this browser.");
  }
  const fps = Number(options.fps) || 30;
  const duration = Math.max(1, Number(options.duration) || 8);
  const mimeType = pickWebmMimeType();
  const canvasStream = canvas.captureStream(fps);
  const audioTracks = options.audioStream?.getAudioTracks?.().filter((track) => track.readyState === "live") || [];
  const stream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioTracks
  ]);
  const recorderOptions = {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: Number(options.videoBitsPerSecond) || 24_000_000
  };
  if (audioTracks.length) {
    recorderOptions.audioBitsPerSecond = Number(options.audioBitsPerSecond) || 192_000;
  }
  try {
    const recorder = new MediaRecorder(stream, recorderOptions);
    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };
    const done = new Promise((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(recorder.error || new Error("Recording failed."));
    });
    recorder.start();
    status(`Recording ${duration}s WebM${audioTracks.length ? " with mic audio" : ""}...`);
    await wait(duration * 1000);
    recorder.stop();
    await done;
    const blob = new Blob(chunks, { type: mimeType || "video/webm" });
    downloadBlob(blob, `field-loom-${timestamp()}.webm`);
    status("WebM exported.");
  } finally {
    for (const track of canvasStream.getTracks()) {
      track.stop();
    }
  }
}

export function downloadText(text, filename, type = "application/json") {
  downloadBlob(new Blob([text], { type }), filename);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function canvasToBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not encode canvas."));
    }, type);
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function pickWebmMimeType() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm"
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "";
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
