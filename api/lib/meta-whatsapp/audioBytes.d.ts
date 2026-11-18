export const META_OUTBOUND_AUDIO_MAX_BYTES: number
export const META_OUTBOUND_AUDIO_MAX_BOX_COUNT: number
export const META_OUTBOUND_AUDIO_MAX_BOX_DEPTH: number

export function validateMetaOutboundAudioBytes(bytes: Uint8Array): {
  ok: true
  container: 'mp4'
  sampleEntry: 'mp4a'
  hasAudio: true
  hasVideo: false
  audioCodec: 'aac' | 'unconfirmed'
  aacProfile: 'lc' | null
} | {
  ok: false
  code: 'invalid_audio_input' | 'audio_too_large' | 'unsupported_audio_container' | 'invalid_audio_format'
  reason: string
}
