import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { setTimeout as delay } from 'node:timers/promises';
const root='datasets/quality-cycle-02';await fs.mkdir(root+'/images',{recursive:true});
const prior=JSON.parse(await fs.readFile('datasets/quality-audit-01/labels.json','utf8')).cases;
const priorHashes=new Set(prior.map(c=>c.sha256));const pages=new Map();
for(const n of ['commons-candidates','commons-specific-candidates'])for(const p of JSON.parse(await fs.readFile('experiments/quality-audit-01/'+n+'.json','utf8')).pages)pages.set(p.pageid,p);
const ids=[10799067,10799076,72671196,72671227,2169686,3267416,6626981,22494375,67515610,94683916,8570667,42145567,17486457,22408341,65249319,128687747,36158955,61855864,146007181,63472334,63472375,180466730,180466734,83504508];
await fs.writeFile('experiments/quality-cycle-02/fresh-selection.json',JSON.stringify({at:new Date().toISOString(),authorization:'User explicitly approved adding up to 64 licensed Relay validation images after the scope-review rejection.',selection:'24 additional source-title selected Commons photographs plus 10 unused original fabric images per publisher class from the same seeded eligible pool. Freeze visual labels before candidate inference. Related views and same-source material samples are not independent field data.',commonsIds:ids,fabricPerClass:10},null,2)+'\n',{flag:'wx'});
const plain=s=>String(s??'').replace(/<[^>]*>/g,'').replaceAll('&amp;','&').replaceAll('&#39;',"'").trim();const records=[],excluded=[];
for(const [i,id]of ids.entries()){
 const p=pages.get(id),info=p.imageinfo[0],meta=info.extmetadata;const license=plain(meta.LicenseShortName?.value),licenseUrl=plain(meta.LicenseUrl?.value).replace(/^http:/,'https:');
 try{
 if(!/^(CC BY-SA [234]\.0|CC BY [234]\.0|CC0)$/.test(license)||!licenseUrl.startsWith('https://creativecommons.org/'))throw Error('Unresolved licence');
 const url=info.thumburl??info.url;const response=await fetch(url,{headers:{'User-Agent':'RelayQualityResearch/1.0 (local licensed evaluation)'},signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Download HTTP '+response.status);
 const raw=Buffer.from(await response.arrayBuffer());const bytes=await sharp(raw).rotate().resize({width:960,height:960,fit:'inside',withoutEnlargement:true}).jpeg({quality:92}).toBuffer();const sha256=crypto.createHash('sha256').update(bytes).digest('hex');if(priorHashes.has(sha256))throw Error('Already in audit corpus');
 const cid='fresh-commons-'+String(i+1).padStart(3,'0'),file=root+'/images/'+cid+'.jpg';await fs.writeFile(file,bytes,{flag:'wx'});const m=await sharp(bytes).metadata();records.push({id:cid,file,pageId:id,title:p.title,source:info.descriptionurl,downloadUrl:url,author:plain(meta.Artist?.value),license,licenseUrl,revision:p.revisions?.[0]?.revid,sha256,width:m.width,height:m.height,domain:'garments_and_gear',group:'commons-'+id,history:'unknown',transform:'Orientation normalized, longest edge <=960, JPEG92; no generated imagery.'});
 }catch(e){excluded.push({pageId:id,error:e.message});}await delay(600);
}
const base='.cache/phone-training/fabric/FD_Dataset',pool=[];const usedNames=new Set(prior.map(c=>c.originalFile));
for(const split of ['train','valid','test'])for(const name of await fs.readdir(base+'/YOLO/'+split+'/labels')){
 const annotations=(await fs.readFile(base+'/YOLO/'+split+'/labels/'+name,'utf8')).trim().split(/\r?\n/).filter(Boolean).map(x=>x.split(/\s+/).map(Number));const classes=[...new Set(annotations.map(a=>a[0]))];if(classes.length!==1)continue;const originalName=name.replace(/_jpg\.rf\.[a-f0-9]+\.txt$/,'.jpg'),file=base+'/FD/FULLDataset/'+originalName;if(usedNames.has(originalName))continue;try{await fs.access(file);}catch{continue;}pool.push({file,originalName,publisherClass:classes[0],group:'fd-capture-'+originalName.match(/photo_(\d{4}-\d{2}-\d{2})/)?.[1],key:crypto.createHash('sha256').update('audit-20261026:'+originalName).digest('hex')});
}
for(let cls=0;cls<4;cls++)for(const [i,c]of pool.filter(c=>c.publisherClass===cls).sort((a,b)=>a.key.localeCompare(b.key)).slice(0,10).entries()){
 const bytes=await fs.readFile(c.file),sha256=crypto.createHash('sha256').update(bytes).digest('hex');if(priorHashes.has(sha256))throw Error('Duplicate fabric');const id='fresh-fabric-'+String(cls*10+i+1).padStart(3,'0'),file=root+'/images/'+id+'.jpg';await fs.writeFile(file,bytes,{flag:'wx'});const m=await sharp(bytes).metadata();records.push({id,file,originalFile:c.originalName,publisherClass:cls,group:c.group,source:'https://doi.org/10.6084/m9.figshare.25546465.v2',author:'Osamah N. Neamah',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',sha256,width:m.width,height:m.height,domain:'fabric_closeup',history:'unknown',transform:'Original source pixels; no annotations or class information passed to inference.'});
}
await fs.writeFile('experiments/quality-cycle-02/fresh-acquisition.json',JSON.stringify({at:new Date().toISOString(),records,excluded},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({acquired:records.length,excluded}));