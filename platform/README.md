# Relay recognition and mobile workspace

This workspace contains the V3.5 visual scorer, the inspection desk that assembles its signed results, the Expo application for Android and iOS, and the experiments that led to them. The web app and shop gateway live one directory up. Each Node workspace has its own lockfile.

## Check a fresh clone

Use Node 24.12 and npm in this directory. The test suite uses generated inputs, attributed public photos, isolated SQLite databases and provider doubles. The Expo 57 workspace pins the patched glob matcher for its native fingerprint tool.

```sh
npm ci
npm run verify
```

The gateway integration starts the production web server and the recognition desk together. From the repository root, run the following after installing this workspace.

```sh
npm ci
npm run build
npm --prefix platform run test:gateway
```

For the acquisition worker, use Python 3.10 or 3.11. For example, create a virtual environment with `python -m venv .venv`, activate it, then run the commands below. The Python checks exercise image preparation, provenance and the worker's safeguards on CPU.

```sh
python -m pip install -r requirements.txt
python -B -m unittest discover -s tests/python
python -B scripts/v4/acquire.py --help
```

## Connect the web app to a local recognition desk

1. From this directory copy `.env.example` to `.env`. Generate a unique signing key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and set `RELAY_SIGNING_KEY`. The scorer and desk use this same key. Start with empty state in `.local/inspection/items`.
2. For fresh model-backed visual analysis, run the pinned `qwen3.5:4b` checkpoint and its projector in Ollama. Set `OLLAMA_HOST=127.0.0.1:11439` in the shell that launches `ollama serve` and the shell that runs `ollama pull qwen3.5:4b`. Both Relay processes read `RELAY_OLLAMA_URL` from the example configuration. The scorer verifies the manifest and component sizes before using the model. The pinned digest and upstream notices are in [the model manifest](app/assets/offline/manifest.json) and [notices](app/assets/offline/NOTICE.txt). [Upstream distribution](https://ollama.com/library/qwen3.5:4b)
3. Start `npm run foundation` in one terminal and `npm run desk` in another, both in this directory. The scorer listens on loopback port 8788 and the desk on 8794. Set `RELAY_V4_PYTHON` to the Python executable from the virtual environment if it differs from the shell default. Fresh multi-photo acquisition uses an NVIDIA host with `nvidia-smi`. The local worker checks temperature, memory and competing workloads and serializes GPU access. You can open a fresh desk, inspect its empty notebook and complete a history-only exclusion without making a model call.
4. In the repository root, copy its separate `.env.example` to `.env`. Set `RELAY_UPSTREAM=http://127.0.0.1:8794` and `RELAY_RIDER_ACCESS=1`. Run `npm ci`, `npm run build` and `npm start`. Open `http://127.0.0.1:4188/?workspace=rider`. Staff access, workshop credentials, catalog sync and handover are described in [shop operations](../docs/shop-operations.md).
5. Check `/v2/health` on the scorer and `/v4/health` on the desk. A healthy HTTP service and a completed visual inference are different checks. Run a complete intake with your own authorized photos when bringing a model host online. For a folder-based evaluation, run `node --env-file=.env --import tsx scripts/v4/run.ts --input PATH_TO_GARMENT --out PRIVATE_OUTPUT`.

The desk's access token and the website's upstream token must match when used. Store rider uploads, generated crops, records and databases on private persistent storage. Optional paid readers require explicit provisioning and a server-side allowance. The distributed configuration starts with paid calls disabled. Use the [V3.5 host guide](docs/relay-v35-hosting.md) for the GPU worker, cost measurement and billing settings.

## Native app

From this workspace, `npm run dev:app` starts Expo. The standard API profile uses the V3.5 service. Set `EXPO_PUBLIC_RELAY_API_URL` to a phone-reachable service URL before building. A physical phone's loopback address refers to the phone itself. The field-desk profile uses `RELAY_MOBILE_PROFILE=event`, `EXPO_PUBLIC_RELAY_EVENT_DESK=1` and `EXPO_PUBLIC_RELAY_V4_API_URL`. Public client settings may contain a service URL. Staff and merchant secrets belong on the server.

Build with `npm run android --workspace app` or `npm run ios --workspace app` on a host with the corresponding native toolchain. For JavaScript bundle verification use `npm run export:mobile`. The separately reproducible offline experiment and its model license are in [the mobile implementation guide](docs/10-implementation/android-install.md).

## Source and experiments

| Location | Contents |
| --- | --- |
| `packages/core`, `packages/vision` | Contracts, policy, image processing, scorers and model pinning. |
| `server`, `scripts/v4` | Signed scoring API, inspection desk, intake queue, acquisition worker and release utilities. |
| `app`, `deploy` | Native application, native plugins, production scorer container and host tools. |
| `tests`, `experiments`, `benchmarks`, `research`, `design`, `docs` | Regression tests, study code, redistributable measurements, research and design history. Historical measurements retain their original scope and date. Some archival studies need an independently obtained corpus or a historical runtime. |
| `assets/fixtures`, `datasets` | Individually attributed examples and source manifests. [Original fixture credits](assets/fixtures/ATTRIBUTION.md) Â· [Additional fixture credits](assets/fixtures/round-02/ATTRIBUTION.md) Â· [Wear-detail credits](assets/fixtures/round-05/ATTRIBUTION.md) Â· [Image-quality derivatives](experiments/round-02/quality/ATTRIBUTION.md) |

The export includes the original Relay artwork and licensed public examples. Private albums, images embedded in event walkthroughs, personal test photographs, credential files, merchant records and downloaded model caches belong outside Git. The [asset and dependency notices](LICENSES.md) document third-party provenance.
