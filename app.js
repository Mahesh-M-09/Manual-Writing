'use strict';
/* Works Capture — milestone 1
   Local-only (IndexedDB). No network calls, no account connections.
   Library of manuals · reliable save/reopen · WM numbering · tablet picture editor
   Works Manual, TWP and VA · Word and PDF export. */

const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const uid=()=>(crypto.randomUUID?crypto.randomUUID():'id-'+Date.now().toString(36)+Math.random().toString(36).slice(2));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const ukDate=d=>d&&/^\d{4}-\d{2}-\d{2}$/.test(d)?d.split('-').reverse().join('/'):(d||'');
const lines=t=>String(t||'').split('\n').map(x=>x.replace(/^\s*[•*-]\s*/,'').trim()).filter(Boolean);

/* ---------- constants ---------- */
const AREAS=['Brazing','Assembly','Paint','Digital','Inspection / Other'];
const DEFAULT_CODES={Paint:'PT'};
const extraDefs={
  support:['Support info','Useful supporting information for the operator.'],
  safety:['Safety point','Hazard and approved precaution for this step.'],
  quality:['Quality point','State the quality requirement and acceptance criteria.'],
  settings:['Torque / setting','Value and unit, e.g. 8Nm'],
  exception:['If it goes wrong','What triggers it, who acts, when work may continue.'],
  variant:['Variant','Which product this applies to and what changes.']
};
const SWATCHES=['#FF0000','#00B050','#FFE500','#0070C0','#FFFFFF','#000000'];
const BUILTIN_TEMPLATES=[
 {id:'wm',name:'Works Manual',desc:'Full works manual · safety, quality and procedure',chapters:[{title:'Procedure chapter',steps:['New step']}]},
 {id:'twp',name:'TWP',desc:'Temporary Work Procedure · dates, approvals and training',chapters:[{title:'Procedure chapter',steps:['New step']}]},
 {id:'va',name:'VA',desc:'Visual Aid · pictures, notes and tables',chapters:[{title:'Visual aid',steps:['New panel']}]}
];

/* ---------- symbols ---------- */
const SYMS=window.WC_SYMBOLS||[]; const symById=id=>SYMS.find(s=>s.id===id);
const symImgs=new Map(); let symbolsReady;
function preloadSymbols(){symbolsReady=Promise.all(SYMS.map(s=>new Promise(r=>{const im=new Image();im.onload=()=>{symImgs.set(s.id,im);r()};im.onerror=r;im.src=s.src})));return symbolsReady}

/* ---------- state ---------- */
let db,settings={areaCodes:{...DEFAULT_CODES},author:'',draftMark:true,templates:[],lastOpen:null},index={};
let project=null,baseRev=0,current=null,page='library',saveTimer=null,saveChain=Promise.resolve(),dirty=false;
let recorder=null,stream=null,recordStep=null;
const canvas=$('#annotation-canvas'),ctx=canvas.getContext('2d');
let edPhoto=null,edHistory=new Map(),tool='select',selected=null,imageCache=null,gesture=null,cropRect=null,edColor='#FF0000',edWidth=6,stampId='mk-tick';

/* ---------- helpers ---------- */
function toast(t,ms=4200){$('#toast').textContent=t;$('#toast').hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>$('#toast').hidden=true,ms)}
function fileData(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(Error('Could not read this file'));r.readAsDataURL(file)})}
function loadImage(src){return new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=()=>rej(Error('This picture format could not be opened. Try JPEG or PNG.'));im.src=src})}
function dataBytes(data){return Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0))}
function dataBlob(data){const m=data.match(/^data:([^;,]+)/);return new Blob([dataBytes(data)],{type:m?m[1]:'application/octet-stream'})}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000)}
function confirmAction(title,message,ok='Continue'){return new Promise(res=>{$('#confirm-title').textContent=title;$('#confirm-message').textContent=message;$('#confirm-dialog').querySelector('[value=yes]').textContent=ok;$('#confirm-dialog').showModal();$('#confirm-dialog').onclose=()=>res($('#confirm-dialog').returnValue==='yes')})}
function askName(title,label,value=''){return new Promise(res=>{$('#dialog-title').textContent=title;$('#dialog-label').firstChild.textContent=label;$('#chapter-name').value=value;$('#name-dialog').showModal();$('#chapter-name').select();$('#name-dialog').onclose=()=>res($('#name-dialog').returnValue==='save'?$('#chapter-name').value.trim():null)})}
const pad3=n=>String(parseInt(n,10)||0).padStart(3,'0');
function buildNumber(d){return `${({wm:'WM',twp:'TWP',va:'VA'})[d.documentType]||'WM'}.${(d.areaCode||'XX').toUpperCase()}.${d.seq?pad3(d.seq):'XXX'}.V${d.revision||'1.0'}`}
function filename(p=project){return(p.details.number||p.details.title||'works-manual').replace(/[^a-z0-9_.-]/gi,'-').slice(0,80)}

/* ---------- model ---------- */
function step(title='New step',action=''){return {id:uid(),title,type:'action',action,result:'',support:'',quality:'',qualityChecks:'',safety:'',settings:'',exception:'',variant:'',enabled:[],ppe:[],photos:[],media:[],tables:[]}}
function blankDetails(){return {documentType:'wm',paperSize:'A4',orientation:'portrait',startDate:'',endDate:'',productionName:'',productionDate:'',qualityName:'',qualityDate:'',trainingBy:'',trainingDates:'',operators:'',instructionKind:'New',affectedManuals:'',title:'Untitled Works Manual',number:'',area:'Paint',areaCode:settings.areaCodes.Paint||'',seq:'',revision:'1.0',reason:'First Issue',author:settings.author||'',date:today(),line:'',product:'All',type:'All',appVersion:'All',mark:'',speed:'-',variants:'-',scope:'',overview:'',previousVersions:'None, first issue.',hazards:[],mandatory:[],advisory:'',safety:'',risk:'N/A',quality:'',qualityChecks:'',workspaceNote:'The following picture is a workspace example for this procedure.',cover:null,workspace:null}}
function newManual(tpl){
  const d=blankDetails();d.documentType=tpl?.id||'wm';d.title='Untitled '+(tpl?.name||'Works Manual');
  const p={format:'works-capture',version:2,id:uid(),created:Date.now(),updated:Date.now(),saveRev:0,templateId:tpl?.id||'blank',details:d,chapters:[]};
  for(const c of (tpl?.chapters||BUILTIN_TEMPLATES[0].chapters))p.chapters.push({id:uid(),title:c.title,steps:(c.steps.length?c.steps:['']).map(t=>step(t||'New step'))});
  d.hazards=[...(tpl?.hazards||[])];d.mandatory=[...(tpl?.mandatory||[])];
  if(d.areaCode)d.seq=nextSeq(d.areaCode);d.number=buildNumber(d);
  return p;
}
function nextSeq(code){let max=0;for(const e of Object.values(index)){const m=String(e.number||'').match(/^(?:WM|TWP|VA)\.([A-Z0-9]+)\.(\d+)\./i);if(m&&m[1].toUpperCase()===String(code).toUpperCase()&&(!project||e.id!==project.id))max=Math.max(max,+m[2])}return pad3(max+1)}

const reImg=/^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=\r\n]+$/i;
function checkPhoto(pic,idCheck){
  idCheck(pic.id);
  if(!reImg.test(pic.src)||!reImg.test(pic.original)||!Number.isFinite(pic.width)||!Number.isFinite(pic.height)||pic.width<1||pic.height<1||pic.width>6000||pic.height>6000||!Array.isArray(pic.marks)||pic.marks.length>2000)throw Error('Invalid picture.');
  if(typeof pic.caption!=='string')pic.caption='';if(typeof pic.name!=='string')pic.name='picture';
  for(const m of pic.marks){idCheck(m.id);
    if(!['box','arrow','pen','highlight','number','circle','text','torque','stamp'].includes(m.type)||!/^#[a-f0-9]{6}$/i.test(m.color)||!Number.isFinite(m.width)||m.width<1||m.width>30)throw Error('Invalid annotation.');
    if(typeof m.note!=='string')m.note='';if(m.text!==undefined&&typeof m.text!=='string')throw Error('Invalid annotation text.');
    if(m.type==='stamp'&&!symById(m.sym))m.sym='mk-tick';
    const pts=m.points||[{x:m.x,y:m.y},{x:m.x2??m.x,y:m.y2??m.y}];
    if(!Array.isArray(pts)||!pts.length||pts.length>100000||pts.some(q=>!Number.isFinite(q.x)||!Number.isFinite(q.y)||q.x<-0.01||q.x>1.01||q.y<-0.01||q.y>1.01))throw Error('Invalid annotation position.');
    if(m.type==='number'&&(!Number.isInteger(m.number)||m.number<1))throw Error('Invalid marker number.');
  }
}
/* Accepts v1 (single draft) and v2 manuals. Returns a v2 manual. Never drops user content. */
function normalise(p){
  if(!p||p.format!=='works-capture'||![1,2].includes(p.version)||!p.details||!Array.isArray(p.chapters)||!p.chapters.length||p.chapters.length>200)throw Error('This is not a supported Works Capture backup.');
  const d=Object.assign(blankDetails(),p.details);
  if(!['wm','twp','va'].includes(d.documentType))d.documentType='wm';
  if(!['A3','A4','A5'].includes(d.paperSize))d.paperSize='A4';
  if(!['portrait','landscape'].includes(d.orientation))d.orientation='portrait';
  for(const k of ['startDate','endDate','productionName','productionDate','qualityName','qualityDate','trainingBy','trainingDates','operators','instructionKind','affectedManuals'])d[k]=String(d[k]??'');
  if(p.version===1){
    const m=String(d.number||'').match(/^(?:WM|TWP|VA)\.([A-Z0-9]+)\.(\d+)\.V([\d.]+)$/i);
    if(m){d.areaCode=m[1].toUpperCase();d.seq=m[2];d.revision=m[3]}else{d.areaCode=p.details.areaCode||settings.areaCodes[d.area]||'';d.revision=p.details.revision||'0.1'}
    d.date=d.date||today();
  }
  for(const k of ['title','number','area','areaCode','seq','revision','reason','author','date','line','product','type','appVersion','mark','speed','variants','scope','overview','previousVersions','advisory','safety','risk','quality','qualityChecks','workspaceNote'])d[k]=String(d[k]??'');
  if(!AREAS.includes(d.area))d.area='Inspection / Other';
  if(!d.number)d.number=buildNumber(d);
  d.hazards=(Array.isArray(d.hazards)?d.hazards:[]).filter(symById);d.mandatory=(Array.isArray(d.mandatory)?d.mandatory:[]).filter(symById);
  const ids=new Set(),idCheck=id=>{if(typeof id!=='string'||!id||ids.has(id))throw Error('Invalid or duplicate record ID.');ids.add(id)};
  for(const k of ['cover','workspace'])if(d[k])checkPhoto(d[k],idCheck);else d[k]=null;
  for(const c of p.chapters){idCheck(c.id);if(typeof c.title!=='string'||!Array.isArray(c.steps)||!c.steps.length||c.steps.length>500)throw Error('Invalid section.');
    for(const s of c.steps){idCheck(s.id);
      for(const k of ['title','action','result','support','quality','qualityChecks','safety','settings','exception','variant'])s[k]=String(s[k]??'');
      if(!['action','check','exception','variant'].includes(s.type))s.type='action';
      s.enabled=(Array.isArray(s.enabled)?s.enabled:[]).filter(k=>extraDefs[k]);s.ppe=(Array.isArray(s.ppe)?s.ppe:[]).filter(symById);
      if(!Array.isArray(s.photos)||!Array.isArray(s.media))throw Error('Invalid step.');
      s.tables=validateTables(s.tables);
      for(const pic of s.photos)checkPhoto(pic,idCheck);
      for(const m of s.media){idCheck(m.id);if(typeof m.name!=='string'||typeof m.note!=='string'||!/^data:(audio|video)\/[a-z0-9.+-]+(?:;codecs=[a-z0-9., -]+)?;base64,[a-z0-9+/=\r\n]+$/i.test(m.data)||!/^(audio|video)\//.test(m.type))throw Error('Invalid recording.')}
    }}
  return {format:'works-capture',version:2,id:typeof p.id==='string'&&p.id?p.id:uid(),created:p.created||Date.now(),updated:p.updated||Date.now(),saveRev:p.saveRev||0,templateId:p.templateId||'blank',details:d,chapters:p.chapters};
}

/* ---------- storage ---------- */
function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open('works-capture-local-v1',2);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains('drafts'))d.createObjectStore('drafts');if(!d.objectStoreNames.contains('manuals'))d.createObjectStore('manuals');if(!d.objectStoreNames.contains('settings'))d.createObjectStore('settings')};r.onerror=()=>rej(r.error);r.onblocked=()=>toast('Close other Works Capture tabs to finish updating.');r.onsuccess=()=>res(r.result)})}
function idb(store,mode,fn){return new Promise((res,rej)=>{const tx=db.transaction(store,mode),st=tx.objectStore(store);let out;const q=fn(st);if(q)q.onsuccess=()=>out=q.result;tx.oncomplete=()=>res(out);tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error||Error('Storage aborted'))})}
const getManual=id=>idb('manuals','readonly',s=>s.get(id));
const putManual=m=>idb('manuals','readwrite',s=>s.put(m,m.id));
const delManual=id=>idb('manuals','readwrite',s=>s.delete(id));
const getSetting=k=>idb('settings','readonly',s=>s.get(k));
const putSetting=(k,v)=>idb('settings','readwrite',s=>s.put(v,k));
async function saveSettings(){await putSetting('settings',settings)}
async function saveIndex(){await putSetting('index',index)}
async function summary(p){
  const first=p.details.cover||p.chapters.flatMap(c=>c.steps).flatMap(s=>s.photos)[0];
  let thumb=index[p.id]?.thumb||'';
  if(first&&index[p.id]?.thumbFor!==first.id+first.marks.length){try{thumb=await thumbnail(first)}catch{}}
  if(!first)thumb='';
  return {id:p.id,title:p.details.title,number:p.details.number,area:p.details.area,updated:p.updated,created:p.created,steps:p.chapters.reduce((n,c)=>n+c.steps.length,0),photos:p.chapters.reduce((n,c)=>n+c.steps.reduce((m,s)=>m+s.photos.length,0),0),thumb,thumbFor:first?first.id+first.marks.length:''};
}
async function thumbnail(p){const src=await markedImage(p),im=await loadImage(src),c=document.createElement('canvas'),s=Math.min(1,360/Math.max(im.width,im.height));c.width=Math.round(im.width*s);c.height=Math.round(im.height*s);c.getContext('2d').drawImage(im,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.7)}

function setStatus(t,bad){$('#save-status').textContent=t;$('#save-status').classList.toggle('bad',!!bad)}
function scheduleSave(){if(!project)return;dirty=true;setStatus('Saving…');clearTimeout(saveTimer);saveTimer=setTimeout(flushSave,500);headerChip()}
function flushSave(){
  clearTimeout(saveTimer);if(!project||!dirty)return saveChain;
  const p=project;dirty=false;
  saveChain=saveChain.catch(()=>{}).then(async()=>{
    try{
      if(!db)throw Error('Browser storage unavailable');
      const existing=await getManual(p.id);
      if(existing&&existing.saveRev>baseRev){ // another tab saved a newer copy
        p.id=uid();p.details.title+=' (copy)';toast('This manual was changed in another tab. Your version was kept as a copy.',7000);
      }
      p.updated=Date.now();p.saveRev=(existing&&existing.saveRev>=0?Math.max(existing.saveRev,baseRev):baseRev)+1;
      const snap=structuredClone(p);
      await putManual(snap);
      const check=await getManual(snap.id); // read-back verification
      if(!check||check.saveRev!==snap.saveRev)throw Error('Save could not be verified');
      baseRev=snap.saveRev;index[p.id]=await summary(snap);settings.lastOpen=p.id;await saveIndex();await saveSettings();
      setStatus('Saved '+new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}));
    }catch(e){console.error(e);dirty=true;setStatus('Not saved — export a backup',true);toast('Browser storage is full or unavailable. Export a backup now to keep your work.',8000)}
  });
  return saveChain;
}
window.addEventListener('beforeunload',e=>{if(dirty||recorder?.state==='recording'){flushSave();e.preventDefault();e.returnValue=''}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushSave()});
window.addEventListener('pagehide',()=>flushSave());

async function migrateLegacy(){
  if(await getSetting('migratedV1'))return;
  try{const legacy=await idb('drafts','readonly',s=>s.get('current'));
    if(legacy){const p=normalise(structuredClone(legacy));p.id=uid();await putManual(p);index[p.id]=await summary(p);await saveIndex();settings.lastOpen=p.id;await saveSettings();toast('Your existing draft has been moved into the library.')}
  }catch(e){console.warn('Legacy draft could not be migrated',e);toast('An older draft could not be read. It is still stored — open a backup if you have one.')}
  await putSetting('migratedV1',true); // legacy 'drafts' store is left untouched
}
async function rebuildIndex(){const all=await idb('manuals','readonly',s=>s.getAll());index={};for(const m of all)try{index[m.id]=await summary(m)}catch{}await saveIndex()}

/* ---------- navigation ---------- */
function active(){for(const c of project.chapters){const s=c.steps.find(s=>s.id===current);if(s)return {c,s}}const c=project.chapters[0];current=c.steps[0].id;return {c,s:c.steps[0]}}
function headerChip(){const on=!!project&&page!=='library'&&page!=='settings';$('#doc-chip').hidden=!on;$$('.only-manual').forEach(b=>b.hidden=!on);if(on){$('#chip-number').textContent=project.details.number||'WM';$('#chip-title').textContent=project.details.title}}
async function setPage(p){
  if(recording())return;page=p;
  for(const id of ['library','settings','front','hs','capture','preview'])$('#'+id+'-page').hidden=id!==p;
  const manualView=!['library','settings'].includes(p);$('#sidebar').hidden=!manualView;$('.workspace').classList.toggle('no-side',!manualView);
  headerChip();
  if(p==='library'){await flushSave();libraryUI()}
  if(p==='settings')settingsUI();
  if(manualView)nav();
  if(p==='front')frontUI();if(p==='hs')hsUI();if(p==='capture')captureUI();if(p==='preview')await previewAll();
  window.scrollTo(0,0);
}
function recording(){if(recorder?.state==='recording'){toast('Stop the voice recording first.');return true}return false}
async function openManual(id){
  await flushSave();
  try{const m=await getManual(id);if(!m)throw Error('Manual not found');project=normalise(m);baseRev=project.saveRev;current=project.chapters[0].steps[0].id;edHistory.clear();settings.lastOpen=id;saveSettings();setStatus('Saved');await setPage('capture')}
  catch(e){toast(e.message||'Could not open this manual.')}
}

/* ---------- library ---------- */
function libraryUI(){
  project=null;headerChip();const q=$('#lib-search').value.trim().toLowerCase();
  const items=Object.values(index).filter(e=>!q||(e.title+' '+e.number).toLowerCase().includes(q)).sort((a,b)=>b.updated-a.updated);
  $('#library-list').innerHTML=items.length?items.map(e=>`<div class="card"><button class="thumb" data-open="${e.id}" style="${e.thumb?`background-image:url('${e.thumb}')`:''}" aria-label="Open ${esc(e.title)}">${e.thumb?'':'📄'}</button><div class="body"><div class="num">${esc(e.number||'No number')}</div><h3>${esc(e.title)}</h3><div class="meta">${esc(e.area||'')} · ${e.steps} steps · ${e.photos} pictures<br>Saved ${new Date(e.updated).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'})}</div></div><div class="actions"><button class="primary" data-open="${e.id}">Open</button><button data-dup="${e.id}">Duplicate</button><button data-bk="${e.id}">Backup</button><button data-del="${e.id}" class="danger-text">Delete</button></div></div>`).join(''):`<div class="empty"><h3>${q?'No matches':'No manuals yet'}</h3><p>Tap “New manual” to start from a template.</p></div>`;
  $$('[data-open]').forEach(b=>b.onclick=()=>openManual(b.dataset.open));
  $$('[data-dup]').forEach(b=>b.onclick=async()=>{const m=normalise(await getManual(b.dataset.dup));const map=new Map();const re=o=>{if(o&&typeof o==='object'){if(typeof o.id==='string'){if(!map.has(o.id))map.set(o.id,uid());o.id=map.get(o.id)}for(const v of Object.values(o))re(v)}};re(m.chapters);re(m.details.cover);re(m.details.workspace);m.id=uid();m.created=m.updated=Date.now();m.saveRev=0;m.details.title+=' (copy)';m.details.seq=m.details.areaCode?nextSeq(m.details.areaCode):'';m.details.number=buildNumber(m.details);await putManual(m);index[m.id]=await summary(m);await saveIndex();libraryUI();toast('Duplicated with a new number.')});
  $$('[data-bk]').forEach(b=>b.onclick=async()=>{const m=await getManual(b.dataset.bk);download(new Blob([JSON.stringify(m)],{type:'application/json'}),filename(m)+'.works.json')});
  $$('[data-del]').forEach(b=>b.onclick=async()=>{const e=index[b.dataset.del];if(!await confirmAction('Delete this manual?',`“${e.title}” and its pictures will be removed from this browser. Download a backup first if you may need it.`,'Delete'))return;await delManual(e.id);delete index[e.id];await saveIndex();libraryUI()});
  if(navigator.storage?.estimate)navigator.storage.estimate().then(s=>$('#storage-info').textContent=`Stored privately on this device · ${(s.usage/1048576).toFixed(1)} MB used. Back up before clearing browser data or changing device.`);
}
$('#lib-search').oninput=libraryUI;
function allTemplates(){return BUILTIN_TEMPLATES}
$('#new-manual').onclick=()=>{
  $('#template-choices').innerHTML=allTemplates().map(t=>`<button value="${esc(t.id)}">${esc(t.name)}<small>${esc(t.desc||t.chapters.map(c=>c.title).join(' → '))}</small></button>`).join('');
  $('#template-dialog').showModal();
  $('#template-dialog').onclose=async()=>{const t=allTemplates().find(t=>t.id===$('#template-dialog').returnValue);if(!t)return;const setup=t.id==='va'?await askPageSetup():{paperSize:'A4',orientation:'portrait'};if(!setup)return;project=newManual(t);Object.assign(project.details,setup);baseRev=0;current=project.chapters[0].steps[0].id;dirty=true;await flushSave();await setPage('front');$('[data-d=title]').select()};
};
$('#go-library').onclick=()=>setPage('library');
$('#open-settings').onclick=()=>setPage('settings');$('#settings-back').onclick=()=>setPage('library');

/* ---------- settings ---------- */
function settingsUI(){
  $('#area-codes').innerHTML=AREAS.map(a=>`<label>${esc(a)}<input data-code="${esc(a)}" value="${esc(settings.areaCodes[a]||'')}" maxlength="4" placeholder="e.g. PT"></label>`).join('');
  $$('[data-code]').forEach(i=>i.oninput=()=>{settings.areaCodes[i.dataset.code]=i.value.toUpperCase().replace(/[^A-Z0-9]/g,'');saveSettings()});
  $('#set-author').value=settings.author||'';$('#set-author').oninput=e=>{settings.author=e.target.value;saveSettings()};
  $('#set-draft').checked=settings.draftMark!==false;$('#set-draft').onchange=e=>{settings.draftMark=e.target.checked;saveSettings()};
  $('#template-list').innerHTML=allTemplates().map(t=>`<div class="tpl-row"><div><b>${esc(t.name)}</b><br><small>${esc(t.chapters.map(c=>c.title).join(' → '))}</small></div>${BUILTIN_TEMPLATES.includes(t)?'<small>Built-in</small>':`<button data-deltpl="${esc(t.id)}" class="danger-text">Delete</button>`}</div>`).join('');
  $$('[data-deltpl]').forEach(b=>b.onclick=async()=>{settings.templates=settings.templates.filter(t=>t.id!==b.dataset.deltpl);await saveSettings();settingsUI()});
}
/* ---------- front page & H&S ---------- */
function bindDetails(root){
  root.querySelectorAll('[data-d]').forEach(e=>{const k=e.dataset.d;
    if(e.tagName==='SELECT'&&k==='area')e.innerHTML=AREAS.map(a=>`<option ${a===project.details.area?'selected':''}>${esc(a)}</option>`).join('');
    else e.value=project.details[k]??'';
    e.oninput=e.onchange=()=>{const d=project.details;d[k]=e.value;
      if(k==='area'){const code=settings.areaCodes[e.value];if(code){d.areaCode=code;d.seq=nextSeq(code);root.querySelector('[data-d=areaCode]').value=code;root.querySelector('[data-d=seq]').value=d.seq}}
      if(k==='areaCode'){d.areaCode=e.value.toUpperCase().replace(/[^A-Z0-9]/g,'');if(e.value!==d.areaCode)e.value=d.areaCode;if(d.areaCode&&!d.seq){d.seq=nextSeq(d.areaCode);root.querySelector('[data-d=seq]').value=d.seq}}
      if(k==='seq'){d.seq=e.value.replace(/\D/g,'')}
      if(['area','areaCode','seq','revision'].includes(k)){d.number=buildNumber(d);numberUI()}
      scheduleSave()}});
}
function numberUI(){if(!$('#number-out'))return;const d=project.details;$('#number-out').textContent=d.number;const dup=Object.values(index).find(e=>e.id!==project.id&&e.number===d.number);$('#number-warn').textContent=dup?`Already used by “${dup.title}”`:''}
function frontUI(){templateFrontUI();bindDetails($('#front-page'));numberUI();slotUI('cover')}
function hsUI(){bindDetails($('#hs-page'));slotUI('workspace');
  for(const g of $$('#hs-page [data-symset]')){const cat=g.dataset.symset,key=cat==='hazard'?'hazards':'mandatory';
    g.innerHTML=SYMS.filter(s=>s.cat===cat).map(s=>`<button class="sym" data-sym="${s.id}" aria-pressed="${project.details[key].includes(s.id)}"><img src="${s.src}" alt="">${esc(s.label)}</button>`).join('');
    g.querySelectorAll('[data-sym]').forEach(b=>b.onclick=()=>{const arr=project.details[key],i=arr.indexOf(b.dataset.sym);if(i>=0)arr.splice(i,1);else arr.push(b.dataset.sym);b.setAttribute('aria-pressed',i<0);scheduleSave()})}
}
let slotTarget=null;
function slotUI(kind){const el=$(`[data-slot=${kind}]`),p=project.details[kind];
  el.innerHTML=p?`<img alt="" id="slot-img-${kind}"><button data-sedit>✎ Mark up</button><button data-sreplace>Replace</button><button data-sremove class="danger-text">Remove</button>`:`<button data-sadd class="primary">📷 Add picture</button><button data-sshot>🖥 Screenshot</button><button data-spaste>📋 Paste</button>`;
  if(p)markedImage(p).then(src=>{const i=$('#slot-img-'+kind);if(i)i.src=src});
  const q=s=>el.querySelector(s);
  if(q('[data-sadd]'))q('[data-sadd]').onclick=()=>{slotTarget=kind;$('#slot-input').click()};
  if(q('[data-sreplace]'))q('[data-sreplace]').onclick=()=>{slotTarget=kind;$('#slot-input').click()};
  if(q('[data-sedit]'))q('[data-sedit]').onclick=()=>openEditor(p,()=>slotUI(kind));
  if(q('[data-sremove]'))q('[data-sremove]').onclick=async()=>{if(await confirmAction('Remove picture?','It will be removed from this manual.','Remove')){project.details[kind]=null;scheduleSave();slotUI(kind)}};
  if(q('[data-sshot]'))q('[data-sshot]').onclick=async()=>{const d=await captureScreen();if(d)await setSlot(kind,d,'screenshot.jpg')};
  if(q('[data-spaste]'))q('[data-spaste]').onclick=async()=>{const d=await readClipboardImage();if(d)await setSlot(kind,d,'pasted.jpg')};
}
async function setSlot(kind,dataURL,name){try{const p=await makePhoto(dataURL,name);project.details[kind]=p;scheduleSave();slotUI(kind);openEditor(p,()=>slotUI(kind))}catch(e){toast(e.message)}}
$('#slot-input').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(f&&slotTarget)await setSlot(slotTarget,await fileData(f),f.name)};

/* ---------- sidebar & steps ---------- */
function nav(){
  const root=$('#chapter-list');
  root.innerHTML=project.chapters.map((c,ci)=>`<div class="chapter"><div class="chapter-header"><button data-rename="${c.id}">${ci+1}. ${esc(c.title)}</button></div><div class="chapter-steps">${c.steps.map((s,si)=>`<button class="step-link ${page==='capture'&&current===s.id?'active':''}" data-step="${s.id}"><span class="step-no">${ci+1}.${si+1}</span><span>${esc(s.title||'Untitled step')}${s.photos.length?' 📷':''}</span></button>`).join('')}</div><button class="add-step" data-add="${c.id}">＋ Step</button></div>`).join('');
  root.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>{current=b.dataset.step;setPage('capture')});
  root.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{const c=project.chapters.find(c=>c.id===b.dataset.add),s=step();c.steps.push(s);current=s.id;scheduleSave();setPage('capture').then(()=>$('#step-title').select())});
  root.querySelectorAll('[data-rename]').forEach(b=>b.onclick=()=>chapterDialog(b.dataset.rename));
  $$('.sidebar [data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
}
$$('[data-page]').forEach(b=>b.onclick=()=>setPage(b.dataset.page));
async function chapterDialog(id){
  const c=project.chapters.find(c=>c.id===id);
  const title=await askName(c?'Rename section':'Add section','Section title',c?.title||'');
  if(title===null)return;
  if(c&&!title){ // empty name on rename = offer delete
    if(project.chapters.length>1&&await confirmAction('Delete this section?','All its steps and pictures will be removed.','Delete')){project.chapters=project.chapters.filter(x=>x!==c);current=project.chapters[0].steps[0].id;scheduleSave();setPage('capture')}return}
  if(!title)return;
  if(c)c.title=title;else{const s=step();project.chapters.push({id:uid(),title,steps:[s]});current=s.id}
  scheduleSave();setPage('capture');
}
$('#add-chapter').onclick=()=>chapterDialog();

function captureUI(){
  const {c,s}=active(),ci=project.chapters.indexOf(c),si=c.steps.indexOf(s);
  $('#breadcrumb').textContent=`${ci+1}. ${c.title.toUpperCase()} · STEP ${ci+1}.${si+1}`;$('#step-heading').textContent=s.title||'Untitled step';
  for(const k of ['title','type','action','result'])$('#step-'+k).value=s[k];
  $('#move-up').disabled=si===0;$('#move-down').disabled=si===c.steps.length-1;
  $('#detail-toggles').innerHTML=Object.entries(extraDefs).map(([k,[label]])=>`<button class="chip ${k} ${s.enabled.includes(k)?'on':''}" data-extra="${k}" aria-pressed="${s.enabled.includes(k)}">${s.enabled.includes(k)?'✓':'＋'} ${label}</button>`).join('');
  $('#extra-fields').innerHTML=Object.entries(extraDefs).filter(([k])=>s.enabled.includes(k)).map(([k,[label,help]])=>`<div class="extra-block ${k}"><label>${label}${k==='settings'?`<input data-extra-input="${k}" value="${esc(s[k])}" placeholder="${esc(help)}">`:`<textarea data-extra-input="${k}" rows="2" placeholder="${esc(help)}">${esc(s[k])}</textarea>`}</label>${k==='quality'?`<label>Checks — one per line<textarea data-extra-input="qualityChecks" rows="3" placeholder="Each line becomes a bullet">${esc(s.qualityChecks)}</textarea></label>`:''}${k==='safety'?`<label>PPE for this step</label><div class="symbol-grid small">${SYMS.filter(x=>x.cat==='mandatory').map(x=>`<button class="sym small" data-ppe="${x.id}" aria-pressed="${s.ppe.includes(x.id)}"><img src="${x.src}" alt="">${esc(x.label.replace('Wear ',''))}</button>`).join('')}</div>`:''}${k==='settings'?'<p class="hint">Shown in bold. Add a “Torque” box on the picture too.</p>':''}</div>`).join('');
  $$('[data-extra]').forEach(b=>b.onclick=()=>{const k=b.dataset.extra;s.enabled=s.enabled.includes(k)?s.enabled.filter(x=>x!==k):[...s.enabled,k];captureUI();scheduleSave();if(s.enabled.includes(k))$(`[data-extra-input=${k}]`)?.focus()});
  $$('[data-extra-input]').forEach(e=>e.oninput=()=>{s[e.dataset.extraInput]=e.value;scheduleSave()});
  $$('[data-ppe]').forEach(b=>b.onclick=()=>{const i=s.ppe.indexOf(b.dataset.ppe);if(i>=0)s.ppe.splice(i,1);else s.ppe.push(b.dataset.ppe);b.setAttribute('aria-pressed',i<0);scheduleSave()});
  mediaUI();tableEditorUI();if($('#step-preview-wrap').open)stepPreview();
}
$('#step-preview-wrap').ontoggle=()=>{if($('#step-preview-wrap').open)stepPreview()};
async function stepPreview(){const {c,s}=active();$('#step-preview').innerHTML=await stepHTML(c,s,{n:0})}
for(const k of ['title','type','action','result'])$('#step-'+k).oninput=e=>{const s=active().s;s[k]=e.target.value;
  if(k==='title'){$('#step-heading').textContent=s.title||'Untitled step';nav()}
  if(k==='type'&&['exception','variant','check'].includes(s.type)){const x=s.type==='check'?'quality':s.type;if(!s.enabled.includes(x))s.enabled.push(x);captureUI()}
  scheduleSave()};
$('#delete-step').onclick=async()=>{const {c,s}=active();if(project.chapters.reduce((n,c)=>n+c.steps.length,0)===1){toast('Keep at least one step.');return}
  if(await confirmAction('Delete this step?','Its text and pictures will be removed.','Delete')){const i=c.steps.indexOf(s);c.steps=c.steps.filter(x=>x!==s);if(!c.steps.length)project.chapters=project.chapters.filter(x=>x!==c);current=(c.steps[Math.max(0,i-1)]||project.chapters[0].steps[0]).id;scheduleSave();setPage('capture')}};
for(const [id,d] of [['move-up',-1],['move-down',1]])$('#'+id).onclick=()=>{const {c,s}=active(),i=c.steps.indexOf(s),j=i+d;if(j<0||j>=c.steps.length)return;[c.steps[i],c.steps[j]]=[c.steps[j],c.steps[i]];captureUI();nav();scheduleSave()};
$('#add-step-after').onclick=()=>{const {c,s}=active(),n=step();c.steps.splice(c.steps.indexOf(s)+1,0,n);current=n.id;scheduleSave();setPage('capture').then(()=>$('#step-title').select())};

/* ---------- pictures ---------- */
async function makePhoto(dataURL,name,max=2000){
  const im=await loadImage(dataURL),scale=Math.min(1,max/Math.max(im.width,im.height)),cv=document.createElement('canvas');
  cv.width=Math.round(im.width*scale);cv.height=Math.round(im.height*scale);const g=cv.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,cv.width,cv.height);g.drawImage(im,0,0,cv.width,cv.height);
  const src=cv.toDataURL('image/jpeg',.9);
  const original=reImg.test(dataURL)&&dataURL.length<12e6?dataURL:src;
  return {id:uid(),name:name||'picture.jpg',original,src,width:cv.width,height:cv.height,caption:'',marks:[]};
}
async function addPhotoData(dataURL,name,openAfter=true){const s=active().s;try{const p=await makePhoto(dataURL,name);s.photos.push(p);scheduleSave();mediaUI();nav();if(openAfter)openEditor(p,mediaUI)}catch(e){toast(e.message)}}
async function addPhotos(files){const s=active().s;let last=null;for(const f of files){try{if(!/^image\//.test(f.type))throw Error('Choose a picture file.');if(f.size>25*1024*1024)throw Error('Use pictures smaller than 25 MB.');last=await makePhoto(await fileData(f),f.name);s.photos.push(last)}catch(e){toast(e.message)}}scheduleSave();mediaUI();nav();if(last&&files.length===1)openEditor(last,mediaUI)}
$('#upload-photo').onclick=()=>$('#photo-input').click();$('#take-photo').onclick=()=>$('#camera-input').click();$('#media-upload').onclick=()=>$('#media-input').click();
for(const id of ['photo-input','camera-input'])$('#'+id).onchange=async e=>{await addPhotos(Array.from(e.target.files));e.target.value=''};

async function captureScreen(){
  if(!navigator.mediaDevices?.getDisplayMedia){toast('Screen capture is not available here. On iPad: press top + volume-up buttons, then use 🖼 Photos or 📋 Paste.',8000);return null}
  let s;try{
    s=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'monitor'},audio:false});
    const v=document.createElement('video');v.muted=true;v.playsInline=true;v.srcObject=s;await v.play();
    await new Promise(r=>setTimeout(r,350));
    const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);
    return c.toDataURL('image/png');
  }catch(e){if(e.name!=='NotAllowedError')toast('Screen capture failed: '+e.message);return null}
  finally{s?.getTracks().forEach(t=>t.stop())}
}
$('#screen-capture').onclick=async()=>{const d=await captureScreen();if(d)await addPhotoData(d,`screenshot-${Date.now()}.jpg`)};
async function readClipboardImage(){
  try{if(!navigator.clipboard?.read)throw Error();const items=await navigator.clipboard.read();for(const it of items){const t=it.types.find(t=>t.startsWith('image/'));if(t)return await fileData(await it.getType(t))}toast('No picture on the clipboard. Copy a screenshot first.');return null}
  catch{toast('Press Ctrl+V (or long-press → Paste on iPad) to paste a picture.');return null}
}
$('#paste-image').onclick=async()=>{const d=await readClipboardImage();if(d)await addPhotoData(d,`pasted-${Date.now()}.jpg`)};
document.addEventListener('paste',async e=>{
  if(!$('#editor').hidden||/INPUT|TEXTAREA/.test(document.activeElement?.tagName))return;
  const f=Array.from(e.clipboardData?.files||[]).find(f=>f.type.startsWith('image/'));if(!f)return;e.preventDefault();
  if(page==='capture')await addPhotoData(await fileData(f),f.name||'pasted.jpg');
  else if(page==='front')await setSlot('cover',await fileData(f),'pasted.jpg');
  else if(page==='hs')await setSlot('workspace',await fileData(f),'pasted.jpg');
});

async function mediaUI(){
  const s=active().s;
  $('#photo-list').innerHTML=s.photos.map((p,i)=>`<div class="photo-card"><button data-photo="${p.id}" style="padding:0;border:0;width:100%;background:none"><img alt="Picture ${i+1}" data-thumb="${p.id}"><span>Fig · ${esc(p.caption||p.name)}</span></button><div class="pc-tools"><button data-pl="${i}" ${i?'':'disabled'} aria-label="Move left">◀</button><button data-photo="${p.id}">✎ Edit</button><button data-pr="${i}" ${i<s.photos.length-1?'':'disabled'} aria-label="Move right">▶</button></div></div>`).join('')||'<p class="hint">No pictures yet.</p>';
  for(const p of s.photos)markedImage(p).then(src=>{const im=$(`[data-thumb="${p.id}"]`);if(im)im.src=src}).catch(()=>{});
  $$('[data-photo]').forEach(b=>b.onclick=()=>openEditor(s.photos.find(p=>p.id===b.dataset.photo),mediaUI));
  $$('[data-pl],[data-pr]').forEach(b=>b.onclick=()=>{const i=+(b.dataset.pl??b.dataset.pr),j=b.dataset.pl!==undefined?i-1:i+1;[s.photos[i],s.photos[j]]=[s.photos[j],s.photos[i]];scheduleSave();mediaUI()});
  $('#media-list').innerHTML=s.media.map(m=>`<div class="media-item"><b>${esc(m.name)}</b><${m.type.startsWith('video')?'video':'audio'} controls preload="metadata" src="${m.data}"></${m.type.startsWith('video')?'video':'audio'}><label>What it shows / checked transcript<textarea data-media-note="${m.id}" rows="2">${esc(m.note)}</textarea></label><div class="row"><button data-media-download="${m.id}">Download</button><button data-media-remove="${m.id}" class="danger-text">Remove</button></div></div>`).join('');
  $$('[data-media-note]').forEach(e=>e.oninput=()=>{s.media.find(m=>m.id===e.dataset.mediaNote).note=e.value;scheduleSave()});
  $$('[data-media-download]').forEach(b=>b.onclick=()=>{const m=s.media.find(m=>m.id===b.dataset.mediaDownload);download(dataBlob(m.data),m.name)});
  $$('[data-media-remove]').forEach(b=>b.onclick=async()=>{if(await confirmAction('Remove recording?','It will be removed from this manual.','Remove')){s.media=s.media.filter(m=>m.id!==b.dataset.mediaRemove);scheduleSave();mediaUI()}});
}
$('#media-input').onchange=async e=>{const s=active().s;for(const f of e.target.files){if(f.size>30*1024*1024){toast('Use recordings smaller than 30 MB.');continue}if(!/^(audio|video)\//.test(f.type)){toast('Choose an audio or video file.');continue}try{s.media.push({id:uid(),name:f.name,type:f.type,data:await fileData(f),note:''})}catch(err){toast(err.message)}}e.target.value='';scheduleSave();mediaUI()};
$('#record').onclick=async()=>{
  if(recorder?.state==='recording'){recorder.stop();$('#record').disabled=true;return}
  try{if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('Voice recording is unavailable here. Record on your device and attach it.');
    stream=await navigator.mediaDevices.getUserMedia({audio:true});recordStep=active().s;const chunks=[];recorder=new MediaRecorder(stream);
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
    recorder.onstop=async()=>{clearTimeout(recorder.limit);stream.getTracks().forEach(t=>t.stop());const type=(recorder.mimeType||'audio/webm').split(';')[0],blob=new Blob(chunks,{type});const ext=type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'webm';
      try{recordStep.media.push({id:uid(),name:`voice-${recordStep.media.length+1}.${ext}`,type,data:await fileData(blob),note:''});scheduleSave();await mediaUI()}catch(e){toast(e.message)}
      $('#record').textContent='🎤 Voice';$('#record').disabled=false;$('#record-status').textContent='Recording attached.'};
    recorder.start();$('#record').textContent='■ Stop';$('#record-status').textContent='Recording… stops after 3 minutes.';recorder.limit=setTimeout(()=>{if(recorder.state==='recording')recorder.stop()},180000);
  }catch(e){stream?.getTracks().forEach(t=>t.stop());toast(e.message||'Microphone access was not granted.')}
};

/* ---------- picture editor ---------- */
let edOnClose=null;
const BOXLIKE=['box','circle','text','torque','stamp'];
function photo(){return edPhoto}
async function openEditor(p,onClose){
  if(!p)return;edPhoto=p;edOnClose=onClose;selected=null;cropRect=null;
  $('#editor').hidden=false;document.body.classList.add('editor-open');
  imageCache=await loadImage(p.src);canvas.width=p.width;canvas.height=p.height;
  $('#photo-caption').value=p.caption;setTool('select');swatchUI();afterMark(false);fitCanvas();
}
function closeEditor(){if(!edPhoto)return;$('#editor').hidden=true;document.body.classList.remove('editor-open');edPhoto=null;gesture=null;cropRect=null;scheduleSave();edOnClose?.();nav()}
$('#ed-done').onclick=closeEditor;
$('#ed-more').onclick=()=>{$('#ed-extra').hidden=!$('#ed-extra').hidden};
function fitCanvas(){const box=$('.ed-canvas').getBoundingClientRect(),r=Math.min((box.width-20)/canvas.width,(box.height-20)/canvas.height);canvas.style.width=Math.floor(canvas.width*r)+'px';canvas.style.height=Math.floor(canvas.height*r)+'px';draw()}
window.addEventListener('resize',()=>{if(edPhoto)fitCanvas()});
if(window.ResizeObserver)new ResizeObserver(()=>{if(edPhoto&&!gesture)fitCanvas()}).observe($('.ed-canvas'));
function swatchUI(){
  $('#swatches').innerHTML=SWATCHES.map(c=>`<button data-color="${c}" style="background:${c}" aria-label="Colour ${c}" aria-pressed="${c===edColor}"></button>`).join('');
  $$('[data-color]').forEach(b=>b.onclick=()=>{edColor=b.dataset.color;swatchUI();const m=selMark();if(m)change('colour',()=>m.color=edColor)});
  $$('[data-w]').forEach(b=>{b.setAttribute('aria-pressed',+b.dataset.w===edWidth);b.onclick=()=>{edWidth=+b.dataset.w;swatchUI();const m=selMark();if(m)change('width',()=>m.width=edWidth)}});
  $('#stamp-palette').innerHTML=[...SYMS.filter(s=>s.cat==='mark'),...SYMS.filter(s=>s.cat==='hazard'||s.cat==='mandatory')].map(s=>`<button data-stamp="${s.id}" aria-pressed="${s.id===stampId}" title="${esc(s.label)}"><img src="${s.src}" alt="${esc(s.label)}"></button>`).join('');
  $$('[data-stamp]').forEach(b=>b.onclick=()=>{stampId=b.dataset.stamp;setTool('stamp');swatchUI();toast('Tap the picture to place the symbol.',2000)});
}
const selMark=()=>edPhoto?.marks.find(m=>m.id===selected);
function historyFor(p){if(!edHistory.has(p.id))edHistory.set(p.id,{undo:[],redo:[]});return edHistory.get(p.id)}
function snapshot(){const p=edPhoto;return {marks:structuredClone(p.marks),src:p.src,width:p.width,height:p.height,selected}}
function commitChange(before,label){const p=edPhoto;if(!p||(JSON.stringify(before.marks)===JSON.stringify(p.marks)&&before.src===p.src))return;const h=historyFor(p);h.undo.push({...before,label});if(h.undo.length>40)h.undo.shift();h.redo=[]}
function change(label,fn){const b=snapshot();fn();commitChange(b,label);afterMark()}
function undoUI(){const h=edPhoto?historyFor(edPhoto):{undo:[],redo:[]};$('#undo').disabled=!h.undo.length;$('#redo').disabled=!h.redo.length;$('#delete-mark').disabled=!selected}
function afterMark(save=true){draw();selectionUI();notesUI();undoUI();if(save)scheduleSave()}
function norm(m){return {x:Math.min(m.x,m.x2),y:Math.min(m.y,m.y2),w:Math.abs(m.x2-m.x),h:Math.abs(m.y2-m.y)}}
function bounds(m){if(m.points){const xs=m.points.map(p=>p.x),ys=m.points.map(p=>p.y);return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)}}if(m.type==='number')return {x:m.x-.025,y:m.y-.025,w:.05,h:.05};return norm(m)}
function fitText(c,text,maxW,maxH,weight='bold'){let size=maxH*.75;c.font=`${weight} ${size}px Arial`;const w=c.measureText(text).width;if(w>maxW*.9){size*=maxW*.9/w;c.font=`${weight} ${size}px Arial`}return size}
function paintMark(c,m,w,h){
  const unit=Math.max(w,h)/900;c.save();c.strokeStyle=m.color;c.fillStyle=m.color;c.lineWidth=m.width*unit;c.lineCap='round';c.lineJoin='round';
  const b=BOXLIKE.includes(m.type)?norm(m):null,X=b&&b.x*w,Y=b&&b.y*h,W=b&&b.w*w,H=b&&b.h*h;
  if(m.type==='box')c.strokeRect(X,Y,W,H);
  else if(m.type==='circle'){c.beginPath();c.ellipse(X+W/2,Y+H/2,Math.max(1,W/2),Math.max(1,H/2),0,0,Math.PI*2);c.stroke()}
  else if(m.type==='arrow'){const x=m.x*w,y=m.y*h,xx=m.x2*w,yy=m.y2*h,a=Math.atan2(yy-y,xx-x),size=(14+m.width*2.2)*unit;c.beginPath();c.moveTo(x,y);c.lineTo(xx-Math.cos(a)*size*.6,yy-Math.sin(a)*size*.6);c.stroke();c.beginPath();c.moveTo(xx,yy);c.lineTo(xx-size*Math.cos(a-.45),yy-size*Math.sin(a-.45));c.lineTo(xx-size*Math.cos(a+.45),yy-size*Math.sin(a+.45));c.closePath();c.fill()}
  else if(m.type==='number'){const r=18*unit;c.fillStyle='#172b2d';c.beginPath();c.arc(m.x*w,m.y*h,r,0,Math.PI*2);c.fill();c.strokeStyle='#fff';c.lineWidth=2.5*unit;c.stroke();c.fillStyle='#fff';c.font=`bold ${19*unit}px Arial`;c.textAlign='center';c.textBaseline='middle';c.fillText(m.number,m.x*w,m.y*h+unit)}
  else if(m.type==='text'){const t=m.text||'Text';fitText(c,t,W,H);c.textAlign='center';c.textBaseline='middle';c.lineWidth=Math.max(2,H*.12);c.strokeStyle=m.color==='#FFFFFF'?'#000':'#fff';c.strokeText(t,X+W/2,Y+H/2);c.fillStyle=m.color;c.fillText(t,X+W/2,Y+H/2)}
  else if(m.type==='torque'){const t=m.text||'8Nm';c.fillStyle='#fff';c.fillRect(X,Y,W,H);c.strokeStyle='#000';c.lineWidth=Math.max(2,H*.07);c.strokeRect(X,Y,W,H);fitText(c,t,W,H*.9);c.fillStyle='#000';c.textAlign='center';c.textBaseline='middle';c.fillText(t,X+W/2,Y+H/2+H*.03)}
  else if(m.type==='stamp'){const im=symImgs.get(m.sym);if(im)c.drawImage(im,X,Y,W,H)}
  else{c.globalAlpha=m.type==='highlight'?.35:1;c.lineWidth=(m.type==='highlight'?m.width*5:m.width)*unit;c.beginPath();m.points.forEach((p,i)=>i?c.lineTo(p.x*w,p.y*h):c.moveTo(p.x*w,p.y*h));c.stroke()}
  c.restore();
}
function handles(m){if(BOXLIKE.includes(m.type)){const b=norm(m);return [{k:'nw',x:b.x,y:b.y},{k:'ne',x:b.x+b.w,y:b.y},{k:'sw',x:b.x,y:b.y+b.h},{k:'se',x:b.x+b.w,y:b.y+b.h}]}if(m.type==='arrow')return [{k:'start',x:m.x,y:m.y},{k:'end',x:m.x2,y:m.y2}];return []}
function draw(){
  const p=edPhoto;if(!p||!imageCache)return;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(imageCache,0,0,canvas.width,canvas.height);
  for(const m of p.marks)paintMark(ctx,m,canvas.width,canvas.height);
  const sx=canvas.width/(canvas.getBoundingClientRect().width||canvas.width);
  const m=selMark();if(m){const b=bounds(m);ctx.save();ctx.strokeStyle='#176cdd';ctx.lineWidth=2*sx;ctx.setLineDash([6*sx,4*sx]);ctx.strokeRect(b.x*canvas.width-4*sx,b.y*canvas.height-4*sx,b.w*canvas.width+8*sx,b.h*canvas.height+8*sx);ctx.setLineDash([]);for(const hd of handles(m)){ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(hd.x*canvas.width,hd.y*canvas.height,11*sx,0,Math.PI*2);ctx.fill();ctx.stroke()}ctx.restore()}
  if(cropRect){const b=norm(cropRect),W=canvas.width,H=canvas.height;ctx.save();ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(0,0,W,b.y*H);ctx.fillRect(0,(b.y+b.h)*H,W,H);ctx.fillRect(0,b.y*H,b.x*W,b.h*H);ctx.fillRect((b.x+b.w)*W,b.y*H,W,b.h*H);ctx.strokeStyle='#fff';ctx.lineWidth=2*sx;ctx.setLineDash([8*sx,6*sx]);ctx.strokeRect(b.x*W,b.y*H,b.w*W,b.h*H);ctx.restore()}
}
function coords(e){const r=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}}
function handleHit(m,pt){if(!m)return null;const r=canvas.getBoundingClientRect();return handles(m).find(h=>Math.abs(h.x-pt.x)*r.width<=26&&Math.abs(h.y-pt.y)*r.height<=26)}
function hit(pt){const p=edPhoto,r=canvas.getBoundingClientRect(),px=20/r.width,py=20/r.height;return [selMark(),...p.marks.slice().reverse()].filter(Boolean).find(m=>{const b=bounds(m);return pt.x>=b.x-px&&pt.x<=b.x+b.w+px&&pt.y>=b.y-py&&pt.y<=b.y+b.h+py})}
function translate(m,o,dx,dy){const b=bounds(o);dx=Math.max(-b.x,Math.min(1-b.x-b.w,dx));dy=Math.max(-b.y,Math.min(1-b.y-b.h,dy));if(o.points)m.points=o.points.map(p=>({x:p.x+dx,y:p.y+dy}));else{m.x=o.x+dx;m.y=o.y+dy;if('x2' in o){m.x2=o.x2+dx;m.y2=o.y2+dy}}}
function resizeMark(m,o,k,pt){if(m.type==='arrow'){if(k==='start'){m.x=pt.x;m.y=pt.y}else{m.x2=pt.x;m.y2=pt.y}return}const b=norm(o),min=.012;let x=b.x,y=b.y,r=b.x+b.w,bt=b.y+b.h;if(k.includes('w'))x=Math.min(pt.x,r-min);if(k.includes('e'))r=Math.max(pt.x,x+min);if(k.includes('n'))y=Math.min(pt.y,bt-min);if(k.includes('s'))bt=Math.max(pt.y,y+min);m.x=x;m.y=y;m.x2=r;m.y2=bt}
function defaultBox(type,pt){const W=canvas.width,H=canvas.height;
  if(type==='stamp'){const s=symById(stampId),wN=s.cat==='mark'?.1:.28,hN=wN*W*(s.h/s.w)/H;return {x:pt.x-wN/2,y:pt.y-hN/2,x2:pt.x+wN/2,y2:pt.y+hN/2}}
  if(type==='torque'){const wN=.16,hN=wN*W*.42/H;return {x:pt.x-wN/2,y:pt.y-hN/2,x2:pt.x+wN/2,y2:pt.y+hN/2}}
  if(type==='text'){const wN=.3,hN=wN*W*.2/H;return {x:pt.x-wN/2,y:pt.y-hN/2,x2:pt.x+wN/2,y2:pt.y+hN/2}}
  const s=.12,hN=s*W/H;return {x:pt.x-s/2,y:pt.y-hN/2,x2:pt.x+s/2,y2:pt.y+hN/2}}
function clampBox(m){const b=norm(m);let dx=0,dy=0;if(b.x<0)dx=-b.x;if(b.x+b.w>1)dx=1-b.x-b.w;if(b.y<0)dy=-b.y;if(b.y+b.h>1)dy=1-b.y-b.h;m.x+=dx;m.x2+=dx;m.y+=dy;m.y2+=dy}
canvas.onpointerdown=e=>{
  if(e.button>0||gesture||!edPhoto)return;e.preventDefault();const p=edPhoto,pt=coords(e),before=snapshot();canvas.setPointerCapture(e.pointerId);
  if(tool==='crop'){cropRect={x:pt.x,y:pt.y,x2:pt.x,y2:pt.y};gesture={mode:'crop',pointer:e.pointerId};draw();return}
  if(tool==='select'){const cur=selMark(),hd=handleHit(cur,pt),m=hd?cur:hit(pt);selected=m?.id||null;if(m)gesture={id:m.id,pointer:e.pointerId,start:pt,original:structuredClone(m),mode:hd?'resize':'move',handle:hd?.k,before};draw();selectionUI();undoUI();return}
  const m={id:uid(),type:tool,color:edColor,width:edWidth,x:pt.x,y:pt.y,x2:pt.x,y2:pt.y,note:''};
  if(tool==='pen'||tool==='highlight')m.points=[pt];
  if(tool==='number')m.number=Math.max(0,...p.marks.filter(x=>x.type==='number').map(x=>+x.number))+1;
  if(tool==='text')m.text='Text';if(tool==='torque'){m.text=(active&&project&&current?(active().s.settings||'').match(/[\d.]+\s*N\s?m/i)?.[0]:'')||'8Nm';m.color='#000000'}
  if(tool==='stamp'){m.sym=stampId;Object.assign(m,defaultBox('stamp',pt));clampBox(m)}
  p.marks.push(m);selected=m.id;gesture={id:m.id,pointer:e.pointerId,start:pt,mode:'draw',before};draw();selectionUI();
};
canvas.onpointermove=e=>{
  if(!gesture||gesture.pointer!==e.pointerId)return;const pt=coords(e);
  if(gesture.mode==='crop'){cropRect.x2=pt.x;cropRect.y2=pt.y;draw();return}
  const m=edPhoto.marks.find(m=>m.id===gesture.id);if(!m)return;
  if(gesture.mode==='move')translate(m,gesture.original,pt.x-gesture.start.x,pt.y-gesture.start.y);
  else if(gesture.mode==='resize')resizeMark(m,gesture.original,gesture.handle,pt);
  else if(m.points)m.points.push(pt);else if(m.type!=='number'&&m.type!=='stamp'){m.x2=pt.x;m.y2=pt.y}
  draw();
};
function finishGesture(e){
  if(!gesture||(e&&e.pointerId!==gesture.pointer))return;const g=gesture;gesture=null;
  if(g.mode==='crop'){const b=norm(cropRect);if(b.w<.03||b.h<.03)cropRect=null;$('#crop-apply').hidden=!cropRect;draw();return}
  const p=edPhoto,m=p.marks.find(m=>m.id===g.id);
  if(g.mode==='draw'&&m){const b=bounds(m);if(['box','circle','text','torque'].includes(m.type)&&b.w+b.h<.02){Object.assign(m,defaultBox(m.type,g.start));clampBox(m)}
    else if(['arrow','pen','highlight'].includes(m.type)&&b.w+b.h<.006){p.marks=p.marks.filter(x=>x!==m);selected=null}}
  commitChange(g.before,g.mode);if(g.mode==='draw'&&!['pen','highlight','stamp'].includes(tool))setTool('select');afterMark();
  if(m&&g.mode==='draw'&&['number','text','torque'].includes(m.type)){$('#mark-note').focus();$('#mark-note').select()}
}
canvas.onpointerup=finishGesture;canvas.onpointercancel=()=>{if(!gesture)return;if(gesture.before){edPhoto.marks=gesture.before.marks;selected=gesture.before.selected}gesture=null;cropRect=null;afterMark(false)};
function setTool(v){tool=v;$$('[data-tool]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.tool===tool));canvas.style.cursor=tool==='select'?'grab':'crosshair';$('#stamp-palette').hidden=tool!=='stamp';if(tool!=='crop'){cropRect=null;$('#crop-apply').hidden=true}if(tool!=='select'){selected=null;selectionUI()}draw()}
$$('[data-tool]').forEach(b=>b.onclick=()=>setTool(tool===b.dataset.tool&&b.dataset.tool==='crop'?'select':b.dataset.tool));
function selectionUI(){const m=selMark();$('#selected-mark').hidden=!m;if(m){const isText=['text','torque'].includes(m.type);$('#mark-note').value=isText?(m.text||''):(m.note||'');$('#note-label').firstChild.textContent=isText?(m.type==='torque'?'Torque value':'Text'):m.type==='number'?`Note ${m.number}`:'Note (optional)';$('#mark-note').placeholder=isText?'e.g. 8Nm':'What should the operator notice?';}undoUI()}
function notesUI(){const p=edPhoto;$('#annotation-notes').innerHTML=p?p.marks.filter(m=>m.type==='number'||m.note).map(m=>`<div class="note-item"><b>${m.type==='number'?m.number:'•'}</b><span>${esc(m.note||'Add a note for this marker.')}</span></div>`).join(''):''}
let noteBefore=null;
$('#mark-note').onfocus=()=>{noteBefore=edPhoto?snapshot():null};
$('#mark-note').oninput=e=>{const m=selMark();if(!m)return;if(['text','torque'].includes(m.type))m.text=e.target.value;else m.note=e.target.value;draw();notesUI();scheduleSave()};
$('#mark-note').onblur=()=>{if(noteBefore&&edPhoto){commitChange(noteBefore,'note');undoUI()}noteBefore=null};
function historyAction(from,to){const p=edPhoto;if(!p)return;const h=historyFor(p);if(!h[from].length)return;const prev=h[from].pop();h[to].push({...snapshot(),label:prev.label});
  const srcChanged=prev.src!==p.src;p.marks=prev.marks;p.src=prev.src;p.width=prev.width;p.height=prev.height;selected=p.marks.some(m=>m.id===prev.selected)?prev.selected:null;
  if(srcChanged)loadImage(p.src).then(im=>{imageCache=im;canvas.width=p.width;canvas.height=p.height;fitCanvas();afterMark()});else afterMark()}
$('#undo').onclick=()=>historyAction('undo','redo');$('#redo').onclick=()=>historyAction('redo','undo');
$('#delete-mark').onclick=()=>{if(!selected)return;change('delete',()=>{edPhoto.marks=edPhoto.marks.filter(m=>m.id!==selected);selected=null})};
$$('[data-scale]').forEach(b=>b.onclick=()=>{const m=selMark();if(!m||m.points||m.type==='number')return;change('resize',()=>{const f=+b.dataset.scale,cx=(m.x+m.x2)/2,cy=(m.y+m.y2)/2;for(const [k,c] of [['x',cx],['x2',cx],['y',cy],['y2',cy]])m[k]=Math.max(0,Math.min(1,c+(m[k]-c)*f))})});
function nudge(dir){const m=selMark();if(!m)return;change('move',()=>translate(m,structuredClone(m),dir==='left'?-.01:dir==='right'?.01:0,dir==='up'?-.01:dir==='down'?.01:0))}
document.addEventListener('keydown',e=>{if(!edPhoto||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();historyAction(e.shiftKey?'redo':'undo',e.shiftKey?'undo':'redo');return}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();historyAction('redo','undo');return}
  if(e.key==='Escape'){if(selected){selected=null;selectionUI();draw()}else closeEditor();return}
  const map={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'};if(map[e.key]&&selected){e.preventDefault();nudge(map[e.key])}
  if((e.key==='Delete'||e.key==='Backspace')&&selected){e.preventDefault();$('#delete-mark').click()}});
async function replaceImage(label,drawFn,W,H,mapPt){ // crop / rotate: new src, remapped marks
  const p=edPhoto,before=snapshot(),im=await loadImage(p.src),c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,W,H);drawFn(g,im);
  p.src=c.toDataURL('image/jpeg',.92);p.width=W;p.height=H;
  p.marks=p.marks.map(m=>{const n=structuredClone(m);if(n.points){n.points=n.points.map(mapPt)}else{const a=mapPt({x:n.x,y:n.y});n.x=a.x;n.y=a.y;if('x2' in n){const b=mapPt({x:n.x2,y:n.y2});n.x2=b.x;n.y2=b.y}}return n})
    .filter(m=>{const b=bounds(m);return b.x+b.w>0&&b.y+b.h>0&&b.x<1&&b.y<1}).map(m=>{const cl=v=>Math.max(0,Math.min(1,v));if(m.points)m.points=m.points.map(q=>({x:cl(q.x),y:cl(q.y)}));else{m.x=cl(m.x);m.y=cl(m.y);if('x2' in m){m.x2=cl(m.x2);m.y2=cl(m.y2)}}return m});
  selected=null;commitChange(before,label);imageCache=await loadImage(p.src);canvas.width=W;canvas.height=H;fitCanvas();afterMark();
}
$('#ed-rotate').onclick=()=>{const p=edPhoto;if(!p)return;replaceImage('rotate',(g,im)=>{g.translate(p.height,0);g.rotate(Math.PI/2);g.drawImage(im,0,0,p.width,p.height)},p.height,p.width,q=>({x:1-q.y,y:q.x}))};
$('#crop-apply').onclick=()=>{const p=edPhoto;if(!p||!cropRect)return;const b=norm(cropRect),sx=Math.round(b.x*p.width),sy=Math.round(b.y*p.height),sw=Math.max(8,Math.round(b.w*p.width)),sh=Math.max(8,Math.round(b.h*p.height));cropRect=null;$('#crop-apply').hidden=true;setTool('select');
  replaceImage('crop',(g,im)=>g.drawImage(im,sx,sy,sw,sh,0,0,sw,sh),sw,sh,q=>({x:(q.x-b.x)/b.w,y:(q.y-b.y)/b.h}))};
$('#reset-photo').onclick=async()=>{const p=edPhoto;if(!p||!await confirmAction('Reset picture?','Crop, rotation and all marks will be removed. The original picture is kept.','Reset'))return;const before=snapshot();const im=await loadImage(p.original),s=Math.min(1,2000/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.round(im.width*s);c.height=Math.round(im.height*s);c.getContext('2d').drawImage(im,0,0,c.width,c.height);p.src=c.toDataURL('image/jpeg',.9);p.width=c.width;p.height=c.height;p.marks=[];selected=null;commitChange(before,'reset');imageCache=await loadImage(p.src);canvas.width=p.width;canvas.height=p.height;fitCanvas();afterMark()};
$('#photo-caption').oninput=e=>{if(edPhoto){edPhoto.caption=e.target.value;scheduleSave()}};
$('#download-photo').onclick=async()=>{try{download(dataBlob(await markedImage(edPhoto)),`${filename()}-picture.png`)}catch{toast('Could not export this picture.')}};
$('#remove-photo').onclick=async()=>{const p=edPhoto;if(!p||!await confirmAction('Remove this picture?','The picture and its marks will be removed.','Remove'))return;
  for(const c of project.chapters)for(const s of c.steps)s.photos=s.photos.filter(x=>x!==p);for(const k of ['cover','workspace'])if(project.details[k]===p)project.details[k]=null;closeEditor()};
async function markedImage(p){await symbolsReady;const im=await loadImage(p.src),c=document.createElement('canvas');c.width=p.width;c.height=p.height;const g=c.getContext('2d');g.drawImage(im,0,0,c.width,c.height);p.marks.forEach(m=>paintMark(g,m,c.width,c.height));return c.toDataURL('image/png')}

/* ---------- HTML preview (mirrors the Word template) ---------- */
function para(t,cls=''){return t?`<p class="${cls}">${esc(t)}</p>`:''}
function qualityHTML(req,checks,level='h4'){const items=lines(checks);return `<section class="quality"><${level}>Quality Points</${level}>${para(req||'Requires engineer confirmation.',req?'':'pending')}${items.length?'<ul>'+items.map(t=>`<li>${esc(t)}</li>`).join('')+'</ul>':''}</section>`}
const warnIco=()=>symById('mk-warning')?.src||'';
function actionHTML(n,s){const L=String(s.action||'').split('\n');let sub=0,out='';for(const l of L){if(!l.trim())continue;if(/^\s*[-•*]/.test(l)){out+=`<p class="subp"><b>${n}.${String.fromCharCode(97+sub++)}</b>&nbsp;&nbsp;${esc(l.replace(/^\s*[-•*]\s*/,''))}</p>`}else out+=para(l)}return out||para('Action requires engineer confirmation.','pending')}
async function figureHTML(p,fig,label){return `<figure><img src="${await markedImage(p)}" alt="${esc(p.caption||label)}"><figcaption>Fig. ${fig}${p.caption?' — '+esc(p.caption):''}</figcaption>${p.marks.filter(m=>m.type==='number'||m.note).sort((a,b)=>(a.number||99)-(b.number||99)).map(m=>para(`${m.type==='number'?m.number+'. ':''}${m.note||'Annotation explanation requires confirmation.'}`)).join('')}</figure>`}
async function stepHTML(c,s,counter){
  const n=`${project.chapters.indexOf(c)+1}.${c.steps.indexOf(s)+1}`,on=k=>s.enabled.includes(k);
  let h=`<section class="doc-step">`;
  if(on('support'))h+=`<div class="box support"><span class="lbl">Support Information:</span>${para(s.support||'Requires confirmation.')}</div>`;
  if(on('safety'))h+=`<div class="box safety"><img class="ico" src="${warnIco()}" alt=""><span class="lbl">Safety Point:</span>${para(s.safety||'Requires confirmation.')}${s.ppe.map(id=>`<img class="ppe" src="${symById(id).src}" alt="${esc(symById(id).label)}">`).join('')}</div>`;
  if(on('quality'))h+=`<div class="box quality"><img class="ico" src="${warnIco()}" alt="">${qualityHTML(s.quality,s.qualityChecks)}</div>`;
  h+=`<h3>${project.details.documentType==='va'?'':n+'&nbsp;&nbsp;'}${esc(s.title||'Untitled step')}</h3>${project.details.documentType==='va'&&!s.action?'':actionHTML(n,s)}`;
  if(on('settings'))h+=`<p><b>Torque / setting: ${esc(s.settings||'REQUIRES CONFIRMATION')}</b></p>`;
  if(s.result)h+=`<p><b>Check:</b> ${esc(s.result)}</p>`;
  if(on('exception'))h+=`<p><b>If it goes wrong:</b> ${esc(s.exception||'Requires confirmation.')}</p>`;
  if(on('variant'))h+=`<p><b>Variant:</b> ${esc(s.variant||'Requires confirmation.')}</p>`;
  if(s.photos.length){h+='<div class="doc-images">';for(const p of s.photos)h+=await figureHTML(p,++counter.n,s.title);h+='</div>'}
  h+=tablesHTML(s.tables);
  for(const m of s.media)h+=`<p class="doc-meta"><b>Recording: ${esc(m.name)}</b> — ${esc(m.note||'explanation not supplied')} (kept in backup, not in Word)</p>`;
  return h+'</section>';
}
function missing(){const m=[],d=project.details;if(!/^(WM|TWP|VA)\.[A-Z0-9]+\.\d{3,4}\.V[\d.]+$/.test(d.number))m.push('Document number');if(d.documentType==='wm'&&!d.scope)m.push('Scope');if(d.documentType!=='va'&&!d.risk)m.push('Risk assessment');
  for(const c of project.chapters)for(const s of c.steps){if(!s.action&&!(s.photos.length||s.tables?.length))m.push(`${s.title}: instruction`);for(const k of s.enabled)if(!s[k])m.push(`${s.title}: ${extraDefs[k][0]}`);for(const p of s.photos)for(const mk of p.marks)if(mk.type==='number'&&!mk.note)m.push(`${s.title}: note ${mk.number}`)}return m}
async function previewAll(){
  applyPageSetup();if(project.details.documentType!=='wm')return previewSpecial();
  const d=project.details,gaps=missing();$('#review-alert').textContent=gaps.length?`${gaps.length} item(s) need confirmation: ${gaps.slice(0,5).join(' · ')}${gaps.length>5?' …':''}`:'All capture fields complete. Engineering review still required.';$('#review-alert').classList.toggle('ok',!gaps.length);
  const counter={n:0},logo=symById('logo')?.src,rows=['Manufacturing Engineering','Production','Quality','Tooling','Training'];
  let h=`<div class="doc-header"><img src="${logo}" alt="Brompton"><span><b>${esc(d.title)}</b><br>${esc(d.number)}</span></div>`;
  if(settings.draftMark!==false)h+=`<p class="pending"><b>DRAFT — NOT APPROVED FOR OPERATION</b></p>`;
  h+=`<h1>${esc(d.title)}</h1><p><b>${esc(d.number)}</b></p><table class="appr"><tr><th>Version</th><th>Reason</th><th>Author</th><th>Approved by</th><th>Initials</th><th>Date</th></tr>${rows.map((r,i)=>`<tr>${i?'':`<td rowspan="5">${esc(d.revision)}</td><td rowspan="5">${esc(d.reason)}</td><td rowspan="5">${esc(d.author)}</td>`}<td>${r}</td><td></td><td>${i?'':esc(ukDate(d.date))}</td></tr>`).join('')}</table>`;
  h+=`<p style="color:#808080"><b>Works Manual</b></p><h2>${esc(d.title)}</h2><p><b>${esc(d.number)}</b></p><p>This Manual is applicable to the following (for guidance only):</p><div class="applic"><b>BIKE TYPE</b>: ${esc(d.product)}<br><b>TYPE</b>: ${esc(d.type)}<br><b>VERSION</b>: ${esc(d.appVersion)}<br><b>MARK</b>: ${esc(d.mark)}<br><b>SPEED</b>: ${esc(d.speed)}<br><b>VARIANTS</b>: ${esc(d.variants)}</div>`;
  if(d.cover)h+=await figureHTML(d.cover,++counter.n,'Cover');
  h+=`<h2 class="chap">PREVIOUS VERSIONS</h2>${para(d.previousVersions||'None, first issue.')}<h2>CONTENTS</h2><p class="doc-meta">(Generated in Word)</p><h2>SCOPE</h2>${para(d.scope||'Requires engineer confirmation.',d.scope?'':'pending')}<h2>OVERVIEW</h2>`;
  const ov=String(d.overview||'').split('\n').filter(x=>x.trim());h+=ov.length?ov.map(l=>/^\s*[-•*]/.test(l)?`<ul><li>${esc(l.replace(/^\s*[-•*]\s*/,''))}</li></ul>`:para(l)).join(''):para('Requires engineer confirmation.','pending');
  const hz=d.hazards.map(symById),md=d.mandatory.map(symById),ad=lines(d.advisory),nr=Math.max(hz.length,md.length,ad.length,1);
  h+=`<h2>HEALTH &amp; SAFETY</h2><table class="hs"><tr><th class="hz">HAZARDS</th><th class="md">MANDATORY</th><th class="ad">ADVISORY</th></tr>${Array.from({length:nr},(_,i)=>`<tr><td>${hz[i]?`<img src="${hz[i].src}" alt="${esc(hz[i].label)}">`:''}</td><td>${md[i]?`<img src="${md[i].src}" alt="${esc(md[i].label)}">`:''}</td><td>${esc(ad[i]||'')}</td></tr>`).join('')}</table>`;
  h+=`<p class="red">Safety Points</p><ul>${lines(d.safety).map(t=>`<li>${esc(t)}</li>`).join('')||'<li class="pending">Requires confirmation</li>'}</ul><h3>Risk Assessment</h3>${para(d.risk||'N/A')}`;
  h+=`<h2>QUALITY</h2><p><b>Inspect every item</b> prior to fitment and <b>reject</b> items that show signs of damage or poor quality. Ask your Team Leader if in doubt.</p>${qualityHTML(d.quality,d.qualityChecks,'h4')}`;
  h+=`<h3>Workspace example</h3>${para(d.workspaceNote)}`;if(d.workspace)h+=await figureHTML(d.workspace,++counter.n,'Workspace');
  h+=`<h2 class="chap">PROCEDURE</h2><p class="procnote">Only carry out the following procedure if you are authorised and qualified to do so.</p>`;
  for(const [i,c] of project.chapters.entries()){h+=`<h2 class="${i?'chap':''}">${i+1}.&nbsp;&nbsp;${esc(c.title)}</h2>`;for(const s of c.steps)h+=await stepHTML(c,s,counter)}
  h+='<p class="end">END OF PROCEDURE</p>';$('#document-preview').innerHTML=h;
}
$('#print').onclick=async()=>{await setPage('preview');await Promise.all($$('#document-preview img').map(i=>i.decode?i.decode().catch(()=>{}):Promise.resolve()));window.print()};
$('#btn-preview').onclick=()=>setPage('preview');

/* ---------- Word export (Brompton WM template) ---------- */
async function buildWord(){
  if(project.details.documentType!=='wm')return buildSpecialWord();
  if(!window.docx)throw Error('Word exporter did not load. Reload the page.');
  await symbolsReady;const D=window.docx,d=project.details,CW=9906,rows=['Manufacturing Engineering','Production','Quality','Tooling','Training'];
  const B={style:D.BorderStyle.SINGLE,size:4,color:'808080'},borders={top:B,bottom:B,left:B,right:B},NB={style:D.BorderStyle.NONE,size:0,color:'FFFFFF'},noBorders={top:NB,bottom:NB,left:NB,right:NB};
  const T=(t,o={})=>new D.TextRun({text:String(t??''),...o});
  const P=(children,o={})=>new D.Paragraph({children:Array.isArray(children)?children:[typeof children==='string'?T(children):children],spacing:{after:100},...o});
  const H1=(t,o={})=>new D.Paragraph({text:t,heading:D.HeadingLevel.HEADING_1,keepNext:true,...o});
  const H2=(t,o={})=>new D.Paragraph({text:t,heading:D.HeadingLevel.HEADING_2,keepNext:true,...o});
  const pend=t=>T(t||'REQUIRES ENGINEER CONFIRMATION',t?{}:{color:'9B4328',italics:true});
  const img=async(dataURL,w,h,alt)=>{const png=dataURL.startsWith('data:image/png'),data=dataBytes(dataURL);return new D.ImageRun({type:png?'png':'jpg',data,transformation:{width:Math.round(w),height:Math.round(h)},altText:{title:alt||'Picture',description:alt||'Picture',name:alt||'Picture'}})};
  const symRun=async(id,w)=>{const s=symById(id);return img(s.src,w,w*s.h/s.w,s.label)};
  const cell=(children,o={})=>new D.TableCell({borders,margins:{top:60,bottom:60,left:100,right:100},children:Array.isArray(children)?children:[children],...o});
  const bullet=t=>new D.Paragraph({children:[T(t)],bullet:{level:0},spacing:{after:60}});
  let fig=0;const out=[];
  const figure=async(p,maxW=560,maxH=380)=>{const src=await markedImage(p),s=Math.min(maxW/p.width,maxH/p.height,1);fig++;const r=[new D.Paragraph({alignment:D.AlignmentType.CENTER,keepNext:true,spacing:{before:120,after:40},children:[await img(src,p.width*s,p.height*s,p.caption||`Figure ${fig}`)]}),new D.Paragraph({alignment:D.AlignmentType.CENTER,spacing:{after:80},children:[T(`Fig. ${fig}${p.caption?' — '+p.caption:''}`,{color:'2B579A',size:18})]})];
    for(const m of p.marks.filter(m=>m.type==='number'||m.note).sort((a,b)=>(a.number||99)-(b.number||99)))r.push(P([T(m.type==='number'?m.number+'.  ':'•  ',{bold:true}),T(m.note||'REQUIRES ENGINEER CONFIRMATION')],{indent:{left:360}}));return r};
  const quality=(req,checks)=>[new D.Paragraph({keepNext:true,spacing:{before:120,after:80},children:[T('Quality Points',{bold:true,color:'00B050',size:28})]}),P(pend(req)),...lines(checks).map(bullet)];
  const box=async(kind,children)=>{const col={support:'0070C0',safety:'FF0000',quality:'00B050'}[kind],bb={style:D.BorderStyle.SINGLE,size:12,color:col},bx={top:bb,bottom:bb,left:bb,right:bb};
    const icon=kind==='support'?[]:[new D.TableCell({borders:{...bx,right:NB},width:{size:900,type:D.WidthType.DXA},verticalAlign:D.VerticalAlign.CENTER,margins:{top:80,bottom:80,left:100,right:60},children:[new D.Paragraph({children:[await symRun('mk-warning',38)]})]})];
    const w=kind==='support'?CW:CW-900;
    return new D.Table({width:{size:CW,type:D.WidthType.DXA},columnWidths:kind==='support'?[CW]:[900,w],rows:[new D.TableRow({cantSplit:true,children:[...icon,new D.TableCell({borders:kind==='support'?bx:{...bx,left:NB},width:{size:w,type:D.WidthType.DXA},margins:{top:80,bottom:80,left:140,right:140},children})]})]})};
  const gap=()=>new D.Paragraph({spacing:{after:60},children:[]});

  // ---- cover page
  out.push(P(T(d.title,{bold:true,size:36}),{spacing:{before:120,after:60}}),P(T(d.number,{bold:true,size:24}),{spacing:{after:200}}));
  const cw=[1000,1700,1500,2606,1300,1800],hdr=['Version','Reason','Author','Approved by','Initials','Date'];
  out.push(new D.Table({width:{size:CW,type:D.WidthType.DXA},columnWidths:cw,rows:[
    new D.TableRow({tableHeader:true,children:hdr.map((t,i)=>cell(P(T(t,{bold:true,size:18})),{width:{size:cw[i],type:D.WidthType.DXA},shading:{fill:'E7E6E6',type:D.ShadingType.CLEAR,color:'auto'}}))}),
    ...rows.map((r,i)=>new D.TableRow({children:[...(i?[]:[cell(P(T(d.revision,{size:18})),{rowSpan:5,width:{size:cw[0],type:D.WidthType.DXA}}),cell(P(T(d.reason,{size:18})),{rowSpan:5,width:{size:cw[1],type:D.WidthType.DXA}}),cell(P(T(d.author,{size:18})),{rowSpan:5,width:{size:cw[2],type:D.WidthType.DXA}})]),
      cell(P(T(r,{size:18})),{width:{size:cw[3],type:D.WidthType.DXA}}),cell(P(''),{width:{size:cw[4],type:D.WidthType.DXA}}),cell(P(T(i?'':ukDate(d.date),{size:18})),{width:{size:cw[5],type:D.WidthType.DXA}})]}))]}));
  out.push(P(T('Works Manual',{bold:true,color:'808080',size:28}),{spacing:{before:360,after:40}}),P(T(d.title,{bold:true,size:32})),P(T(d.number,{bold:true,size:24}),{spacing:{after:200}}),P('This Manual is applicable to the following (for guidance only):'));
  for(const [k,v] of [['BIKE TYPE',d.product],['TYPE',d.type],['VERSION',d.appVersion],['MARK',d.mark],['SPEED',d.speed],['VARIANTS',d.variants]])out.push(P([T(k,{bold:true}),T(': '+(v||''))],{spacing:{after:40}}));
  if(d.cover)out.push(...await figure(d.cover,480,330));
  if(settings.draftMark!==false)out.push(P(T('DRAFT SOURCE DOCUMENT — NOT APPROVED FOR OPERATION',{bold:true,color:'9B4328'}),{spacing:{before:200}}));
  // ---- front matter
  out.push(new D.Paragraph({children:[new D.PageBreak()]}),H1('PREVIOUS VERSIONS'),P(d.previousVersions||'None, first issue.'),H1('CONTENTS'),new D.TableOfContents('Contents',{hyperlink:true,headingStyleRange:'1-1'}));
  out.push(H1('SCOPE'),P(pend(d.scope)),H1('OVERVIEW'));
  const ov=String(d.overview||'').split('\n').filter(x=>x.trim());if(!ov.length)out.push(P(pend('')));for(const l of ov)out.push(/^\s*[-•*]/.test(l)?bullet(l.replace(/^\s*[-•*]\s*/,'')):P(l));
  out.push(H1('HEALTH & SAFETY'));
  const hz=d.hazards,md=d.mandatory,ad=lines(d.advisory),nr=Math.max(hz.length,md.length,ad.length,1),c3=[3302,3302,3302];
  const hcell=(t,fill,color)=>cell(new D.Paragraph({alignment:D.AlignmentType.CENTER,children:[T(t,{bold:true,color})]}),{width:{size:3302,type:D.WidthType.DXA},shading:{fill,type:D.ShadingType.CLEAR,color:'auto'}});
  const hsRows=[new D.TableRow({tableHeader:true,children:[hcell('HAZARDS','FFE600','000000'),hcell('MANDATORY','2F5597','FFFFFF'),hcell('ADVISORY','00B050','FFFFFF')]})];
  for(let i=0;i<nr;i++)hsRows.push(new D.TableRow({cantSplit:true,children:[cell(new D.Paragraph({children:hz[i]?[await symRun(hz[i],170)]:[]}),{width:{size:3302,type:D.WidthType.DXA}}),cell(new D.Paragraph({children:md[i]?[await symRun(md[i],170)]:[]}),{width:{size:3302,type:D.WidthType.DXA}}),cell(P(T(ad[i]||'',{color:'00B050',bold:true})),{width:{size:3302,type:D.WidthType.DXA}})]}));
  out.push(new D.Table({width:{size:CW,type:D.WidthType.DXA},columnWidths:c3,rows:hsRows}));
  out.push(new D.Paragraph({heading:D.HeadingLevel.HEADING_2,keepNext:true,children:[T('Safety Points',{color:'FF0000',bold:true})]}),...(lines(d.safety).length?lines(d.safety).map(bullet):[P(pend(''))]),H2('Risk Assessment'),P(d.risk||'N/A'));
  out.push(H1('QUALITY'),P([T('Inspect every item',{bold:true}),T(' prior to fitment and '),T('reject',{bold:true}),T(' items that show signs of damage or poor quality.')],{spacing:{after:40}}),P('Ask your Team Leader if in doubt.'),...quality(d.quality,d.qualityChecks));
  out.push(H2('Workspace example'),P(d.workspaceNote||''));if(d.workspace)out.push(...await figure(d.workspace));
  // ---- procedure
  out.push(new D.Paragraph({children:[new D.PageBreak()]}),H1('PROCEDURE'),P(T('Only carry out the following procedure if you are authorised and qualified to do so.',{italics:true,color:'595959'})));
  for(const [ci,c] of project.chapters.entries()){
    out.push(H1(`${ci+1}.  ${c.title}`,ci?{pageBreakBefore:true}:{}));
    for(const [si,s] of c.steps.entries()){const n=`${ci+1}.${si+1}`,on=k=>s.enabled.includes(k);
      if(on('support'))out.push(await box('support',[P([T('Support Information: ',{bold:true,color:'0070C0'})]),...String(s.support||'REQUIRES CONFIRMATION').split('\n').map(l=>P(T(l,{color:'0070C0'})))]),gap());
      if(on('safety')){const ppe=[];if(s.ppe.length)ppe.push(new D.Paragraph({children:(await Promise.all(s.ppe.map(id=>symRun(id,150)))).flatMap((r,i)=>i?[T('  '),r]:[r])}));out.push(await box('safety',[P(T('Safety Point:',{bold:true,color:'FF0000'})),...String(s.safety||'REQUIRES CONFIRMATION').split('\n').map(l=>P(l)),...ppe]),gap())}
      if(on('quality'))out.push(await box('quality',[P(T('Important Point:',{bold:true,color:'00B050'})),...quality(s.quality,s.qualityChecks)]),gap());
      out.push(new D.Paragraph({keepNext:true,spacing:{before:160,after:80},tabStops:[{type:D.TabStopType.LEFT,position:720}],children:[T(n,{bold:true}),new D.TextRun({children:[new D.Tab()]}),T(s.title||'',{bold:true})]}));
      let sub=0;const al=String(s.action||'').split('\n').filter(l=>l.trim());if(!al.length)out.push(P(pend(''),{indent:{left:720}}));
      for(const l of al){if(/^\s*[-•*]/.test(l))out.push(new D.Paragraph({spacing:{after:60},indent:{left:1440,hanging:720},tabStops:[{type:D.TabStopType.LEFT,position:1440}],children:[T(`${n}.${String.fromCharCode(97+sub++)}`),new D.TextRun({children:[new D.Tab()]}),T(l.replace(/^\s*[-•*]\s*/,''))]}));else out.push(P(l,{indent:{left:720}}))}
      if(on('settings'))out.push(P([T('Torque / setting: '),T(s.settings||'REQUIRES CONFIRMATION',{bold:true})],{indent:{left:720}}));
      if(s.result)out.push(P([T('Check: ',{bold:true}),T(s.result)],{indent:{left:720}}));
      if(on('exception'))out.push(P([T('If it goes wrong: ',{bold:true}),pend(s.exception)],{indent:{left:720}}));
      if(on('variant'))out.push(P([T('Variant: ',{bold:true}),pend(s.variant)],{indent:{left:720}}));
      if(s.photos.length===1)out.push(...await figure(s.photos[0]));
      else if(s.photos.length>1){const trs=[];for(let i=0;i<s.photos.length;i+=2){const pair=s.photos.slice(i,i+2),cells=[];for(const p of pair)cells.push(new D.TableCell({borders:noBorders,width:{size:CW/2,type:D.WidthType.DXA},children:await figure(p,300,300)}));if(cells.length<2)cells.push(new D.TableCell({borders:noBorders,width:{size:CW/2,type:D.WidthType.DXA},children:[P('')]}));trs.push(new D.TableRow({cantSplit:true,children:cells}))}out.push(new D.Table({width:{size:CW,type:D.WidthType.DXA},columnWidths:[CW/2,CW/2],borders:D.TableBorders.NONE,rows:trs}))}
      for(const t of s.tables||[])out.push(new D.Table({width:{size:CW,type:D.WidthType.DXA},columnWidths:t.headers.map(()=>Math.floor(CW/t.headers.length)),rows:[t.headers,...t.rows].map((r,ri)=>new D.TableRow({tableHeader:ri===0,children:r.map(v=>cell(String(v).split('\n').map(l=>P(T(l,{bold:ri===0}))),{width:{size:Math.floor(CW/t.headers.length),type:D.WidthType.DXA}}))}))}),gap());
      for(const m of s.media)out.push(P([T(`Recording: ${m.name} — `,{italics:true,size:18}),T(m.note||'see Works Capture backup',{italics:true,size:18})],{indent:{left:720}}));
    }
  }
  out.push(new D.Paragraph({alignment:D.AlignmentType.CENTER,spacing:{before:480},children:[T('END OF PROCEDURE',{bold:true})]}));
  const logo=symById('logo');
  const header=new D.Header({children:[new D.Paragraph({tabStops:[{type:D.TabStopType.RIGHT,position:CW}],children:[await img(logo.src,200,200*logo.h/logo.w,'Brompton'),new D.TextRun({children:[new D.Tab()]}),T(d.number,{bold:true,size:18})]}),new D.Paragraph({tabStops:[{type:D.TabStopType.RIGHT,position:CW}],border:{bottom:{style:D.BorderStyle.SINGLE,size:6,color:'808080',space:4}},children:[new D.TextRun({children:[new D.Tab()]}),T(d.title,{size:18})]})]});
  const footer=new D.Footer({children:[new D.Paragraph({alignment:D.AlignmentType.CENTER,children:[new D.TextRun({children:['Page ',D.PageNumber.CURRENT,' of ',D.PageNumber.TOTAL_PAGES],size:18})]})]});
  const doc=new D.Document({creator:d.author||'Works Capture',title:`${d.number} ${d.title}`,description:'Works Manual source document',features:{updateFields:true},
    styles:{default:{document:{run:{font:'Arial',size:22}}},paragraphStyles:[
      {id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:26,bold:true,color:'0D0D0D'},paragraph:{spacing:{before:300,after:140},outlineLevel:0}},
      {id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:22,bold:true,color:'000000'},paragraph:{spacing:{before:200,after:100},outlineLevel:1}}]},
    sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1300,bottom:1000,left:1000,right:1000,header:500,footer:500}}},headers:{default:header},footers:{default:footer},children:out}]});
  return D.Packer.toBlob(doc);
}
async function exportWord(){try{toast('Preparing Word…',2000);await flushSave();download(await buildWord(),filename()+'.docx');toast('Word manual downloaded. Word may ask to update the contents table — choose Yes.')}catch(e){console.error(e);toast(e.message||'Word export failed.')}}

$('#btn-export').onclick=()=>{$('#export-dialog').showModal();$('#export-dialog').onclose=()=>{const v=$('#export-dialog').returnValue;if(v==='word')exportWord();if(v==='print')$('#print').click()}};

/* ---------- backups ---------- */
$('#import-backup').onclick=()=>$('#backup-input').click();
$('#backup-all').onclick=async()=>{const all=await idb('manuals','readonly',s=>s.getAll());download(new Blob([JSON.stringify({format:'works-capture-library',version:2,exported:new Date().toISOString(),manuals:all})],{type:'application/json'}),`works-capture-library-${today()}.json`);toast(`${all.length} manual(s) backed up.`)};
$('#backup-input').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;
  try{if(f.size>400*1024*1024)throw Error('Backup is too large (400 MB limit).');const raw=JSON.parse(await f.text());const list=raw.format==='works-capture-library'?raw.manuals:[raw];let n=0;
    for(const item of list){const m=normalise(item);if(await getManual(m.id)){if(!await confirmAction('Manual already in library',`“${m.details.title}” is already here. Replace it with the backup? Choose Cancel to add it as a copy.`,'Replace'))m.id=uid()}m.saveRev=Math.max(m.saveRev,((await getManual(m.id))?.saveRev||0)+1);await putManual(m);index[m.id]=await summary(m);n++}
    await saveIndex();libraryUI();toast(`${n} manual(s) opened into the library.`)}catch(err){toast(err.message||'Could not open backup.')}};

/* ---------- optional page tools (read-only) ---------- */
function registerTools(){const ctx=document.modelContext;if(!ctx?.registerTool)return;try{Promise.resolve(ctx.registerTool({name:'read_manual_outline',title:'Read manual outline',description:'Read the open manual outline and fields needing confirmation. Local only; does not export or send files.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input){if(!input||typeof input!=='object'||Object.keys(input).length)throw Error('Expected an empty object');if(!project)return {library:Object.values(index).map(e=>({title:e.title,number:e.number}))};return {number:project.details.number,title:project.details.title,chapters:project.chapters.map(c=>({title:c.title,steps:c.steps.map(s=>({title:s.title,photos:s.photos.length}))})),missing:missing()}}})).catch(()=>{})}catch{}}

/* ---------- start ---------- */
(async()=>{
  preloadSymbols();
  try{db=await openDB();settings=Object.assign(settings,await getSetting('settings')||{});settings.areaCodes={...DEFAULT_CODES,...(settings.areaCodes||{})};index=await getSetting('index')||{};
    await migrateLegacy();if(!Object.keys(index).length)await rebuildIndex();
    if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{});
    setStatus('Saved on this device');
  }catch(e){console.error(e);setStatus('Storage unavailable — use backups',true);toast('Browser storage is unavailable (private mode?). Export backups to keep work.',9000)}
  const last=settings.lastOpen&&index[settings.lastOpen];
  if(last&&new URLSearchParams(location.search).get('library')===null)await openManual(settings.lastOpen);else await setPage('library');
  initImports();registerTools();
})();
