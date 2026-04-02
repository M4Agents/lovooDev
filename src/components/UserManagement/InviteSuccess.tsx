// =====================================================
// COMPONENTE DE SUCESSO DE CONVITE - MODO DESENVOLVIMENTO
// =====================================================

import React, { useState } from 'react';
import { CheckCircle, Copy, ExternalLink, X, Mail } from 'lucide-react';

interface InviteSuccessProps {
  isOpen: boolean;
  onClose: () => void;
  inviteData: {
    email: string;
    inviteUrl?: string;
    mode: 'real' | 'simulated';
    message?: string;
  };
}

export const InviteSuccess: React.FC<InviteSuccessProps> = ({ isOpen, onClose, inviteData }) => {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = async () => {
    if (inviteData.inviteUrl) {
      try {
        await navigator.clipboard.writeText(inviteData.inviteUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (error) {
        console.error('Erro ao copiar link:', error);
      }
    }
  };

  const handleOpenLink = () => {
    if (inviteData.inviteUrl) {
      window.open(inviteData.inviteUrl, '_blank');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {inviteData.mode === 'real' ? 'Convite Enviado!' : 'Convite Criado!'}
              </h2>
              <p className="text-sm text-slate-600">
                {inviteData.mode === 'real' ? 'Email enviado com sucesso' : 'Link de convite gerado'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Email do usuário */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <Mail className="w-5 h-5 text-slate-600" />
              <div>
                <p className="text-sm font-medium text-slate-900">Email do usuário</p>
                <p className="text-sm text-slate-600">{inviteData.email}</p>
              </div>
            </div>
          </div>

          {/* Status do convite */}
          {inviteData.mode === 'real' ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <h4 className="text-sm font-medium text-green-900 mb-1">Convite Real Enviado</h4>
                  <p className="text-sm text-green-700">
                    O usuário receberá um email com instruções para ativar a conta.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-blue-600 mt-0.5" />
                <div>
                  <h4 className="text-sm font-medium text-blue-900 mb-1">Convite Simulado</h4>
                  <p className="text-sm text-blue-700 mb-3">
                    {inviteData.message || 'Configure Admin API para envio real de emails.'}
                  </p>
                  
                  {/* Link de convite para teste */}
                  {inviteData.inviteUrl && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-blue-900">Link de teste:</p>
                      <div className="bg-white border border-blue-200 rounded p-2">
                        <div className="flex items-center gap-2">
                          <code className="text-xs text-blue-800 flex-1 break-all">
                            {inviteData.inviteUrl}
                          </code>
                          <div className="flex gap-1">
                            <button
                              onClick={handleCopyLink}
                              className="p-1 hover:bg-blue-100 rounded transition-colors"
                              title="Copiar link"
                            >
                              <Copy className="w-4 h-4 text-blue-600" />
                            </button>
                            <button
                              onClick={handleOpenLink}
                              className="p-1 hover:bg-blue-100 rounded transition-colors"
                              title="Abrir link"
                            >
                              <ExternalLink className="w-4 h-4 text-blue-600" />
                            </button>
                          </div>
                        </div>
                      </div>
                      {copied && (
                        <p className="text-xs text-green-600">Link copiado!</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Próximos passos */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <h4 className="text-sm font-medium text-slate-900 mb-2">Próximos passos:</h4>
            <ul className="text-sm text-slate-600 space-y-1">
              {inviteData.mode === 'real' ? (
                <>
                  <li>• O usuário receberá o email de convite</li>
                  <li>• Ele deve clicar no link para ativar a conta</li>
                  <li>• Após ativar, poderá fazer login normalmente</li>
                </>
              ) : (
                <>
                  <li>• Use o link acima para testar a página de aceite</li>
                  <li>• Configure Admin API para envio real de emails</li>
                  <li>• O usuário foi criado no sistema</li>
                </>
              )}
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end p-6 border-t border-slate-200">
          <button
            onClick={onClose}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
};
