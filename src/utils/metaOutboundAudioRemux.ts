// =============================================================================
// Remux fMP4 AAC-LC → MP4 convencional para áudio outbound Meta.
// Browser-only. Sem rede. Sem transcode (copy.mode = 'forced').
// Não usado pela Uazapi.
// =============================================================================

import {
  BufferSource,
  BufferTarget,
  Conversion,
  EncodedPacketSink,
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
} from 'mediabunny'
import { validateMetaOutboundAudioBytes } from '../../api/lib/meta-whatsapp/audioBytes.js'

const DURATION_TOLERANCE_SECONDS = 0.05

export type MetaAudioRemuxFailureCode = 'invalid_audio' | 'audio_remux_failed'

export type MetaAudioRemuxResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; code: MetaAudioRemuxFailureCode }

type Mp4Layout = {
  hasFtyp: boolean
  hasMoov: boolean
  hasMdat: boolean
  hasMoof: boolean
  hasMvex: boolean
  sampleCount: number | null
  chunkCount: number | null
  stscEntries: number | null
  sttsEntries: number | null
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3]
  ) >>> 0
}

function readType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  )
}

function inspectMp4Layout(bytes: Uint8Array): Mp4Layout {
  const layout: Mp4Layout = {
    hasFtyp: false,
    hasMoov: false,
    hasMdat: false,
    hasMoof: false,
    hasMvex: false,
    sampleCount: null,
    chunkCount: null,
    stscEntries: null,
    sttsEntries: null,
  }
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex', 'moof', 'traf'])

  const walk = (start: number, end: number) => {
    let offset = start
    while (offset + 8 <= end) {
      const size32 = readU32(bytes, offset)
      const type = readType(bytes, offset + 4)
      let header = 8
      let size = size32
      if (size32 === 1) {
        if (offset + 16 > end) break
        const hi = readU32(bytes, offset + 8)
        const lo = readU32(bytes, offset + 12)
        size = hi * 0x100000000 + lo
        header = 16
      } else if (size32 === 0) {
        size = end - offset
      }
      if (size < header || offset + size > end) break
      const payload = offset + header
      if (type === 'ftyp') layout.hasFtyp = true
      if (type === 'moov') layout.hasMoov = true
      if (type === 'mdat') layout.hasMdat = true
      if (type === 'moof') layout.hasMoof = true
      if (type === 'mvex') layout.hasMvex = true
      if (type === 'stsz' && payload + 12 <= offset + size) {
        layout.sampleCount = readU32(bytes, payload + 8)
      }
      if (type === 'stco' && payload + 8 <= offset + size) {
        layout.chunkCount = readU32(bytes, payload + 4)
      }
      if (type === 'co64' && payload + 8 <= offset + size) {
        layout.chunkCount = readU32(bytes, payload + 4)
      }
      if (type === 'stsc' && payload + 8 <= offset + size) {
        layout.stscEntries = readU32(bytes, payload + 4)
      }
      if (type === 'stts' && payload + 8 <= offset + size) {
        layout.sttsEntries = readU32(bytes, payload + 4)
      }
      if (containers.has(type)) walk(payload, offset + size)
      offset += size
    }
  }

  walk(0, bytes.length)
  return layout
}

function isProgressiveAacLc(bytes: Uint8Array): boolean {
  const layout = inspectMp4Layout(bytes)
  if (layout.hasMoof || layout.hasMvex) return false
  if (!layout.hasFtyp || !layout.hasMoov || !layout.hasMdat) return false
  if ((layout.sampleCount ?? 0) <= 0) return false
  if ((layout.chunkCount ?? 0) <= 0) return false
  if ((layout.stscEntries ?? 0) <= 0) return false
  if ((layout.sttsEntries ?? 0) <= 0) return false
  const validation = validateMetaOutboundAudioBytes(bytes)
  return validation.ok === true
    && validation.audioCodec === 'aac'
    && validation.aacProfile === 'lc'
}

async function readAudioPackets(bytes: Uint8Array) {
  const input = new Input({
    source: new BufferSource(bytes.slice()),
    formats: [MP4],
  })
  const track = await input.getPrimaryAudioTrack()
  if (!track) return null
  const codec = track.codec
  const sampleRate = await track.getSampleRate()
  const channels = await track.getNumberOfChannels()
  const duration = await input.computeDuration()
  const sink = new EncodedPacketSink(track)
  const packets: Uint8Array[] = []
  for await (const packet of sink.packets()) {
    packets.push(packet.data.slice())
  }
  return { codec, sampleRate, channels, duration, packets }
}

function packetsEqual(left: Uint8Array[], right: Uint8Array[]): boolean {
  if (left.length !== right.length || left.length === 0) return false
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i]
    const b = right[i]
    if (a.length !== b.length) return false
    for (let j = 0; j < a.length; j += 1) {
      if (a[j] !== b[j]) return false
    }
  }
  return true
}

function fail(code: MetaAudioRemuxFailureCode = 'audio_remux_failed'): MetaAudioRemuxResult {
  return { ok: false, code }
}

export async function remuxMetaOutboundAudioToProgressiveMp4(
  inputBytes: Uint8Array,
): Promise<MetaAudioRemuxResult> {
  if (!(inputBytes instanceof Uint8Array) || inputBytes.byteLength === 0) {
    return fail('invalid_audio')
  }

  try {
    const inputPackets = await readAudioPackets(inputBytes)
    if (!inputPackets || inputPackets.codec !== 'aac' || inputPackets.packets.length === 0) {
      return fail('invalid_audio')
    }

    const input = new Input({
      source: new BufferSource(inputBytes.slice()),
      formats: [MP4],
    })
    const target = new BufferTarget()
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target,
    })
    const conversion = await Conversion.init({
      input,
      output,
      copy: { mode: 'forced' },
      video: { discard: true },
      showWarnings: false,
    })

    const audioDiscarded = conversion.discardedTracks.some((item) => (
      item.track.type === 'audio' && item.reason !== 'discarded_by_user'
    ))
    const hasAudio = conversion.utilizedTracks.some((track) => track.type === 'audio')
    if (!conversion.isValid || audioDiscarded || !hasAudio) {
      return fail('audio_remux_failed')
    }

    await conversion.execute()
    if (!target.buffer || target.buffer.byteLength === 0) {
      return fail('audio_remux_failed')
    }

    const outputBytes = new Uint8Array(target.buffer)
    if (!isProgressiveAacLc(outputBytes)) {
      return fail('audio_remux_failed')
    }

    const outputPackets = await readAudioPackets(outputBytes)
    if (!outputPackets) return fail('audio_remux_failed')
    if (outputPackets.codec !== 'aac') return fail('invalid_audio')
    if (outputPackets.sampleRate !== inputPackets.sampleRate) return fail('audio_remux_failed')
    if (outputPackets.channels !== inputPackets.channels) return fail('audio_remux_failed')
    if (Math.abs(outputPackets.duration - inputPackets.duration) > DURATION_TOLERANCE_SECONDS) {
      return fail('audio_remux_failed')
    }
    if (!packetsEqual(inputPackets.packets, outputPackets.packets)) {
      return fail('audio_remux_failed')
    }

    return { ok: true, bytes: outputBytes }
  } catch {
    return fail('audio_remux_failed')
  }
}
