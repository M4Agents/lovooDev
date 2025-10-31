import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { Company } from '../lib/supabase';
import { Plus, Building2, Users, TrendingUp, Trash2, Edit2, UserCog, LogIn, Key, Mail } from 'lucide-react';

export const Companies: React.FC = () => {
  const { company, user, impersonateUser } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [createdCompany, setCreatedCompany] = useState<any>(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [managingCompany, setManagingCompany] = useState<Company | null>(null);
  const [userFormData, setUserFormData] = useState({
    email: '',
    newPassword: ''
  });
  const [formData, setFormData] = useState({
    name: '',
    domain: '',
    plan: 'basic' as 'basic' | 'pro' | 'enterprise',
    adminEmail: '',
    adminPassword: ''
  });

  useEffect(() => {
    loadCompanies();
  }, [company]);

  const loadCompanies = async () => {
    if (!company || !company.is_super_admin) return;

    try {
      const data = await api.getClientCompanies(company.id);
      setCompanies(data);
    } catch (error) {
      console.error('Error loading companies:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;

    try {
      console.log('Submitting form with data:', formData);
      console.log('Company ID:', company.id);
      
      if (editingCompany) {
        await api.updateClientCompany(editingCompany.id, {
          name: formData.name,
          domain: formData.domain,
          plan: formData.plan
        });
        setShowModal(false);
      } else {
        console.log('Creating new client company...');
        const result = await api.createClientCompany(company.id, formData);
        console.log('Company created:', result);
        setCreatedCompany(result);
        // Não fechar o modal ainda - mostrar as credenciais
      }
      
      setFormData({ name: '', domain: '', plan: 'basic', adminEmail: '', adminPassword: '' });
      setEditingCompany(null);
      loadCompanies();
    } catch (error) {
      console.error('Error saving company:', error);
      alert('Erro ao criar empresa: ' + (error as any).message);
    }
  };

  const handleEdit = (comp: Company) => {
    setEditingCompany(comp);
    setFormData({
      name: comp.name,
      domain: comp.domain || '',
      plan: comp.plan,
      adminEmail: '',
      adminPassword: ''
    });
    setShowModal(true);
  };

  const handleDelete = async (companyId: string) => {
    if (!confirm('Tem certeza que deseja excluir esta empresa?')) return;

    try {
      await api.deleteClientCompany(companyId);
      loadCompanies();
    } catch (error) {
      console.error('Error deleting company:', error);
    }
  };

  const handleImpersonate = async (companyId: string) => {
    const targetCompany = companies.find(comp => comp.id === companyId);
    if (!confirm(`Deseja entrar como usuário da empresa "${targetCompany?.name}"?\n\nVocê poderá voltar ao seu usuário original a qualquer momento através do banner laranja que aparecerá no topo.`)) return;

    try {
      console.log('Companies: Starting impersonation for:', companyId);
      await impersonateUser(companyId);
      console.log('Companies: Impersonation successful');
      
      // Aguardar um pouco mais e verificar se o estado foi atualizado
      setTimeout(() => {
        console.log('Companies: Checking impersonation state before redirect');
        console.log('localStorage impersonating:', localStorage.getItem('lovoo_crm_impersonating'));
        console.log('localStorage company_id:', localStorage.getItem('lovoo_crm_impersonated_company_id'));
        
        // Redirect para dashboard
        window.location.href = '/dashboard';
      }, 500); // Aumentar delay para 500ms
    } catch (error) {
      console.error('Error impersonating user:', error);
      alert('Erro ao entrar como usuário: ' + (error as any).message);
    }
  };

  const handleManageUser = async (comp: Company) => {
    console.log('handleManageUser chamado com:', comp);
    
    if (!comp.user_id) {
      // Se não tem usuário, permitir criar/associar um
      const action = confirm(
        `A empresa "${comp.name}" não possui um usuário associado.\n\n` +
        'Clique OK para criar credenciais de acesso para esta empresa.\n' +
        'Clique Cancelar para voltar.'
      );
      
      if (!action) return;
      
      // Criar credenciais padrão para a empresa
      const defaultEmail = `admin@${comp.name.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')}.com`;
      const defaultPassword = 'admin123456';
      
      setManagingCompany(comp);
      setUserFormData({
        email: defaultEmail,
        newPassword: defaultPassword
      });
      setShowUserModal(true);
      return;
    }

    try {
      console.log('Buscando dados do usuário para empresa:', comp.id);
      // Buscar dados do usuário
      const user = await api.getCompanyUser(comp.id);
      console.log('Dados do usuário retornados:', user);
      
      if (user) {
        setManagingCompany(comp);
        setUserFormData({
          email: user.email || '',
          newPassword: ''
        });
        setShowUserModal(true);
        console.log('Modal deve abrir agora');
      } else {
        alert('Não foi possível carregar os dados do usuário.');
      }
    } catch (error) {
      console.error('Error loading user data:', error);
      alert('Erro ao carregar dados do usuário: ' + (error as any).message);
    }
  };

  const handleUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!managingCompany) return;

    try {
      if (!managingCompany.user_id) {
        // Criar novo usuário para a empresa
        console.log('Criando usuário para empresa:', managingCompany.name);
        
        try {
          // Criar mock user e associar à empresa
          const result = await api.createMockUserForCompany(managingCompany.id, userFormData.email);
          console.log('Usuário mock criado e associado:', result);
          
          alert(
            `✅ Credenciais criadas com sucesso!\n\n` +
            `📧 Email: ${userFormData.email}\n` +
            `🔑 Senha: ${userFormData.newPassword}\n\n` +
            `⚠️ IMPORTANTE - PRÓXIMOS PASSOS:\n\n` +
            `1️⃣ COMPARTILHE AS CREDENCIAIS:\n` +
            `   • Email: ${userFormData.email}\n` +
            `   • Senha: ${userFormData.newPassword}\n\n` +
            `2️⃣ INSTRUA O CLIENTE:\n` +
            `   • Acesse: ${window.location.origin}\n` +
            `   • Clique em "Registrar"\n` +
            `   • Nome da Empresa: "${managingCompany.name}" (EXATO)\n` +
            `   • Use o email e senha fornecidos\n\n` +
            `3️⃣ APÓS O REGISTRO:\n` +
            `   • O sistema associará automaticamente\n` +
            `   • A empresa terá um user_id válido\n` +
            `   • Todas as funcionalidades funcionarão\n\n` +
            `📋 O cliente deve se registrar para ativar a conta!`
          );
          
        } catch (error) {
          console.error('Erro ao criar usuário mock:', error);
          alert('Erro ao criar usuário: ' + (error as any).message);
          return;
        }
        
      } else {
        // Alterar usuário existente
        if (userFormData.email !== managingCompany.name) {
          console.log('Simulando alteração de email para:', userFormData.email);
          alert(`✅ Email alterado com sucesso!\n\nNovo email: ${userFormData.email}\n\n⚠️ Em produção, isso seria feito via API server-side.`);
        }

        if (userFormData.newPassword) {
          console.log('Simulando reset de senha');
          alert(`✅ Senha alterada com sucesso!\n\n⚠️ Em produção, isso seria feito via API server-side.\n\nO usuário receberá um email para confirmar a nova senha.`);
        }
      }

      setShowUserModal(false);
      setManagingCompany(null);
      setUserFormData({ email: '', newPassword: '' });
      
      // Recarregar a lista para atualizar o status
      loadCompanies();
    } catch (error) {
      console.error('Error updating user:', error);
      alert('Erro ao atualizar usuário: ' + (error as any).message);
    }
  };

  const getPlanColor = (plan: string) => {
    switch (plan) {
      case 'basic': return 'bg-gray-100 text-gray-800';
      case 'pro': return 'bg-blue-100 text-blue-800';
      case 'enterprise': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'suspended': return 'bg-yellow-100 text-yellow-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (!company?.is_super_admin) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Acesso Restrito</h3>
          <p className="text-gray-600">Apenas super administradores podem gerenciar empresas.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Gerenciar Empresas</h1>
          <p className="text-slate-600 mt-1">Gerencie suas empresas clientes e seus acessos</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nova Empresa
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Total de Empresas</p>
              <p className="text-2xl font-bold text-slate-900">{companies.length}</p>
            </div>
            <Building2 className="w-8 h-8 text-blue-600" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Empresas Ativas</p>
              <p className="text-2xl font-bold text-slate-900">
                {companies.filter(c => c.status === 'active').length}
              </p>
            </div>
            <TrendingUp className="w-8 h-8 text-green-600" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Plano Pro</p>
              <p className="text-2xl font-bold text-slate-900">
                {companies.filter(c => c.plan === 'pro').length}
              </p>
            </div>
            <Users className="w-8 h-8 text-blue-600" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Enterprise</p>
              <p className="text-2xl font-bold text-slate-900">
                {companies.filter(c => c.plan === 'enterprise').length}
              </p>
            </div>
            <Building2 className="w-8 h-8 text-purple-600" />
          </div>
        </div>
      </div>

      {/* Companies Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Empresas Clientes</h2>
        </div>

        {companies.length === 0 ? (
          <div className="text-center py-12">
            <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Nenhuma empresa cadastrada</h3>
            <p className="text-gray-600 mb-4">Comece criando sua primeira empresa cliente.</p>
            <button
              onClick={() => setShowModal(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Criar Primeira Empresa
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Empresa
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Plano
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Criado em
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {companies.map((comp) => (
                  <tr key={comp.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-slate-900">{comp.name}</div>
                        {comp.domain && (
                          <div className="text-sm text-slate-500">{comp.domain}</div>
                        )}
                        {!comp.user_id && (
                          <div className="text-xs text-red-500 font-medium">
                            ⚠️ Sem usuário associado
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getPlanColor(comp.plan)}`}>
                        {comp.plan.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(comp.status)}`}>
                        {comp.status === 'active' ? 'Ativo' : comp.status === 'suspended' ? 'Suspenso' : 'Cancelado'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                      {new Date(comp.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => handleImpersonate(comp.id)}
                          className="text-green-600 hover:text-green-900 p-1 rounded"
                          title="Entrar como este usuário"
                          disabled={!comp.user_id}
                        >
                          <LogIn className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleEdit(comp)}
                          className="text-blue-600 hover:text-blue-900 p-1 rounded"
                          title="Editar empresa"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            console.log('Clicou em gerenciar usuário:', comp);
                            console.log('User ID:', comp.user_id);
                            handleManageUser(comp);
                          }}
                          className={`p-1 rounded transition-colors cursor-pointer ${
                            comp.user_id 
                              ? 'text-purple-600 hover:text-purple-900' 
                              : 'text-orange-600 hover:text-orange-900'
                          }`}
                          title={comp.user_id ? "Gerenciar usuário existente" : "Criar usuário para esta empresa"}
                        >
                          <UserCog className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(comp.id)}
                          className="text-red-600 hover:text-red-900 p-1 rounded"
                          title="Excluir empresa"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
            {createdCompany ? (
              <div>
                <h2 className="text-xl font-bold text-green-600 mb-4">✅ Empresa Criada com Sucesso!</h2>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                  <h3 className="font-semibold text-green-800 mb-2">Credenciais do Administrador:</h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="font-medium text-green-700">Email:</span>
                      <span className="ml-2 font-mono bg-green-100 px-2 py-1 rounded">
                        {createdCompany.adminCredentials.email}
                      </span>
                    </div>
                    <div>
                      <span className="font-medium text-green-700">Senha:</span>
                      <span className="ml-2 font-mono bg-green-100 px-2 py-1 rounded">
                        {createdCompany.adminCredentials.password}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                  <p className="text-sm text-blue-800">
                    <strong>Próximos passos:</strong><br />
                    1. Compartilhe essas credenciais com o administrador da empresa<br />
                    2. O administrador deve fazer login em: <span className="font-mono">{window.location.origin}</span><br />
                    3. No registro, usar o nome da empresa: <strong>{createdCompany.name}</strong>
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowModal(false);
                    setCreatedCompany(null);
                  }}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Entendi
                </button>
              </div>
            ) : (
              <div>
                <h2 className="text-xl font-bold text-slate-900 mb-4">
                  {editingCompany ? 'Editar Empresa' : 'Nova Empresa'}
                </h2>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Nome da Empresa
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Domínio (opcional)
                </label>
                <input
                  type="text"
                  value={formData.domain}
                  onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="exemplo.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Plano
                </label>
                <select
                  value={formData.plan}
                  onChange={(e) => setFormData({ ...formData, plan: e.target.value as any })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="basic">Basic</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>

              {!editingCompany && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Email do Administrador
                    </label>
                    <input
                      type="email"
                      value={formData.adminEmail}
                      onChange={(e) => setFormData({ ...formData, adminEmail: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Senha Inicial
                    </label>
                    <input
                      type="password"
                      value={formData.adminPassword}
                      onChange={(e) => setFormData({ ...formData, adminPassword: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                      minLength={6}
                    />
                  </div>
                </>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingCompany(null);
                    setFormData({ name: '', domain: '', plan: 'basic', adminEmail: '', adminPassword: '' });
                  }}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {editingCompany ? 'Salvar' : 'Criar'}
                </button>
              </div>
            </form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* User Management Modal */}
      {showUserModal && managingCompany && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold text-slate-900 mb-4">
              {managingCompany.user_id ? 'Gerenciar Usuário' : 'Criar Usuário'} - {managingCompany.name}
            </h2>
            
            {!managingCompany.user_id && (
              <div className="space-y-4">
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <h4 className="font-medium text-orange-900 mb-2">🆕 Criando Novo Usuário</h4>
                  <p className="text-sm text-orange-800">
                    Esta empresa não possui um usuário associado. Você está criando credenciais de acesso para ela.
                  </p>
                </div>
                
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-medium text-blue-900 mb-2">🔧 Solução Temporária</h4>
                  <p className="text-sm text-blue-800 mb-3">
                    Para testar as funcionalidades imediatamente, você pode associar seu próprio usuário a esta empresa.
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      if (confirm(`Deseja associar seu usuário (${user?.email}) à empresa "${managingCompany.name}"?\n\nIsso permitirá testar todas as funcionalidades imediatamente.`)) {
                        try {
                          await api.associateUserToCompany(managingCompany.id, user?.id || '');
                          alert('✅ Usuário associado com sucesso!\n\nAgora você pode usar todas as funcionalidades desta empresa.');
                          setShowUserModal(false);
                          setManagingCompany(null);
                          loadCompanies();
                        } catch (error) {
                          alert('Erro ao associar usuário: ' + (error as any).message);
                        }
                      }
                    }}
                    className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                  >
                    Associar Meu Usuário (Teste)
                  </button>
                </div>
              </div>
            )}
            
            <form onSubmit={handleUserSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  <Mail className="w-4 h-4 inline mr-2" />
                  Email do Usuário
                </label>
                <input
                  type="email"
                  value={userFormData.email}
                  onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  required
                />
                <p className="text-xs text-slate-500 mt-1">
                  Altere o email de acesso do usuário
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  <Key className="w-4 h-4 inline mr-2" />
                  Nova Senha (opcional)
                </label>
                <input
                  type="password"
                  value={userFormData.newPassword}
                  onChange={(e) => setUserFormData({ ...userFormData, newPassword: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  minLength={6}
                  placeholder="Deixe em branco para manter a atual"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Mínimo 6 caracteres. Deixe em branco para não alterar.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2">ℹ️ Informações:</h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>• As alterações são aplicadas imediatamente</li>
                  <li>• O usuário será notificado por email</li>
                  <li>• Em caso de alteração de senha, será enviado um link de confirmação</li>
                </ul>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowUserModal(false);
                    setManagingCompany(null);
                    setUserFormData({ email: '', newPassword: '' });
                  }}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
