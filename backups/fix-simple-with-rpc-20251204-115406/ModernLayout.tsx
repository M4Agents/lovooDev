import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useRealtimeAnalytics } from '../hooks/useRealtimeAnalytics';
import { supabase } from '../lib/supabase';
import {
  LayoutDashboard,
  Settings,
  LogOut,
  Menu,
  X,
  Activity,
  Building2,
  ChevronLeft,
  Bell,
  Search,
  User,
  Users,
  Crown,
  MessageCircle
} from 'lucide-react';
import { Avatar } from './Avatar';

type ModernLayoutProps = {
  children: React.ReactNode;
};

export const ModernLayout: React.FC<ModernLayoutProps> = ({ children }) => {
  const { user, company, signOut, isImpersonating, originalUser, stopImpersonation, userRoles } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const realtimeStats = useRealtimeAnalytics(company?.id);
  
  // 🔧 NOVO: Estado para dados do usuário (foto e nome)
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [userDisplayName, setUserDisplayName] = useState<string | null>(null);
  
  // 🔧 NOVO: Obter dados do usuário atual para foto de perfil
  const currentUserData = userRoles?.find(role => role.company_id === company?.id);
  
  // 🔧 NOVO: Buscar dados do usuário diretamente (solução simples)
  useEffect(() => {
    const fetchUserData = async () => {
      try {
        console.log('🔧 SIMPLE: Buscando dados do usuário diretamente...', {
          user: !!user,
          userId: user?.id,
          company: !!company,
          companyId: company?.id
        });

        if (!user?.id || !company?.id) {
          console.log('🔧 SIMPLE: User ou company não disponível ainda');
          return;
        }

        // Buscar dados do usuário na empresa atual
        const { data, error } = await supabase
          .from('company_users')
          .select(`
            profile_picture_url,
            companies:company_id (
              id,
              name
            )
          `)
          .eq('user_id', user.id)
          .eq('company_id', company.id)
          .eq('is_active', true)
          .single();

        console.log('🔧 SIMPLE: Resultado da busca:', {
          success: !error,
          data: data,
          error: error
        });

        if (data && !error) {
          setUserPhoto(data.profile_picture_url);
          
          // Buscar display_name do auth.users
          const { data: authUser } = await supabase.auth.getUser();
          const displayName = authUser?.user?.user_metadata?.name || 
                             authUser?.user?.user_metadata?.display_name ||
                             authUser?.user?.email?.split('@')[0];
          
          setUserDisplayName(displayName);
          
          console.log('🔧 SIMPLE: Dados definidos com sucesso:', {
            profilePictureUrl: data.profile_picture_url,
            displayName: displayName
          });
        } else {
          console.warn('🔧 SIMPLE: Erro ou dados não encontrados:', error);
        }
      } catch (error) {
        console.error('🔧 SIMPLE: Erro ao buscar dados do usuário:', error);
      }
    };

    fetchUserData();
  }, [user?.id, company?.id]); // Executar quando user ou company mudar

  // 🔧 DEBUG: Logs para verificar dados do header
  console.log('🔧 ModernLayout Debug:', {
    userRoles: userRoles,
    companyId: company?.id,
    currentUserData: currentUserData,
    profilePictureUrl: currentUserData?.profile_picture_url,
    displayName: currentUserData?.display_name,
    // NOVOS dados da solução simples:
    simpleUserPhoto: userPhoto,
    simpleDisplayName: userDisplayName
  });

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const navItems = [
    { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/chat', icon: MessageCircle, label: 'Chat' },
    { path: '/leads', icon: Users, label: 'Leads' },
    ...(company?.is_super_admin ? [{ path: '/companies', icon: Building2, label: 'Empresas' }] : []),
    ...(company?.is_super_admin ? [{ path: '/plans', icon: Crown, label: 'Planos' }] : []),
    { path: '/settings', icon: Settings, label: 'Configurações' },
  ];

  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Impersonation Banner */}
      {isImpersonating && (
        <div className="bg-orange-500 text-white px-4 py-2 text-center text-sm font-medium">
          <div className="flex items-center justify-center gap-2">
            <User className="w-4 h-4" />
            <span>
              Você está visualizando como: <strong>{company?.name}</strong>
              {originalUser && (
                <span className="ml-2">
                  (Original: {originalUser.email})
                </span>
              )}
            </span>
            <button
              onClick={stopImpersonation}
              className="ml-4 px-3 py-1 bg-orange-600 hover:bg-orange-700 rounded text-xs transition-colors"
            >
              Voltar ao Original
            </button>
          </div>
        </div>
      )}
      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed top-0 left-0 h-full bg-slate-900 text-white z-50
        transition-all duration-300 ease-in-out
        ${sidebarCollapsed ? 'w-16' : 'w-64'}
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo */}
        <div className="relative px-2 py-1 border-b border-slate-800">
          {!sidebarCollapsed && (
            <div className="flex flex-col items-center justify-center w-full">
              <div className="flex items-center justify-center mb-1" style={{ width: '94px', height: '40px' }}>
                <img 
                  src="https://imagens.lovoocrm.com/wp-content/uploads/2025/12/LOVOO-PNG-para-fundo-preto-scaled.png" 
                  alt="Lovoo CRM Logo" 
                  className="w-full h-full object-contain"
                />
              </div>
              <p className="text-xs text-slate-400 text-center font-light tracking-wide opacity-80">
                Leads Otimizados. Vendas Voando.
              </p>
            </div>
          )}
          
          {/* Collapse Button - Desktop */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="hidden lg:flex absolute top-1 right-2 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <ChevronLeft className={`w-4 h-4 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} />
          </button>

          {/* Close Button - Mobile */}
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden absolute top-1 right-2 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileMenuOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-xl
                  transition-all duration-200 ease-in-out
                  ${active 
                    ? 'bg-blue-600 text-white shadow-lg' 
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                  }
                  ${sidebarCollapsed ? 'justify-center' : ''}
                `}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {!sidebarCollapsed && (
                  <span className="font-medium">{item.label}</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User Section */}
        <div className="p-4 border-t border-slate-800">
          {!sidebarCollapsed && (
            <div className="mb-3">
              <p className="text-sm font-medium text-white truncate">{company?.name}</p>
              <p className="text-xs text-slate-400 truncate">{user?.email}</p>
            </div>
          )}
          
          <button
            onClick={handleSignOut}
            className={`
              flex items-center gap-3 w-full px-3 py-2.5 rounded-xl
              text-slate-300 hover:text-white hover:bg-slate-800
              transition-all duration-200 ease-in-out
              ${sidebarCollapsed ? 'justify-center' : ''}
            `}
            title={sidebarCollapsed ? 'Sair' : undefined}
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {!sidebarCollapsed && <span className="font-medium">Sair</span>}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className={`
        transition-all duration-300 ease-in-out
        ${sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64'}
      `}>
        {/* Top Header */}
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Mobile Menu Button */}
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-2 rounded-xl hover:bg-gray-100 transition-colors"
              >
                <Menu className="w-5 h-5" />
              </button>

              {/* Breadcrumb */}
              <div className="hidden sm:block">
                <h2 className="text-xl font-semibold text-gray-900 capitalize">
                  {location.pathname.split('/')[1] || 'Dashboard'}
                </h2>
                <p className="text-sm text-gray-500">
                  {company?.is_super_admin ? 'Administração da Plataforma' : company?.name}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Search */}
              <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-xl">
                <Search className="w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar..."
                  className="bg-transparent border-none outline-none text-sm placeholder-gray-400 w-32"
                />
              </div>

              {/* Notifications */}
              <button className="relative p-2 rounded-xl hover:bg-gray-100 transition-colors">
                <Bell className="w-5 h-5 text-gray-600" />
                {realtimeStats?.activeVisitors > 0 && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full" />
                )}
              </button>

              {/* User Menu */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer">
                <Avatar 
                  src={userPhoto || currentUserData?.profile_picture_url}
                  alt={userDisplayName || currentUserData?.display_name || user?.email || 'Usuário'}
                  size="sm"
                  fallbackText={(userDisplayName || currentUserData?.display_name || user?.email)?.charAt(0)}
                />
                <div className="hidden sm:block text-left">
                  <p className="text-sm font-medium text-gray-900 truncate max-w-32">
                    {userDisplayName || currentUserData?.display_name || user?.email?.split('@')[0]}
                  </p>
                  <p className="text-xs text-gray-500 capitalize">{company?.plan}</p>
                </div>
              </div>
              
              {/* 🔧 DEBUG: Botão temporário para refresh */}
              <button 
                onClick={() => {
                  console.log('🔧 Forcing refresh of user roles...');
                  // Acessar refreshUserRoles do contexto se disponível
                  window.location.reload();
                }}
                className="px-2 py-1 bg-red-100 text-red-600 text-xs rounded"
                title="Debug: Refresh User Data"
              >
                🔄
              </button>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-6">
          {children}
        </main>
      </div>

      {/* Real-time Stats Indicator */}
      {realtimeStats?.activeVisitors > 0 && (
        <div className="fixed bottom-4 right-4 bg-green-500 text-white px-4 py-2 rounded-full shadow-lg">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4" />
            <span className="text-sm font-medium">
              {realtimeStats.activeVisitors} visitante{realtimeStats.activeVisitors > 1 ? 's' : ''} ativo{realtimeStats.activeVisitors > 1 ? 's' : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
