import React from 'react'

export function NotificationForm({ config, setConfig, users }: any) {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Enviar para *</label>
        <select value={config.recipientType || 'owner'} onChange={(e) => setConfig({ ...config, recipientType: e.target.value })} className="w-full rounded-md border-gray-300 shadow-sm">
          <option value="owner">Responsável do lead</option>
          <option value="specific">Usuário específico</option>
          <option value="all_team">Toda a equipe</option>
        </select>
      </div>

      {config.recipientType === 'specific' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Usuário</label>
          <select value={config.specificUserId || ''} onChange={(e) => setConfig({ ...config, specificUserId: e.target.value })} className="w-full rounded-md border-gray-300 shadow-sm">
            <option value="">Selecione...</option>
            {users.map(u => <option key={u.user_id} value={u.user_id}>{u.display_name || u.email}</option>)}
          </select>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Título *</label>
        <input type="text" value={config.notificationTitle || ''} onChange={(e) => setConfig({ ...config, notificationTitle: e.target.value })} className="w-full rounded-md border-gray-300 shadow-sm" placeholder="Ex: Novo lead criado" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Mensagem *</label>
        <textarea value={config.notificationMessage || ''} onChange={(e) => setConfig({ ...config, notificationMessage: e.target.value })} rows={3} className="w-full rounded-md border-gray-300 shadow-sm" placeholder="Ex: Lead {{lead.name}} necessita atenção" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Tipo</label>
        <select value={config.notificationType || 'info'} onChange={(e) => setConfig({ ...config, notificationType: e.target.value })} className="w-full rounded-md border-gray-300 shadow-sm">
          <option value="info">ℹ️ Informação</option>
          <option value="success">✅ Sucesso</option>
          <option value="warning">⚠️ Aviso</option>
          <option value="error">❌ Erro</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Prioridade</label>
        <select value={config.notificationPriority || 'normal'} onChange={(e) => setConfig({ ...config, notificationPriority: e.target.value })} className="w-full rounded-md border-gray-300 shadow-sm">
          <option value="low">Baixa</option>
          <option value="normal">Normal</option>
          <option value="high">Alta</option>
          <option value="urgent">Urgente</option>
        </select>
      </div>
    </>
  )
}