import path from 'node:path';
import { createDesk } from './desk';
import { registerIntake } from './intake';
const root = path.resolve(process.env.RELAY_V4_DATA ?? '.local/inspection/items');
const key = process.env.RELAY_SIGNING_KEY ?? '';
const host = process.env.RELAY_V4_HOST ?? '127.0.0.1';
const demo = process.env.RELAY_V4_DEMO === '1';
const token = process.env.RELAY_V4_ACCESS_TOKEN,
  operatorKey = process.env.RELAY_V4_OPERATOR_KEY;
if (
  host !== '127.0.0.1' &&
  host !== 'localhost' &&
  (!token || token.length < 32 || !operatorKey || operatorKey.length < 32 || demo)
)
  throw Error('Network operation requires access controls and the live staff role.');
const api = createDesk({
  key,
  root,
  dbPath: path.join(path.dirname(root), demo ? 'desk-scenario.sqlite' : 'desk-operative.sqlite'),
  operatorKey,
  accessToken: token,
  demo,
});
registerIntake(api, { root, key, python: process.env.RELAY_V4_PYTHON ?? 'python' });
const port = Number(process.env.RELAY_V4_PORT ?? 8794);
await api.app.listen({ host, port });
console.log('Relay V4 field desk listening on ' + host + ':' + port + '; demo=' + demo);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void api.app.close().then(() => process.exit(0));
  });
