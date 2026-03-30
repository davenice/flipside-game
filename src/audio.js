const LAMBDA_URL = import.meta.env.VITE_LAMBDA_URL

let audioCtx = null

function getCtx() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext()
  }
  // Resume if suspended (autoplay policy)
  if (audioCtx.state === 'suspended') audioCtx.resume()
  return audioCtx
}

// ── TTS + reversal ────────────────────────────────────────────────────────────

export function reverseBuffer(buffer) {
  const ctx = getCtx()
  const reversed = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    reversed.copyToChannel(buffer.getChannelData(ch).slice().reverse(), ch)
  }
  return reversed
}

export async function fetchTTS(lyric, rate) {
  const res = await fetch(LAMBDA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: lyric, voice: 'Joanna', ...(rate !== undefined && { rate }) }),
  })
  if (!res.ok) throw new Error(`Lambda error: ${res.status}`)

  const arrayBuffer = await res.arrayBuffer()
  const ctx = getCtx()
  const original = await ctx.decodeAudioData(arrayBuffer)
  return { original, reversed: reverseBuffer(original) }
}

// ── Playback ──────────────────────────────────────────────────────────────────

let currentSource = null

export function playBuffer(buffer, { onTimeUpdate, onEnded } = {}) {
  stopCurrent()
  const ctx = getCtx()
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)

  const duration = buffer.duration
  const startTime = ctx.currentTime
  currentSource = source

  let rafId
  function tick() {
    const elapsed = Math.min(ctx.currentTime - startTime, duration)
    onTimeUpdate?.(elapsed, duration)
    if (elapsed < duration) {
      rafId = requestAnimationFrame(tick)
    }
  }

  source.onended = () => {
    cancelAnimationFrame(rafId)
    onTimeUpdate?.(duration, duration)
    onEnded?.()
    currentSource = null
  }

  source.start()
  rafId = requestAnimationFrame(tick)

  return () => {
    cancelAnimationFrame(rafId)
    source.stop()
  }
}

export function stopCurrent() {
  if (currentSource) {
    try { currentSource.stop() } catch {}
    currentSource = null
  }
}

// ── Recording ─────────────────────────────────────────────────────────────────

export async function startRecording({ onTick } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const recorder = new MediaRecorder(stream)
  const chunks = []

  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }

  let seconds = 0
  const ticker = setInterval(() => { seconds++; onTick?.(seconds) }, 1000)

  recorder.start()

  function stop() {
    return new Promise((resolve) => {
      clearInterval(ticker)
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunks, { type: recorder.mimeType })
        const arrayBuffer = await blob.arrayBuffer()
        const ctx = getCtx()
        const buffer = await ctx.decodeAudioData(arrayBuffer)
        resolve(buffer)
      }
      recorder.stop()
    })
  }

  return { stop }
}
