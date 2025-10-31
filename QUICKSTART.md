# Guia Rápido - M4 Track

Este guia vai te ajudar a começar em **menos de 5 minutos**!

## 🚀 Início Rápido

### Passo 1: Crie sua Conta (1 minuto)

1. Acesse a aplicação
2. Clique em "Registrar"
3. Preencha:
   - Nome da Empresa
   - Email
   - Senha
4. Clique em "Criar Conta"

✅ Pronto! Você já tem acesso ao dashboard.

### Passo 2: Crie sua Primeira Landing Page (2 minutos)

1. No menu lateral, clique em **"Landing Pages"**
2. Clique no botão **"Nova Landing Page"**
3. Preencha:
   - **Nome:** Ex: "Página de Captura - Curso"
   - **URL:** Ex: "https://meusite.com/curso"
4. Clique em **"Criar"**

✅ Sua landing page foi criada!

### Passo 3: Instale o Código de Tracking (2 minutos)

1. Na sua landing page recém-criada, clique em **"Código"**
2. Copie o código que aparece
3. Cole no HTML da sua landing page, **antes do `</body>`**

```html
<!-- Exemplo de onde colar -->
<body>
  <h1>Minha Landing Page</h1>
  ...

  <!-- M4 Track Analytics -->
  <script src="https://seu-dominio.com/m4track.js"></script>
  <script>
    M4Track.init('seu-tracking-code-aqui', 'https://seu-dominio.com');
  </script>
</body>
```

✅ Tracking instalado!

## 📊 Visualizando os Dados

### Dashboard Principal

Acesse **"Dashboard"** para ver:
- 📄 Total de Landing Pages
- 👥 Total de Visitantes
- 🎯 Conversões e Taxa
- ⚡ Engagement Médio
- 🔴 Visitantes Ativos em Tempo Real

### Analytics Detalhado

1. Vá em **"Landing Pages"**
2. Clique em **"Ver Analytics"** na landing page desejada
3. Você verá:
   - Métricas gerais
   - Breakdown por dispositivo
   - Conversões recentes
   - Heatmap de cliques (aba Heatmap)

## 🎯 Rastreando Conversões

Quando um visitante preencher seu formulário, adicione este código:

```javascript
// No submit do seu formulário
document.getElementById('seu-form').addEventListener('submit', (e) => {
  e.preventDefault();

  // Pegue os dados do formulário
  const formData = new FormData(e.target);

  // Envie para o M4 Track
  M4Track.trackConversion({
    name: formData.get('name'),
    email: formData.get('email'),
    phone: formData.get('phone')
  });

  // Continue seu fluxo normal
  // (enviar para backend, mostrar mensagem, etc)
});
```

✅ Agora você está rastreando conversões com dados comportamentais!

## 🔗 Configurando Webhooks (Opcional)

Para receber os dados automaticamente no seu sistema:

1. Acesse **"Configurações"**
2. Na seção **"Webhook"**, cole a URL do seu endpoint
3. Clique em **"Salvar Webhook"**

Você receberá este payload a cada conversão:

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
    "sections_viewed": ["hero", "about", "contact"],
    "total_clicks": 7,
    "cta_clicks": 3,
    "engagement_score": 8.5,
    "device_type": "desktop",
    "time_to_convert": 180
  }
}
```

## 📱 Testando Localmente

Quer testar antes de instalar em produção?

1. Abra o arquivo `/public/example-landing-page.html`
2. Substitua:
   - `SEU-TRACKING-CODE-AQUI` pelo código real
   - A URL da API pelo domínio correto
3. Abra no navegador
4. Interaja com a página
5. Verifique o dashboard!

## 💡 Dicas Importantes

### ✅ Para Melhor Tracking

1. **Marque suas seções:**
```html
<section id="hero" data-section="hero">...</section>
<section id="about" data-section="about">...</section>
```

2. **Identifique CTAs:**
```html
<button id="cta-principal">Comprar Agora</button>
<a href="#contato" data-cta="contact">Entre em Contato</a>
```

3. **Use IDs únicos:**
```html
<form id="contact-form">...</form>
```

### ❌ Evite Estes Erros

1. ❌ **Não instale o código duas vezes** na mesma página
2. ❌ **Não chame `trackConversion()` múltiplas vezes** para o mesmo visitante
3. ❌ **Não esqueça de substituir** o tracking code de exemplo pelo real

## 📈 Entendendo as Métricas

### Engagement Score (0-10)
Quanto mais alto, mais engajado o visitante:
- **8-10:** Muito engajado (lead quente!)
- **5-7:** Moderadamente engajado
- **0-4:** Baixo engajamento

### Scroll Depth
Porcentagem da página que foi scrollada:
- **85%+:** Leu praticamente tudo
- **50-84%:** Leu boa parte
- **0-49%:** Leu pouco

### Time to Convert
Tempo em segundos do primeiro acesso até a conversão:
- **Menor tempo:** Visitante já sabia o que queria
- **Maior tempo:** Visitante explorou mais a página

## 🎨 Próximos Passos

Agora que você configurou o básico:

1. ✅ **Adicione mais landing pages**
2. ✅ **Configure webhooks** para integrar com seu CRM
3. ✅ **Analise os heatmaps** para otimizar conversões
4. ✅ **Monitore o engagement** dos seus leads
5. ✅ **Exporte relatórios** para sua equipe

## 🆘 Precisa de Ajuda?

### Tracking não funciona?
1. Abra o **console do navegador** (F12)
2. Procure por erros relacionados ao M4Track
3. Verifique se o tracking code está correto

### Webhook não envia?
1. Vá em **Configurações > Logs de Webhook**
2. Veja o status e erro (se houver)
3. Teste sua URL com [webhook.site](https://webhook.site) primeiro

### Dúvidas sobre a API?
Consulte o arquivo **API_DOCS.md** para documentação completa.

## 📚 Documentação Completa

- **README.md** - Visão geral e features completas
- **API_DOCS.md** - Documentação técnica da API
- **DEPLOY.md** - Guia de deploy e configuração

---

## 🎉 Pronto para Começar!

Você agora sabe o suficiente para:
- ✅ Rastrear visitantes
- ✅ Coletar dados comportamentais
- ✅ Analisar conversões
- ✅ Otimizar suas landing pages

**Dica final:** Comece com uma landing page de teste, veja os dados chegando, e depois expanda para suas páginas de produção!

Bons insights! 🚀

---

**M4 Track** - Analytics Comportamental para Landing Pages
