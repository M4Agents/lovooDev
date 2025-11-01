// LovoCRM Conversion Tracker - Para Formulários
// Envia dados de conversão quando o formulário é submetido

(function() {
  'use strict';
  
  console.log('LovoCRM Conversion Tracker carregado');
  
  const ConversionTracker = {
    config: {
      webhookUrl: 'https://app.lovoocrm.com/api/webhook-conversion',
      trackingCode: null,
      isInitialized: false
    },
    
    init: function(trackingCode) {
      if (!trackingCode) {
        console.error('ConversionTracker: Tracking code é obrigatório');
        return;
      }
      
      this.config.trackingCode = trackingCode;
      this.config.isInitialized = true;
      
      console.log('ConversionTracker: Inicializado com tracking code:', trackingCode);
    },
    
    // Função para ser chamada quando o formulário for submetido
    trackConversion: function(formData, options = {}) {
      if (!this.config.isInitialized) {
        console.error('ConversionTracker: Não inicializado. Chame ConversionTracker.init() primeiro');
        return;
      }
      
      // Pegar dados do visitante do localStorage (se disponível)
      const visitorId = this.getVisitorId();
      const sessionId = this.getSessionId();
      
      const conversionData = {
        tracking_code: this.config.trackingCode,
        visitor_id: visitorId,
        session_id: sessionId,
        form_data: formData,
        page_url: window.location.href,
        user_agent: navigator.userAgent,
        device_type: this.getDeviceType(),
        referrer: document.referrer || 'direct',
        ...options // Permite dados adicionais
      };
      
      console.log('ConversionTracker: Enviando conversão:', conversionData);
      
      // Enviar via webhook
      this.sendConversion(conversionData);
    },
    
    // Função automática para capturar formulários
    autoTrack: function(formSelector = 'form') {
      if (!this.config.isInitialized) {
        console.error('ConversionTracker: Não inicializado');
        return;
      }
      
      const forms = document.querySelectorAll(formSelector);
      
      forms.forEach(form => {
        form.addEventListener('submit', (e) => {
          // Não impedir o envio do formulário
          const formData = this.extractFormData(form);
          this.trackConversion(formData);
        });
      });
      
      console.log(`ConversionTracker: Auto-tracking ativado para ${forms.length} formulário(s)`);
    },
    
    extractFormData: function(form) {
      const formData = {};
      const inputs = form.querySelectorAll('input, select, textarea');
      
      inputs.forEach(input => {
        if (input.name && input.value) {
          // Não capturar senhas ou dados sensíveis
          if (input.type !== 'password' && input.type !== 'hidden') {
            formData[input.name] = input.value;
          }
        }
      });
      
      return formData;
    },
    
    sendConversion: function(data) {
      fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      })
      .then(response => {
        if (response.ok) {
          console.log('ConversionTracker: Conversão enviada com sucesso');
          return response.json();
        } else {
          console.error('ConversionTracker: Erro no webhook:', response.status);
          throw new Error(`HTTP ${response.status}`);
        }
      })
      .then(result => {
        console.log('ConversionTracker: Resposta do webhook:', result);
      })
      .catch(error => {
        console.error('ConversionTracker: Erro ao enviar conversão:', error);
      });
    },
    
    getVisitorId: function() {
      try {
        return localStorage.getItem('lovocrm_visitor_id');
      } catch (error) {
        return null;
      }
    },
    
    getSessionId: function() {
      try {
        return sessionStorage.getItem('lovocrm_session_id') || this.generateUUID();
      } catch (error) {
        return this.generateUUID();
      }
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
    
    generateUUID: function() {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }
  };
  
  // Disponibilizar globalmente
  window.ConversionTracker = ConversionTracker;
  window.LovoCRMConversion = ConversionTracker; // Alias
  
})();
