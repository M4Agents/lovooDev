// =====================================================
// QR CODE MODAL - MODAL PARA EXIBIR QR CODE
// =====================================================
// Modal para exibir QR Code e instruções de conexão

import React, { useState, useEffect } from 'react';
import { X, Smartphone, RefreshCw, CheckCircle, Clock, AlertCircle } from 'lucide-react';

interface QRCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  instanceId: string;
  instanceName: string;
  onGetQRCode: (instanceId: string) => Promise<{
    success: boolean;
    data?: { qrcode: string; expires_at?: string };
    error?: string;
  }>;
  qrCodeData?: any;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({
  isOpen,
  onClose,
  instanceId,
  instanceName,
  onGetQRCode,
  qrCodeData
}) => {
  const [qrCode, setQrCode] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [timeLeft, setTimeLeft] = useState<number>(0);

  // Usar dados externos quando disponíveis
  useEffect(() => {
    if (qrCodeData) {
      console.log('[QRCodeModal] Usando dados externos:', qrCodeData);
      
      if (qrCodeData.qrcode) {
        setQrCode(qrCodeData.qrcode);
        setLoading(false);
        setError('');
      } else if (qrCodeData.status === 'loading') {
        setLoading(true);
        setError('');
        setQrCode('');
      } else if (qrCodeData.status === 'success') {
        setLoading(false);
        setError('');
      } else if (qrCodeData.error_message) {
        setError(qrCodeData.error_message);
        setLoading(false);
        setQrCode('');
      }
    }
  }, [qrCodeData]);

  // Carregar QR Code quando modal abrir (fallback)
  useEffect(() => {
    if (isOpen && instanceId && instanceId !== 'loading' && !qrCodeData) {
      console.log('[QRCodeModal] Carregando QR Code para:', instanceId);
      loadQRCode();
    }
    
    // Limpar estados quando modal fechar
    if (!isOpen) {
      setQrCode('');
      setLoading(false);
      setError('');
      setExpiresAt('');
    }
  }, [isOpen, instanceId, qrCodeData]);

  // Timer para expiração do QR Code
  useEffect(() => {
    if (!expiresAt) return;

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const expires = new Date(expiresAt).getTime();
      const diff = expires - now;

      if (diff <= 0) {
        setTimeLeft(0);
        setQrCode('');
      } else {
        setTimeLeft(Math.floor(diff / 1000));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  const loadQRCode = async () => {
    if (!instanceId) return;

    try {
      setLoading(true);
      setError('');
      
      const result = await onGetQRCode(instanceId);
      
      if (result.success && result.data?.qrcode) {
        setQrCode(result.data.qrcode);
        setExpiresAt(result.data.expires_at || '');
        setLoading(false); // PARAR LOADING QUANDO QR CODE CHEGAR
      } else if (result.success && result.data?.status === 'created_awaiting_connect') {
        // TRATAR STATUS created_awaiting_connect - CONTINUAR TENTANDO
        setError(''); // Sem erro, apenas processando
        // NÃO PARAR LOADING - CONTINUAR POLLING
      } else if (result.success && result.data?.status === 'loading') {
        // STATUS DE LOADING - CONTINUAR TENTANDO
        setError('');
        // NÃO PARAR LOADING - CONTINUAR POLLING
      } else {
        setError(result.error || 'Erro ao obter QR Code');
        setLoading(false); // PARAR LOADING EM CASO DE ERRO
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar QR Code');
      setLoading(false);
    }
  };

  const formatTimeLeft = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleClose = () => {
    setQrCode('');
    setError('');
    setExpiresAt('');
    setTimeLeft(0);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-3">
            <Smartphone className="h-6 w-6 text-green-600" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Conectar WhatsApp
              </h2>
              {instanceName && (
                <p className="text-sm text-gray-600">{instanceName}</p>
              )}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Instructions */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-900 mb-2">
              Como conectar:
            </h3>
            <ol className="text-sm text-gray-600 space-y-1">
              <li>1. Abra o WhatsApp no seu celular</li>
              <li>2. Toque em Mais opções → Aparelhos conectados</li>
              <li>3. Toque em "Conectar um aparelho"</li>
              <li>4. Escaneie o QR Code abaixo</li>
            </ol>
          </div>

          {/* QR Code Area */}
          <div className="flex justify-center mb-6">
            {loading ? (
              <div className="w-48 h-48 flex items-center justify-center border-2 border-dashed border-gray-300 rounded-lg">
                <div className="text-center">
                  <RefreshCw className="h-8 w-8 text-gray-400 animate-spin mx-auto mb-2" />
                  <p className="text-sm text-gray-500">Gerando QR Code...</p>
                  <p className="text-xs text-gray-400 mt-1">Aguarde alguns segundos</p>
                </div>
              </div>
            ) : error ? (
              <div className="w-48 h-48 flex items-center justify-center border-2 border-dashed border-red-300 rounded-lg bg-red-50">
                <div className="text-center">
                  <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
                  <p className="text-sm text-red-600 mb-3">{error}</p>
                  <button
                    onClick={loadQRCode}
                    className="text-sm text-red-600 hover:text-red-800 underline"
                  >
                    Tentar novamente
                  </button>
                </div>
              </div>
            ) : qrCode ? (
              <div className="text-center">
                <div className="w-48 h-48 border border-gray-200 rounded-lg overflow-hidden">
                  <img 
                    src={qrCode} 
                    alt="QR Code WhatsApp" 
                    className="w-full h-full object-contain"
                  />
                </div>
                
                {/* Timer */}
                {timeLeft > 0 && (
                  <div className="mt-3 flex items-center justify-center gap-2 text-sm text-gray-600">
                    <Clock className="h-4 w-4" />
                    <span>Expira em {formatTimeLeft(timeLeft)}</span>
                  </div>
                )}
                
                {/* Refresh Button */}
                <button
                  onClick={loadQRCode}
                  disabled={loading}
                  className="mt-3 flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  Atualizar QR Code
                </button>
              </div>
            ) : qrCodeData?.status === 'success' ? (
              <div className="w-48 h-48 flex items-center justify-center border-2 border-dashed border-green-300 rounded-lg bg-green-50">
                <div className="text-center">
                  <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
                  <p className="text-sm text-green-600 font-medium">Conectado com Sucesso!</p>
                  <p className="text-xs text-green-500 mt-1">
                    {qrCodeData?.profile_name || 'WhatsApp conectado'}
                  </p>
                  <p className="text-xs text-gray-500 mt-2">Fechando em alguns segundos...</p>
                </div>
              </div>
            ) : (
              <div className="w-48 h-48 flex items-center justify-center border-2 border-dashed border-blue-300 rounded-lg bg-blue-50">
                <div className="text-center">
                  <RefreshCw className="h-8 w-8 text-blue-500 animate-spin mx-auto mb-2" />
                  <p className="text-sm text-blue-600 font-medium">Gerando QR Code</p>
                  <p className="text-xs text-blue-500 mt-1">Aguarde alguns segundos...</p>
                  <button
                    onClick={handleClose}
                    className="mt-3 px-3 py-1 text-xs text-blue-600 hover:text-blue-800 border border-blue-300 rounded hover:bg-blue-100"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Status Info */}
          <div className="mt-6 p-3 bg-blue-50 rounded-lg">
            <div className="flex items-center gap-2 text-sm text-blue-700">
              <CheckCircle className="h-4 w-4" />
              <span>Instância criada com sucesso! Escaneie o QR Code para conectar.</span>
            </div>
          </div>

          {/* Close Button */}
          <div className="mt-6">
            <button
              onClick={handleClose}
              className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
