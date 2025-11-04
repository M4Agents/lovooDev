import React, { useState, useRef, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { supabase } from '../lib/supabase';
import * as XLSX from 'xlsx';
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
  FileUp,
  Link,
  Settings
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
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'importing' | 'complete'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedLead[]>([]);
  const [importResults, setImportResults] = useState<{
    success: number;
    errors: number;
    total: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleSheetsUrl, setGoogleSheetsUrl] = useState('');
  
  // NOVOS ESTADOS PARA MAPEAMENTO
  const [unmappedColumns, setUnmappedColumns] = useState<string[]>([]);
  const [customFields, setCustomFields] = useState<any[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);

  // Calcular campos personalizados mapeados para o preview
  const mappedCustomFields = useMemo(() => {
    return Object.entries(columnMapping)
      .filter(([, fieldId]) => fieldId)
      .map(([columnName, fieldId]) => {
        const field = customFields.find(f => f.id === fieldId);
        return {
          id: fieldId,
          column: columnName,
          label: field?.field_label || columnName,
          numericId: field?.numeric_id
        };
      });
  }, [columnMapping, customFields]);

  // Detectar tipo de arquivo/URL
  const detectImportType = (input: File | string) => {
    if (typeof input === 'string' && input.includes('docs.google.com/spreadsheets')) {
      return 'google-sheets';
    } else if (input instanceof File) {
      const fileName = input.name.toLowerCase();
      if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        return 'excel';
      } else if (fileName.endsWith('.csv')) {
        return 'csv';
      }
    }
    return 'unknown';
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      
      const type = detectImportType(selectedFile);
      switch (type) {
        case 'excel':
          parseExcel(selectedFile);
          break;
        case 'csv':
        default:
          parseFile(selectedFile); // FUNÇÃO ORIGINAL MANTIDA
          break;
      }
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

  // NOVA FUNÇÃO - Parse Excel (não altera parseFile)
  const parseExcel = async (file: File) => {
    setLoading(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const csvText = XLSX.utils.sheet_to_csv(worksheet);
      
      // Reutilizar lógica do CSV existente
      parseCsvText(csvText);
    } catch (error) {
      console.error('Error parsing Excel file:', error);
      alert('Erro ao processar o arquivo Excel. Verifique se é um arquivo válido.');
    } finally {
      setLoading(false);
    }
  };

  // NOVA FUNÇÃO - Parse Google Sheets via link compartilhado
  const parseGoogleSheets = async (shareUrl: string) => {
    setLoading(true);
    try {
      // Extrair ID da planilha do link
      const spreadsheetId = shareUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
      
      if (!spreadsheetId) {
        alert('Link inválido. Use um link de planilha do Google Sheets.');
        return;
      }

      // Converter para URL de export CSV
      const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=0`;
      
      // Buscar dados como CSV
      const response = await fetch(csvUrl);
      
      if (!response.ok) {
        throw new Error('Não foi possível acessar a planilha. Verifique se ela está compartilhada publicamente.');
      }
      
      const csvText = await response.text();
      
      // Reutilizar lógica do CSV existente
      parseCsvText(csvText);
    } catch (error) {
      console.error('Error parsing Google Sheets:', error);
      alert('Erro ao importar do Google Sheets. Verifique se a planilha está compartilhada como "Qualquer pessoa com o link pode visualizar".');
    } finally {
      setLoading(false);
    }
  };

  // NOVA FUNÇÃO - Processar texto CSV (extraída da lógica existente)
  const parseCsvText = async (csvText: string) => {
    const lines = csvText.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) {
      alert('O arquivo deve conter pelo menos um cabeçalho e uma linha de dados.');
      return;
    }

    // Parse CSV (mesma lógica da função parseFile)
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    setRawHeaders(headers);
    
    // Detectar colunas não mapeadas
    const unmapped: string[] = [];
    const isStandardField = (header: string) => {
      const lowerHeader = header.toLowerCase();
      return lowerHeader.includes('nome') || lowerHeader.includes('name') ||
             lowerHeader.includes('email') || lowerHeader.includes('e-mail') ||
             lowerHeader.includes('telefone') || lowerHeader.includes('phone') || lowerHeader.includes('celular') ||
             lowerHeader.includes('origem') || lowerHeader.includes('origin') ||
             lowerHeader.includes('status') ||
             lowerHeader.includes('interesse') || lowerHeader.includes('interest');
    };
    
    const isNumericId = (header: string) => /^\d+$/.test(header);
    
    headers.forEach(header => {
      if (!isStandardField(header) && !isNumericId(header)) {
        unmapped.push(header);
      }
    });
    
    setUnmappedColumns(unmapped);
    
    // Se há colunas não mapeadas, carregar campos personalizados
    if (unmapped.length > 0 && company?.id) {
      try {
        const { data: fields, error } = await supabase
          .rpc('get_all_custom_fields_for_import', {
            p_company_id: company.id
          });
        
        if (!error && fields) {
          setCustomFields(fields);
        }
      } catch (error) {
        console.error('Error loading custom fields:', error);
      }
    }

    const data: ParsedLead[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      const lead: ParsedLead = { name: '' };

      headers.forEach((header, index) => {
        const value = values[index] || '';
        
        // Mapear colunas comuns (mesma lógica existente)
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
    
    // Decidir próximo step baseado em colunas não mapeadas
    if (unmapped.length > 0) {
      setStep('mapping');
    } else {
      setStep('preview');
    }
  };

  const handleImport = async () => {
    if (!company?.id || parsedData.length === 0) return;

    setStep('importing');
    setLoading(true);

    try {
      // Preparar dados para importação
      const leadsToImport = parsedData.map(lead => {
        const leadData: any = {
          name: lead.name,
          email: lead.email || undefined,
          phone: lead.phone || undefined,
          origin: lead.origin || 'import',
          status: lead.status || 'novo',
          interest: lead.interest || undefined
        };

        // Adicionar campos personalizados mapeados
        Object.entries(columnMapping).forEach(([columnName, fieldId]) => {
          if (fieldId && lead[columnName]) {
            // Usar fieldId como chave para que a API reconheça como campo personalizado
            leadData[`custom_${fieldId}`] = lead[columnName];
          }
        });

        // Manter campos com IDs numéricos (sistema existente)
        Object.keys(lead).forEach(key => {
          if (/^\d+$/.test(key) && lead[key]) {
            leadData[key] = lead[key];
          }
        });

        return leadData;
      });

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
    setGoogleSheetsUrl('');
    setUnmappedColumns([]);
    setCustomFields([]);
    setColumnMapping({});
    setRawHeaders([]);
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
                  accept=".csv,.txt,.xlsx,.xls"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <FileUp className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <h4 className="text-lg font-medium text-gray-900 mb-2">
                  Selecione seu arquivo CSV ou Excel
                </h4>
                <p className="text-gray-500 mb-4">
                  Arraste e solte ou clique para selecionar (.csv, .xlsx, .xls)
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

              {/* Google Sheets Import */}
              <div className="border-t pt-6 mt-6">
                <div className="flex items-center gap-3 mb-4">
                  <Link className="w-6 h-6 text-green-600" />
                  <h4 className="text-lg font-medium text-gray-900">
                    Ou importe do Google Sheets
                  </h4>
                </div>
                
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                  <p className="text-sm text-green-700 mb-3">
                    Cole o link de uma planilha compartilhada do Google Sheets para importar diretamente.
                  </p>
                  <div className="space-y-3">
                    <input
                      type="url"
                      placeholder="https://docs.google.com/spreadsheets/d/..."
                      value={googleSheetsUrl}
                      onChange={(e) => setGoogleSheetsUrl(e.target.value)}
                      className="w-full px-3 py-2 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    />
                    <button
                      onClick={() => googleSheetsUrl && parseGoogleSheets(googleSheetsUrl)}
                      disabled={loading || !googleSheetsUrl}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                    >
                      <Link className="w-4 h-4" />
                      {loading ? 'Importando...' : 'Importar do Google Sheets'}
                    </button>
                  </div>
                </div>
                
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <p className="text-sm text-yellow-700">
                    <strong>Importante:</strong> A planilha deve estar compartilhada como "Qualquer pessoa com o link pode visualizar"
                  </p>
                </div>
              </div>

              {/* Instruções */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-medium text-gray-900 mb-2">
                  Formato do arquivo:
                </h4>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Arquivo CSV/Excel com cabeçalhos na primeira linha</li>
                  <li>• Coluna "Nome" é obrigatória</li>
                  <li>• Colunas opcionais: Email, Telefone, Origem, Status, Interesse</li>
                  <li>• <strong>Campos personalizados:</strong> Use IDs numéricos (1, 2, 3, etc.)</li>
                  <li>• Máximo de 1.000 leads por importação</li>
                  <li>• Codificação UTF-8 recomendada</li>
                </ul>
              </div>
            </div>
          )}

          {/* Step Mapping */}
          {step === 'mapping' && (
            <div className="space-y-6">
              <div className="text-center">
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Mapear Campos Personalizados
                </h3>
                <p className="text-gray-500 mb-6">
                  Encontramos {unmappedColumns.length} colunas que não são campos padrão. 
                  Selecione o campo personalizado correspondente para cada uma.
                </p>
              </div>

              <div className="space-y-4">
                {unmappedColumns.map(column => {
                  // Pegar exemplo de valor da primeira linha de dados
                  const exampleValue = parsedData.length > 0 ? parsedData[0][column] : '';
                  
                  return (
                    <div key={column} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-900 mb-1">
                            Coluna: "{column}"
                          </h4>
                          {exampleValue && (
                            <p className="text-sm text-gray-500">
                              Exemplo: {exampleValue}
                            </p>
                          )}
                        </div>
                        <div className="ml-4">
                          <select 
                            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            value={columnMapping[column] || ''}
                            onChange={(e) => setColumnMapping(prev => ({
                              ...prev,
                              [column]: e.target.value
                            }))}
                          >
                            <option value="">Ignorar este campo</option>
                            {customFields.map(field => (
                              <option key={field.id} value={field.id}>
                                {field.field_label} (ID: {field.numeric_id})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-blue-900 mb-1">
                      Dica
                    </h4>
                    <p className="text-sm text-blue-700">
                      Você pode ignorar campos que não deseja importar selecionando "Ignorar este campo". 
                      Apenas os campos mapeados serão importados como campos personalizados.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-between">
                <button
                  onClick={() => setStep('upload')}
                  className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Voltar
                </button>
                <button
                  onClick={() => setStep('preview')}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Continuar para Preview
                </button>
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
                  <table className="w-full min-w-max">
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
                        {/* Campos personalizados mapeados */}
                        {mappedCustomFields.map(field => (
                          <th key={field.id} className="px-4 py-3 text-left text-xs font-medium text-purple-600 uppercase min-w-[150px]">
                            <Settings className="w-4 h-4 inline mr-1" />
                            {field.label}
                          </th>
                        ))}
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
                          {/* Valores dos campos personalizados mapeados */}
                          {mappedCustomFields.map(field => (
                            <td key={field.id} className="px-4 py-3 text-sm font-medium text-purple-700">
                              {lead[field.column] || '-'}
                            </td>
                          ))}
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

              {/* Dica para scroll horizontal se há muitos campos */}
              {mappedCustomFields.length > 0 && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                  <div className="flex items-start gap-3">
                    <Settings className="w-5 h-5 text-purple-600 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-purple-900 mb-1">
                        Campos Personalizados Mapeados
                      </h4>
                      <p className="text-sm text-purple-700">
                        {mappedCustomFields.length} campo(s) personalizado(s) detectado(s) e mapeado(s). 
                        {mappedCustomFields.length > 2 && ' Use scroll horizontal para ver todos os campos.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

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
