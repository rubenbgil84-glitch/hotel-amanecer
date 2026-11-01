import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const { GATEWAY_PORT = '3000', BACKEND_PORT = '4000' } = process.env;
const app = express();
app.disable('x-powered-by');

app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  req.headers['x-hotel-client-ip'] = req.socket.remoteAddress ?? 'unknown';
  next();
});
app.get('/gateway/health', (_req, res) => res.json({ ok: true }));

// Todo lo que empiece por /api se reenvía al backend. Aquí puedes añadir
// autenticación, límites de peticiones o caché antes de llegar al backend.
app.use(createProxyMiddleware({
  target: `http://127.0.0.1:${BACKEND_PORT}`,
  pathFilter: '/api',
  changeOrigin: true,
  on: {
    error: (_err, _req, res) => {
      if (typeof res.writeHead !== 'function') return;
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ errors: ['El servicio no responde. Inténtalo en unos segundos.'] }));
    },
  },
}));

app.use((_req, res) => res.status(404).json({ errors: ['Ruta no encontrada.'] }));

app.listen(Number(GATEWAY_PORT), () => console.log(`Gateway en :${GATEWAY_PORT} → backend :${BACKEND_PORT}`));
