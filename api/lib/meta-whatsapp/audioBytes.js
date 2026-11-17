// =============================================================================
// audioBytes.js — Validador estrutural de áudio outbound Meta (B3.1)
//
// Função pura: inspecta bytes ISO-BMFF (MP4/M4A) sem rede, banco, filesystem,
// Graph, S3 ou logs. Destinada ao futuro endpoint de envio de áudio.
//
// NÃO altera a whitelist inbound em mediaConstants.js.
// NÃO declara AAC apenas por MIME, ftyp ou ocorrência textual de "mp4a".
// =============================================================================

export const META_OUTBOUND_AUDIO_MAX_BYTES = 4 * 1024 * 1024;
export const META_OUTBOUND_AUDIO_MAX_BOX_COUNT = 512;
export const META_OUTBOUND_AUDIO_MAX_BOX_DEPTH = 12;

const CONTAINER_TYPES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf']);
const VIDEO_HANDLERS = new Set(['vide']);
const VIDEO_SAMPLE_TYPES = new Set(['avc1', 'avc3', 'hev1', 'hvc1', 'vp09', 'av01', 'mp4v', 'encv']);
const AAC_OBJECT_TYPE_INDICATIONS = new Set([0x40, 0x66, 0x67, 0x68]);
const DESC_ES = 0x03;
const DESC_DECODER_CONFIG = 0x04;
const DESC_DECODER_SPECIFIC = 0x05;
const MAX_DESCRIPTORS = 32;

const CODE_INPUT = 'invalid_audio_input';
const CODE_TOO_LARGE = 'audio_too_large';
const CODE_CONTAINER = 'unsupported_audio_container';
const CODE_FORMAT = 'invalid_audio_format';

function fail(code, reason) {
  return { ok: false, code, reason };
}

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return null;
}

function readType(buf, offset) {
  return String.fromCharCode(buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]);
}

function sniffNonMp4(buf) {
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return 'webm_or_ebml';
  }
  if (buf.length >= 4 && buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) {
    return 'ogg';
  }
  if (buf.length >= 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    return 'mpeg';
  }
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
    return 'mpeg';
  }
  return null;
}

function readBoxHeader(buf, offset, end) {
  if (offset + 8 > end) return { reason: 'truncated' };
  const size32 = buf.readUInt32BE(offset);
  const type = readType(buf, offset + 4);

  if (size32 === 1) {
    if (offset + 16 > end) return { reason: 'extended_box_size_malformed' };
    return { reason: 'extended_box_size_unsupported' };
  }

  if (size32 === 0) {
    const size = end - offset;
    if (size < 8) return { reason: 'box_size_smaller_than_header' };
    return { type, end, payloadStart: offset + 8, payloadEnd: end };
  }

  if (size32 < 8) return { reason: 'box_size_smaller_than_header' };
  if (offset + size32 > end) return { reason: 'box_size_exceeds_container' };
  return {
    type,
    end: offset + size32,
    payloadStart: offset + 8,
    payloadEnd: offset + size32,
  };
}

function readDescriptorLength(buf, offset, end) {
  let length = 0;
  let headerSize = 0;
  while (headerSize < 4) {
    if (offset + headerSize >= end) return null;
    const b = buf[offset + headerSize];
    headerSize += 1;
    length = (length << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) {
      return { length, headerSize };
    }
  }
  return null;
}

function skipEsDescriptorHeader(buf, start, end) {
  if (start + 3 > end) return null;
  const flags = buf[start + 2];
  let offset = start + 3;
  if (flags & 0x80) {
    if (offset + 2 > end) return null;
    offset += 2;
  }
  if (flags & 0x40) {
    if (offset >= end) return null;
    const urlLen = buf[offset];
    offset += 1 + urlLen;
    if (offset > end) return null;
  }
  if (flags & 0x20) {
    if (offset + 2 > end) return null;
    offset += 2;
  }
  return offset;
}

function findDecoderSpecificInfo(buf, start, end) {
  let offset = start;
  for (let i = 0; i < MAX_DESCRIPTORS && offset + 2 <= end; i += 1) {
    const tag = buf[offset];
    const lenInfo = readDescriptorLength(buf, offset + 1, end);
    if (!lenInfo) return null;
    const payloadStart = offset + 1 + lenInfo.headerSize;
    const payloadEnd = payloadStart + lenInfo.length;
    if (payloadEnd > end || payloadStart > payloadEnd) return null;
    if (tag === DESC_DECODER_SPECIFIC) {
      return { start: payloadStart, end: payloadEnd };
    }
    offset = payloadEnd;
  }
  return null;
}

function parseDecoderConfig(buf, start, end) {
  if (end - start < 13) return null;
  const objectTypeIndication = buf[start];
  const dsi = findDecoderSpecificInfo(buf, start + 13, end);
  let audioObjectType = null;
  if (dsi && dsi.end > dsi.start) {
    audioObjectType = (buf[dsi.start] >> 3) & 0x1f;
    if (audioObjectType === 31) audioObjectType = null;
  }
  return { objectTypeIndication, audioObjectType };
}

function parseMpeg4Descriptors(buf, start, end) {
  let offset = start;
  for (let i = 0; i < MAX_DESCRIPTORS && offset + 2 <= end; i += 1) {
    const tag = buf[offset];
    const lenInfo = readDescriptorLength(buf, offset + 1, end);
    if (!lenInfo) return null;
    const payloadStart = offset + 1 + lenInfo.headerSize;
    const payloadEnd = payloadStart + lenInfo.length;
    if (payloadEnd > end || payloadStart > payloadEnd) return null;

    if (tag === DESC_ES) {
      const inner = skipEsDescriptorHeader(buf, payloadStart, payloadEnd);
      if (inner == null) return null;
      const nested = parseMpeg4Descriptors(buf, inner, payloadEnd);
      if (nested) return nested;
    } else if (tag === DESC_DECODER_CONFIG) {
      return parseDecoderConfig(buf, payloadStart, payloadEnd);
    }

    offset = payloadEnd;
  }
  return null;
}

function parseEsds(buf, payloadStart, payloadEnd, track) {
  if (payloadEnd - payloadStart < 4) return;
  const decoded = parseMpeg4Descriptors(buf, payloadStart + 4, payloadEnd);
  if (!decoded) return;
  if (!AAC_OBJECT_TYPE_INDICATIONS.has(decoded.objectTypeIndication)) {
    track.unsupportedCodec = true;
    return;
  }
  track.audioCodec = 'aac';
  if (decoded.audioObjectType === 2) track.aacProfile = 'lc';
}

function parseMp4a(buf, payloadStart, payloadEnd, track, state) {
  // AudioSampleEntry fields occupy 28 bytes after the box header.
  if (payloadEnd - payloadStart < 28) {
    state.reason = 'malformed_mp4a';
    return;
  }
  track.hasMp4a = true;
  let offset = payloadStart + 28;
  while (offset < payloadEnd) {
    if (state.boxCount >= META_OUTBOUND_AUDIO_MAX_BOX_COUNT) {
      state.reason = 'max_box_count';
      return;
    }
    state.boxCount += 1;
    const hdr = readBoxHeader(buf, offset, payloadEnd);
    if (hdr.reason) {
      state.reason = hdr.reason;
      return;
    }
    if (hdr.type === 'esds') parseEsds(buf, hdr.payloadStart, hdr.payloadEnd, track);
    offset = hdr.end;
  }
}

function parseStsd(buf, payloadStart, payloadEnd, track, state) {
  if (payloadEnd - payloadStart < 8) {
    state.reason = 'malformed_stsd';
    return;
  }
  let offset = payloadStart + 8;
  while (offset < payloadEnd) {
    if (state.boxCount >= META_OUTBOUND_AUDIO_MAX_BOX_COUNT) {
      state.reason = 'max_box_count';
      return;
    }
    state.boxCount += 1;
    const hdr = readBoxHeader(buf, offset, payloadEnd);
    if (hdr.reason) {
      state.reason = hdr.reason;
      return;
    }
    if (VIDEO_SAMPLE_TYPES.has(hdr.type)) track.hasVideoSample = true;
    if (hdr.type === 'mp4a') parseMp4a(buf, hdr.payloadStart, hdr.payloadEnd, track, state);
    if (state.reason) return;
    offset = hdr.end;
  }
}

function parseHdlr(buf, payloadStart, payloadEnd, track) {
  if (payloadEnd - payloadStart < 12) return;
  track.handler = readType(buf, payloadStart + 8);
}

function walk(buf, start, end, depth, state, track) {
  if (state.reason) return;
  if (depth > META_OUTBOUND_AUDIO_MAX_BOX_DEPTH) {
    state.reason = 'max_box_depth';
    return;
  }

  let offset = start;
  while (offset < end) {
    if (state.boxCount >= META_OUTBOUND_AUDIO_MAX_BOX_COUNT) {
      state.reason = 'max_box_count';
      return;
    }
    state.boxCount += 1;

    const hdr = readBoxHeader(buf, offset, end);
    if (hdr.reason) {
      state.reason = hdr.reason;
      return;
    }

    if (depth === 0 && state.boxCount === 1 && hdr.type !== 'ftyp') {
      state.reason = 'ftyp_not_first';
      return;
    }
    if (hdr.type === 'ftyp') {
      if (hdr.payloadEnd - hdr.payloadStart < 8) {
        state.reason = 'malformed_ftyp';
        return;
      }
      state.hasFtyp = true;
    }
    if (hdr.type === 'moov') state.hasMoov = true;

    if (hdr.type === 'trak') {
      const child = {
        handler: null,
        hasMp4a: false,
        hasVideoSample: false,
        audioCodec: 'unconfirmed',
        aacProfile: null,
        unsupportedCodec: false,
      };
      state.tracks.push(child);
      walk(buf, hdr.payloadStart, hdr.payloadEnd, depth + 1, state, child);
    } else if (hdr.type === 'hdlr' && track) {
      parseHdlr(buf, hdr.payloadStart, hdr.payloadEnd, track);
    } else if (hdr.type === 'stsd' && track) {
      parseStsd(buf, hdr.payloadStart, hdr.payloadEnd, track, state);
    } else if (CONTAINER_TYPES.has(hdr.type)) {
      walk(buf, hdr.payloadStart, hdr.payloadEnd, depth + 1, state, track);
    }

    if (state.reason) return;
    offset = hdr.end;
  }
}

function interpret(state) {
  if (state.reason) {
    if (state.reason === 'webm_or_ebml' || state.reason === 'ogg' || state.reason === 'mpeg') {
      return fail(CODE_CONTAINER, state.reason);
    }
    return fail(CODE_FORMAT, state.reason);
  }
  if (!state.hasFtyp) return fail(CODE_FORMAT, 'missing_ftyp');
  if (!state.hasMoov) return fail(CODE_FORMAT, 'missing_moov');

  let hasVideo = false;
  let audioTrack = null;
  for (const track of state.tracks) {
    if (VIDEO_HANDLERS.has(track.handler) || track.hasVideoSample) hasVideo = true;
    if (track.handler === 'soun') {
      if (track.unsupportedCodec) return fail(CODE_FORMAT, 'unsupported_audio_codec');
      if (!audioTrack) audioTrack = track;
    }
  }

  if (hasVideo) return fail(CODE_FORMAT, 'video_track_present');
  if (!audioTrack) return fail(CODE_FORMAT, 'missing_audio_track');
  if (!audioTrack.hasMp4a) return fail(CODE_FORMAT, 'missing_mp4a_sample_entry');

  return {
    ok: true,
    container: 'mp4',
    sampleEntry: 'mp4a',
    hasAudio: true,
    hasVideo: false,
    audioCodec: audioTrack.audioCodec === 'aac' ? 'aac' : 'unconfirmed',
    aacProfile: audioTrack.audioCodec === 'aac' ? audioTrack.aacProfile : null,
  };
}

/**
 * Valida bytes de áudio outbound para envio futuro via Meta Cloud API.
 *
 * @param {Buffer|Uint8Array} bytes arquivo completo
 * @returns {{
 *   ok: true,
 *   container: 'mp4',
 *   sampleEntry: 'mp4a',
 *   hasAudio: true,
 *   hasVideo: false,
 *   audioCodec: 'aac'|'unconfirmed',
 *   aacProfile: 'lc'|null,
 * } | {
 *   ok: false,
 *   code: 'invalid_audio_input'|'audio_too_large'|'unsupported_audio_container'|'invalid_audio_format',
 *   reason: string,
 * }}
 */
export function validateMetaOutboundAudioBytes(bytes) {
  const buf = toBuffer(bytes);
  if (!buf) return fail(CODE_INPUT, 'invalid_input');
  if (buf.length === 0) return fail(CODE_INPUT, 'empty');
  if (buf.length > META_OUTBOUND_AUDIO_MAX_BYTES) return fail(CODE_TOO_LARGE, 'too_large');

  const sniffed = sniffNonMp4(buf);
  if (sniffed) return fail(CODE_CONTAINER, sniffed);

  const state = {
    boxCount: 0,
    hasFtyp: false,
    hasMoov: false,
    tracks: [],
    reason: null,
  };
  walk(buf, 0, buf.length, 0, state, null);
  return interpret(state);
}
