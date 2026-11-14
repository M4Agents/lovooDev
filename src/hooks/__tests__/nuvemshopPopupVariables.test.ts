import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/api', () => ({ api: {} }));

import { getNuvemshopVariables } from '../useVariables';
import { replaceVariables } from '../../../api/lib/automation/whatsappSender.js';

describe('variáveis do gatilho nuvemshop.popup_signup', () => {
  it('oferece cupom e consentimentos separados, sem dados de pedido', () => {
    const keys = getNuvemshopVariables('nuvemshop.popup_signup').map((item) => item.key);
    expect(keys).toContain('nuvemshop.coupon_code');
    expect(keys).toContain('nuvemshop.coupon_url');
    expect(keys).toContain('nuvemshop.coupon_consent');
    expect(keys).toContain('nuvemshop.promo_consent');
    expect(keys).not.toContain('nuvemshop.order_id');
    expect(keys).not.toContain('nuvemshop.payment_status');
    expect(keys).not.toContain('nuvemshop.checkout_id');
    expect(keys).not.toContain('nuvemshop.tracking_number');
  });

  it('interpola código e link pelo sender sem juntar os consentimentos', () => {
    const message = replaceVariables(
      'Cupom {{nuvemshop.coupon_code}} em {{nuvemshop.coupon_url}}. Cupom {{nuvemshop.coupon_consent}}. Promo {{nuvemshop.promo_consent}}.',
      null,
      null,
      {
        'nuvemshop.coupon_code': 'CUPOM10',
        'nuvemshop.coupon_url': 'https://valleron.store/discount/CUPOM10?redirect_to=/',
        'nuvemshop.coupon_consent': 'true',
        'nuvemshop.promo_consent': 'false',
      },
    );
    expect(message).toBe(
      'Cupom CUPOM10 em https://valleron.store/discount/CUPOM10?redirect_to=/. Cupom true. Promo false.',
    );
  });
});
