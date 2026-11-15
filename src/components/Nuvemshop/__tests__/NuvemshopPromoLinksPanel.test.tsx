/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NuvemshopPromoLinksPanel } from '../NuvemshopPromoLinksPanel';
import { NuvemshopCouponCreateModal } from '../NuvemshopCouponCreateModal';

const auth = vi.hoisted(() => ({ currentRole: 'admin' as string | null, isImpersonating: false }));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => auth,
}));

vi.mock('../../../services/nuvemshopApi', () => ({
  listNuvemshopCoupons: vi.fn(async () => ({
    coupons: [
      { id: 1, code: 'CUPOM10', type: 'percentage', value: 10, valid: true, used_times: 0, max_uses: null, min_price: null, start_date: null, end_date: null, includes_shipping: false },
      { id: 2, code: 'FRETE', type: 'shipping', value: 0, valid: true, used_times: 0, max_uses: null, min_price: null, start_date: null, end_date: null, includes_shipping: false },
    ],
  })),
  listPromoLinks: vi.fn(async () => []),
  savePromoLink: vi.fn(async () => ({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Live',
    coupon_code: 'FRETE',
    coupon_type: 'shipping',
    destination_path: '/live',
    created_at: '2026-11-15T00:00:00.000Z',
  })),
  copyPromoLink: vi.fn(async () => ({ url: 'https://valleron.store/discount/FRETE?redirect_to=/live', host: 'valleron.store' })),
  createNuvemshopCoupon: vi.fn(),
}));

import { copyPromoLink, savePromoLink } from '../../../services/nuvemshopApi';

describe('links promocionais no painel', () => {
  beforeEach(() => {
    cleanup();
    auth.currentRole = 'admin';
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => {}) },
    });
  });

  it('explica o compartilhamento, salva e copia o link montado pela API', async () => {
    render(<NuvemshopPromoLinksPanel companyId="company" storeId="7680914" />);
    expect(await screen.findByText(/não identifica individualmente/)).toBeTruthy();
    expect(screen.getByText(/não confirma se o cupom ainda está vigente/)).toBeTruthy();
    expect(screen.queryByText(/desconto \+ frete/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Frete grátis' }));
    fireEvent.change(screen.getByLabelText('Nome da campanha'), { target: { value: 'Live' } });
    fireEvent.change(screen.getByLabelText('Cupom'), { target: { value: 'FRETE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar campanha' }));

    await waitFor(() => expect(savePromoLink).toHaveBeenCalledWith('company', '7680914', expect.objectContaining({
      name: 'Live',
      benefit: 'shipping',
      coupon_code: 'FRETE',
      destination: '/live',
    })));

    fireEvent.click(await screen.findByRole('button', { name: 'Copiar link' }));
    await waitFor(() => expect(copyPromoLink).toHaveBeenCalled());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://valleron.store/discount/FRETE?redirect_to=/live');
  });

  it('não envia valor ao criar cupom de frete grátis', async () => {
    const onCreate = vi.fn(async () => {});
    render(
      <NuvemshopCouponCreateModal
        initialType="shipping"
        allowedTypes={['shipping']}
        creating={false}
        error={null}
        onClose={() => {}}
        onCreate={onCreate}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('ex: DESCONTO10'), { target: { value: 'FRETE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar cupom' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0].value).toBeUndefined();
    expect(onCreate.mock.calls[0][0].includes_shipping).toBeUndefined();
    expect(onCreate.mock.calls[0][0].type).toBe('shipping');
  });

  it('mantém o valor ao criar cupom percentual', async () => {
    const onCreate = vi.fn(async () => {});
    render(
      <NuvemshopCouponCreateModal
        creating={false}
        error={null}
        onClose={() => {}}
        onCreate={onCreate}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('ex: DESCONTO10'), { target: { value: 'DEZ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar cupom' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0]).toMatchObject({ type: 'percentage', value: 10, includes_shipping: false });
  });
});
