# Focused dependency and environment review

Reviewed 2026-10-26 UTC. Scope: the five remaining npm high-severity package-tree findings, the corrected Expo/React Native version set, and the existing local vision runtime. This is a bounded dependency review, not a broad security audit or production-readiness approval.

## Outcome

**The audit still reports five high-severity entries, representing two underlying advisories. No supported, compatible package-only fix was found.** The affected copies are in Expo CLI/development and signing tooling. The application API resolves patched Zod 4.6.7. These scope findings do not make the advisories false positives or eliminate the need to resolve them before a release that exposes the affected tooling or signing paths.

No package manifest, lockfile, installed dependency, application code or model artifact was changed during this review.

## Reproducible snapshot

The unmodified npm JSON result is [dependency-audit.json](../../benchmarks/dependency-audit.json), captured at 2026-10-26 06:46:17 UTC.

- Command: `npm.cmd audit --json --cache .cache/npm`
- npm exit code: 1, indicating unresolved findings.
- Counts: high 5; critical, moderate, low and informational 0.
- Audit JSON SHA-256: `9637586725ccab7aeccb7d2814dbb507b31893f1155957677c910e74c13a5a8c`
- Reviewed lockfile SHA-256: `b282dfc1e82846d42f1205d852863acfcf4650d3754c0365dd925e317b3c623f`
- Runtime: Node 24.12.0, npm 11.7.0, Windows.
- Public network access during this review was limited to advisory/documentation and package-registry metadata. No paid provider request, image upload, package installation or model download occurred.

Installed paths and registry metadata were checked independently of the audit's suggested fix.

| Installed package | Version | Relevant dependency relationship |
|---|---:|---|
| `expo` | 57.0.31 | Pulls SDK 57 CLI; also receives propagated audit status. |
| `expo/node_modules/@expo/cli` | 57.0.32 | Depends on `node-forge ^1.3.3`, `zod ^3.25.76` and signing helper `^0.0.6`. |
| `@expo/code-signing-certificates` | 0.0.6 | Depends on `node-forge ^1.3.3`; propagated audit status. |
| `node-forge` | 1.4.0 | Underlying signature-verification advisory. |
| `expo/node_modules/zod` | 3.25.76 | Underlying collection-validation advisory. |
| Root `zod` | 4.6.7 | Application/domain validation copy; above the advisory's patched threshold. |

Thus the five entries are `expo`, `@expo/cli`, `@expo/code-signing-certificates`, `node-forge` and nested `zod`. They are not five independent vulnerabilities.

## Advisory 1: node-forge signature verification

[GHSA-86w9-cpqp-85rv / CVE-2026-85393](https://github.com/advisories/GHSA-86w9-cpqp-85rv) covers node-forge through 1.4.0 and lists no patched version. The described weakness concerns malformed nested ASN.1 data during RSA PKCS#1 v1.5 signature verification, with low-exponent RSA keys relevant to the reported forgery. This is a verification/integrity issue, not an image-decoding vulnerability.

The [upstream issue](https://github.com/digitalbazaar/forge/issues/1149) and [proposed fix](https://github.com/digitalbazaar/forge/pull/1152) were inspected. A proposed change is not equivalent to a released, compatibility-tested dependency. The npm registry still reported `node-forge` latest as 1.4.0 during this review.

Local reachability evidence:

- `node_modules/@expo/code-signing-certificates/build/main.js` calls `certificate.verify(certificate)` in `validateSelfSignedCertificate`, and `certificate.publicKey.verify(...)` in `signBufferRSASHA256AndVerify`.
- `node_modules/expo/node_modules/@expo/cli/build/src/utils/codesigning.js` invokes those helpers for configured/cached development signing information.
- `.../run/ios/codeSigning/Security.js` also imports node-forge for certificate handling.
- No application-owned import of node-forge, Expo CLI or these signing helpers was found in `server/`, `packages/` or `app/src/`. The current app configuration does not declare an `updates.codeSigningCertificate` setting.

The relevant code is therefore present and used by tooling; it must not be dismissed as wholly unreachable. The inspected certificate flow also compares keys and ordinarily signs locally generated data, which narrows some input paths. This review did not establish an exploit against this project's configuration, validate every upstream input, or execute a forged certificate. It cannot certify the tooling immune.

## Advisory 2: nested Zod collection validation

[GHSA-mrhx-c7xc-m3w5 / CVE-2023-54404](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) lists affected versions below 4.6.6 and a patch in 4.6.6. The reported impact is excessive resource consumption while validating large collections. The [maintainer fix](https://github.com/colinhacks/zod/pull/6652) changes size-bound checks before element parsing. The affected range includes the CLI's installed 3.25.76; the v4-oriented patch description is not grounds to suppress the v3 finding.

Local reachability evidence:

- CLI `DevToolsPlugin.schema.js` imports its nested Zod and defines arrays for plugin commands, parameters and output lines.
- `DevToolsPluginCliExtensionResults.js` passes parsed plugin output into `DevToolsPluginOutputSchema.safeParse`.
- `MCPDevToolsPluginCLIExtensions.js` validates extension output with the same schema.
- An output-length guard exists, but it uses V8's maximum single-string length. Its presence does not prove an appropriately small memory bound.
- Root and app resolution both point to `node_modules/zod` 4.6.7; CLI resolution points to `node_modules/expo/node_modules/zod` 3.25.76.

The project's HTTP assessment schema imports the root 4.6.7 copy. It also bounds images/disclosures/corrections, and Fastify has a request-body limit. Those facts distinguish the assessment API from the affected CLI parser; they are not a general denial-of-service guarantee. No oversized-input stress exploit was run against the shared environment.

## Safe resolution assessment

| Candidate action | Finding | Decision |
|---|---|---|
| Upgrade within SDK 57 | Registry tags currently identify Expo 57.0.31 and CLI 57.0.32, already installed. Affected dependency ranges remain. | No currently available fix established. |
| Move to SDK 58 | Latest CLI 58.1.15 metadata still declares Zod `^3.25.76` and node-forge `^1.4.0`. | A framework migration would not remove these two underlying advisories and would reopen compatibility work. |
| Upgrade root Zod | Root is already 4.6.7; a root update does not replace a nested dependency constrained to major 3. | No additional change justified. |
| Force nested Zod to major 4 | Outside CLI's declared dependency range; Zod documents breaking API/behavior changes. | Not a verified compatible fix; no override applied. |
| `npm audit fix --force` | Audit suggests Expo 54.0.38, a framework downgrade outside the current SDK 57 set. | Do not apply this suggestion as a safe remediation. |
| Pin an arbitrary node-forge PR/fork or edit vendor code | No released patched version was identified; cryptographic changes need their own reviewed source and regression evidence. | Not adopted in this preparation task. |
| Suppress findings or lower severity to pass | Would conceal the unresolved state. | Not done. |

Primary metadata: [node-forge registry](https://registry.npmjs.org/node-forge), [Expo registry](https://registry.npmjs.org/expo), [Expo CLI registry](https://registry.npmjs.org/@expo%2fcli). Compatibility boundary: [Zod 4 migration guide](https://zod.dev/v4/changelog), [Expo SDK compatibility](https://docs.expo.dev/versions/latest/).

For current local preparation, use trusted project dependencies/plugins and keep development tooling off public endpoints. Recheck maintained patched releases before event distribution, signing use or public hosting. A future API deployment should verify its actual runtime dependency artifact separately from the mobile development workspace; that packaging separation has not been implemented by this review.

The affected dependencies are marked production dependencies in npm's graph because Expo is an application dependency. **Calling their role development tooling does not mean `--omit=dev` removes them.** Do not use an omit flag as evidence that this workspace has a clean audit.

## Expo environment consistency

The root and app now resolve the same installed React 19.2.3, React DOM 19.2.3 and React Native 0.86.3 packages. The reviewed lockfile contains those versions. This independently confirms the corrected dependency resolution after the integrating agent fixed the RN 0.88 hoisting mismatch.

The integrating agent reported successful iOS, Android and web exports after the correction; this focused review did not rebuild them. Expo's version table pairs SDK 57 with React Native 0.86 and React 19.2.3. Preserve the compatible set and lockfile. An export is not an installed native binary, camera test or physical-device acceptance result.

## Vision dependency licences and reproducibility

| Component inspected | Installed or pinned identity | Licence/provenance boundary |
|---|---|---|
| Transformers.js | 4.3.1 | Apache-2.0; installed licence inspected. |
| ONNX Runtime Node | 1.30.0; common 1.30.0 | MIT package metadata and [upstream licence](https://github.com/microsoft/onnxruntime/blob/main/LICENSE); retain relevant binary/dependency notices when distributing. |
| Sharp JavaScript package | 0.35.5 | Apache-2.0. |
| Windows x64 Sharp binary package | `@img/sharp-win32-x64` 0.35.5 | **Apache-2.0 AND LGPL-3.0-or-later** in installed and [upstream package metadata](https://github.com/lovell/sharp/blob/main/npm/win32-x64/package.json). Do not describe the whole native runtime as Apache-only. |
| CLIP | Pinned Xenova conversion of upstream OpenAI model | Original repository MIT; conversion's standalone licence field absent in retrieved metadata. Keep cache excluded from source delivery; redistribution review remains open. |
| SigLIP | Pinned ONNX community graph plus original Google tokenizer | Apache-2.0 metadata; exact revisions in [model provenance](../07-computer-vision-research/model-provenance.md). |

Retain applicable licence text, attribution and notices with future binary distribution; review the actual native binary package's copyleft/source obligations before bundling it. This source/lockfile handoff keeps `node_modules/` and model caches excluded. It does not claim that every possible redistributed native binary package has received legal clearance.

The existing adapter's SHA-256 still matches the recorded 14/14 edge checks. The fixture manifest still matches the immutable vision benchmark. All ten cached model/config/tokenizer files matched their recorded byte sizes and SHA-256 values. Transformers.js remains 4.3.1. Those checks read local bytes and did not rerun inference or contact a model service.

Reproduction remains:

```powershell
npm.cmd ci --cache .cache/npm
node --import tsx scripts/fetch-fixtures.ts
node --import tsx scripts/benchmark-vision.ts
node --import tsx benchmarks/vision-adapter-checks.mjs
```

These commands are instructions, not actions executed during this review. A fresh install may run dependency lifecycle scripts and fetch native binaries; a fresh model run downloads public pinned model files. An existing complete fixture set is verified locally. The full workflow is not claimed to be air-gapped or free of network access. Pinning and hashes improve reproducibility but are not a supply-chain security certification.

## Remaining acceptance boundary

The focused review and snapshot are complete. The five npm high-severity entries remain unresolved. Native device testing, production packaging/exposure review, and any binary redistribution obligations remain separate release gates. Do not describe this experimental project as production-ready or its dependency audit as passing.

Snapshot chronology: The final lockfile may additionally include Prettier and alignment of @types/react to 19.2.4. The audit JSON and lockfile hash recorded in this review remain historical evidence of the reviewed state; the integrating agent is capturing the final audit separately. These later changes do not retroactively change this snapshot.
