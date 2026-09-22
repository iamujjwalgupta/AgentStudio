/**
 * Agent Studio Bridge SDK v1.0
 * 
 * Lightweight bi-directional communication bridge between embedded web applications
 * and Agent Studio canvas workspace.
 * 
 * Usage in embedded app:
 *   <script src="/sdk/agent-studio-bridge.js"></script>
 *   <script>
 *     // Push app context when user selects a customer or order
 *     AgentStudioBridge.sendContext({
 *       selectedEntity: { id: "cust_123", name: "Acme Corp", tier: "Enterprise" },
 *       currentView: "CustomerBilling"
 *     });
 * 
 *     // Trigger an AI agent directly from a button click in your app
 *     AgentStudioBridge.triggerAgent({
 *       agentNameOrId: "Financial Analyst",
 *       input: "Generate quarterly ARR breakdown for Acme Corp"
 *     }).then(res => console.log("Result:", res));
 * 
 *     // Request explicit user authorization before dangerous actions
 *     AgentStudioBridge.requestApproval({
 *       action: "RESET_BILLING_CYCLE",
 *       summary: "Reset payment cycle for Acme Corp to Net-30",
 *       payload: { customerId: "cust_123" }
 *     }).then(({ decision }) => {
 *       if (decision === "approved") { ... }
 *     });
 *   </script>
 */

(function (global) {
  'use strict';

  var SOURCE = 'AGENT_STUDIO_BRIDGE';
  var eventListeners = {
    AGENT_EVENT: [],
    APPLY_PRESET: [],
    APPROVAL_RESPONSE: [],
    PONG: []
  };

  var pendingRequests = {};

  function generateId() {
    return 'req_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
  }

  function postToParent(action, payload, requestId) {
    if (typeof window === 'undefined' || !window.parent || window.parent === window) {
      console.warn('[AgentStudioBridge] Not running inside an iframe canvas or parent window is inaccessible.');
      return false;
    }

    var envelope = {
      source: SOURCE,
      action: action,
      requestId: requestId || generateId(),
      payload: payload || {},
      timestamp: new Date().toISOString()
    };

    window.parent.postMessage(envelope, '*');
    return envelope.requestId;
  }

  // Handle incoming messages from parent Agent Studio Canvas
  if (typeof window !== 'undefined') {
    window.addEventListener('message', function (event) {
      var data = event.data;
      if (!data || typeof data !== 'object' || data.source !== SOURCE) {
        return;
      }

      var action = data.action;
      var requestId = data.requestId;
      var payload = data.payload;

      // Resolve pending promise if matching requestId
      if (requestId && pendingRequests[requestId]) {
        var resolver = pendingRequests[requestId];
        delete pendingRequests[requestId];
        if (action === 'AGENT_EVENT' && payload && payload.status === 'failed') {
          resolver.reject(new Error(payload.error || 'Agent execution failed'));
        } else {
          resolver.resolve(payload);
        }
      }

      // Dispatch to registered action listeners
      if (eventListeners[action]) {
        for (var i = 0; i < eventListeners[action].length; i++) {
          try {
            eventListeners[action][i](payload, data);
          } catch (err) {
            console.error('[AgentStudioBridge] Error in event listener for action ' + action, err);
          }
        }
      }
    });
  }

  var Bridge = {
    version: '1.0.0',

    /**
     * Check if currently embedded inside Agent Studio Canvas
     */
    isEmbedded: function () {
      return typeof window !== 'undefined' && window.parent && window.parent !== window;
    },

    /**
     * Trigger an Agent Studio AI agent to run with input and optional context
     * @param {Object} options { agentNameOrId, input, context }
     * @returns {Promise<Object>}
     */
    triggerAgent: function (options) {
      return new Promise(function (resolve, reject) {
        var reqId = generateId();
        pendingRequests[reqId] = { resolve: resolve, reject: reject };
        
        var ok = postToParent('TRIGGER_AGENT', options, reqId);
        if (!ok) {
          delete pendingRequests[reqId];
          reject(new Error('Agent Studio Canvas parent window is unavailable.'));
        }
      });
    },

    /**
     * Request human approval inside Agent Studio Canvas before performing an action
     * @param {Object} options { action, summary, payload }
     * @returns {Promise<{ decision: "approved" | "rejected", reason?: string }>}
     */
    requestApproval: function (options) {
      return new Promise(function (resolve, reject) {
        var approvalId = generateId();
        pendingRequests[approvalId] = { resolve: resolve, reject: reject };

        var ok = postToParent('REQUEST_APPROVAL', {
          approvalId: approvalId,
          action: options.action,
          summary: options.summary,
          payload: options.payload || {}
        }, approvalId);

        if (!ok) {
          delete pendingRequests[approvalId];
          reject(new Error('Agent Studio Canvas parent window is unavailable.'));
        }
      });
    },

    /**
     * Push active state/context from the embedded app to Agent Studio Assistant
     * @param {Object} context { currentUrl, selectedEntity, appState }
     */
    sendContext: function (context) {
      return postToParent('SEND_CONTEXT', {
        currentUrl: (typeof window !== 'undefined' && window.location) ? window.location.href : '',
        selectedEntity: context.selectedEntity || null,
        appState: context.appState || context
      });
    },

    /**
     * Listen for agent progress/streaming/completion events
     * @param {Function} callback function(payload, envelope)
     * @returns {Function} unsubscribe function
     */
    onAgentEvent: function (callback) {
      eventListeners.AGENT_EVENT.push(callback);
      return function () {
        var idx = eventListeners.AGENT_EVENT.indexOf(callback);
        if (idx !== -1) eventListeners.AGENT_EVENT.splice(idx, 1);
      };
    },

    /**
     * Listen for presets applied by the canvas user
     * @param {Function} callback function(payload, envelope)
     * @returns {Function} unsubscribe function
     */
    onPreset: function (callback) {
      eventListeners.APPLY_PRESET.push(callback);
      return function () {
        var idx = eventListeners.APPLY_PRESET.indexOf(callback);
        if (idx !== -1) eventListeners.APPLY_PRESET.splice(idx, 1);
      };
    },

    /**
     * Send ping to verify connectivity with host canvas
     */
    ping: function () {
      return new Promise(function (resolve, reject) {
        var reqId = generateId();
        pendingRequests[reqId] = { resolve: resolve, reject: reject };
        postToParent('PING', { time: Date.now() }, reqId);
        setTimeout(function () {
          if (pendingRequests[reqId]) {
            delete pendingRequests[reqId];
            reject(new Error('Bridge ping timeout.'));
          }
        }, 3000);
      });
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Bridge;
  } else {
    global.AgentStudioBridge = Bridge;
  }
})(typeof window !== 'undefined' ? window : this);
