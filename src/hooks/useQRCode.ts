// =====================================================
// HOOK: useQRCode
// =====================================================
// Hook para gerenciar QR Code das instâncias WhatsApp

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { 
  UseQRCodeReturn,
  WHATSAPP_LIFE_CONSTANTS 
} from '../types/whatsapp-life';

// =====================================================
// HOOK PRINCIPAL
// =====================================================
export const useQRCode = (instanceId?: string): UseQRCodeReturn => {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // =====================================================
  // GERAR QR CODE (ANTI-CORS)
  // =====================================================
  const generateQRCode = useCallback(async (targetInstanceId?: string) => {
    const id = targetInstanceId || instanceId;
    
    if (!id) {
      setError('ID da instância não fornecido');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // ✅ ANTI-CORS: Chamar apenas RPC Function
      const { data, error } = await supabase.rpc('get_whatsapp_life_qrcode_rpc', {
        p_instance_id: id,
      });

      if (error) {
        console.error('[useQRCode] Erro RPC:', error);
        throw new Error('Erro ao comunicar com servidor');
      }

      if (data?.success && data?.data?.qrcode) {
        setQrCode(data.data.qrcode);
      } else {
        throw new Error(data?.error || 'QR Code não disponível');
      }
    } catch (err) {
      console.error('[useQRCode] Erro ao gerar QR Code:', err);
      setError(err instanceof Error ? err.message : 'Erro ao gerar QR Code');
      setQrCode(null);
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  // =====================================================
  // LIMPAR QR CODE
  // =====================================================
  const clearQRCode = useCallback(() => {
    setQrCode(null);
    setError(null);
  }, []);

  // =====================================================
  // EFFECT: AUTO REFRESH QR CODE
  // =====================================================
  useEffect(() => {
    if (!qrCode || !instanceId) return;

    // Atualizar QR Code periodicamente
    const interval = setInterval(() => {
      generateQRCode(instanceId);
    }, WHATSAPP_LIFE_CONSTANTS.QR_CODE_REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [qrCode, instanceId, generateQRCode]);

  // =====================================================
  // RETORNO DO HOOK
  // =====================================================
  return {
    qrCode,
    loading,
    error,
    generateQRCode,
    clearQRCode,
  };
};
