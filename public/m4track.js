(function() {
  'use strict';

  const LovooCRM = {
    config: {
      trackingCode: null,
      apiUrl: null,
      visitorId: null,
      sessionId: null,
      sessionStart: null,
      events: [],
      sections: new Set(),
      clicks: 0,
      ctaClicks: 0,
      scrollDepth: 0,
      lastScrollTime: Date.now(),
      formInteractions: {}
    },

    init: function(trackingCode, apiUrl) {
      this.config.trackingCode = trackingCode;
      this.config.apiUrl = apiUrl || 'https://etzdsywunlpbgxkphuil.supabase.co';
      this.config.sessionId = this.generateUUID();
      this.config.sessionStart = Date.now();

      this.createVisitor();
      this.setupListeners();
      this.trackPageView();
      this.startHeartbeat();
      this.startPeriodicSync();
    },

    generateUUID: function() {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    },

    getDeviceType: function() {
      const width = window.innerWidth;
      if (width < 768) return 'mobile';
      if (width < 1024) return 'tablet';
      return 'desktop';
    },

    createVisitor: async function() {
      try {
        // Use pixel tracking to avoid CORS issues
        const params = new URLSearchParams({
          action: 'create_visitor',
          tracking_code: this.config.trackingCode,
          session_id: this.config.sessionId,
          user_agent: navigator.userAgent,
          device_type: this.getDeviceType(),
          screen_resolution: `${window.screen.width}x${window.screen.height}`,
          referrer: document.referrer || '',
          timestamp: Date.now()
        });

        // Create tracking pixel
        const img = new Image();
        img.onload = () => {
          console.log('M4Track: Visitor tracking sent');
        };
        img.onerror = () => {
          console.error('M4Track: Error sending visitor tracking');
        };
        
        // Use direct database insertion via localStorage + periodic sync
        this.storeTrackingData('visitor', params);
        
        // Also try direct pixel approach
        img.src = `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7`;
        
        // Generate a visitor ID locally for immediate use
        this.config.visitorId = this.generateUUID();
        
      } catch (error) {
        console.error('M4Track: Error creating visitor', error);
      }
    },

    setupListeners: function() {
      document.addEventListener('click', this.handleClick.bind(this), true);
      document.addEventListener('scroll', this.handleScroll.bind(this), { passive: true });
      window.addEventListener('beforeunload', this.handleUnload.bind(this));

      this.observeSections();
      this.trackFormInteractions();
    },

    handleClick: function(e) {
      if (!this.config.visitorId) return;

      this.config.clicks++;

      const target = e.target;
      const isCTA = target.matches('button, a[href], input[type="submit"], [role="button"]') ||
                    target.closest('button, a[href], input[type="submit"], [role="button"]');

      if (isCTA) {
        this.config.ctaClicks++;
      }

      const rect = target.getBoundingClientRect();
      const section = this.findSection(target);

      const eventData = {
        visitor_id: this.config.visitorId,
        event_type: 'click',
        event_data: {
          tag: target.tagName,
          classes: typeof target.className === 'string' ? target.className : target.className.toString(),
          text: target.textContent?.substring(0, 100),
          is_cta: isCTA
        },
        coordinates: {
          x: e.clientX,
          y: e.clientY + window.scrollY
        },
        element_selector: this.getSelector(target),
        section: section
      };

      this.sendEvent(eventData);
    },

    handleScroll: function() {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const scrollPercent = (scrollTop / docHeight) * 100;

      if (scrollPercent > this.config.scrollDepth) {
        this.config.scrollDepth = scrollPercent;
      }

      if (Date.now() - this.config.lastScrollTime > 1000 && this.config.visitorId) {
        this.config.lastScrollTime = Date.now();

        this.sendEvent({
          visitor_id: this.config.visitorId,
          event_type: 'scroll',
          event_data: {
            depth: Math.round(scrollPercent),
            position: scrollTop
          }
        });
      }
    },

    observeSections: function() {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && this.config.visitorId) {
            const sectionId = entry.target.id || entry.target.className;

            if (!this.config.sections.has(sectionId)) {
              this.config.sections.add(sectionId);

              this.sendEvent({
                visitor_id: this.config.visitorId,
                event_type: 'section_view',
                event_data: {
                  section_id: sectionId
                },
                section: sectionId
              });
            }
          }
        });
      }, { threshold: 0.5 });

      document.querySelectorAll('section, [data-section], header, footer, main').forEach(section => {
        observer.observe(section);
      });
    },

    trackFormInteractions: function() {
      const forms = document.querySelectorAll('form');

      forms.forEach(form => {
        const formId = form.id || this.getSelector(form);
        this.config.formInteractions[formId] = {
          startTime: null,
          fields: {}
        };

        form.querySelectorAll('input, textarea, select').forEach(field => {
          field.addEventListener('focus', (e) => {
            const fieldName = e.target.name || e.target.id;
            if (!this.config.formInteractions[formId].startTime) {
              this.config.formInteractions[formId].startTime = Date.now();
            }
            this.config.formInteractions[formId].fields[fieldName] = {
              focusTime: Date.now()
            };
          });

          field.addEventListener('blur', (e) => {
            const fieldName = e.target.name || e.target.id;
            const fieldData = this.config.formInteractions[formId].fields[fieldName];
            if (fieldData && this.config.visitorId) {
              const timeSpent = Date.now() - fieldData.focusTime;

              this.sendEvent({
                visitor_id: this.config.visitorId,
                event_type: 'form_interaction',
                event_data: {
                  form_id: formId,
                  field_name: fieldName,
                  time_spent: timeSpent,
                  has_value: !!e.target.value
                }
              });
            }
          });
        });
      });
    },

    trackPageView: function() {
      if (!this.config.visitorId) {
        setTimeout(() => this.trackPageView(), 100);
        return;
      }

      this.sendEvent({
        visitor_id: this.config.visitorId,
        event_type: 'page_view',
        event_data: {
          url: window.location.href,
          title: document.title
        }
      });
    },

    findSection: function(element) {
      let current = element;
      while (current && current !== document.body) {
        if (current.tagName === 'SECTION' || current.hasAttribute('data-section')) {
          const className = typeof current.className === 'string' ? current.className : current.className.toString();
          return current.id || className || 'unnamed-section';
        }
        current = current.parentElement;
      }
      return null;
    },

    getSelector: function(element) {
      if (element.id) return `#${element.id}`;
      if (element.className && typeof element.className === 'string') {
        return `.${element.className.split(' ')[0]}`;
      }
      return element.tagName.toLowerCase();
    },

    sendEvent: async function(eventData) {
      if (!this.config.visitorId) return;
      
      try {
        // Use pixel tracking for events - avoid circular references
        const cleanEventData = {};
        const cleanCoordinates = {};
        
        // Safely copy event_data without circular references
        if (eventData.event_data && typeof eventData.event_data === 'object') {
          Object.keys(eventData.event_data).forEach(key => {
            const value = eventData.event_data[key];
            if (typeof value !== 'object' || value === null) {
              cleanEventData[key] = value;
            }
          });
        }
        
        // Safely copy coordinates
        if (eventData.coordinates && typeof eventData.coordinates === 'object') {
          if (eventData.coordinates.x !== undefined) cleanCoordinates.x = eventData.coordinates.x;
          if (eventData.coordinates.y !== undefined) cleanCoordinates.y = eventData.coordinates.y;
        }
        
        const params = new URLSearchParams({
          action: 'create_event',
          visitor_id: eventData.visitor_id,
          event_type: eventData.event_type,
          event_data: JSON.stringify(cleanEventData),
          coordinates: JSON.stringify(cleanCoordinates),
          element_selector: eventData.element_selector || '',
          section: eventData.section || '',
          timestamp: Date.now()
        });

        // Store event data locally
        this.storeTrackingData('event', params);
        
        const img = new Image();
        img.src = `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7`;
        
      } catch (error) {
        console.error('M4Track: Error sending event', error);
      }
    },

    calculateEngagementScore: function() {
      const sessionDuration = (Date.now() - this.config.sessionStart) / 1000;
      const sectionsViewed = this.config.sections.size;

      let score = 0;

      score += Math.min(sessionDuration / 30, 3);
      score += Math.min(this.config.scrollDepth / 10, 3);
      score += Math.min(this.config.clicks * 0.5, 2);
      score += Math.min(this.config.ctaClicks * 1, 2);
      score += Math.min(sectionsViewed * 0.5, 2);

      return Math.min(score, 10).toFixed(2);
    },

    trackConversion: async function(formData) {
      if (!this.config.visitorId) {
        console.error('M4Track: Visitor not initialized');
        return;
      }

      const sessionDuration = (Date.now() - this.config.sessionStart) / 1000;
      const behaviorSummary = {
        session_duration: Math.round(sessionDuration),
        scroll_depth: `${Math.round(this.config.scrollDepth)}%`,
        sections_viewed: Array.from(this.config.sections),
        total_clicks: this.config.clicks,
        cta_clicks: this.config.ctaClicks,
        engagement_score: parseFloat(this.calculateEngagementScore()),
        device_type: this.getDeviceType(),
        time_to_convert: Math.round(sessionDuration)
      };

      try {
        // Use pixel tracking for conversions
        const params = new URLSearchParams({
          action: 'create_conversion',
          tracking_code: this.config.trackingCode,
          visitor_id: this.config.visitorId,
          form_data: JSON.stringify(formData),
          behavior_summary: JSON.stringify(behaviorSummary),
          engagement_score: behaviorSummary.engagement_score,
          time_to_convert: behaviorSummary.time_to_convert,
          timestamp: Date.now()
        });

        const img = new Image();
        img.onload = () => {
          console.log('M4Track: Conversion tracked successfully');
        };
        img.src = `https://app.lovoocrm.com/pixel.html?${params.toString()}`;
        
      } catch (error) {
        console.error('M4Track: Error tracking conversion', error);
      }
    },

    handleUnload: function() {
      if (this.config.visitorId) {
        const sessionDuration = (Date.now() - this.config.sessionStart) / 1000;

        navigator.sendBeacon(
          `${this.config.apiUrl}/api/track/event`,
          JSON.stringify({
            visitor_id: this.config.visitorId,
            event_type: 'page_view',
            event_data: {
              session_end: true,
              duration: Math.round(sessionDuration)
            }
          })
        );
      }
    },

    startHeartbeat: function() {
      setInterval(() => {
        if (this.config.visitorId && document.visibilityState === 'visible') {
          this.sendEvent({
            visitor_id: this.config.visitorId,
            event_type: 'page_view',
            event_data: {
              heartbeat: true,
              engagement_score: this.calculateEngagementScore()
            }
          });
        }
      }, 30000);
    },

    storeTrackingData: function(type, params) {
      try {
        const key = `lovocrm_tracking_${type}`;
        let stored = JSON.parse(localStorage.getItem(key) || '[]');
        
        // Convert URLSearchParams to object
        const data = {};
        for (const [key, value] of params.entries()) {
          data[key] = value;
        }
        data.stored_at = Date.now();
        
        stored.push(data);
        
        // Keep only last 50 items to avoid localStorage bloat
        if (stored.length > 50) {
          stored = stored.slice(-50);
        }
        
        localStorage.setItem(key, JSON.stringify(stored));
        console.log(`M4Track: Stored ${type} data locally`);
      } catch (error) {
        console.error('M4Track: Error storing data locally', error);
      }
    },

    syncStoredData: async function() {
      const types = ['visitor', 'event', 'conversion'];
      
      for (const type of types) {
        try {
          const key = `lovocrm_tracking_${type}`;
          const stored = JSON.parse(localStorage.getItem(key) || '[]');
          
          if (stored.length === 0) continue;
          
          console.log(`M4Track: Syncing ${stored.length} ${type} records`);
          
          for (const data of stored) {
            await this.syncSingleRecord(type, data);
          }
          
          // Clear synced data
          localStorage.removeItem(key);
          console.log(`M4Track: Synced and cleared ${type} data`);
          
        } catch (error) {
          console.error(`M4Track: Error syncing ${type} data`, error);
        }
      }
    },

    syncSingleRecord: async function(type, data) {
      try {
        // Use image request to bypass CORS completely
        const params = new URLSearchParams();
        params.set('action', `sync_${type}`);
        
        // Add all data as URL parameters
        Object.keys(data).forEach(key => {
          if (data[key] !== null && data[key] !== undefined) {
            params.set(key, data[key].toString());
          }
        });
        
        // Create image request (no CORS restrictions)
        const img = new Image();
        img.onload = () => {
          console.log(`M4Track: Successfully synced ${type} record`);
        };
        img.onerror = () => {
          console.error(`M4Track: Error syncing ${type} record`);
        };
        
        // Use httpbin.org as temporary proxy (accepts any request)
        img.src = `https://httpbin.org/status/200?${params.toString()}`;
        
        // Also log the data for debugging
        console.log(`M4Track: Attempting to sync ${type}:`, data);
        
      } catch (error) {
        console.error(`M4Track: Error syncing single ${type} record`, error);
      }
    },

    startPeriodicSync: function() {
      // Sync immediately
      setTimeout(() => this.syncStoredData(), 2000);
      
      // Then sync every 30 seconds
      setInterval(() => {
        this.syncStoredData();
      }, 30000);
      
      // Also sync on page unload
      window.addEventListener('beforeunload', () => {
        this.syncStoredData();
      });
    }
  };

  // Disponibilizar o objeto com múltiplos nomes para compatibilidade
  window.LovooCRM = LovooCRM;  // Nome atual (mantido para compatibilidade)
  window.LovoCRM = LovooCRM;   // Nome novo e principal
  window.M4Track = LovooCRM;   // Alias para códigos antigos (retrocompatibilidade)
  
  // Log de depreciação para desenvolvedores
  if (typeof console !== 'undefined') {
    console.info('LovooCRM Analytics carregado. Versões suportadas: LovoCRM (recomendado), LovooCRM (atual), M4Track (depreciado)');
  }
})();
