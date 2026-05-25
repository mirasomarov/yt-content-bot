/* ========================================================
   YouTube Content Bot — Full App
   YouTube Data API v3 + OAuth 2.0 PKCE + Claude AI
   ======================================================== */
'use strict';

// ─── CONFIG ──────────────────────────────────────────────
const REDIRECT_URI = (() => {
  const u = window.location.origin + window.location.pathname.replace(/\/$/, '') + '/';
  return u.endsWith('/') ? u : u + '/';
})();

const YT_SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.upload',
].join(' ');

const FOOTBALL_EVENTS = {
  // auto-seeded relative to today
};

const CH_COLORS = ['ch-0','ch-1','ch-2','ch-3'];
const CH_DOT_COLORS = ['var(--hub)','var(--ballers)','var(--yamal)','var(--green)'];

// ─── STATE ───────────────────────────────────────────────
let cfg = {};        // { clientId, claudeKey }
let channels = [];   // [{ id, title, thumbnail, token, refreshToken, tokenExpiry, colorIdx }]
let videos = [];     // [{ id, channelId, title, date, time, type, status, ytVideoId, ytUrl }]
let currentView = 'month';
let calOffset = 0;   // months/weeks offset from today
let pendingUpload = { file: null, date: null };
let currentTags = [];

function loadStorage() {
  try {
    cfg      = JSON.parse(localStorage.getItem('ytbot_cfg') || '{}');
    channels = JSON.parse(localStorage.getItem('ytbot_channels') || '[]');
    videos   = JSON.parse(localStorage.getItem('ytbot_videos') || '[]');
  } catch(_) { cfg={}; channels=[]; videos=[]; }
}
function saveStorage() {
  localStorage.setItem('ytbot_cfg',      JSON.stringify(cfg));
  localStorage.setItem('ytbot_channels', JSON.stringify(channels));
  localStorage.setItem('ytbot_videos',   JSON.stringify(videos));
}

// ─── UTILS ───────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2,11); }
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function today() { return fmtDate(new Date()); }
function parseDate(s) { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DAYS_RU   = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
const MONTHS_SHORT = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
function fmtSize(bytes) {
  if (bytes < 1e6) return (bytes/1e3).toFixed(1)+' KB';
  if (bytes < 1e9) return (bytes/1e6).toFixed(1)+' MB';
  return (bytes/1e9).toFixed(2)+' GB';
}
function showToast(msg, isError=false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(t._t);
  t._t = setTimeout(()=>t.classList.add('hidden'), 3200);
}

// ─── SCREENS ─────────────────────────────────────────────
function showSetup() {
  document.getElementById('screen-setup').classList.remove('hidden');
  document.getElementById('screen-app').classList.add('hidden');
  document.getElementById('redirectUriHint').textContent = REDIRECT_URI;
}
function showApp() {
  document.getElementById('screen-setup').classList.add('hidden');
  document.getElementById('screen-app').classList.remove('hidden');
  renderChannelList();
  renderCalendar();
}

// ─── OAUTH 2.0 PKCE ──────────────────────────────────────
function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function genVerifier() {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}
async function genChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return b64url(hash);
}

async function startOAuth() {
  if (!cfg.clientId) { showToast('Сначала введи Google Client ID в настройках', true); return; }
  const verifier = genVerifier();
  const challenge = await genChallenge(verifier);
  sessionStorage.setItem('pkce_verifier', verifier);
  sessionStorage.setItem('oauth_state', uid());

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: YT_SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent select_account',
    state: sessionStorage.getItem('oauth_state'),
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function handleOAuthCallback(code) {
  const verifier = sessionStorage.getItem('pkce_verifier');
  if (!verifier || !cfg.clientId) return false;

  showToast('Получаю токены...');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  });

  const tokens = await res.json();
  if (tokens.error) { showToast('Ошибка OAuth: ' + tokens.error_description, true); return false; }

  sessionStorage.removeItem('pkce_verifier');
  sessionStorage.removeItem('oauth_state');

  // Fetch channel info
  const chInfo = await fetchChannelInfo(tokens.access_token);
  if (!chInfo) { showToast('Не удалось получить данные канала', true); return false; }

  const colorIdx = channels.length % CH_COLORS.length;
  const existing = channels.findIndex(c => c.id === chInfo.id);
  const channelData = {
    id: chInfo.id,
    title: chInfo.title,
    thumbnail: chInfo.thumbnail,
    token: tokens.access_token,
    refreshToken: tokens.refresh_token || null,
    tokenExpiry: Date.now() + (tokens.expires_in * 1000),
    colorIdx,
  };

  if (existing >= 0) channels[existing] = channelData;
  else channels.push(channelData);

  saveStorage();
  showToast(`✅ Канал "${chInfo.title}" подключён!`);
  return true;
}

async function fetchChannelInfo(token) {
  try {
    const res = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const data = await res.json();
    if (!data.items?.length) return null;
    const ch = data.items[0];
    return {
      id: ch.id,
      title: ch.snippet.title,
      thumbnail: ch.snippet.thumbnails?.default?.url || '',
    };
  } catch(e) { return null; }
}

async function refreshToken(channel) {
  if (!channel.refreshToken || !cfg.clientId) return null;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      grant_type: 'refresh_token',
      refresh_token: channel.refreshToken,
    }),
  });
  const tokens = await res.json();
  if (tokens.access_token) {
    channel.token = tokens.access_token;
    channel.tokenExpiry = Date.now() + (tokens.expires_in * 1000);
    saveStorage();
    return tokens.access_token;
  }
  return null;
}

async function getValidToken(channelId) {
  const ch = channels.find(c => c.id === channelId);
  if (!ch) return null;
  if (Date.now() < ch.tokenExpiry - 60000) return ch.token;
  return await refreshToken(ch);
}

// ─── YOUTUBE UPLOAD ──────────────────────────────────────
async function uploadToYouTube(channelId, file, metadata) {
  const token = await getValidToken(channelId);
  if (!token) { showToast('Нет токена. Подключи канал заново.', true); return null; }

  // Build publishAt (UTC)
  let publishAt = null;
  let privacyStatus = metadata.privacy;
  if (metadata.privacy === 'scheduled' && metadata.date && metadata.time) {
    // Convert GMT+5 to UTC
    const localDt = new Date(`${metadata.date}T${metadata.time}:00+05:00`);
    publishAt = localDt.toISOString();
    privacyStatus = 'private'; // YouTube requires private for scheduled
  }

  const snippet = {
    title: metadata.title.slice(0, 100),
    description: metadata.description,
    tags: metadata.tags,
    categoryId: '17', // Sports
  };
  const status = { privacyStatus };
  if (publishAt) status.publishAt = publishAt;

  // Step 1: Initiate resumable upload
  let uploadUrl;
  try {
    const initRes = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': file.type || 'video/mp4',
          'X-Upload-Content-Length': String(file.size),
        },
        body: JSON.stringify({ snippet, status }),
      }
    );
    if (!initRes.ok) {
      const err = await initRes.json().catch(()=>({}));
      throw new Error(err.error?.message || initRes.status);
    }
    uploadUrl = initRes.headers.get('Location');
    if (!uploadUrl) throw new Error('Нет upload URL');
  } catch(e) {
    showToast('Ошибка инициализации загрузки: ' + e.message, true);
    return null;
  }

  // Step 2: Upload in chunks
  const CHUNK = 5 * 1024 * 1024; // 5MB
  let offset = 0;
  let videoId = null;

  while (offset < file.size) {
    const end = Math.min(offset + CHUNK, file.size);
    const chunk = file.slice(offset, end);

    try {
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'video/mp4',
          'Content-Range': `bytes ${offset}-${end-1}/${file.size}`,
        },
        body: chunk,
      });

      if (uploadRes.status === 200 || uploadRes.status === 201) {
        const data = await uploadRes.json();
        videoId = data.id;
        break;
      } else if (uploadRes.status === 308) {
        // Chunk received, continue
        const range = uploadRes.headers.get('Range');
        offset = range ? parseInt(range.split('-')[1]) + 1 : end;
      } else {
        throw new Error('Статус: ' + uploadRes.status);
      }
    } catch(e) {
      showToast('Ошибка загрузки чанка: ' + e.message, true);
      return null;
    }

    const pct = Math.round((offset / file.size) * 100);
    updateProgress(pct);
    offset = Math.max(offset, end);
  }

  updateProgress(100);
  return videoId;
}

function updateProgress(pct) {
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressPct').textContent = pct + '%';
  if (pct >= 100) document.getElementById('progressSub').textContent = 'Завершаю...';
}

// ─── AI METADATA GENERATION ──────────────────────────────
async function generateMetadata(channel, type, filename) {
  const idea = filename.replace(/\.[^/.]+$/, '').replace(/[_-]/g,' ');

  if (cfg.claudeKey) {
    try { return await generateWithClaude(channel, type, idea); } catch(e) {}
  }
  return generateWithTemplates(channel, type, idea);
}

async function generateWithClaude(channel, type, idea) {
  const typeNames = { long:'Лонг (полное видео)', short:'YouTube Short', post:'Пост/Community' };
  const prompt = `Ты SEO-специалист YouTube для футбольного канала "${channel.title}".
Тип видео: ${typeNames[type] || type}
Идея/название: "${idea}"

Верни ТОЛЬКО валидный JSON (без комментариев, без markdown):
{
  "title": "заголовок до 70 символов, кликбейтный, с эмодзи",
  "description": "описание 150-200 символов, с ключевыми словами для SEO",
  "tags": ["тег1","тег2","тег3","тег4","тег5","тег6","тег7","тег8","тег9","тег10"],
  "hook": "хук для первых 5 секунд видео",
  "thumbnail": "конкретная идея для превью (цвет фона, текст, позиция игрока)",
  "time": "HH:MM"
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.claudeKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [{ role:'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const text = data.content[0].text;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON not found');
  return JSON.parse(match[0]);
}

const T_TITLES = [
  '🔥 {idea} — ТОП компиляция {year}',
  '😱 {idea} | Невозможное возможно',
  '⚽ {idea} — Смотри до конца!',
  '🚀 {idea} | Лучшее за {year}',
  '💥 {idea} — Это должен видеть каждый',
];
const T_HOOKS = [
  'То что произошло на {min}-й минуте изменило всё...',
  'Ты не поверишь своим глазам. Досмотри до конца.',
  'Один момент — стадион взорвался. Смотри.',
  'Я не верил, что такое возможно в футболе.',
];
const T_TAGS = ['football','футбол','skills','highlights','топ','goals','голы','компиляция','football2025','топфутбол'];
const T_THUMBS = [
  'Тёмный фон, игрок в прыжке, неоновый текст сверху с числом/словом',
  'Split-screen: игрок слева, реакция болельщика справа, красный градиент',
  'Крупный план лица игрока (удивление), жирный текст снизу на чёрном фоне',
  'Огненный эффект за игроком, тёмный фон, счёт матча в углу',
];

function pick(arr) { return arr[Math.floor(Math.random()*arr.length)]; }
function generateWithTemplates(channel, type, idea) {
  const year = new Date().getFullYear();
  const min = Math.floor(Math.random()*70)+10;
  const title = pick(T_TITLES)
    .replace('{idea}', idea.slice(0,40))
    .replace('{year}', year)
    .slice(0,70);
  const hook = pick(T_HOOKS).replace('{min}', min);
  const tags = [...T_TAGS].sort(()=>Math.random()-.5).slice(0,10);
  const typeMap = { long:'16:00', short:'10:00', post:'14:00' };
  return {
    title,
    description: `${idea} — смотри полную нарезку на канале ${channel.title}! Подписывайся чтобы не пропустить лучшие моменты. #football #${channel.title.replace(/\s/g,'')}`.slice(0,200),
    tags,
    hook,
    thumbnail: pick(T_THUMBS),
    time: typeMap[type] || '16:00',
  };
}

// ─── CONTENT PLAN GENERATOR ──────────────────────────────
const PLAN_IDEAS = {
  long:  ['ТОП-10 финтов недели','Лучшие голы месяца','Невозможные сейвы','Самые быстрые игроки','Лучшие угловые'],
  short: ['Лучший финт 60 секунд','Гол с центра поля','Победный пенальти','Невероятный дриблинг','Магия вратаря'],
  post:  ['Опрос: лучший игрок?','Угадай счёт!','Ваш любимый клуб','Предсказание матча','Лучший гол — голосуй!'],
};

function generateContentPlan(period, focus, targetChannels) {
  const today = new Date();
  let days = 7;
  if (period==='month') days=30;
  if (period==='year') days=365;

  const plan = [];
  for (let i=0; i<days; i++) {
    const d = new Date(today); d.setDate(today.getDate()+i);
    const ds = fmtDate(d);
    const isWeekend = d.getDay()===0 || d.getDay()===6;

    targetChannels.forEach(ch => {
      const type = isWeekend
        ? (Math.random()<.6 ? 'short' : 'long')
        : (Math.random()<.4 ? 'long' : Math.random()<.6 ? 'short' : 'post');
      const ideas = PLAN_IDEAS[type];
      const idea = pick(ideas) + (focus ? ` — ${focus.slice(0,20)}` : '');
      const time = { long:isWeekend?'11:00':'16:00', short:'10:00', post:'14:00' }[type];

      // avoid duplicates
      const exists = videos.some(v=>v.date===ds&&v.channelId===ch.id);
      if (!exists) {
        plan.push({
          id: uid(), channelId: ch.id, title: idea,
          date: ds, time, type, status:'planned', ytVideoId:null, ytUrl:null
        });
      }
    });
  }
  return plan;
}

// ─── CALENDAR RENDERING ──────────────────────────────────
function getCalInfo() {
  const base = new Date();
  if (currentView==='month') {
    base.setMonth(base.getMonth()+calOffset);
    return { year: base.getFullYear(), month: base.getMonth() };
  }
  if (currentView==='week') {
    const dow = base.getDay();
    base.setDate(base.getDate() - (dow===0?6:dow-1) + calOffset*7);
    return { startDate: base };
  }
  if (currentView==='year') {
    return { year: new Date().getFullYear() + calOffset };
  }
}

function renderCalendar() {
  const container = document.getElementById('calendarContainer');
  container.innerHTML = '';

  if (currentView==='month') renderMonthView(container);
  else if (currentView==='week') renderWeekView(container);
  else renderYearView(container);
}

function renderMonthView(container) {
  const { year, month } = getCalInfo();
  document.getElementById('calPeriod').textContent = `${MONTHS_RU[month]} ${year}`;

  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const startOffset = firstDay===0 ? 6 : firstDay-1; // Mon=0
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const todayStr = today();

  const grid = document.createElement('div');
  grid.className = 'month-grid';

  ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach(d=>{
    const h=document.createElement('div');
    h.className='month-header'; h.textContent=d;
    grid.appendChild(h);
  });

  // prev month days
  const prevDays = new Date(year, month, 0).getDate();
  for (let i=startOffset-1; i>=0; i--) {
    const cell = createDayCell(new Date(year,month-1,prevDays-i), true, todayStr, year, month);
    grid.appendChild(cell);
  }
  // current month
  for (let d=1; d<=daysInMonth; d++) {
    const cell = createDayCell(new Date(year,month,d), false, todayStr, year, month);
    grid.appendChild(cell);
  }
  // next month fill
  const total = startOffset + daysInMonth;
  const remaining = total%7===0 ? 0 : 7 - (total%7);
  for (let d=1; d<=remaining; d++) {
    const cell = createDayCell(new Date(year,month+1,d), true, todayStr, year, month);
    grid.appendChild(cell);
  }

  container.appendChild(grid);
}

function createDayCell(date, otherMonth, todayStr, year, month) {
  const ds = fmtDate(date);
  const isToday = ds===todayStr;
  const dayVids = videos.filter(v=>v.date===ds);

  const cell = document.createElement('div');
  cell.className = 'month-day' + (otherMonth?' other-month':'') + (isToday?' is-today':'');
  cell.dataset.date = ds;

  const numEl = document.createElement('div');
  numEl.className='day-num'; numEl.textContent=date.getDate();
  cell.appendChild(numEl);

  // Football event?
  const event = FOOTBALL_EVENTS[ds];
  if (event) {
    const flag = document.createElement('div');
    flag.className='day-event-flag'; flag.textContent='⚡ '+event;
    cell.appendChild(flag);
  }

  // Videos (show up to 3)
  dayVids.slice(0,3).forEach(v=>{
    const ch = channels.find(c=>c.id===v.channelId);
    const colorIdx = ch ? ch.colorIdx : 0;
    const vEl = document.createElement('div');
    vEl.className = `day-video ch-${colorIdx} status-${v.status}`;
    vEl.textContent = v.title;
    vEl.title = `${ch?.title||'?'} · ${v.time} · ${v.type}`;
    vEl.addEventListener('click', e => { e.stopPropagation(); openUploadModalEdit(v); });
    cell.appendChild(vEl);
  });
  if (dayVids.length>3) {
    const more = document.createElement('div');
    more.className='day-more'; more.textContent=`+${dayVids.length-3} ещё`;
    cell.appendChild(more);
  }

  cell.addEventListener('click', () => openUploadModal(ds));
  return cell;
}

function renderWeekView(container) {
  const { startDate } = getCalInfo();
  const todayStr = today();
  const endDate = new Date(startDate); endDate.setDate(startDate.getDate()+6);
  document.getElementById('calPeriod').textContent =
    `${startDate.getDate()} ${MONTHS_SHORT[startDate.getMonth()]} — ${endDate.getDate()} ${MONTHS_SHORT[endDate.getMonth()]} ${endDate.getFullYear()}`;

  const grid = document.createElement('div'); grid.className='week-grid';

  for (let i=0; i<7; i++) {
    const d = new Date(startDate); d.setDate(startDate.getDate()+i);
    const ds = fmtDate(d);
    const isToday = ds===todayStr;
    const dayVids = videos.filter(v=>v.date===ds);

    const col = document.createElement('div');
    col.className='week-day-col'+(isToday?' is-today':'');
    col.innerHTML=`
      <div class="week-day-header">
        <div class="week-day-name">${DAYS_RU[d.getDay()]}</div>
        <div class="week-day-num">${d.getDate()}</div>
      </div>`;

    const vidsEl = document.createElement('div'); vidsEl.className='week-videos';
    dayVids.forEach(v=>{
      const ch=channels.find(c=>c.id===v.channelId);
      const colorIdx=ch?ch.colorIdx:0;
      const vEl=document.createElement('div');
      vEl.className=`week-video ch-${colorIdx}`;
      vEl.textContent=`${v.time} ${v.title.slice(0,30)}`;
      vEl.addEventListener('click',e=>{e.stopPropagation();openUploadModalEdit(v);});
      vidsEl.appendChild(vEl);
    });
    col.appendChild(vidsEl);
    col.addEventListener('click', ()=>openUploadModal(ds));
    grid.appendChild(col);
  }
  container.appendChild(grid);
}

function renderYearView(container) {
  const { year } = getCalInfo();
  document.getElementById('calPeriod').textContent = String(year);
  const todayStr = today();

  const grid = document.createElement('div'); grid.className='year-grid';

  for (let m=0; m<12; m++) {
    const monthEl=document.createElement('div'); monthEl.className='year-month';
    monthEl.innerHTML=`<div class="year-month-name">${MONTHS_RU[m]}</div>`;
    const miniGrid=document.createElement('div'); miniGrid.className='year-mini-grid';

    const firstDow = new Date(year,m,1).getDay();
    const offset = firstDow===0?6:firstDow-1;
    const days = new Date(year,m+1,0).getDate();

    for(let i=0;i<offset;i++){
      const blank=document.createElement('div');blank.className='year-mini-day';
      miniGrid.appendChild(blank);
    }
    for(let d=1;d<=days;d++){
      const ds=`${year}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const hasVid=videos.some(v=>v.date===ds);
      const isToday=ds===todayStr;
      const cell=document.createElement('div');
      cell.className='year-mini-day'+(hasVid?' has-video':'')+(isToday?' is-today':'');
      cell.title=`${d} ${MONTHS_SHORT[m]}`;
      cell.textContent=d;
      cell.addEventListener('click',()=>openUploadModal(ds));
      miniGrid.appendChild(cell);
    }
    monthEl.appendChild(miniGrid);
    grid.appendChild(monthEl);
  }
  container.appendChild(grid);
}

// ─── CHANNEL LIST ─────────────────────────────────────────
function renderChannelList() {
  const list = document.getElementById('channelsList');
  list.innerHTML = '';
  channels.forEach(ch=>{
    const item=document.createElement('div');
    item.className='channel-item';
    item.innerHTML=`
      <div class="ch-dot" style="background:${CH_DOT_COLORS[ch.colorIdx]}"></div>
      <div class="ch-info">
        <div class="ch-name">${ch.title}</div>
        <div class="ch-sub">${ch.id}</div>
      </div>`;
    list.appendChild(item);
  });
}

// ─── UPLOAD MODAL ─────────────────────────────────────────
function openUploadModal(dateStr) {
  pendingUpload = { file: null, date: dateStr };
  currentTags = [];

  resetUploadModal();
  document.getElementById('modalDateTitle').textContent =
    '📤 Загрузить видео — ' + formatDisplayDate(dateStr);
  document.getElementById('scheduleDate').value = dateStr;

  // Populate channel selector
  const sel = document.getElementById('uploadChannel');
  sel.innerHTML = channels.length
    ? channels.map(c=>`<option value="${c.id}">${c.title}</option>`).join('')
    : '<option value="">Сначала подключи канал</option>';

  document.getElementById('uploadModal').classList.remove('hidden');
}

function openUploadModalEdit(video) {
  openUploadModal(video.date);
  // Pre-fill title etc if available
}

function closeUploadModal() {
  document.getElementById('uploadModal').classList.add('hidden');
  pendingUpload = { file:null, date:null };
  currentTags = [];
}

function resetUploadModal() {
  ['uploadStep1','uploadStep2','uploadStep3','uploadStep4'].forEach((id,i)=>{
    document.getElementById(id).classList.toggle('hidden', i!==0);
  });
  document.getElementById('filePreview').classList.add('hidden');
  document.getElementById('dropZone').classList.remove('hidden');
  document.getElementById('btnGenerateMeta').disabled = true;
  pendingUpload.file = null;
  currentTags = [];
  renderTags();
}

function showUploadStep(n) {
  [1,2,3,4].forEach(i=>{
    document.getElementById('uploadStep'+i).classList.toggle('hidden', i!==n);
  });
}

function formatDisplayDate(ds) {
  const d=parseDate(ds);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function handleFile(file) {
  if (!file) return;
  pendingUpload.file = file;
  document.getElementById('dropZone').classList.add('hidden');
  document.getElementById('filePreview').classList.remove('hidden');
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('fileSize').textContent = fmtSize(file.size);
  document.getElementById('btnGenerateMeta').disabled = false;
}

function renderTags() {
  const wrap = document.getElementById('tagsWrap');
  wrap.innerHTML = currentTags.map((t,i)=>`
    <span class="tag-chip">#${t}<button data-i="${i}">✕</button></span>`).join('');
  wrap.querySelectorAll('button').forEach(btn=>{
    btn.onclick=()=>{ currentTags.splice(Number(btn.dataset.i),1); renderTags(); };
  });
}

// ─── PLAN MODAL ───────────────────────────────────────────
function openPlanModal() {
  const checkDiv = document.getElementById('planChannelsCheck');
  checkDiv.innerHTML = channels.length
    ? channels.map(ch=>`
        <label>
          <input type="checkbox" value="${ch.id}" checked/>
          <span class="ch-dot" style="background:${CH_DOT_COLORS[ch.colorIdx]};display:inline-block;width:8px;height:8px;border-radius:50%"></span>
          ${ch.title}
        </label>`).join('')
    : '<p style="color:var(--text3);font-size:.85rem">Нет подключённых каналов</p>';
  document.getElementById('planModal').classList.remove('hidden');
}

function closePlanModal() {
  document.getElementById('planModal').classList.add('hidden');
}

function confirmPlan() {
  const period = document.getElementById('planPeriod').value;
  const focus  = document.getElementById('planFocus').value.trim();
  const checked = [...document.querySelectorAll('#planChannelsCheck input:checked')].map(i=>i.value);
  const targetChannels = channels.filter(c=>checked.includes(c.id));

  if (!targetChannels.length) { showToast('Выбери хотя бы один канал', true); return; }

  const plan = generateContentPlan(period, focus, targetChannels);
  videos.push(...plan);
  saveStorage();
  closePlanModal();
  renderCalendar();
  showToast(`✅ Добавлено ${plan.length} видео в план!`);
}

// ─── SETTINGS ─────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
  document.getElementById('tab-'+name).classList.remove('hidden');
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');
  document.getElementById('pageTitle').textContent =
    name==='calendar' ? 'Контент-календарь' : 'Настройки';
  if (name==='settings') {
    document.getElementById('settingsClientId').value = cfg.clientId||'';
    document.getElementById('settingsClaudeKey').value = cfg.claudeKey||'';
  }
}

// ─── INIT & EVENT WIRING ─────────────────────────────────
async function init() {
  loadStorage();

  // Seed some football events
  const base = new Date();
  const add=(d,name)=>{const dt=new Date(base);dt.setDate(base.getDate()+d);FOOTBALL_EVENTS[fmtDate(dt)]=name;};
  add(3,'Финал Лиги Чемпионов');add(7,'Барселона — Реал');add(11,'Начало Copa América');add(18,'Финал Лиги Европы');

  // ─── SETUP SCREEN — attach BEFORE any early return ───
  document.getElementById('btnSaveSetup').addEventListener('click', ()=>{
    const cid = document.getElementById('inputClientId').value.trim();
    const ckey = document.getElementById('inputClaudeKey').value.trim();
    if (!cid) { showToast('Введи Client ID', true); return; }
    cfg.clientId = cid;
    if (ckey) cfg.claudeKey = ckey;
    saveStorage();
    initAppListeners();
    showApp();
  });

  // Handle OAuth callback
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  if (code) {
    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
    if (cfg.clientId) {
      const ok = await handleOAuthCallback(code);
      if (ok) { initAppListeners(); showApp(); return; }
    }
  }

  // Decide screen
  if (!cfg.clientId) { showSetup(); return; }
  initAppListeners();
  showApp();

function initAppListeners() {
  if (window._listenersInited) return;
  window._listenersInited = true;

  // ─── SIDEBAR ───
  document.getElementById('btnAddChannel').addEventListener('click', startOAuth);
  document.getElementById('btnSidebarOpen').addEventListener('click', ()=>{
    document.getElementById('sidebar').classList.toggle('open');
  });
  document.getElementById('btnSidebarClose').addEventListener('click', ()=>{
    document.getElementById('sidebar').classList.remove('open');
  });

  // ─── TABS ───
  document.querySelectorAll('[data-tab]').forEach(btn=>{
    btn.addEventListener('click', ()=>switchTab(btn.dataset.tab));
  });

  // ─── VIEW SWITCHER ───
  document.querySelectorAll('.view-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.view-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      calOffset = 0;
      renderCalendar();
    });
  });

  // ─── CALENDAR NAV ───
  document.getElementById('btnPrev').addEventListener('click', ()=>{ calOffset--; renderCalendar(); });
  document.getElementById('btnNext').addEventListener('click', ()=>{ calOffset++; renderCalendar(); });

  // ─── CONTENT PLAN ───
  document.getElementById('btnGenPlan').addEventListener('click', ()=>{
    if (!channels.length) { showToast('Сначала подключи хотя бы один канал', true); return; }
    openPlanModal();
  });
  document.getElementById('btnClosePlan').addEventListener('click', closePlanModal);
  document.getElementById('btnCancelPlan').addEventListener('click', closePlanModal);
  document.getElementById('btnConfirmPlan').addEventListener('click', confirmPlan);

  // ─── UPLOAD MODAL ───
  document.getElementById('btnCloseUpload').addEventListener('click', closeUploadModal);
  document.getElementById('uploadModal').addEventListener('click', e=>{
    if (e.target===document.getElementById('uploadModal')) closeUploadModal();
  });

  // Drop zone
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  dropZone.addEventListener('click', ()=>fileInput.click());
  dropZone.addEventListener('dragover', e=>{ e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', ()=>dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e=>{
    e.preventDefault(); dropZone.classList.remove('drag-over');
    handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', ()=>handleFile(fileInput.files[0]));
  document.getElementById('btnRemoveFile').addEventListener('click', ()=>{
    pendingUpload.file=null;
    fileInput.value='';
    document.getElementById('filePreview').classList.add('hidden');
    document.getElementById('dropZone').classList.remove('hidden');
    document.getElementById('btnGenerateMeta').disabled=true;
  });

  // Generate meta button
  document.getElementById('btnGenerateMeta').addEventListener('click', async ()=>{
    const btn = document.getElementById('btnGenerateMeta');
    btn.disabled=true; btn.textContent='✨ Генерирую...';

    const chId = document.getElementById('uploadChannel').value;
    const ch = channels.find(c=>c.id===chId) || {title:'Канал'};
    const type = document.getElementById('uploadType').value;
    const filename = pendingUpload.file ? pendingUpload.file.name : 'video';

    const meta = await generateMetadata(ch, type, filename);

    document.getElementById('metaTitle').value = meta.title || '';
    document.getElementById('metaDesc').value  = meta.description || '';
    document.getElementById('metaHook').value      = meta.hook || '';
    document.getElementById('metaThumbnail').value = meta.thumbnail || '';

    currentTags = meta.tags || [];
    renderTags();

    // Set suggested time
    if (meta.time) {
      document.getElementById('scheduleTime').value = meta.time;
    }

    // Char counter
    updateTitleCounter();
    showUploadStep(2);

    btn.disabled=false; btn.textContent='✨ Сгенерировать метаданные AI';
  });

  // Title counter
  document.getElementById('metaTitle').addEventListener('input', updateTitleCounter);
  function updateTitleCounter() {
    const len = document.getElementById('metaTitle').value.length;
    document.getElementById('titleCounter').textContent = `${len}/70`;
    document.getElementById('titleCounter').style.color = len>70?'var(--accent)':'var(--text3)';
  }

  // Tags input
  document.getElementById('tagsInput').addEventListener('keydown', e=>{
    if (e.key==='Enter'||e.key===',') {
      e.preventDefault();
      const val = e.target.value.replace(/[#,]/g,'').trim();
      if (val && !currentTags.includes(val)) { currentTags.push(val); renderTags(); }
      e.target.value='';
    }
  });

  // Back button
  document.getElementById('btnBackToStep1').addEventListener('click', ()=>showUploadStep(1));

  // Upload button
  document.getElementById('btnUpload').addEventListener('click', async ()=>{
    if (!pendingUpload.file) { showToast('Файл не выбран', true); return; }
    const chId = document.getElementById('uploadChannel').value;
    if (!chId || !channels.find(c=>c.id===chId)) {
      showToast('Выбери канал', true); return;
    }

    const title   = document.getElementById('metaTitle').value.trim();
    const desc    = document.getElementById('metaDesc').value.trim();
    const date    = document.getElementById('scheduleDate').value;
    const time    = document.getElementById('scheduleTime').value;
    const privacy = document.getElementById('privacyStatus').value;

    if (!title) { showToast('Введи заголовок', true); return; }

    showUploadStep(3);
    document.getElementById('progressTitle').textContent = `Загружаю "${title}"...`;

    const videoId = await uploadToYouTube(chId, pendingUpload.file, {
      title, description: desc, tags: currentTags, date, time, privacy
    });

    if (!videoId) {
      showUploadStep(2);
      return;
    }

    // Save to calendar
    const newVideo = {
      id: uid(), channelId: chId, title,
      date, time, type: document.getElementById('uploadType').value,
      status: privacy==='public' ? 'published' : 'planned',
      ytVideoId: videoId,
      ytUrl: `https://www.youtube.com/watch?v=${videoId}`,
    };
    videos.push(newVideo);
    saveStorage();
    renderCalendar();

    document.getElementById('doneMessage').textContent =
      privacy==='scheduled'
        ? `Видео запланировано на ${formatDisplayDate(date)} ${time}`
        : 'Видео успешно загружено на YouTube!';
    document.getElementById('doneLink').href = newVideo.ytUrl;
    showUploadStep(4);
    showToast('✅ Видео загружено!');
  });

  document.getElementById('btnUploadAnother').addEventListener('click', ()=>{
    resetUploadModal();
    showUploadStep(1);
  });

  // Settings
  document.getElementById('btnSaveSettings').addEventListener('click', ()=>{
    cfg.clientId = document.getElementById('settingsClientId').value.trim();
    cfg.claudeKey = document.getElementById('settingsClaudeKey').value.trim();
    saveStorage();
    showToast('✅ Настройки сохранены');
  });
  document.getElementById('btnClearData').addEventListener('click', ()=>{
    if (confirm('Удалить все данные? Каналы, видео, план — всё будет очищено.')) {
      localStorage.clear();
      location.reload();
    }
  });
} // end initAppListeners

document.addEventListener('DOMContentLoaded', init);
