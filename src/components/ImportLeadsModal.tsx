import React, { useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import {
  X,
  Upload,
  Download,
  CheckCircle,
  AlertCircle,
  User,
  Mail,
  Phone,
  Building,
  Tag,
  FileUp
} from 'lucide-react';

interface ImportLeadsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

interface ParsedLead {
  name: string;
  email?: string;
  phone?: string;
  origin?: string;
  status?: string;
  interest?: string;
  [key: string]: any;
}

export const ImportLeadsModal: React.FC<ImportLeadsModalProps> = ({
  isOpen,
  onClose,
  onImportComplete
}) => {
  const { company } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'complete'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedLead[]>([]);
  const [importResults, setImportResults] = useState<{
    success: number;
    errors: number;
    total: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      parseFile(selectedFile);
    }
  };

  const parseFile = async (file: File) => {
    setLoading(true);
    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        alert('O arquivo deve conter pelo menos um cabeçalho e uma linha de dados.');
        return;
      }

      // Parse CSV
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      const data: ParsedLead[] = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
        const lead: ParsedLead = { name: '' };

        headers.forEach((header, index) => {
          const value = values[index] || '';
          
          // Mapear colunas comuns
          const lowerHeader = header.toLowerCase();
          if (lowerHeader.includes('nome') || lowerHeader.includes('name')) {
            lead.name = value;
          } else if (lowerHeader.includes('email') || lowerHeader.includes('e-mail')) {
            lead.email = value;
          } else if (lowerHeader.includes('telefone') || lowerHeader.includes('phone') || lowerHeader.includes('celular')) {
            lead.phone = value;
          } else if (lowerHeader.includes('origem') || lowerHeader.includes('origin')) {
            lead.origin = value;
          } else if (lowerHeader.includes('status')) {
            lead.status = value;
          } else if (lowerHeader.includes('interesse') || lowerHeader.includes('interest')) {
            lead.interest = value;
          } else {
            lead[header] = value;
          }
        });

        // Validar se tem pelo menos o nome
        if (lead.name) {
          data.push(lead);
        }
      }

      setParsedData(data);
      setStep('preview');
    } catch (error) {
      console.error('Error parsing file:', error);
      alert('Erro ao processar o arquivo. Verifique se é um CSV válido.');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!company?.id || parsedData.length === 0) return;

    setStep('importing');
    setLoading(true);

    try {
      // Preparar dados para importação
      const leadsToImport = parsedData.map(lead => ({
        name: lead.name,
        email: lead.email || undefined,
        phone: lead.phone || undefined,
        origin: lead.origin || 'import',
        status: lead.status || 'novo',
        interest: lead.interest || undefined
      }));

      // Importar em lotes de 100
      let successCount = 0;
      let errorCount = 0;
      const batchSize = 100;

      for (let i = 0; i < leadsToImport.length; i += batchSize) {
        const batch = leadsToImport.slice(i, i + batchSize);
        try {
          await api.importLeads(company.id, batch);
          successCount += batch.length;
        } catch (error) {
          console.error('Error importing batch:', error);
          errorCount += batch.length;
        }
      }

      setImportResults({
        success: successCount,
        errors: errorCount,
        total: leadsToImport.length
      });

      setStep('complete');
      onImportComplete();
    } catch (error) {
      console.error('Error importing leads:', error);
      alert('Erro durante a importação. Tente novamente.');
      setStep('preview');
    } finally {
      setLoading(false);
    }
  };

  const downloadTemplate = () => {
    const csvContent = 'Nome,Email,Telefone,Origem,Status,Interesse,1,2,3\n' +
                      'João Silva,joao@email.com,(11) 99999-9999,landing_page,novo,Desenvolvimento de site,Valor Campo 1,Valor Campo 2,Valor Campo 3\n' +
                      'Maria Santos,maria@email.com,(11) 88888-8888,whatsapp,em_qualificacao,Marketing digital,Outro Valor 1,Outro Valor 2,Outro Valor 3';
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'template_leads.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const resetModal = () => {
    setStep('upload');
    setFile(null);
    setParsedData([]);
    setImportResults(null);
    setLoading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    resetModal();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <Upload className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-900">
              Importar Leads
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6">
          {/* Step Upload */}
          {step === 'upload' && (
            <div className="space-y-6">
              <div className="text-center">
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Faça upload do seu arquivo CSV
                </h3>
                <p className="text-gray-500 mb-6">
                  Importe seus leads em massa usando um arquivo CSV. Máximo de 1.000 leads por importação.
                </p>
              </div>

              {/* Template Download */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Download className="w-5 h-5 text-blue-600 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="font-medium text-blue-900 mb-1">
                      Baixe o template
                    </h4>
                    <p className="text-sm text-blue-700 mb-3">
                      Use nosso template para garantir que seus dados sejam importados corretamente.
                    </p>
                    <button
                      onClick={downloadTemplate}
                      className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Baixar Template CSV
                    </button>
                  </div>
                </div>
              </div>

              {/* File Upload */}
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <FileUp className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <h4 className="text-lg font-medium text-gray-900 mb-2">
                  Selecione seu arquivo CSV
                </h4>
                <p className="text-gray-500 mb-4">
                  Arraste e solte ou clique para selecionar
                </p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  {loading ? 'Processando...' : 'Selecionar Arquivo'}
                </button>
              </div>

              {/* Instruções */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-medium text-gray-900 mb-2">
                  Formato do arquivo:
                </h4>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Arquivo CSV com cabeçalhos na primeira linha</li>
                  <li>• Coluna "Nome" é obrigatória</li>
                  <li>• Colunas opcionais: Email, Telefone, Origem, Status, Interesse</li>
                  <li>• <strong>Campos personalizados:</strong> Use IDs numéricos (1, 2, 3, etc.)</li>
                  <li>• Máximo de 1.000 leads por importação</li>
                  <li>• Codificação UTF-8 recomendada</li>
                </ul>
              </div>
            </div>
          )}

          {/* Step Preview */}
          {step === 'preview' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">
                    Prévia da Importação
                  </h3>
                  <p className="text-gray-500">
                    {parsedData.length} leads encontrados no arquivo "{file?.name}"
                  </p>
                </div>
                <button
                  onClick={() => setStep('upload')}
                  className="text-blue-600 hover:text-blue-800 transition-colors"
                >
                  Alterar arquivo
                </button>
              </div>

              {/* Preview Table */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          <User className="w-4 h-4 inline mr-1" />
                          Nome
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          <Mail className="w-4 h-4 inline mr-1" />
                          Email
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          <Phone className="w-4 h-4 inline mr-1" />
                          Telefone
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          <Building className="w-4 h-4 inline mr-1" />
                          Origem
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          <Tag className="w-4 h-4 inline mr-1" />
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {parsedData.slice(0, 10).map((lead, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {lead.name}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {lead.email || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {lead.phone || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {lead.origin || 'import'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {lead.status || 'novo'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                {parsedData.length > 10 && (
                  <div className="bg-gray-50 px-4 py-3 text-sm text-gray-500 text-center">
                    Mostrando 10 de {parsedData.length} leads. Todos serão importados.
                  </div>
                )}
              </div>

              {/* Import Button */}
              <div className="flex items-center justify-end space-x-3">
                <button
                  onClick={() => setStep('upload')}
                  className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Voltar
                </button>
                <button
                  onClick={handleImport}
                  disabled={loading || parsedData.length === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  Importar {parsedData.length} Leads
                </button>
              </div>
            </div>
          )}

          {/* Step Importing */}
          {step === 'importing' && (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Importando leads...
              </h3>
              <p className="text-gray-500">
                Aguarde enquanto processamos seus dados.
              </p>
            </div>
          )}

          {/* Step Complete */}
          {step === 'complete' && importResults && (
            <div className="text-center py-12">
              <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Importação Concluída!
              </h3>
              
              <div className="bg-gray-50 rounded-lg p-6 mb-6 max-w-md mx-auto">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-green-600">
                      {importResults.success}
                    </div>
                    <div className="text-sm text-gray-500">Importados</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-red-600">
                      {importResults.errors}
                    </div>
                    <div className="text-sm text-gray-500">Erros</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">
                      {importResults.total}
                    </div>
                    <div className="text-sm text-gray-500">Total</div>
                  </div>
                </div>
              </div>

              {importResults.errors > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                    <div className="text-sm text-yellow-800">
                      <p className="font-medium mb-1">Alguns leads não foram importados</p>
                      <p>
                        Verifique se os dados estão no formato correto e tente novamente com os registros que falharam.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={handleClose}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Fechar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
