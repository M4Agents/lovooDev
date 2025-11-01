// LovoCRM Analytics V5 - Server-Side Approach with Enhanced Device Detection
// Contorna CORS enviando dados via webhook

(function() {
  'use strict';
  
  console.log('LovoCRM Analytics V5.1 carregado - Enhanced Device Detection (Cache Bust)');
  
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
      
      // Detectar dispositivos específicos
      if (/iPad/i.test(userAgent)) {
        return 'iPad';
      }
      if (/iPhone/i.test(userAgent)) {
        return 'iPhone';
      }
      if (/iPod/i.test(userAgent)) {
        return 'iPod';
      }
      if (/Android.*Mobile/i.test(userAgent)) {
        return 'Android Phone';
      }
      if (/Android/i.test(userAgent)) {
        return 'Android Tablet';
      }
      if (/BlackBerry/i.test(userAgent)) {
        return 'BlackBerry';
      }
      if (/Windows Phone/i.test(userAgent)) {
        return 'Windows Phone';
      }
      if (/tablet|playbook|silk/i.test(userAgent)) {
        return 'Tablet';
      }
      if (/mobile|smartphone|iemobile/i.test(userAgent)) {
        return 'Mobile';
      }
      if (/Macintosh/i.test(userAgent)) {
        return 'Mac';
      }
      if (/Windows/i.test(userAgent)) {
        return 'Windows';
      }
      if (/Linux/i.test(userAgent)) {
        return 'Linux';
      }
      return 'Desktop';
    },
    
    trackVisitor: function() {
      if (!this.config.isInitialized) return;
      
      try {
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
        console.log('M4Track: Visitor data prepared:', visitorData);
        this.sendDataViaWebhook('visitor', visitorData);
      } catch (error) {
        console.error('M4Track: Error in trackVisitor:', error);
        // Fallback com device_type simples
        const fallbackData = {
          tracking_code: this.config.trackingCode,
          session_id: this.config.sessionId,
          visitor_id: this.getOrCreateVisitorId(),
          user_agent: navigator.userAgent,
          device_type: 'unknown',
          screen_resolution: '1920x1080',
          referrer: 'direct',
          timezone: null,
          language: 'en'
        };
        console.log('M4Track: Using fallback data:', fallbackData);
        this.sendDataViaWebhook('visitor', fallbackData);
      }
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
    }
  };
  
  // Make available globally with multiple names for compatibility
  window.LovoCRM = M4Track;
  window.LovooCRM = M4Track;
  window.M4Track = M4Track;
  
  console.log('LovoCRM Analytics V4 ready. Versões suportadas: LovoCRM (recomendado), LovooCRM (atual), M4Track (compatibilidade)');
  
})();
