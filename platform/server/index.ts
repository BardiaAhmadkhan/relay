import { createLocalInspectionAdapter } from '../packages/vision/inspection';
import { createApp } from './app';
import { createLocalAdapter } from '../packages/vision/local';
import { OpenAIVisionAdapter } from '../packages/vision/openai';
const kind = process.env.RELAY_PROVIDER ?? 'local_vlm';
const host = process.env.RELAY_HOST ?? '127.0.0.1';
const token = process.env.RELAY_ACCESS_TOKEN;
if (host !== '127.0.0.1' && host !== 'localhost' && (!token || token.length < 24))
  throw new Error(
    'LAN hosting needs a strong RELAY_ACCESS_TOKEN of at least 24 characters. Use TLS for private photos.',
  );
if (kind === 'openai' && process.env.RELAY_ALLOW_PAID !== '1')
  throw new Error(
    'Paid provider disabled. Explicitly configure RELAY_ALLOW_PAID only after authorizing charges.',
  );
if (!['local_clip', 'local_siglip', 'local_vlm', 'openai'].includes(kind))
  throw new Error('Unsupported provider');
const adapter =
  kind === 'openai'
    ? new OpenAIVisionAdapter(process.env.OPENAI_MODEL ?? '', process.env.OPENAI_API_KEY ?? '')
    : kind === 'local_vlm'
      ? await createLocalInspectionAdapter(
          process.env.RELAY_LOCAL_MODEL,
          process.env.RELAY_OLLAMA_URL,
        )
      : createLocalAdapter(kind as 'local_clip' | 'local_siglip');
const app = createApp({ adapter, token });
const address = await app.listen({ host, port: Number(process.env.RELAY_PORT ?? 8787) });
console.log(
  JSON.stringify({
    event: 'service_ready',
    address,
    provider: adapter.id,
    model: adapter.model,
    imagesLogged: false,
  }),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
