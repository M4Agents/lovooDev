import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { LandingPage } from '../lib/supabase';
import { Plus, ExternalLink, Code, Trash2, Edit2, Play, Pause } from 'lucide-react';

export const LandingPages: React.FC = () => {
  const { company } = useAuth();
  const [pages, setPages] = useState<LandingPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPage, setEditingPage] = useState<LandingPage | null>(null);
  const [formData, setFormData] = useState({ name: '', url: '' });
  const [selectedPage, setSelectedPage] = useState<LandingPage | null>(null);

  useEffect(() => {
    loadPages();
  }, [company]);

  const loadPages = async () => {
    if (!company) return;

    try {
      const data = await api.getLandingPages(company.id);
      setPages(data);
    } catch (error) {
      console.error('Error loading pages:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;

    try {
      if (editingPage) {
        await api.updateLandingPage(editingPage.id, formData);
      } else {
        await api.createLandingPage(company.id, formData);
      }
      setShowModal(false);
      setFormData({ name: '', url: '' });
      setEditingPage(null);
      loadPages();
    } catch (error) {
      console.error('Error saving page:', error);
    }
  };

  const handleEdit = (page: LandingPage) => {
    setEditingPage(page);
    setFormData({ name: page.name, url: page.url });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir esta landing page?')) return;

    try {
      await api.deleteLandingPage(id);
      loadPages();
    } catch (error) {
      console.error('Error deleting page:', error);
    }
  };

  const toggleStatus = async (page: LandingPage) => {
    try {
      const newStatus = page.status === 'active' ? 'paused' : 'active';
      await api.updateLandingPage(page.id, { status: newStatus });
      loadPages();
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const getTrackingCode = (page: LandingPage) => {
    const baseUrl = window.location.origin;
    return `<!-- Lovoo CRM Analytics -->
<script src="${baseUrl}/m4track.js"></script>
<script>
  LovooCRM.init('${page.tracking_code}', '${baseUrl}');

  // Call this when user submits a form
  // LovooCRM.trackConversion({
  //   name: 'João Silva',
  //   email: 'joao@email.com',
  //   phone: '11999999999'
  // });
</script>`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Landing Pages</h1>
          <p className="text-slate-600 mt-1">Gerencie suas páginas e códigos de rastreamento</p>
        </div>
        <button
          onClick={() => {
            setEditingPage(null);
            setFormData({ name: '', url: '' });
            setShowModal(true);
          }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          <Plus className="w-5 h-5" />
          Nova Landing Page
        </button>
      </div>

      {pages.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <div className="max-w-md mx-auto">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Code className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-semibold text-slate-900 mb-2">Nenhuma landing page cadastrada</h3>
            <p className="text-slate-600 mb-6">
              Crie sua primeira landing page para começar a rastrear o comportamento dos visitantes.
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              <Plus className="w-5 h-5" />
              Criar Primeira Landing Page
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {pages.map((page) => (
            <div key={page.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-slate-900 mb-1">{page.name}</h3>
                  {/* Mostrar empresa para super admin */}
                  {company?.is_super_admin && (page as any).companies && (
                    <p className="text-xs text-purple-600 font-medium mb-1">
                      📊 {(page as any).companies.name}
                    </p>
                  )}
                  <a
                    href={page.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                  >
                    {page.url}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    page.status === 'active'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-yellow-100 text-yellow-800'
                  }`}
                >
                  {page.status === 'active' ? 'Ativo' : 'Pausado'}
                </span>
              </div>

              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => handleEdit(page)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors"
                >
                  <Edit2 className="w-4 h-4" />
                  Editar
                </button>
                <button
                  onClick={() => toggleStatus(page)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors"
                >
                  {page.status === 'active' ? (
                    <>
                      <Pause className="w-4 h-4" />
                      Pausar
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      Ativar
                    </>
                  )}
                </button>
                <button
                  onClick={() => setSelectedPage(page)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg text-sm font-medium transition-colors"
                >
                  <Code className="w-4 h-4" />
                  Código
                </button>
                <button
                  onClick={() => handleDelete(page.id)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-medium transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Excluir
                </button>
              </div>

              <a
                href={`/analytics/${page.id}`}
                className="block w-full text-center bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white py-2 rounded-lg font-medium transition-all"
              >
                Ver Analytics
              </a>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-semibold text-slate-900 mb-4">
              {editingPage ? 'Editar Landing Page' : 'Nova Landing Page'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Nome</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Página de Captura"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">URL</label>
                <input
                  type="url"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://meusite.com/lp"
                  required
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingPage(null);
                    setFormData({ name: '', url: '' });
                  }}
                  className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                >
                  {editingPage ? 'Salvar' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedPage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6">
            <h2 className="text-xl font-semibold text-slate-900 mb-4">Código de Rastreamento</h2>
            <p className="text-slate-600 mb-4">
              Copie e cole este código no final do HTML da sua landing page, <strong>antes da tag de fechamento</strong>{' '}
              <code className="bg-slate-100 px-1 py-0.5 rounded">&lt;/body&gt;</code> (não no head)
            </p>
            <div className="bg-slate-900 rounded-lg p-4 mb-4">
              <pre className="text-sm text-slate-100 overflow-x-auto">
                <code>{getTrackingCode(selectedPage)}</code>
              </pre>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(getTrackingCode(selectedPage));
                  alert('Código copiado!');
                }}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                Copiar Código
              </button>
              <button
                onClick={() => setSelectedPage(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
