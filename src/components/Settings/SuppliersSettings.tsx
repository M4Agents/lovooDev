/**
 * Configurações → Produtos e Serviços → Fornecedores.
 * Gestão de fornecedores com listagem, modal de criação/edição e soft delete.
 */

import { useCallback, useEffect, useState } from 'react'
import { Building2, Plus, Pencil, RefreshCw, Search, Trash2, X as XIcon } from 'lucide-react'
import { suppliersApi, type SupplierInput } from '../../services/suppliersApi'
import type { Supplier } from '../../types/sales-funnel'
import { useAccessControl } from '../../hooks/useAccessControl'

type Props = {
  companyId: string
}

export const SuppliersSettings: React.FC<Props> = ({ companyId }) => {
  const { canWriteCatalog } = useAccessControl()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await suppliersApi.listAll(companyId)
      setSuppliers(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar fornecedores.')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { load() }, [load])

  const filtered = search
    ? suppliers.filter((s) =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.trade_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (s.email ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : suppliers

  const handleDelete = async (s: Supplier) => {
    if (!canWriteCatalog) return
    if (!window.confirm(`Inativar o fornecedor "${s.name}"?`)) return
    try {
      await suppliersApi.remove(s.id, companyId)
      await load()
    } catch {
      alert('Erro ao inativar fornecedor.')
    }
  }

  const handleSaved = () => {
    setEditing(null)
    setCreating(false)
    void load()
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-600 py-8">
        <RefreshCw className="w-4 h-4 animate-spin" />
        Carregando fornecedores…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md bg-red-50 text-red-800 text-sm px-3 py-2">{error}</div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <input
            className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            placeholder="Buscar fornecedor…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <XIcon className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex-1" />
        {canWriteCatalog && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Novo fornecedor
          </button>
        )}
      </div>

      {creating && (
        <SupplierForm
          companyId={companyId}
          initial={null}
          onCancel={() => setCreating(false)}
          onSaved={handleSaved}
        />
      )}

      {editing && (
        <SupplierForm
          companyId={companyId}
          initial={editing}
          onCancel={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {!creating && !editing && (
        <>
          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500">
              {search ? 'Nenhum fornecedor encontrado.' : 'Nenhum fornecedor cadastrado ainda.'}
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Nome</th>
                    <th className="px-4 py-2 text-left font-medium hidden md:table-cell">Documento</th>
                    <th className="px-4 py-2 text-left font-medium hidden md:table-cell">Contato</th>
                    <th className="px-4 py-2 text-center font-medium">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{s.name}</p>
                        {s.trade_name && (
                          <p className="text-xs text-slate-500">{s.trade_name}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 hidden md:table-cell">
                        {s.document
                          ? <span>{s.document_type?.toUpperCase()} {s.document}</span>
                          : <span className="text-slate-400">—</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-slate-600 hidden md:table-cell">
                        <p>{s.contact_name ?? <span className="text-slate-400">—</span>}</p>
                        {s.email && <p className="text-xs text-slate-400">{s.email}</p>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          s.is_active
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}>
                          {s.is_active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {canWriteCatalog && (
                            <>
                              <button
                                type="button"
                                onClick={() => setEditing(s)}
                                className="p-1.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                title="Editar"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              {s.is_active && (
                                <button
                                  type="button"
                                  onClick={() => handleDelete(s)}
                                  className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                  title="Inativar"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const EMPTY_FORM: SupplierInput = {
  name: '',
  trade_name: '',
  document: '',
  document_type: undefined,
  email: '',
  phone: '',
  website: '',
  contact_name: '',
  contact_phone: '',
  address_street: '',
  address_city: '',
  address_state: '',
  address_zip: '',
  address_country: 'Brasil',
  notes: '',
  is_active: true,
}

const SupplierForm: React.FC<{
  companyId: string
  initial: Supplier | null
  onCancel: () => void
  onSaved: () => void
}> = ({ companyId, initial, onCancel, onSaved }) => {
  const { canWriteCatalog } = useAccessControl()
  const [form, setForm] = useState<SupplierInput>(() =>
    initial
      ? {
          name: initial.name,
          trade_name: initial.trade_name ?? '',
          document: initial.document ?? '',
          document_type: initial.document_type ?? undefined,
          email: initial.email ?? '',
          phone: initial.phone ?? '',
          website: initial.website ?? '',
          contact_name: initial.contact_name ?? '',
          contact_phone: initial.contact_phone ?? '',
          address_street: initial.address_street ?? '',
          address_city: initial.address_city ?? '',
          address_state: initial.address_state ?? '',
          address_zip: initial.address_zip ?? '',
          address_country: initial.address_country ?? 'Brasil',
          notes: initial.notes ?? '',
          is_active: initial.is_active,
        }
      : { ...EMPTY_FORM }
  )
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [addressOpen, setAddressOpen] = useState(
    Boolean(initial?.address_street || initial?.address_city)
  )

  const set = (field: keyof SupplierInput) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canWriteCatalog) return
    setFormError(null)
    setSaving(true)
    try {
      if (initial) {
        await suppliersApi.update(initial.id, companyId, form)
      } else {
        await suppliersApi.create(companyId, form)
      }
      onSaved()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar fornecedor.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 shadow-sm p-6 space-y-4 bg-white">
      <div className="flex items-center gap-2">
        <Building2 className="w-5 h-5 text-indigo-600" />
        <h3 className="text-lg font-semibold text-gray-900">
          {initial ? 'Editar fornecedor' : 'Novo fornecedor'}
        </h3>
      </div>

      {formError && (
        <div className="rounded-md bg-red-50 text-red-800 text-sm px-3 py-2">{formError}</div>
      )}

      {/* Identificação */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Razão social / Nome <span className="text-red-500">*</span>
          </label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            value={form.name}
            onChange={set('name')}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Nome fantasia</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            value={form.trade_name ?? ''}
            onChange={set('trade_name')}
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Tipo de documento</label>
          <select
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            value={form.document_type ?? ''}
            onChange={(e) => setForm((prev) => ({ ...prev, document_type: (e.target.value as Supplier['document_type']) || undefined }))}
          >
            <option value="">Sem documento</option>
            <option value="cnpj">CNPJ</option>
            <option value="cpf">CPF</option>
            <option value="other">Outro</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Número do documento</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            value={form.document ?? ''}
            onChange={set('document')}
            placeholder="00.000.000/0000-00"
          />
        </div>
      </div>

      {/* Contato comercial */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">E-mail comercial</label>
          <input
            type="email"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            value={form.email ?? ''}
            onChange={set('email')}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Telefone</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            value={form.phone ?? ''}
            onChange={set('phone')}
            placeholder="(00) 00000-0000"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Responsável de contato</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            value={form.contact_name ?? ''}
            onChange={set('contact_name')}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Telefone do contato</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            value={form.contact_phone ?? ''}
            onChange={set('contact_phone')}
            placeholder="(00) 00000-0000"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Site</label>
        <input
          type="url"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          value={form.website ?? ''}
          onChange={set('website')}
          placeholder="https://..."
        />
      </div>

      {/* Endereço — colapsável */}
      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setAddressOpen((o) => !o)}
          className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 text-left hover:bg-slate-100 transition-colors"
        >
          <span className="text-xs font-medium text-slate-600">Endereço</span>
          <span className="text-xs text-slate-400">{addressOpen ? 'Recolher' : 'Expandir'}</span>
        </button>
        {addressOpen && (
          <div className="p-3 space-y-3 border-t border-slate-100">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Logradouro</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                value={form.address_street ?? ''}
                onChange={set('address_street')}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Cidade</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  value={form.address_city ?? ''}
                  onChange={set('address_city')}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">UF</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  value={form.address_state ?? ''}
                  onChange={set('address_state')}
                  maxLength={2}
                  placeholder="SP"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">CEP</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  value={form.address_zip ?? ''}
                  onChange={set('address_zip')}
                  placeholder="00000-000"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">País</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  value={form.address_country ?? ''}
                  onChange={set('address_country')}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Observações</label>
        <textarea
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          rows={2}
          value={form.notes ?? ''}
          onChange={set('notes')}
        />
      </div>

      {initial && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.is_active ?? true}
            onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
          />
          Fornecedor ativo
        </label>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={onCancel}
          className="px-6 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  )
}
