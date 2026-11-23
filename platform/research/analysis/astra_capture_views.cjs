const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('@playwright/test');
const [rootdir,outdir]=process.argv.slice(2),root=path.resolve(rootdir),out=path.resolve(outdir);
fs.mkdirSync(out,{recursive:true});
const types={'.html':'text/html','.js':'application/javascript','.png':'image/png','.jpg':'image/jpeg','.ttf':'font/ttf'};
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://127.0.0.1'),p=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!p.startsWith(root+path.sep)||!fs.existsSync(p)){res.writeHead(404).end();return;}res.setHeader('content-type',types[path.extname(p)]||'application/octet-stream');fs.createReadStream(p).pipe(res);});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});try{
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,reducedMotion:'reduce'});await page.goto('http://127.0.0.1:'+server.address().port);
await page.getByRole('button',{name:'Start a gear check',exact:true}).click();
for(const [v,f] of [['Front','leather-jacket.jpg'],['Back','armour-jacket.jpg'],['Label','backpack-label.jpg'],['Detail','gloves-palm.jpg']]){
await page.getByRole('button',{name:new RegExp('^'+v+' photo (needed|captured)$')}).click();const ch=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Choose a photograph',exact:true}).click();await(await ch).setFiles(path.resolve('assets/fixtures',f));
await page.getByRole('button',{name:v+' photo captured',exact:true}).waitFor();
if(await page.getByRole('button',{name:/Mark an area|Adjust marked area|Save marked area|Start at centre/i}).count())throw Error('Area editor still present');
await page.screenshot({path:path.join(out,'capture-'+v.toLowerCase()+'.png'),fullPage:true});
}console.log('Captured front, back, label and detail after individual real image imports.');}finally{await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;server.close();});