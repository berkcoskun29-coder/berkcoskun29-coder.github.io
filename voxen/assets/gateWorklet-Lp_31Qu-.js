// Voice gate AudioWorklet (v0.15.0, fix round 1).
// The voice activity (VAD) decision is made on the audio thread: even when the main thread slows down in the
// background (tab hidden, game in front, timer throttling) the gate opens and closes without delay.
//
// Inputs: 0 = measurement (RAW microphone audio), 1 = audio to send (after the pre-roll). Output: gated audio.
// Port messages (from the main thread): { allowed, vad, speechOnly, threshold, hangoverSec, preRollSec } (all optional)
//   allowed   : not muted / not deafened (and in push-to-talk the key is held). If false the gate is always closed.
//   vad       : voice activity detection on. If on, gate = allowed AND (voice detected or hangover not over).
//   speechOnly: v0.29.8 "Klavye seslerini bastır". Voice = loud AND speech-like (SpeechDetector below); off = loud only.
// Port message (to the main thread): { type: 'vad', open } only when the VAD state changes.
// This file is standalone (no imports): the build copies it as is and it is loaded with addModule.
// The audio thread must not allocate: every buffer is created in a constructor, process() only reuses them.

export const GATE_PROCESSOR_NAME = 'voxen-gate'
const WINDOW_BLOCKS = 8 // RMS over 8 x 128 = 1024 samples (≈21 ms): same window as the old AnalyserNode measurement
const RAMP_SEC = 0.005 // gain ramp (no clicks)

// ---- Speech detector (v0.29.8) ----
// Neither noise engine exposes a speech score (DeepFilterNet's df_process_frame returns only the cleaned frame,
// the RNNoise worklet drops its VAD value), so the gate decides itself from the raw microphone audio.
// A hop (≈10.7 ms) counts as speech when all three hold:
//   1. loud      : the ≈21 ms RMS is above the user's threshold (sensitivity and auto sensitivity keep working);
//   2. steady    : the energy is spread over the ≈21 ms window, not packed into one or two blocks (a key click is);
//   3. periodic  : voiced speech repeats at its pitch (60–400 Hz); a click or a hiss does not.
// The gate opens only after SPEECH_MIN_HOPS speech hops within the last SPEECH_WINDOW_HOPS (≈64 of ≈85 ms), so one
// click or a typing burst cannot open it. The ≈0.1 s this takes is covered by the 200 ms pre-roll (tested).
// While open, a speech hop restarts the hangover only if HOLD_MIN_HOPS of the window are speech: a resonant key
// ("thock") can pass as one speech hop, and typing right after talking must not keep the gate open forever.
export const HOP_BLOCKS = 4 // features are computed every 4 x 128 samples (≈10.7 ms)
export const SPEECH_WINDOW_HOPS = 8
export const SPEECH_MIN_HOPS = 6
export const HOLD_MIN_HOPS = 3
export const VOICING_MIN = 0.5 // normalized autocorrelation peak at the pitch lag (1 = perfectly periodic)
export const IMPULSE_CREST_MAX = 4 // max block energy / mean block energy over the RMS window (8 = all in one block)
const DETECT_RATE = 8000 // the pitch search runs on decimated audio: 8 kHz is plenty below 1 kHz
const PITCH_LOWPASS_HZ = 1000 // formants above this make false pitch peaks
const RUMBLE_HIGHPASS_HZ = 70 // DC and rumble would look "periodic" at every lag
const PITCH_MIN_HZ = 60
const PITCH_MAX_HZ = 400
const ANALYSIS_SEC = 0.04 // two periods of the lowest pitch fit in the window
const SILENCE_ENERGY = 1e-10 // a silent window has no pitch (avoids dividing by ~0)
const DENORMAL = 1e-20 // filter states below this are flushed: denormals are slow on the audio thread

// Second order IIR filter (RBJ cookbook, Butterworth Q). Direct form I; the state lives on the instance.
class Biquad {
  constructor(kind, hz, sampleRate) {
    const w = (2 * Math.PI * hz) / sampleRate
    const cos = Math.cos(w)
    const alpha = Math.sin(w) / (2 * Math.SQRT1_2)
    const a0 = 1 + alpha
    const edge = kind === 'lowpass' ? (1 - cos) / 2 : (1 + cos) / 2
    this.b0 = edge / a0
    this.b1 = (kind === 'lowpass' ? 1 - cos : -(1 + cos)) / a0
    this.b2 = edge / a0
    this.a1 = (-2 * cos) / a0
    this.a2 = (1 - alpha) / a0
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0
  }

  step(x) {
    let y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    if (y < DENORMAL && y > -DENORMAL) y = 0
    this.x2 = this.x1; this.x1 = x
    this.y2 = this.y1; this.y1 = y
    return y
  }
}

// How impulsive the last ≈21 ms is: max / mean of the block energies (1 = perfectly even, WINDOW_BLOCKS = one block)
export function energyCrest(energies) {
  let sum = 0
  let max = 0
  for (let i = 0; i < energies.length; i++) {
    sum += energies[i]
    if (energies[i] > max) max = energies[i]
  }
  return sum > 0 ? (max * energies.length) / sum : 0
}

// Pitch strength of the raw microphone audio. addBlock() band-limits (70 Hz–1 kHz) and decimates every block into a
// ring; periodicity() returns the highest normalized autocorrelation over the pitch lags of the last ANALYSIS_SEC.
export class SpeechDetector {
  constructor({ sampleRate = 48000 } = {}) {
    this.factor = Math.max(1, Math.round(sampleRate / DETECT_RATE))
    const rate = sampleRate / this.factor
    this.size = Math.round(ANALYSIS_SEC * rate)
    this.minLag = Math.max(1, Math.floor(rate / PITCH_MAX_HZ))
    this.maxLag = Math.min(this.size >> 1, Math.ceil(rate / PITCH_MIN_HZ))
    this.highpass = new Biquad('highpass', RUMBLE_HIGHPASS_HZ, sampleRate)
    // Two low-pass stages (4th order) so clicks above 4 kHz do not fold back into the pitch band
    this.lowpass1 = new Biquad('lowpass', PITCH_LOWPASS_HZ, sampleRate)
    this.lowpass2 = new Biquad('lowpass', PITCH_LOWPASS_HZ, sampleRate)
    this.ring = new Float32Array(this.size)
    this.write = 0
    this.phase = 0
    this.frame = new Float32Array(this.size) // the ring unrolled, oldest sample first
    this.squares = new Float64Array(this.size + 1) // prefix sums of frame² (segment energies in O(1))
  }

  addBlock(samples) {
    const n = samples?.length ?? 0
    for (let i = 0; i < n; i++) {
      const y = this.lowpass2.step(this.lowpass1.step(this.highpass.step(samples[i])))
      if (++this.phase < this.factor) continue
      this.phase = 0
      this.ring[this.write] = y
      this.write = this.write + 1 === this.size ? 0 : this.write + 1
    }
  }

  periodicity() {
    const { size, frame, squares, ring } = this
    let k = this.write
    squares[0] = 0
    for (let i = 0; i < size; i++) {
      const v = ring[k]
      frame[i] = v
      squares[i + 1] = squares[i] + v * v
      k = k + 1 === size ? 0 : k + 1
    }
    if (squares[size] <= SILENCE_ENERGY) return 0
    let best = 0
    for (let lag = this.minLag; lag <= this.maxLag; lag++) {
      const n = size - lag
      let r = 0
      for (let i = 0; i < n; i++) r += frame[i] * frame[i + lag]
      if (r <= 0) continue
      // Energy of the two overlapping parts: scale-free, so a quiet voice scores like a loud one
      const energy = squares[n] * (squares[size] - squares[lag])
      if (energy > SILENCE_ENERGY) {
        const c = r / Math.sqrt(energy)
        if (c > best) best = c
      }
    }
    return best
  }
}

// Pure logic (used directly by tests). block(measure, audio, out, timeSec) is called on every render quantum.
// Fix round 2:
//   - The sent audio lags behind by the pre-roll (preRollSec), while the gate decides on undelayed audio. So the
//     closing condition is "hangover + pre-roll"; otherwise word endings would be cut by the pre-roll.
//   - When allowed goes false -> true (mute/deafen lifted), the gate stays closed until the pre-roll has passed.
//     The delay line still holds audio spoken while muted; it must not go out. When the pre-roll changes we wait
//     the same way (the larger of the old and new value), so a sudden delay change is not heard as a click or repeat.
//   - The gate starts closed (allowed = false); it has to be allowed explicitly.
// v0.29.8: with speechOnly only speech hops open the gate and restart the hangover; key clicks in a pause do not,
// so the gate closes after the hangover even while typing goes on.
export class GateLogic {
  constructor({ sampleRate = 48000, notify = () => {} } = {}) {
    this.sampleRate = sampleRate
    this.notify = notify
    this.allowed = false
    this.vad = false
    this.speechOnly = false
    this.threshold = 0.02
    this.hangoverSec = 0.7
    this.preRollSec = 0
    this.isOpen = false // VAD state
    this.lastVoice = -Infinity // time of the last block/hop that counted as voice
    this.now = 0 // time of the last processed block
    this.holdUntil = -Infinity // gate forced closed until this time (R2)
    this.gain = 0
    this.energies = new Float64Array(WINDOW_BLOCKS)
    this.index = 0
    this.step = 1 - Math.exp(-1 / (RAMP_SEC * sampleRate))
    this.detector = new SpeechDetector({ sampleRate })
    this.hops = new Uint8Array(SPEECH_WINDOW_HOPS) // 1 = that hop was speech
    this.hopIndex = 0
    this.speechHops = 0 // number of ones in hops
    this.blockInHop = 0
  }

  configure(a = {}) {
    if (typeof a.preRollSec === 'number' && Number.isFinite(a.preRollSec)) {
      const next = Math.max(0, a.preRollSec)
      if (next !== this.preRollSec) {
        this.holdUntil = Math.max(this.holdUntil, this.now + Math.max(next, this.preRollSec))
        this.preRollSec = next
      }
    }
    if (typeof a.allowed === 'boolean') {
      if (a.allowed && !this.allowed) this.holdUntil = Math.max(this.holdUntil, this.now + this.preRollSec)
      this.allowed = a.allowed
    }
    if (typeof a.threshold === 'number' && Number.isFinite(a.threshold)) this.threshold = a.threshold
    if (typeof a.hangoverSec === 'number' && Number.isFinite(a.hangoverSec)) this.hangoverSec = Math.max(0, a.hangoverSec)
    if (typeof a.speechOnly === 'boolean' && a.speechOnly !== this.speechOnly) {
      this.speechOnly = a.speechOnly
      this.resetHops()
    }
    if (typeof a.vad === 'boolean' && a.vad !== this.vad) {
      this.vad = a.vad
      if (!this.vad && this.isOpen) { this.isOpen = false; this.notify(false) }
    }
  }

  // RMS level of the last ~21 ms (index loop: for...of would create an iterator on the audio thread)
  level() {
    let sum = 0
    for (let i = 0; i < WINDOW_BLOCKS; i++) sum += this.energies[i]
    return Math.sqrt(sum / WINDOW_BLOCKS)
  }

  target() {
    if (!this.allowed || this.now < this.holdUntil) return 0
    return !this.vad || this.isOpen ? 1 : 0
  }

  resetHops() {
    this.hops.fill(0)
    this.speechHops = 0
    this.blockInHop = 0
  }

  // Cheap checks first: the pitch search runs only on loud, steady hops
  isSpeechHop() {
    if (this.level() < this.threshold) return false
    if (energyCrest(this.energies) > IMPULSE_CREST_MAX) return false
    return this.detector.periodicity() >= VOICING_MIN
  }

  // Records one hop; true if it is speech with enough speech around it (more to open than to stay open)
  speechHopCounts() {
    const isSpeech = this.isSpeechHop() ? 1 : 0
    this.speechHops += isSpeech - this.hops[this.hopIndex]
    this.hops[this.hopIndex] = isSpeech
    this.hopIndex = (this.hopIndex + 1) % SPEECH_WINDOW_HOPS
    return isSpeech === 1 && this.speechHops >= (this.isOpen ? HOLD_MIN_HOPS : SPEECH_MIN_HOPS)
  }

  // Is there voice in this block? Loudness only, or (speechOnly) the speech decision once per hop
  hasVoice(measure) {
    if (!this.speechOnly) return this.level() >= this.threshold
    this.detector.addBlock(measure)
    if (++this.blockInHop < HOP_BLOCKS) return false
    this.blockInHop = 0
    return this.speechHopCounts()
  }

  block(measure, audio, out, timeSec) {
    this.now = timeSec
    let e = 0
    const n = measure?.length ?? 0
    for (let i = 0; i < n; i++) e += measure[i] * measure[i]
    this.energies[this.index] = n ? e / n : 0
    this.index = (this.index + 1) % WINDOW_BLOCKS
    if (this.vad) {
      if (this.hasVoice(measure)) {
        this.lastVoice = timeSec
        if (!this.isOpen) { this.isOpen = true; this.notify(true) }
      } else if (this.isOpen && timeSec - this.lastVoice >= this.hangoverSec + this.preRollSec) {
        this.isOpen = false
        this.notify(false)
      }
    }
    if (!out) return
    const target = this.target()
    for (let i = 0; i < out.length; i++) {
      this.gain += (target - this.gain) * this.step
      out[i] = (audio ? audio[i] ?? 0 : 0) * this.gain
    }
  }
}

/* global AudioWorkletProcessor, registerProcessor, sampleRate, currentTime */
if (typeof AudioWorkletProcessor !== 'undefined' && typeof registerProcessor === 'function') {
  class GateProcessor extends AudioWorkletProcessor {
    constructor() {
      super()
      this.logic = new GateLogic({ sampleRate, notify: (open) => this.port.postMessage({ type: 'vad', open }) })
      this.port.onmessage = (e) => this.logic.configure(e.data)
    }

    process(inputs, outputs) {
      this.logic.block(inputs[0]?.[0], inputs[1]?.[0], outputs[0]?.[0], currentTime)
      return true
    }
  }
  registerProcessor(GATE_PROCESSOR_NAME, GateProcessor)
}
