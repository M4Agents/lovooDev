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

    // In-memory fallback when localStorage is unavailable (page session only)
    _utmMemory: {},
    
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

      // First-touch UTM snapshot (fail-open; never blocks init/tracking)
      try {
        this.captureFirstTouchAttribution();
      } catch (e) {
        console.log('M4Track: UTM capture skipped', e && e.message ? e.message : e);
      }
      
      // Visit first, then page_view/listeners (avoid event-before-visit race)
      this.trackVisitor()
        .catch(function () { /* visit attempt settled with error; continue */ })
        .then(function () {
          M4Track.setupEventListeners();
        });
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

    // Limits aligned with api/webhook-lead.js FIELD_WHITELIST
    UTM_LIMITS: {
      utm_source: 255,
      utm_medium: 100,
      utm_campaign: 255,
      utm_content: 255,
      utm_term: 255
    },

    // Alias groups from api/webhook-lead.js (exact whitelist keys only)
    UTM_ALIAS_GROUPS: {
      utm_source: ['utm_source', 'origin', 'origem', 'source', 'fonte'],
      utm_medium: ['utm_medium', 'medium', 'midia', 'mídia', 'canal_midia'],
      utm_campaign: ['utm_campaign', 'campanha', 'campaign', 'campaign_name', 'nome_campanha'],
      utm_content: ['utm_content', 'conjunto_anuncio', 'adset', 'ad_set', 'conjunto'],
      utm_term: ['utm_term', 'anuncio', 'ad', 'ad_name', 'nome_anuncio']
    },

    getUtmStorageKey: function() {
      var code = this.config && this.config.trackingCode;
      if (!code) return null;
      return 'lovocrm_utm_first:' + code;
    },

    normalizeUtmValue: function(raw, maxLen) {
      if (raw === null || raw === undefined) return null;
      var str = String(raw).trim();
      if (!str) return null;
      if (maxLen && str.length > maxLen) {
        str = str.substring(0, maxLen);
      }
      return str;
    },

    readUtmsFromUrl: function() {
      var result = {
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
        utm_content: null,
        utm_term: null
      };
      try {
        var params = new URLSearchParams(window.location.search);
        var limits = this.UTM_LIMITS;
        var keys = Object.keys(result);
        for (var i = 0; i < keys.length; i++) {
          var key = keys[i];
          result[key] = this.normalizeUtmValue(params.get(key), limits[key]);
        }
      } catch (e) {
        /* fail-open */
      }
      return result;
    },

    hasAnyValidUtm: function(utms) {
      if (!utms || typeof utms !== 'object') return false;
      return !!(utms.utm_source || utms.utm_medium || utms.utm_campaign ||
        utms.utm_content || utms.utm_term);
    },

    isValidUtmSnapshot: function(snapshot) {
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        return false;
      }
      return Object.prototype.hasOwnProperty.call(snapshot, 'utm_source') ||
        Object.prototype.hasOwnProperty.call(snapshot, 'utm_medium') ||
        Object.prototype.hasOwnProperty.call(snapshot, 'utm_campaign') ||
        Object.prototype.hasOwnProperty.call(snapshot, 'utm_content') ||
        Object.prototype.hasOwnProperty.call(snapshot, 'utm_term');
    },

    readUtmSnapshot: function() {
      var key = this.getUtmStorageKey();
      if (!key) return null;

      if (this._utmMemory[key] === '__corrupt__') {
        return null;
      }
      if (this._utmMemory[key] && this.isValidUtmSnapshot(this._utmMemory[key])) {
        return this._utmMemory[key];
      }

      try {
        var raw = localStorage.getItem(key);
        if (raw === null || raw === undefined) {
          return null;
        }
        var parsed = JSON.parse(raw);
        if (!this.isValidUtmSnapshot(parsed)) {
          this._utmMemory[key] = '__corrupt__';
          return null;
        }
        this._utmMemory[key] = parsed;
        return parsed;
      } catch (e) {
        try {
          if (localStorage.getItem(key) !== null) {
            this._utmMemory[key] = '__corrupt__';
          }
        } catch (e2) { /* ignore */ }
        return null;
      }
    },

    /** True when a storage key already exists (even if corrupt) — blocks new capture */
    hasUtmSnapshotKey: function() {
      var key = this.getUtmStorageKey();
      if (!key) return false;
      if (this._utmMemory[key] === '__corrupt__') return true;
      if (this._utmMemory[key] && this.isValidUtmSnapshot(this._utmMemory[key])) return true;
      try {
        return localStorage.getItem(key) !== null;
      } catch (e) {
        return false;
      }
    },

    writeUtmSnapshot: function(snapshot) {
      var key = this.getUtmStorageKey();
      if (!key || !snapshot) return false;
      this._utmMemory[key] = snapshot;
      try {
        localStorage.setItem(key, JSON.stringify(snapshot));
        return true;
      } catch (e) {
        return false;
      }
    },

    captureFirstTouchAttribution: function() {
      if (this.hasUtmSnapshotKey()) {
        return this.readUtmSnapshot();
      }

      var fromUrl = this.readUtmsFromUrl();
      if (!this.hasAnyValidUtm(fromUrl)) {
        return null;
      }

      var snapshot = {
        utm_source: fromUrl.utm_source,
        utm_medium: fromUrl.utm_medium,
        utm_campaign: fromUrl.utm_campaign,
        utm_content: fromUrl.utm_content,
        utm_term: fromUrl.utm_term,
        captured_at: new Date().toISOString(),
        landing_url: (typeof window !== 'undefined' && window.location && window.location.href)
          ? String(window.location.href)
          : null
      };

      this.writeUtmSnapshot(snapshot);
      return snapshot;
    },

    /** UTM fields only (never exposes captured_at / landing_url for injection) */
    getFirstTouchAttribution: function() {
      var snapshot = this.readUtmSnapshot();
      if (!snapshot || !this.isValidUtmSnapshot(snapshot)) return null;
      return {
        utm_source: snapshot.utm_source || null,
        utm_medium: snapshot.utm_medium || null,
        utm_campaign: snapshot.utm_campaign || null,
        utm_content: snapshot.utm_content || null,
        utm_term: snapshot.utm_term || null
      };
    },

    valueIsNonEmpty: function(value) {
      if (value === null || value === undefined) return false;
      return String(value).trim() !== '';
    },

    bodyHasNonEmptyAlias: function(body, aliases) {
      if (!body || typeof body !== 'object') return false;
      var keys = Object.keys(body);
      for (var i = 0; i < aliases.length; i++) {
        var aliasLower = aliases[i].toLowerCase();
        for (var j = 0; j < keys.length; j++) {
          if (String(keys[j]).toLowerCase() === aliasLower && this.valueIsNonEmpty(body[keys[j]])) {
            return true;
          }
        }
      }
      return false;
    },

    formHasNonEmptyAlias: function(form, aliases) {
      if (!form || !form.querySelector) return false;
      for (var i = 0; i < aliases.length; i++) {
        var alias = aliases[i];
        var el = form.querySelector(
          'input[name="' + alias + '"], select[name="' + alias + '"], textarea[name="' + alias + '"]'
        );
        if (el && this.valueIsNonEmpty(el.value)) {
          return true;
        }
      }
      return false;
    },

    formDataHasNonEmptyAlias: function(fd, aliases) {
      if (!fd || typeof fd.get !== 'function') return false;
      for (var i = 0; i < aliases.length; i++) {
        if (this.valueIsNonEmpty(fd.get(aliases[i]))) {
          return true;
        }
      }
      return false;
    },

    urlSearchParamsHasNonEmptyAlias: function(params, aliases) {
      if (!params || typeof params.get !== 'function') return false;
      for (var i = 0; i < aliases.length; i++) {
        if (this.valueIsNonEmpty(params.get(aliases[i]))) {
          return true;
        }
      }
      return false;
    },

    /** Lead-like convert body: name + contact (any host). Used only to attach visitor_id/session. */
    bodyLooksLikeLeadPayload: function(body) {
      if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
      var hasName = this.bodyHasNonEmptyAlias(body, ['name', 'nome', 'full_name', 'fullname']);
      var hasContact = this.bodyHasNonEmptyAlias(body, [
        'phone', 'whatsapp', 'telefone', 'tel', 'celular', 'email', 'e-mail'
      ]);
      return hasName && hasContact;
    },

    formDataLooksLikeLeadPayload: function(fd) {
      if (!fd || typeof fd.get !== 'function') return false;
      var hasName = this.formDataHasNonEmptyAlias(fd, ['name', 'nome', 'full_name', 'fullname']);
      var hasContact = this.formDataHasNonEmptyAlias(fd, [
        'phone', 'whatsapp', 'telefone', 'tel', 'celular', 'email', 'e-mail'
      ]);
      return hasName && hasContact;
    },

    urlSearchParamsLookLikeLeadPayload: function(params) {
      if (!params || typeof params.get !== 'function') return false;
      var hasName = this.urlSearchParamsHasNonEmptyAlias(params, ['name', 'nome', 'full_name', 'fullname']);
      var hasContact = this.urlSearchParamsHasNonEmptyAlias(params, [
        'phone', 'whatsapp', 'telefone', 'tel', 'celular', 'email', 'e-mail'
      ]);
      return hasName && hasContact;
    },

    isLovooLeadUrl: function(urlStr) {
      if (!urlStr) return false;
      var u = String(urlStr);
      return (
        u.indexOf('webhook-lead') !== -1 ||
        u.indexOf('lovoocrm.com') !== -1 ||
        u.indexOf('app.lovoocrm.com') !== -1 ||
        u.indexOf('/api/webhook') !== -1
      );
    },

    isTrackingEndpointUrl: function(urlStr) {
      if (!urlStr) return false;
      var u = String(urlStr);
      return (
        u.indexOf('/api/webhook-visitor') !== -1 ||
        u.indexOf('/api/collect') !== -1 ||
        u.indexOf('/api/track') !== -1
      );
    },

    injectUtmsIntoBody: function(bodyData) {
      if (!bodyData || typeof bodyData !== 'object' || Array.isArray(bodyData)) {
        return bodyData;
      }
      var attr = this.getFirstTouchAttribution();
      if (!attr || !this.hasAnyValidUtm(attr)) return bodyData;

      var groups = this.UTM_ALIAS_GROUPS;
      var utmKeys = Object.keys(groups);
      for (var i = 0; i < utmKeys.length; i++) {
        var utmKey = utmKeys[i];
        var value = attr[utmKey];
        if (!value) continue;
        var aliases = groups[utmKey];
        if (this.bodyHasNonEmptyAlias(bodyData, aliases)) continue;

        var filled = false;
        var keys = Object.keys(bodyData);
        for (var a = 0; a < aliases.length && !filled; a++) {
          var aliasLower = aliases[a].toLowerCase();
          for (var k = 0; k < keys.length; k++) {
            if (String(keys[k]).toLowerCase() === aliasLower) {
              if (!this.valueIsNonEmpty(bodyData[keys[k]])) {
                bodyData[keys[k]] = value;
              }
              filled = true;
              break;
            }
          }
        }
        if (!filled) {
          bodyData[utmKey] = value;
        }
      }
      return bodyData;
    },

    injectUtmsIntoForm: function(form) {
      if (!form) return;
      var attr = this.getFirstTouchAttribution();
      if (!attr || !this.hasAnyValidUtm(attr)) return;

      var groups = this.UTM_ALIAS_GROUPS;
      var utmKeys = Object.keys(groups);
      for (var i = 0; i < utmKeys.length; i++) {
        var utmKey = utmKeys[i];
        var value = attr[utmKey];
        if (!value) continue;
        var aliases = groups[utmKey];
        if (this.formHasNonEmptyAlias(form, aliases)) continue;

        var existing = null;
        for (var a = 0; a < aliases.length; a++) {
          var el = form.querySelector(
            'input[name="' + aliases[a] + '"], select[name="' + aliases[a] + '"], textarea[name="' + aliases[a] + '"]'
          );
          if (el) {
            existing = el;
            break;
          }
        }

        if (existing) {
          if (!this.valueIsNonEmpty(existing.value)) {
            existing.value = value;
          }
        } else {
          var hidden = document.createElement('input');
          hidden.type = 'hidden';
          hidden.name = utmKey;
          hidden.value = value;
          form.appendChild(hidden);
        }
      }
    },

    injectUtmsIntoFormData: function(fd) {
      if (!fd || typeof fd.append !== 'function') return;
      var attr = this.getFirstTouchAttribution();
      if (!attr || !this.hasAnyValidUtm(attr)) return;

      var groups = this.UTM_ALIAS_GROUPS;
      var utmKeys = Object.keys(groups);
      for (var i = 0; i < utmKeys.length; i++) {
        var utmKey = utmKeys[i];
        var value = attr[utmKey];
        if (!value) continue;
        var aliases = groups[utmKey];
        if (this.formDataHasNonEmptyAlias(fd, aliases)) continue;

        var existingName = null;
        for (var a = 0; a < aliases.length; a++) {
          if (typeof fd.has === 'function' && fd.has(aliases[a])) {
            existingName = aliases[a];
            break;
          }
        }
        if (existingName) {
          if (typeof fd.set === 'function') {
            fd.set(existingName, value);
          }
        } else {
          fd.append(utmKey, value);
        }
      }
    },

    injectUtmsIntoURLSearchParams: function(params) {
      if (!params || typeof params.get !== 'function') return;
      var attr = this.getFirstTouchAttribution();
      if (!attr || !this.hasAnyValidUtm(attr)) return;

      var groups = this.UTM_ALIAS_GROUPS;
      var utmKeys = Object.keys(groups);
      for (var i = 0; i < utmKeys.length; i++) {
        var utmKey = utmKeys[i];
        var value = attr[utmKey];
        if (!value) continue;
        var aliases = groups[utmKey];
        if (this.urlSearchParamsHasNonEmptyAlias(params, aliases)) continue;

        var existingName = null;
        for (var a = 0; a < aliases.length; a++) {
          if (params.has(aliases[a])) {
            existingName = aliases[a];
            break;
          }
        }
        if (existingName) {
          if (!this.valueIsNonEmpty(params.get(existingName))) {
            params.set(existingName, value);
          }
        } else {
          params.set(utmKey, value);
        }
      }
    },

    ensureVisitorAndSessionOnBody: function(bodyData) {
      if (!bodyData || typeof bodyData !== 'object') return bodyData;
      if (!bodyData.visitor_id) {
        bodyData.visitor_id = this.getOrCreateVisitorId();
      }
      if (!bodyData.session_id) {
        bodyData.session_id = this.config.sessionId;
      }
      return bodyData;
    },

    ensureVisitorAndSessionOnFormData: function(fd) {
      if (!fd) return;
      if (!this.valueIsNonEmpty(fd.get('visitor_id'))) {
        if (typeof fd.set === 'function' && fd.has('visitor_id')) {
          fd.set('visitor_id', this.getOrCreateVisitorId());
        } else {
          fd.append('visitor_id', this.getOrCreateVisitorId());
        }
      }
      if (!this.valueIsNonEmpty(fd.get('session_id'))) {
        if (typeof fd.set === 'function' && fd.has('session_id')) {
          fd.set('session_id', this.config.sessionId);
        } else {
          fd.append('session_id', this.config.sessionId);
        }
      }
    },

    ensureVisitorAndSessionOnURLSearchParams: function(params) {
      if (!params) return;
      if (!this.valueIsNonEmpty(params.get('visitor_id'))) {
        params.set('visitor_id', this.getOrCreateVisitorId());
      }
      if (!this.valueIsNonEmpty(params.get('session_id'))) {
        params.set('session_id', this.config.sessionId);
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
    
    trackVisitor: function() {
      if (!this.config.isInitialized) {
        return Promise.resolve();
      }

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

      // First-touch UTM goes on the visit (not required on form convert)
      var attr = this.getFirstTouchAttribution();
      if (attr && this.hasAnyValidUtm(attr)) {
        visitorData.utm_source = attr.utm_source || null;
        visitorData.utm_medium = attr.utm_medium || null;
        visitorData.utm_campaign = attr.utm_campaign || null;
        visitorData.utm_content = attr.utm_content || null;
        visitorData.utm_term = attr.utm_term || null;
      }

      // #region agent log
      try {
        fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f79aef' },
          body: JSON.stringify({
            sessionId: 'f79aef',
            runId: 'utm-track',
            hypothesisId: 'H1',
            location: 'm4track-v5.js:trackVisitor',
            message: 'visit payload with first-touch UTM',
            data: {
              hasUtm: !!(visitorData.utm_source || visitorData.utm_medium || visitorData.utm_campaign || visitorData.utm_content || visitorData.utm_term),
              utm_source: visitorData.utm_source || null,
              utm_medium: visitorData.utm_medium || null,
              utm_campaign: visitorData.utm_campaign || null,
              visitor_id_prefix: String(visitorData.visitor_id || '').slice(0, 8)
            },
            timestamp: Date.now()
          })
        }).catch(function () {});
      } catch (_dbgErr) {}
      // #endregion

      console.log('M4Track: Tracking visitor via webhook approach');
      return this.sendDataViaWebhook('visitor', visitorData);
    },
    
    sendDataViaWebhook: function(type, data) {
      var self = this;
      if (type !== 'visitor') {
        return Promise.resolve();
      }

      return new Promise(function (resolve) {
        try {
          console.log('M4Track: Sending webhook data:', data);

          fetch(`${self.config.apiUrl}/api/webhook-visitor`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
          }).then(function (response) {
            if (response.ok) {
              console.log('M4Track: Successfully sent visitor data via webhook approach');
              return response.json().catch(function () { return null; });
            }
            console.error('M4Track: Webhook failed with status:', response.status);
            throw new Error('HTTP ' + response.status);
          }).then(function (result) {
            if (result) {
              console.log('M4Track: Webhook response:', result);
            }
            resolve();
          }).catch(function (error) {
            console.error('M4Track: Webhook error:', error);
            console.log('M4Track: Falling back to image request');
            self.sendDataViaImage('visitor', data, resolve);
          });
        } catch (error) {
          console.error('M4Track: Error in sendDataViaWebhook:', error);
          self.sendDataViaImage('visitor', data, resolve);
        }
      });
    },
    
    // Visit fallback only → /api/collect (events use sendEventViaTrack)
    sendDataViaImage: function(type, data, onComplete) {
      try {
        const params = new URLSearchParams();
        params.set('action', type);
        
        Object.keys(data).forEach(key => {
          if (data[key] !== null && data[key] !== undefined) {
            params.set(key, data[key].toString());
          }
        });
        
        const img = new Image();
        const finish = function () {
          if (typeof onComplete === 'function') {
            onComplete();
          }
        };
        img.onload = function () {
          console.log('M4Track: Successfully sent ' + type + ' data via image fallback');
          finish();
        };
        img.onerror = function () {
          console.error('M4Track: Error sending ' + type + ' data via image');
          finish();
        };
        
        const collectUrl = `${this.config.apiUrl}/api/collect?${params.toString()}`;
        img.src = collectUrl;
        console.log('M4Track: Sending visitor data via image fallback to collect');
      } catch (error) {
        console.error('M4Track: Error in sendDataViaImage:', error);
        if (typeof onComplete === 'function') {
          onComplete();
        }
      }
    },

    sendEventViaTrack: function(data) {
      try {
        const params = new URLSearchParams();
        params.set('action', 'sync_event');

        Object.keys(data).forEach(key => {
          if (data[key] !== null && data[key] !== undefined) {
            params.set(key, data[key].toString());
          }
        });

        const img = new Image();
        img.onload = function () {
          console.log('M4Track: Successfully sent event via track sync_event');
        };
        img.onerror = function () {
          console.error('M4Track: Error sending event via track sync_event');
        };

        img.src = `${this.config.apiUrl}/api/track?${params.toString()}`;
        console.log('M4Track: Sending event via track sync_event');
      } catch (error) {
        console.error('M4Track: Error in sendEventViaTrack:', error);
      }
    },
    
    trackEvent: function(eventType, eventData = {}) {
      if (!this.config.isInitialized) return;

      const pageUrl =
        eventData && typeof eventData.url === 'string' && eventData.url
          ? eventData.url
          : window.location.href;
      
      const event = {
        tracking_code: this.config.trackingCode,
        visitor_id: this.getOrCreateVisitorId(),
        session_id: this.config.sessionId,
        event_type: eventType,
        event_data: JSON.stringify(eventData),
        page_url: pageUrl
      };
      
      console.log(`M4Track: Tracking event: ${eventType}`);
      this.sendEventViaTrack(event);
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

        // First-touch UTMs (form/body > pixel; fail-open)
        try {
          self.injectUtmsIntoForm(form);
        } catch (utmErr) {
          console.log('LovoCRM: UTM form inject skipped', utmErr && utmErr.message ? utmErr.message : utmErr);
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

        try {
          self.injectUtmsIntoForm(form);
        } catch (utmErr) {
          console.log('LovoCRM: UTM form inject skipped', utmErr && utmErr.message ? utmErr.message : utmErr);
        }
        
      } catch (error) {
        console.error('LovoCRM: Erro ao garantir visitor_id:', error);
      }
    },
    
    // Interceptar fetch/XHR: Lovoo URLs = visitor+UTM; lead-like qualquer host = só visitor/session
    setupHttpInterception: function() {
      const self = this;
      
      try {
        console.log('LovoCRM: Configurando interceptação HTTP...');
        
        // Interceptar fetch (método mais comum em React)
        if (window.fetch) {
          const originalFetch = window.fetch;
          
          window.fetch = function(url, options) {
            var urlStr = typeof url === 'string' ? url : (url && url.url ? String(url.url) : '');
            var isTracking = self.isTrackingEndpointUrl(urlStr);
            var isLovoo = self.isLovooLeadUrl(urlStr);

            if (!isTracking && options && options.body) {
              try {
                var body = options.body;
                var enriched = false;
                var injectUtm = false;

                if (typeof body === 'string') {
                  var bodyData;
                  try {
                    bodyData = JSON.parse(body);
                  } catch (jsonErr) {
                    bodyData = null;
                  }
                  if (bodyData && typeof bodyData === 'object' && !Array.isArray(bodyData)) {
                    var leadLike = self.bodyLooksLikeLeadPayload(bodyData);
                    if (isLovoo || leadLike) {
                      self.ensureVisitorAndSessionOnBody(bodyData);
                      if (isLovoo) {
                        self.injectUtmsIntoBody(bodyData);
                        injectUtm = true;
                      }
                      options.body = JSON.stringify(bodyData);
                      enriched = true;
                    }
                  }
                } else if (typeof FormData !== 'undefined' && body instanceof FormData) {
                  if (isLovoo || self.formDataLooksLikeLeadPayload(body)) {
                    self.ensureVisitorAndSessionOnFormData(body);
                    if (isLovoo) {
                      self.injectUtmsIntoFormData(body);
                      injectUtm = true;
                    }
                    enriched = true;
                  }
                } else if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
                  if (isLovoo || self.urlSearchParamsLookLikeLeadPayload(body)) {
                    self.ensureVisitorAndSessionOnURLSearchParams(body);
                    if (isLovoo) {
                      self.injectUtmsIntoURLSearchParams(body);
                      injectUtm = true;
                    }
                    enriched = true;
                  }
                }

                if (enriched) {
                  // #region agent log
                  try {
                    var _dbgHost = 'unknown';
                    try { _dbgHost = new URL(urlStr, window.location.href).hostname; } catch (_e) {}
                    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f79aef' },
                      body: JSON.stringify({
                        sessionId: 'f79aef',
                        runId: 'utm-track',
                        hypothesisId: 'H4',
                        location: 'm4track-v5.js:setupHttpInterception:fetch',
                        message: 'convert request enriched',
                        data: {
                          isLovoo: !!isLovoo,
                          injectUtm: !!injectUtm,
                          host: _dbgHost,
                          mode: injectUtm ? 'visitor_session+utm' : 'visitor_session'
                        },
                        timestamp: Date.now()
                      })
                    }).catch(function () {});
                  } catch (_dbgErr) {}
                  // #endregion
                  console.log('LovoCRM: Fetch enriquecido (' + (injectUtm ? 'visitor+UTM' : 'visitor/session') + ')');
                }
              } catch (error) {
                console.error('LovoCRM: Erro ao processar body da requisição:', error);
              }
            }
            
            return originalFetch.apply(this, arguments);
          };
          
          console.log('LovoCRM: ✅ Interceptação fetch configurada');
        }
        
        // Interceptar XMLHttpRequest (para axios e outras bibliotecas)
        if (window.XMLHttpRequest) {
          const originalXHRSend = XMLHttpRequest.prototype.send;
          
          XMLHttpRequest.prototype.send = function(data) {
            var urlStr = this._url ? String(this._url) : '';
            var isTracking = self.isTrackingEndpointUrl(urlStr);
            var isLovoo = self.isLovooLeadUrl(urlStr);

            if (!isTracking && data) {
              try {
                if (typeof data === 'string') {
                  var bodyData;
                  try {
                    bodyData = JSON.parse(data);
                  } catch (jsonErr) {
                    bodyData = null;
                  }
                  if (bodyData && typeof bodyData === 'object' && !Array.isArray(bodyData)) {
                    var leadLikeXhr = self.bodyLooksLikeLeadPayload(bodyData);
                    if (isLovoo || leadLikeXhr) {
                      self.ensureVisitorAndSessionOnBody(bodyData);
                      var injectUtmXhr = false;
                      if (isLovoo) {
                        self.injectUtmsIntoBody(bodyData);
                        injectUtmXhr = true;
                      }
                      data = JSON.stringify(bodyData);
                      // #region agent log
                      try {
                        fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f79aef' },
                          body: JSON.stringify({
                            sessionId: 'f79aef',
                            runId: 'utm-track',
                            hypothesisId: 'H4',
                            location: 'm4track-v5.js:setupHttpInterception:xhr',
                            message: 'convert XHR enriched',
                            data: { isLovoo: !!isLovoo, injectUtm: !!injectUtmXhr },
                            timestamp: Date.now()
                          })
                        }).catch(function () {});
                      } catch (_dbgErr) {}
                      // #endregion
                      console.log('LovoCRM: XHR enriquecido (' + (injectUtmXhr ? 'visitor+UTM' : 'visitor/session') + ')');
                    }
                  }
                }
              } catch (error) {
                console.error('LovoCRM: Erro ao processar XHR data:', error);
              }
            }
            
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
