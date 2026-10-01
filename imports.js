'use strict';
/* Local-only DOCX conversion and spreadsheet paste. No services or account access. */
function parseExcelTSV(text){
 const rows=[];let row=[],cell='',quoted=false;const src=String(text).replace(/^\uFEFF/,'');
 for(let i=0;i<src.length;i++){const c=src[i];if(c==='"'){if(quoted&&src[i+1]==='"'){cell+='"';i++}else if(quoted||!cell)quoted=!quoted;else cell+=c}else if(!quoted&&(c==='\t'||c==='\n'||c==='\r')){row.push(cell);cell='';if(c!=='\t'){rows.push(row);row=[];if(c==='\r'&&src[i+1]==='\n')i++}}else cell+=c}
 if(quoted)throw Error('A quoted cell is incomplete. Copy the cells from Excel again.');row.push(cell);if(row.some(v=>v!=='')||!rows.length)rows.push(row);
 while(rows.length&&rows.at(-1).every(v=>v===''))rows.pop();if(!rows.length)throw Error('Paste some cells first.');const width=Math.max(...rows.map(r=>r.length));if(width>8||rows.length>101)throw Error('Use at most 8 columns and 100 data rows per table. Split the range into smaller tables.');return rows.map(r=>Array.from({length:width},(_,i)=>r[i]||''));
}
function pasteExcelTable(s){const dlg=$('#paste-table-dialog'),input=$('#paste-table-text');input.value='';dlg.showModal();input.focus();dlg.onclose=()=>{if(dlg.returnValue!=='insert')return;try{const rows=parseExcelTSV(input.value);s.tables??=[];if(s.tables.length>=30)throw Error('Use a new step for more tables.');s.tables.push({id:uid(),headers:rows[0],rows:rows.length>1?rows.slice(1):[rows[0].map(()=>'')]});scheduleSave();tableEditorUI();toast('Table added. Edit any heading or cell.')}catch(e){toast(e.message,8000)}}}
function xmlDoc(text){const d=new DOMParser().parseFromString(text,'application/xml');if(d.getElementsByTagName('parsererror').length)throw Error('The Word document contains invalid XML.');return d}
function xmlAll(n,name){return Array.from(n.getElementsByTagName('*')).filter(e=>e.localName===name)}
function xmlFirst(n,name){return xmlAll(n,name)[0]}
function xmlAttr(n,name){if(!n)return '';for(const a of Array.from(n.attributes||[]))if(a.localName===name)return a.value;return ''}
function xmlChildren(n){return Array.from(n.childNodes||[]).filter(x=>x.nodeType===1)}
function paragraphText(p){let text='';const walk=n=>{for(const c of Array.from(n.childNodes||[])){if(c.nodeType!==1)continue;if(c.localName==='del')continue;if(c.localName==='t')text+=c.textContent;else if(c.localName==='tab')text+='\t';else if(c.localName==='br'||c.localName==='cr')text+='\n';else walk(c)}};walk(p);return text.trim()}
function resolvePart(base,target){if(!target||/^[a-z]+:/i.test(target)||target.startsWith('//'))return null;const parts=target.startsWith('/')?[]:base.split('/').slice(0,-1);for(const part of target.split('/')){if(!part||part==='.')continue;if(part==='..'){if(!parts.length)return null;parts.pop()}else parts.push(part)}return parts.join('/')}
async function parseWordFile(file){
 if(!/\.docx$/i.test(file.name))throw Error('Choose a .docx file. Save older .doc files as .docx in Word first.');if(file.size>40*1024*1024)throw Error('Use a Word file smaller than 40 MB.');
 const zip=await JSZip.loadAsync(await file.arrayBuffer()),entries=Object.values(zip.files);if(entries.length>5000||entries.reduce((n,e)=>n+(e._data?.uncompressedSize||0),0)>200*1024*1024)throw Error('This Word file is too large to import on a tablet.');
 const bodyFile=zip.file('word/document.xml');if(!bodyFile)throw Error('This file is not a supported Word document.');const doc=xmlDoc(await bodyFile.async('string')),body=xmlFirst(doc,'body');if(!body)throw Error('The document body is missing.');
 const warnings=new Set(),blocks=[],rels=new Map(),styles=new Map();let imageCount=0;
 const relFile=zip.file('word/_rels/document.xml.rels');if(relFile){const rdoc=xmlDoc(await relFile.async('string'));for(const r of xmlAll(rdoc,'Relationship'))rels.set(xmlAttr(r,'Id'),{target:resolvePart('word/document.xml',xmlAttr(r,'Target')),external:xmlAttr(r,'TargetMode')==='External'})}
 const stylesFile=zip.file('word/styles.xml');if(stylesFile){for(const s of xmlAll(xmlDoc(await stylesFile.async('string')),'style'))styles.set(xmlAttr(s,'styleId'),{name:xmlAttr(xmlFirst(s,'name'),'val'),base:xmlAttr(xmlFirst(s,'basedOn'),'val'),level:xmlAttr(xmlFirst(s,'outlineLvl'),'val')})}
 function level(p){const direct=xmlFirst(p,'outlineLvl');if(direct)return Number(xmlAttr(direct,'val'))+1;let id=xmlAttr(xmlFirst(p,'pStyle'),'val'),seen=new Set();while(id&&!seen.has(id)){seen.add(id);const s=styles.get(id),name=s?.name||id;if(/^(title|document title)$/i.test(name))return 0;const m=name.match(/^heading\s*([1-9])/i);if(m)return +m[1];if(s?.level!==' '&&s?.level!==''&&s?.level!=null)return +s.level+1;id=s?.base}return null}
 async function pictures(node){const out=[];for(const n of [...xmlAll(node,'blip'),...xmlAll(node,'imagedata')]){const id=xmlAttr(n,'embed')||xmlAttr(n,'id')||xmlAttr(n,'link'),r=rels.get(id);if(!r||r.external){warnings.add('Linked pictures were not downloaded. Add them manually.');continue}const part=zip.file(r.target);if(!part)continue;const ext=r.target.split('.').pop().toLowerCase(),mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp'}[ext];if(!mime){warnings.add('Some vector pictures (such as EMF/WMF/SVG) need to be added as PNG or JPEG.');continue}if(++imageCount>150)throw Error('Use a document with at most 150 pictures, or split it before importing.');try{out.push(await makePhoto(`data:${mime};base64,${await part.async('base64')}`,r.target.split('/').pop()))}catch{warnings.add('One or more pictures could not be decoded. Reinsert them as JPEG or PNG.')}}return out}
 function rowsFor(table){const rows=xmlChildren(table).filter(n=>n.localName==='tr').map(row=>{const vals=[];for(const cell of xmlChildren(row).filter(n=>n.localName==='tc')){const text=xmlAll(cell,'p').map(paragraphText).filter(Boolean).join('\n'),span=Math.min(100,Math.max(1,+xmlAttr(xmlFirst(cell,'gridSpan'),'val')||1));vals.push(text,...Array(span-1).fill(''));if(span>1||xmlFirst(cell,'vMerge'))warnings.add('Merged table cells were flattened; check their alignment.')}return vals});const width=Math.max(0,...rows.map(r=>r.length));return rows.map(r=>Array.from({length:width},(_,i)=>r[i]||''))}
 async function walk(parent){for(const n of xmlChildren(parent)){if(n.localName==='p'){const text=paragraphText(n),images=await pictures(n);if(text||images.length)blocks.push({kind:'paragraph',text,level:level(n),list:!!xmlFirst(n,'numPr'),images})}else if(n.localName==='tbl'){const rows=rowsFor(n),images=await pictures(n);if(rows.length&&rows[0].length)blocks.push({kind:'table',rows,images});else if(images.length)blocks.push({kind:'paragraph',text:'',level:null,images});if(xmlAll(n,'tbl').length)warnings.add('Nested tables were flattened; check their order.')}else if(n.localName==='sdt'||n.localName==='sdtContent'||n.localName==='customXml')await walk(n)}}
 await walk(body);if(!blocks.length)throw Error('No editable text, tables or supported pictures were found. Scanned pages need OCR before import.');
 if(xmlAll(doc,'chart').length||xmlAll(doc,'OLEObject').length||xmlAll(doc,'altChunk').length)warnings.add('Charts, embedded objects or linked content need to be recreated or added as pictures.');
 if(xmlAll(doc,'ins').length||xmlAll(doc,'del').length)warnings.add('Tracked changes were flattened to their current text; review against the original.');
 if(entries.some(e=>/^word\/(header|footer|footnotes|endnotes|comments)\d*\.xml$/.test(e.name)))warnings.add('Source headers, footers, notes and comments are not converted. The selected template supplies new headers and page numbers.');
 warnings.add('Original fonts, page layout and text emphasis are replaced by the chosen template. Review important formatting and technical values.');
 return {blocks,warnings:[...warnings],sourceName:file.name};
}
function wordCapture(parsed,type,setup={}){
 const p=newManual(BUILTIN_TEMPLATES.find(t=>t.id===type)),d=p.details;Object.assign(d,setup);d.title=parsed.sourceName.replace(/\.docx$/i,'');d.scope='';d.risk='';p.chapters=[];let chapter=null,item=null,field=null;
 const ensureChapter=()=>{if(!chapter){chapter={id:uid(),title:'Imported content',steps:[]};p.chapters.push(chapter)}return chapter};
 const ensureStep=()=>{ensureChapter();if(!item){item=step('Imported content');chapter.steps.push(item)}return item};
 const append=(key,text)=>{if(text)d[key]=d[key]?d[key]+'\n'+text:text};
 const aliases={scope:'scope',overview:'overview','health and safety':'safety','health safety':'safety','safety points':'safety',safety:'safety',quality:'quality', 'quality points':'quality', 'quality checks':'qualityChecks','risk assessment':'risk','previous versions':'previousVersions'};
 for(const b of parsed.blocks){if(b.kind==='paragraph'){
 const clean=b.text.replace(/^\s*\d+(?:\.\d+)*[.)]?\s*/,'').replace(/&/g,'and').replace(/[^a-z0-9 ]/gi,'').trim().toLowerCase();const mapped=type!=='va'&&aliases[clean];
 if(b.level===0&&b.text){d.title=b.text;field=null;if(b.images.length)ensureStep().photos.push(...b.images);continue}
 if(mapped){field=mapped;if(field==='previousVersions')d.previousVersions='';if(b.images.length)ensureStep().photos.push(...b.images);continue}
 if((b.level!==null&&b.level<=1)||clean==='procedure'){field=null;chapter={id:uid(),title:b.text||'Imported section',steps:[]};p.chapters.push(chapter);item=null;if(b.images.length)ensureStep().photos.push(...b.images);continue}
 if(b.level!==null&&b.level>=2){field=null;ensureChapter();item=step(b.text||'Imported step');chapter.steps.push(item)}else if(field&&b.text)append(field,b.text);else if(b.text){const s=ensureStep(),text=(b.list?'- ':'')+b.text;s.action+=(s.action?'\n':'')+text}
 if(b.images.length)ensureStep().photos.push(...b.images);
 }else{field=null;const rows=b.rows,width=rows[0].length;if(width>8||rows.length>101)parsed.warnings.push('A large table was split into smaller editable tables.');for(let col=0;col<width;col+=8){const sliced=rows.map(r=>r.slice(col,col+8));for(let row=1;row<Math.max(sliced.length,2);row+=100){let s=ensureStep();if(s.tables.length>=30){item=step('Imported tables continued');chapter.steps.push(item);s=item}s.tables.push({id:uid(),headers:sliced[0],rows:sliced.length>1?sliced.slice(row,row+100):[sliced[0].map(()=>'')]})}}ensureStep().photos.push(...b.images)}
 }
 if(!p.chapters.length)ensureChapter();for(const c of p.chapters)if(!c.steps.length)c.steps.push(step('Add instruction'));d.sourceFilename=parsed.sourceName;d.importNotes=[...new Set(parsed.warnings)];d.number=buildNumber(d);return normalise(p);
}
function initImports(){
 const dlg=$('#word-import-dialog'),status=$('#word-import-status');let busy=false;
 const updateType=()=>{$('#import-va-setup').hidden=$('#import-type').value!=='va'};
 $('#import-word').onclick=()=>{$('#word-input').value='';status.textContent='Select a Word file, then tap Import manual.';updateType();dlg.showModal()};
 $('#import-type').onchange=updateType;
 $('#word-input').onchange=()=>{status.textContent=$('#word-input').files[0]?`Selected: ${$('#word-input').files[0].name}`:'No file selected.'};
 dlg.oncancel=e=>{if(busy)e.preventDefault()};
 $('#start-word-import').onclick=async()=>{
  const f=$('#word-input').files[0],target=$('#import-type').value;
  if(!f){status.textContent='Choose a Word document (.docx) first.';return}if(busy)return;
  busy=true;$('#start-word-import').disabled=true;$('#cancel-word-import').disabled=true;$('#word-input').disabled=true;$('#import-type').disabled=true;status.textContent='Importing text, tables and pictures…';
  try{const setup=target==='va'?{paperSize:$('#import-paper').value,orientation:$('#import-orientation').value}:{};
   const parsed=await parseWordFile(f),imported=wordCapture(parsed,target,setup);await flushSave();project=imported;baseRev=0;current=project.chapters[0].steps[0].id;dirty=true;await flushSave();dlg.close();await setPage('front');
   const steps=project.chapters.reduce((n,c)=>n+c.steps.length,0),pics=project.chapters.flatMap(c=>c.steps).reduce((n,s)=>n+s.photos.length,0);
   $('#import-report').textContent=`Imported ${steps} editable sections/steps and ${pics} pictures. ${[...new Set(parsed.warnings)].join(' ')}`;$('#import-report-dialog').showModal();toast('Word imported as an editable draft.');
  }catch(err){console.error(err);status.textContent=err.message||'Word import failed. Choose a .docx file and try again.'}
  finally{busy=false;$('#start-word-import').disabled=false;$('#cancel-word-import').disabled=false;$('#word-input').disabled=false;$('#import-type').disabled=false}
 };
}
