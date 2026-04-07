import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { LandingPage } from '../lib/supabase';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { 
  Plus, 
  ExternalLink, 
  Code, 
  Trash2, 
  Edit2, 
  Play, 
  Pause, 
  BarChart3,
  Globe,
  Building2,
  Copy,
  Check,
  Shield,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2
} from 'lucide-react';

export const ModernLandingPages: React.FC = () => {
  const { t } = useTranslation('settings.app');
  const { company, currentRole } = useAuth();
  const [pages, setPages] = useState<LandingPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPage, setEditingPage] = useState<LandingPage | null>(null);
  const [selectedPage, setSelectedPage] = useState<LandingPage | null>(null);
  const [showTrackingCode, setShowTrackingCode] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [formData, setFormData] = useState({ name: '', url: '' });
  const [verificationResult, setVerificationResult] = useState<any>(null);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [verifyingPage, setVerifyingPage] = useState<string | null>(null);

  useEffect(() => {
    console.log('ModernLandingPages: useEffect triggered, company:', company);
    
    // Se company existe, usar normalmente
    if (company) {
      loadPages();
    } 
    // Se não tem company mas está impersonating, buscar pelo localStorage
    else if (localStorage.getItem('lovoo_crm_impersonating') === 'true') {
      const impersonatedCompanyId = localStorage.getItem('lovoo_crm_impersonated_company_id');
      console.log('ModernLandingPages: No company but impersonating, using localStorage ID:', impersonatedCompanyId);
      
      if (impersonatedCompanyId) {
        loadPagesById(impersonatedCompanyId);
      }
    }
    // Se não tem company e não está impersonating, definir loading como false
    else {
      console.log('ModernLandingPages: No company and not impersonating, stopping loading');
      setLoading(false);
    }
  }, [company]);

  const loadPages = async () => {
    console.log('ModernLandingPages: loadPages called, company:', company);
    if (!company) {
      console.log('ModernLandingPages: No company, skipping load');
      setLoading(false);
      return;
    }

    try {
      console.log('ModernLandingPages: Calling API getLandingPages for:', company.id);
      const data = await api.getLandingPages(company.id);
      console.log('ModernLandingPages: API returned data:', data);
      setPages(data);
    } catch (error) {
      console.error('ModernLandingPages: Error loading pages:', error);
    } finally {
      console.log('ModernLandingPages: Setting loading to false');
      setLoading(false);
    }
  };

  const loadPagesById = async (companyId: string) => {
    console.log('ModernLandingPages: loadPagesById called for:', companyId);

    try {
      console.log('ModernLandingPages: Calling API getLandingPages for ID:', companyId);
      const data = await api.getLandingPages(companyId);
      console.log('ModernLandingPages: API returned data:', data);
      setPages(data);
    } catch (error) {
      console.error('ModernLandingPages: Error loading pages by ID:', error);
    } finally {
      console.log('ModernLandingPages: Setting loading to false');
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('ModernLandingPages: handleSubmit called, company:', company);
    
    // Obter company ID - da company ou do localStorage durante impersonation
    let companyId = company?.id;
    if (!companyId && localStorage.getItem('lovoo_crm_impersonating') === 'true') {
      companyId = localStorage.getItem('lovoo_crm_impersonated_company_id') || undefined;
      console.log('ModernLandingPages: Using localStorage company ID:', companyId);
    }
    
    if (!companyId) {
      console.error('ModernLandingPages: No company ID available');
      alert(t('tracking.messages.errorNoCompany'));
      return;
    }

    try {
      console.log('ModernLandingPages: Saving landing page for company:', companyId);
      
      if (editingPage) {
        console.log('ModernLandingPages: Updating existing page:', editingPage.id);
        await api.updateLandingPage(editingPage.id, formData);
      } else {
        console.log('ModernLandingPages: Creating new page with data:', formData);
        await api.createLandingPage(companyId, formData);
      }
      
      console.log('ModernLandingPages: Landing page saved successfully');
      setShowModal(false);
      setFormData({ name: '', url: '' });
      setEditingPage(null);
      
      // Recarregar páginas usando a função apropriada
      if (company) {
        loadPages();
      } else if (companyId) {
        loadPagesById(companyId);
      }
    } catch (error) {
      console.error('ModernLandingPages: Error saving page:', error);
      alert(t('tracking.messages.saveError', { message: String((error as any)?.message ?? '') }));
    }
  };

  const handleEdit = (page: LandingPage) => {
    setEditingPage(page);
    setFormData({ name: page.name, url: page.url });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('tracking.messages.confirmDelete'))) return;

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

  const showTrackingCodeModal = (page: LandingPage) => {
    setSelectedPage(page);
    setShowTrackingCode(true);
  };

  const copyTrackingCode = async () => {
    if (!selectedPage) return;
    
    const trackingCode = `<!-- LovoCRM Analytics V5 - Server-Side -->
<script src="${window.location.origin}/m4track-v5.js?v=${new Date().getTime()}"></script>
<script>
  LovoCRM.init('${selectedPage.tracking_code}', '${window.location.origin}');
</script>`;

    try {
      await navigator.clipboard.writeText(trackingCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch (error) {
      console.error('Error copying code:', error);
    }
  };

  const verifyTrackingTag = async (page: LandingPage) => {
    setVerifyingPage(page.id);
    try {
      const result = await api.verifyTrackingTag(page.url, page.tracking_code);
      setVerificationResult({ ...result, pageName: page.name, pageUrl: page.url });
      setShowVerificationModal(true);
    } catch (error) {
      console.error('Error verifying tracking tag:', error);
      setVerificationResult({
        isInstalled: false,
        error: 'Erro interno',
        details: t('tracking.messages.verifyGenericError'),
        pageName: page.name,
        pageUrl: page.url
      });
      setShowVerificationModal(true);
    } finally {
      setVerifyingPage(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('tracking.header.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {currentRole === 'super_admin' 
              ? t('tracking.header.subtitle.superAdmin')
              : t('tracking.header.subtitle.company')
            }
          </p>
        </div>
        <Button 
          icon={<Plus className="w-4 h-4" />}
          onClick={() => setShowModal(true)}
        >
          {t('tracking.actions.newLandingPage')}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card hover>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">{t('tracking.stats.totalPages')}</p>
              <p className="text-2xl font-semibold text-gray-900">{pages.length}</p>
            </div>
            <div className="p-3 bg-blue-50 rounded-xl">
              <Globe className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </Card>

        <Card hover>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">{t('tracking.stats.activePages')}</p>
              <p className="text-2xl font-semibold text-gray-900">
                {pages.filter(p => p.status === 'active').length}
              </p>
            </div>
            <div className="p-3 bg-green-50 rounded-xl">
              <Play className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </Card>

        <Card hover>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">{t('tracking.stats.pausedPages')}</p>
              <p className="text-2xl font-semibold text-gray-900">
                {pages.filter(p => p.status === 'paused').length}
              </p>
            </div>
            <div className="p-3 bg-orange-50 rounded-xl">
              <Pause className="w-6 h-6 text-orange-600" />
            </div>
          </div>
        </Card>

        <Card hover>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">{t('tracking.stats.conversionsToday')}</p>
              <p className="text-2xl font-semibold text-gray-900">0</p>
            </div>
            <div className="p-3 bg-purple-50 rounded-xl">
              <BarChart3 className="w-6 h-6 text-purple-600" />
            </div>
          </div>
        </Card>
      </div>

      {/* Landing Pages Grid */}
      {pages.length === 0 ? (
        <Card className="text-center py-16">
          <div className="max-w-md mx-auto">
            <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Code className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              {t('tracking.empty.title')}
            </h3>
            <p className="text-gray-500 mb-8">
              {t('tracking.empty.description')}
            </p>
            <Button 
              icon={<Plus className="w-5 h-5" />}
              onClick={() => setShowModal(true)}
              size="lg"
            >
              {t('tracking.actions.createFirst')}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {pages.map((page) => (
            <Card key={page.id} hover className="group">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-lg font-semibold text-gray-900 truncate">
                      {page.name}
                    </h3>
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                      page.status === 'active'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-orange-100 text-orange-700'
                    }`}>
                      {page.status === 'active' ? t('tracking.status.active') : t('tracking.status.paused')}
                    </span>
                  </div>
                  
                  {/* Mostrar empresa para super admin */}
                  {currentRole === 'super_admin' && (page as any).companies && (
                    <div className="flex items-center gap-1 mb-2">
                      <Building2 className="w-3 h-3 text-purple-600" />
                      <span className="text-xs text-purple-600 font-medium">
                        {(page as any).companies.name}
                      </span>
                    </div>
                  )}
                  
                  <a
                    href={page.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 group-hover:underline"
                  >
                    <span className="truncate">{page.url}</span>
                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                  </a>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-4">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={page.status === 'active' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  onClick={() => toggleStatus(page)}
                >
                  {page.status === 'active' ? t('tracking.actions.pause') : t('tracking.actions.activate')}
                </Button>
                
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Edit2 className="w-4 h-4" />}
                  onClick={() => handleEdit(page)}
                >
                  {t('tracking.actions.edit')}
                </Button>
                
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Code className="w-4 h-4" />}
                  onClick={() => showTrackingCodeModal(page)}
                >
                  {t('tracking.actions.code')}
                </Button>
                
                <Button
                  size="sm"
                  variant="ghost"
                  icon={verifyingPage === page.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                  onClick={() => verifyTrackingTag(page)}
                  disabled={verifyingPage === page.id}
                  className="text-green-600 hover:text-green-700"
                >
                  {verifyingPage === page.id ? t('tracking.actions.verifying') : t('tracking.actions.verifyTag')}
                </Button>
                
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="w-4 h-4" />}
                  onClick={() => handleDelete(page.id)}
                  className="text-red-600 hover:text-red-700"
                >
                  {t('tracking.actions.delete')}
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  icon={<BarChart3 className="w-4 h-4" />}
                  onClick={() => window.location.href = `/analytics/${page.id}`}
                  className="text-xs"
                >
                  {t('tracking.actions.analytics')}
                </Button>
                <Button
                  variant="outline"
                  icon={<BarChart3 className="w-4 h-4" />}
                  onClick={() => window.location.href = `/advanced-analytics/${page.id}`}
                  className="text-xs bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200 text-blue-700 hover:from-blue-100 hover:to-purple-100"
                >
                  {t('tracking.actions.analyticsPro')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="max-w-md w-full">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-gray-900">
                {editingPage ? t('tracking.modals.editLandingPage') : t('tracking.modals.newLandingPage')}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowModal(false);
                  setEditingPage(null);
                  setFormData({ name: '', url: '' });
                }}
              >
                ✕
              </Button>
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label={t('tracking.fields.name')}
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t('tracking.placeholders.name')}
                required
              />
              
              <Input
                label={t('tracking.fields.url')}
                type="url"
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder={t('tracking.placeholders.url')}
                required
              />
              
              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setShowModal(false);
                    setEditingPage(null);
                    setFormData({ name: '', url: '' });
                  }}
                >
                  {t('tracking.actions.cancel')}
                </Button>
                <Button type="submit" className="flex-1">
                  {editingPage ? t('tracking.actions.save') : t('tracking.actions.create')}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Tracking Code Modal */}
      {showTrackingCode && selectedPage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-6 flex-shrink-0">
              <h2 className="text-xl font-semibold text-gray-900">
                {t('tracking.sections.trackingCode')}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowTrackingCode(false);
                  setSelectedPage(null);
                }}
              >
                ✕
              </Button>
            </div>
            
            <div className="space-y-4 overflow-y-auto flex-1">
              <div>
                <p className="text-sm text-gray-600 mb-2">
                  {t('tracking.trackingCode.pasteInstructions', {
                    bodyTagOpen: '<body>',
                    bodyTagClose: '</body>',
                  })}
                </p>
                <div className="mb-3 flex items-center justify-between p-2 bg-blue-50 border border-blue-200 rounded">
                  <span className="text-xs text-blue-700">
                    {t('tracking.trackingCode.helpBanner')}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-6 px-2"
                    onClick={() => setShowInstallGuide(true)}
                  >
                    {t('tracking.actions.installGuide')}
                  </Button>
                </div>
                <div className="relative">
                  <pre className="bg-gray-900 text-gray-100 p-4 rounded-xl text-sm overflow-x-auto">
{`<!-- LovoCRM Analytics V5 - Server-Side -->
<script src="${window.location.origin}/m4track-v5.js?v=${new Date().getTime()}"></script>
<script>
  LovoCRM.init('${selectedPage.tracking_code}', '${window.location.origin}');
</script>`}
                  </pre>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="absolute top-2 right-2"
                    icon={copiedCode ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    onClick={copyTrackingCode}
                  >
                    {copiedCode ? t('tracking.actions.copied') : t('tracking.actions.copy')}
                  </Button>
                </div>
              </div>
              
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <h4 className="font-medium text-blue-900 mb-2">{t('tracking.trackingCode.howToTitle')}</h4>
                <ol className="text-sm text-blue-800 space-y-1">
                  <li>{t('tracking.trackingCode.howToStep1')}</li>
                  <li>{t('tracking.trackingCode.howToStep2')}</li>
                  <li>{t('tracking.trackingCode.howToStep3')}</li>
                  <li>{t('tracking.trackingCode.howToStep4')}</li>
                </ol>
              </div>

              {/* Webhook Section */}
              <div className="border-t pt-6">
                <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                  <Globe className="w-4 h-4" />
                  {t('tracking.sections.webhookConversions')}
                </h4>
                
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    {t('tracking.trackingCode.webhookIntro')}
                  </p>
                  
                  <div className="relative">
                    <div className="bg-gray-50 border rounded-lg p-3">
                      <code className="text-sm text-gray-800 break-all">
                        {window.location.origin}/webhook/conversion
                      </code>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="absolute top-2 right-2"
                      icon={copiedWebhook ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/webhook/conversion`);
                        setCopiedWebhook(true);
                        setTimeout(() => setCopiedWebhook(false), 2000);
                      }}
                    >
                      {copiedWebhook ? t('tracking.actions.copied') : t('tracking.actions.copy')}
                    </Button>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <h5 className="font-medium text-green-900 mb-2">{t('tracking.trackingCode.requiredParams')}</h5>
                      <ul className="text-sm text-green-800 space-y-1">
                        <li>• <code className="bg-green-100 px-1 rounded">tracking_code</code>: {selectedPage.tracking_code}</li>
                        <li>• {t('tracking.trackingCode.formDataBullet')}</li>
                      </ul>
                    </div>

                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <h5 className="font-medium text-yellow-900 mb-2">{t('tracking.trackingCode.exampleUsage')}</h5>
                      <pre className="text-xs text-yellow-800 bg-yellow-100 p-2 rounded overflow-x-auto whitespace-pre-wrap">
{`POST ${window.location.origin}/webhook/conversion
Content-Type: application/json

{
  "tracking_code": "${selectedPage.tracking_code}",
  "nome": "João Silva",
  "email": "joao@email.com",
  "telefone": "(11) 99999-9999"
}`}
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Verification Result Modal */}
      {showVerificationModal && verificationResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="max-w-2xl w-full">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-gray-900">
                {t('tracking.verification.title')}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowVerificationModal(false);
                  setVerificationResult(null);
                }}
              >
                ✕
              </Button>
            </div>
            
            <div className="space-y-6">
              {/* Header com status */}
              <div className="flex items-center gap-3 p-4 rounded-xl border-2 border-dashed">
                {verificationResult.isInstalled ? (
                  <>
                    <div className="p-2 bg-green-100 rounded-full">
                      <CheckCircle className="w-6 h-6 text-green-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-green-900">{t('tracking.verification.installedTitle')}</h3>
                      <p className="text-sm text-green-700">
                        {t('tracking.verification.installedBody', { pageName: verificationResult.pageName })}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="p-2 bg-red-100 rounded-full">
                      <XCircle className="w-6 h-6 text-red-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-red-900">{t('tracking.verification.notFoundTitle')}</h3>
                      <p className="text-sm text-red-700">
                        {t('tracking.verification.notFoundBody')}
                      </p>
                    </div>
                  </>
                )}
              </div>

              {/* Detalhes da verificação */}
              {verificationResult.details && !verificationResult.error && (
                <div className="space-y-3">
                  <h4 className="font-medium text-gray-900">{t('tracking.verification.detailsTitle')}</h4>
                  
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      {verificationResult.hasScript ? (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-600" />
                      )}
                      <span className="text-sm">
                        {verificationResult.hasScript ? t('tracking.verification.scriptFound') : t('tracking.verification.scriptNotFound')}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {verificationResult.hasTrackingCode ? (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-600" />
                      )}
                      <span className="text-sm">
                        {verificationResult.hasTrackingCode ? t('tracking.verification.codeFound') : t('tracking.verification.codeNotFound')}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {verificationResult.isInCorrectPosition ? (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-orange-500" />
                      )}
                      <span className="text-sm">
                        {verificationResult.isInCorrectPosition ? t('tracking.verification.positionOk') : t('tracking.verification.positionWarn')}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Erro ou limitações */}
              {verificationResult.error && (
                <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 text-orange-600 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-orange-900">{t('tracking.verification.limitationTitle')}</h4>
                      <p className="text-sm text-orange-800 mt-1">
                        {verificationResult.details}
                      </p>
                      {verificationResult.error === 'Erro de CORS' && (
                        <p className="text-xs text-orange-700 mt-2">
                          {t('tracking.verification.corsTip')}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Instruções para correção */}
              {!verificationResult.isInstalled && !verificationResult.error && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
                  <h4 className="font-medium text-blue-900 mb-2">{t('tracking.verification.howToFixTitle')}</h4>
                  <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
                    <li>{t('tracking.verification.howToFixStep1')}</li>
                    <li>{t('tracking.verification.howToFixStep2')}</li>
                    <li>{t('tracking.verification.howToFixStep3')}</li>
                    <li>{t('tracking.verification.howToFixStep4')}</li>
                  </ol>
                </div>
              )}

              {/* Informações da página */}
              <div className="text-xs text-gray-500 border-t pt-4">
                <p><strong>{t('tracking.verification.metaPageLabel')}</strong> {verificationResult.pageName}</p>
                <p><strong>{t('tracking.verification.metaUrlLabel')}</strong> {verificationResult.pageUrl}</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Modal de Guia de Instalação */}
      {showInstallGuide && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-xl font-semibold text-gray-900">
                {t('tracking.sections.installGuide')}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowInstallGuide(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </Button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {/* Regra Principal */}
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-semibold text-green-800 mb-2">{t('tracking.installGuide.mainRuleTitle')}</h3>
                <p className="text-green-700">
                  {t('tracking.installGuide.mainRuleBody')}
                </p>
              </div>

              {/* Posição Correta */}
              <div>
                <h3 className="font-semibold text-gray-800 mb-3">{t('tracking.installGuide.correctPositionTitle')}</h3>
                <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm overflow-x-auto">
{`<!DOCTYPE html>
<html>
<head>
    <title>Minha Landing Page</title>
    <!-- CSS, meta tags, etc. -->
</head>
<body>
    <!-- Todo o conteúdo da página -->
    <h1>Título da Landing Page</h1>
    <p>Conteúdo da página...</p>
    
    <!-- ↓ COLE SEU CÓDIGO AQUI ↓ -->
    <script src="https://app.lovoocrm.com/m4track-v3.js?v=123"></script>
    <script>
      LovoCRM.init('seu-tracking-code', 'https://app.lovoocrm.com');
    </script>
    <!-- ↑ ATÉ AQUI ↑ -->
    
</body> <!-- ← DENTRO do body, antes desta linha de fechamento -->
</html>`}
                </pre>
              </div>

              {/* Posição Incorreta */}
              <div>
                <h3 className="font-semibold text-red-800 mb-3">{t('tracking.installGuide.wrongPositionTitle')}</h3>
                <pre className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-lg text-sm overflow-x-auto">
{`<head>
    <title>Minha Landing Page</title>
    <!-- ❌ NÃO COLOCAR AQUI -->
    <script src="https://app.lovoocrm.com/m4track-v3.js"></script>
    <!-- ❌ MUITO CEDO - DOM não carregou ainda -->
</head>`}
                </pre>
              </div>

              {/* Exemplos por Plataforma */}
              <div>
                <h3 className="font-semibold text-gray-800 mb-3">{t('tracking.installGuide.platformExamplesTitle')}</h3>
                
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="border rounded-lg p-4">
                    <h4 className="font-medium text-blue-600 mb-2">{t('tracking.installGuide.platformWordPress')}</h4>
                    <pre className="bg-gray-100 p-3 rounded text-xs overflow-x-auto">
{`<!-- No arquivo footer.php do tema -->
<?php wp_footer(); ?>

<!-- CÓDIGO LOVOOCRM AQUI -->
<script src="..."></script>
<script>LovoCRM.init(...);</script>

</body>
</html>`}
                    </pre>
                  </div>

                  <div className="border rounded-lg p-4">
                    <h4 className="font-medium text-blue-600 mb-2">{t('tracking.installGuide.platformElementor')}</h4>
                    <div className="text-sm text-gray-600 space-y-1">
                      <p>{t('tracking.installGuide.elementorStep1')}</p>
                      <p>{t('tracking.installGuide.elementorStep2')}</p>
                      <p>{t('tracking.installGuide.elementorStep3')}</p>
                      <p>{t('tracking.installGuide.elementorStep4')}</p>
                    </div>
                  </div>

                  <div className="border rounded-lg p-4">
                    <h4 className="font-medium text-blue-600 mb-2">{t('tracking.installGuide.platformHtml')}</h4>
                    <pre className="bg-gray-100 p-3 rounded text-xs overflow-x-auto">
{`<!-- Final da página -->
    <!-- Conteúdo -->
    
    <!-- CÓDIGO AQUI -->
    <script src="..."></script>
</body>`}
                    </pre>
                  </div>

                  <div className="border rounded-lg p-4">
                    <h4 className="font-medium text-blue-600 mb-2">{t('tracking.installGuide.platformGtm')}</h4>
                    <div className="text-sm text-gray-600 space-y-1">
                      <p>{t('tracking.installGuide.gtmStep1')}</p>
                      <p>{t('tracking.installGuide.gtmStep2')}</p>
                      <p>{t('tracking.installGuide.gtmStep3')}</p>
                      <p>{t('tracking.installGuide.gtmStep4')}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Por que esta posição */}
              <div>
                <h3 className="font-semibold text-gray-800 mb-3">{t('tracking.installGuide.whyPositionTitle')}</h3>
                
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <h4 className="font-medium text-green-800 mb-2">{t('tracking.installGuide.bodyAdvantagesTitle')}</h4>
                    <ul className="text-sm text-green-700 space-y-1">
                      <li>{t('tracking.installGuide.bodyAdvantage1')}</li>
                      <li>{t('tracking.installGuide.bodyAdvantage2')}</li>
                      <li>{t('tracking.installGuide.bodyAdvantage3')}</li>
                      <li>{t('tracking.installGuide.bodyAdvantage4')}</li>
                      <li>{t('tracking.installGuide.bodyAdvantage5')}</li>
                    </ul>
                  </div>

                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <h4 className="font-medium text-red-800 mb-2">{t('tracking.installGuide.headProblemsTitle')}</h4>
                    <ul className="text-sm text-red-700 space-y-1">
                      <li>{t('tracking.installGuide.headProblem1')}</li>
                      <li>{t('tracking.installGuide.headProblem2')}</li>
                      <li>{t('tracking.installGuide.headProblem3')}</li>
                      <li>{t('tracking.installGuide.headProblem4')}</li>
                      <li>{t('tracking.installGuide.headProblem5')}</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Checklist */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-blue-800 mb-3">{t('tracking.installGuide.checklistTitle')}</h3>
                <div className="grid md:grid-cols-2 gap-2 text-sm text-blue-700">
                  <div>{t('tracking.installGuide.checklist1')}</div>
                  <div>{t('tracking.installGuide.checklist2')}</div>
                  <div>{t('tracking.installGuide.checklist3')}</div>
                  <div>{t('tracking.installGuide.checklist4')}</div>
                  <div>{t('tracking.installGuide.checklist5')}</div>
                  <div>{t('tracking.installGuide.checklist6')}</div>
                </div>
              </div>
            </div>

            <div className="p-6 border-t bg-gray-50">
              <div className="flex justify-between items-center">
                <p className="text-sm text-gray-600">
                  {t('tracking.installGuide.footerTip')}
                </p>
                <Button
                  onClick={() => setShowInstallGuide(false)}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {t('tracking.actions.understoodClose')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
