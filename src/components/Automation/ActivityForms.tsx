// Formulários de atividades para NodeConfigPanel
import React from 'react'

export const CreateActivityForm = ({ config, setConfig }: any) => (
  <>
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Título *</label>
      <input type="text" value={config.activityTitle || ''} onChange={(e) => setConfig({ ...config, activityTitle: e.target.value })} placeholder="Follow-up com lead" className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" required />
    </div>
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Tipo *</label>
      <select value={config.activityType || 'call'} onChange={(e) => setConfig({ ...config, activityType: e.target.value })} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
        <option value="call">📞 Ligação</option>
        <option value="meeting">🤝 Reunião</option>
        <option value="email">📧 Email</option>
        <option value="task">✓ Tarefa</option>
        <option value="follow_up">🔄 Follow-up</option>
      </select>
    </div>
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Data *</label>
        <input type="date" value={config.scheduledDate || ''} onChange={(e) => setConfig({ ...config, scheduledDate: e.target.value })} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" required />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Hora *</label>
        <input type="time" value={config.scheduledTime || '14:00'} onChange={(e) => setConfig({ ...config, scheduledTime: e.target.value })} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" required />
      </div>
    </div>
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Prioridade</label>
      <select value={config.activityPriority || 'medium'} onChange={(e) => setConfig({ ...config, activityPriority: e.target.value })} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
        <option value="low">🟢 Baixa</option>
        <option value="medium">🟡 Média</option>
        <option value="high">🟠 Alta</option>
        <option value="urgent">🔴 Urgente</option>
      </select>
    </div>
  </>
)

export const UpdateActivityForm = ({ config, setConfig }: any) => (
  <>
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Filtrar Status</label>
      <select value={config.filterStatus || 'pending'} onChange={(e) => setConfig({ ...config, filterStatus: e.target.value })} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
        <option value="pending">Pendentes</option>
      </select>
    </div>
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Nova Prioridade</label>
      <select value={config.newPriority || ''} onChange={(e) => setConfig({ ...config, newPriority: e.target.value })} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
        <option value="">Não alterar</option>
        <option value="low">🟢 Baixa</option>
        <option value="medium">🟡 Média</option>
        <option value="high">🟠 Alta</option>
        <option value="urgent">🔴 Urgente</option>
      </select>
    </div>
  </>
)

export const CompleteActivityForm = ({ config, setConfig }: any) => (
  <>
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Notas (opcional)</label>
      <textarea value={config.completionNotes || ''} onChange={(e) => setConfig({ ...config, completionNotes: e.target.value })} rows={2} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" placeholder="Lead convertido" />
    </div>
  </>
)

export const CancelActivityForm = ({ config, setConfig }: any) => (
  <>
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Motivo (opcional)</label>
      <textarea value={config.cancellationReason || ''} onChange={(e) => setConfig({ ...config, cancellationReason: e.target.value })} rows={2} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" placeholder="Oportunidade perdida" />
    </div>
  </>
)

export const RescheduleActivityForm = ({ config, setConfig }: any) => (
  <>
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Dias para adicionar/remover</label>
      <input type="number" value={config.daysOffset || 0} onChange={(e) => setConfig({ ...config, daysOffset: parseInt(e.target.value) })} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" placeholder="Ex: +3 ou -2" />
      <p className="text-xs text-gray-500 mt-1">Use números positivos para adiar, negativos para antecipar</p>
    </div>
  </>
)
