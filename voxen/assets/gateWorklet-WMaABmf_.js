// Voice gate AudioWorklet (v0.15.0, fix round 1).
// The voice activity (VAD) decision is made on the audio thread: even when the main thread slows down in the
// background (tab hidden, game in front, timer throttling) the gate opens and closes without delay.
//
// Inputs: 0 = measurement (RAW microphone audio), 1 = audio to send (after the pre-roll). Output: gated audio.
// Port messages (from the main thread): { allowed, vad, threshold, hangoverSec, preRollSec } (all optional)
//   allowed: not muted / not deafened (and in push-to-talk the key is held). If false the gate is always closed.
//   vad    : voice activity detection on. If on, gate = allowed AND (level above threshold or hangover not over).
// Port message (to the main thread): { type: 'vad', open } only when the VAD state changes.
// This file is standalone (no imports): the build copies it as is and it is loaded with addModule.

export const GATE_PROCESSOR_NAME = 'voxen-gate'
const WINDOW_BLOCKS = 8 // RMS over 8 x 128 = 1024 samples (≈21 ms): same window as the old AnalyserNode measurement
const RAMP_SEC = 0.005 // gain ramp (no clicks)

// Pure logic (used directly by tests). block(measure, audio, out, timeSec) is called on every render quantum.
// Fix round 2:
//   - The sent audio lags behind by the pre-roll (preRollSec), while the gate decides on undelayed audio. So the
//     closing condition is "hangover + pre-roll"; otherwise word endings would be cut by the pre-roll.
//   - When allowed goes false -> true (mute/deafen lifted), the gate stays closed until the pre-roll has passed.
//     The delay line still holds audio spoken while muted; it must not go out. When the pre-roll changes we wait
//     the same way (the larger of the old and new value), so a sudden delay change is not heard as a click or repeat.
//   - The gate starts closed (allowed = false); it has to be allowed explicitly.
export class GateLogic {
  constructor({ sampleRate = 48000, notify = () => {} } = {}) {
    this.sampleRate = sampleRate
    this.notify = notify
    this.allowed = false
    this.vad = false
    this.threshold = 0.02
    this.hangoverSec = 0.7
    this.preRollSec = 0
    this.isOpen = false // VAD state
    this.lastLoud = -Infinity
    this.now = 0 // time of the last processed block
    this.holdUntil = -Infinity // gate forced closed until this time (R2)
    this.gain = 0
    this.energies = new Float64Array(WINDOW_BLOCKS)
    this.index = 0
    this.step = 1 - Math.exp(-1 / (RAMP_SEC * sampleRate))
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
    if (typeof a.vad === 'boolean' && a.vad !== this.vad) {
      this.vad = a.vad
      if (!this.vad && this.isOpen) { this.isOpen = false; this.notify(false) }
    }
  }

  // RMS level of the last ~21 ms
  level() {
    let sum = 0
    for (const e of this.energies) sum += e
    return Math.sqrt(sum / WINDOW_BLOCKS)
  }

  target() {
    if (!this.allowed || this.now < this.holdUntil) return 0
    return !this.vad || this.isOpen ? 1 : 0
  }

  block(measure, audio, out, timeSec) {
    this.now = timeSec
    let e = 0
    const n = measure?.length ?? 0
    for (let i = 0; i < n; i++) e += measure[i] * measure[i]
    this.energies[this.index] = n ? e / n : 0
    this.index = (this.index + 1) % WINDOW_BLOCKS
    if (this.vad) {
      if (this.level() >= this.threshold) {
        this.lastLoud = timeSec
        if (!this.isOpen) { this.isOpen = true; this.notify(true) }
      } else if (this.isOpen && timeSec - this.lastLoud >= this.hangoverSec + this.preRollSec) {
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
