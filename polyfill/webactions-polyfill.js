/**
 * Web Actions polyfill.
 * Author: Matt Giuca <mgiuca@chromium.org>
 *
 * Implements a (partial) Web Actions API for demonstration purposes. Note: This
 * API, by design, does things that aren't possible in a polyfill, so this will
 * be broken without specific browser hacks. All work-in-progress; don't get too
 * excited about it.
 *
 * Note: The requester needs to set navigator.webActions.polyfillHandlerUrl to a
 * valid handler URL before calling performAction. This is a temporary
 * requirement of the polyfill and won't be part of the final API.
 */
"use strict";

(function() {

// Polyfill Cache.addAll.
// Not necessary in Chrome 45 with --enable-experimental-web-platform-features.
if (Cache.prototype.addAll === undefined) {
  Cache.prototype.addAll = function(urls) {
    return Promise.all(urls.map(url => this.add(url)));
  }
}

// A base class that implements the EventTarget interface.
class CustomEventTarget {
  constructor() {
    // Map from event type to list of listeners.
    this._listeners = {};
  }

  addEventListener(type, listener, useCapture) {
    var listeners = this._listeners;
    var listeners_of_type = listeners[type];
    if (listeners_of_type === undefined) {
      listeners[type] = listeners_of_type = [];
    }

    for (var i = 0; i < listeners_of_type.length; i++) {
      if (listeners_of_type[i] === listener)
        return;
    }

    listeners_of_type.push(listener);
  }

  removeEventListener(type, listener, useCapture) {
    var listeners = this._listeners;
    var listeners_of_type = listeners[type];
    if (listeners_of_type === undefined) {
      listeners[type] = listeners_of_type = [];
    }

    for (var i = 0; i < listeners_of_type.length; i++) {
      if (listeners_of_type[i] === listener) {
        listeners_of_type.splice(i, 1);

        if (listeners_of_type.length == 0)
          delete listeners[type];

        return;
      }
    }
  }

  dispatchEvent(evt) {
    var listeners = this._listeners;
    var listeners_of_type = listeners[evt.type];
    if (listeners_of_type === undefined) {
      listeners[evt.type] = listeners_of_type = [];
    }

    for (var i = 0; i < listeners_of_type.length; i++) {
      var listener = listeners_of_type[i];
      if (listener.handleEvent !== undefined) {
        listener.handleEvent(evt);
      } else {
        listener.call(evt.target, evt);
      }
    }
  }
}

// An Action is an object representing a web action in flight.
class Action extends CustomEventTarget {
  constructor(verb, data) {
    super();
    this.verb = verb;
    this.data = data;
  }
}

// A map from origin strings to CrossOriginServiceWorkerClient objects.
// Allows communication to a client based on the origin.
var clientMap = new Map;

// Polyfill Navigator.webActions.
// The prototype of |navigator| is Navigator in normal pages, WorkerNavigator in
// Web Workers. Support either case.
var navigator_proto =
    (self.WorkerNavigator !== undefined ? WorkerNavigator : Navigator)
        .prototype;
if (navigator_proto.webActions === undefined) {
  var webActions = {};
  navigator_proto.webActions = webActions;

  // The URL of the handler to send requests to. The final API will have the
  // user agent let the user choose a handler from a registered list. For now,
  // we just let the client specify its URL by setting this variable.
  webActions.polyfillHandlerUrl = null;

  // ActionEvent is only available when the global scope is a
  // ServiceWorkerGlobalScope.
  if (self.ExtendableEvent !== undefined) {
    webActions.ActionEvent = class extends ExtendableEvent {
      constructor(action) {
        super('action');
        this.action = action;
        // Note: These seem redundant, but I think in the final API, Action's
        // fields will be opaque, so we'll want to expose these in ActionEvent.
        this.verb = action.verb;
        this.data = action.data;
      }
    };
  }

  webActions.RequesterAction = class extends Action {
    constructor(verb, data, port) {
      super(verb, data);
      this.port = port;
    }
  }

  webActions.HandlerAction = class extends Action {
    // |client| is a CrossOriginServiceWorkerClient that this action belongs to.
    constructor(verb, data, client) {
      super(verb, data);
      this.client = client;
    }

    // Sends an updated version of the data payload associated with this action
    // back to the requester. This may be called multiple times per action, but
    // should send a complete copy of the data on each call (this is not a
    // stream protocol).
    update(data) {
      var message = {'type': 'update', 'data': data};
      this.client.postMessage(message);
    }
  };

  // Performs an action with a given |verb| and |data|. Returns a
  // Promise<Action> with an action object allowing further interaction with the
  // handler. Fails with AbortError if a connection could not be made.
  webActions.performAction = function(verb, data) {
    // Get the URL of the handler to connect to. For now, this is just a fixed
    // URL set by the client.
    var handlerUrl = webActions.polyfillHandlerUrl;
    if (handlerUrl === null) {
      throw new Error(
          'You need to set navigator.webActions.polyfillHandlerUrl ' +
          '(temporary requirement of the polyfill only).');
    }

    return new Promise((resolve, reject) => {
      // Connect to the handler.
      navigator.services.connect(handlerUrl)
          .then(port => {
            var action = new webActions.RequesterAction(verb, data, port);

            // Send the verb and data payload to the handler.
            var message = {'type': 'action', 'verb': verb, 'data': data};
            port.postMessage(message);

            resolve(action);
          }, err => reject(err))
    });
  };
}

// Called when a message is received (on both the host and client).
// |client| is a CrossOriginServiceWorkerClient on the host; null on the client.
function onMessageReceived(data, client) {
  if (data.type == 'action') {
    if (webActions.ActionEvent === undefined)
      throw new Error('Web Actions requests must go to a service worker.');

    var action = new webActions.HandlerAction(data.verb, data.data, client);

    // Forward the event as an 'action' event to the global object.
    var actionEvent = new webActions.ActionEvent(action);
    self.dispatchEvent(actionEvent);
  } else {
    console.log('Received unknown message:', data);
  }
}

// XXX: The 'connect' event on navigator.services is the currently specified way
// for the host to receive a connection, but in Chrome 45 it receives
// 'crossoriginconnect' instead (see below).
/*
navigator.services.addEventListener('connect', event => {
  console.log('navigator.services: Received connect event for ' +
              event.targetURL + ' from ' + event.origin);
  event.respondWith({accept: true, name: 'the_connecter'})
      .then(port => port.postMessage('You are connected!'));
});
*/

// XXX: The 'message' event on navigator.services is the specified way to
// receive messages on both ends. In Chrome 45, only the client receives
// messages with this event. The host receives 'crossoriginmessage' instead (see
// below).
navigator.services.addEventListener('message', event => {
  onMessageReceived(event.data);
});

// XXX In Chrome 45, the host's global object receives 'crossoriginconnect' and
// 'crossoriginmessage' events, instead of the above. (This is from an older
// version of the spec.)
self.addEventListener('crossoriginconnect', event => {
  console.log('global: Received crossoriginconnection on self:', event);
  event.acceptConnection(true);
  var client = event.client;
  clientMap.set(client.origin, client);
  client.postMessage('You are connected!');
});

self.addEventListener('crossoriginmessage', event => {
  var origin = event.origin;
  if (!clientMap.has(event.origin))
    throw new Error('Received message from unknown origin ' + origin);

  var client = clientMap.get(event.origin);
  onMessageReceived(event.data, client);
});

})();
