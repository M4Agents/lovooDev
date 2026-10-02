import React, { useEffect, useState } from 'react';
import { WhatsAppLifeInstance } from '../../types/whatsapp-life';
import { funnelApi } from '../../services/funnelApi';
import type { FunnelStage, SalesFunnel } from '../../types/sales-funnel';

const COMPANY_DEFAULT = '';

interface InstanceFunnelConfigPanelProps {
  instance: WhatsAppLifeInstance;
  funnels: SalesFunnel[];
  loadingFunnels: boolean;
  onSave: (
    instanceId: string,
    funnelId: string | null,
    stageId: string | null,
    enabled: boolean
  ) => Promise<{ success: boolean; error?: string }>;
}

export const InstanceFunnelConfigPanel: React.FC<InstanceFunnelConfigPanelProps> = ({
  instance,
  funnels,
  loadingFunnels,
  onSave,
}) => {
  const [enabled, setEnabled] = useState(false);
  const [funnelId, setFunnelId] = useState(COMPANY_DEFAULT);
  const [stageId, setStageId] = useState(COMPANY_DEFAULT);
  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [loadingStages, setLoadingStages] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(instance.lead_funnel_override_enabled === true);
    setFunnelId(instance.default_funnel_id ?? COMPANY_DEFAULT);
    setStageId(instance.default_stage_id ?? COMPANY_DEFAULT);
    setError(null);
    setSuccess(null);
  }, [
    instance.id,
    instance.lead_funnel_override_enabled,
    instance.default_funnel_id,
    instance.default_stage_id,
  ]);

  useEffect(() => {
    if (!funnelId) {
      setStages([]);
      return;
    }

    let cancelled = false;
    setLoadingStages(true);
    funnelApi.getStages(funnelId)
      .then((rows) => {
        if (!cancelled) setStages(rows);
      })
      .catch(() => {
        if (!cancelled) {
          setStages([]);
          setError('Não foi possível carregar as etapas do funil');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingStages(false);
      });

    return () => {
      cancelled = true;
    };
  }, [funnelId]);

  const handleFunnelChange = (value: string) => {
    setSuccess(null);
    setError(null);
    setFunnelId(value);
    setStageId(COMPANY_DEFAULT);
    setEnabled(Boolean(value));
  };

  const handleEnabledChange = (next: boolean) => {
    setSuccess(null);
    setError(null);
    setEnabled(next);
    if (!next) {
      setFunnelId(COMPANY_DEFAULT);
      setStageId(COMPANY_DEFAULT);
    }
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(null);

    if (enabled && (!funnelId || !stageId)) {
      setError('Selecione um funil e uma etapa para ativar o direcionamento');
      return;
    }

    setIsSaving(true);
    const result = await onSave(
      instance.id,
      enabled ? funnelId : null,
      enabled ? stageId : null,
      enabled
    );
    setIsSaving(false);

    if (!result.success) {
      setError(result.error || 'Erro ao salvar o destino do funil');
      return;
    }

    setSuccess(enabled
      ? 'Direcionamento salvo. Vale para leads novos.'
      : 'Instância usando o funil padrão da empresa.');
  };

  return (
    <div className="mt-3 pt-3 border-t border-gray-50">
      <p className="text-xs font-medium text-gray-700">Funil de vendas</p>
      <p className="text-xs text-gray-400 mt-0.5">
        Vale para leads novos desta instância. Leads existentes mantêm a posição.
      </p>

      <label className="mt-3 flex items-center justify-between gap-3">
        <span className="text-xs text-gray-700">Direcionar leads desta instância</span>
        <button
          type="button"
          onClick={() => handleEnabledChange(!enabled)}
          disabled={isSaving || loadingFunnels}
          className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed ${
            enabled ? 'bg-blue-600' : 'bg-gray-300'
          }`}
          title={enabled ? 'Desativar direcionamento' : 'Ativar direcionamento'}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </label>

      <div className="mt-3 space-y-2">
        <label className="block">
          <span className="text-xs font-medium text-gray-500">Funil</span>
          <select
            value={funnelId}
            onChange={(event) => handleFunnelChange(event.target.value)}
            disabled={isSaving || loadingFunnels}
            className="mt-1 block w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
          >
            <option value={COMPANY_DEFAULT}>Usar funil padrão da empresa</option>
            {funnels.map((funnel) => (
              <option key={funnel.id} value={funnel.id}>
                {funnel.name}{funnel.is_default ? ' (padrão)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-gray-500">Etapa</span>
          <select
            value={stageId}
            onChange={(event) => {
              setStageId(event.target.value);
              setSuccess(null);
              setError(null);
            }}
            disabled={isSaving || !funnelId || loadingStages}
            className="mt-1 block w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
          >
            <option value={COMPANY_DEFAULT}>
              {funnelId ? 'Selecione a etapa' : 'Defina o funil primeiro'}
            </option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || loadingFunnels}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? 'Salvando…' : 'Salvar destino'}
        </button>
        {success && <p className="text-xs text-green-600">{success}</p>}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
};
