// =====================================================
// MODAL DE LINK DE CONVITE - REENVIO SEGURO
// =====================================================

import React, { useState, useEffect } from 'react';
import { X, Copy, ExternalLink, Mail, CheckCircle, AlertCircle } from 'lucide-react';
import { CompanyUser } from '../../types/user';
import { supabase } from '../../lib/supabase';

interface InviteLinkProps {
  isOpen: boolean;
  onClose: () => void;
  user: CompanyUser | null;
}

export const InviteLink: React.FC<InviteLinkProps> = ({ isOpen, onClose, user }) => {
  const [copied, setCopied] = useState(false);
  const [realEmail, setRealEmail] = useState<string>('');

  // Buscar email real do usuário quando modal abrir
  useEffect(() => {
    const fetchRealEmail = async () => {
      if (!user || !isOpen) return;
      
      try {
        console.log('InviteLink: Fetching real email for user_id:', user.user_id);
        
        // Buscar email real usando função RPC segura
        const { data: emailResult, error } = await supabase.rpc('get_user_email_safe', {
          p_user_id: user.user_id
        });

        if (!error && emailResult) {
          console.log('InviteLink: Found real email:', emailResult);
          setRealEmail(emailResult);
        } else {
          console.error('InviteLink: Error fetching email:', error);
          setRealEmail(user._email || user.user_id);
        }
      } catch (err) {
        console.error('InviteLink: Error in fetchRealEmail:', err);
        setRealEmail(user._email || user.user_id);
      }
    };

    fetchRealEmail();
  }, [user, isOpen]);

  // Gerar link de convite para o usuário
  const generateInviteLink = (user: CompanyUser): string => {
    if (!user) return '';
    
    // Gerar token baseado no usuário
    const token = btoa(`${user.user_id}:${user.id}:${Date.now()}`);
    
    // Usar email real se disponível, senão fallback
    const emailToUse = realEmail || user._email || user.user_id;
    
    console.log('InviteLink: Generating link with email:', emailToUse);
    
    // Construir URL de convite com domínio oficial
    return `https://app.lovoocrm.com/accept-invite?token=${token}&type=invite&email=${encodeURIComponent(emailToUse)}&user=${user.id}`;
  };

  const handleCopyLink = async () => {
    if (!user) return;
    
    const inviteLink = generateInviteLink(user);
    
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Erro ao copiar link:', error);
    }
  };

  const handleOpenLink = () => {
    if (!user) return;
    
    const inviteLink = generateInviteLink(user);
    window.open(inviteLink, '_blank');
  };

  if (!isOpen || !user) return null;

  const inviteLink = generateInviteLink(user);
  const isRealUser = !user.user_id.startsWith('mock_');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Mail className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Link de Convite
              </h2>
              <p className="text-sm text-slate-600">
                Envie este link para o usuário
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
          {/* Informações do usuário */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-slate-200 flex items-center justify-center">
                <Mail className="w-5 h-5 text-slate-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {realEmail || user._email || user.user_id}
                </p>
                <p className="text-xs text-slate-600">
                  Role: {user.role} • ID: {user.id.slice(0, 8)}...
                </p>
              </div>
            </div>
          </div>

          {/* Status do usuário */}
          <div className={`border rounded-lg p-4 ${
            isRealUser ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'
          }`}>
            <div className="flex items-start gap-3">
              {isRealUser ? (
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
              )}
              <div>
                <h4 className={`text-sm font-medium mb-1 ${
                  isRealUser ? 'text-green-900' : 'text-blue-900'
                }`}>
                  {isRealUser ? 'Usuário Real' : 'Usuário de Teste'}
                </h4>
                <p className={`text-sm ${
                  isRealUser ? 'text-green-700' : 'text-blue-700'
                }`}>
                  {isRealUser ? 
                    'Este usuário foi criado via Supabase Auth e pode receber emails reais.' :
                    'Este é um usuário de teste. Use o link abaixo para simular o processo de ativação.'
                  }
                </p>
              </div>
            </div>
          </div>

          {/* Link de convite */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">
              Link de Convite:
            </label>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <code className="text-xs text-slate-800 flex-1 break-all">
                  {inviteLink}
                </code>
                <div className="flex gap-1">
                  <button
                    onClick={handleCopyLink}
                    className="p-1 hover:bg-slate-200 rounded transition-colors"
                    title="Copiar link"
                  >
                    <Copy className="w-4 h-4 text-slate-600" />
                  </button>
                  <button
                    onClick={handleOpenLink}
                    className="p-1 hover:bg-slate-200 rounded transition-colors"
                    title="Abrir link"
                  >
                    <ExternalLink className="w-4 h-4 text-slate-600" />
                  </button>
                </div>
              </div>
            </div>
            {copied && (
              <p className="text-xs text-green-600 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                Link copiado para a área de transferência!
              </p>
            )}
          </div>

          {/* Instruções */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <h4 className="text-sm font-medium text-slate-900 mb-2">Como usar:</h4>
            <ul className="text-sm text-slate-600 space-y-1">
              <li>1. Copie o link acima</li>
              <li>2. Envie para o usuário via email, WhatsApp ou outro meio</li>
              <li>3. O usuário deve clicar no link para ativar a conta</li>
              <li>4. Após ativar, ele poderá fazer login normalmente</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-slate-200">
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            <Copy className="w-4 h-4" />
            {copied ? 'Copiado!' : 'Copiar Link'}
          </button>
          <button
            onClick={onClose}
            className="text-slate-600 hover:text-slate-800 px-4 py-2 rounded-lg font-medium transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
