// =====================================================
// MODAL DE USUÁRIO - CRIAÇÃO/EDIÇÃO SEGURA
// =====================================================

import React, { useState, useEffect } from 'react';
import { X, User, Mail, Shield, Save, AlertCircle } from 'lucide-react';
import { CompanyUser, UserRole, CreateUserRequest, UpdateUserRequest } from '../../types/user';
import { createCompanyUser, updateCompanyUser, validateRoleForCompany, getDefaultPermissions } from '../../services/userApi';
import { useAuth } from '../../contexts/AuthContext';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  user?: CompanyUser | null;
}

export const UserModal: React.FC<UserModalProps> = ({ isOpen, onClose, onSave, user }) => {
  const { company } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    email: '',
    role: 'seller' as UserRole,
    sendInvite: true
  });

  const isEditing = !!user;

  // Reset form quando modal abre/fecha
  useEffect(() => {
    if (isOpen) {
      if (user) {
        // Modo edição
        setFormData({
          email: user.user_id.startsWith('mock_') ? '' : user.user_id,
          role: user.role,
          sendInvite: false
        });
      } else {
        // Modo criação
        setFormData({
          email: '',
          role: 'seller',
          sendInvite: true
        });
      }
      setError(null);
    }
  }, [isOpen, user]);

  // Roles disponíveis baseados no tipo de empresa
  const getAvailableRoles = (): { value: UserRole; label: string; description: string }[] => {
    const companyType = company?.company_type || 'client';
    
    if (companyType === 'parent') {
      return [
        { value: 'super_admin', label: 'Super Admin', description: 'Acesso total ao sistema' },
        { value: 'admin', label: 'Administrador', description: 'Gerencia empresas filhas' },
        { value: 'partner', label: 'Parceiro', description: 'Gerencia próprias contas' }
      ];
    } else {
      return [
        { value: 'admin', label: 'Administrador', description: 'Configurações da empresa' },
        { value: 'manager', label: 'Gerente', description: 'Gestão de leads e vendas' },
        { value: 'seller', label: 'Vendedor', description: 'Leads próprios e chat' }
      ];
    }
  };

  // Salvar usuário
  const handleSave = async () => {
    try {
      setLoading(true);
      setError(null);

      // Validações
      if (!isEditing && !formData.email.trim()) {
        setError('Email é obrigatório');
        return;
      }

      if (!company?.id) {
        setError('Empresa não identificada');
        return;
      }

      // Validar role para tipo de empresa
      if (!validateRoleForCompany(formData.role, company.company_type)) {
        setError(`Role ${formData.role} não é válido para este tipo de empresa`);
        return;
      }

      if (isEditing && user) {
        // Atualizar usuário existente
        const updateRequest: UpdateUserRequest = {
          id: user.id,
          role: formData.role,
          permissions: getDefaultPermissions(formData.role)
        };

        await updateCompanyUser(updateRequest);
      } else {
        // Criar novo usuário
        const createRequest: CreateUserRequest = {
          companyId: company.id,
          email: formData.email.trim(),
          role: formData.role,
          sendInvite: formData.sendInvite
        };

        await createCompanyUser(createRequest);
      }

      onSave();
      onClose();
    } catch (err) {
      console.error('UserModal: Error saving user:', err);
      setError(err instanceof Error ? err.message : 'Erro ao salvar usuário');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <User className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {isEditing ? 'Editar Usuário' : 'Novo Usuário'}
              </h2>
              <p className="text-sm text-slate-600">
                {isEditing ? 'Altere as informações do usuário' : 'Adicione um novo usuário à empresa'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            disabled={loading}
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                <div>
                  <h4 className="text-sm font-medium text-red-900 mb-1">Erro</h4>
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Email (apenas para criação) */}
          {!isEditing && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                <Mail className="w-4 h-4 inline mr-2" />
                Email do Usuário
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="usuario@empresa.com"
                disabled={loading}
              />
              <p className="text-xs text-slate-500 mt-1">
                O usuário receberá um convite por email para acessar o sistema
              </p>
            </div>
          )}

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              <Shield className="w-4 h-4 inline mr-2" />
              Nível de Acesso (Role)
            </label>
            <select
              value={formData.role}
              onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value as UserRole }))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={loading}
            >
              {getAvailableRoles().map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
            
            {/* Descrição do role selecionado */}
            {(() => {
              const selectedRole = getAvailableRoles().find(r => r.value === formData.role);
              return selectedRole ? (
                <p className="text-xs text-slate-500 mt-1">
                  {selectedRole.description}
                </p>
              ) : null;
            })()}
          </div>

          {/* Enviar convite (apenas para criação) */}
          {!isEditing && (
            <div>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={formData.sendInvite}
                  onChange={(e) => setFormData(prev => ({ ...prev, sendInvite: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                  disabled={loading}
                />
                <div>
                  <span className="text-sm font-medium text-slate-700">
                    Enviar convite por email
                  </span>
                  <p className="text-xs text-slate-500">
                    O usuário receberá instruções para acessar o sistema
                  </p>
                </div>
              </label>
            </div>
          )}

          {/* Informações da empresa */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <h4 className="text-sm font-medium text-slate-700 mb-2">Empresa</h4>
            <div className="text-sm text-slate-600">
              <p><strong>Nome:</strong> {company?.name || 'N/A'}</p>
              <p><strong>Tipo:</strong> {company?.company_type === 'parent' ? 'Empresa Pai' : 'Cliente'}</p>
            </div>
          </div>

          {/* Aviso sobre sistema mock */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div>
                <h4 className="text-sm font-medium text-yellow-900 mb-1">Sistema em Desenvolvimento</h4>
                <p className="text-sm text-yellow-700">
                  {isEditing ? 
                    'As alterações serão aplicadas ao registro do usuário no sistema.' :
                    'Por enquanto, será criado um usuário mock para demonstração. A integração completa com autenticação será implementada em breve.'
                  }
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium transition-colors"
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={loading || (!isEditing && !formData.email.trim())}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {loading ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : (
              <Save className="w-4 h-4" />
            )}
            {loading ? 'Salvando...' : (isEditing ? 'Salvar Alterações' : 'Criar Usuário')}
          </button>
        </div>
      </div>
    </div>
  );
};
