/**
 * Lê coordenadas do heatmap como persistidas (sem converter viewport/documento/ratio).
 */

export type HeatmapCoordinates = {
  x: number;
  y: number;
};

export type HeatmapCoordinateEvent = {
  coordinates?: unknown;
  event_data?: unknown;
};

function parseCoordinateValue(value: unknown): number | null {
  if (typeof value === 'number') {
    if (Number.isFinite(value) && value >= 0) {
      return value;
    }
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return null;
}

function parseCoordinatePair(value: unknown): HeatmapCoordinates | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, 'x')) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'y')) {
    return null;
  }

  const x = parseCoordinateValue(record.x);
  const y = parseCoordinateValue(record.y);
  if (x === null || y === null) {
    return null;
  }

  return { x, y };
}

/**
 * Precedência: coordinates legado → event_data.coordinates → event_data.x/y.
 * Um evento produz no máximo um ponto.
 */
export function normalizeHeatmapCoordinates(
  event: HeatmapCoordinateEvent
): HeatmapCoordinates | null {
  const fromLegacy = parseCoordinatePair(event.coordinates);
  if (fromLegacy) {
    return fromLegacy;
  }

  const eventData = event.event_data;
  if (eventData == null || typeof eventData !== 'object' || Array.isArray(eventData)) {
    return null;
  }

  const data = eventData as Record<string, unknown>;

  const fromEventDataCoordinates = parseCoordinatePair(data.coordinates);
  if (fromEventDataCoordinates) {
    return fromEventDataCoordinates;
  }

  if (
    !Object.prototype.hasOwnProperty.call(data, 'x') ||
    !Object.prototype.hasOwnProperty.call(data, 'y')
  ) {
    return null;
  }

  const x = parseCoordinateValue(data.x);
  const y = parseCoordinateValue(data.y);
  if (x === null || y === null) {
    return null;
  }

  return { x, y };
}
