# M4 Track - Documentação da API

## Visão Geral

A API do M4 Track é baseada em Supabase Edge Functions e permite rastrear o comportamento de visitantes em landing pages, registrar conversões e enviar dados via webhooks.

## Base URL

```
https://[seu-projeto].supabase.co/functions/v1/tracking-api
```

## Autenticação

A API não requer autenticação JWT para os endpoints de tracking (são públicos para permitir tracking de qualquer origem). A validação é feita através do `tracking_code`.

## Endpoints

### 1. Criar Visitante

Cria uma nova sessão de visitante quando alguém acessa a landing page.

**Endpoint:** `POST /tracking-api/visitor`

**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "tracking_code": "uuid-da-landing-page",
  "session_id": "uuid-gerado-no-cliente",
  "user_agent": "Mozilla/5.0...",
  "device_type": "desktop",
  "screen_resolution": "1920x1080",
  "referrer": "https://google.com"
}
```

**Response (200):**
```json
{
  "visitor_id": "uuid-do-visitante"
}
```

**Response (404):**
```json
{
  "error": "Invalid tracking code"
}
```

### 2. Registrar Evento

Registra um evento comportamental (clique, scroll, hover, etc).

**Endpoint:** `POST /tracking-api/event`

**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "visitor_id": "uuid",
  "event_type": "click",
  "event_data": {
    "tag": "BUTTON",
    "classes": "btn btn-primary",
    "text": "Comprar Agora",
    "is_cta": true
  },
  "coordinates": {
    "x": 450,
    "y": 320
  },
  "element_selector": "#btn-cta",
  "section": "hero"
}
```

**Tipos de Eventos:**
- `click` - Clique em elemento
- `scroll` - Evento de scroll
- `hover` - Mouse hover
- `form_interaction` - Interação com campo de formulário
- `page_view` - Visualização de página
- `section_view` - Visualização de seção

**Response (200):**
```json
{
  "success": true
}
```

### 3. Registrar Conversão

Registra uma conversão e dispara o webhook configurado.

**Endpoint:** `POST /tracking-api/convert`

**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "visitor_id": "uuid",
  "tracking_code": "uuid",
  "form_data": {
    "name": "João Silva",
    "email": "joao@email.com",
    "phone": "11999999999",
    "message": "Quero mais informações"
  },
  "behavior_summary": {
    "session_duration": 245,
    "scroll_depth": "85%",
    "sections_viewed": ["hero", "about", "services", "contact"],
    "total_clicks": 7,
    "cta_clicks": 3,
    "engagement_score": 8.5,
    "device_type": "desktop",
    "time_to_convert": 180
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "conversion_id": "uuid"
}
```

**Response (404):**
```json
{
  "error": "Visitor not found"
}
```

## Webhooks

Quando uma conversão é registrada, o sistema automaticamente envia os dados para a URL de webhook configurada pela empresa.

### Payload do Webhook

**URL:** Configurada em Settings > Webhook URL

**Method:** `POST`

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "conversion_data": {
    "name": "João Silva",
    "email": "joao@email.com",
    "phone": "11999999999",
    "message": "Quero mais informações"
  },
  "behavior_analytics": {
    "session_duration": 245,
    "scroll_depth": "85%",
    "sections_viewed": ["hero", "about", "services", "contact"],
    "total_clicks": 7,
    "cta_clicks": 3,
    "engagement_score": 8.5,
    "conversion_path": ["hero-cta", "services-section", "contact-form"],
    "device_type": "desktop",
    "time_to_convert": 180
  }
}
```

### Resposta do Webhook

Seu endpoint deve retornar:
- Status HTTP 200-299 para sucesso
- Qualquer outro status será registrado como erro

### Logs de Webhook

Todos os envios são registrados em `webhook_logs`:
- Data/hora de envio
- URL de destino
- Payload enviado
- Status HTTP da resposta
- Corpo da resposta ou mensagem de erro

## Códigos de Status HTTP

- `200 OK` - Requisição bem-sucedida
- `404 Not Found` - Recurso não encontrado (tracking code ou visitor inválido)
- `500 Internal Server Error` - Erro no servidor

## Rate Limiting

Não há rate limiting implementado atualmente, mas é recomendado:
- Não fazer mais de 100 requests/segundo por visitor
- Usar o sistema de heartbeat (30s) ao invés de polling constante

## Exemplos de Integração

### JavaScript Vanilla

```javascript
// Inicializar tracking
M4Track.init('SEU-TRACKING-CODE', 'https://seu-projeto.supabase.co');

// Tracking manual de evento customizado
fetch('https://seu-projeto.supabase.co/functions/v1/tracking-api/event', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    visitor_id: visitorId,
    event_type: 'click',
    event_data: { custom: 'data' }
  })
});

// Registrar conversão
M4Track.trackConversion({
  name: 'João Silva',
  email: 'joao@email.com',
  phone: '11999999999'
});
```

### React

```jsx
import { useEffect } from 'react';

function LandingPage() {
  useEffect(() => {
    // Inicializar M4Track
    if (window.M4Track) {
      window.M4Track.init('TRACKING-CODE', 'API-URL');
    }
  }, []);

  const handleSubmit = (formData) => {
    if (window.M4Track) {
      window.M4Track.trackConversion({
        name: formData.name,
        email: formData.email
      });
    }
  };

  return <div>...</div>;
}
```

### Node.js (Webhook Receiver)

```javascript
const express = require('express');
const app = express();

app.use(express.json());

app.post('/webhook/m4track', (req, res) => {
  const { conversion_data, behavior_analytics } = req.body;

  console.log('Nova conversão:', conversion_data);
  console.log('Analytics:', behavior_analytics);

  // Processar dados (salvar no CRM, enviar email, etc)
  // ...

  res.status(200).json({ success: true });
});

app.listen(3000);
```

## Estrutura de Dados

### Visitor
```typescript
{
  id: string;
  landing_page_id: string;
  session_id: string;
  ip_address?: string;
  user_agent?: string;
  device_type: 'desktop' | 'mobile' | 'tablet';
  screen_resolution?: string;
  referrer?: string;
  created_at: string;
}
```

### Behavior Event
```typescript
{
  id: string;
  visitor_id: string;
  event_type: 'click' | 'scroll' | 'hover' | 'form_interaction' | 'page_view' | 'section_view';
  event_data: Record<string, any>;
  coordinates?: { x: number; y: number };
  element_selector?: string;
  section?: string;
  timestamp: string;
}
```

### Conversion
```typescript
{
  id: string;
  visitor_id: string;
  landing_page_id: string;
  form_data: Record<string, any>;
  behavior_summary: {
    session_duration: number;
    scroll_depth: string;
    sections_viewed: string[];
    total_clicks: number;
    cta_clicks: number;
    engagement_score: number;
    device_type: string;
    time_to_convert: number;
  };
  engagement_score: number;
  time_to_convert: number;
  webhook_sent: boolean;
  webhook_response?: Record<string, any>;
  converted_at: string;
}
```

## Cálculo do Engagement Score

O Engagement Score é calculado de 0 a 10 com base em:

1. **Tempo de Permanência** (até 3 pontos)
   - 1 ponto a cada 30 segundos
   - Máximo: 3 pontos

2. **Profundidade de Scroll** (até 3 pontos)
   - 1 ponto a cada 10% scrollado
   - Máximo: 3 pontos

3. **Cliques Gerais** (até 2 pontos)
   - 0.5 pontos por clique
   - Máximo: 2 pontos

4. **Cliques em CTAs** (até 2 pontos)
   - 1 ponto por clique em CTA
   - Máximo: 2 pontos

5. **Seções Visualizadas** (até 2 pontos)
   - 0.5 pontos por seção
   - Máximo: 2 pontos

**Total:** 12 pontos possíveis, normalizado para 10.0

## Boas Práticas

1. **Sempre chame `M4Track.init()` antes de qualquer tracking**
2. **Use `M4Track.trackConversion()` apenas uma vez por visitante**
3. **Marque seções importantes com `data-section` ou `id`**
4. **Identifique CTAs com classes ou atributos adequados**
5. **Teste webhooks com ferramentas como RequestBin primeiro**
6. **Monitore logs de webhook para detectar problemas**
7. **Implemente retry logic no seu webhook receiver**

## Troubleshooting

### Webhook não está sendo enviado
- Verifique se a URL está configurada em Settings
- Confirme que a URL é acessível publicamente
- Verifique os logs em Settings > Webhook Logs

### Eventos não aparecem no dashboard
- Confirme que o tracking code está correto
- Verifique se a landing page está com status "active"
- Abra o console do navegador para ver erros

### Conversões não são registradas
- Certifique-se de chamar `M4Track.trackConversion()` após o form submit
- Verifique se o visitor_id foi criado corretamente
- Confirme que o tracking_code está válido

## Suporte

Para dúvidas sobre a API, consulte:
- README.md - Documentação geral
- Logs de webhook - Para debugging de integrações
- Console do navegador - Para erros de tracking

---

**Versão:** 1.0.0
**Última atualização:** 2025-10-31
