# 🚀 Lovoo CRM - Analytics Comportamental para Landing Pages

**Versão**: 1.0.0 | **Status**: ✅ Produção | **URL**: https://app.lovoocrm.com/

Plataforma SaaS multi-tenant completa para coletar, analisar e enviar dados comportamentais detalhados de visitantes em landing pages.

## 🎯 Características Principais

- **Multi-Tenant**: Múltiplas empresas com dados completamente isolados
- **Tracking Comportamental**: Coleta de cliques, scroll, tempo de permanência, interações com formulários
- **Heatmaps Visuais**: Visualização gráfica de onde os usuários clicam
- **Analytics em Tempo Real**: Atualizações ao vivo via WebSocket
- **Sistema de Webhooks**: Envio automático de conversões com dados comportamentais
- **Dashboard Completo**: Visualização de métricas e relatórios
- **Exportação de Dados**: Relatórios em CSV

## 🏗️ Arquitetura

### Frontend
- **React 18** com TypeScript
- **TailwindCSS** para estilização
- **React Router** para navegação
- **Supabase Client** para autenticação e dados

### Backend
- **Supabase Database** (PostgreSQL)
- **Supabase Edge Functions** para API de tracking
- **Row Level Security** para segurança multi-tenant
- **Real-time Subscriptions** para updates ao vivo

### Tracking
- **JavaScript Vanilla** (sem dependências)
- Coleta automática de eventos
- Sistema de heartbeat
- Buffer de eventos offline

## 📦 Instalação

### 1. Clone o repositório
```bash
git clone <seu-repositorio>
cd m4-track
```

### 2. Instale as dependências
```bash
npm install
```

### 3. Configure as variáveis de ambiente
Certifique-se de que o arquivo `.env` contém:
```env
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

### 4. Execute o projeto
```bash
npm run dev
```

## 🗄️ Estrutura do Banco de Dados

### Tabelas Principais

#### companies
Armazena informações das empresas/tenants
- `id`, `name`, `domain`, `api_key`, `webhook_url`, `plan`, `status`

#### landing_pages
Landing pages cadastradas para tracking
- `id`, `company_id`, `name`, `url`, `tracking_code`, `status`

#### visitors
Sessões de visitantes
- `id`, `landing_page_id`, `session_id`, `device_type`, `screen_resolution`

#### behavior_events
Eventos comportamentais (cliques, scroll, etc)
- `id`, `visitor_id`, `event_type`, `event_data`, `coordinates`

#### conversions
Conversões com dados comportamentais agregados
- `id`, `visitor_id`, `form_data`, `behavior_summary`, `engagement_score`

#### webhook_logs
Logs de webhooks enviados
- `id`, `company_id`, `conversion_id`, `payload`, `response_status`

## 🔧 Como Usar

### 1. Criar uma Conta

Acesse a aplicação e crie uma conta informando:
- Email
- Senha
- Nome da Empresa

### 2. Criar uma Landing Page

No menu "Landing Pages":
1. Clique em "Nova Landing Page"
2. Informe o nome e URL
3. Copie o código de tracking gerado

### 3. Instalar o Código de Tracking

Cole o código antes do fechamento da tag `</body>` na sua landing page:

```html
<!-- Lovoo CRM Analytics -->
<script src="https://seu-dominio.com/m4track.js"></script>
<script>
  LovooCRM.init('SEU-TRACKING-CODE', 'https://seu-dominio.com');
</script>
```

### 4. Rastrear Conversões

Quando um visitante converter (enviar formulário), chame:

```javascript
LovooCRM.trackConversion({
  name: 'João Silva',
  email: 'joao@email.com',
  phone: '11999999999'
});
```

## 📊 API de Tracking

### Endpoints

#### POST /tracking-api/visitor
Cria uma nova sessão de visitante

**Request:**
```json
{
  "tracking_code": "uuid",
  "session_id": "uuid",
  "user_agent": "string",
  "device_type": "desktop|mobile|tablet",
  "screen_resolution": "1920x1080",
  "referrer": "https://google.com"
}
```

**Response:**
```json
{
  "visitor_id": "uuid"
}
```

#### POST /tracking-api/event
Registra um evento comportamental

**Request:**
```json
{
  "visitor_id": "uuid",
  "event_type": "click|scroll|hover|form_interaction",
  "event_data": {},
  "coordinates": { "x": 100, "y": 200 },
  "element_selector": "#button-cta"
}
```

#### POST /tracking-api/convert
Registra uma conversão e envia webhook

**Request:**
```json
{
  "visitor_id": "uuid",
  "tracking_code": "uuid",
  "form_data": {
    "name": "João Silva",
    "email": "joao@email.com"
  },
  "behavior_summary": {
    "session_duration": 245,
    "scroll_depth": "85%",
    "total_clicks": 7,
    "engagement_score": 8.5
  }
}
```

## 🔗 Webhooks

### Configuração

1. Acesse "Configurações"
2. Informe a URL do seu webhook
3. Salve

### Payload Enviado

Quando há uma conversão, enviamos:

```json
{
  "conversion_data": {
    "name": "João Silva",
    "email": "joao@email.com",
    "phone": "11999999999"
  },
  "behavior_analytics": {
    "session_duration": 245,
    "scroll_depth": "85%",
    "sections_viewed": ["hero", "about", "services"],
    "total_clicks": 7,
    "cta_clicks": 3,
    "engagement_score": 8.5,
    "device_type": "desktop",
    "time_to_convert": 180
  }
}
```

### Verificando Logs

Acesse "Configurações" > "Logs de Webhook" para ver:
- Data/hora de envio
- URL de destino
- Status HTTP da resposta
- Mensagens de erro (se houver)

## 📈 Métricas Coletadas

### Engagement Score (0-10)
Calculado com base em:
- Tempo de permanência (até 3 pontos)
- Profundidade de scroll (até 3 pontos)
- Número de cliques (até 2 pontos)
- Cliques em CTAs (até 2 pontos)
- Seções visualizadas (até 2 pontos)

### Dados Comportamentais
- **Session Duration**: Tempo total na página
- **Scroll Depth**: Porcentagem da página scrollada
- **Sections Viewed**: Seções visualizadas
- **Total Clicks**: Total de cliques
- **CTA Clicks**: Cliques em botões de ação
- **Time to Convert**: Tempo até conversão
- **Device Type**: Tipo de dispositivo

## 🎨 Interface

### Dashboard
Visão geral com:
- Total de landing pages
- Total de visitantes
- Conversões e taxa de conversão
- Engagement médio
- Visitantes ativos em tempo real

### Landing Pages
- Lista de todas as páginas
- Status (ativo/pausado)
- Código de tracking
- Acesso rápido ao analytics

### Analytics
- Métricas detalhadas por página
- Heatmap de cliques
- Lista de conversões
- Breakdown por dispositivo
- Exportação de relatórios

### Configurações
- API Key da empresa
- Configuração de webhook
- Logs de webhooks enviados

## 🔒 Segurança

### Row Level Security (RLS)
Todas as tabelas possuem RLS habilitado:
- Empresas só acessam seus próprios dados
- Policies baseadas em `auth.uid()`
- Isolamento completo entre tenants

### API Keys
- UUID único por empresa
- Usada para validar requests de tracking
- Gerada automaticamente no registro

### Webhooks
- Logs completos de envio
- Retry automático em caso de falha
- Validação de URL

## 🚀 Deploy

### Frontend (Vite)
```bash
npm run build
```
Deploy da pasta `dist/` para qualquer host estático (Vercel, Netlify, etc)

### Edge Functions
As Edge Functions já estão deployadas no Supabase automaticamente.

### Domínio Personalizado
Atualize a URL nos códigos de tracking para seu domínio:
```javascript
LovooCRM.init('TRACKING-CODE', 'https://seu-dominio.com');
```

## 📝 Exemplo de Integração

```html
<!DOCTYPE html>
<html>
<head>
  <title>Minha Landing Page</title>
</head>
<body>
  <section id="hero" data-section="hero">
    <h1>Bem-vindo!</h1>
    <button id="cta-principal">Comece Agora</button>
  </section>

  <section id="about" data-section="about">
    <h2>Sobre Nós</h2>
  </section>

  <section id="contact" data-section="contact">
    <form id="contact-form">
      <input name="name" placeholder="Nome" required>
      <input name="email" type="email" placeholder="Email" required>
      <button type="submit">Enviar</button>
    </form>
  </section>

  <!-- Lovoo CRM Analytics -->
  <script src="https://seu-dominio.com/m4track.js"></script>
  <script>
    LovooCRM.init('SEU-TRACKING-CODE', 'https://seu-dominio.com');

    document.getElementById('contact-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);

      LovooCRM.trackConversion({
        name: formData.get('name'),
        email: formData.get('email')
      });

      // Envie o form normalmente aqui
    });
  </script>
</body>
</html>
```

## 🛠️ Tecnologias Utilizadas

- React 18
- TypeScript
- TailwindCSS
- React Router
- Supabase (PostgreSQL + Edge Functions)
- Lucide React (ícones)
- Vite

## 📄 Licença

MIT

## 🤝 Suporte

Para dúvidas e suporte, entre em contato através do email da empresa cadastrada.

---

Desenvolvido com ❤️ para otimizar suas conversões através de dados comportamentais
