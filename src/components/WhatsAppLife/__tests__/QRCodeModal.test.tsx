// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QRCodeModal, UNKNOWN_QR_GUIDANCE, qrRetryAllowed } from '../QRCodeModal';

const UNKNOWN = 'O resultado da criação anterior ainda não foi confirmado. A mesma operação foi preservada.';
const TEMP = '44444444-4444-4444-8444-444444444444';

function renderModal(qrCodeData: Record<string, unknown>, onRetry = vi.fn(), onGetQRCode = vi.fn()) {
  render(
    <QRCodeModal
      isOpen
      onClose={vi.fn()}
      instanceId={TEMP}
      instanceName="Comercial"
      onGetQRCode={onGetQRCode}
      onRetry={onRetry}
      qrCodeData={qrCodeData}
    />,
  );
  return { onRetry, onGetQRCode };
}

describe('modal de QR', () => {
  afterEach(() => cleanup());

  it('mostra a orientação de operação desconhecida sem oferecer outro QR', () => {
    const { onRetry, onGetQRCode } = renderModal({
      temp_instance_id: TEMP,
      status: 'error',
      recovery_status: 'unknown',
      error_message: UNKNOWN,
    });
    expect(screen.getByText(UNKNOWN)).toBeTruthy();
    expect(screen.getByText(UNKNOWN_QR_GUIDANCE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
    expect(onRetry).not.toHaveBeenCalled();
    expect(onGetQRCode).not.toHaveBeenCalled();
    expect(qrRetryAllowed('unknown')).toBe(false);
  });

  it('permite repetir uma reserva que ainda não foi enviada', () => {
    const { onRetry } = renderModal({
      temp_instance_id: TEMP,
      status: 'error',
      recovery_status: 'reserved',
      error_message: 'Não foi possível iniciar a criação. Tente novamente.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('permite repetir a conexão quando a instância remota já foi confirmada', () => {
    const { onRetry } = renderModal({
      temp_instance_id: TEMP,
      status: 'error',
      recovery_status: 'created_no_qr',
      error_message: 'Não foi possível gerar o QR Code. Tente novamente.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('não usa imagem genérica no lugar do erro específico', () => {
    const moduleSource = readFileSync(
      resolve(import.meta.dirname, '../WhatsAppLifeModule.tsx'),
      'utf8',
    );
    expect(moduleSource).not.toContain('data:image/svg+xml');
    renderModal({
      temp_instance_id: TEMP,
      status: 'error',
      recovery_status: 'unknown',
      error_message: UNKNOWN,
    });
    expect(screen.queryByRole('img')).toBeNull();
  });
});
