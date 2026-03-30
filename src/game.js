import lyrics from './lyrics.json'

// ── State machine ─────────────────────────────────────────────────────────────
// States: idle → loading → listening → recording → playback → guessing → revealed

const STREAK_KEY = 'flipside_streak'

export function createGame(render) {
  let state = {
    phase: 'idle',
    lyric: null,            // current lyrics entry
    originalBuffer: null,   // AudioBuffer of forward TTS
    reversedBuffer: null,   // AudioBuffer of reversed TTS
    recordingBuffer: null,  // AudioBuffer of raw user recording (sounds reversed)
    playCount: 0,
    recSeconds: 0,
    userGuess: '',
    streak: Number(localStorage.getItem(STREAK_KEY) ?? 0),
    usedIds: [],
  }

  function update(patch) {
    state = { ...state, ...patch }
    render(state)
  }

  function pickLyric() {
    const remaining = lyrics.filter(l => !state.usedIds.includes(l.id))
    const pool = remaining.length > 0 ? remaining : lyrics
    return pool[Math.floor(Math.random() * pool.length)]
  }

  function saveStreak(n) {
    localStorage.setItem(STREAK_KEY, n)
  }

  return {
    getState: () => state,

    startGame() {
      const lyric = pickLyric()
      update({
        phase: 'loading',
        lyric,
        originalBuffer: null,
        reversedBuffer: null,
        recordingBuffer: null,
        playCount: 0,
        recSeconds: 0,
        userGuess: '',
      })
    },

    setTTSBuffers(original, reversed) {
      update({ phase: 'listening', originalBuffer: original, reversedBuffer: reversed })
    },

    incrementPlayCount() {
      update({ playCount: state.playCount + 1 })
    },

    startRecording() {
      update({ phase: 'recording', recSeconds: 0 })
    },

    tickRecording(seconds) {
      update({ recSeconds: seconds })
    },

    finishRecording(buffer) {
      update({ phase: 'playback', recordingBuffer: buffer })
    },

    reRecord() {
      update({ phase: 'listening', recordingBuffer: null, recSeconds: 0 })
    },

    goToGuess() {
      update({ phase: 'guessing' })
    },

    backToPlayback() {
      update({ phase: 'playback' })
    },

    setGuess(text) {
      update({ userGuess: text })
    },

    reveal() {
      const usedIds = [...new Set([...state.usedIds, state.lyric.id])]
      update({ phase: 'revealed', usedIds })
    },

    gotIt() {
      const streak = state.streak + 1
      saveStreak(streak)
      update({ streak })
    },

    nope() {
      saveStreak(0)
      update({ streak: 0 })
    },

    nextLyric() {
      // streak already updated by gotIt/nope
      const lyric = pickLyric()
      update({
        phase: 'loading',
        lyric,
        originalBuffer: null,
        reversedBuffer: null,
        recordingBuffer: null,
        playCount: 0,
        recSeconds: 0,
        userGuess: '',
      })
    },
  }
}
