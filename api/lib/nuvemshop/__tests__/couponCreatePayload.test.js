import { describe, expect, it } from 'vitest';
import { buildCouponWritePayload, validateCouponData } from '../couponSync.js';

describe('payload de criação de cupom', () => {
  it('não exige nem envia valor para frete grátis', () => {
    expect(validateCouponData({ code: 'frete10', type: 'shipping', value: 10 })).toBe('FRETE10');
    expect(validateCouponData({ code: 'frete', type: 'shipping' })).toBe('FRETE');
    const payload = buildCouponWritePayload({ type: 'shipping', value: 10, includes_shipping: true }, 'FRETE');
    expect(payload.value).toBeUndefined();
    expect(payload.includes_shipping).toBeUndefined();
    expect(payload.type).toBe('shipping');
  });

  it('preserva valor de percentual e de valor fixo', () => {
    expect(validateCouponData({ code: 'dez', type: 'percentage', value: 10 })).toBe('DEZ');
    expect(() => validateCouponData({ code: 'dez', type: 'percentage' })).toThrowError(
      expect.objectContaining({ field: 'value' }),
    );
    expect(() => validateCouponData({ code: 'dez', type: 'percentage', value: 101 })).toThrowError(
      expect.objectContaining({ field: 'value' }),
    );
    expect(buildCouponWritePayload({ type: 'absolute', value: 15.5, includes_shipping: false }, 'FIXO')).toMatchObject({
      type: 'absolute',
      value: '15.5',
      includes_shipping: false,
    });
  });
});
