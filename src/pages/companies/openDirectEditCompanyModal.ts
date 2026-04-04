/**
 * LEGACY: modal de edição cadastral injetado no DOM (insertAdjacentHTML).
 * Comportamento preservado da implementação anterior em Companies.tsx.
 * Substituir por modal React + fluxo tipado em onda futura.
 */
import type { Company } from '../../lib/supabase'

export function openDirectEditCompanyModal(comp: Company): void {
const modalHtml = `
  <div id="edit-modal-direct" style="
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.8);
    z-index: 999999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  ">
    <div style="
      background-color: white;
      border-radius: 12px;
      max-width: 900px;
      width: 100%;
      max-height: 90vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    ">
      <!-- Header -->
      <div style="padding: 24px; border-bottom: 1px solid #e2e8f0;">
        <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600;">
          Editar Empresa - ${comp.name}
        </h2>

        <!-- Abas -->
        <div style="display: flex; gap: 4px; background-color: #f1f5f9; padding: 4px; border-radius: 8px;">
          <button id="tab-dados-principais" style="
            padding: 8px 12px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; font-size: 14px;
            background-color: white; color: #1e293b;
          ">📋 Dados Principais</button>
          <button id="tab-endereco" style="
            padding: 8px 12px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; font-size: 14px;
            background-color: transparent; color: #64748b;
          ">📍 Endereço</button>
          <button id="tab-contatos" style="
            padding: 8px 12px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; font-size: 14px;
            background-color: transparent; color: #64748b;
          ">📞 Contatos</button>
          <button id="tab-dominios" style="
            padding: 8px 12px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; font-size: 14px;
            background-color: transparent; color: #64748b;
          ">🌐 Domínios & URLs</button>
        </div>
      </div>

      <!-- Conteúdo -->
      <div style="padding: 24px; overflow-y: auto; flex: 1;">
        <!-- Aba Dados Principais -->
        <div id="content-dados-principais" style="display: block;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Nome da Conta *</label>
              <input type="text" value="${comp.name || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Nome Fantasia</label>
              <input type="text" value="${comp.nome_fantasia || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">CNPJ</label>
              <input type="text" placeholder="00.000.000/0000-00" value="${comp.cnpj || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Razão Social</label>
              <input type="text" value="${comp.razao_social || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Inscrição Estadual</label>
              <input type="text" value="${comp.inscricao_estadual || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Inscrição Municipal</label>
              <input type="text" value="${comp.inscricao_municipal || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Tipo de Empresa</label>
              <select value="${comp.tipo_empresa || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;">
                <option value="">Selecionar</option>
                <option value="MEI">MEI</option>
                <option value="LTDA">Ltda</option>
                <option value="SA">S.A.</option>
                <option value="EIRELI">EIRELI</option>
                <option value="Outro">Outro</option>
              </select>
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Porte da Empresa</label>
              <select value="${comp.porte_empresa || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;">
                <option value="">Selecionar</option>
                <option value="Microempresa">Microempresa</option>
                <option value="Pequena">Pequena</option>
                <option value="Média">Média</option>
                <option value="Grande">Grande</option>
              </select>
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Ramo de Atividade</label>
              <input type="text" value="${comp.ramo_atividade || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Data de Fundação</label>
              <input type="date" value="${comp.data_fundacao || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Site Principal</label>
              <input type="url" value="${comp.site_principal || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
          </div>
          <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Descrição da Empresa</label>
            <textarea value="${comp.descricao_empresa || ''}" rows="3" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; resize: vertical;">${comp.descricao_empresa || ''}</textarea>
          </div>
        </div>

        <!-- Aba Endereço -->
        <div id="content-endereco" style="display: none;">
          <div style="display: grid; grid-template-columns: 1fr 2fr 1fr; gap: 16px; margin-bottom: 16px;">
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">CEP</label>
              <input type="text" placeholder="00000-000" value="${comp.cep || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Logradouro</label>
              <input type="text" value="${comp.logradouro || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Número</label>
              <input type="text" value="${comp.numero || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Bairro</label>
              <input type="text" value="${comp.bairro || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Cidade</label>
              <input type="text" value="${comp.cidade || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Estado</label>
              <select value="${comp.estado || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;">
                <option value="">Selecionar</option>
                <option value="AC">Acre</option>
                <option value="AL">Alagoas</option>
                <option value="AP">Amapá</option>
                <option value="AM">Amazonas</option>
                <option value="BA">Bahia</option>
                <option value="CE">Ceará</option>
                <option value="DF">Distrito Federal</option>
                <option value="ES">Espírito Santo</option>
                <option value="GO">Goiás</option>
                <option value="MA">Maranhão</option>
                <option value="MT">Mato Grosso</option>
                <option value="MS">Mato Grosso do Sul</option>
                <option value="MG">Minas Gerais</option>
                <option value="PA">Pará</option>
                <option value="PB">Paraíba</option>
                <option value="PR">Paraná</option>
                <option value="PE">Pernambuco</option>
                <option value="PI">Piauí</option>
                <option value="RJ">Rio de Janeiro</option>
                <option value="RN">Rio Grande do Norte</option>
                <option value="RS">Rio Grande do Sul</option>
                <option value="RO">Rondônia</option>
                <option value="RR">Roraima</option>
                <option value="SC">Santa Catarina</option>
                <option value="SP">São Paulo</option>
                <option value="SE">Sergipe</option>
                <option value="TO">Tocantins</option>
              </select>
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Complemento</label>
              <input type="text" value="${comp.complemento || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">País</label>
              <input type="text" value="${comp.pais || 'Brasil'}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
          </div>
        </div>

        <!-- Aba Contatos -->
        <div id="content-contatos" style="display: none;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Telefone Principal</label>
              <input type="text" placeholder="(00) 00000-0000" value="${comp.telefone_principal || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Telefone Secundário</label>
              <input type="text" placeholder="(00) 00000-0000" value="${comp.telefone_secundario || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">WhatsApp</label>
              <input type="text" placeholder="(00) 00000-0000" value="${comp.whatsapp || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Email Principal</label>
              <input type="email" value="${comp.email_principal || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Email Comercial</label>
              <input type="email" value="${comp.email_comercial || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Email Financeiro</label>
              <input type="email" value="${comp.email_financeiro || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Email Suporte</label>
              <input type="email" value="${comp.email_suporte || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
            </div>
          </div>

          <!-- Responsável Principal -->
          <div style="margin-bottom: 16px;">
            <h4 style="margin: 0 0 12px 0; font-weight: 600; color: #374151;">Responsável Principal</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
              <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Nome</label>
                <input type="text" value="${comp.responsavel_principal?.nome || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
              </div>
              <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Cargo</label>
                <input type="text" value="${comp.responsavel_principal?.cargo || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
              </div>
            </div>
          </div>

          <!-- Contato Financeiro -->
          <div style="margin-bottom: 16px;">
            <h4 style="margin: 0 0 12px 0; font-weight: 600; color: #374151;">Contato Financeiro</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px;">
              <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Nome</label>
                <input type="text" value="${comp.contato_financeiro?.nome || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
              </div>
              <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Email</label>
                <input type="email" value="${comp.contato_financeiro?.email || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
              </div>
              <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Telefone</label>
                <input type="text" placeholder="(00) 00000-0000" value="${comp.contato_financeiro?.telefone || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
              </div>
            </div>
          </div>
        </div>

        <!-- Aba Domínios & URLs -->
        <div id="content-dominios" style="display: none;">
          <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">URL do Google My Business</label>
            <input type="url" value="${comp.url_google_business || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
          </div>

          <!-- Redes Sociais -->
          <div style="margin-bottom: 16px;">
            <h4 style="margin: 0 0 12px 0; font-weight: 600; color: #374151;">Redes Sociais</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
              <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Facebook</label>
                <input type="url" value="${comp.redes_sociais?.facebook || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
              </div>
              <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Instagram</label>
                <input type="url" value="${comp.redes_sociais?.instagram || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
              </div>
              <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">LinkedIn</label>
                <input type="url" value="${comp.redes_sociais?.linkedin || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
              </div>
              <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Twitter</label>
                <input type="url" value="${comp.redes_sociais?.twitter || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
              </div>
              <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">YouTube</label>
                <input type="url" value="${comp.redes_sociais?.youtube || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
              </div>
            </div>
          </div>

          <!-- Domínios Secundários -->
          <div style="margin-bottom: 16px;">
            <h4 style="margin: 0 0 12px 0; font-weight: 600; color: #374151;">Domínios Secundários</h4>
            <textarea placeholder="Digite os domínios secundários, um por linha" rows="3" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; resize: vertical;">${Array.isArray(comp.dominios_secundarios) ? comp.dominios_secundarios.join('\\n') : ''}</textarea>
          </div>

          <!-- URLs Landing Pages -->
          <div style="margin-bottom: 16px;">
            <h4 style="margin: 0 0 12px 0; font-weight: 600; color: #374151;">URLs Landing Pages</h4>
            <textarea placeholder="Digite as URLs das landing pages, uma por linha" rows="3" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; resize: vertical;">${Array.isArray(comp.urls_landing_pages) ? comp.urls_landing_pages.join('\\n') : ''}</textarea>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding: 24px; border-top: 1px solid #e2e8f0; display: flex; gap: 12px; justify-content: flex-end;">
        <button onclick="document.getElementById('edit-modal-direct').remove()" style="
          padding: 10px 20px; border: 1px solid #d1d5db; background-color: white; color: #374151;
          border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 14px;
        ">Cancelar</button>
        <button onclick="alert('Dados salvos com sucesso!'); document.getElementById('edit-modal-direct').remove()" style="
          padding: 10px 20px; border: none; background-color: #3b82f6; color: white;
          border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 14px;
        ">Salvar Alterações</button>
      </div>
    </div>
  </div>

`;

// Remover modal existente se houver
const existingModal = document.getElementById('edit-modal-direct');
if (existingModal) {
  existingModal.remove();
}

// Adicionar modal ao body
document.body.insertAdjacentHTML('beforeend', modalHtml);

// OTIMIZAÇÕES: Máscaras, Validações e API de CEP
setTimeout(() => {

  const modal = document.getElementById('edit-modal-direct');
  if (!modal) {
    return;
  }

  const allInputs = modal.querySelectorAll('input');


  // Função para aplicar máscara CNPJ
  const applyMaskCNPJ = (input: any) => {
    // Aplicar máscara no valor atual se existir
    if (input.value && input.value.replace(/\\D/g, '').length >= 11) {
      const cleanValue = input.value.replace(/\\D/g, '');
      let value = cleanValue;
      value = value.replace(/(\\d{2})(\\d)/, '$1.$2');
      value = value.replace(/(\\d{3})(\\d)/, '$1.$2');
      value = value.replace(/(\\d{3})(\\d)/, '$1/$2');
      value = value.replace(/(\\d{4})(\\d)/, '$1-$2');
      input.value = value.substring(0, 18);
    }

    // SEMPRE adicionar event listeners (mesmo se campo vazio)
    input.addEventListener('input', (e: any) => {
      let value = e.target.value.replace(/\\D/g, '');
      value = value.replace(/(\\d{2})(\\d)/, '$1.$2');
      value = value.replace(/(\\d{3})(\\d)/, '$1.$2');
      value = value.replace(/(\\d{3})(\\d)/, '$1/$2');
      value = value.replace(/(\\d{4})(\\d)/, '$1-$2');
      e.target.value = value.substring(0, 18);
    });

    input.addEventListener('blur', (e: any) => {
      const cnpj = e.target.value.replace(/\\D/g, '');
      if (cnpj.length === 14) {
        let sum = 0;
        let weight = 5;
        for (let i = 0; i < 12; i++) {
          sum += parseInt(cnpj.charAt(i)) * weight;
          weight = weight === 2 ? 9 : weight - 1;
        }
        let digit1 = sum % 11 < 2 ? 0 : 11 - (sum % 11);

        sum = 0;
        weight = 6;
        for (let i = 0; i < 13; i++) {
          sum += parseInt(cnpj.charAt(i)) * weight;
          weight = weight === 2 ? 9 : weight - 1;
        }
        let digit2 = sum % 11 < 2 ? 0 : 11 - (sum % 11);

        const isValid = digit1 === parseInt(cnpj.charAt(12)) && digit2 === parseInt(cnpj.charAt(13));
        e.target.style.borderColor = isValid ? '#d1d5db' : '#ef4444';
      }
    });

  };

  // Função para aplicar máscara CEP
  const applyMaskCEP = (input: any) => {
    // Aplicar máscara no valor atual se existir
    if (input.value && input.value.replace(/\\D/g, '').length === 8) {
      const cleanValue = input.value.replace(/\\D/g, '');
      let value = cleanValue;
      value = value.replace(/(\\d{5})(\\d)/, '$1-$2');
      input.value = value;
    }

    // SEMPRE adicionar event listeners (mesmo se campo vazio)
    input.addEventListener('input', (e: any) => {
      let value = e.target.value.replace(/\\D/g, '');
      value = value.replace(/(\\d{5})(\\d)/, '$1-$2');
      e.target.value = value.substring(0, 9);
    });

    input.addEventListener('blur', async (e: any) => {
      const cep = e.target.value.replace(/\\D/g, '');
      if (cep.length === 8) {
        try {
          const response = await fetch('https://viacep.com.br/ws/' + cep + '/json/');
          const data = await response.json();

          if (!data.erro) {

            // Buscar e preencher todos os campos relacionados
            const allModalInputs = modal.querySelectorAll('input, select');
            allModalInputs.forEach((inp: any) => {
              const inputLabel = inp.previousElementSibling?.textContent || '';
              const inputContainerLabel = inp.closest('div')?.querySelector('label')?.textContent || '';
              const inputPlaceholder = inp.placeholder || '';

              // Preencher logradouro/endereço
              if ((inputLabel.toLowerCase().includes('logradouro') || 
                   inputContainerLabel.toLowerCase().includes('logradouro') ||
                   inputPlaceholder.toLowerCase().includes('logradouro') ||
                   inputLabel.toLowerCase().includes('endereço') ||
                   inputContainerLabel.toLowerCase().includes('endereço')) && data.logradouro) {
                inp.value = data.logradouro;
              }

              // Preencher bairro
              if ((inputLabel.toLowerCase().includes('bairro') || 
                   inputContainerLabel.toLowerCase().includes('bairro') ||
                   inputPlaceholder.toLowerCase().includes('bairro')) && data.bairro) {
                inp.value = data.bairro;
              }

              // Preencher cidade
              if (inputLabel.toLowerCase().includes('cidade') || 
                  inputContainerLabel.toLowerCase().includes('cidade') ||
                  inputPlaceholder.toLowerCase().includes('cidade')) {
                inp.value = data.localidade;
              }

              // Preencher estado (select)
              if (inp.tagName === 'SELECT' && (inputLabel.toLowerCase().includes('estado') ||
                  inputContainerLabel.toLowerCase().includes('estado'))) {
                inp.value = data.uf;
              }
            });

          }
        } catch {
          /* ViaCEP indisponível ou resposta inválida — mantém campos manuais */
        }
      }
    });

  };

  // Função para aplicar máscara telefone
  const applyMaskPhone = (input: any) => {
    // Aplicar máscara no valor atual se existir
    if (input.value && input.value.replace(/\\D/g, '').length >= 10) {
      const cleanValue = input.value.replace(/\\D/g, '');
      let value = cleanValue;
      value = value.replace(/(\\d{2})(\\d)/, '($1) $2');
      value = value.replace(/(\\d{4})(\\d)/, '$1-$2');
      input.value = value.substring(0, 15);
    }

    // SEMPRE adicionar event listeners (mesmo se campo vazio)
    input.addEventListener('input', (e: any) => {
      let value = e.target.value.replace(/\\D/g, '');
      value = value.replace(/(\\d{2})(\\d)/, '($1) $2');
      value = value.replace(/(\\d{4})(\\d)/, '$1-$2');
      e.target.value = value.substring(0, 15);
    });

  };

  // Aplicar máscaras por múltiplas estratégias
  allInputs.forEach((input: any, index: number) => {
    const prevLabel = input.previousElementSibling?.textContent || '';
    const container = input.closest('div');
    const containerLabel = container?.querySelector('label')?.textContent || '';
    const placeholder = input.placeholder || '';
    const value = input.value || '';

    // Detectar e aplicar CNPJ
    if (prevLabel.includes('CNPJ') || 
        containerLabel.includes('CNPJ') ||
        placeholder.toLowerCase().includes('cnpj') ||
        (value.replace(/\\D/g, '').length >= 11 && value.replace(/\\D/g, '').length <= 14)) {
      applyMaskCNPJ(input);
    }

    // Detectar e aplicar CEP
    if (prevLabel.includes('CEP') || 
        containerLabel.includes('CEP') ||
        placeholder.toLowerCase().includes('cep') ||
        (value.replace(/\\D/g, '').length === 8)) {
      applyMaskCEP(input);
    }

    // Detectar e aplicar telefone
    if (prevLabel.toLowerCase().includes('telefone') || 
        containerLabel.toLowerCase().includes('telefone') ||
        placeholder.toLowerCase().includes('telefone') ||
        prevLabel.toLowerCase().includes('whatsapp') ||
        containerLabel.toLowerCase().includes('whatsapp') ||
        (value.replace(/\\D/g, '').length >= 10 && value.replace(/\\D/g, '').length <= 11)) {
      applyMaskPhone(input);
    }
  });

}, 1000);

// Adicionar funcionalidade das abas após inserir o modal
const showTab = (tabName: string) => {
  // Esconder todas as abas
  const tabs = ['dados-principais', 'endereco', 'contatos', 'dominios'];
  tabs.forEach(tab => {
    const content = document.getElementById(`content-${tab}`);
    const button = document.getElementById(`tab-${tab}`);
    if (content) content.style.display = 'none';
    if (button) {
      button.style.backgroundColor = 'transparent';
      button.style.color = '#64748b';
    }
  });

  // Mostrar aba selecionada
  const selectedContent = document.getElementById(`content-${tabName}`);
  const selectedButton = document.getElementById(`tab-${tabName}`);
  if (selectedContent) selectedContent.style.display = 'block';
  if (selectedButton) {
    selectedButton.style.backgroundColor = 'white';
    selectedButton.style.color = '#1e293b';
  }
};

// Adicionar event listeners aos botões das abas
document.getElementById('tab-dados-principais')?.addEventListener('click', () => showTab('dados-principais'));
document.getElementById('tab-endereco')?.addEventListener('click', () => showTab('endereco'));
document.getElementById('tab-contatos')?.addEventListener('click', () => showTab('contatos'));
document.getElementById('tab-dominios')?.addEventListener('click', () => showTab('dominios'));
}
