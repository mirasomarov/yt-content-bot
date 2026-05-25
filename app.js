/* ========================================================
   YouTube Content Bot — Full App
   YouTube Data API v3 + OAuth 2.0 PKCE + Claude AI
   ======================================================== */
'use strict';

// ─── CONFIG ──────────────────────────────────────────────
const YT_SCOPES = 'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.upload';
const FOOTBALL_EVENTS = {};
const CH_DOT_COLORS = ['#ff3e3e','#3b82f6','#a855f7','#22c55e'];

// ─── STATE ───────────────────────────────────────────────
let cfg      = {};
let channels = [];
let videos   = [];
let currentView = 'month';
let calOffset   = 0;
let pendingFile = null;
let currentTags = [];
let listenersAttached = false;

function loadStorage() {
  try {
    cfg      = JSON.parse(localStorage.getItem('ytbot_cfg')      || '{}');
    channels = JSON.parse(localStorage.getItem('ytbot_channels') || '[]');
    videos   = JSON.parse(localStorage.getItem('ytbot_videos')   || '[]');
  } catch(_) { cfg={}; channels=[]; videos=[]; }
}
function saveStorage() {
  localStorage.setItem('ytbot_cfg',      JSON.stringify(cfg));
  localStorage.setItem('ytbot_channels', JSON.stringify(channels));
  localStorage.setItem('ytbot_videos',   JSON.stringify(videos));
}

// ─── UTILS ───────────────────────────────────────────────
function uid()  { return Math.random().toString(36).slice(2,11); }
function fmtDate(d) {
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function today()      { return fmtDate(new Date()); }
function parseDate(s) { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
function fmtSize(b)   { return b<1e6?(b/1e3).toFixed(1)+' KB':b<1e9?(b/1e6).toFixed(1)+' MB':(b/1e9).toFixed(2)+' GB'; }

const MONTHS_RU    = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MONTHS_SHORT = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
const DAYS_RU      = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(t._t);
  t._t = setTimeout(()=>t.classList.add('hidden'), 3200);
}

function formatDisplayDate(ds) {
  const d = parseDate(ds);
  return d.getDate()+' '+MONTHS_SHORT[d.getMonth()]+' '+d.getFullYear();
}

// ─── SCREEN ──────────────────────────────────────────────
function showApp() {
  // Show banner if no clientId configured
  const banner = document.getElementById('setupBanner');
  if (!cfg.clientId) {
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
  document.getElementById('redirectUriHint').textContent = window.location.origin;
  renderChannelList();
  renderChannelsSettings();
  renderCalendar();
}

// ─── OAUTH via Google Identity Services (GIS) ────────────
// No redirects — GIS handles auth in its own popup and returns
// the access_token directly in a callback. Works on GitHub Pages.

// Wait for GIS library to finish loading (it's loaded async)
function waitForGIS(timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (typeof google !== 'undefined' && google.accounts) { resolve(); return; }
    const start = Date.now();
    const check = setInterval(() => {
      if (typeof google !== 'undefined' && google.accounts) { clearInterval(check); resolve(); }
      else if (Date.now() - start > timeout) { clearInterval(check); reject(new Error('timeout')); }
    }, 100);
  });
}

async function startOAuth() {
  if (!cfg.clientId) { showToast('Сначала введи Client ID в настройках', true); return; }

  showToast('Загружаю Google Auth...');
  try { await waitForGIS(); } catch(e) {
    showToast('Не удалось загрузить Google Auth. Проверь интернет-соединение.', true); return;
  }

  const ERROR_HINTS = {
    'idpiframe_initialization_failed': '❌ Добавь https://mirasomarov.github.io в Authorized JavaScript origins в Google Cloud Console',
    'popup_closed_by_user':            'Окно закрыто. Попробуй снова.',
    'access_denied':                   '❌ Доступ запрещён. Убедись что твой аккаунт добавлен как Test User в OAuth Consent Screen.',
    'immediate_failed':                'Требуется повторная авторизация.',
  };

  const onToken = async (response) => {
    if (response.error) {
      const hint = ERROR_HINTS[response.error] || ('Ошибка: ' + response.error);
      showToast(hint, true);
      console.error('GIS error:', response);
      return;
    }
    const token     = response.access_token;
    const expiresIn = parseInt(response.expires_in) || 3600;

    showToast('Получаю информацию о канале...');
    const chInfo = await fetchChannelInfo(token);
    if (!chInfo) { showToast('Не удалось получить данные канала. Проверь что YouTube Data API v3 включён.', true); return; }

    const colorIdx = channels.length % 4;
    const idx      = channels.findIndex(c => c.id === chInfo.id);
    const chData   = {
      id: chInfo.id, title: chInfo.title, thumbnail: chInfo.thumbnail,
      token,
      tokenExpiry: Date.now() + expiresIn * 1000,
      colorIdx,
    };
    if (idx >= 0) channels[idx] = chData; else channels.push(chData);
    saveStorage();
    showToast('✅ Канал "' + chInfo.title + '" подключён!');
    renderChannelList(); renderChannelsSettings(); renderCalendar();
  };

  try {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: YT_SCOPES,
      prompt: 'select_account',
      callback: onToken,
    });
    client.requestAccessToken();
  } catch(e) {
    showToast('Ошибка инициализации Google Auth: ' + e.message, true);
    console.error(e);
  }
}

async function fetchChannelInfo(token) {
  try {
    const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      {headers:{Authorization:'Bearer '+token}});
    const d = await r.json();
    if (!d.items?.length) return null;
    const ch = d.items[0];
    return { id:ch.id, title:ch.snippet.title, thumbnail:ch.snippet.thumbnails?.default?.url||'' };
  } catch(_) { return null; }
}

async function getValidToken(channelId) {
  const ch = channels.find(c => c.id === channelId);
  if (!ch) return null;
  // Token still valid
  if (Date.now() < ch.tokenExpiry - 60000) return ch.token;

  // Token expired — silently re-request via GIS (no redirect, no prompt if possible)
  try { await waitForGIS(); } catch(e) { return null; }
  return new Promise((resolve) => {
    showToast('Обновляю токен для "' + ch.title + '"...');
    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: cfg.clientId,
        scope: YT_SCOPES,
        hint: ch.id,
        prompt: '',
        callback: (response) => {
          if (response.error || !response.access_token) { resolve(null); return; }
          ch.token       = response.access_token;
          ch.tokenExpiry = Date.now() + (parseInt(response.expires_in) || 3600) * 1000;
          saveStorage();
          resolve(ch.token);
        },
      });
      client.requestAccessToken();
    } catch(e) { resolve(null); }
  });
}

// ─── YOUTUBE UPLOAD ──────────────────────────────────────
async function uploadToYouTube(channelId, file, meta) {
  const token = await getValidToken(channelId);
  if (!token) { showToast('Нет токена. Подключи канал заново.', true); return null; }

  let publishAt=null, privacyStatus=meta.privacy;
  if (meta.privacy==='scheduled' && meta.date && meta.time) {
    publishAt = new Date(meta.date+'T'+meta.time+':00+05:00').toISOString();
    privacyStatus = 'private';
  }

  const body = {
    snippet: { title:meta.title.slice(0,100), description:meta.description, tags:meta.tags, categoryId:'17' },
    status:  { privacyStatus },
  };
  if (publishAt) body.status.publishAt = publishAt;

  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    { method:'POST', headers:{
        'Authorization':'Bearer '+token,
        'Content-Type':'application/json',
        'X-Upload-Content-Type': file.type||'video/mp4',
        'X-Upload-Content-Length': String(file.size),
      }, body: JSON.stringify(body) }
  );
  if (!initRes.ok) {
    const e=await initRes.json().catch(()=>({}));
    showToast('Ошибка: '+(e.error?.message||initRes.status), true); return null;
  }
  const uploadUrl = initRes.headers.get('Location');
  if (!uploadUrl) { showToast('Не получен URL загрузки', true); return null; }

  const CHUNK = 5*1024*1024;
  let offset=0, videoId=null;
  while (offset<file.size) {
    const end = Math.min(offset+CHUNK, file.size);
    const r = await fetch(uploadUrl, {
      method:'PUT',
      headers:{
        'Content-Type': file.type||'video/mp4',
        'Content-Range': 'bytes '+offset+'-'+(end-1)+'/'+file.size,
      },
      body: file.slice(offset,end),
    });
    if (r.status===200||r.status===201) { videoId=(await r.json()).id; break; }
    else if (r.status===308) {
      const range=r.headers.get('Range');
      offset = range ? parseInt(range.split('-')[1])+1 : end;
    } else { showToast('Ошибка загрузки: '+r.status, true); return null; }
    setProgress(Math.round((Math.max(offset,end)/file.size)*100));
    offset = Math.max(offset,end);
  }
  setProgress(100);
  return videoId;
}

function setProgress(pct) {
  document.getElementById('progressBar').style.width = pct+'%';
  document.getElementById('progressPct').textContent = pct+'%';
  if (pct>=100) document.getElementById('progressSub').textContent='Завершаю...';
}

// ─── AI METADATA ─────────────────────────────────────────
async function generateMetadata(channel, type, filename) {
  const idea = filename.replace(/\.[^/.]+$/,'').replace(/[_\-]+/g,' ');
  if (cfg.claudeKey) {
    try { return await callClaude(channel, type, idea); } catch(e) { console.warn('Claude err:',e); }
  }
  return templateMeta(channel, type, idea);
}

async function callClaude(channel, type, idea) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'x-api-key': cfg.claudeKey,
      'anthropic-version':'2023-06-01',
      'anthropic-dangerous-direct-browser-access':'true',
    },
    body: JSON.stringify({
      model:'claude-sonnet-4-5', max_tokens:1024,
      messages:[{role:'user', content:
        `Ты SEO-специалист YouTube для футбольного канала "${channel.title}".\n`+
        `Тип: ${type==='long'?'Лонг':type==='short'?'Short':'Пост'}\nИдея: "${idea}"\n`+
        `Ответь ТОЛЬКО валидным JSON:\n`+
        `{"title":"заголовок до 70 символов","description":"описание 150-200 символов","tags":["тег1","тег2","тег3","тег4","тег5","тег6","тег7","тег8","тег9","тег10"],"hook":"хук 5 секунд","thumbnail":"идея превью","time":"HH:MM"}`
      }],
    }),
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  const m = d.content[0].text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no json');
  return JSON.parse(m[0]);
}

function pick(a) { return a[Math.floor(Math.random()*a.length)]; }
function templateMeta(channel, type, idea) {
  const year = new Date().getFullYear();
  const titles = ['🔥 {i} — ТОП компиляция '+year,'😱 {i} | Невозможное возможно','⚽ {i} — Смотри до конца!','💥 {i} | Лучшее за '+year];
  const hooks  = ['То что случилось дальше изменило всё...','Досмотри до конца — ты не поверишь.','Один момент — стадион взорвался.'];
  const tags   = ['football','футбол','skills','highlights','топ','goals','компиляция','football'+year,'топфутбол','ballers'];
  const thumbs = ['Тёмный фон, игрок в прыжке, неоновый текст','Split-screen игрок+реакция, красный градиент','Крупный план лица, жирный текст снизу'];
  const times  = {long:'16:00',short:'10:00',post:'14:00'};
  return {
    title: pick(titles).replace('{i}',idea.slice(0,40)).slice(0,70),
    description: idea+' — смотри на канале '+channel.title+'! #football'.slice(0,200),
    tags: [...tags].sort(()=>Math.random()-.5).slice(0,10),
    hook: pick(hooks), thumbnail: pick(thumbs),
    time: times[type]||'16:00',
  };
}

// ─── CONTENT PLAN ────────────────────────────────────────
const PLAN_IDEAS = {
  long:  ['ТОП-10 финтов недели','Лучшие голы месяца','Невозможные сейвы','Топ скоростных игроков'],
  short: ['Лучший финт 60 сек','Гол с центра поля','Невероятный дриблинг','Магия вратаря'],
  post:  ['Опрос: лучший игрок?','Угадай счёт!','Предсказание матча','Лучший гол — голосуй!'],
};

function generatePlan(period, focus, targetChannels) {
  const base = new Date();
  const days = period==='week'?7:period==='month'?30:365;
  const plan = [];
  for (let i=0;i<days;i++) {
    const d=new Date(base); d.setDate(base.getDate()+i);
    const ds=fmtDate(d);
    const isWE=d.getDay()===0||d.getDay()===6;
    targetChannels.forEach(ch=>{
      if (videos.some(v=>v.date===ds&&v.channelId===ch.id)) return;
      const type=isWE?(Math.random()<.6?'short':'long'):(Math.random()<.4?'long':Math.random()<.6?'short':'post');
      const time={long:isWE?'11:00':'16:00',short:'10:00',post:'14:00'}[type];
      plan.push({ id:uid(),channelId:ch.id,
        title: pick(PLAN_IDEAS[type])+(focus?' — '+focus.slice(0,20):''),
        date:ds,time,type,status:'planned',ytVideoId:null,ytUrl:null });
    });
  }
  return plan;
}

// ─── CALENDAR ────────────────────────────────────────────
function renderCalendar() {
  const c = document.getElementById('calendarContainer');
  c.innerHTML='';
  if (currentView==='month')  renderMonth(c);
  else if (currentView==='week') renderWeek(c);
  else renderYear(c);
}

function getMonthBase() {
  const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()+calOffset); return d;
}
function getWeekBase() {
  const d=new Date(); const dow=d.getDay();
  d.setDate(d.getDate()-(dow===0?6:dow-1)+calOffset*7); return d;
}

function renderMonth(c) {
  const base=getMonthBase();
  const yr=base.getFullYear(), mo=base.getMonth();
  document.getElementById('calPeriod').textContent=MONTHS_RU[mo]+' '+yr;
  const todayStr=today();
  const first=new Date(yr,mo,1).getDay();
  const off=first===0?6:first-1;
  const dim=new Date(yr,mo+1,0).getDate();
  const prevDim=new Date(yr,mo,0).getDate();

  const g=document.createElement('div'); g.className='month-grid';
  ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach(d=>{
    const h=document.createElement('div');h.className='month-header';h.textContent=d;g.appendChild(h);
  });
  for(let i=off-1;i>=0;i--)  g.appendChild(makeDayCell(new Date(yr,mo-1,prevDim-i),true,todayStr));
  for(let d=1;d<=dim;d++)     g.appendChild(makeDayCell(new Date(yr,mo,d),false,todayStr));
  const total=off+dim; const rem=total%7===0?0:7-(total%7);
  for(let d=1;d<=rem;d++)     g.appendChild(makeDayCell(new Date(yr,mo+1,d),true,todayStr));
  c.appendChild(g);
}

function makeDayCell(date,otherMonth,todayStr) {
  const ds=fmtDate(date), isToday=ds===todayStr;
  const dayVids=videos.filter(v=>v.date===ds);
  const cell=document.createElement('div');
  cell.className='month-day'+(otherMonth?' other-month':'')+(isToday?' is-today':'');

  const num=document.createElement('div'); num.className='day-num'; num.textContent=date.getDate();
  cell.appendChild(num);

  const ev=FOOTBALL_EVENTS[ds];
  if(ev){const f=document.createElement('div');f.className='day-event-flag';f.textContent='⚡ '+ev;cell.appendChild(f);}

  dayVids.slice(0,3).forEach(v=>{
    const ch=channels.find(c=>c.id===v.channelId);
    const ci=ch?ch.colorIdx:0;
    const el=document.createElement('div');
    el.className='day-video ch-'+ci+' status-'+v.status;
    el.textContent=v.title; el.title=(ch?.title||'?')+' · '+v.time;
    el.addEventListener('click',e=>{e.stopPropagation();openUploadModal(ds);});
    cell.appendChild(el);
  });
  if(dayVids.length>3){const m=document.createElement('div');m.className='day-more';m.textContent='+'+( dayVids.length-3)+' ещё';cell.appendChild(m);}
  cell.addEventListener('click',()=>openUploadModal(ds));
  return cell;
}

function renderWeek(c) {
  const base=getWeekBase(), todayStr=today();
  const end=new Date(base); end.setDate(base.getDate()+6);
  document.getElementById('calPeriod').textContent=
    base.getDate()+' '+MONTHS_SHORT[base.getMonth()]+' — '+end.getDate()+' '+MONTHS_SHORT[end.getMonth()]+' '+end.getFullYear();
  const g=document.createElement('div'); g.className='week-grid';
  for(let i=0;i<7;i++){
    const d=new Date(base); d.setDate(base.getDate()+i);
    const ds=fmtDate(d), isToday=ds===todayStr;
    const col=document.createElement('div');
    col.className='week-day-col'+(isToday?' is-today':'');
    col.innerHTML='<div class="week-day-header"><div class="week-day-name">'+DAYS_RU[d.getDay()]+'</div><div class="week-day-num">'+d.getDate()+'</div></div>';
    const vw=document.createElement('div'); vw.className='week-videos';
    videos.filter(v=>v.date===ds).forEach(v=>{
      const ch=channels.find(c=>c.id===v.channelId);
      const el=document.createElement('div');
      el.className='week-video ch-'+(ch?ch.colorIdx:0);
      el.textContent=v.time+' '+v.title.slice(0,28);
      el.addEventListener('click',e=>{e.stopPropagation();openUploadModal(ds);});
      vw.appendChild(el);
    });
    col.appendChild(vw);
    col.addEventListener('click',()=>openUploadModal(ds));
    g.appendChild(col);
  }
  c.appendChild(g);
}

function renderYear(c) {
  const yr = new Date().getFullYear()+calOffset;
  document.getElementById('calPeriod').textContent=String(yr);
  const todayStr=today();
  const g=document.createElement('div'); g.className='year-grid';
  for(let m=0;m<12;m++){
    const mEl=document.createElement('div'); mEl.className='year-month';
    mEl.innerHTML='<div class="year-month-name">'+MONTHS_RU[m]+'</div>';
    const mg=document.createElement('div'); mg.className='year-mini-grid';
    const off=(new Date(yr,m,1).getDay()||7)-1;
    for(let i=0;i<off;i++){const b=document.createElement('div');b.className='year-mini-day';mg.appendChild(b);}
    for(let d=1;d<=new Date(yr,m+1,0).getDate();d++){
      const ds=yr+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
      const cell=document.createElement('div');
      cell.className='year-mini-day'+(videos.some(v=>v.date===ds)?' has-video':'')+(ds===todayStr?' is-today':'');
      cell.textContent=d; cell.title=d+' '+MONTHS_SHORT[m];
      cell.addEventListener('click',()=>openUploadModal(ds));
      mg.appendChild(cell);
    }
    mEl.appendChild(mg); g.appendChild(mEl);
  }
  c.appendChild(g);
}

function renderChannelList() {
  const list=document.getElementById('channelsList'); list.innerHTML='';
  channels.forEach(ch=>{
    const el=document.createElement('div'); el.className='channel-item';
    el.innerHTML='<div class="ch-dot" style="background:'+CH_DOT_COLORS[ch.colorIdx]+'"></div>'
      +'<div class="ch-info"><div class="ch-name">'+ch.title+'</div><div class="ch-sub">'+ch.id+'</div></div>';
    list.appendChild(el);
  });
}

function renderChannelsSettings() {
  const el = document.getElementById('channelsListSettings');
  if (!el) return;
  if (!channels.length) {
    el.innerHTML='<p style="color:var(--text3);font-size:.85rem">Нет подключённых каналов</p>';
    return;
  }
  el.innerHTML = channels.map((ch,i)=>
    '<div class="channel-item" style="background:var(--bg3);border-radius:8px;margin-bottom:6px">'
    +'<div class="ch-dot" style="background:'+CH_DOT_COLORS[ch.colorIdx]+'"></div>'
    +'<div class="ch-info"><div class="ch-name">'+ch.title+'</div><div class="ch-sub">'+ch.id+'</div></div>'
    +'<button class="icon-btn" onclick="removeChannel('+i+')" title="Удалить">🗑</button>'
    +'</div>'
  ).join('');
}

function removeChannel(idx) {
  if (!confirm('Удалить канал "'+channels[idx].title+'"?')) return;
  channels.splice(idx,1); saveStorage();
  renderChannelList(); renderChannelsSettings();
  showToast('Канал удалён');
}

// ─── UPLOAD MODAL ────────────────────────────────────────
function openUploadModal(ds) {
  pendingFile=null; currentTags=[];
  showStep(1);
  document.getElementById('modalDateTitle').textContent='📤 '+formatDisplayDate(ds);
  document.getElementById('scheduleDate').value=ds;
  document.getElementById('uploadChannel').innerHTML=
    channels.length
      ? channels.map(c=>'<option value="'+c.id+'">'+c.title+'</option>').join('')
      : '<option value="">Сначала подключи канал</option>';
  document.getElementById('fileInput').value='';
  document.getElementById('filePreview').classList.add('hidden');
  document.getElementById('dropZone').classList.remove('hidden');
  document.getElementById('btnGenerateMeta').disabled=true;
  renderTags();
  document.getElementById('uploadModal').classList.remove('hidden');
}

function closeUploadModal() {
  document.getElementById('uploadModal').classList.add('hidden');
  pendingFile=null; currentTags=[];
}

function showStep(n) {
  [1,2,3,4].forEach(i=>document.getElementById('uploadStep'+i).classList.toggle('hidden',i!==n));
}

function handleFile(file) {
  if(!file) return;
  pendingFile=file;
  document.getElementById('dropZone').classList.add('hidden');
  document.getElementById('filePreview').classList.remove('hidden');
  document.getElementById('fileName').textContent=file.name;
  document.getElementById('fileSize').textContent=fmtSize(file.size);
  document.getElementById('btnGenerateMeta').disabled=false;
}

function renderTags() {
  const wrap=document.getElementById('tagsWrap');
  wrap.innerHTML=currentTags.map((t,i)=>'<span class="tag-chip">#'+t+'<button data-i="'+i+'">✕</button></span>').join('');
  wrap.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{currentTags.splice(+b.dataset.i,1);renderTags();}));
}

// ─── PLAN MODAL ──────────────────────────────────────────
function openPlanModal() {
  document.getElementById('planChannelsCheck').innerHTML = channels.length
    ? channels.map(ch=>
        '<label><input type="checkbox" value="'+ch.id+'" checked/>'
        +'<span class="ch-dot" style="background:'+CH_DOT_COLORS[ch.colorIdx]+';display:inline-block;width:8px;height:8px;border-radius:50%;margin:0 6px"></span>'
        +ch.title+'</label>').join('')
    : '<p style="color:var(--text3);font-size:.85rem">Нет подключённых каналов</p>';
  document.getElementById('planModal').classList.remove('hidden');
}

// ─── TAB SWITCHING ───────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.add('hidden'));
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.remove('active'));
  document.getElementById('tab-'+name).classList.remove('hidden');
  document.querySelector('[data-tab="'+name+'"]').classList.add('active');
  document.getElementById('pageTitle').textContent = name==='calendar'?'Контент-календарь':'Настройки';
  if(name==='settings'){
    document.getElementById('settingsClientId').value=cfg.clientId||'';
    document.getElementById('settingsClaudeKey').value=cfg.claudeKey||'';
  }
}

// ─── ATTACH APP LISTENERS ────────────────────────────────
function attachAppListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  // Sidebar
  document.getElementById('btnAddChannel').addEventListener('click', startOAuth);
  document.getElementById('btnSidebarOpen').addEventListener('click', ()=>document.getElementById('sidebar').classList.toggle('open'));
  document.getElementById('btnSidebarClose').addEventListener('click', ()=>document.getElementById('sidebar').classList.remove('open'));

  // Tabs
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));

  // View switcher
  document.querySelectorAll('.view-btn').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('.view-btn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); currentView=b.dataset.view; calOffset=0; renderCalendar();
  }));

  // Cal nav
  document.getElementById('btnPrev').addEventListener('click',()=>{calOffset--;renderCalendar();});
  document.getElementById('btnNext').addEventListener('click',()=>{calOffset++;renderCalendar();});

  // Plan modal
  document.getElementById('btnGenPlan').addEventListener('click',()=>{
    if(!channels.length){showToast('Сначала подключи канал',true);return;} openPlanModal();
  });
  document.getElementById('btnClosePlan').addEventListener('click',()=>document.getElementById('planModal').classList.add('hidden'));
  document.getElementById('btnCancelPlan').addEventListener('click',()=>document.getElementById('planModal').classList.add('hidden'));
  document.getElementById('btnConfirmPlan').addEventListener('click',()=>{
    const period=document.getElementById('planPeriod').value;
    const focus=document.getElementById('planFocus').value.trim();
    const ids=[...document.querySelectorAll('#planChannelsCheck input:checked')].map(i=>i.value);
    const chs=channels.filter(c=>ids.includes(c.id));
    if(!chs.length){showToast('Выбери хотя бы один канал',true);return;}
    const plan=generatePlan(period,focus,chs);
    videos.push(...plan); saveStorage(); renderCalendar();
    document.getElementById('planModal').classList.add('hidden');
    showToast('✅ Добавлено '+plan.length+' видео в план!');
  });

  // Upload modal close
  document.getElementById('btnCloseUpload').addEventListener('click', closeUploadModal);
  document.getElementById('uploadModal').addEventListener('click',e=>{if(e.target===document.getElementById('uploadModal'))closeUploadModal();});

  // Drop zone
  const dz=document.getElementById('dropZone'), fi=document.getElementById('fileInput');
  dz.addEventListener('click',()=>fi.click());
  dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag-over');});
  dz.addEventListener('dragleave',()=>dz.classList.remove('drag-over'));
  dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag-over');handleFile(e.dataTransfer.files[0]);});
  fi.addEventListener('change',()=>handleFile(fi.files[0]));
  document.getElementById('btnRemoveFile').addEventListener('click',()=>{
    pendingFile=null; fi.value='';
    document.getElementById('filePreview').classList.add('hidden');
    document.getElementById('dropZone').classList.remove('hidden');
    document.getElementById('btnGenerateMeta').disabled=true;
  });

  // Generate metadata
  document.getElementById('btnGenerateMeta').addEventListener('click', async ()=>{
    const btn=document.getElementById('btnGenerateMeta');
    btn.disabled=true; btn.textContent='✨ Генерирую...';
    const chId=document.getElementById('uploadChannel').value;
    const ch=channels.find(c=>c.id===chId)||{title:'Канал'};
    const type=document.getElementById('uploadType').value;
    const meta=await generateMetadata(ch, type, pendingFile?pendingFile.name:'video');
    document.getElementById('metaTitle').value=meta.title||'';
    document.getElementById('metaDesc').value=meta.description||'';
    document.getElementById('metaHook').value=meta.hook||'';
    document.getElementById('metaThumbnail').value=meta.thumbnail||'';
    if(meta.time) document.getElementById('scheduleTime').value=meta.time;
    currentTags=meta.tags||[]; renderTags();
    updateTitleCounter(); showStep(2);
    btn.disabled=false; btn.textContent='✨ Сгенерировать метаданные AI';
  });

  // Title counter
  document.getElementById('metaTitle').addEventListener('input', updateTitleCounter);

  // Tags
  document.getElementById('tagsInput').addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===','){
      e.preventDefault();
      const v=e.target.value.replace(/[#,]/g,'').trim();
      if(v&&!currentTags.includes(v)){currentTags.push(v);renderTags();}
      e.target.value='';
    }
  });

  // Step nav
  document.getElementById('btnBackToStep1').addEventListener('click',()=>showStep(1));

  // Upload
  document.getElementById('btnUpload').addEventListener('click', async ()=>{
    if(!pendingFile){showToast('Файл не выбран',true);return;}
    const chId=document.getElementById('uploadChannel').value;
    if(!chId){showToast('Выбери канал',true);return;}
    const title=document.getElementById('metaTitle').value.trim();
    if(!title){showToast('Введи заголовок',true);return;}
    const desc=document.getElementById('metaDesc').value.trim();
    const date=document.getElementById('scheduleDate').value;
    const time=document.getElementById('scheduleTime').value;
    const privacy=document.getElementById('privacyStatus').value;

    showStep(3);
    document.getElementById('progressTitle').textContent='Загружаю "'+title.slice(0,40)+'"...';

    const videoId=await uploadToYouTube(chId, pendingFile, {title,description:desc,tags:currentTags,date,time,privacy});
    if(!videoId){showStep(2);return;}

    const newVid={id:uid(),channelId:chId,title,date,time,
      type:document.getElementById('uploadType').value,
      status:privacy==='public'?'published':'planned',
      ytVideoId:videoId, ytUrl:'https://www.youtube.com/watch?v='+videoId};
    videos.push(newVid); saveStorage(); renderCalendar();

    document.getElementById('doneMessage').textContent=
      privacy==='scheduled'?'Запланировано на '+formatDisplayDate(date)+' '+time:'Видео загружено!';
    document.getElementById('doneLink').href=newVid.ytUrl;
    showStep(4);
  });

  document.getElementById('btnUploadAnother').addEventListener('click',()=>{
    const ds=document.getElementById('scheduleDate').value;
    openUploadModal(ds);
  });

  // Banner → settings
  document.getElementById('btnOpenSettings').addEventListener('click',()=>switchTab('settings'));

  // FAB → open today
  document.getElementById('fabAdd').addEventListener('click',()=>openUploadModal(today()));

  // Add channel from settings tab
  document.getElementById('btnAddChannelSettings').addEventListener('click', startOAuth);

  // Settings save
  document.getElementById('btnSaveSettings').addEventListener('click',()=>{
    const cid  = document.getElementById('settingsClientId').value.trim();
    const ckey = document.getElementById('settingsClaudeKey').value.trim();
    if (!cid) { showToast('Введи Google Client ID', true); return; }
    cfg.clientId = cid;
    cfg.claudeKey = ckey;
    saveStorage();
    document.getElementById('setupBanner').classList.add('hidden');
    showToast('✅ Настройки сохранены');
  });
  document.getElementById('btnClearData').addEventListener('click',()=>{
    if(confirm('Удалить все данные?')){localStorage.clear();location.reload();}
  });
}

function updateTitleCounter() {
  const len=document.getElementById('metaTitle').value.length;
  document.getElementById('titleCounter').textContent=len+'/70';
  document.getElementById('titleCounter').style.color=len>70?'var(--accent)':'var(--text3)';
}

// ─── MAIN INIT ───────────────────────────────────────────
async function init() {
  loadStorage();

  // Seed football events
  const base = new Date();
  [[3,'Финал Лиги Чемпионов'],[7,'Барселона — Реал Мадрид'],[11,'Copa América — старт'],[18,'Финал Лиги Европы']].forEach(([d,n])=>{
    const dt = new Date(base); dt.setDate(base.getDate()+d); FOOTBALL_EVENTS[fmtDate(dt)] = n;
  });

  attachAppListeners();
  showApp();
}

document.addEventListener('DOMContentLoaded', init);
