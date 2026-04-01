import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly'

const polly = new PollyClient({ region: process.env.AWS_REGION ?? 'us-east-1' })

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean)

function corsHeaders(origin) {
  const allowed =
    ALLOWED_ORIGINS.length === 0 ||
    ALLOWED_ORIGINS.includes(origin) ||
    ALLOWED_ORIGINS.includes('*')

  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

export const handler = async (event) => {
  const origin = event.headers?.origin ?? ''

  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin) }
  }

  let text, voice, rate
  try {
    ;({ text, voice = 'Amy', rate = 85 } = JSON.parse(event.body ?? '{}'))
  } catch {
    return { statusCode: 400, headers: corsHeaders(origin), body: 'Invalid JSON' }
  }

  if (!text || typeof text !== 'string' || text.length > 300) {
    return { statusCode: 400, headers: corsHeaders(origin), body: 'Invalid text' }
  }

  const clampedRate = Math.min(200, Math.max(20, Number(rate) || 85))

  const result = await polly.send(
    new SynthesizeSpeechCommand({
      Text: `<speak><prosody rate="${clampedRate}%">${text}</prosody></speak>`,
      TextType: 'ssml',
      OutputFormat: 'mp3',
      VoiceId: voice,
      Engine: 'neural',
    })
  )

  const chunks = []
  for await (const chunk of result.AudioStream) chunks.push(chunk)

  return {
    statusCode: 200,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'audio/mpeg',
    },
    body: Buffer.concat(chunks).toString('base64'),
    isBase64Encoded: true,
  }
}
