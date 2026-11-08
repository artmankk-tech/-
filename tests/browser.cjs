// 実行: ローカルHTTPサーバーを起動して node tests/browser.cjs
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const executablePath=process.env.CHROMIUM_PATH||(require('node:fs').existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
 const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:320,height:740},isMobile:true,hasTouch:true});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',d=>d.type()==='prompt'?d.dismiss():d.accept());
 await page.goto('http://127.0.0.1:8000');await page.evaluate(()=>navigator.serviceWorker.ready);
 const result=await page.evaluate(()=>{
  function ok(v,msg){if(!v)throw Error(msg)}
  const legacy=initial();const yesterday=dateOffset(-1);legacy.work.days[yesterday]={done:['w0'],bonus:5,restarts:1,timer:0,claimed:[]};
  data=migrate(legacy);save();render();ok(total('work')===15,'v1 migration');
  data.work.tasks[0].xp=20;ok(total('work')===15,'edit keeps historical XP');
  deleteTask('w0');ok(total('work')===15,'delete keeps historical XP');
  toggleTask('w1');ok(total('work')===35,'complete');toggleTask('w1');ok(total('work')===15,'undo');
  switchMode('life');ok(total('life')===0,'separate XP');toggleTask('l0');ok(total('life')===20,'life XP');
  setDuration('900');toggleTimer();switchMode('work');ok(timers.life.end!==null&&timers.work.end===null,'separate timers');
  timers.life.end=Date.now()-100;tickTimers();ok(total('life')===30&&total('work')===15,'timer attributed');
  timers.life.end=Date.now()-100;timers.life.date=yesterday;tickTimers();ok(total('life')===30,'overnight no reward');
  switchMode('life');for(let i=0;i<4;i++)addBonus();ok(total('life')===45,'restart cap');
  const copy=JSON.parse(JSON.stringify(data));validate(copy);copy.work.tasks[0].id="x');alert(1)//";let rejected=false;try{validate(copy)}catch{rejected=true}ok(rejected,'unsafe ID rejected');
  const bad=JSON.parse(JSON.stringify(data));bad.work.days[yesterday].awards.w0=-1;rejected=false;try{validate(bad)}catch{rejected=true}ok(rejected,'invalid XP rejected');
  save();return {work:total('work'),life:total('life')};
 });
 await page.reload();assert.deepEqual(await page.evaluate(()=>({work:total('work'),life:total('life')})),result);
 // 実際のJSONファイル入力から復元し、再起動後も保持される。
 const backup=await page.evaluate(()=>JSON.stringify({version:2,data}));
 await page.evaluate(()=>{data=migrate(initial());save();render()});
 await page.locator('#importFile').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(backup)});
 await page.waitForFunction(()=>total('life')===45);
 await page.reload();assert.equal(await page.evaluate(()=>total('life')),45);
 await page.locator('#importFile').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"version":2,"data":{}}')});
 await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>total('life')),45);
 const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'JSONバックアップ',exact:true}).click();const download=await downloadEvent;assert.match(download.suggestedFilename(),/^quest-backup-/);
 for(const width of [320,375,390,430]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no overflow '+width);}
 await page.reload();await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
 await context.setOffline(true);await page.reload();assert.equal(await page.title(),'QUEST｜習慣と仕事のRPG');assert.equal(await page.evaluate(()=>total('life')),45);await page.locator('#lifeTab').click();await page.locator('.check').first().click();
 assert.deepEqual(errors,[]);console.log('PASS: migration, historical XP, modes, timer attribution/date, bonus cap, validation, persistence, JSON restore/export, 320–430px layout, offline reload/edit');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
