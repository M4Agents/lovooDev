// =============================================================================
// MetaOfficialTemplatesPanel — Fase A
//
// Listagem administrativa de templates da API Oficial Meta.
// Sem criação, edição, exclusão ou envio.
// WABA e token nunca são escolhidos pelo frontend — só instance_id público.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Cloud, Loader2, RefreshCw } from 'lucide-react'
import { useCompany } from '../../hooks/useCompany'
import { useMetaWhatsAppInstances } from '../../hooks/useMetaWhatsAppInstances'
import { metaWhatsAppApi } from '../../services/metaWhatsAppApi'
import type {
  MetaAdminWhatsAppTemplate,
  MetaTemplateGraphStatus,
  MetaWhatsAppInstance,
} from '../../types/meta-whatsapp'
import { MetaTemplateDetails } from './MetaTemplateDetails'
import { templateRowKey } from './metaTemplateDetailsModel'

const STATUS_BADGE: Record<MetaTemplateGraphStatus, string> = {
  APPROVED:          'bg-emerald-50 text-emerald-700 border-emerald-200',
  PENDING:           'bg-amber-50 text-amber-700 border-amber-200',
  REJECTED:          'bg-red-50 text-red-700 border-red-200',
  PAUSED:            'bg-slate-100 text-slate-600 border-slate-200',
  DISABLED:          'bg-slate-100 text-slate-600 border-slate-200',
  IN_APPEAL:         'bg-sky-50 text-sky-700 border-sky-200',
  PENDING_DELETION:  'bg-slate-100 text-slate-600 border-slate-200',
}

function instanceLabel(instance: MetaWhatsAppInstance): string {
  return instance.verified_name
    || instance.display_name
    || instance.phone_number
    || 'Instância Meta'
}

function StatusBadge({ status }: { status: MetaTemplateGraphStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${STATUS_BADGE[status] ?? STATUS_BADGE.PAUSED}`}>
      {status}
    </span>
  )
}

export function MetaOfficialTemplatesPanel() {
  const { company } = useCompany()
  const companyId = company?.id
  const { instances, loading: instancesLoading, error: instancesError, refresh } =
    useMetaWhatsAppInstances(companyId)

  const connected = useMemo(
    () => instances.filter((item) => item.status === 'connected'),
    [instances],
  )

  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('')
  const [templates, setTemplates] = useState<MetaAdminWhatsAppTemplate[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const fetchGenRef = useRef(0)

  useEffect(() => {
    if (connected.length === 0) {
      setSelectedInstanceId('')
      return
    }
    setSelectedInstanceId((current) => (
      connected.some((item) => item.id === current) ? current : connected[0].id
    ))
  }, [connected])

  const loadPage = useCallback(async (instanceId: string, after?: string) => {
    if (!companyId || !instanceId) return
    const gen = ++fetchGenRef.current
    const isMore = Boolean(after)
    if (isMore) setLoadingMore(true)
    else {
      setLoadingList(true)
      setTemplates([])
      setNextCursor(null)
    }
    setListError(null)
    try {
      const result = await metaWhatsAppApi.listAdminTemplates(companyId, instanceId, {
        status: 'ALL',
        after,
      })
      if (fetchGenRef.current !== gen) return
      setTemplates((current) => (isMore ? [...current, ...result.templates] : result.templates))
      setNextCursor(result.next_cursor)
    } catch (err: unknown) {
      if (fetchGenRef.current !== gen) return
      setListError(err instanceof Error ? err.message : 'Erro ao listar modelos Meta')
    } finally {
      if (fetchGenRef.current === gen) {
        setLoadingList(false)
        setLoadingMore(false)
      }
    }
  }, [companyId])

  useEffect(() => {
    setSelectedKey(null)
  }, [selectedInstanceId])

  useEffect(() => {
    if (!selectedInstanceId) {
      setTemplates([])
      setNextCursor(null)
      setListError(null)
      return
    }
    void loadPage(selectedInstanceId)
  }, [selectedInstanceId, loadPage])

  const selectedTemplate = templates.find((item) => templateRowKey(item) === selectedKey) ?? null

  if (!companyId) {
    return (
      <p className="text-sm text-slate-500 py-6">Selecione uma empresa para ver os modelos da API Oficial.</p>
    )
  }

  if (instancesLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-green-600" />
      </div>
    )
  }

  if (instancesError) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700 flex items-center justify-between gap-3">
        <span>{instancesError}</span>
        <button type="button" onClick={refresh} className="text-xs underline whitespace-nowrap">
          Tentar novamente
        </button>
      </div>
    )
  }

  if (connected.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-100">
          <Cloud className="w-6 h-6 text-green-600" />
        </div>
        <div className="space-y-1 max-w-md">
          <h3 className="text-sm font-semibold text-slate-900">Nenhuma conta Meta conectada</h3>
          <p className="text-xs text-slate-500">
            Conecte a Cloud API em Integrações → WhatsApp → Cloud API para listar os modelos oficiais desta empresa.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        {connected.length > 1 && (
          <label className="flex-1 text-xs font-medium text-slate-600">
            Conta Meta
            <select
              value={selectedInstanceId}
              onChange={(event) => setSelectedInstanceId(event.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              {connected.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instanceLabel(instance)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={() => selectedInstanceId && void loadPage(selectedInstanceId)}
          disabled={loadingList}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingList ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {selectedTemplate && (
        <MetaTemplateDetails
          template={selectedTemplate}
          onClose={() => setSelectedKey(null)}
        />
      )}

      {loadingList && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-green-600" />
        </div>
      )}

      {!loadingList && listError && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {listError}
          </span>
          <button
            type="button"
            onClick={() => selectedInstanceId && void loadPage(selectedInstanceId)}
            className="text-xs underline whitespace-nowrap"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {!selectedTemplate && !loadingList && !listError && templates.length === 0 && (
        <p className="text-sm text-slate-500 py-8 text-center">
          Nenhum modelo encontrado nesta conta Meta.
        </p>
      )}

      {!selectedTemplate && !loadingList && !listError && templates.length > 0 && (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
              <tr>
                <th className="px-3 py-2">Nome</th>
                <th className="px-3 py-2">Idioma</th>
                <th className="px-3 py-2">Categoria</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((tmpl) => (
                <tr
                  key={templateRowKey(tmpl)}
                  role="button"
                  tabIndex={0}
                  aria-label={`Abrir detalhes de ${tmpl.name}`}
                  className="border-t border-slate-100 cursor-pointer hover:bg-slate-50 focus:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-green-500/40"
                  onClick={() => setSelectedKey(templateRowKey(tmpl))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedKey(templateRowKey(tmpl))
                    }
                  }}
                >
                  <td className="px-3 py-2 font-medium text-slate-800">{tmpl.name}</td>
                  <td className="px-3 py-2 text-slate-600">{tmpl.language}</td>
                  <td className="px-3 py-2 text-slate-600">{tmpl.category}</td>
                  <td className="px-3 py-2"><StatusBadge status={tmpl.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!selectedTemplate && !loadingList && !listError && nextCursor && (
        <div className="flex justify-center">
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => selectedInstanceId && void loadPage(selectedInstanceId, nextCursor)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-green-700 border border-green-200 rounded-lg hover:bg-green-50 disabled:opacity-50"
          >
            {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
            Carregar mais
          </button>
        </div>
      )}
    </div>
  )
}
