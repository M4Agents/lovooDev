import React from 'react'

export function TriggerAutomationForm({ config, setConfig, flows, currentFlowId }: any) {
  const activeFlows = flows.filter((f: any) => f.is_active && f.id !== currentFlowId)

  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Automação a Disparar *</label>
        <select value={config.targetFlowId || ''} onChange={(e) => setConfig({ ...config, targetFlowId: e.target.value })} className="w-full rounded-md border-gray-300 shadow-sm">
          <option value="">Selecione...</option>
          {activeFlows.map((flow: any) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
        </select>
      </div>

      <div className="flex items-center gap-2 mt-3">
        <input type="checkbox" checked={config.passCurrentContext || false} onChange={(e) => setConfig({ ...config, passCurrentContext: e.target.checked })} />
        <label className="text-sm text-gray-700">Passar contexto atual (lead, oportunidade)</label>
      </div>

      <div className="flex items-center gap-2 mt-2">
        <input type="checkbox" checked={config.onlyIfActive !== false} onChange={(e) => setConfig({ ...config, onlyIfActive: e.target.checked })} />
        <label className="text-sm text-gray-700">Executar apenas se ativa</label>
      </div>
    </>
  )
}