import { defineConfig, loadEnv } from 'vite';
import { workspaceRequest } from './server/workspace.mjs';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return {
    base: './',
    server: { host: '127.0.0.1', port: 4188, strictPort: true },
    build: { target: 'es2022' },
    plugins: [
      {
        name: 'relay-workspace',
        configureServer(server) {
          server.middlewares.use(workspaceRequest(env));
        },
        configurePreviewServer(server) {
          server.middlewares.use(workspaceRequest(env));
        },
      },
    ],
  };
});
