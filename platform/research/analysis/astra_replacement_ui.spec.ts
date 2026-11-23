import {test, expect, type Page} from '@playwright/test';
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {CLEAN_ITEM,stubScorer} from '../../server/stub-scorer';
import {createAppV2} from '../../server/app-v2';
import {ScorerChain} from '../../packages/vision/v2/scorer-chain';
import type {Scorer} from '../../packages/vision/v2/scorer';
import {ThresholdsSchema,PolicyConfigSchema} from '../../packages/core/v2/schema';
import t from '../../packages/core/v2/thresholds.json';
import c from '../../packages/core/v2/policy.config.json';
const root=process.cwd(),fixture=path.join(root,'assets/fixtures');
const url='http://127.0.0.1:8790';let app:ReturnType<typeof createAppV2>,original='',level=0;
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
test.beforeAll(async()=>{const local:Scorer={id:'local_logprob',model:'controlled-ui-witness',async score(photo,qs,signal){
const idx=hash(photo.jpeg);if(photo.view==='front'&&!original)original=idx;
return stubScorer({answers:{...CLEAN_ITEM,road_contact:photo.view==='front'&&idx===original?level:0.01},delayMs:0}).score(photo,qs,signal);}};
app=createAppV2({chain:new ScorerChain([local],{cacheTtlMs:0}),signingKey:'experimental-browser-key-for-replacement-000',thresholds:ThresholdsSchema.parse(t),config:PolicyConfigSchema.parse(c),workingEdge:1024});await app.listen({host:'127.0.0.1',port:8790});});
test.afterAll(async()=>{await app?.close();});
async function photograph(page:Page,view:string,file:string){
await page.getByRole('button',{name:new RegExp('^'+view+' photo (needed|captured)$')}).click();
const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Choose a photograph',exact:true}).click();await(await chooser).setFiles(path.join(fixture,file));await expect(page.getByRole('button',{name:view+' photo captured',exact:true})).toBeVisible();
}
for(const scenario of ['possible-detail','possible-replace','block-replace']){
test(scenario,async({page})=>{original='';level=scenario==='block-replace'?.95:.35;
await page.goto('/');await page.getByRole('button',{name:'Connection and privacy settings'}).click();await page.getByLabel('Analysis service URL',{exact:true}).fill(url);
await page.getByRole('button',{name:'Save and check connection'}).click();await expect(page.getByText(/Connected · Relay v2/)).toBeVisible();await page.getByRole('button',{name:'Go back',exact:true}).click();
await page.getByRole('button',{name:'Start a gear check',exact:true}).click();await page.getByRole('button',{name:'Add item history',exact:true}).click();
for(const q of ['Has it been worn in a crash?','Any damage in a protective area?','Any repairs in a protective area?'])await page.getByRole('radio',{name:q+' No',exact:true}).click();
await page.getByRole('button',{name:'Continue to photos'}).click();
for(const [v,f] of [['Front','leather-jacket.jpg'],['Back','armour-jacket.jpg'],['Label','backpack-label.jpg']])await photograph(page,v!,f!);
const consent=()=>page.getByRole('checkbox',{name:'Allow these photos to be processed by the selected Relay service'}).check();
const assess=async()=>{const res=page.waitForResponse(r=>r.url().endsWith('/v2/assess'));await page.getByRole('button',{name:'Review the evidence'}).click();const r=await res;expect(r.status()).toBe(200);const data=await r.json(),sent=r.request().postDataJSON();return {decision:data.decision,photos:sent.photos.map((p:{id:string;sha256:string;view:string})=>({id:p.id,sha256:p.sha256,view:p.view})),history:sent.disclosures.map((d:{answer:string})=>d.answer)};};
await consent();const before=await assess();expect(before.decision.outcome).toBe(scenario==='block-replace'?'no_offer':'retake');
if(scenario==='possible-detail'){await page.getByRole('button',{name:'Take the close-up photo'}).click();await photograph(page,'Detail','gloves-palm.jpg');}
else {
 await page.getByRole('button',{name:'Back to your notebook'}).click();await page.reload();await page.getByRole('button',{name:'Continue your gear check',exact:true}).first().click();
 await photograph(page,'Front','racing-boot.jpg');await consent();
}
const after=await assess();expect(after.decision.outcome).toBe(scenario==='possible-detail'?'review':'offer');expect(after.history).toEqual(before.history);
fs.mkdirSync(process.env.RELAY_WITNESS_OUT!,{recursive:true});fs.writeFileSync(path.join(process.env.RELAY_WITNESS_OUT!,scenario+'.json'),JSON.stringify({scenario,provenance:'Actual restored app and HTTP policy on fixed controlled photo probabilities; not a model accuracy observation.',before,after},null,2));
});}