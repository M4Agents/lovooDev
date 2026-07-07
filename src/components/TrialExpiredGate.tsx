import React from 'react'
import { Lock, LogOut } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { SubscriptionRecoveryPanel } from './Billing/SubscriptionRecoveryPanel'

// TODO: Este gate é apenas uma camada de UX (bloqueio de interface).
// Ele NÃO substitui validação no backend.
// TODO: Implementar assertCompanySubscriptionAccess() nos endpoints críticos
//       para rejeitar requisições de empresas com trial bloqueado no servidor.

interface Props {
  children: React.ReactNode
}

export const TrialExpiredGate: React.FC<Props> = ({ children }) => {
  const { subscriptionBlocked, userRoles, signOut, company } = useAuth()

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
    <div className="min-h-screen bg-slate-50 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-10">

        {/* Cabeçalho de bloqueio */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-8 py-8 mb-6 text-center">
          <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="w-7 h-7 text-red-600" />
          </div>
          <h1 className="text-xl font-semibold text-slate-900 mb-2">
            Seu período de trial encerrou.
          </h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            Para continuar utilizando o Lovoo CRM, contrate um plano.
          </p>
        </div>

        {/* Painel de contratação — lógica de planos e checkout isolada aqui */}
        {company?.id && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-6 py-6 mb-6">
            <SubscriptionRecoveryPanel companyId={company.id} />
          </div>
        )}

        {/* Logout — sempre disponível */}
        <div className="text-center">
          <button
            onClick={handleSignOut}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm text-slate-500 hover:text-slate-700 transition-colors rounded-xl hover:bg-white border border-slate-200"
          >
            <LogOut className="w-4 h-4" />
            Sair da conta
          </button>
        </div>

      </div>
    </div>
  )
}
