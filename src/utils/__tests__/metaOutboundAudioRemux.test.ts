import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedPacketSink,
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
  BufferSource,
} from 'mediabunny'
import { remuxMetaOutboundAudioToProgressiveMp4 } from '../metaOutboundAudioRemux'
import { validateMetaOutboundAudioBytes } from '../../../api/lib/meta-whatsapp/audioBytes.js'

const SAMPLE_RATE = 48_000
const CHANNELS = 1
const FRAME_SAMPLES = 1024
const FRAME_DURATION = FRAME_SAMPLES / SAMPLE_RATE
const ASC_48K_MONO_LC = new Uint8Array([0x11, 0x88])

function makeFrame(index: number, length = 24): Uint8Array {
  const data = new Uint8Array(length)
  data[0] = 0xe6
  data[1] = 0x12
  data[2] = index & 0xff
  data[3] = (index >> 8) & 0xff
  for (let i = 4; i < length; i += 1) {
    data[i] = (index * 17 + i * 31) & 0xff
  }
  return data
}

function hashPackets(packets: Uint8Array[]): string {
  const hash = createHash('sha256')
  for (const packet of packets) hash.update(packet)
  return hash.digest('hex')
}

function inspectTopBoxes(bytes: Uint8Array): string[] {
  const top: string[] = []
  let offset = 0
  while (offset + 8 <= bytes.length) {
    const size = bytes[offset] * 0x1000000
      + (bytes[offset + 1] << 16)
      + (bytes[offset + 2] << 8)
      + bytes[offset + 3]
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    )
    if (size < 8 || offset + size > bytes.length) break
    top.push(type)
    offset += size
  }
  return top
}

function hasBox(bytes: Uint8Array, wanted: string): boolean {
  const stack = [[0, bytes.length]]
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number]
    let offset = start
    while (offset + 8 <= end) {
      const size = (
        bytes[offset] * 0x1000000
        + (bytes[offset + 1] << 16)
        + (bytes[offset + 2] << 8)
        + bytes[offset + 3]
      ) >>> 0
      const type = String.fromCharCode(
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7],
      )
      if (size < 8 || offset + size > end) break
      if (type === wanted) return true
      if (type === 'moov' || type === 'trak' || type === 'mdia' || type === 'minf' || type === 'stbl' || type === 'mvex') {
        stack.push([offset + 8, offset + size])
      }
      offset += size
    }
  }
  return false
}

async function muxAac(packetCount: number, fragmented: boolean): Promise<Uint8Array> {
  const target = new BufferTarget()
  const output = new Output({
    format: new Mp4OutputFormat(
      fragmented
        ? { fastStart: 'fragmented', minimumFragmentDuration: packetCount < 10 ? 10 : 0.5 }
        : { fastStart: 'in-memory' },
    ),
    target,
  })
  const source = new EncodedAudioPacketSource('aac')
  output.addAudioTrack(source)
  await output.start()
  for (let i = 0; i < packetCount; i += 1) {
    const data = makeFrame(i)
    const packet = new EncodedPacket(data, 'key', i * FRAME_DURATION, FRAME_DURATION, i)
    const meta = i === 0
      ? {
        decoderConfig: {
          codec: 'mp4a.40.2',
          numberOfChannels: CHANNELS,
          sampleRate: SAMPLE_RATE,
          description: ASC_48K_MONO_LC,
        },
      }
      : undefined
    await source.add(packet, meta)
  }
  await output.finalize()
  if (!target.buffer) throw new Error('mux produced no buffer')
  return new Uint8Array(target.buffer)
}

async function readPackets(bytes: Uint8Array) {
  const input = new Input({
    source: new BufferSource(bytes.slice()),
    formats: [MP4],
  })
  const track = await input.getPrimaryAudioTrack()
  if (!track) throw new Error('no audio')
  const duration = await input.computeDuration()
  const sink = new EncodedPacketSink(track)
  const packets: Uint8Array[] = []
  for await (const packet of sink.packets()) {
    packets.push(packet.data.slice())
  }
  return {
    codec: track.codec,
    sampleRate: await track.getSampleRate(),
    channels: await track.getNumberOfChannels(),
    duration,
    packets,
  }
}

describe('remuxMetaOutboundAudioToProgressiveMp4', () => {
  it('converte fMP4 AAC-LC curto para MP4 convencional sem recodificar', async () => {
    const input = await muxAac(3, true)
    expect(hasBox(input, 'moof')).toBe(true)
    expect(hasBox(input, 'mvex')).toBe(true)

    const result = await remuxMetaOutboundAudioToProgressiveMp4(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(hasBox(result.bytes, 'moof')).toBe(false)
    expect(hasBox(result.bytes, 'mvex')).toBe(false)
    expect(inspectTopBoxes(result.bytes)).toEqual(['ftyp', 'moov', 'mdat'])

    const validation = validateMetaOutboundAudioBytes(result.bytes)
    expect(validation.ok).toBe(true)
    if (validation.ok) {
      expect(validation.audioCodec).toBe('aac')
      expect(validation.aacProfile).toBe('lc')
    }

    const before = await readPackets(input)
    const after = await readPackets(result.bytes)
    expect(after.codec).toBe('aac')
    expect(after.sampleRate).toBe(SAMPLE_RATE)
    expect(after.channels).toBe(CHANNELS)
    expect(after.packets.length).toBe(3)
    expect(Math.abs(after.duration - before.duration)).toBeLessThan(0.05)
    expect(hashPackets(after.packets)).toBe(hashPackets(before.packets))
  })

  it('converte fMP4 com múltiplos fragmentos e preserva amostras AAC', async () => {
    const input = await muxAac(48, true)
    expect(hasBox(input, 'moof')).toBe(true)

    const result = await remuxMetaOutboundAudioToProgressiveMp4(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(hasBox(result.bytes, 'moof')).toBe(false)
    expect(hasBox(result.bytes, 'mvex')).toBe(false)
    const before = await readPackets(input)
    const after = await readPackets(result.bytes)
    expect(after.packets.length).toBe(before.packets.length)
    expect(hashPackets(after.packets)).toBe(hashPackets(before.packets))
    expect(Math.abs(after.duration - 48 * FRAME_DURATION)).toBeLessThan(0.05)
  })

  it('arquivo já progressivo permanece AAC copy sem moof', async () => {
    const input = await muxAac(4, false)
    expect(hasBox(input, 'moof')).toBe(false)

    const result = await remuxMetaOutboundAudioToProgressiveMp4(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(hasBox(result.bytes, 'moof')).toBe(false)
    expect(hasBox(result.bytes, 'mvex')).toBe(false)
    const before = await readPackets(input)
    const after = await readPackets(result.bytes)
    expect(hashPackets(after.packets)).toBe(hashPackets(before.packets))
  })

  it('rejeita arquivo malformado', async () => {
    const result = await remuxMetaOutboundAudioToProgressiveMp4(new Uint8Array([1, 2, 3, 4]))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('audio_remux_failed')
  })

  it('rejeita container incompatível', async () => {
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86, 0x81, 0x01])
    const result = await remuxMetaOutboundAudioToProgressiveMp4(webm)
    expect(result.ok).toBe(false)
  })

  it('rejeita entrada vazia', async () => {
    const result = await remuxMetaOutboundAudioToProgressiveMp4(new Uint8Array())
    expect(result).toEqual({ ok: false, code: 'invalid_audio' })
  })
})
