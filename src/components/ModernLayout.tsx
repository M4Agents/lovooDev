import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
  User,
  Users,
  Crown,
  MessageCircle,
  FolderOpen,
  TrendingUp,
  Calendar,
  Zap,
  BarChart2
} from 'lucide-react';
import { Avatar } from './Avatar';
import { ActivityNotifications } from './ActivityNotifications';
import { ActivityNotificationButton } from './ActivityNotificationButton';
import { LanguageSwitcher } from './LanguageSwitcher';

type ModernLayoutProps = {
  children: React.ReactNode;
};

export const ModernLayout: React.FC<ModernLayoutProps> = ({ children }) => {
  const { t } = useTranslation('layout');
  const { user, company, signOut, isImpersonating, originalUser, stopImpersonation, userRoles, currentRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const realtimeStats = useRealtimeAnalytics(company?.id);
  
  // Estado para dados do usuário (foto e nome)
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [userDisplayName, setUserDisplayName] = useState<string | null>(null);
  
  // Obter dados do usuário atual para foto de perfil (fallback)
  const currentUserData = userRoles?.find(role => role.company_id === company?.id);
  
  // Buscar dados do usuário diretamente para o header
  useEffect(() => {
    const fetchUserData = async () => {
      try {
        if (!user?.id || !company?.id) {
          return;
        }

        // Usar RPC que funciona na lista de usuários
        const { data: companyUsers, error } = await supabase
          .rpc('get_company_users_with_details', {
            p_company_id: company.id
          });

        if (companyUsers && !error) {
          // Filtrar apenas o usuário atual
          const userData = companyUsers.find((u: any) => u.user_id === user.id);

          if (userData) {
            setUserPhoto(userData.profile_picture_url);
            setUserDisplayName(userData.display_name);
          }
        }
      } catch (error) {
        console.error('Erro ao buscar dados do usuário:', error);
      }
    };

    fetchUserData();
  }, [user?.id, company?.id]);


  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const navItems = useMemo(
    () => [
      { path: '/dashboard', icon: LayoutDashboard, label: t('navigation.dashboard') },
      { path: '/chat', icon: MessageCircle, label: t('navigation.chat') },
      { path: '/sales-funnel', icon: TrendingUp, label: t('navigation.salesFunnel') },
      { path: '/leads', icon: Users, label: t('navigation.leads') },
      { path: '/calendar', icon: Calendar, label: t('navigation.calendar') },
      { path: '/automations', icon: Zap, label: t('navigation.automations') },
      ...(currentRole === 'super_admin' && company?.company_type === 'parent'
        ? [{ path: '/companies', icon: Building2, label: t('navigation.companies') }]
        : []),
      { path: '/media-library', icon: FolderOpen, label: t('navigation.mediaLibrary') },
      { path: '/reports', icon: BarChart2, label: t('navigation.reports') },
      ...(currentRole === 'super_admin' && company?.company_type === 'parent'
        ? [{ path: '/plans', icon: Crown, label: t('navigation.plans') }]
        : []),
      { path: '/settings', icon: Settings, label: t('navigation.settings') },
    ],
    [t, currentRole]
  );

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
              {t('impersonation.viewingPrefix')}{' '}
              <strong>{company?.name}</strong>
              {originalUser && (
                <span className="ml-2">
                  {t('impersonation.originalUser', { email: originalUser.email })}
                </span>
              )}
            </span>
            <button
              onClick={stopImpersonation}
              className="ml-4 px-3 py-1 bg-orange-600 hover:bg-orange-700 rounded text-xs transition-colors"
            >
              {t('impersonation.backToOriginal')}
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
                  src="https://app.lovoocrm.com/images/emails/LOVOO-PNG-para-fundo-preto-scaled.png" 
                  alt={t('brand.logoAlt')} 
                  className="w-full h-full object-contain"
                />
              </div>
              <p className="text-xs text-slate-400 text-center font-light tracking-wide opacity-80">
                {t('brand.tagline')}
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

        {/* User Profile Section - MODERNIZADO */}
        <div className="p-4 border-t border-slate-800">
          {!sidebarCollapsed ? (
            <div className="bg-slate-800/50 rounded-xl p-4 mb-3 space-y-3">
              {/* Avatar e Nome */}
              <div className="flex items-center gap-3">
                <Avatar 
                  src={userPhoto || currentUserData?.profile_picture_url}
                  alt={userDisplayName || currentUserData?.display_name || user?.email || t('profile.avatarFallbackName')}
                  size="lg"
                  fallbackText={(userDisplayName || currentUserData?.display_name || user?.email)?.charAt(0)}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">
                    {userDisplayName || currentUserData?.display_name || user?.email?.split('@')[0]}
                  </p>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <div className="flex min-w-0 items-center gap-1">
                      <Crown className="w-3 h-3 shrink-0 text-yellow-400" />
                      <p className="text-xs text-yellow-400 font-medium capitalize truncate">
                        {company?.plan || 'Free'}
                      </p>
                    </div>
                    <LanguageSwitcher variant="expanded" />
                  </div>
                </div>
              </div>

              {/* Empresa e Email */}
              <div className="space-y-1 pt-2 border-t border-slate-700/50">
                <p className="text-xs font-medium text-slate-300 truncate">
                  {company?.name}
                </p>
                <p className="text-xs text-slate-400 truncate">
                  {user?.email}
                </p>
              </div>

              {/* Notificações */}
              <ActivityNotificationButton
                isMaster={currentRole === 'super_admin' || currentRole === 'admin'}
                currentUserId={user?.id || ''}
                companyId={company?.id || ''}
                collapsed={false}
              />
            </div>
          ) : (
            /* Sidebar Colapsada - Apenas Avatar e Sininho */
            <div className="flex flex-col items-center gap-3 mb-3">
              <div className="relative">
                <Avatar 
                  src={userPhoto || currentUserData?.profile_picture_url}
                  alt={userDisplayName || user?.email || t('profile.avatarFallbackName')}
                  size="md"
                  fallbackText={(userDisplayName || user?.email)?.charAt(0)}
                />
                {company?.plan && (
                  <Crown className="absolute -bottom-1 -right-1 w-3 h-3 text-yellow-400 bg-slate-900 rounded-full" />
                )}
              </div>
              <ActivityNotifications />
              <LanguageSwitcher variant="collapsed" />
            </div>
          )}
          
          {/* Botão Sair */}
          <button
            onClick={handleSignOut}
            className={`
              flex items-center gap-3 w-full px-3 py-2.5 rounded-xl
              text-slate-300 hover:text-white hover:bg-slate-800
              transition-all duration-200 ease-in-out
              ${sidebarCollapsed ? 'justify-center' : ''}
            `}
            title={sidebarCollapsed ? t('actions.signOut') : undefined}
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {!sidebarCollapsed && <span className="font-medium">{t('actions.signOut')}</span>}
          </button>
        </div>
      </div>

      {/* Main Content - FULLSCREEN */}
      <div className={`
        transition-all duration-300 ease-in-out
        ${sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64'}
      `}>
        {/* Header removido - conteúdo fullscreen */}
        
        {/* Page Content - Fullscreen */}
        <main className="p-6 min-h-screen bg-gray-50">
          {children}
        </main>
      </div>

      {/* Botão Menu Mobile - Flutuante */}
      {!mobileMenuOpen && (
        <button 
          onClick={() => setMobileMenuOpen(true)}
          className="lg:hidden fixed top-4 left-4 z-40 p-3 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-all duration-200"
          aria-label={t('mobile.openMenuAriaLabel')}
        >
          <Menu className="w-5 h-5" />
        </button>
      )}

      {/* Real-time Stats Indicator */}
      {realtimeStats?.activeVisitors > 0 && (
        <div className="fixed bottom-4 right-4 bg-green-500 text-white px-4 py-2 rounded-full shadow-lg">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4" />
            <span className="text-sm font-medium">
              {t('realtime.activeVisitors', { count: realtimeStats.activeVisitors })}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
