export const exportToCSV = (data: any[], filename: string) => {
  if (data.length === 0) {
    alert('Nenhum dado para exportar');
    return;
  }

  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(','),
    ...data.map(row =>
      headers.map(header => {
        const value = row[header];
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') return JSON.stringify(value).replace(/,/g, ';');
        return String(value).replace(/,/g, ';');
      }).join(',')
    )
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const exportToPDF = async (elementId: string, filename: string) => {
  alert('Funcionalidade de exportação para PDF estará disponível em breve. Use a opção de impressão do navegador.');
  window.print();
};

export const prepareAnalyticsForExport = (conversions: any[]) => {
  return conversions.map(conversion => {
    const summary = conversion.behavior_summary || {};
    return {
      data: new Date(conversion.converted_at).toLocaleDateString('pt-BR'),
      email: conversion.form_data?.email || 'N/A',
      nome: conversion.form_data?.name || 'N/A',
      dispositivo: summary.device_type || 'N/A',
      duracao_sessao: summary.session_duration || 0,
      scroll_depth: summary.scroll_depth || 'N/A',
      total_cliques: summary.total_clicks || 0,
      cliques_cta: summary.cta_clicks || 0,
      engagement_score: conversion.engagement_score || 0,
      tempo_para_converter: summary.time_to_convert || 0,
    };
  });
};

// NOVAS FUNÇÕES PARA EXPORTAÇÃO DE LEADS
export const prepareLeadsForExport = (leads: any[]) => {
  return leads.map(lead => {
    const processedLead: any = {
      'Nome': lead.name || '',
      'Email': lead.email || '',
      'Telefone': lead.phone || '',
      'Origem': lead.origin || '',
      'Status': lead.status || '',
      'Interesse': lead.interest || '',
      'Data Criação': lead.created_at ? new Date(lead.created_at).toLocaleDateString('pt-BR') : '',
      
      // Campos da empresa
      'Empresa': lead.company_name || '',
      'CNPJ': lead.company_cnpj || '',
      'Razão Social': lead.company_legal_name || '',
      'Telefone Empresa': lead.company_phone || '',
      'Email Empresa': lead.company_email || '',
      'Website': lead.company_website || '',
      'CEP': lead.company_cep || '',
      'Endereço': lead.company_address || '',
      'Cidade': lead.company_city || '',
      'Estado': lead.company_state || '',
      'Setor': lead.company_sector || ''
    };
    
    // Adicionar campos personalizados
    if (lead.lead_custom_values && Array.isArray(lead.lead_custom_values)) {
      lead.lead_custom_values.forEach((customValue: any) => {
        if (customValue.lead_custom_fields) {
          const fieldLabel = customValue.lead_custom_fields.field_label || 
                           customValue.lead_custom_fields.field_name || 
                           `Campo ${customValue.lead_custom_fields.numeric_id}`;
          processedLead[fieldLabel] = customValue.value || '';
        }
      });
    }
    
    return processedLead;
  });
};

export const exportToExcel = async (data: any[], filename: string) => {
  if (data.length === 0) {
    alert('Nenhum dado para exportar');
    return;
  }

  try {
    // Importação dinâmica do XLSX
    const XLSX = await import('xlsx');
    
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads');
    
    // Configurar larguras das colunas
    const colWidths = Object.keys(data[0]).map(() => ({ wch: 20 }));
    worksheet['!cols'] = colWidths;
    
    XLSX.writeFile(workbook, `${filename}.xlsx`);
  } catch (error) {
    console.error('Erro ao exportar Excel:', error);
    alert('Erro ao gerar arquivo Excel. Tente novamente.');
  }
};

export const generateExportFilename = (prefix: string = 'leads') => {
  const now = new Date();
  const date = now.toLocaleDateString('pt-BR').replace(/\//g, '-');
  const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  return `${prefix}_${date}_${time}`;
};
