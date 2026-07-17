import { describe, it, expect } from 'vitest';
import { normalizeHeatmapCoordinates } from '../normalizeHeatmapCoordinates';

describe('normalizeHeatmapCoordinates', () => {
  it('usa coordinates legado', () => {
    expect(
      normalizeHeatmapCoordinates({
        coordinates: { x: 120, y: 340 },
        event_data: { x: 1, y: 2 },
      })
    ).toEqual({ x: 120, y: 340 });
  });

  it('usa event_data.coordinates quando coluna legada ausente', () => {
    expect(
      normalizeHeatmapCoordinates({
        coordinates: null,
        event_data: { coordinates: { x: 10, y: 20 } },
      })
    ).toEqual({ x: 10, y: 20 });
  });

  it('usa event_data.x/y quando não há coordinates', () => {
    expect(
      normalizeHeatmapCoordinates({
        event_data: { element: 'BUTTON', x: 21, y: 34 },
      })
    ).toEqual({ x: 21, y: 34 });
  });

  it('precedência: legado vence event_data', () => {
    expect(
      normalizeHeatmapCoordinates({
        coordinates: { x: 5, y: 6 },
        event_data: {
          coordinates: { x: 100, y: 200 },
          x: 300,
          y: 400,
        },
      })
    ).toEqual({ x: 5, y: 6 });
  });

  it('aceita x = 0 e y = 0', () => {
    expect(
      normalizeHeatmapCoordinates({ coordinates: { x: 0, y: 0 } })
    ).toEqual({ x: 0, y: 0 });
    expect(
      normalizeHeatmapCoordinates({ event_data: { x: 0, y: 12 } })
    ).toEqual({ x: 0, y: 12 });
    expect(
      normalizeHeatmapCoordinates({ event_data: { x: 12, y: 0 } })
    ).toEqual({ x: 12, y: 0 });
  });

  it('aceita string numérica', () => {
    expect(
      normalizeHeatmapCoordinates({
        event_data: { x: '0', y: '12.5' },
      })
    ).toEqual({ x: 0, y: 12.5 });
  });

  it('rejeita NaN, Infinity, negativo, array e boolean', () => {
    expect(
      normalizeHeatmapCoordinates({ event_data: { x: NaN, y: 1 } })
    ).toBeNull();
    expect(
      normalizeHeatmapCoordinates({ event_data: { x: Infinity, y: 1 } })
    ).toBeNull();
    expect(
      normalizeHeatmapCoordinates({ event_data: { x: -1, y: 1 } })
    ).toBeNull();
    expect(
      normalizeHeatmapCoordinates({ coordinates: [10, 20] })
    ).toBeNull();
    expect(
      normalizeHeatmapCoordinates({ event_data: { x: true, y: 1 } })
    ).toBeNull();
  });

  it('rejeita somente x, somente y ou ausente', () => {
    expect(
      normalizeHeatmapCoordinates({ event_data: { x: 10 } })
    ).toBeNull();
    expect(
      normalizeHeatmapCoordinates({ event_data: { y: 10 } })
    ).toBeNull();
    expect(normalizeHeatmapCoordinates({})).toBeNull();
    expect(
      normalizeHeatmapCoordinates({ event_data: {} })
    ).toBeNull();
    expect(
      normalizeHeatmapCoordinates({ coordinates: null, event_data: null })
    ).toBeNull();
  });
});
