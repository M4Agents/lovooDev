# BASE DE CONHECIMENTO - SUPORTE LOVOCRM
## Guia Completo para Suporte ao Usuário

**Versão:** 2.2.0 - Sistema Completo com Importação de Tags e Campos de Empresa  
**Data:** Março 2026  
**Última Atualização:** 30/03/2026 - 11:16 - IMPORTAÇÃO DE TAGS E CAMPOS DE EMPRESA IMPLEMENTADOS  

---

## 📋 ÍNDICE

1. [Visão Geral da Plataforma](#visao-geral)
2. [Primeiros Passos](#primeiros-passos)
3. [Dashboard Principal](#dashboard)
4. [Sistema de Analytics](#analytics)
5. [Gestão de Leads](#leads)
6. [Sistema de Duplicatas](#duplicatas)
7. [Landing Pages](#landing-pages)
8. [Webhook Ultra-Simples](#webhook)
9. [WhatsApp Integration](#whatsapp-integration)
10. [Configurações](#configuracoes)
11. [Problemas Comuns](#problemas-comuns)
12. [Perguntas Frequentes](#faq)

---

## 🎯 VISÃO GERAL DA PLATAFORMA {#visao-geral}

### O que é o LovoCRM?
O LovoCRM é uma plataforma SaaS completa que combina:
- **Analytics Comportamental**: Acompanhe visitantes em suas landing pages
- **CRM Inteligente**: Gerencie leads de forma automatizada
- **Sistema de Duplicatas**: Detecta e mescla leads duplicados automaticamente
- **Webhook Ultra-Simples**: Capture leads de qualquer formulário
- **Sistema Híbrido**: Conecta automaticamente dados comportamentais aos leads
- **Campos Personalizados**: Sistema inteligente que se adapta aos seus dados
- **Score Comportamental**: Leads recebem pontuação automática baseada no comportamento
- **WhatsApp Integration**: Conecte instâncias WhatsApp Business e gerencie conversas

### Principais Benefícios
- ✅ **Captura Automática**: Leads chegam automaticamente no sistema
- ✅ **Analytics em Tempo Real**: Veja quem visita suas páginas
- ✅ **Flexibilidade Total**: Funciona com qualquer formulário (HTML, React, Vue, Angular)
- ✅ **Sem Configuração Complexa**: Sistema ultra-simples de usar
- ✅ **Score Automático**: Leads recebem pontuação comportamental automaticamente
- ✅ **Dados Enriquecidos**: Informações de navegação conectadas aos leads

### Acesso à Plataforma
- **URL**: https://app.lovoocrm.com
- **Login**: Email e senha cadastrados
- **Suporte**: Via chat ou email

---

## 🚀 PRIMEIROS PASSOS {#primeiros-passos}

### 1. Primeiro Acesso
1. **Acesse**: https://app.lovoocrm.com
2. **Faça login** com suas credenciais
3. **Explore o dashboard** principal
4. **Configure sua primeira landing page**

### 2. Configuração Inicial
#### Dados da Empresa
1. Vá em **Configurações** → **Dados da Empresa**
2. Preencha as informações básicas
3. **Salve** as alterações

#### Primeira Landing Page
1. Acesse **Landing Pages**
2. Clique em **Nova Landing Page**
3. Preencha nome e URL
4. **Copie o código de tracking**
5. **Instale na sua página**

### 3. Primeiro Lead
#### Via Webhook Ultra-Simples
1. Vá em **Configurações** → **Integrações**
2. **Copie sua API Key** (clique no olho para revelar)
3. **Configure seu formulário** para enviar para a URL mostrada
4. **Teste** usando o botão de teste

---

## 📊 DASHBOARD PRINCIPAL {#dashboard}

### Visão Geral
O dashboard mostra um resumo completo da sua operação:

#### Métricas Principais
- **Total de Leads**: Leads capturados no período
- **Visitantes**: Pessoas que visitaram suas páginas
- **Taxa de Conversão**: Percentual de visitantes que viraram leads
- **Leads Hoje**: Novos leads do dia atual

#### Gráficos Disponíveis
- **Visitantes por Dia**: Evolução temporal
- **Leads por Origem**: De onde vêm seus leads
- **Dispositivos**: Mobile, tablet, desktop

### Como Interpretar os Dados
- **Picos de visitantes**: Indicam campanhas ou conteúdo viral
- **Taxa de conversão baixa**: Pode indicar problema no formulário
- **Muitos visitantes mobile**: Otimize para dispositivos móveis

---

## 📈 SISTEMA DE ANALYTICS {#analytics}

### Analytics Básico
**Localização**: Menu → Analytics → Selecionar Landing Page

#### Funcionalidades
- **Total de Visitantes**: Contador geral
- **Gráfico Temporal**: Visitantes por período
- **Breakdown por Dispositivo**: Mobile, tablet, desktop
- **Tabela de Visitantes**: Lista dos visitantes recentes

#### Como Usar
1. **Selecione a landing page** que deseja analisar
2. **Escolha o período** (hoje, ontem, 7 dias, etc.)
3. **Analise os gráficos** para identificar padrões
4. **Verifique a tabela** para detalhes dos visitantes

### Analytics Pro
**Localização**: Menu → Analytics Pro → Selecionar Landing Page

#### Funcionalidades Avançadas
- **Métricas Profissionais**: Visitantes únicos, recorrentes
- **Filtros de Data**: Períodos personalizados
- **Segmentação Avançada**: Por origem do tráfego
- **Tabela de Remarketing**: Visitantes identificados
- **Exportação CSV**: Para análises externas

#### Métricas Explicadas
- **Visitantes Únicos**: Pessoas diferentes (não sessões)
- **Taxa de Retorno**: Quantos visitaram mais de uma vez
- **Duração Média**: Tempo médio na página
- **Taxa de Rejeição**: Visitantes que saíram rapidamente

### Instalação do Código de Tracking
#### Código Padrão
```html
<script src="https://app.lovoocrm.com/m4track-v5.js?v=TIMESTAMP"></script>
<script>
  LovoCRM.init('SEU_TRACKING_CODE', 'https://app.lovoocrm.com');
</script>
```

#### Onde Instalar
- **Antes do `</body>`**: Para melhor performance
- **Em todas as páginas**: Que você quer trackear
- **Uma vez por página**: Não duplicar o código

#### Verificação da Instalação
1. Acesse a landing page no sistema
2. Clique em **"Verificar Tag"**
3. O sistema mostrará se está instalado corretamente

---

## 👥 GESTÃO DE LEADS {#leads}

### Lista de Leads
**Localização**: Menu → Leads

#### Informações Exibidas
- **Nome e Email**: Dados principais do lead
- **Telefone**: Se fornecido
- **Empresa**: Nome da empresa do lead
- **Origem**: Como o lead chegou (webhook, formulário, etc.)
- **Status**: Novo, em andamento, convertido, etc.
- **Data**: Quando foi capturado

#### Filtros Disponíveis V2.0 ✨ NOVO!

##### Filtros Básicos (sempre visíveis)
- **Busca Geral**: Por nome, email ou telefone
- **Por Status**: Novo, em qualificação, convertido, perdido
- **Por Origem**: Landing page, WhatsApp, manual, importação, API

##### Filtros Avançados 🔍 (clique em "Filtros Avançados")
- **Nome Específico**: Busca exata por nome do lead
- **Telefone Específico**: Busca por número de telefone
- **Email Específico**: Busca por endereço de email
- **Por Período**: 
  - Hoje
  - Ontem
  - Últimos 7 dias
  - Últimos 30 dias
  - Período personalizado (escolha as datas)

##### Como Usar os Filtros
1. **Filtros Simples**: Use a busca geral e dropdowns de status/origem
2. **Filtros Avançados**: Clique no botão azul "🔍 Filtros Avançados"
3. **Combine Filtros**: Use vários filtros juntos para busca precisa
4. **Limpar Filtros**: Clique em "Limpar Filtros" para resetar tudo

### Detalhes do Lead
Clique em qualquer lead para ver:

#### Dados Básicos
- **Informações pessoais**: Nome, email, telefone
- **Dados da empresa**: Nome, CNPJ, endereço
- **Origem**: Como chegou ao sistema

#### Campos Personalizados
- **Campos específicos**: Criados automaticamente
- **Valores únicos**: Informações específicas do seu negócio
- **Histórico**: Quando foram preenchidos

#### Ações Disponíveis
- **Editar dados**: Alterar informações
- **Alterar status**: Marcar progresso
- **Adicionar observações**: Notas internas
- **Exportar dados**: Para outros sistemas

### 📥 IMPORTAÇÃO DE LEADS V2.2 ✨ ATUALIZADO!

#### Formatos Suportados
- **CSV**: Arquivos de texto (.csv)
- **Excel**: Planilhas (.xlsx e .xls)
- **TXT**: Arquivos de texto simples
- **Google Sheets**: Via link compartilhado público

#### Como Importar
1. **Clique** em "Importar" na página de Leads
2. **Selecione** seu arquivo ou cole o link do Google Sheets
3. **Aguarde** o processamento automático
4. **Mapeie** campos personalizados (se houver campos não reconhecidos)
5. **Confira** a prévia com todos os dados
6. **Confirme** a importação
7. **Pronto!** Veja a mensagem de sucesso com quantidade importada

#### Mapeamento Inteligente
- **Campos padrão**: Nome, email, telefone são reconhecidos automaticamente
- **Campos da empresa**: company_name, company_cnpj, company_cidade, company_estado, etc.
- **Tags**: Coluna "tags" para categorizar leads automaticamente
- **Campos personalizados**: Sistema pergunta como mapear campos novos
- **Flexibilidade total**: Qualquer planilha funciona!

#### 🏷️ IMPORTAÇÃO DE TAGS (NOVO V2.2!)

##### Como Usar Tags na Importação
**Uma Tag:**
```csv
Nome,Email,Telefone,tags
João Silva,joao@email.com,5511999999999,VIP
```

**Múltiplas Tags:**
```csv
Nome,Email,Telefone,tags
Maria Santos,maria@email.com,5521988888888,"VIP,Quente,Prioridade"
```

**⚠️ IMPORTANTE:** Use **aspas duplas** `"` quando houver múltiplas tags separadas por vírgula.

##### Funcionalidades das Tags
- ✅ **Reconhecimento Automático**: Aceita "tag", "tags", "etiqueta" ou "etiquetas"
- ✅ **Singular ou Plural**: Tanto "tag" quanto "tags" funcionam
- ✅ **Case-Insensitive**: VIP = vip = Vip (sistema reconhece qualquer formatação)
- ✅ **Criação Automática**: Tags novas são criadas automaticamente com cor padrão azul
- ✅ **Reutilização**: Tags existentes são reutilizadas automaticamente
- ✅ **Múltiplas Tags**: Separe por vírgula: "VIP,Quente,Cliente"
- ✅ **Sem Tags**: Deixe campo vazio se não quiser tags

##### Exemplos de Uso de Tags
```csv
Nome,Email,Telefone,tags
João Silva,joao@email.com,5511999999999,VIP
Maria Santos,maria@email.com,5521988888888,"VIP,Quente"
Pedro Costa,pedro@email.com,5511987654321,"Prioridade,Ativo,Cliente"
Ana Oliveira,ana@email.com,5521987654321,
```

**Também funciona com "tag" (singular):**
```csv
Nome,Email,Telefone,tag
João Silva,joao@email.com,5511999999999,VIP
Maria Santos,maria@email.com,5521988888888,"VIP,Quente"
```

#### 🏢 CAMPOS DE EMPRESA (NOVO V2.2!)

##### Campos Disponíveis
- **company_name**: Nome da empresa
- **company_cnpj**: CNPJ da empresa
- **company_razao_social**: Razão social
- **company_nome_fantasia**: Nome fantasia
- **company_cep**: CEP
- **company_cidade**: Cidade
- **company_estado**: Estado (UF)
- **company_endereco**: Endereço completo
- **company_telefone**: Telefone da empresa
- **company_email**: Email corporativo
- **company_site**: Website da empresa

##### Exemplo Completo com Empresa e Tags
```csv
Nome,Email,Telefone,company_name,company_cnpj,company_cidade,company_estado,tags
João Silva,joao@email.com,5511999999999,Empresa ABC Ltda,12345678000190,São Paulo,SP,"VIP,Quente"
Maria Santos,maria@email.com,5521988888888,Tech Solutions,98765432000110,Rio de Janeiro,RJ,Cliente
Pedro Costa,pedro@email.com,5511987654321,Inovação LTDA,11223344000155,São Paulo,SP,"Prioridade,Ativo"
```

#### 📋 TEMPLATE CSV ATUALIZADO

**Baixe o Template:**
1. Clique em "Importar Leads"
2. Clique em "Baixar Template CSV"
3. Arquivo inclui exemplos de:
   - Campos padrão (nome, email, telefone)
   - Campos de empresa (company_name, company_cnpj, etc.)
   - Tags (uma e múltiplas)
   - Campos personalizados (1, 2, 3)

#### Dicas para Importação
- **Primeira linha**: Use como cabeçalho com nomes dos campos
- **Dados limpos**: Remova linhas vazias
- **Telefones**: Use formato 55XXXXXXXXXXX (com código do país 55)
- **Emails**: Devem estar no formato correto (nome@dominio.com)
- **Tags múltiplas**: Use aspas duplas e separe por vírgula
- **Campos vazios**: Deixe em branco se não tiver o dado
- **Separador CSV**: Sistema detecta automaticamente vírgula (`,`) ou ponto e vírgula (`;`)

#### 🎯 SEPARADOR CSV - DETECÇÃO AUTOMÁTICA (NOVO V2.2!)

**O sistema detecta automaticamente o separador do seu arquivo CSV!**

##### Formatos Aceitos:
- ✅ **Vírgula (`,`)**: Padrão internacional
- ✅ **Ponto e vírgula (`;`)**: Padrão do Excel brasileiro

##### Como Funciona:
- **Automático**: Sistema analisa a primeira linha e detecta o separador
- **Zero Configuração**: Você não precisa fazer nada
- **Excel Brasileiro**: Funciona direto com CSV exportado do Excel
- **Google Sheets**: Funciona com qualquer formato

##### Exemplos:
**CSV com vírgula (padrão internacional):**
```csv
Nome,Email,Telefone,tags
João Silva,joao@email.com,5511999999999,VIP
```

**CSV com ponto e vírgula (Excel brasileiro):**
```csv
Nome;Email;Telefone;tags
João Silva;joao@email.com;5511999999999;VIP
```

**Ambos funcionam perfeitamente!** 🎉

### 📤 EXPORTAÇÃO DE LEADS V2.0 ✨ NOVO!

#### Como Exportar
1. **Clique** no botão verde "Exportar" na página de Leads
2. **Escolha** o formato:
   - **CSV**: Para usar em outros sistemas
   - **Excel**: Para análise em planilhas
3. **Aguarde** o processamento
4. **Download** automático do arquivo
5. **Pronto!** Arquivo salvo com data/hora no nome

#### O que é Exportado
- **Todos os campos padrão**: Nome, email, telefone, status, origem, data
- **Todos os campos da empresa**: CNPJ, razão social, endereço completo
- **Todos os campos personalizados**: Criados especificamente para sua empresa
- **Dados completos**: Nada fica de fora!

#### Nome do Arquivo
- **Formato**: leads_04-11-2025_14h30.xlsx
- **Automático**: Data e hora brasileira
- **Organizado**: Fácil de encontrar depois

### Status dos Leads
- **Novo**: Recém capturado, precisa ser qualificado
- **Em Qualificação**: Sendo trabalhado pela equipe
- **Convertido**: Virou cliente
- **Perdido**: Não teve interesse

---

## 🎯 LANDING PAGES {#landing-pages}

### Gerenciamento
**Localização**: Menu → Landing Pages

#### Lista de Landing Pages
- **Nome**: Identificação interna
- **URL**: Endereço da página
- **Status**: Ativa ou inativa
- **Visitantes**: Total de visitantes
- **Código**: Tracking code único

#### Criando Nova Landing Page
1. Clique em **"Nova Landing Page"**
2. **Preencha o nome**: Para identificação interna
3. **Adicione a URL**: Endereço completo da página
4. **Salve**: Sistema gera código automaticamente
5. **Copie o código**: Para instalar na página

### Instalação do Tracking
#### Código Gerado
Cada landing page recebe um código único:
```html
<script src="https://app.lovoocrm.com/m4track-v5.js?v=1730642100"></script>
<script>
  LovoCRM.init('c5c81b46-03bb-40da-882a-350c8d9c1877', 'https://app.lovoocrm.com');
</script>
```

#### Onde Instalar
- **WordPress**: No tema, antes do `</body>`
- **HTML Puro**: Antes do fechamento do body
- **Outras Plataformas**: Na seção de scripts customizados

#### Verificação
- Use o botão **"Verificar Tag"** para confirmar instalação
- Acesse a página e veja se aparece nos analytics
- Teste em dispositivos diferentes

---

## 🔗 WEBHOOK ULTRA-SIMPLES {#webhook}

### Conceito
Sistema que permite capturar leads de **qualquer formulário** automaticamente, sem programação complexa.

### Como Funciona
1. **Você configura** seu formulário para enviar dados
2. **Sistema recebe** automaticamente
3. **Lead é criado** no CRM
4. **Campos personalizados** são criados automaticamente

### Configuração
**Localização**: Configurações → Integrações

#### Informações Necessárias
- **URL do Webhook**: `https://app.lovoocrm.com/api/webhook-lead`
- **Sua API Key**: Chave única da sua empresa
- **Método**: POST
- **Formato**: JSON

#### Exemplo de Configuração
```json
{
  "api_key": "sua-api-key-aqui",
  "nome": "João Silva",
  "email": "joao@email.com",
  "telefone": "(11) 99999-9999",
  "empresa": "Empresa do João",
  "interesse": "Quero saber mais sobre o produto"
}
```

### Campos Reconhecidos Automaticamente
#### Campos Padrão
- **Nome**: name, nome, full_name, cliente
- **Email**: email, e-mail, mail
- **Telefone**: phone, telefone, celular, whatsapp
- **Empresa**: company, empresa, company_name
- **Interesse**: interest, interesse, mensagem, message

#### Campos Personalizados - Sistema Híbrido
**NOVO: Sistema Híbrido de Campos**
- **Campos por ID**: Use o ID numérico do campo (ex: "1": "valor")
- **Precisão total**: Sem ambiguidade ou conflitos
- **Criação manual**: Crie campos na interface primeiro
- **Disponível para busca e filtros**

**Como usar:**
1. **Acesse** Configurações → Campos Personalizados
2. **Crie** o campo desejado (receberá um ID automático)
3. **Copie** o ID mostrado na interface
4. **Use** no payload: `"ID": "valor"`

### Exemplos de Uso
#### Sistema Híbrido - Formulário de Orçamento
```json
{
  "api_key": "sua-api-key",
  "nome": "Maria Santos",
  "email": "maria@empresa.com",
  "telefone": "11999999999",
  "1": "R$ 50.000",        // Campo: Orçamento (ID: 1)
  "2": "3 meses",          // Campo: Prazo (ID: 2)
  "3": "Desenvolvimento Web" // Campo: Tipo Serviço (ID: 3)
}
```

#### Formulário de Contato
```json
{
  "api_key": "sua-api-key",
  "nome": "Carlos Silva",
  "email": "carlos@gmail.com",
  "telefone": "(11) 98765-4321",
  "assunto": "Dúvida sobre produto",
  "mensagem": "Gostaria de mais informações"
}
```

### Teste do Webhook
1. **Acesse**: Configurações → Integrações
2. **Clique em**: "Testar Webhook"
3. **Sistema envia**: Dados de teste
4. **Verifica**: Se lead foi criado
5. **Mostra resultado**: Sucesso ou erro

---

## 📱 WHATSAPP INTEGRATION {#whatsapp-integration}

### Visão Geral
**Localização**: Menu → WhatsApp

O WhatsApp Integration permite conectar contas WhatsApp Business ao LovoCRM para gerenciar conversas, enviar mensagens e acompanhar leads.

### Funcionalidades Principais

#### ✅ Conectar Instâncias WhatsApp
**Como funciona:**
1. Acesse **WhatsApp** no menu lateral
2. Clique em **"Conectar WhatsApp"**
3. Sistema gera QR Code automaticamente
4. Escaneie com WhatsApp Business no celular
5. **Sistema configura webhook automaticamente** (V2.1.0)
6. Instância aparece como "Conectada"

**Tempo esperado:** 30 segundos a 3 minutos

**🆕 NOVIDADE V2.1.0:**
- **Webhook Automático**: Sistema configura automaticamente na UAZAPI
- **Zero Configuração Manual**: Tudo é feito automaticamente
- **URL Dinâmica**: Usa URL de produção do sistema

#### ✅ Gerenciar Instâncias
**Ações disponíveis:**
- **Visualizar**: Nome, telefone, status, data de conexão
- **Alterar Nome**: Renomear instância para organização
- **Excluir**: Remove instância do sistema e da UAZAPI (V2.1.0)

**🆕 NOVIDADE V2.1.0:**
- **Deleção Completa**: Remove da UAZAPI automaticamente
- **Sem Instâncias Órfãs**: Limpeza total do sistema

#### ✅ Sistema de Chat
**Localização**: Menu → Chat

**Funcionalidades:**
- **Interface 3 Colunas**: Conversas, mensagens, informações do lead
- **Filtros**: Todas, Atribuídas, Não Atribuídas
- **Envio de Mensagens**: Texto em tempo real
- **Agendamento**: Agendar mensagens por data/hora
- **Gestão de Leads**: Editar informações, status, valor do negócio
- **Atribuições**: Atribuir conversas a usuários específicos

### Problemas Comuns

#### QR Code não aparece
**Soluções:**
1. Aguardar 30 segundos
2. Atualizar página (F5)
3. Verificar conexão com internet

#### Instância desconectada
**Soluções:**
1. Verificar WhatsApp no celular
2. Reconectar com novo QR Code (webhook configurado automaticamente)
3. Excluir e criar nova instância se necessário

#### Chat não carrega
**Soluções:**
1. Verificar se há instâncias conectadas
2. Atualizar página (Ctrl+F5)
3. Verificar conexão com internet

### Perguntas Frequentes

**P: Preciso configurar webhook manualmente?**
R: Não! A partir da V2.1.0, o sistema configura automaticamente ao conectar a instância.

**P: O que acontece quando excluo uma instância?**
R: A partir da V2.1.0, o sistema remove a instância tanto do LovoCRM quanto da UAZAPI, desconectando o dispositivo automaticamente.

**P: Posso conectar múltiplas instâncias?**
R: Sim! Você pode conectar quantas instâncias WhatsApp Business precisar.

**P: Como funciona o agendamento de mensagens?**
R: No chat, acesse a aba "Agendar", preencha mensagem, data e hora. O sistema envia automaticamente no horário escolhido.

---

## ⚙️ CONFIGURAÇÕES {#configuracoes}

### Dados da Empresa
**Localização**: Configurações → Dados da Empresa

#### Informações Básicas
- **Nome da Empresa**: Razão social
- **Nome Fantasia**: Nome comercial
- **CNPJ**: Documento da empresa
- **Inscrições**: Estadual e municipal

#### Endereço
- **CEP**: Código postal
- **Cidade e Estado**: Localização
- **Endereço Completo**: Rua, número, complemento

#### Contatos
- **Telefone Principal**: Contato da empresa
- **Email Corporativo**: Email oficial
- **Website**: Site da empresa

### Integrações
**Localização**: Configurações → Integrações

#### Webhook Ultra-Simples
- **URL**: Endpoint para receber leads
- **API Key**: Chave de identificação (clique no olho para ver)
- **Instruções**: Como configurar formulários
- **Teste**: Botão para testar funcionamento

#### Como Usar a API Key
1. **Clique no ícone do olho** para revelar a chave
2. **Copie a chave completa**
3. **Use no campo "api_key"** dos seus formulários
4. **Mantenha segura**: Não compartilhe publicamente

### Usuários e Permissões
#### Tipos de Usuário
- **Administrador**: Acesso total ao sistema
- **Usuário**: Acesso limitado a leads e analytics
- **Visualizador**: Apenas consulta dados

#### Gerenciamento
- **Adicionar usuários**: Convites por email
- **Alterar permissões**: Conforme necessário
- **Remover acesso**: Quando necessário

---

## 🔧 PROBLEMAS COMUNS {#problemas-comuns}

### Analytics Não Mostra Dados
#### Possíveis Causas
- **Código não instalado**: Verificar se está na página
- **Código incorreto**: Conferir tracking code
- **Cache do navegador**: Limpar cache
- **Bloqueador de anúncios**: Pode estar bloqueando

#### Soluções
1. **Use "Verificar Tag"** na landing page
2. **Acesse a página** e aguarde alguns minutos
3. **Teste em navegador anônimo**
4. **Desative bloqueadores** temporariamente

### Webhook Não Recebe Leads
#### Possíveis Causas
- **API Key incorreta**: Verificar se está correta
- **URL errada**: Deve ser exatamente a fornecida
- **Formato JSON incorreto**: Verificar sintaxe
- **Método HTTP errado**: Deve ser POST

#### Soluções
1. **Teste o webhook** usando o botão de teste
2. **Verifique a API Key** (clique no olho)
3. **Confira o formato JSON** do exemplo
4. **Teste com dados simples** primeiro

### Leads Duplicados
#### Possíveis Causas
- **Múltiplos envios**: Usuário clicou várias vezes
- **Formulário mal configurado**: Enviando múltiplas vezes
- **Cache de formulário**: Dados antigos sendo reenviados

#### Soluções
1. **Configure debounce** no formulário (aguardar entre envios)
2. **Desabilite botão** após primeiro clique
3. **Implemente validação** no lado cliente

### Campos Personalizados Não Aparecem
#### Possíveis Causas
- **Nome do campo muito similar**: Sistema pode estar agrupando
- **Dados não enviados**: Campo vazio no formulário
- **Formato incorreto**: Caracteres especiais

#### Soluções
1. **Verifique os dados enviados** no teste
2. **Use nomes descritivos** para campos
3. **Evite caracteres especiais** nos nomes

---

## ❓ PERGUNTAS FREQUENTES {#faq}

### Sobre a Plataforma

**P: O LovoCRM funciona com qualquer tipo de formulário?**
R: Sim! O webhook ultra-simples funciona com qualquer formulário que possa enviar dados via POST em formato JSON.

**P: Preciso saber programação para usar?**
R: Não para usar a plataforma. Para configurar o webhook, pode precisar de ajuda técnica básica ou usar integrações prontas.

**P: Quantos leads posso capturar?**
R: Não há limite técnico. O limite depende do seu plano contratado.

**P: Os dados ficam seguros?**
R: Sim, usamos criptografia e seguimos boas práticas de segurança. Seus dados ficam isolados por empresa.

### Sobre Analytics

**P: Por que os números podem diferir de outras ferramentas?**
R: Cada ferramenta tem critérios diferentes. Nosso foco é em visitantes reais, filtrando bots e tráfego inválido.

**P: Posso ver dados históricos?**
R: Sim, todos os dados ficam armazenados. Você pode consultar qualquer período desde a instalação.

**P: O tracking funciona em sites HTTPS?**
R: Sim, nosso sistema é totalmente compatível com HTTPS e é a configuração recomendada.

### Sobre Webhook

**P: Posso usar o webhook em múltiplos formulários?**
R: Sim! Use a mesma API Key em quantos formulários quiser. Todos os leads chegam no mesmo lugar.

**P: E se meu formulário tiver campos diferentes?**
R: Perfeito! O sistema cria automaticamente campos personalizados para qualquer dado novo que receber.

**P: Posso testar antes de colocar em produção?**
R: Sim, use o botão "Testar Webhook" nas configurações para verificar se tudo está funcionando.

### Sobre Integração

**P: Funciona com WordPress?**
R: Sim! Tanto o tracking quanto o webhook funcionam perfeitamente com WordPress.

**P: E com outras plataformas (Wix, Squarespace, etc.)?**
R: Sim, funciona com qualquer plataforma que permita adicionar código JavaScript e configurar formulários.

**P: Posso integrar com meu CRM atual?**
R: O LovoCRM pode ser usado junto com outros sistemas. Você pode exportar dados ou usar nossa API para integrações.

### Sobre Suporte

**P: Como obter ajuda?**
R: Use o chat da plataforma, envie email para suporte ou consulte esta base de conhecimento.

**P: Vocês ajudam na configuração?**
R: Sim! Nossa equipe pode ajudar na configuração inicial e resolver dúvidas técnicas.

**P: Há treinamento disponível?**
R: Sim, oferecemos treinamento para equipes e materiais de apoio para uso da plataforma.

---

## 📞 CANAIS DE SUPORTE

### Suporte Técnico
- **Chat Online**: Disponível na plataforma
- **Email**: suporte@lovoocrm.com
- **Horário**: Segunda a sexta, 9h às 18h

### Recursos de Ajuda
- **Base de Conhecimento**: Este documento
- **Tutoriais em Vídeo**: Em desenvolvimento
- **Documentação API**: Para desenvolvedores

### Suporte Comercial
- **Vendas**: vendas@lovoocrm.com
- **Parcerias**: parcerias@lovoocrm.com
- **Feedback**: feedback@lovoocrm.com

---

## 📝 GLOSSÁRIO

**Analytics**: Sistema de análise de visitantes e comportamento em landing pages.

**API Key**: Chave única que identifica sua empresa no sistema de webhook.

**Campo Personalizado**: Campo criado automaticamente pelo sistema quando recebe dados não padrão.

**CRM**: Customer Relationship Management - sistema de gestão de relacionamento com clientes.

**Landing Page**: Página específica criada para conversão de visitantes em leads.

**Lead**: Pessoa que demonstrou interesse no seu produto/serviço fornecendo seus dados.

**Mapeamento Inteligente**: Sistema que identifica automaticamente o tipo de dados recebidos.

**Remarketing**: Estratégia de marketing para visitantes que já conhecem sua marca.

**Tracking Code**: Código único usado para identificar e rastrear uma landing page específica.

**Webhook**: Sistema que permite receber dados automaticamente de formulários externos.

**Visitor ID**: Identificador único que conecta o comportamento do visitante ao lead gerado.

---

## 🚀 SISTEMA HÍBRIDO - VERSÃO FINAL V1.4.0 ✅ 100% FUNCIONAL {#sistema-hibrido}

### O que é o Sistema Híbrido?
É uma funcionalidade revolucionária que conecta automaticamente os dados de comportamento dos visitantes aos leads capturados, com campos personalizados por ID, mantendo a simplicidade total do webhook.

### ✅ STATUS: SISTEMA 100% FUNCIONAL E APROVADO
- **Campos personalizados**: ✅ Funcionando via ID numérico
- **RLS resolvido**: ✅ Via RPC com SECURITY DEFINER  
- **Produção**: ✅ Testado e validado
- **Estabilidade**: ✅ Sistema íntegro mantido

### Como Funciona?
1. **Visitante navega** na landing page (dados comportamentais são coletados)
2. **Visitante preenche** formulário (qualquer tipo: HTML, React, etc.)
3. **Sistema conecta** automaticamente os dados comportamentais ao lead
4. **Lead recebe** pontuação baseada no comportamento
5. **Tudo automático** - zero configuração adicional!

### Benefícios para o Usuário
- ✅ **Zero Configuração**: Funciona automaticamente
- ✅ **Leads Mais Ricos**: Dados comportamentais incluídos
- ✅ **Score Automático**: Pontuação de 0 a 10 baseada no engajamento
- ✅ **Compatibilidade Total**: Funciona com qualquer tipo de formulário
- ✅ **Simplicidade Mantida**: Mesmo processo de sempre (copiar/colar webhook)

### O que o Cliente Vê?
#### Antes (V1.0):
- Nome, email, telefone, interesse
- Data de criação, origem

#### Agora (V1.1):
- **Todos os dados anteriores** +
- **Visitor ID**: Identificador único do visitante
- **Score Comportamental**: Pontuação de engajamento (quando disponível)
- **Dados de Navegação**: Tempo na página, dispositivo, origem (nos bastidores)

### Perguntas Frequentes - Sistema Híbrido

#### "Preciso alterar meu formulário?"
**Não!** O sistema funciona automaticamente com qualquer formulário existente.

#### "Funciona com React/Vue/Angular?"
**Sim!** O sistema é compatível com qualquer tecnologia de frontend.

#### "E se meu formulário não capturar o Visitor ID?"
O sistema tem múltiplos fallbacks e busca retroativa. Sempre funciona!

#### "O score sempre aparece?"
O score aparece quando há dados comportamentais disponíveis. Se o visitante for direto ao formulário, o lead é criado normalmente sem score.

#### "Isso afeta a velocidade do meu site?"
**Não!** O sistema é otimizado e não impacta a performance.

### Suporte Técnico

#### Se o Visitor ID não aparecer:
1. **Verifique** se o script de tracking está instalado na landing page
2. **Confirme** que o formulário está enviando para o webhook LovoCRM
3. **Teste** com um novo lead para validar

#### Se houver problemas:
- **Logs disponíveis**: Console do navegador mostra detalhes técnicos
- **Sistema robusto**: Nunca quebra o funcionamento normal
- **Suporte**: Entre em contato para análise detalhada

---

## 🔄 SISTEMA DE DUPLICATAS {#duplicatas}

### O que é o Sistema de Duplicatas?
O Sistema de Duplicatas é uma funcionalidade automática que identifica leads duplicados em sua base e permite mesclá-los de forma inteligente, mantendo sua base de dados limpa e organizada.

### Como Funciona?

#### 🔍 Detecção Automática
- **Critérios**: O sistema detecta duplicatas baseado em **telefone** e **email** idênticos
- **Tempo Real**: A detecção acontece automaticamente quando novos leads são adicionados
- **Histórico**: Também analisa leads já existentes na sua base
- **Por Empresa**: Cada empresa vê apenas suas próprias duplicatas

#### 📊 Visualização das Duplicatas
1. **Acesse** a página de Leads no menu lateral
2. **Observe** o alerta laranja no topo: "⚠️ Duplicatas Detectadas (X)"
3. **Clique** no alerta para ver a lista completa
4. **Visualize** as informações de cada duplicata:
   - Nome completo dos leads
   - Email e telefone
   - Campo que está duplicado (Telefone ou Email)
   - Data de criação

#### 🔧 Como Mesclar Duplicatas
1. **Clique** no botão "Mesclar" na duplicata desejada
2. **Escolha** uma das 3 estratégias:
   - **Manter Lead Existente**: Mantém o lead mais antigo e remove o novo
   - **Manter Lead Novo**: Mantém o lead mais recente e remove o antigo
   - **Combinar Informações** (Recomendado): Mescla os dados dos dois leads
3. **Confirme** a ação
4. **Pronto!** Os leads foram mesclados automaticamente

### Estratégias de Mesclagem

#### 🎯 Combinar Informações (Recomendado)
- **Nomes**: Usa o nome mais completo
- **Contatos**: Mantém email e telefone disponíveis
- **Dados da Empresa**: Combina informações mais completas
- **Campos Personalizados**: Preserva todos os valores preenchidos
- **Histórico**: Mantém registro da mesclagem

#### 📋 Manter Lead Existente
- **Uso**: Quando o lead antigo tem informações mais confiáveis
- **Resultado**: Lead novo é removido, antigo permanece inalterado
- **Histórico**: Registra que houve uma mesclagem

#### 🆕 Manter Lead Novo
- **Uso**: Quando o lead novo tem informações mais atualizadas
- **Resultado**: Lead antigo é removido, novo permanece
- **Dados**: Informações mais recentes são preservadas

### Benefícios do Sistema

#### ✅ Para Sua Gestão
- **Base Limpa**: Elimina leads duplicados automaticamente
- **Dados Completos**: Combina informações de múltiplas fontes
- **Decisão Informada**: Vê todos os dados antes de mesclar
- **Histórico Preservado**: Mantém registro de todas as mesclagens

#### ✅ Para Sua Equipe
- **Eficiência**: Não perde tempo com leads duplicados
- **Qualidade**: Trabalha sempre com dados mais completos
- **Confiança**: Sistema automático e confiável
- **Simplicidade**: Interface intuitiva e fácil de usar

### Perguntas Frequentes

#### "O sistema detecta duplicatas automaticamente?"
**Sim!** A detecção é 100% automática. Sempre que um novo lead é adicionado (via formulário, importação ou API), o sistema verifica se já existe um lead com o mesmo telefone ou email.

#### "Posso desfazer uma mesclagem?"
**Não é possível desfazer**, por isso recomendamos sempre revisar as informações antes de confirmar a mesclagem. O sistema mostra todos os dados para você tomar uma decisão informada.

#### "O que acontece com campos personalizados?"
**São preservados!** Na estratégia "Combinar Informações", todos os campos personalizados de ambos os leads são mantidos, priorizando valores preenchidos sobre campos vazios.

#### "Como sei se tenho duplicatas?"
**Alerta automático!** Quando há duplicatas pendentes, aparece um alerta laranja no topo da página de Leads com o número de duplicatas encontradas.

#### "Posso ignorar uma duplicata?"
**Sim!** Se você determinar que não são realmente duplicatas, pode clicar em "Ignorar" e elas não aparecerão mais na lista.

### 🆕 PERGUNTAS FREQUENTES - SISTEMA V2.2

#### Sobre Importação de Leads

**P: Que formatos posso importar?**
R: CSV, Excel (.xlsx e .xls), TXT e Google Sheets via link compartilhado público.

**P: E se minha planilha tiver campos diferentes?**
R: Perfeito! O sistema detecta campos novos e permite mapear para campos personalizados.

**P: Quantos leads posso importar de uma vez?**
R: Até 1.000 leads por importação para garantir boa performance.

**P: O que acontece se houver dados duplicados na importação?**
R: O sistema detecta e oferece opções de mesclagem automática.

#### Sobre Tags na Importação (NOVO V2.2!)

**P: Como adiciono tags na importação?**
R: Adicione uma coluna "tags" ou "tag" no seu arquivo. Para uma tag use: `VIP`. Para múltiplas use aspas duplas: `"VIP,Quente,Cliente"`.

**P: Posso usar "tag" (singular) ou precisa ser "tags" (plural)?**
R: Ambos funcionam! O sistema aceita "tag", "tags", "etiqueta" ou "etiquetas".

**P: As tags precisam existir antes da importação?**
R: Não! O sistema cria automaticamente tags novas com cor padrão azul. Se a tag já existir, ela será reutilizada.

**P: O sistema diferencia maiúsculas e minúsculas nas tags?**
R: Não! O sistema reconhece "VIP", "vip", "Vip" como a mesma tag. Se a tag já existir, mantém a formatação original.

**P: Posso importar leads sem tags?**
R: Sim! Deixe a coluna "tags" vazia ou não inclua a coluna. O lead será importado normalmente.

**P: Quantas tags posso adicionar por lead?**
R: Não há limite! Separe por vírgula: `"Tag1,Tag2,Tag3,Tag4"`.

**P: E se eu esquecer as aspas duplas nas múltiplas tags?**
R: O sistema pode interpretar incorretamente. Sempre use aspas duplas quando houver vírgulas: `"VIP,Quente"`.

#### Sobre Campos de Empresa (NOVO V2.2!)

**P: Quais campos de empresa posso importar?**
R: company_name, company_cnpj, company_razao_social, company_nome_fantasia, company_cep, company_cidade, company_estado, company_endereco, company_telefone, company_email, company_site.

**P: Preciso preencher todos os campos de empresa?**
R: Não! Preencha apenas os que você tiver. Campos vazios são aceitos normalmente.

**P: O formato do CNPJ importa?**
R: Não! Pode ser com ou sem pontuação: `12.345.678/0001-90` ou `12345678000190`.

**P: Como sei quais campos usar?**
R: Baixe o template CSV no modal de importação. Ele tem exemplos de todos os campos disponíveis.

#### Sobre Telefones na Importação

**P: Qual o formato correto de telefone?**
R: Use o formato internacional brasileiro: `55XXXXXXXXXXX` (55 + DDD + número). Exemplo: `5511999999999`.

**P: Posso usar telefone com formatação?**
R: Sim, mas recomendamos o formato limpo. O sistema aceita `(11) 99999-9999` mas o ideal é `5511999999999`.

**P: Preciso do código do país (+55)?**
R: Use apenas `55` sem o `+`. Exemplo: `5511999999999` (não `+5511999999999`).

#### Sobre Exportação de Leads

**P: Posso exportar apenas alguns leads?**
R: Sim! Use os filtros avançados para selecionar exatamente os leads que quer exportar.

**P: A exportação inclui campos personalizados?**
R: Sim! Todos os campos (padrão + empresa + personalizados) são incluídos.

**P: Qual formato é melhor, CSV ou Excel?**
R: Excel para análise em planilhas, CSV para integrar com outros sistemas.

#### Sobre Filtros Avançados

**P: Como uso os filtros por período?**
R: Clique em "Filtros Avançados", escolha o período no dropdown e clique "Aplicar Filtros".

**P: Posso combinar vários filtros?**
R: Sim! Use nome + período + status, por exemplo. Todos funcionam juntos.

**P: Como limpo todos os filtros de uma vez?**
R: Clique no botão "Limpar Filtros" no cabeçalho da seção de filtros.

### Dicas de Uso

#### 🎯 Melhores Práticas
- **Revise sempre** os dados antes de mesclar
- **Use "Combinar Informações"** na maioria dos casos
- **Verifique campos personalizados** importantes
- **Processe duplicatas regularmente** para manter a base limpa

#### ⚠️ Cuidados Importantes
- **Decisão irreversível**: Mesclagens não podem ser desfeitas
- **Dados sensíveis**: Revise informações importantes antes de mesclar
- **Campos únicos**: Verifique se não há conflitos em dados específicos

---

**📄 ARQUIVO**: `BASE_CONHECIMENTO_SUPORTE_LOVOCRM.md`  
**🎯 OBJETIVO**: Suporte completo ao usuário da plataforma LovoCRM  
**🔄 ATUALIZAÇÃO**: Sempre que houver novas funcionalidades ou mudanças na interface  

---

*Base de conhecimento gerada para suporte ao usuário - Última atualização: 03/03/2026 - 12:05 - WhatsApp Integration V2.1.0*
