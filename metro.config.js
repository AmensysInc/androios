/* eslint-env node */
/**
 * Proxies `/api/*` to the Django dev server so Expo Web (localhost:808x) stays same-origin
 * and the browser does not block requests with CORS.
 *
 * Override backend: EXPO_PUBLIC_PROXY_BACKEND=http://127.0.0.1:8000
 */
const { getDefaultConfig } = require('expo/metro-config');
const { createProxyMiddleware } = require('http-proxy-middleware');

const projectRoot = __dirname;
const backendTarget = process.env.EXPO_PUBLIC_PROXY_BACKEND || 'http://127.0.0.1:8000';

const apiProxy = createProxyMiddleware({
  target: backendTarget,
  changeOrigin: true,
});

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

const metroMiddleware = config.server?.enhanceMiddleware;
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    const upstream = typeof metroMiddleware === 'function' ? metroMiddleware(middleware) : middleware;
    return (req, res, next) => {
      if (req.url && req.url.startsWith('/api')) {
        return apiProxy(req, res, next);
      }
      return upstream(req, res, next);
    };
  },
};

module.exports = config;
