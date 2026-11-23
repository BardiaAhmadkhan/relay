import { defineConfig } from '@playwright/test';
import path from 'node:path';
const run=process.env.RELAY_ROUND02_RUN??'baseline';
export default defineConfig({
 testDir:path.resolve('tests'),testMatch:'round-02-mobile.spec.ts',workers:1,timeout:45000,
 expect:{timeout:7000},reporter:[['list'],['json',{outputFile:path.resolve('benchmarks/round-02/experience/'+run+'-results.json')}]],
 use:{baseURL:process.env.RELAY_UI_URL??'http://localhost:4173',browserName:'chromium',channel:'chrome',reducedMotion:'reduce',viewport:{width:390,height:844},trace:'retain-on-failure',screenshot:'only-on-failure',actionTimeout:12000},
 outputDir:path.resolve('experiments/round-02/experience/artifacts/'+run)
});