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
      this.setupHttpInterception();
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
        
        // CRÍTICO: Adicionar visitor_id IMEDIATAMENTE (não esperar submit)
        self.enhanceFormSubmission(form, null);
        
        // TAMBÉM interceptar submit com capture phase (executa ANTES da serialização)
        form.addEventListener('submit', function(e) {
          console.log('LovoCRM: Submit interceptado - garantindo visitor_id...');
          
          // Garantir que visitor_id ainda está presente
          self.ensureVisitorIdPresent(form);
          
          console.log('LovoCRM: ✅ Visitor_id garantido - formulário continua envio normal');
        }, true); // true = capture phase (executa ANTES)
        
      } catch (error) {
        console.error('LovoCRM: Erro ao interceptar formulário:', error);
      }
    },
    
    enhanceFormSubmission: function(form, event) {
      const self = this;
      
      try {
        // SIMPLES: Apenas adicionar visitor_id se não existir
        let visitorIdField = form.querySelector('input[name="visitor_id"]');
        
        if (!visitorIdField) {
          // Criar campo hidden
          visitorIdField = document.createElement('input');
          visitorIdField.type = 'hidden';
          visitorIdField.name = 'visitor_id';
          visitorIdField.value = self.getOrCreateVisitorId();
          form.appendChild(visitorIdField);
          
          console.log('LovoCRM: ✅ Visitor ID adicionado:', visitorIdField.value);
        }
        
        // Adicionar session_id se não existir
        let sessionIdField = form.querySelector('input[name="session_id"]');
        if (!sessionIdField) {
          sessionIdField = document.createElement('input');
          sessionIdField.type = 'hidden';
          sessionIdField.name = 'session_id';
          sessionIdField.value = self.config.sessionId;
          form.appendChild(sessionIdField);
          
          console.log('LovoCRM: ✅ Session ID adicionado:', sessionIdField.value);
        }
        
      } catch (error) {
        console.error('LovoCRM: Erro ao adicionar visitor_id:', error);
        // NÃO impede o envio - sistema robusto
      }
    },
    
    // NOVA FUNÇÃO: Garantir que visitor_id está presente (chamada no capture phase)
    ensureVisitorIdPresent: function(form) {
      const self = this;
      
      try {
        // Verificar se visitor_id ainda está presente
        let visitorIdField = form.querySelector('input[name="visitor_id"]');
        
        if (!visitorIdField || !visitorIdField.value) {
          console.log('LovoCRM: Visitor ID não encontrado - adicionando novamente...');
          
          if (!visitorIdField) {
            // Criar campo se não existir
            visitorIdField = document.createElement('input');
            visitorIdField.type = 'hidden';
            visitorIdField.name = 'visitor_id';
            form.appendChild(visitorIdField);
          }
          
          // Definir valor
          visitorIdField.value = self.getOrCreateVisitorId();
          console.log('LovoCRM: ✅ Visitor ID garantido:', visitorIdField.value);
        } else {
          console.log('LovoCRM: ✅ Visitor ID já presente:', visitorIdField.value);
        }
        
        // Também garantir session_id
        let sessionIdField = form.querySelector('input[name="session_id"]');
        if (!sessionIdField || !sessionIdField.value) {
          if (!sessionIdField) {
            sessionIdField = document.createElement('input');
            sessionIdField.type = 'hidden';
            sessionIdField.name = 'session_id';
            form.appendChild(sessionIdField);
          }
          sessionIdField.value = self.config.sessionId;
          console.log('LovoCRM: ✅ Session ID garantido:', sessionIdField.value);
        }
        
      } catch (error) {
        console.error('LovoCRM: Erro ao garantir visitor_id:', error);
      }
    },
    
    // NOVA FUNÇÃO: Interceptar requisições HTTP (fetch/axios) para React/SPA
    setupHttpInterception: function() {
      const self = this;
      
      try {
        console.log('LovoCRM: Configurando interceptação HTTP...');
        
        // Interceptar fetch (método mais comum em React)
        if (window.fetch) {
          const originalFetch = window.fetch;
          
          window.fetch = function(url, options) {
            // Verificar se é uma requisição para webhook LovoCRM
            const isWebhookRequest = url && (
              url.includes('webhook-lead') ||
              url.includes('lovoocrm.com') ||
              url.includes('app.lovoocrm.com') ||
              url.includes('/api/webhook')
            );
            
            if (isWebhookRequest && options && options.body) {
              console.log('LovoCRM: Interceptando requisição fetch para webhook');
              
              try {
                // Tentar parsear o body como JSON
                let bodyData;
                if (typeof options.body === 'string') {
                  bodyData = JSON.parse(options.body);
                } else if (options.body instanceof FormData) {
                  // Converter FormData para objeto
                  bodyData = {};
                  for (let [key, value] of options.body.entries()) {
                    bodyData[key] = value;
                  }
                } else {
                  bodyData = options.body;
                }
                
                // Adicionar visitor_id se não existir
                if (!bodyData.visitor_id) {
                  bodyData.visitor_id = self.getOrCreateVisitorId();
                  console.log('LovoCRM: ✅ Visitor ID adicionado ao fetch:', bodyData.visitor_id);
                }
                
                // Adicionar session_id se não existir
                if (!bodyData.session_id) {
                  bodyData.session_id = self.config.sessionId;
                  console.log('LovoCRM: ✅ Session ID adicionado ao fetch:', bodyData.session_id);
                }
                
                // Atualizar o body da requisição
                if (options.body instanceof FormData) {
                  // Recriar FormData com novos campos
                  const newFormData = new FormData();
                  for (let [key, value] of Object.entries(bodyData)) {
                    newFormData.append(key, value);
                  }
                  options.body = newFormData;
                } else {
                  // Atualizar JSON
                  options.body = JSON.stringify(bodyData);
                }
                
                console.log('LovoCRM: 🚀 Requisição enriquecida com visitor_id');
                
              } catch (error) {
                console.error('LovoCRM: Erro ao processar body da requisição:', error);
                // Continuar com requisição original se houver erro
              }
            }
            
            // Chamar fetch original com dados (possivelmente) modificados
            return originalFetch.apply(this, arguments);
          };
          
          console.log('LovoCRM: ✅ Interceptação fetch configurada');
        }
        
        // Interceptar XMLHttpRequest (para axios e outras bibliotecas)
        if (window.XMLHttpRequest) {
          const originalXHRSend = XMLHttpRequest.prototype.send;
          
          XMLHttpRequest.prototype.send = function(data) {
            // Verificar se é uma requisição para webhook LovoCRM
            const isWebhookRequest = this._url && (
              this._url.includes('webhook-lead') ||
              this._url.includes('lovoocrm.com') ||
              this._url.includes('app.lovoocrm.com') ||
              this._url.includes('/api/webhook')
            );
            
            if (isWebhookRequest && data) {
              console.log('LovoCRM: Interceptando requisição XMLHttpRequest para webhook');
              
              try {
                let bodyData;
                if (typeof data === 'string') {
                  bodyData = JSON.parse(data);
                  
                  // Adicionar visitor_id se não existir
                  if (!bodyData.visitor_id) {
                    bodyData.visitor_id = self.getOrCreateVisitorId();
                    console.log('LovoCRM: ✅ Visitor ID adicionado ao XHR:', bodyData.visitor_id);
                  }
                  
                  // Adicionar session_id se não existir
                  if (!bodyData.session_id) {
                    bodyData.session_id = self.config.sessionId;
                    console.log('LovoCRM: ✅ Session ID adicionado ao XHR:', bodyData.session_id);
                  }
                  
                  // Atualizar dados
                  data = JSON.stringify(bodyData);
                  console.log('LovoCRM: 🚀 XHR enriquecido com visitor_id');
                }
              } catch (error) {
                console.error('LovoCRM: Erro ao processar XHR data:', error);
                // Continuar com dados originais se houver erro
              }
            }
            
            // Chamar método original
            return originalXHRSend.call(this, data);
          };
          
          // Interceptar open para capturar URL
          const originalXHROpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url) {
            this._url = url;
            return originalXHROpen.apply(this, arguments);
          };
          
          console.log('LovoCRM: ✅ Interceptação XMLHttpRequest configurada');
        }
        
      } catch (error) {
        console.error('LovoCRM: Erro ao configurar interceptação HTTP:', error);
      }
    }
  };
  
  // Make available globally with multiple names for compatibility
  window.LovoCRM = M4Track;
  window.LovooCRM = M4Track;
  window.M4Track = M4Track;
  
  console.log('LovoCRM Analytics V4 ready. Versões suportadas: LovoCRM (recomendado), LovooCRM (atual), M4Track (compatibilidade)');
  
})();
