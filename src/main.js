import { createGame } from './game.js'
import { fetchTTS, reverseBuffer, playBuffer, stopCurrent, startRecording } from './audio.js'

const card = document.getElementById('card')
const streakEl = document.getElementById('streak')
const streakCount = document.getElementById('streak-count')

const buildTimeEl = document.getElementById('build-time')
buildTimeEl.textContent = new Date(__BUILD_TIME__).toLocaleString()

// ── Config ────────────────────────────────────────────────────────────────────

const RATE_KEY = 'flipside_rate'

function getRate() {
  return Number(localStorage.getItem(RATE_KEY) ?? 85)
}

function setRate(r) {
  localStorage.setItem(RATE_KEY, r)
}

const dialog = document.getElementById('config-dialog')
const rateSlider = document.getElementById('rate-slider')
const rateValue = document.getElementById('rate-value')

buildTimeEl.addEventListener('click', () => {
  rateSlider.value = getRate()
  rateValue.textContent = `${rateSlider.value}%`
  dialog.showModal()
})

rateSlider.addEventListener('input', () => {
  rateValue.textContent = `${rateSlider.value}%`
})

document.getElementById('config-save').addEventListener('click', () => {
  setRate(Number(rateSlider.value))
  dialog.close()
})

document.getElementById('config-cancel').addEventListener('click', () => {
  dialog.close()
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function wordHint(text) {
  const words = text.trim().split(/\s+/)
  const blanks = words.map(w => w[0].toUpperCase() + '_').join('   ')
  return `${blanks}  ·  ${words.length} ${words.length === 1 ? 'word' : 'words'}`
}

function fmtTime(secs) {
  const s = Math.floor(secs)
  return `0:${String(s).padStart(2, '0')}`
}

function progressHTML(id) {
  return `
    <div class="progress-wrap"><div class="progress-bar" id="${id}"></div></div>
    <div class="progress-time" id="${id}-time">0:00 / 0:00</div>
  `
}

function setProgress(id, elapsed, duration) {
  const bar = document.getElementById(id)
  const timeEl = document.getElementById(`${id}-time`)
  if (bar) bar.style.width = `${duration > 0 ? (elapsed / duration) * 100 : 0}%`
  if (timeEl) timeEl.textContent = `${fmtTime(elapsed)} / ${fmtTime(duration)}`
}

// Active recorder handle (so we can stop it)
let activeRecorder = null
let stopPlayback = null

function haltAll() {
  stopCurrent()
  stopPlayback?.()
  stopPlayback = null
}

// ── Render ────────────────────────────────────────────────────────────────────

function render(state) {
  // Streak display
  if (state.streak > 0 || state.phase !== 'idle') {
    streakEl.style.display = ''
    streakCount.textContent = state.streak
  } else {
    streakEl.style.display = 'none'
  }

  card.innerHTML = buildPanel(state)
  attachHandlers(state)
}

function buildPanel(state) {
  switch (state.phase) {
    case 'idle':
      return `
        <div class="card-label">Can you work out the Disney character?</div>
        <div><button id="btn-new" class="primary">&#9654;&nbsp; New Game</button></div>
      `

    case 'loading':
      return `
        <div class="card-label">Preparing your lyric<span class="dots"></span></div>
      `

    case 'listening':
      return `
        <div class="card-label">Listen</div>
        <div>
          <button id="btn-play">&#9654;&nbsp; Play</button>
          ${progressHTML('play-prog')}
        </div>
        <div class="play-count" id="play-count">
          ${state.playCount === 0 ? 'Press play when ready' : `Played: ${state.playCount} ${state.playCount === 1 ? 'time' : 'times'}`}
        </div>
        <div class="word-hint">${wordHint(state.lyric.lyric)}</div>
        <div><button id="btn-record">&#9210;&nbsp; Record Yourself</button></div>
      `

    case 'recording':
      return `
        <div class="card-label">Recording<span class="dots"></span></div>
        <div class="rec-timer"><span class="rec-dot"></span>${fmtTime(state.recSeconds)}</div>
        <div><button id="btn-stop" class="danger">&#9632;&nbsp; Stop</button></div>
      `

    case 'playback':
      return `
        <div class="card-label">Your Recording</div>
        <div>
          <button id="btn-play-rec">&#9654;&nbsp; Play Back</button>
          ${progressHTML('rec-prog')}
        </div>
        <div class="word-hint">${wordHint(state.lyric.lyric)}</div>
        <div class="btn-row">
          <button id="btn-rerecord">&#8629;&nbsp; Re-record</button>
          <button id="btn-guess" class="primary">&#10003;&nbsp; Guess</button>
        </div>
      `

    case 'guessing':
      return `
        <div class="card-label">Who is it?</div>
        ${state.recordingBuffer ? `<div><button id="btn-mine-fwd" class="primary">&#9654;&nbsp; Play my guess</button></div>` : ''}
        <div class="btn-row">
          <button id="btn-back">&#8629;&nbsp; Back</button>
          <button id="btn-reveal" class="primary">&#10003;&nbsp; Reveal</button>
        </div>
      `

    case 'revealed':
      return `
        <div class="card-label">The answer was:</div>
        <div class="lyric-display">${state.lyric.lyric}</div>
        <div class="attribution">from ${state.lyric.movie}</div>
        <div class="btn-grid">
          <button id="btn-play-reversed">&#9654;&nbsp; Original</button>
          ${state.recordingBuffer ? `<button id="btn-play-mine">&#9654;&nbsp; Mine</button>` : '<span></span>'}
          <button id="btn-play-orig-fwd">&#9654;&nbsp; Original (fwd)</button>
          ${state.recordingBuffer ? `<button id="btn-play-mine-rev">&#9654;&nbsp; Mine (rev)</button>` : ''}
        </div>
        <div class="card-label" style="margin-top:4px">Did you get it?</div>
        <div class="btn-row">
          <button id="btn-got-it" class="primary">&#10003;&nbsp; Got It</button>
          <button id="btn-nope" class="danger">&#10007;&nbsp; Nope</button>
        </div>
      `
  }
}

function attachHandlers(state) {
  const { phase, reversedBuffer, recordingBuffer } = state

  if (phase === 'idle') {
    document.getElementById('btn-new')?.addEventListener('click', () => {
      game.startGame()
    })
  }

  if (phase === 'listening') {
    document.getElementById('btn-play')?.addEventListener('click', () => {
      haltAll()
      const btn = document.getElementById('btn-play')
      if (btn) btn.textContent = '\u25A0\u00A0 Stop'
      stopPlayback = playBuffer(reversedBuffer, {
        onTimeUpdate: (e, d) => setProgress('play-prog', e, d),
        onEnded: () => {
          game.incrementPlayCount()
          // re-render to update play count and reset button
          render(game.getState())
        },
      })

      // wire stop button after re-render won't exist, so replace click inline
      btn?.addEventListener('click', () => { haltAll(); render(game.getState()) }, { once: true })
    })

    document.getElementById('btn-record')?.addEventListener('click', () => {
      haltAll()
      game.startRecording()
    })
  }

  if (phase === 'recording') {
    // Kick off recording as soon as we render this phase
    if (!activeRecorder) {
      startRecording({
        onTick: (s) => game.tickRecording(s),
      }).then((recorder) => {
        activeRecorder = recorder
      })
    }

    document.getElementById('btn-stop')?.addEventListener('click', async () => {
      if (!activeRecorder) return
      const buffer = await activeRecorder.stop()
      activeRecorder = null
      game.finishRecording(buffer)
    })
  }

  if (phase === 'playback') {
    // Auto-play on entering playback
    setTimeout(() => {
      stopPlayback = playBuffer(recordingBuffer, {
        onTimeUpdate: (e, d) => setProgress('rec-prog', e, d),
        onEnded: () => {},
      })
    }, 100)

    document.getElementById('btn-play-rec')?.addEventListener('click', () => {
      haltAll()
      stopPlayback = playBuffer(recordingBuffer, {
        onTimeUpdate: (e, d) => setProgress('rec-prog', e, d),
        onEnded: () => {},
      })
    })

    document.getElementById('btn-rerecord')?.addEventListener('click', () => {
      haltAll()
      activeRecorder = null
      game.reRecord()
    })

    document.getElementById('btn-guess')?.addEventListener('click', () => {
      haltAll()
      game.goToGuess()
    })
  }

  if (phase === 'guessing') {
    // Auto-play the reversed recording so they can hear their guess
    if (state.recordingBuffer) {
      setTimeout(() => playBuffer(reverseBuffer(state.recordingBuffer)), 100)
    }

    document.getElementById('btn-mine-fwd')?.addEventListener('click', () => {
      haltAll(); playBuffer(reverseBuffer(state.recordingBuffer))
    })
    document.getElementById('btn-back')?.addEventListener('click', () => game.backToPlayback())
    document.getElementById('btn-reveal')?.addEventListener('click', () => game.reveal())
  }

  if (phase === 'revealed') {
    document.getElementById('btn-play-reversed')?.addEventListener('click', () => {
      haltAll(); playBuffer(state.reversedBuffer)
    })
    document.getElementById('btn-play-orig-fwd')?.addEventListener('click', () => {
      haltAll(); playBuffer(state.originalBuffer)
    })
    document.getElementById('btn-play-mine')?.addEventListener('click', () => {
      haltAll(); playBuffer(reverseBuffer(state.recordingBuffer))
    })
    document.getElementById('btn-play-mine-rev')?.addEventListener('click', () => {
      haltAll(); playBuffer(state.recordingBuffer)
    })

    document.getElementById('btn-got-it')?.addEventListener('click', () => {
      game.gotIt()
      game.nextLyric()
    })
    document.getElementById('btn-nope')?.addEventListener('click', () => {
      game.nope()
      game.nextLyric()
    })
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

const game = createGame(render)

// When we enter 'loading', kick off the async fetch
const _startGame = game.startGame.bind(game)
game.startGame = function () {
  _startGame()
  fetchTTS(game.getState().lyric.lyric, getRate())
    .then(({ original, reversed }) => game.setTTSBuffers(original, reversed))
    .catch((err) => {
      console.error(err)
      card.innerHTML = `
        <div class="card-label" style="color:#dc2626">Error loading lyric.</div>
        <div style="font-size:0.8rem;color:var(--text-muted);margin-top:8px">${err.message}</div>
        <button id="btn-retry" style="margin-top:16px">Retry</button>
      `
      document.getElementById('btn-retry')?.addEventListener('click', () => game.startGame())
    })
}

// Same for nextLyric
const _nextLyric = game.nextLyric.bind(game)
game.nextLyric = function () {
  _nextLyric()
  fetchTTS(game.getState().lyric.lyric, getRate())
    .then(({ original, reversed }) => game.setTTSBuffers(original, reversed))
    .catch((err) => {
      console.error(err)
      card.innerHTML = `
        <div class="card-label" style="color:#dc2626">Error loading lyric.</div>
        <button id="btn-retry" style="margin-top:16px">Retry</button>
      `
      document.getElementById('btn-retry')?.addEventListener('click', () => game.startGame())
    })
}

render(game.getState())
