// Arranca Angular en el puerto definido en .env; el proxy de Angular apunta al gateway.
import { spawn } from 'node:child_process';

const port = process.env.FRONTEND_PORT ?? '4200';
spawn('npx', ['ng', 'serve', '--port', port, '--proxy-config', 'proxy.conf.js'], {
  cwd: new URL('../frontend', import.meta.url),
  stdio: 'inherit',
  shell: true,
  env: process.env,
}).on('exit', (code) => process.exit(code ?? 0));
