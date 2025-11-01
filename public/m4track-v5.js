// LovoCRM Analytics V4 - Server-Side Approach
// Contorna CORS enviando dados via GET request

(function() {
  'use strict';
  
  console.log('LovoCRM Analytics V5 carregado - Server-Side Approach (Force Update)');
  
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
      return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
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
        user_agent: navigator.userAgent,
        device_type: this.getDeviceType(),
        screen_resolution: `${screen.width}x${screen.height}`,
        referrer: document.referrer || 'direct',
        timestamp: Date.now()
      };
      
      console.log('M4Track: Tracking visitor via server-side approach');
      this.sendDataViaGet('visitor', visitorData);
    },
    
    sendDataViaGet: function(type, data) {
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
          console.log(`M4Track: Successfully sent ${type} data via server-side approach`);
        };
        img.onerror = () => {
          console.error(`M4Track: Error sending ${type} data`);
        };
        
        // Send to our collect endpoint
        const collectUrl = `${this.config.apiUrl}/api/collect?${params.toString()}`;
        img.src = collectUrl;
        
        console.log(`M4Track: Sending ${type} data to:`, collectUrl);
        
      } catch (error) {
        console.error('M4Track: Error in sendDataViaGet:', error);
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
      this.sendDataViaGet('event', event);
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
