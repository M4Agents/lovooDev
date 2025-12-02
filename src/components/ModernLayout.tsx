import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useRealtimeAnalytics } from '../hooks/useRealtimeAnalytics';
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

type ModernLayoutProps = {
  children: React.ReactNode;
};

export const ModernLayout: React.FC<ModernLayoutProps> = ({ children }) => {
  const { user, company, signOut, isImpersonating, originalUser, stopImpersonation } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const realtimeStats = useRealtimeAnalytics(company?.id);

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
        <div className="relative px-4 py-2 border-b border-slate-800">
          {!sidebarCollapsed && (
            <div className="flex items-center justify-center w-full">
              <div className="w-24 h-24 flex items-center justify-center">
                <img 
                  src="https://imagens.lovoocrm.com/wp-content/uploads/2025/12/LOVOO-PNG-para-fundo-preto-scaled.png" 
                  alt="Lovoo CRM Logo" 
                  className="w-full h-full object-contain"
                />
              </div>
            </div>
          )}
          
          {/* Collapse Button - Desktop */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="hidden lg:flex absolute top-2 right-4 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <ChevronLeft className={`w-4 h-4 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} />
          </button>

          {/* Close Button - Mobile */}
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden absolute top-2 right-4 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
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
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <User className="w-4 h-4 text-blue-600" />
                </div>
                <div className="hidden sm:block text-left">
                  <p className="text-sm font-medium text-gray-900 truncate max-w-32">
                    {user?.email?.split('@')[0]}
                  </p>
                  <p className="text-xs text-gray-500 capitalize">{company?.plan}</p>
                </div>
              </div>
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
