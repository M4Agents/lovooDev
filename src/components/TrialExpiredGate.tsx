import React from 'react'
import { Lock, LogOut } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

// TODO: Este gate é apenas uma camada de UX (bloqueio de interface).
// Ele NÃO substitui validação no backend.
// TODO: Implementar assertCompanySubscriptionAccess() nos endpoints críticos
//       para rejeitar requisições de empresas com trial bloqueado no servidor.

interface Props {
  children: React.ReactNode
}

export const TrialExpiredGate: React.FC<Props> = ({ children }) => {
  const { subscriptionBlocked, userRoles, signOut } = useAuth()

  // Bypass seguro: verifica se o usuário autenticado possui um papel privilegiado
  // (super_admin ou system_admin) em qualquer empresa da plataforma.
  //
  // Por que NÃO usamos isImpersonating:
  //   isImpersonating é inicializado de localStorage.getItem('lovoo_crm_impersonating'),
  //   o que permite que qualquer usuário forje o valor via DevTools e pule o bloqueio.
  //
  // Por que userRoles é seguro:
  //   userRoles é populado exclusivamente pelo RPC get_user_roles_for_auth (banco de dados),
  //   chamado em refreshUserRoles(). Não depende de nenhum valor em localStorage.
  //   Apenas usuários com registro real de super_admin ou system_admin no banco passam.
  const isPrivilegedPlatformAdmin = userRoles.some(
    r => r.role === 'super_admin' || r.role === 'system_admin'
  )

  if (!subscriptionBlocked || isPrivilegedPlatformAdmin) {
    return <>{children}</>
  }

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch {
      // Ignora falha de rede — não impede o logout local
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
        {/* Cabeçalho */}
        <div className="px-8 pt-10 pb-6 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <Lock className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-xl font-semibold text-slate-900 mb-2">
            Seu período de trial encerrou.
          </h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            Para continuar utilizando o Lovoo CRM, contrate um plano.
          </p>
        </div>

        {/* Ações */}
        <div className="px-8 pb-10">
          <button
            onClick={handleSignOut}
            className="flex items-center justify-center gap-2 w-full px-4 py-3 text-sm text-slate-500 hover:text-slate-700 transition-colors rounded-xl hover:bg-slate-50 border border-slate-200"
          >
            <LogOut className="w-4 h-4" />
            Sair da conta
          </button>
        </div>
      </div>
    </div>
  )
}
