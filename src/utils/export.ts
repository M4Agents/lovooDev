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
