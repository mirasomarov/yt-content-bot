/* =========================================================
   YouTube Content Bot — App Logic
   ========================================================= */

'use strict';

// ─── STATE ───────────────────────────────────────────────
const STATE_KEY = 'yt_content_bot_v1';

let state = {
  publications: [],     // { id, date, channel, type, title, time, status }
  currentWeekOffset: 0,
};

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      state.publications = saved.publications || [];
    }
  } catch (_) {}
  seedDemoData();
}

function saveState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

// ─── SEED DEMO DATA ──────────────────────────────────────
function seedDemoData() {
  if (state.publications.length > 0) return;

  const today = new Date();
  const demos = [
    { daysOffset: -2, channel: 'hub',     type: 'long',  title: 'ТОП-10 финтов недели',              time: '16:00', status: 'published' },
    { daysOffset: -1, channel: 'ballers', type: 'short', title: 'Мбаппе vs Ямаль — кто лучше?',      time: '09:00', status: 'published' },
    { daysOffset:  0, channel: 'yamal',   type: 'long',  title: 'Ямаль — Король Ла Лиги 2025',        time: '17:00', status: 'planned'   },
    { daysOffset:  0, channel: 'hub',     type: 'short', title: 'Лучший финт месяца #Shorts',          time: '12:00', status: 'planned'   },
    { daysOffset:  1, channel: 'ballers', type: 'long',  title: 'Холанд: все голы за сезон',           time: '16:00', status: 'planned'   },
    { daysOffset:  2, channel: 'yamal',   type: 'short', title: 'Ямаль дриблинг компиляция',           time: '10:00', status: 'planned'   },
    { daysOffset:  3, channel: 'hub',     type: 'post',  title: 'Опрос: лучший финт недели',           time: '14:00', status: 'planned'   },
    { daysOffset:  4, channel: 'ballers', type: 'short', title: 'Топ голы Лиги Чемпионов',             time: '11:00', status: 'planned'   },
    { daysOffset:  5, channel: 'hub',     type: 'long',  title: 'Топ-5 бегущих игроков сезона',        time: '16:00', status: 'planned'   },
  ];

  demos.forEach(d => {
    const date = new Date(today);
    date.setDate(date.getDate() + d.daysOffset);
    state.publications.push({
      id: uid(),
      date: formatDate(date),
      channel: d.channel,
      type: d.type,
      title: d.title,
      time: d.time,
      status: d.status,
    });
  });

  saveState();
}

// ─── UTILS ───────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9); }

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function parseDate(s) {
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
}

function russianWeekday(i) {
  return ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][i];
}

function russianMonth(m) {
  return ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'][m];
}

function showToast(msg, color = 'var(--green)') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.borderLeftColor = color;
  t.classList.remove('hidden');
  clearTimeout(t._to);
  t._to = setTimeout(() => t.classList.add('hidden'), 2800);
}

function channelName(c) {
  return { hub: 'Hub of Ballers', ballers: 'BaIIersHub', yamal: 'YamalPedia' }[c] || c;
}

function typeName(t) {
  return { long: 'Лонг', short: 'Short', post: 'Пост' }[t] || t;
}

// ─── TAB NAVIGATION ──────────────────────────────────────
const TABS = ['schedule','metadata','contentplan','analytics'];
const TITLES = {
  schedule:    'Расписание публикаций',
  metadata:    'Мета-генератор (AI)',
  contentplan: 'Контент-план (AI)',
  analytics:   'Аналитика',
};

function switchTab(name) {
  TABS.forEach(t => {
    document.getElementById(`tab-${t}`).classList.remove('active');
    document.querySelector(`[data-tab="${t}"]`).classList.remove('active');
  });
  document.getElementById(`tab-${name}`).classList.add('active');
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');
  document.getElementById('pageTitle').textContent = TITLES[name];

  if (name === 'analytics') renderAnalytics();
}

// ─── SCHEDULE / CALENDAR ─────────────────────────────────
function getWeekDates(offset = 0) {
  const today = new Date();
  const dow = today.getDay(); // 0=Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

const FOOTBALL_EVENTS = {
  // format: 'YYYY-MM-DD': 'event name'
};

// Generate some events around today
(function seedEvents() {
  const base = new Date();
  const add = (d, name) => {
    const dt = new Date(base);
    dt.setDate(base.getDate() + d);
    FOOTBALL_EVENTS[formatDate(dt)] = name;
  };
  add(2,  'Финал Лиги Чемпионов');
  add(5,  'Начало Copa América');
  add(9,  'Матч Барселона — Реал Мадрид');
  add(12, 'Открытие трансферного окна');
  add(16, 'Финал Лиги Европы');
})();

function renderCalendar() {
  const days = getWeekDates(state.currentWeekOffset);
  const today = formatDate(new Date());

  // Update week label
  const first = days[0], last = days[6];
  document.getElementById('weekLabel').textContent =
    `${first.getDate()} ${russianMonth(first.getMonth())} — ${last.getDate()} ${russianMonth(last.getMonth())} ${last.getFullYear()}`;

  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';

  let weekCount = 0;

  days.forEach(day => {
    const ds = formatDate(day);
    const isToday = ds === today;
    const event = FOOTBALL_EVENTS[ds];
    const pubs = state.publications.filter(p => p.date === ds)
                   .sort((a,b) => a.time.localeCompare(b.time));

    if (ds >= formatDate(new Date()) || state.currentWeekOffset >= 0) {
      weekCount += pubs.filter(p => p.status === 'planned' || p.status === 'published').length;
    }

    const col = document.createElement('div');
    col.className = `cal-day${isToday ? ' is-today' : ''}${event ? ' is-event' : ''}`;
    col.dataset.date = ds;

    const numEl = isToday
      ? `<div class="cal-day-num">${day.getDate()}</div>`
      : `<span class="cal-day-num">${day.getDate()}</span>`;

    col.innerHTML = `
      <div class="cal-day-header">
        <span class="cal-day-name">${russianWeekday(day.getDay())}</span>
        ${numEl}
      </div>
      ${event ? `<span class="event-flag">⚡ ${event}</span>` : ''}
    `;

    pubs.forEach(p => {
      const item = document.createElement('div');
      item.className = `pub-item ch-${p.channel} status-${p.status}`;
      item.title = `${channelName(p.channel)} · ${typeName(p.type)} · ${p.status}`;
      item.innerHTML = `
        <span class="pub-name">${p.title}</span>
        <span class="pub-time">${p.time} · <span class="badge badge-${p.type}">${typeName(p.type)}</span></span>
        <button class="pub-delete" data-id="${p.id}">✕</button>
      `;
      col.appendChild(item);
    });

    col.addEventListener('click', e => {
      if (e.target.classList.contains('pub-delete')) {
        const id = e.target.dataset.id;
        state.publications = state.publications.filter(p => p.id !== id);
        saveState();
        renderCalendar();
        showToast('Публикация удалена');
        return;
      }
      // Click on day → open add modal with pre-filled date
      document.getElementById('addDate').value = ds;
      document.getElementById('addModal').classList.remove('hidden');
    });

    grid.appendChild(col);
  });

  document.getElementById('weekCount').textContent = state.publications.filter(p => {
    const dates = days.map(formatDate);
    return dates.includes(p.date);
  }).length;
}

// ─── ADD PUBLICATION MODAL ───────────────────────────────
function openAddModal() {
  const today = formatDate(new Date());
  document.getElementById('addDate').value = today;
  document.getElementById('addModal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('addModal').classList.add('hidden');
}

function confirmAdd() {
  const date    = document.getElementById('addDate').value;
  const channel = document.getElementById('addChannel').value;
  const type    = document.getElementById('addType').value;
  const title   = document.getElementById('addTitle').value.trim();
  const time    = document.getElementById('addTime').value;
  const status  = document.getElementById('addStatus').value;

  if (!date || !title) { showToast('Заполни дату и название!', 'var(--accent)'); return; }

  state.publications.push({ id: uid(), date, channel, type, title, time, status });
  saveState();
  closeModal();
  renderCalendar();
  showToast('✅ Публикация добавлена!');
  document.getElementById('addTitle').value = '';
}

// ─── METADATA GENERATOR (simulated AI) ───────────────────
const META_TEMPLATES = {
  hub: {
    long: {
      titles: [
        'ТОП-10 финтов {idea} — Лучшее за 2025',
        '{idea} | Невероятные моменты #Football',
        'Невозможные финты: {idea} | ТОП компиляция',
      ],
      hooks: [
        'Ты не поверишь, что этот игрок сделал на {min} минуте…',
        'Один финт — и стадион встал. Смотри на {sec} секунде.',
        'Если это не войдёт в топ года — я удаляю канал.',
      ],
    },
    short: {
      titles: [
        '{idea} #Shorts #Football',
        'Это за 60 секунд изменит твой взгляд на футбол 🔥 #{hashtag}',
        '{idea} | Момент на миллион #Reels',
      ],
      hooks: [
        'Досмотри до конца — там кое-что НЕРЕАЛЬНОЕ 🤯',
        'За 30 секунд покажу лучший момент недели.',
        'Стоп. Посмотри на это.',
      ],
    },
    post: {
      titles: ['Опрос: {idea}', 'Ваше мнение: {idea}'],
      hooks: ['Выбери вариант ниже 👇', 'Отвечайте в комментариях!'],
    },
  },
  ballers: {
    long: {
      titles: [
        '{idea} — Все голы и ассисты | Компиляция 2025',
        'Почему {idea} лучший в мире прямо сейчас',
        '{idea} | Полная карьерная нарезка',
      ],
      hooks: [
        'Этот игрок переписал историю. Вот доказательства.',
        'Один сезон — {num} голов. Смотри полную нарезку.',
        'Мы собрали ВСЕ его лучшие моменты. Все.',
      ],
    },
    short: {
      titles: ['{idea} 🔥 #Shorts', '{idea} моменты #Football #Shorts'],
      hooks: ['60 секунд гениального футбола.', 'Этот момент будут помнить годами.'],
    },
    post: {
      titles: ['Кто лучше: {idea}?', '{idea} — ваше мнение?'],
      hooks: ['Голосуй прямо сейчас 👇', 'Расскажи в комментариях!'],
    },
  },
  yamal: {
    long: {
      titles: [
        'Lamine Yamal: {idea} | ПОЛНАЯ нарезка 2025',
        'Ямаль — {idea} | Почему он лучший в 17 лет',
        '{idea}: Ямаль против всего мира',
      ],
      hooks: [
        'В 17 лет сделать это — просто невозможно. Но он сделал.',
        'Ямаль снова доказал, что он феномен поколения.',
        'Этот момент Ямаля войдёт в историю.',
      ],
    },
    short: {
      titles: ['Ямаль снова шокировал всех 😱 #Shorts', '{idea} — Ямаль #YamalPedia #Shorts'],
      hooks: ['Посмотри что он сделал за 5 секунд.', 'Ямаль в 17 лет vs легенды футбола.'],
    },
    post: {
      titles: ['Ямаль лучший в мире? {idea}', 'Ваше мнение о Ямале: {idea}'],
      hooks: ['Голосуй 👇', 'Комментируй!'],
    },
  },
};

const TAGS_POOL = {
  hub: ['football', 'skills', 'фины', 'футбол', 'топфутбол', 'hubofballers', 'skills2025', 'footballskills', 'freeestyle', 'topskills'],
  ballers: ['mbappe', 'haaland', 'yamal', 'highlights', 'football2025', 'лигачемпионов', 'топголы', 'ballers', 'топигроки', 'компиляция'],
  yamal: ['yamal', 'ламинямаль', 'яамальпедиа', 'барселона', 'лалига', 'yamal2025', 'lamineяamal', 'футбольныйгений', 'топ17лет', 'yamalgoals'],
};

const THUMBNAILS = [
  'Крупный план игрока в прыжке, яркий неоновый фон, большой текст с цифрой/словом сверху',
  'Split-screen: игрок слева + реакция фаната справа, тёмный фон с красным градиентом',
  'Лицо игрока крупным планом (удивление/злость), текст снизу жирным шрифтом на чёрном',
  'Эффект "огонь" за игроком на тёмном фоне, цифра результата в углу',
];

const TIMES_BY_TYPE = {
  long: ['16:00', '17:00', '18:00', '19:00'],
  short: ['09:00', '10:00', '11:00', '12:00'],
  post: ['14:00', '15:00'],
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

function generateMetadata(channel, type, idea, lang) {
  const tmpl = META_TEMPLATES[channel]?.[type] || META_TEMPLATES.hub.long;
  const raw = idea.length > 30 ? idea.slice(0, 28) + '…' : idea;

  let title = pick(tmpl.titles)
    .replace('{idea}', raw)
    .replace('{hashtag}', channel === 'yamal' ? 'Yamal' : 'Football')
    .slice(0, 70);

  let hook = pick(tmpl.hooks)
    .replace('{min}', rand(23, 87))
    .replace('{sec}', rand(5, 25))
    .replace('{num}', rand(20, 54));

  const tags = TAGS_POOL[channel]
    .sort(() => Math.random() - 0.5)
    .slice(0, 10);

  const timeOptions = TIMES_BY_TYPE[type] || ['16:00'];
  const recTime = pick(timeOptions);

  let desc = '';
  if (lang === 'ru') {
    desc = `${idea.slice(0, 80)} — смотри полную нарезку на канале ${channelName(channel)}! Подписывайся чтобы не пропустить лучшие моменты. #football #${channel}`;
  } else {
    desc = `${idea.slice(0, 80)} — full compilation on ${channelName(channel)}! Subscribe for more football highlights. #football #${channel}`;
  }

  desc = desc.slice(0, 200);

  return { title, hook, desc, tags, thumbnail: pick(THUMBNAILS), recTime };
}

let lastGeneratedMeta = null;

async function handleGenerateMeta() {
  const channel = document.getElementById('metaChannel').value;
  const type    = document.getElementById('metaType').value;
  const idea    = document.getElementById('metaIdea').value.trim();
  const lang    = document.getElementById('metaLang').value;

  if (!idea) { showToast('Введи идею видео!', 'var(--accent)'); return; }

  document.getElementById('metaResult').classList.add('hidden');
  document.getElementById('metaSpinner').classList.remove('hidden');

  // Simulate API delay
  await new Promise(r => setTimeout(r, 1400 + Math.random() * 600));

  const meta = generateMetadata(channel, type, idea, lang);
  lastGeneratedMeta = { ...meta, channel, type };

  document.getElementById('metaSpinner').classList.add('hidden');

  document.getElementById('resTitle').textContent     = meta.title;
  document.getElementById('resHook').textContent      = meta.hook;
  document.getElementById('resDesc').textContent      = meta.desc;
  document.getElementById('resThumbnail').textContent = meta.thumbnail;
  document.getElementById('resTime').textContent      = meta.recTime + ' GMT+5';

  const tagsWrap = document.getElementById('resTags');
  tagsWrap.innerHTML = meta.tags.map(t => `<span class="tag">#${t}</span>`).join('');

  document.getElementById('metaResult').classList.remove('hidden');
  showToast('✅ Метаданные сгенерированы!');
}

// ─── CONTENT PLAN GENERATOR ──────────────────────────────
const PLAN_TEMPLATES = [
  {
    title: 'Лонг: топ-компиляция',
    why: 'Высокий retention у компиляций — удерживает аудиторию и растит Watch Time',
    typeWeights: ['long', 'long', 'short', 'short', 'short', 'post'],
  },
];

const CONTENT_IDEAS = {
  hub: [
    'ТОП-10 финтов этой недели',
    'Лучшие сейвы вратарей',
    'Самые быстрые игроки в мире',
    'Невероятные голы со штрафных',
    'Финты, которые унизили соперника',
  ],
  ballers: [
    'Все голы Мбаппе в этом сезоне',
    'Холанд vs Мбаппе: кто лучше?',
    'Лучшие моменты Реал Мадрид',
    'Компиляция голов UCL 2025',
    'ТОП ассисты сезона',
  ],
  yamal: [
    'Ямаль: лучшие финты в Ла Лиге',
    'Ямаль vs Роналду в 17 лет — сравнение',
    'Все голы Ямаля за Барселону',
    'Ямаль — будущий Балон д\'Ор?',
    'Дриблинг Ямаля: невозможное возможно',
  ],
};

const WHYS = {
  long: 'Лонги в 16:00–19:00 дают максимальный охват в СНГ (GMT+5) в рабочее время',
  short: 'Shorts утром 9–11:00 попадают в рекомендации до начала рабочего дня',
  post: 'Community-посты усиливают вовлечённость и помогают алгоритму',
};

const STRAT_TIPS = [
  '🎯 Публикуй Shorts сразу после матча — в первые 2 часа трафик в 3× выше обычного.',
  '📈 Чередуй лонги и Shorts — алгоритм поощряет каналы с разнообразным контентом.',
  '🔗 Анонсируй лонги через Community-посты за 2–4 часа до публикации.',
  '⚡ Реагируй на трансферные новости в течение 1–2 часов — тогда твоё видео первым в тренде.',
  '🌍 Для аудитории СНГ (GMT+5) пиковые часы: 16–20 часов по Алматы/Ташкенту.',
];

async function handleGeneratePlan() {
  const period   = parseInt(document.getElementById('planPeriod').value);
  const focus    = document.getElementById('planFocus').value.trim() || 'текущий сезон';
  const selEl    = document.getElementById('planChannels');
  const channels = Array.from(selEl.selectedOptions).map(o => o.value);

  if (channels.length === 0) { showToast('Выбери хотя бы один канал!', 'var(--accent)'); return; }

  document.getElementById('planResult').classList.add('hidden');
  document.getElementById('planSpinner').classList.remove('hidden');

  await new Promise(r => setTimeout(r, 1800 + Math.random() * 800));

  document.getElementById('planSpinner').classList.add('hidden');

  const today = new Date();
  const days = Array.from({ length: period }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });

  let totalPubs = 0;
  let shortCount = 0, longCount = 0, postCount = 0;

  const dayPlans = days.map(day => {
    const ds = formatDate(day);
    const event = FOOTBALL_EVENTS[ds];
    const dow = day.getDay(); // 0=Sun,6=Sat
    const isWeekend = dow === 0 || dow === 6;

    const posts = [];

    channels.forEach(ch => {
      // decide type based on day
      let type;
      if (event) {
        type = 'short'; // event days → Shorts first
      } else if (isWeekend) {
        type = Math.random() < .6 ? 'short' : 'long';
      } else {
        type = Math.random() < .45 ? 'long' : (Math.random() < .6 ? 'short' : 'post');
      }

      const ideas = CONTENT_IDEAS[ch] || CONTENT_IDEAS.hub;
      const idea = pick(ideas);
      const time = pick(TIMES_BY_TYPE[type] || ['16:00']);

      posts.push({ channel: ch, type, title: idea, time, why: WHYS[type] });
      totalPubs++;
      if (type === 'short') shortCount++;
      else if (type === 'long') longCount++;
      else postCount++;
    });

    return { date: day, ds, event, posts };
  });

  // Render
  const shortPct = Math.round((shortCount / totalPubs) * 100);
  document.getElementById('planTitle').textContent =
    `Контент-план на ${period} дней · Фокус: ${focus}`;
  document.getElementById('planStats').innerHTML = `
    <span class="stat-pill">📹 Всего: ${totalPubs}</span>
    <span class="stat-pill badge-short" style="background:rgba(34,197,94,.1);color:#86efac;border:1px solid rgba(34,197,94,.3)">Shorts: ${shortPct}% ${shortPct >= 40 ? '✓' : '⚠️'}</span>
    <span class="stat-pill">Лонги: ${longCount}</span>
    <span class="stat-pill">Посты: ${postCount}</span>
  `;

  document.getElementById('planAdvice').innerHTML = `
    <strong>💡 Стратегия на период:</strong><br/>
    ${pick(STRAT_TIPS)}<br/><br/>
    ${pick(STRAT_TIPS)}
  `;

  const daysEl = document.getElementById('planDays');
  daysEl.innerHTML = '';

  dayPlans.forEach(d => {
    const div = document.createElement('div');
    div.className = 'plan-day';
    div.innerHTML = `
      <div class="plan-day-header">
        <span class="plan-day-date">${russianWeekday(d.date.getDay())}, ${d.date.getDate()} ${russianMonth(d.date.getMonth())}</span>
        ${d.event ? `<span class="plan-day-event">⚡ ${d.event}</span>` : ''}
      </div>
      <div class="plan-posts">
        ${d.posts.map(p => `
          <div class="plan-post">
            <div>
              <div class="plan-post-channel ch-${p.channel}">${channelName(p.channel)}</div>
              <span class="badge badge-${p.type}" style="margin-top:4px">${typeName(p.type)}</span>
            </div>
            <div>
              <div class="plan-post-title">${p.title}</div>
              <div class="plan-post-why">${p.why}</div>
            </div>
            <div class="plan-post-meta">
              <span style="color:var(--accent);font-weight:700">${p.time}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    daysEl.appendChild(div);
  });

  // Store for "load to schedule"
  window._planDays = dayPlans;

  document.getElementById('planResult').classList.remove('hidden');
  showToast(`✅ Контент-план на ${period} дней готов!`);
}

function addPlanToSchedule() {
  if (!window._planDays) return;
  let added = 0;
  window._planDays.forEach(d => {
    d.posts.forEach(p => {
      // avoid duplicates
      const exists = state.publications.some(pub => pub.date === d.ds && pub.channel === p.channel && pub.title === p.title);
      if (!exists) {
        state.publications.push({ id: uid(), date: d.ds, channel: p.channel, type: p.type, title: p.title, time: p.time, status: 'planned' });
        added++;
      }
    });
  });
  saveState();
  renderCalendar();
  showToast(`✅ ${added} публикаций добавлено в расписание!`);
  switchTab('schedule');
}

// ─── ANALYTICS ───────────────────────────────────────────
function renderAnalytics() {
  // Events list
  const evList = document.getElementById('eventsList');
  evList.innerHTML = '';
  const eventEntries = Object.entries(FOOTBALL_EVENTS).sort((a,b)=>a[0].localeCompare(b[0]));
  if (eventEntries.length === 0) {
    evList.innerHTML = '<p style="color:var(--text3);font-size:.85rem">Нет запланированных событий</p>';
  } else {
    eventEntries.forEach(([ds, name]) => {
      const d = parseDate(ds);
      const daysLeft = Math.round((d - new Date()) / 86400000);
      evList.innerHTML += `
        <div class="event-item">
          <span class="event-date">${d.getDate()} ${russianMonth(d.getMonth())}</span>
          <span class="event-name">${name}</span>
          <span class="event-urgency ${daysLeft <= 3 ? 'urgency-high' : 'urgency-med'}">
            ${daysLeft <= 0 ? 'Сегодня' : daysLeft <= 3 ? `${daysLeft}д` : `${daysLeft}д`}
          </span>
        </div>
      `;
    });
  }

  // Publication stats
  const total = state.publications.length;
  const published = state.publications.filter(p => p.status === 'published').length;
  const planned = state.publications.filter(p => p.status === 'planned').length;
  document.getElementById('pubStats').innerHTML = `
    <div class="pub-stat"><div class="pub-stat-num">${total}</div><div class="pub-stat-label">Всего в расписании</div></div>
    <div class="pub-stat"><div class="pub-stat-num" style="color:var(--green)">${published}</div><div class="pub-stat-label">Опубликовано</div></div>
    <div class="pub-stat"><div class="pub-stat-num" style="color:var(--blue)">${planned}</div><div class="pub-stat-label">Запланировано</div></div>
  `;

  // Balance chart
  const longs  = state.publications.filter(p => p.type === 'long').length;
  const shorts  = state.publications.filter(p => p.type === 'short').length;
  const posts  = state.publications.filter(p => p.type === 'post').length;
  const tot = longs + shorts + posts || 1;
  const lh = Math.round((longs/tot)*100);
  const sh = Math.round((shorts/tot)*100);
  const ph = Math.round((posts/tot)*100);

  document.getElementById('balanceChart').innerHTML = `
    <div class="balance-bar" style="height:${lh}%;background:var(--accent)">${lh}%<br/><small>Лонги</small></div>
    <div class="balance-bar" style="height:${sh}%;background:var(--green)">${sh}%<br/><small>Shorts</small></div>
    <div class="balance-bar" style="height:${ph}%;background:var(--blue)">${ph}%<br/><small>Посты</small></div>
  `;
}

// ─── COPY BUTTONS ─────────────────────────────────────────
function setupCopyButtons() {
  document.addEventListener('click', e => {
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;

    if (btn.dataset.targetTags) {
      const tags = Array.from(document.querySelectorAll('#resTags .tag'))
        .map(t => t.textContent).join(', ');
      navigator.clipboard?.writeText(tags).catch(() => {});
      showToast('Теги скопированы!');
      return;
    }

    const el = document.getElementById(btn.dataset.target);
    if (!el) return;
    navigator.clipboard?.writeText(el.textContent).catch(() => {});
    showToast('Скопировано в буфер!');
  });
}

// ─── SAVE TO SCHEDULE (from metadata) ────────────────────
function saveMetaToSchedule() {
  if (!lastGeneratedMeta) return;
  const today = formatDate(new Date());
  state.publications.push({
    id: uid(),
    date: today,
    channel: lastGeneratedMeta.channel,
    type: lastGeneratedMeta.type,
    title: lastGeneratedMeta.title,
    time: lastGeneratedMeta.recTime,
    status: 'planned',
  });
  saveState();
  showToast('✅ Добавлено в расписание!');
  switchTab('schedule');
  renderCalendar();
}

// ─── SIDEBAR TOGGLE ───────────────────────────────────────
function setupSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  const toggle1 = document.getElementById('sidebarToggle');
  const toggle2 = document.getElementById('topbarToggle');

  [toggle1, toggle2].forEach(btn => {
    btn.addEventListener('click', () => sidebar.classList.toggle('open'));
  });

  document.addEventListener('click', e => {
    if (window.innerWidth <= 768 &&
        !sidebar.contains(e.target) &&
        !toggle1.contains(e.target) &&
        !toggle2.contains(e.target)) {
      sidebar.classList.remove('open');
    }
  });
}

// ─── INIT ─────────────────────────────────────────────────
function init() {
  loadState();

  // Today badge
  const now = new Date();
  document.getElementById('todayBadge').textContent =
    `${now.getDate()} ${russianMonth(now.getMonth())} ${now.getFullYear()}`;

  // Tab nav
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Week nav
  document.getElementById('prevWeek').addEventListener('click', () => {
    state.currentWeekOffset--;
    renderCalendar();
  });
  document.getElementById('nextWeek').addEventListener('click', () => {
    state.currentWeekOffset++;
    renderCalendar();
  });

  // FAB
  document.getElementById('openAddModal').addEventListener('click', openAddModal);

  // Modal
  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.getElementById('cancelModal').addEventListener('click', closeModal);
  document.getElementById('confirmAdd').addEventListener('click', confirmAdd);
  document.getElementById('addModal').addEventListener('click', e => {
    if (e.target === document.getElementById('addModal')) closeModal();
  });

  // Metadata generator
  document.getElementById('generateMeta').addEventListener('click', handleGenerateMeta);
  document.getElementById('saveToSchedule').addEventListener('click', saveMetaToSchedule);

  // Content plan
  document.getElementById('generatePlan').addEventListener('click', handleGeneratePlan);
  document.getElementById('addPlanToSchedule').addEventListener('click', addPlanToSchedule);

  // Copy
  setupCopyButtons();

  // Sidebar
  setupSidebarToggle();

  // Initial render
  renderCalendar();
}

document.addEventListener('DOMContentLoaded', init);
