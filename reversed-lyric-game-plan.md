# FLIPSIDE — Reversed Lyric Guessing Game Plan

## Concept
A song lyric snippet is spoken via TTS, the audio is reversed, and played to the user. The user listens (can replay unlimited times), records themselves mimicking the reversed sound, hears their recording played back, then types a free-text guess. The original lyric is only revealed after submitting. A streak counter tracks consecutive correct guesses.

---

## Architecture

```
GitHub Pages (static frontend)
    → Lambda Function URL (HTTPS, CORS-enabled)
        → Amazon Polly Neural (SynthesizeSpeech)
        ← MP3 binary response
    ← client decodes → reverses AudioBuffer → plays
    → MediaRecorder (mic) → records user → plays back
    → user types guess → lyric revealed
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS + Vite |
| Hosting | GitHub Pages (via `gh-pages` branch) |
| TTS | Amazon Polly Neural (Joanna / Matthew voices) |
| TTS proxy | AWS Lambda (Node.js 20) + Lambda Function URL |
| Audio reversal | Web Audio API (`AudioBuffer` sample reversal) |
| Recording | `MediaRecorder` API + `getUserMedia` |
| Deploy | GitHub Actions |

---

## Project Structure

```
/
├── index.html
├── src/
│   ├── main.js          ← entry, game orchestration
│   ├── audio.js         ← reversal, playback, recording logic
│   ├── game.js          ← state machine
│   └── lyrics.json      ← curated lyric snippets [{id, artist, song, lyric}]
├── lambda/
│   ├── index.mjs        ← Lambda handler
│   └── package.json     ← @aws-sdk/client-polly
├── .github/
│   └── workflows/
│       └── deploy.yml   ← build + gh-pages deploy
├── .env.example         ← VITE_LAMBDA_URL=https://...
└── package.json         ← vite, dev deps
```

---

## Key Implementation Details

### Lambda handler (`lambda/index.mjs`)
```javascript
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
const polly = new PollyClient({ region: "us-east-1" });

export const handler = async (event) => {
  const { text, voice = "Joanna" } = JSON.parse(event.body || "{}");
  const result = await polly.send(new SynthesizeSpeechCommand({
    Text: text, OutputFormat: "mp3", VoiceId: voice, Engine: "neural",
  }));
  const chunks = [];
  for await (const chunk of result.AudioStream) chunks.push(chunk);
  return {
    statusCode: 200,
    headers: { "Content-Type": "audio/mpeg", "Access-Control-Allow-Origin": "*" },
    body: Buffer.concat(chunks).toString("base64"),
    isBase64Encoded: true,
  };
};
```

### Audio reversal (`src/audio.js`)
```javascript
async function fetchAndReverse(lyric) {
  const res = await fetch(import.meta.env.VITE_LAMBDA_URL, {
    method: "POST",
    body: JSON.stringify({ text: lyric }),
  });
  const arrayBuffer = await res.arrayBuffer();
  const ctx = new AudioContext();
  const buffer = await ctx.decodeAudioData(arrayBuffer);
  const reversed = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    reversed.copyToChannel(buffer.getChannelData(ch).slice().reverse(), ch);
  }
  return { ctx, reversed };
}
```

### Recording
```javascript
async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = e => chunks.push(e.data);
  return { recorder, getBlob: () => new Blob(chunks, { type: "audio/webm" }) };
}
```

### Game state machine (`src/game.js`)
States: `idle → loading → listening → recording → playback → guessing → revealed`

- **idle**: show "New Game" button, pick random lyric from `lyrics.json`
- **loading**: call Lambda, reverse audio, show spinner
- **listening**: show play button (can replay), show "Record" button
- **recording**: mic active, show waveform/timer, "Stop" button
- **playback**: play user's recording back, show "Guess" button
- **guessing**: text input for guess, "Reveal" button
- **revealed**: show original lyric + artist/song, "Play Again" button

---

## AWS Setup (one-time)

1. Create Lambda function (Node.js 20, ~128MB memory)
2. Attach IAM policy: `polly:SynthesizeSpeech` only
3. Enable Lambda Function URL with CORS (`AllowOrigins: ["https://<username>.github.io"]`)
4. Copy the Function URL → set as `VITE_LAMBDA_URL` in GitHub Actions secrets

---

## GitHub Actions Deploy (`.github/workflows/deploy.yml`)

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
- run: npm ci && npm run build
  env:
    VITE_LAMBDA_URL: ${{ secrets.VITE_LAMBDA_URL }}
- uses: peaceiris/actions-gh-pages@v4
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    publish_dir: ./dist
```

---

## Cost Estimate

| | Volume | Cost |
|---|---|---|
| Lambda invocations | 1M/month free | $0 |
| Polly neural | ~50 chars/lyric, 10K plays/month | ~$0.008 |

Effectively free at hobby scale.

---

## Lyrics Data Format (`src/lyrics.json`)
```json
[
  { "id": 1, "artist": "Daft Punk", "song": "Get Lucky", "lyric": "We've come too far to give up who we are" }
]
```
Start with 20–50 curated lyrics. Selected randomly client-side; ID never shown until reveal.

---

## UI Specification

### Visual Design
**Aesthetic:** Retro cassette tape / B-side record. Warm dark background with amber/orange accents, slightly worn texture feel.

**Palette:**
| Token | Value | Usage |
|---|---|---|
| `--bg` | `#1a0a00` | Page background |
| `--surface` | `#2c1500` | Card / panel background |
| `--border` | `#5c3010` | Card borders, dividers |
| `--accent` | `#f97316` | Buttons, highlights, active states |
| `--accent-dim` | `#7c3800` | Disabled / secondary buttons |
| `--text` | `#f5e6d0` | Primary text |
| `--text-muted` | `#a07850` | Labels, secondary text |

**Typography:** `'Courier New', monospace` throughout — reinforces the retro recording-equipment feel. Game title in uppercase tracked-out letters.

**Buttons:** Rectangular, no border-radius, 2px solid `--border`. Active state shifts background to `--accent` with dark text. Disabled state uses `--accent-dim` with muted text.

**Progress bar (audio playback timer):** Simple horizontal bar in `--accent`, grows left-to-right over audio duration.

---

### Layout — Single Page, Centred Card

```
┌─────────────────────────────────────────────┐
│                                             │
│   F L I P S I D E                          │
│   ─────────────────────                    │
│                              🔥 Streak: 3  │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │                                       │  │
│  │          [  state panel  ]            │  │
│  │                                       │  │
│  └───────────────────────────────────────┘  │
│                                             │
└─────────────────────────────────────────────┘
```

Max width: 480px, centred. The "state panel" is the only thing that changes between states.

---

### States & Panels

#### `idle`
```
┌───────────────────────────────────────────┐
│                                           │
│   Can you work out the lyric?             │
│                                           │
│   [ ▶  NEW GAME ]                        │
│                                           │
└───────────────────────────────────────────┘
```

#### `loading`
```
┌───────────────────────────────────────────┐
│                                           │
│   Preparing your lyric...                 │
│   ░░░░░░░░░░░░░░░░  (animated dots)       │
│                                           │
└───────────────────────────────────────────┘
```

#### `listening`
```
┌───────────────────────────────────────────┐
│   LISTEN                                  │
│                                           │
│   [ ▶  PLAY ]                            │
│   ████████████░░░░░░░  0:03 / 0:05       │
│                                           │
│   Played: 2 times                         │
│                                           │
│   [ ⏺  RECORD YOURSELF ]                │
│                                           │
└───────────────────────────────────────────┘
```
- PLAY button becomes STOP while audio is playing
- Timer bar fills as audio plays
- Play count increments each time (no limit)
- RECORD YOURSELF always available (player decides when ready)

#### `recording`
```
┌───────────────────────────────────────────┐
│   RECORDING...                            │
│                                           │
│   ⏺  0:04                                │
│                                           │
│   [ ■  STOP ]                            │
│                                           │
└───────────────────────────────────────────┘
```
- Recording duration counter ticks up
- STOP ends recording and transitions to `playback`

#### `playback`
```
┌───────────────────────────────────────────┐
│   YOUR RECORDING                          │
│                                           │
│   [ ▶  PLAY BACK ]                       │
│   ████████████░░░░░░░  0:02 / 0:04       │
│                                           │
│   [ ↩  RE-RECORD ]    [ ✓  GUESS ]      │
│                                           │
└───────────────────────────────────────────┘
```
- Auto-plays recording once on entering state
- Player can replay or re-record before committing
- RE-RECORD returns to `recording`

#### `guessing`
```
┌───────────────────────────────────────────┐
│   WHAT'S THE LYRIC?                       │
│                                           │
│   ┌─────────────────────────────────────┐ │
│   │ type the lyric here...              │ │
│   └─────────────────────────────────────┘ │
│                                           │
│   [ ↩  BACK ]         [ ✓  REVEAL ]     │
│                                           │
└───────────────────────────────────────────┘
```
- Free text input, autofocused
- BACK returns to `playback`
- REVEAL submits and transitions to `revealed`

#### `revealed`
```
┌───────────────────────────────────────────┐
│   THE LYRIC WAS:                          │
│                                           │
│   "We've come too far                     │
│    to give up who we are"                 │
│                                           │
│   — Daft Punk · Get Lucky                 │
│                                           │
│   Your guess:                             │
│   "we've come too far to give up"         │
│                                           │
│   🔥 Streak: 3   [ ▶  NEXT LYRIC ]      │
│                                           │
└───────────────────────────────────────────┘
```
- Lyric displayed large, in quotes
- Artist · Song in muted text below
- Player's own guess shown for comparison (no right/wrong judgement — player decides)
- Streak counter shown; player self-reports by clicking NEXT LYRIC (streak managed by honour system — no auto-scoring since free text can't be auto-checked)
- Alternatively: show two buttons — `[ ✓ I GOT IT ]  [ ✗ I DIDN'T ]` to update streak

> **Note on streak:** since free text can't be reliably auto-matched, show both the original lyric and the user's guess side-by-side. Player self-reports with `[ ✓ GOT IT ]` / `[ ✗ NOPE ]` buttons. This is honest and avoids frustrating false negatives.

---

### Streak Display
- Shown in top-right of card at all times once a game has been played
- Format: `🔥 3` (flame emoji + number)
- Resets to 0 on `[ ✗ NOPE ]`
- Persisted in `localStorage` so it survives page refresh

---

### Responsive
- Card fills viewport width on mobile with 16px horizontal padding
- All buttons full-width on screens < 400px

---

## Verification

1. `npm run dev` locally with `VITE_LAMBDA_URL` pointing to deployed Lambda
2. Click "New Game" → spinner → reversed audio plays
3. Record mic → plays back → type guess → reveal shows correct lyric
4. Deploy to GitHub Pages → confirm CORS works from `github.io` origin
5. DevTools → confirm no API keys in JS bundle
