export class AudioManager {
  constructor(status = () => {}) {
    this.status = status;
    this.context = null;
    this.analyser = null;
    this.stream = null;
    this.selectedDeviceId = "";
    this.devices = [];
    this.permissionGranted = false;
    this.frequencyData = null;
    this.timeData = null;
    this.lastLevel = 0;
    this.beat = 0;
    this.features = {
      level: 0,
      bass: 0,
      mids: 0,
      treble: 0,
      focus: 0,
      beat: 0
    };
  }

  async requestPermission() {
    if (this.permissionGranted) return true;
    if (this.stream) {
      this.permissionGranted = true;
      return true;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone capture is not supported in this browser.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    this.permissionGranted = true;
    return true;
  }

  async listInputDevices({ requestPermission = false } = {}) {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    if (requestPermission) {
      await this.requestPermission();
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    this.devices = devices
      .filter((device) => device.kind === "audioinput")
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Microphone ${index + 1}`
      }));
    return this.devices;
  }

  async enable(deviceId = this.selectedDeviceId) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone capture is not supported in this browser.");
    }
    this.disable(false);
    this.selectedDeviceId = deviceId || "";
    const audio = this.selectedDeviceId ? { deviceId: { exact: this.selectedDeviceId } } : true;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio });
    this.permissionGranted = true;
    this.context = new AudioContext();
    const source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.78;
    source.connect(this.analyser);
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);
    await this.listInputDevices().catch(() => []);
    this.status("Microphone audio enabled.");
  }

  async setDevice(deviceId) {
    this.selectedDeviceId = deviceId || "";
    if (this.stream) {
      await this.enable(this.selectedDeviceId);
    }
  }

  getRecordingStream() {
    if (!this.stream) return null;
    const liveTracks = this.stream.getAudioTracks().filter((track) => track.readyState === "live");
    return liveTracks.length ? this.stream : null;
  }

  disable(announce = true) {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
    }
    if (this.context) {
      this.context.close().catch(() => {});
    }
    this.context = null;
    this.analyser = null;
    this.stream = null;
    this.frequencyData = null;
    this.timeData = null;
    this.features = { level: 0, bass: 0, mids: 0, treble: 0, focus: 0, beat: 0 };
    if (announce) this.status("Microphone audio disabled.");
  }

  update() {
    if (!this.analyser || !this.frequencyData || !this.timeData) return this.features;
    this.analyser.getByteFrequencyData(this.frequencyData);
    this.analyser.getByteTimeDomainData(this.timeData);

    let sum = 0;
    for (const sample of this.timeData) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / this.timeData.length);
    const bass = bandAverage(this.frequencyData, 0.00, 0.10);
    const mids = bandAverage(this.frequencyData, 0.10, 0.44);
    const treble = bandAverage(this.frequencyData, 0.44, 1.0);
    const focus = bandAverage(this.frequencyData, 0.18, 0.28);
    const attack = Math.max(0, rms - this.lastLevel);
    this.beat = Math.max(this.beat * 0.88, attack * 6);
    this.lastLevel = rms * 0.86 + this.lastLevel * 0.14;
    this.features = {
      level: clamp(rms * 2.8, 0, 1),
      bass,
      mids,
      treble,
      focus,
      beat: clamp(this.beat, 0, 1)
    };
    return this.features;
  }
}

function bandAverage(data, start, end) {
  const first = Math.max(0, Math.floor(data.length * start));
  const last = Math.min(data.length - 1, Math.floor(data.length * end));
  let sum = 0;
  let count = 0;
  for (let i = first; i <= last; i += 1) {
    sum += data[i] / 255;
    count += 1;
  }
  return count ? clamp(sum / count, 0, 1) : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
