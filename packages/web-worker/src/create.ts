import {createEndpoint, Endpoint, MessageEndpoint} from '@shopify/rpc';

import {createWorkerMessenger} from './messenger';

const workerEndpointCache = new WeakMap<Endpoint<any>['call'], Endpoint<any>>();

export function expose(
  caller: any,
  api: {[key: string]: Function | undefined},
) {
  const endpoint = getEndpoint(caller);
  return endpoint && endpoint.expose(api);
}

export function terminate(caller: any) {
  const endpoint = getEndpoint(caller);
  if (endpoint) {
    endpoint.terminate();
  }

  workerEndpointCache.delete(caller);
}

export function getEndpoint(caller: any) {
  return workerEndpointCache.get(caller);
}

export interface CreateWorkerOptions {
  createMessenger?(url: URL): MessageEndpoint;
}

export function createWorkerFactory<T>(script: () => Promise<T>) {
  return function createWorker({
    createMessenger = createWorkerMessenger,
  }: CreateWorkerOptions = {}): Endpoint<T>['call'] {
    // The babel plugin that comes with this package actually turns the argument
    // into a string (the public path of the worker script). If it’s a function,
    // it’s because we’re in an environment where we didn’t transform it into a
    // worker. In that case, we can use the fact that we will get access to the
    // real module and pretend to be a worker that way.
    if (typeof script === 'function') {
      return new Proxy(
        {},
        {
          get(_target, property) {
            return async (...args: any[]) => {
              const module = await script();
              return module[property](...args);
            };
          },
        },
      ) as any;
    }

    // If we aren’t in an environment that supports Workers, just bail out
    // with a dummy worker that throws for every method call.
    if (typeof window === 'undefined') {
      return new Proxy(
        {},
        {
          get(_target, _property) {
            return () => {
              throw new Error(
                'You can’t call a method on a worker on the server.',
              );
            };
          },
        },
      ) as any;
    }

    const scriptUrl = new URL(script, window.location.href);
    const endpoint = createEndpoint(createMessenger(scriptUrl));
    const {call: caller} = endpoint;

    workerEndpointCache.set(caller, endpoint);

    return caller as any;
  };
}