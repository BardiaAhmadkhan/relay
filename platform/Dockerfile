FROM node:24.12.0-bookworm-slim@sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99 AS api
WORKDIR /opt/relay
COPY deploy/package.json deploy/package-lock.json ./
RUN npm ci --omit=dev --include=optional --no-audit --no-fund && node -e "require('sharp'); require('node:sqlite')"
COPY deploy/serve.mjs deploy/billing.mjs ./deploy/
COPY packages/core ./packages/core
COPY packages/vision/v2 ./packages/vision/v2
COPY server ./server
COPY scripts/v35-budget.ts ./scripts/v35-budget.ts
ENV NODE_ENV=production RELAY_HOST=0.0.0.0 RELAY_PORT=8788 RELAY_R2_LEDGER=/workspace/relay/allowance.sqlite RELAY_VERDICTS_FILE=/workspace/relay/verdicts.jsonl
EXPOSE 8788
RUN node --import tsx -e "Promise.all([import('sharp'),import('node:sqlite'),import('./server/app-v2.ts'),import('./server/gpu-rpc.ts')]).catch(e=>{console.error(e.message);process.exit(1)})"
HEALTHCHECK --start-period=15s --interval=30s --timeout=5s --retries=3 CMD ["node","-e","fetch('http://127.0.0.1:8788/v2/health',{headers:{'X-Relay-Token':process.env.RELAY_ACCESS_TOKEN||''}}).then(async r=>{const x=await r.json();if(!r.ok||x.engineRelease!=='3.5'||(process.env.RELAY_R2_ENABLED==='1'&&x.processingNotice!=='terms'))process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["node","--import","tsx","server/index-v2.ts"]

FROM ollama/ollama:0.40.16@sha256:910d0d8107b538fb0894e63163eb195de0cc7aefcbc666dc62d3b18f71124592 AS standalone
WORKDIR /opt/relay
COPY --from=api /usr/local/bin/node /usr/local/bin/node
COPY --from=api /opt/relay /opt/relay
ENV NODE_ENV=production RELAY_HOST=0.0.0.0 RELAY_PORT=8788 OLLAMA_MODELS=/workspace/relay/models RELAY_PULL_IF_MISSING=1 RELAY_R2_LEDGER=/workspace/relay/allowance.sqlite RELAY_VERDICTS_FILE=/workspace/relay/verdicts.jsonl
EXPOSE 8788
RUN node --import tsx -e "Promise.all([import('sharp'),import('node:sqlite'),import('./server/app-v2.ts'),import('./server/gpu-rpc.ts')]).catch(e=>{console.error(e.message);process.exit(1)})"
ENTRYPOINT ["/usr/local/bin/node","--import","tsx","deploy/serve.mjs"]

FROM standalone AS worker
# Download and verify the exact release weights once at image build time. A new worker reads its image layer.
ENV OLLAMA_MODELS=/opt/relay-weights
RUN RELAY_BACKEND_ROLE=bake RELAY_PULL_IF_MISSING=1 node --import tsx deploy/serve.mjs
ENV RELAY_BACKEND_ROLE=gpu RELAY_PULL_IF_MISSING=0 PORT=8080 PORT_HEALTH=8081
EXPOSE 8080 8081
HEALTHCHECK --start-period=180s --interval=15s --timeout=3s CMD ["node","-e","fetch('http://127.0.0.1:'+(process.env.PORT_HEALTH||8081)+'/ping').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"]
