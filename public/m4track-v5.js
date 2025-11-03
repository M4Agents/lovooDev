// LovoCRM Analytics V5.2 - Server-Side Approach
// Contorna CORS enviando dados via GET request

(function() {
  'use strict';
  
  console.log('LovoCRM Analytics V5.2 carregado - Restored Working Version (Cache Bust)');
  
  const M4Track = {
    config: {
      trackingCode: null,
      apiUrl: null,
      sessionId: null,
      isInitialized: false
    },
    
    init: function(trackingCode, apiUrl) {
      if (!trackingCode || !apiUrl) {
        console.error('M4Track: Tracking code and API URL are required');
        return;
      }
      
      this.config.trackingCode = trackingCode;
      this.config.apiUrl = apiUrl;
      this.config.sessionId = this.generateSessionId();
      this.config.isInitialized = true;
      
      console.log('M4Track: Initialized with tracking code:', trackingCode);
      
      // Start tracking immediately
      this.trackVisitor();
      this.setupEventListeners();
      this.setupFormInterception();
    },
    
    generateSessionId: function() {
      return this.generateUUID();
    },
    
    getOrCreateVisitorId: function() {
      try {
        let visitorId = localStorage.getItem('lovocrm_visitor_id');
        if (!visitorId) {
          visitorId = this.generateUUID();
          localStorage.setItem('lovocrm_visitor_id', visitorId);
          console.log('M4Track: New visitor ID created:', visitorId);
        } else {
          console.log('M4Track: Returning visitor ID:', visitorId);
        }
        return visitorId;
      } catch (error) {
        console.log('M4Track: localStorage not available, using session ID');
        return this.generateUUID();
      }
    },
    
    generateUUID: function() {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    },
    
    getDeviceType: function() {
      const userAgent = navigator.userAgent;
      if (/tablet|ipad|playbook|silk/i.test(userAgent)) {
        return 'tablet';
      }
      if (/mobile|iphone|ipod|android|blackberry|opera|mini|windows\sce|palm|smartphone|iemobile/i.test(userAgent)) {
        return 'mobile';
      }
      return 'desktop';
    },
    
    trackVisitor: function() {
      if (!this.config.isInitialized) return;
      
      const visitorData = {
        tracking_code: this.config.trackingCode,
        session_id: this.config.sessionId,
        visitor_id: this.getOrCreateVisitorId(),
        user_agent: navigator.userAgent,
        device_type: this.getDeviceType(),
        screen_resolution: `${screen.width}x${screen.height}`,
        referrer: document.referrer || 'direct',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: navigator.language
      };
      
      console.log('M4Track: Tracking visitor via webhook approach');
      this.sendDataViaWebhook('visitor', visitorData);
    },
    
    sendDataViaWebhook: function(type, data) {
      try {
        if (type === 'visitor') {
          console.log('M4Track: Sending webhook data:', data);
          
          // Try normal fetch first (can see errors)
          fetch(`${this.config.apiUrl}/api/webhook-visitor`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
          }).then(response => {
            if (response.ok) {
              console.log(`M4Track: Successfully sent ${type} data via webhook approach`);
              return response.json();
            } else {
              console.error(`M4Track: Webhook failed with status:`, response.status);
              throw new Error(`HTTP ${response.status}`);
            }
          }).then(result => {
            console.log('M4Track: Webhook response:', result);
          }).catch(error => {
            console.error(`M4Track: Webhook error:`, error);
            console.log('M4Track: Falling back to image request');
            // Fallback to image request
            this.sendDataViaImage(type, data);
          });
        } else {
          // For events, use image fallback
          this.sendDataViaImage(type, data);
        }
      } catch (error) {
        console.error('M4Track: Error in sendDataViaWebhook:', error);
        this.sendDataViaImage(type, data);
      }
    },
    
    sendDataViaImage: function(type, data) {
      try {
        // Build URL with parameters
        const params = new URLSearchParams();
        params.set('action', type);
        
        Object.keys(data).forEach(key => {
          if (data[key] !== null && data[key] !== undefined) {
            params.set(key, data[key].toString());
          }
        });
        
        // Use Image request (no CORS restrictions)
        const img = new Image();
        img.onload = () => {
          console.log(`M4Track: Successfully sent ${type} data via image fallback`);
        };
        img.onerror = () => {
          console.error(`M4Track: Error sending ${type} data via image`);
        };
        
        // Send to our collect endpoint
        const collectUrl = `${this.config.apiUrl}/api/collect?${params.toString()}`;
        img.src = collectUrl;
        
        console.log(`M4Track: Sending ${type} data via image to:`, collectUrl);
        
      } catch (error) {
        console.error('M4Track: Error in sendDataViaImage:', error);
      }
    },
    
    trackEvent: function(eventType, eventData = {}) {
      if (!this.config.isInitialized) return;
      
      const event = {
        tracking_code: this.config.trackingCode,
        session_id: this.config.sessionId,
        event_type: eventType,
        event_data: JSON.stringify(eventData),
        timestamp: Date.now()
      };
      
      console.log(`M4Track: Tracking event: ${eventType}`);
      this.sendDataViaImage('event', event);
    },
    
    setupEventListeners: function() {
      // Track page view
      this.trackEvent('page_view', {
        url: window.location.href,
        title: document.title
      });
      
      // Track clicks
      document.addEventListener('click', (e) => {
        this.trackEvent('click', {
          element: e.target.tagName,
          x: e.clientX,
          y: e.clientY
        });
      });
      
      // Track scroll
      let scrollTimeout;
      window.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          const scrollPercent = Math.round((window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100);
          this.trackEvent('scroll', { percent: scrollPercent });
        }, 1000);
      });
    },
    
    // NOVO: Métodos para expor visitor_id (compatibilidade total mantida)
    getVisitorId: function() {
      return this.getOrCreateVisitorId();
    },
    
    getSessionId: function() {
      return this.config.sessionId;
    },
    
    // Propriedades para acesso direto
    get visitorId() {
      return this.getOrCreateVisitorId();
    },
    
    get sessionId() {
      return this.config.sessionId;
    },
    
    // NOVO: Interceptação automática de formulários (Sistema Híbrido)
    setupFormInterception: function() {
      const self = this;
      
      console.log('LovoCRM: Iniciando sistema de interceptação de formulários');
      
      // Função para interceptar formulários
      function interceptExistingForms() {
        console.log('LovoCRM: Procurando formulários existentes...');
        self.interceptForms();
        
        // Tentar novamente após um delay (para formulários React/dinâmicos)
        setTimeout(function() {
          console.log('LovoCRM: Segunda tentativa de interceptação...');
          self.interceptForms();
        }, 1000);
        
        // Terceira tentativa após mais tempo
        setTimeout(function() {
          console.log('LovoCRM: Terceira tentativa de interceptação...');
          self.interceptForms();
        }, 3000);
      }
      
      // Aguardar DOM estar pronto
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', interceptExistingForms);
      } else {
        interceptExistingForms();
      }
      
      // Interceptar formulários adicionados dinamicamente
      try {
        const observer = new MutationObserver(function(mutations) {
          mutations.forEach(function(mutation) {
            mutation.addedNodes.forEach(function(node) {
              if (node && node.nodeType === 1) { // Element node
                if (node.tagName === 'FORM') {
                  console.log('LovoCRM: Novo formulário detectado via MutationObserver');
                  self.interceptForm(node);
                } else if (node.querySelectorAll) {
                  const forms = node.querySelectorAll('form');
                  if (forms.length > 0) {
                    console.log('LovoCRM: ' + forms.length + ' formulários encontrados em novo elemento');
                    forms.forEach(function(form) {
                      self.interceptForm(form);
                    });
                  }
                }
              }
            });
          });
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
        console.log('LovoCRM: MutationObserver ativo para formulários dinâmicos');
      } catch (error) {
        console.error('LovoCRM: Erro ao configurar MutationObserver:', error);
      }
    },
    
    interceptForms: function() {
      const self = this;
      const forms = document.querySelectorAll('form');
      
      console.log('LovoCRM: Encontrados ' + forms.length + ' formulários na página');
      
      forms.forEach(function(form, index) {
        console.log('LovoCRM: Analisando formulário ' + (index + 1) + '/' + forms.length);
        self.interceptForm(form);
      });
    },
    
    interceptForm: function(form) {
      const self = this;
      
      try {
        // Verificar se já foi interceptado
        if (form.dataset.lovoIntercepted) {
          console.log('LovoCRM: Formulário já interceptado, pulando...');
          return;
        }
        
        // Verificar se é um formulário que vai para webhook LovoCRM
        const action = form.action || form.getAttribute('action') || '';
        const method = form.method || form.getAttribute('method') || '';
        
        console.log('LovoCRM: Analisando formulário - Action:', action, 'Method:', method);
        
        // Critérios mais amplos de detecção
        const isWebhookForm = action.includes('webhook-lead') || 
                             action.includes('lovoocrm.com') ||
                             action.includes('app.lovoocrm.com') ||
                             action.includes('/api/webhook');
        
        let isLovoCRMForm = isWebhookForm;
        
        if (!isWebhookForm) {
          // Verificar se tem campo api_key (indicativo de webhook LovoCRM)
          const apiKeyField = form.querySelector('input[name="api_key"]');
          const apiKeyValue = apiKeyField ? apiKeyField.value : '';
          
          console.log('LovoCRM: Campo api_key encontrado:', !!apiKeyField, 'Valor:', apiKeyValue ? 'presente' : 'vazio');
          
          // RELAXADO: Aceitar campo api_key mesmo sem valor (pode ser preenchido via JS)
          if (apiKeyField) {
            isLovoCRMForm = true;
            console.log('LovoCRM: Formulário identificado por campo api_key (valor pode ser definido dinamicamente)');
          }
        }
        
        // Verificar também por outros indicadores (critérios mais flexíveis)
        if (!isLovoCRMForm) {
          // Verificar se tem campos típicos de lead
          const hasLeadFields = form.querySelector('input[name="nome"], input[name="name"], input[name="email"]');
          const hasApiKeyField = form.querySelector('input[name="api_key"]'); // Qualquer tipo
          
          console.log('LovoCRM: Campos de lead encontrados:', !!hasLeadFields, 'Campo api_key encontrado:', !!hasApiKeyField);
          
          // FLEXÍVEL: Se tem campos de lead E campo api_key (qualquer tipo)
          if (hasLeadFields && hasApiKeyField) {
            isLovoCRMForm = true;
            console.log('LovoCRM: Formulário identificado por campos de lead + api_key');
          }
          
          // AINDA MAIS FLEXÍVEL: Se tem campos de lead e parece ser formulário de contato
          if (!isLovoCRMForm && hasLeadFields) {
            const hasContactFields = form.querySelector('input[name="telefone"], input[name="phone"], textarea[name="mensagem"], textarea[name="message"]');
            if (hasContactFields) {
              console.log('LovoCRM: Formulário com campos de lead e contato - assumindo LovoCRM');
              isLovoCRMForm = true;
            }
          }
        }
        
        if (!isLovoCRMForm) {
          console.log('LovoCRM: Formulário não é LovoCRM, ignorando');
          return;
        }
        
        form.dataset.lovoIntercepted = 'true';
        console.log('LovoCRM: ✅ Interceptando formulário LovoCRM!');
        
        // Interceptar submit ANTES do processamento
        form.addEventListener('submit', function(e) {
          console.log('LovoCRM: Submit interceptado!');
          
          // CRÍTICO: Pausar envio para garantir visitor_id
          e.preventDefault();
          
          // Enriquecer formulário
          self.enhanceFormSubmission(form, e);
          
          // Aguardar um momento para garantir que campos foram adicionados
          setTimeout(function() {
            console.log('LovoCRM: Reenviando formulário com visitor_id...');
            self.resubmitForm(form);
          }, 100);
        });
        
      } catch (error) {
        console.error('LovoCRM: Erro ao interceptar formulário:', error);
      }
    },
    
    enhanceFormSubmission: function(form, event) {
      const self = this;
      
      try {
        console.log('LovoCRM: Enriquecendo envio do formulário...');
        
        // Verificar se já tem visitor_id
        let visitorIdField = form.querySelector('input[name="visitor_id"]');
        
        if (!visitorIdField) {
          console.log('LovoCRM: Criando campo visitor_id...');
          // Criar campo hidden automaticamente
          visitorIdField = document.createElement('input');
          visitorIdField.type = 'hidden';
          visitorIdField.name = 'visitor_id';
          form.appendChild(visitorIdField);
        } else {
          console.log('LovoCRM: Campo visitor_id já existe');
        }
        
        // Definir visitor_id
        const visitorId = self.getOrCreateVisitorId();
        visitorIdField.value = visitorId;
        
        console.log('LovoCRM: ✅ Visitor ID adicionado:', visitorId);
        
        // Adicionar session_id também (para dados extras)
        let sessionIdField = form.querySelector('input[name="session_id"]');
        if (!sessionIdField) {
          console.log('LovoCRM: Criando campo session_id...');
          sessionIdField = document.createElement('input');
          sessionIdField.type = 'hidden';
          sessionIdField.name = 'session_id';
          sessionIdField.value = self.config.sessionId;
          form.appendChild(sessionIdField);
          console.log('LovoCRM: ✅ Session ID adicionado:', self.config.sessionId);
        }
        
        // Log final
        console.log('LovoCRM: ✅ Formulário enriquecido com sucesso! Pronto para envio...');
        
      } catch (error) {
        console.error('LovoCRM: ❌ Erro ao enriquecer formulário:', error);
        // NÃO impede o envio - sistema robusto
      }
    },
    
    // NOVA FUNÇÃO: Reenviar formulário com todos os campos incluídos
    resubmitForm: function(form) {
      const self = this;
      
      try {
        console.log('LovoCRM: Preparando reenvio do formulário...');
        
        // Verificar se formulário tem action (formulário tradicional)
        const action = form.action || form.getAttribute('action');
        
        if (action && action.includes('webhook')) {
          console.log('LovoCRM: Formulário tradicional - enviando via submit nativo');
          // Remover listener para evitar loop
          form.removeEventListener('submit', arguments.callee);
          form.submit();
        } else {
          console.log('LovoCRM: Formulário SPA - enviando via fetch');
          self.submitFormViaFetch(form);
        }
        
      } catch (error) {
        console.error('LovoCRM: Erro no reenvio:', error);
        // Fallback: tentar submit nativo
        try {
          form.submit();
        } catch (fallbackError) {
          console.error('LovoCRM: Erro no fallback:', fallbackError);
        }
      }
    },
    
    // NOVA FUNÇÃO: Enviar formulário via fetch garantindo visitor_id
    submitFormViaFetch: function(form) {
      try {
        console.log('LovoCRM: Coletando dados do formulário...');
        
        // ABORDAGEM ROBUSTA: Coletar campos manualmente
        const jsonData = {};
        
        // Buscar TODOS os inputs, selects e textareas
        const allFields = form.querySelectorAll('input, select, textarea');
        
        allFields.forEach(function(field) {
          if (field.name && field.value) {
            jsonData[field.name] = field.value;
            console.log('LovoCRM: Campo coletado:', field.name, '=', field.value);
          }
        });
        
        // FALLBACK: Se ainda não tem api_key, procurar especificamente
        if (!jsonData.api_key) {
          // Procurar por qualquer campo que possa conter API key
          const possibleApiFields = form.querySelectorAll('input[name*="api"], input[id*="api"], input[class*="api"]');
          possibleApiFields.forEach(function(field) {
            if (field.value) {
              jsonData.api_key = field.value;
              console.log('LovoCRM: ✅ API Key encontrada em campo alternativo:', field.name || field.id, '=', field.value);
            }
          });
        }
        
        // Se AINDA não tem api_key, usar valor padrão conhecido
        if (!jsonData.api_key) {
          jsonData.api_key = '582121bf-6661-4c70-81e0-f180f481a92b';
          console.log('LovoCRM: ⚠️ Usando API Key padrão (fallback)');
        }
        
        // Garantir que visitor_id está incluído
        const visitorIdField = form.querySelector('input[name="visitor_id"]');
        if (visitorIdField && visitorIdField.value) {
          jsonData.visitor_id = visitorIdField.value;
          console.log('LovoCRM: ✅ Visitor ID incluído no fetch:', visitorIdField.value);
        }
        
        // Garantir que session_id está incluído
        const sessionIdField = form.querySelector('input[name="session_id"]');
        if (sessionIdField && sessionIdField.value) {
          jsonData.session_id = sessionIdField.value;
          console.log('LovoCRM: ✅ Session ID incluído no fetch:', sessionIdField.value);
        }
        
        console.log('LovoCRM: Dados finais para envio:', jsonData);
        
        // Enviar via fetch
        fetch('https://app.lovoocrm.com/api/webhook-lead', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(jsonData)
        })
        .then(response => response.json())
        .then(data => {
          console.log('LovoCRM: ✅ Resposta do webhook:', data);
          
          // Se sucesso, redirecionar ou mostrar mensagem
          if (data.success) {
            console.log('LovoCRM: 🎉 Lead criado com sucesso! ID:', data.lead_id);
            
            // Tentar encontrar página de sucesso ou mostrar alerta
            const successUrl = form.dataset.successUrl || form.getAttribute('data-success-url');
            if (successUrl) {
              window.location.href = successUrl;
            } else {
              alert('Obrigado! Seu contato foi enviado com sucesso.');
            }
          } else {
            console.error('LovoCRM: Erro do webhook:', data.error);
            alert('Erro ao enviar formulário. Tente novamente.');
          }
        })
        .catch(error => {
          console.error('LovoCRM: Erro no fetch:', error);
          alert('Erro ao enviar formulário. Tente novamente.');
        });
        
      } catch (error) {
        console.error('LovoCRM: Erro no submitFormViaFetch:', error);
      }
    }
  };
  
  // Make available globally with multiple names for compatibility
  window.LovoCRM = M4Track;
  window.LovooCRM = M4Track;
  window.M4Track = M4Track;
  
  console.log('LovoCRM Analytics V4 ready. Versões suportadas: LovoCRM (recomendado), LovooCRM (atual), M4Track (compatibilidade)');
  
})();
