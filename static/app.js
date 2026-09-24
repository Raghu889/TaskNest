'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state = {tasks:[],notes:[],notifications:[],settings:{},capabilities:{}}, view = 'capture', filter = 'active', reviewing = null;
let recorder, stream, audioBlob, audioURL, recordingStarted, recordingTicker, recordingChunks = [], recordedBytes = 0;
let toastTimer, loaded = false;
let delivered = new Set();
try { delivered = new Set(JSON.parse(sessionStorage.getItem('tasknest-delivered') || '[]')); } catch {}
const isActive = t => !['completed','cancelled'].includes(t.status);
const overdue = t => isActive(t) && t.due != null && t.due * 1000 < Date.now();
const formatDate = timestamp => timestamp == null ? 'No deadline' : new Date(timestamp * 1000).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
function localInput(timestamp) { if (timestamp == null) return ''; const d = new Date(timestamp*1000); return new Date(d - d.getTimezoneOffset()*60000).toISOString().slice(0,16); }
function dueValue(value) { return value ? new Date(value).getTime()/1000 : null; }
function toast(message) { $('toast').textContent=message; $('toast').classList.remove('hidden'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),6000); }
async function api(path, data, raw=false) {
  const opts=data===undefined?{}:{method:'POST',headers:{'X-TaskNest':'1','Content-Type':raw?(data.type||'audio/webm'):'application/json'},body:raw?data:JSON.stringify(data)};
  const response=await fetch(path,opts); let result;
  try { result=await response.json(); } catch { throw Error('The server returned an unreadable response.'); }
  if(!response.ok) throw Error(result.error||'Request failed.'); return result;
}
async function action(button, fn) { const before=button.textContent; button.disabled=true; try { await fn(); } catch(e){toast(e.message);} finally{button.disabled=false;button.textContent=before;} }
function empty(title, message) { return `<div class="empty"><h2>${esc(title)}</h2><p>${esc(message)}</p></div>`; }
async function refresh(initial=false) {
  try {
    state=await api('/api/state'); $('connection').classList.add('hidden');
    $('task-count').textContent=state.tasks.filter(isActive).length;
    $('notification-count').textContent=state.notifications.filter(n=>!n.seen).length;
    $('mode-label').textContent=state.capabilities.ai?'AI connected':'Basic mode · no key needed';
    $('use-ai').disabled=!state.capabilities.ai;
    $('ai-hint').textContent=state.capabilities.ai?'Sends note text to your AI provider.':'Add an API key in .env to enable AI.';
    $('transcribe').disabled=!state.capabilities.ai;
    if(initial){$('use-ai').checked=state.capabilities.ai;renderSettings();}
    if(view==='tasks' && !document.activeElement?.closest('.task-card')) renderTasks();
    if(view==='notes')renderNotes();
    if(view==='notifications')renderNotifications();
    notifyBrowser(); loaded=true;
  } catch(e) { $('connection').classList.remove('hidden'); if(initial)toast('Start the server to load your workspace.'); }
}
function show(next) {
  view=next; document.querySelectorAll('.view').forEach(el=>el.classList.toggle('hidden',el.id!==`view-${next}`));
  document.querySelectorAll('.nav').forEach(el=>el.classList.toggle('active',el.dataset.view===next));
  if(next==='tasks')renderTasks(); if(next==='notes')renderNotes(); if(next==='settings')renderSettings(); if(next==='notifications')renderNotifications();
  window.scrollTo({top:0,behavior:'smooth'});
}
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>show(button.dataset.view)));
$('date-label').textContent=new Date().toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'});
try {const draft=JSON.parse(localStorage.getItem('tasknest-draft')||'{}');$('note-title').value=draft.title||'';$('note-body').value=draft.body||'';} catch{}
function saveDraft(){try{localStorage.setItem('tasknest-draft',JSON.stringify({title:$('note-title').value,body:$('note-body').value}));}catch{}}
['note-title','note-body'].forEach(id=>$(id).addEventListener('input',saveDraft));
$('sample').onclick=()=>{if($('note-body').value&&!confirm('Replace the current draft with the example?'))return;$('note-title').value='Release planning';$('note-body').value="We need to test the login flow.\nCheck valid login, invalid passwords, and expired sessions.\nI'll update the release notes.\nSchedule a review meeting with the team.\nWe could revisit the homepage design later.";saveDraft();};
async function saveNote(extract){
  if(!$('note-body').value.trim())throw Error('Add a note or transcript first.');
  const result=await api('/api/notes',{title:$('note-title').value,body:$('note-body').value,use_ai:$('use-ai').checked,extract});
  $('note-title').value='';$('note-body').value='';saveDraft();await refresh();
  if(extract)openReview(result.id);else{show('notes');toast('Note saved.');}
}
$('organize').onclick=()=>action($('organize'),async()=>{$('save-note').disabled=true;try{await saveNote(true);}finally{$('save-note').disabled=false;}});
$('save-note').onclick=()=>action($('save-note'),async()=>{$('organize').disabled=true;try{await saveNote(false);}finally{$('organize').disabled=false;}});
function renderNotes(){ $('note-list').innerHTML=state.notes.length?state.notes.map(n=>`<button class="panel note-card" data-note="${n.id}"><span class="badge">${esc(n.mode==='ai'?'AI NOTES':n.mode==='basic'?'BASIC EXTRACTION':'NOTE')}</span><h2>${esc(n.title)}</h2><p>${esc((n.summary||n.body).slice(0,160))}</p><p class="hint">${formatDate(n.created)} · ${n.suggestions.length} suggestions</p></button>`).join(''):empty('A clear space for your thoughts','Your saved notes and meeting transcripts will appear here.');
  document.querySelectorAll('[data-note]').forEach(b=>b.onclick=()=>openReview(b.dataset.note)); }
function openReview(id){
  const note=state.notes.find(n=>n.id===id);if(!note)return;reviewing=id;
  $('review-title').textContent=note.title;$('review-summary').textContent=note.summary||'Saved without extraction.';$('review-body').textContent=note.body;$('select-all').checked=false;
  $('suggestions').innerHTML=note.suggestions.length?note.suggestions.map(s=>s.approved?`<div class="panel suggestion"><span class="badge">ADDED TO TASKS</span><h3>${esc(s.title)}</h3></div>`:`<article class="panel suggestion" data-suggestion="${s.id}"><div class="suggestion-head"><input type="checkbox" class="pick" id="pick-${s.id}"><label for="pick-${s.id}">Keep this ${esc(s.kind)}</label><span class="badge">${note.mode==='ai'?'AI SUGGESTION':'BASIC SUGGESTION'}</span></div><label>Task name<input class="s-title" maxlength="300" value="${esc(s.title)}" required></label><div class="field-grid"><label>Priority<select class="s-priority">${['low','medium','high'].map(p=>`<option value="${p}" ${s.priority===p?'selected':''}>${p[0].toUpperCase()+p.slice(1)}</option>`).join('')}</select></label><label>Effort (minutes)<input class="s-estimate" type="number" min="0" max="100000" value="${s.estimate}"></label><label>Due date & time<input class="s-due" type="datetime-local"></label></div><label>Details<textarea class="s-description" rows="2" maxlength="4000">${esc(s.description)}</textarea></label><label>Subtasks (one per line)<textarea class="s-subtasks" rows="2">${esc(s.subtasks.map(x=>x.title).join('\n'))}</textarea></label><div class="evidence">“${esc(s.evidence)}”</div></article>`).join(''):empty('No task suggestions yet',note.mode==='note'?'Copy the note into Capture and choose Find tasks when you’re ready.':'Basic extraction recognizes verb-led actions such as “Test the login flow.” You can add a task manually, or retry with AI.');
  $('approve').disabled=!note.suggestions.some(s=>!s.approved);show('review');
}
$('back-notes').onclick=()=>show('notes');
$('select-all').onchange=e=>document.querySelectorAll('.pick').forEach(c=>c.checked=e.target.checked);
function splitSubtasks(value, previous=[]){return value.split('\n').map(s=>s.trim()).filter(Boolean).map(title=>({title,done:previous.find(s=>s.title===title)?.done||false}));}
$('approve').onclick=()=>action($('approve'),async()=>{
  const tasks=[...document.querySelectorAll('[data-suggestion]')].filter(el=>el.querySelector('.pick').checked).map(el=>({id:el.dataset.suggestion,title:el.querySelector('.s-title').value,description:el.querySelector('.s-description').value,priority:el.querySelector('.s-priority').value,estimate:Number(el.querySelector('.s-estimate').value),due:dueValue(el.querySelector('.s-due').value),subtasks:splitSubtasks(el.querySelector('.s-subtasks').value)}));
  if(!tasks.length)throw Error('Select at least one task to keep.');await api('/api/approve',{note_id:reviewing,tasks});await refresh();show('tasks');toast(`${tasks.length} selected task${tasks.length===1?'':'s'} added.`);
});
function elapsed(task){return task.elapsed+(task.running_since?Math.max(0,Date.now()/1000-task.running_since):0);}
function timeText(task){const secs=Math.floor(elapsed(task));return `${Math.floor(secs/60)}m ${String(secs%60).padStart(2,'0')}s`;}
function renderTasks(){
  $('stats').innerHTML=[['Active tasks',state.tasks.filter(isActive).length],['Overdue',state.tasks.filter(overdue).length],['Completed',state.tasks.filter(t=>t.status==='completed').length]].map(([label,value])=>`<div class="stat">${label}<b>${value}</b></div>`).join('');
  const query=$('task-search').value.toLowerCase();const tasks=state.tasks.filter(t=>(filter==='all'||filter==='active'&&isActive(t)||filter==='overdue'&&overdue(t)||filter==='completed'&&t.status==='completed')&&(t.title+' '+t.description).toLowerCase().includes(query));
  $('task-list').innerHTML=tasks.length?tasks.map(t=>`<article class="task-card" data-task="${t.id}"><div class="task-top"><input type="checkbox" data-complete="${t.id}" ${t.status==='completed'?'checked':''} aria-label="Mark ${esc(t.title)} ${t.status==='completed'?'incomplete':'complete'}"><div class="task-main"><h3 class="${t.status==='completed'?'done-text':''}">${esc(t.title)}</h3><div class="task-meta"><span class="priority ${t.priority}">${t.priority}</span><span>${esc(t.status.replace('_',' '))}</span><span class="${overdue(t)?'overdue':''}">${formatDate(t.due)}</span><span>${t.estimate?t.estimate+' min effort':'No estimate'}</span><span data-clock="${t.id}">${timeText(t)}</span></div></div><button data-edit="${t.id}" class="secondary">Edit</button></div>${t.subtasks.length?`<div class="subtasks">${t.subtasks.map((s,i)=>`<label class="inline ${s.done?'done-text':''}"><input type="checkbox" data-sub="${i}" data-owner="${t.id}" ${s.done?'checked':''}>${esc(s.title)}</label>`).join('')}</div>`:''}<div class="task-actions">${isActive(t)?`<button data-timer="${t.id}" data-action="${t.running_since?'pause':'start'}">${t.running_since?'Ⅱ Pause timer':'▷ Start timer'}</button><button data-addtime="${t.id}">＋ 15 min effort</button><button data-snooze="${t.id}">Snooze reminders 1h</button>`:''}${t.note_id?`<button data-source="${t.note_id}">View source note ↗</button>`:''}</div></article>`).join(''):empty('Nothing on this list','Capture a note and select some suggestions, or add a task yourself.');
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openTask(b.dataset.edit));
  document.querySelectorAll('[data-complete]').forEach(b=>b.onchange=()=>action(b,async()=>{const t=state.tasks.find(x=>x.id===b.dataset.complete);try{await api('/api/task',{...t,status:b.checked?'completed':'todo'});}finally{await refresh();renderTasks();}}));
  document.querySelectorAll('[data-sub]').forEach(b=>b.onchange=()=>action(b,async()=>{const t=structuredClone(state.tasks.find(x=>x.id===b.dataset.owner));t.subtasks[Number(b.dataset.sub)].done=b.checked;try{await api('/api/task',t);}finally{await refresh();renderTasks();}}));
  document.querySelectorAll('[data-timer]').forEach(b=>b.onclick=()=>action(b,async()=>{await api('/api/timer',{id:b.dataset.timer,action:b.dataset.action});await refresh();renderTasks();}));
  document.querySelectorAll('[data-addtime]').forEach(b=>b.onclick=()=>action(b,async()=>{const t=state.tasks.find(x=>x.id===b.dataset.addtime);await api('/api/task',{...t,estimate:Math.max(t.estimate,Math.ceil(elapsed(t)/60))+15});await refresh();renderTasks();toast('Added 15 minutes to your effort budget.');}));
  document.querySelectorAll('[data-snooze]').forEach(b=>b.onclick=()=>action(b,async()=>{await api('/api/snooze',{id:b.dataset.snooze,minutes:60});await refresh();toast('New reminders paused for one hour. Existing notifications remain in your inbox.');}));
  document.querySelectorAll('[data-source]').forEach(b=>b.onclick=()=>openReview(b.dataset.source));
}
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('selected',x===b));renderTasks();});
$('task-search').oninput=renderTasks;
function openTask(id){const t=state.tasks.find(x=>x.id===id)||{title:'',description:'',priority:'medium',estimate:0,status:'todo',subtasks:[]};$('dialog-title').textContent=id?'Edit task':'Add a task';$('edit-id').value=id||'';['title','description','priority','estimate','status'].forEach(k=>$('edit-'+k).value=t[k]);$('edit-due').value=localInput(t.due);$('edit-subtasks').value=t.subtasks.map(s=>s.title).join('\n');$('task-dialog').showModal();}
$('new-task').onclick=()=>openTask();$('close-dialog').onclick=()=>$('task-dialog').close();
$('task-form').onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{const old=state.tasks.find(t=>t.id===$('edit-id').value);await api('/api/task',{id:$('edit-id').value||undefined,title:$('edit-title').value,description:$('edit-description').value,priority:$('edit-priority').value,status:$('edit-status').value,estimate:Number($('edit-estimate').value),due:dueValue($('edit-due').value),subtasks:splitSubtasks($('edit-subtasks').value,old?.subtasks)});$('task-dialog').close();await refresh();renderTasks();toast('Task saved.');});};
function renderNotifications(){ $('notification-list').innerHTML=state.notifications.length?state.notifications.map(n=>`<article class="panel notification ${n.seen?'':'unread'}"><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p><small>${formatDate(n.created)}${n.email_sent?' · Email sent':n.attempts>=5?' · Email failed: check SMTP configuration':n.attempts?' · Email retry pending':''}</small>${!n.seen?`<div><button class="text-button" data-read="${n.id}">Mark read</button></div>`:''}</article>`).join(''):empty('You’re all caught up','Reminders appear here when a deadline or effort budget is reached.'); document.querySelectorAll('[data-read]').forEach(b=>b.onclick=()=>action(b,async()=>{await api('/api/notifications/read',{id:b.dataset.read});await refresh();})); }
$('mark-read').onclick=()=>action($('mark-read'),async()=>{await api('/api/notifications/read',{});await refresh();});
function notifyBrowser(){if(!('Notification'in window)||Notification.permission!=='granted')return;for(const n of state.notifications){if(n.seen||delivered.has(n.id))continue;delivered.add(n.id);try{const notification=new Notification(n.title,{body:n.body,tag:n.id});notification.onclick=()=>{window.focus();show('notifications');notification.close();};}catch{}}try{sessionStorage.setItem('tasknest-delivered',JSON.stringify([...delivered].slice(-300)));}catch{}}
function renderSettings(){const s=state.settings;$('daily-enabled').checked=!!s.daily_enabled;$('daily-time').value=s.daily_time||'18:00';$('timezone').value=s.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone;$('utc-offset').value=s.utc_offset??-new Date().getTimezoneOffset();$('email').value=s.email||'';$('email-enabled').checked=!!s.email_enabled;$('smtp-status').textContent=state.capabilities.email?'SMTP configured. Enable email to send reminders to the address above.':'Email is not configured. Fill in the SMTP fields in .env and restart the server.';}
$('settings-form').onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{await api('/api/settings',{daily_enabled:$('daily-enabled').checked,daily_time:$('daily-time').value,timezone:$('timezone').value,utc_offset:Number($('utc-offset').value),email:$('email').value,email_enabled:$('email-enabled').checked});await refresh();toast('Preferences saved.');});};
$('enable-browser').onclick=()=>action($('enable-browser'),async()=>{if(!('Notification'in window))throw Error('This browser does not support desktop notifications.');const permission=await Notification.requestPermission();toast(permission==='granted'?'Browser notifications enabled. Keep this tab open.':'Notifications are blocked. Update browser site permissions to allow them.');});
$('export').onclick=()=>action($('export'),async()=>{const data=await api('/api/export');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='tasknest-export.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
function setAudio(blob){if(audioURL)URL.revokeObjectURL(audioURL);audioBlob=blob;audioURL=URL.createObjectURL(blob);$('audio-player').src=audioURL;$('download-audio').href=audioURL;const ext=blob.type.includes('mp4')?'mp4':blob.type.includes('ogg')?'ogg':blob.type.includes('mpeg')?'mp3':blob.type.includes('wav')?'wav':blob.type.includes('flac')?'flac':'webm';$('download-audio').download='tasknest-recording.'+ext;$('audio-review').classList.remove('hidden');}
function stopTracks(){stream?.getTracks().forEach(t=>t.stop());clearInterval(recordingTicker);}
$('record').onclick=async()=>{
  if(recorder && recorder.state!=='inactive'){recorder.stop();return;}
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('Recording requires a supported browser on localhost or HTTPS. You can upload audio instead.');return;}
  $('record').disabled=true;
  try{stream=await navigator.mediaDevices.getUserMedia({audio:true});const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);recordingChunks=[];recordedBytes=0;
    recorder.ondataavailable=e=>{if(e.data.size){recordingChunks.push(e.data);recordedBytes+=e.data.size;if(recordedBytes>=23*1024*1024&&recorder.state!=='inactive'){recorder.stop();toast('Recording stopped near the 24 MB upload limit.');}}};
    recorder.onstop=()=>{setAudio(new Blob(recordingChunks,{type:recorder.mimeType}));stopTracks();$('record').textContent='● Record conversation';$('record').classList.remove('recording');$('pause-record').classList.add('hidden');$('record-status').textContent='Recording ready. Download a copy or transcribe it before leaving this page.';};
    recorder.onerror=()=>{stopTracks();toast('Recording failed. Try uploading an audio file.');};recorder.start(1000);recordingStarted=Date.now();$('record').textContent='■ Stop recording';$('record').classList.add('recording');$('pause-record').classList.remove('hidden');$('pause-record').textContent='Pause';
    recordingTicker=setInterval(()=>{$('record-status').textContent=`${recorder.state==='paused'?'Paused':'Recording'} · ${Math.floor((Date.now()-recordingStarted)/60000)}m ${Math.floor((Date.now()-recordingStarted)/1000)%60}s since start`;},1000);
  }catch(e){stopTracks();toast('Microphone unavailable. Allow microphone access or upload a recording.');}finally{$('record').disabled=false;}
};
$('pause-record').onclick=()=>{if(recorder?.state==='recording'){recorder.pause();$('pause-record').textContent='Resume';}else if(recorder?.state==='paused'){recorder.resume();$('pause-record').textContent='Pause';}};
$('audio-file').onchange=e=>{const file=e.target.files[0];if(!file)return;if(recorder&&recorder.state!=='inactive'){toast('Stop the current recording before uploading audio.');return;}if(file.size>24*1024*1024){toast('Choose an audio file smaller than 24 MB.');return;}const ext=file.name.split('.').pop().toLowerCase();const mime={mp3:'audio/mpeg',m4a:'audio/mp4',mp4:'audio/mp4',webm:'audio/webm',ogg:'audio/ogg',wav:'audio/wav',flac:'audio/flac'}[ext];setAudio(new Blob([file],{type:mime||file.type}));$('record-status').textContent=`${file.name} is ready for transcription.`;};
$('transcribe').onclick=()=>action($('transcribe'),async()=>{if(!audioBlob)throw Error('Record or upload audio first.');if(audioBlob.size>24*1024*1024)throw Error('Audio exceeds 24 MB. Download it and split it into smaller files.');$('transcribe').textContent='Transcribing…';const result=await api('/api/transcribe',audioBlob,true);if(($('note-body').value+'\n'+result.text).length>60000)throw Error('Transcript is too long for this note. Start a shorter note.');$('note-body').value+=($('note-body').value?'\n\n':'')+result.text;saveDraft();toast('Transcript added. Review it, then choose Find tasks.');});
window.addEventListener('beforeunload',e=>{if(recorder&&recorder.state!=='inactive'||audioBlob){e.preventDefault();e.returnValue='';}});
setInterval(()=>{document.querySelectorAll('[data-clock]').forEach(el=>{const task=state.tasks.find(t=>t.id===el.dataset.clock);if(task)el.textContent=timeText(task);});},1000);
setInterval(()=>refresh(),15000);refresh(true);
