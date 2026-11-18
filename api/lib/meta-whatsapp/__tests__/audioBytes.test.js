// =============================================================================
// audioBytes.test.js
//
// Fixtures ISO-BMFF sintéticas — sem gravações de clientes, sem Graph, S3 ou
// rede. O parser é exercitado sobre bytes reais, não sobre mocks de resultado.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateMetaOutboundAudioBytes,
  META_OUTBOUND_AUDIO_MAX_BYTES,
  META_OUTBOUND_AUDIO_MAX_BOX_COUNT,
  META_OUTBOUND_AUDIO_MAX_BOX_DEPTH,
} from '../audioBytes.js';

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('fetch must not be called in B3.1 audioBytes tests');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function u32(n) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n >>> 0, 0);
  return buf;
}

function fourcc(type) {
  return Buffer.from(type, 'ascii');
}

function box(type, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.concat(payload);
  return Buffer.concat([u32(8 + body.length), fourcc(type), body]);
}

function hdlr(handler) {
  return box('hdlr', [
    Buffer.alloc(8),
    fourcc(handler),
    Buffer.alloc(12),
    Buffer.from([0x00]),
  ]);
}

function mp4aPayload(extra) {
  const fields = Buffer.alloc(28);
  fields[7] = 0x01;
  fields[17] = 0x02;
  fields[19] = 0x10;
  fields.writeUInt32BE((44100 * 65536) >>> 0, 24);
  return extra ? Buffer.concat([fields, extra]) : fields;
}

function esdsAacLc() {
  return box('esds', Buffer.from([
    0x00, 0x00, 0x00, 0x00,
    0x03, 0x19,
    0x00, 0x00,
    0x00,
    0x04, 0x11,
    0x40,
    0x15,
    0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x05, 0x02,
    0x12, 0x10,
    0x06, 0x01,
    0x02,
  ]));
}

function esdsMp3InMp4() {
  return box('esds', Buffer.from([
    0x00, 0x00, 0x00, 0x00,
    0x03, 0x19,
    0x00, 0x00,
    0x00,
    0x04, 0x11,
    0x6b,
    0x15,
    0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x05, 0x02,
    0x12, 0x10,
    0x06, 0x01,
    0x02,
  ]));
}

function stsdWith(sampleEntry) {
  return box('stsd', [Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]), sampleEntry]);
}

function audioTrack({ withEsds = false, codecBox = null } = {}) {
  const extra = codecBox || (withEsds ? esdsAacLc() : null);
  const sample = box('mp4a', mp4aPayload(extra));
  return box('trak', [
    box('mdia', [
      hdlr('soun'),
      box('minf', [
        box('stbl', [stsdWith(sample)]),
      ]),
    ]),
  ]);
}

function videoTrack() {
  return box('trak', [
    box('mdia', [
      hdlr('vide'),
      box('minf', [
        box('stbl', [
          stsdWith(box('avc1', Buffer.alloc(8))),
        ]),
      ]),
    ]),
  ]);
}

function ftypBox() {
  return box('ftyp', [
    fourcc('isom'),
    u32(0),
    fourcc('isom'),
    fourcc('iso2'),
    fourcc('mp41'),
  ]);
}

function chromeLikeFtyp() {
  return box('ftyp', [
    fourcc('isom'),
    u32(0),
    fourcc('isom'),
    fourcc('iso2'),
    fourcc('mp41'),
    fourcc('M4A '),
  ]);
}

function buildAudioMp4(options = {}) {
  const {
    withEsds = false,
    includeVideo = false,
    includeAudio = true,
    ftyp = ftypBox(),
    extraMoov = [],
    codecBox = null,
  } = options;
  const tracks = [];
  if (includeAudio) tracks.push(audioTrack({ withEsds, codecBox }));
  if (includeVideo) tracks.push(videoTrack());
  return Buffer.concat([ftyp, box('moov', [...tracks, ...extraMoov])]);
}

describe('validateMetaOutboundAudioBytes — contrato', () => {
  it('AB-01: MP4 áudio estruturalmente válido com mp4a, codec não confirmado', () => {
    const result = validateMetaOutboundAudioBytes(buildAudioMp4());
    expect(result).toEqual({
      ok: true,
      container: 'mp4',
      sampleEntry: 'mp4a',
      hasAudio: true,
      hasVideo: false,
      audioCodec: 'unconfirmed',
      aacProfile: null,
    });
  });

  it('AB-02: sample entry mp4a é exigida via stsd, não por texto solto', () => {
    const result = validateMetaOutboundAudioBytes(buildAudioMp4());
    expect(result.ok).toBe(true);
    expect(result.sampleEntry).toBe('mp4a');
  });

  it('AB-03: AAC-LC confirmado por esds + AudioSpecificConfig', () => {
    const result = validateMetaOutboundAudioBytes(buildAudioMp4({ withEsds: true }));
    expect(result).toEqual({
      ok: true,
      container: 'mp4',
      sampleEntry: 'mp4a',
      hasAudio: true,
      hasVideo: false,
      audioCodec: 'aac',
      aacProfile: 'lc',
    });
  });

  it('AB-04: mp4a sem esds permanece inconclusivo — não afirma AAC', () => {
    const result = validateMetaOutboundAudioBytes(buildAudioMp4({ withEsds: false }));
    expect(result.ok).toBe(true);
    expect(result.audioCodec).toBe('unconfirmed');
    expect(result.aacProfile).toBeNull();
  });

  it('AB-05: trilha de vídeo é rejeitada', () => {
    const result = validateMetaOutboundAudioBytes(buildAudioMp4({
      includeAudio: false,
      includeVideo: true,
    }));
    expect(result).toEqual({
      ok: false,
      code: 'invalid_audio_format',
      reason: 'video_track_present',
    });
  });

  it('AB-06: moov sem trilha de áudio é rejeitado', () => {
    const result = validateMetaOutboundAudioBytes(Buffer.concat([
      ftypBox(),
      box('moov', [box('mvhd', Buffer.alloc(4))]),
    ]));
    expect(result).toEqual({
      ok: false,
      code: 'invalid_audio_format',
      reason: 'missing_audio_track',
    });
  });

  it('AB-07: WebM/EBML é rejeitado', () => {
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]);
    const result = validateMetaOutboundAudioBytes(webm);
    expect(result).toEqual({
      ok: false,
      code: 'unsupported_audio_container',
      reason: 'webm_or_ebml',
    });
  });

  it('AB-08: OGG é rejeitado', () => {
    const ogg = Buffer.from('OggS\0\x02\0\0\0\0\0\0', 'binary');
    const result = validateMetaOutboundAudioBytes(ogg);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('unsupported_audio_container');
    expect(result.reason).toBe('ogg');
  });

  it('AB-09: MP3 (ID3) é rejeitado', () => {
    const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);
    const result = validateMetaOutboundAudioBytes(mp3);
    expect(result).toEqual({
      ok: false,
      code: 'unsupported_audio_container',
      reason: 'mpeg',
    });
  });

  it('AB-09b: MP3 com frame sync é rejeitado', () => {
    const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const result = validateMetaOutboundAudioBytes(mp3);
    expect(result.code).toBe('unsupported_audio_container');
    expect(result.reason).toBe('mpeg');
  });

  it('AB-10: buffer vazio', () => {
    expect(validateMetaOutboundAudioBytes(Buffer.alloc(0))).toEqual({
      ok: false,
      code: 'invalid_audio_input',
      reason: 'empty',
    });
  });

  it('AB-11: entradas não binárias', () => {
    for (const value of [null, undefined, '', 123, { type: 'audio/mp4' }, [], 'audio/mp4']) {
      const result = validateMetaOutboundAudioBytes(value);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('invalid_audio_input');
      expect(result.reason).toBe('invalid_input');
    }
  });

  it('AB-12: arquivo truncado', () => {
    const full = ftypBox();
    const truncated = full.subarray(0, 10);
    const result = validateMetaOutboundAudioBytes(truncated);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid_audio_format');
    expect(result.reason).toBe('box_size_exceeds_container');
  });

  it('AB-13: ftyp isolado não comprova áudio', () => {
    const result = validateMetaOutboundAudioBytes(ftypBox());
    expect(result).toEqual({
      ok: false,
      code: 'invalid_audio_format',
      reason: 'missing_moov',
    });
  });

  it('AB-14: sequência textual mp4a em bytes arbitrários não é aceite', () => {
    const junk = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from('xxxxmp4aesdsftypmoovtrak'),
      Buffer.alloc(32, 0x41),
    ]);
    const result = validateMetaOutboundAudioBytes(junk);
    expect(result.ok).toBe(false);
    expect(result.audioCodec).toBeUndefined();
  });

  it('AB-14b: mp4a dentro de free/mdat, sem stsd, não é aceite', () => {
    const result = validateMetaOutboundAudioBytes(Buffer.concat([
      ftypBox(),
      box('moov', [box('free', Buffer.from('xxxxmp4axxxx'))]),
    ]));
    expect(result).toEqual({
      ok: false,
      code: 'invalid_audio_format',
      reason: 'missing_audio_track',
    });
  });

  it('AB-15: box com tamanho menor que o cabeçalho', () => {
    const result = validateMetaOutboundAudioBytes(Buffer.from([
      0x00, 0x00, 0x00, 0x04, 0x66, 0x74, 0x79, 0x70,
    ]));
    expect(result).toEqual({
      ok: false,
      code: 'invalid_audio_format',
      reason: 'box_size_smaller_than_header',
    });
  });

  it('AB-16: box com tamanho maior que o arquivo', () => {
    const result = validateMetaOutboundAudioBytes(Buffer.from([
      0x00, 0x00, 0x04, 0x00, 0x66, 0x74, 0x79, 0x70,
      0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
    ]));
    expect(result).toEqual({
      ok: false,
      code: 'invalid_audio_format',
      reason: 'box_size_exceeds_container',
    });
  });

  it('AB-17: box de tamanho estendido malformado (size=1 sem largesize)', () => {
    const result = validateMetaOutboundAudioBytes(Buffer.from([
      0x00, 0x00, 0x00, 0x01, 0x66, 0x74, 0x79, 0x70,
    ]));
    expect(result).toEqual({
      ok: false,
      code: 'invalid_audio_format',
      reason: 'extended_box_size_malformed',
    });
  });

  it('AB-17b: box de tamanho estendido presente é rejeitado', () => {
    const result = validateMetaOutboundAudioBytes(Buffer.from([
      0x00, 0x00, 0x00, 0x01, 0x66, 0x74, 0x79, 0x70,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20,
      0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
    ]));
    expect(result).toEqual({
      ok: false,
      code: 'invalid_audio_format',
      reason: 'extended_box_size_unsupported',
    });
  });

  it('AB-18: profundidade excessiva de boxes', () => {
    let inner = box('free', Buffer.alloc(4));
    for (let i = 0; i < META_OUTBOUND_AUDIO_MAX_BOX_DEPTH + 2; i += 1) {
      inner = box('moov', inner);
    }
    const result = validateMetaOutboundAudioBytes(Buffer.concat([ftypBox(), inner]));
    expect(result).toEqual({
      ok: false,
      code: 'invalid_audio_format',
      reason: 'max_box_depth',
    });
  });

  it('AB-19: quantidade excessiva de boxes', () => {
    const frees = [];
    for (let i = 0; i < META_OUTBOUND_AUDIO_MAX_BOX_COUNT + 8; i += 1) {
      frees.push(box('free', Buffer.alloc(0)));
    }
    const result = validateMetaOutboundAudioBytes(Buffer.concat([ftypBox(), ...frees]));
    expect(result).toEqual({
      ok: false,
      code: 'invalid_audio_format',
      reason: 'max_box_count',
    });
  });

  it('AB-20: arquivo acima do limite de 4 MB', () => {
    const result = validateMetaOutboundAudioBytes(
      Buffer.alloc(META_OUTBOUND_AUDIO_MAX_BYTES + 1),
    );
    expect(result).toEqual({
      ok: false,
      code: 'audio_too_large',
      reason: 'too_large',
    });
  });

  it('AB-21: MIME externo MP4 é irrelevante — bytes WebM falham', () => {
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86, 0x81, 0x01]);
    const result = validateMetaOutboundAudioBytes(webm);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('unsupported_audio_container');
    expect(result.reason).toBe('webm_or_ebml');
  });

  it('AB-22: arquivo com vide e soun é rejeitado', () => {
    const result = validateMetaOutboundAudioBytes(buildAudioMp4({
      withEsds: true,
      includeVideo: true,
    }));
    expect(result).toEqual({
      ok: false,
      code: 'invalid_audio_format',
      reason: 'video_track_present',
    });
  });
});

describe('validateMetaOutboundAudioBytes — evidência de codec', () => {
  it('AB-23: esds com objectTypeIndication não-AAC é rejeitado', () => {
    const result = validateMetaOutboundAudioBytes(buildAudioMp4({
      codecBox: esdsMp3InMp4(),
    }));
    expect(result).toEqual({
      ok: false,
      code: 'invalid_audio_format',
      reason: 'unsupported_audio_codec',
    });
  });

  it('AB-24: aceita Uint8Array equivalente ao Buffer', () => {
    const buf = buildAudioMp4({ withEsds: true });
    const result = validateMetaOutboundAudioBytes(new Uint8Array(buf));
    expect(result.ok).toBe(true);
    expect(result.audioCodec).toBe('aac');
    expect(result.aacProfile).toBe('lc');
  });

  it('AB-28: Uint8Array puro sem métodos Buffer (ambiente browser)', () => {
    const bytes = Uint8Array.from(buildAudioMp4({ withEsds: true }));
    expect(Buffer.isBuffer(bytes)).toBe(false);
    expect(typeof bytes.readUInt32BE).toBe('undefined');
    const result = validateMetaOutboundAudioBytes(bytes);
    expect(result.ok).toBe(true);
    expect(result.audioCodec).toBe('aac');
    expect(result.aacProfile).toBe('lc');
  });

  it('AB-25: ftyp Chrome-like (isom) + AAC-LC sintético', () => {
    const fixture = buildAudioMp4({
      withEsds: true,
      ftyp: chromeLikeFtyp(),
    });
    expect(fixture.subarray(4, 12).toString('ascii')).toBe('ftypisom');
    expect(fixture[0]).toBe(0x00);
    const result = validateMetaOutboundAudioBytes(fixture);
    expect(result.ok).toBe(true);
    expect(result.container).toBe('mp4');
    expect(result.sampleEntry).toBe('mp4a');
    expect(result.audioCodec).toBe('aac');
    expect(result.aacProfile).toBe('lc');
    expect(result.hasVideo).toBe(false);
  });

  it('AB-26: resultado de falha não inclui bytes nem MIME', () => {
    const result = validateMetaOutboundAudioBytes(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/1a45dfa3/i);
    expect(result).not.toHaveProperty('bytes');
    expect(result).not.toHaveProperty('mime');
  });

  it('AB-27: soun sem mp4a em stsd falha', () => {
    const trak = box('trak', [
      box('mdia', [
        hdlr('soun'),
        box('minf', [
          box('stbl', [
            stsdWith(box('Opus', Buffer.alloc(28))),
          ]),
        ]),
      ]),
    ]);
    const result = validateMetaOutboundAudioBytes(Buffer.concat([
      ftypBox(),
      box('moov', trak),
    ]));
    expect(result).toEqual({
      ok: false,
      code: 'invalid_audio_format',
      reason: 'missing_mp4a_sample_entry',
    });
  });
});
