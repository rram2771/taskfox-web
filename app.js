import { GoogleApi, DemoApi, AuthError, ymd, parseYmd } from './api.js';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/tasks',
].join(' ');

const $ = (id) => document.getElementById(id);
const store = {
  get: (k, d = null) => { try { return localStorage.getItem(`taskfox.${k}`) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(`taskfox.${k}`, v); } catch { /* private mode: fine */ } },
  del: (k) => { try { localStorage.removeItem(`taskfox.${k}`); } catch { /* ignore */ } },
};

const state = {
  api: null,
  view: store.get('view', 'agenda'),
  cursor: new Date(),
  calendars: [],
  hidden: new Set(JSON.parse(store.get('hidden', '[]'))),
  events: [],
  lists: [],
  tasks: [],
  editing: null, // the event open in the dialog
};

// ---------- small helpers ----------
function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return node;
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
const sameDay = (a, b) => ymd(a) === ymd(b);
const startOfWeek = (d) => addDays(startOfDay(d), -startOfDay(d).getDay()); // Sunday first
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const shortDay = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

function notify(text, isError = false) {
  const b = $('banner');
  if (!text) { b.hidden = true; return; }
  b.textContent = text;
  b.className = `banner${isError ? ' err' : ''}`;
  b.hidden = false;
}

async function guard(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthError) {
      notify(e.message, true);
      showSignedOut();
    } else {
      notify(e.message || String(e), true);
    }
    return undefined;
  }
}

const calendarOf = (id) => state.calendars.find((c) => c.id === id);
const colorOf = (ev) => (calendarOf(ev.calendarId) || {}).color || '#1a73e8';
const overlapsDay = (ev, day) => {
  const s = startOfDay(day);
  const e = addDays(s, 1);
  return ev.start < e && ev.end > s && !(ev.end.getTime() === ev.start.getTime() && ev.start < s);
};

// ---------- view range ----------
function monthGridStart(cursor) {
  return startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
}

function visibleRange() {
  const c = state.cursor;
  if (state.view === 'week') {
    const s = startOfWeek(c);
    return [s, addDays(s, 7)];
  }
  if (state.view === 'month') {
    const s = monthGridStart(c);
    return [s, addDays(s, 42)];
  }
  const s = startOfDay(c);
  return [s, addDays(s, 30)];
}

function rangeLabel() {
  const [from, to] = visibleRange();
  if (state.view === 'month') return monthFmt.format(state.cursor);
  const last = addDays(to, -1);
  const f = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  return `${f.format(from)} – ${f.format(last)}, ${last.getFullYear()}`;
}

// ---------- loading ----------
async function loadEvents() {
  const [from, to] = visibleRange();
  const shown = state.calendars.filter((c) => !state.hidden.has(c.id));
  const all = await Promise.all(shown.map((c) => state.api.events(c.id, from, to)));
  state.events = all.flat().sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}

async function loadTasks() {
  state.lists = await state.api.taskLists();
  const per = await Promise.all(state.lists.map((l) => state.api.tasks(l.id)));
  state.tasks = per.flat();
}

async function refresh({ calendars = false, tasks = false } = {}) {
  await guard(async () => {
    if (calendars || !state.calendars.length) state.calendars = await state.api.calendars();
    await loadEvents();
    if (tasks || !state.lists.length) await loadTasks();
    notify('');
  });
  renderAll();
}

// ---------- rendering ----------
function renderAll() {
  $('range').textContent = rangeLabel();
  document.querySelectorAll('.views button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
  renderCalendars();
  renderTasks();
  const main = $('main');
  main.replaceChildren();
  if (state.view === 'month') main.append(renderMonth());
  else if (state.view === 'week') main.append(renderWeek());
  else main.append(renderAgenda());
}

function renderCalendars() {
  const ul = $('calendars');
  ul.replaceChildren();
  if (!state.calendars.length) { ul.append(el('li', { class: 'empty' }, 'No calendars yet.')); return; }
  for (const c of state.calendars) {
    const id = `cal-${c.id}`;
    const box = el('input', {
      type: 'checkbox', id, checked: !state.hidden.has(c.id),
      onchange: async (e) => {
        if (e.target.checked) state.hidden.delete(c.id); else state.hidden.add(c.id);
        store.set('hidden', JSON.stringify([...state.hidden]));
        await refresh();
      },
    });
    ul.append(el('li', { class: 'cal-row' },
      box,
      el('span', { class: 'dot', style: `background:${c.color}` }),
      el('label', { for: id }, c.name),
      c.writable ? '' : el('span', { class: 'ro' }, '(read-only)'),
    ));
  }
}

function eventButton(ev, cls = 'ev') {
  return el('button', { class: cls, style: `border-left-color:${colorOf(ev)}`, onclick: () => openEvent(ev) },
    el('span', { class: 'when' }, whenText(ev)),
    el('span', { class: 'what' }, ev.title,
      ev.location ? el('span', { class: 'where' }, ev.location) : ''),
  );
}

function whenText(ev) {
  if (ev.allDay) return 'All day';
  return `${timeFmt.format(ev.start)} – ${timeFmt.format(ev.end)}`;
}

function renderAgenda() {
  const wrap = el('div');
  const [from] = visibleRange();
  let any = false;
  for (let i = 0; i < 30; i++) {
    const day = addDays(from, i);
    const evs = state.events.filter((e) => overlapsDay(e, day));
    if (!evs.length) continue;
    any = true;
    wrap.append(el('div', { class: `day-head${sameDay(day, new Date()) ? ' today' : ''}` },
      sameDay(day, new Date()) ? `Today · ${dayFmt.format(day)}` : dayFmt.format(day)));
    for (const ev of evs) wrap.append(eventButton(ev));
  }
  if (!any) wrap.append(el('p', { class: 'empty' }, 'Nothing scheduled in the next 30 days.'));
  return wrap;
}

function renderMonth() {
  const grid = el('div', { class: 'month' });
  for (const d of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) grid.append(el('div', { class: 'dow' }, d));
  const start = monthGridStart(state.cursor);
  const today = new Date();
  for (let i = 0; i < 42; i++) {
    const day = addDays(start, i);
    const cell = el('div', {
      class: `cell${day.getMonth() !== state.cursor.getMonth() ? ' out' : ''}${sameDay(day, today) ? ' today' : ''}`,
      onclick: (e) => { if (e.target === cell || e.target.classList.contains('n')) newEventOn(day); },
    }, el('div', { class: 'n' }, String(day.getDate())));
    const evs = state.events.filter((e) => overlapsDay(e, day));
    for (const ev of evs.slice(0, 3)) {
      cell.append(el('button', {
        class: 'chip', style: `background:${colorOf(ev)}`, title: ev.title,
        onclick: (e) => { e.stopPropagation(); openEvent(ev); },
      }, (ev.allDay ? '' : `${timeFmt.format(ev.start)} `) + ev.title));
    }
    if (evs.length > 3) {
      cell.append(el('div', { class: 'more' }, `+${evs.length - 3} more`));
    }
    grid.append(cell);
  }
  return grid;
}

function renderWeek() {
  const start = startOfWeek(state.cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = new Date();
  const week = el('div', { class: 'week' });

  const head = el('div', { class: 'week-head' }, el('div'));
  days.forEach((d) => head.append(el('div', { class: sameDay(d, today) ? 'today' : '' }, shortDay.format(d))));
  const top = el("div", { class: "week-top" }, head);

  const allday = el('div', { class: 'week-allday' }, el('div', {}, ''));
  days.forEach((d) => {
    const cell = el('div');
    state.events.filter((e) => e.allDay && overlapsDay(e, d)).forEach((ev) =>
      cell.append(el('button', { class: 'chip', style: `background:${colorOf(ev)}`, onclick: () => openEvent(ev) }, ev.title)));
    allday.append(cell);
  });
  top.append(allday);
  week.append(top);

  const body = el('div', { class: 'week-body' });
  const hours = el('div', { class: 'hours' });
  for (let h = 0; h < 24; h++) {
    hours.append(el('div', {}, h === 0 ? '' : new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2000, 0, 1, h))));
  }
  body.append(hours);

  days.forEach((d) => {
    const col = el('div', {
      class: `col${sameDay(d, today) ? ' today' : ''}`,
      onclick: (e) => {
        if (e.target !== col && !e.target.classList.contains('hline')) return;
        const y = e.offsetY !== undefined && e.target === col ? e.offsetY : 9 * 48;
        const minutes = Math.floor((y / 48) * 4) * 15;
        const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minutes);
        newEventOn(at, true);
      },
    });
    for (let h = 1; h < 24; h++) col.append(el('div', { class: 'hline', style: `top:${h * 48}px` }));
    const timed = state.events.filter((e) => !e.allDay && overlapsDay(e, d));
    layoutLanes(timed).forEach(({ ev, lane, lanes }) => {
      const s = startOfDay(d);
      const top = Math.max(0, (ev.start - s) / 3600000) * 48;
      const bottom = Math.min(24, (ev.end - s) / 3600000) * 48;
      const width = 100 / lanes;
      col.append(el('button', {
        class: 'block',
        style: `top:${top}px;height:${Math.max(18, bottom - top)}px;left:calc(${lane * width}% + 1px);width:calc(${width}% - 2px);background:${colorOf(ev)}`,
        title: `${ev.title}\n${whenText(ev)}`,
        onclick: (e) => { e.stopPropagation(); openEvent(ev); },
      }, el('b', {}, ev.title), timeFmt.format(ev.start)));
    });
    body.append(col);
  });
  week.append(body);
  queueMicrotask(() => { $('main').scrollTop = 7 * 48 - 10; });
  return week;
}

/** Side-by-side lanes for events that overlap in time. */
function layoutLanes(events) {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let cluster = [];
  let clusterEnd = 0;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    cluster.forEach((c) => out.push({ ...c, lanes }));
    cluster = [];
  };
  for (const ev of sorted) {
    if (cluster.length && ev.start.getTime() >= clusterEnd) flush();
    const used = new Set(cluster.filter((c) => c.ev.end > ev.start).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ ev, lane });
    clusterEnd = Math.max(clusterEnd, ev.end.getTime());
  }
  flush();
  return out;
}

function renderTasks() {
  const sel = $('task-list');
  const prev = sel.value;
  sel.replaceChildren(...state.lists.map((l) => el('option', { value: l.id }, l.title)));
  if (prev && state.lists.some((l) => l.id === prev)) sel.value = prev;

  const box = $('tasks');
  box.replaceChildren();
  if (!state.lists.length) { box.append(el('p', { class: 'empty' }, 'No task lists.')); return; }
  const today = ymd(new Date());
  let any = false;
  for (const list of state.lists) {
    const items = state.tasks.filter((t) => t.listId === list.id);
    if (!items.length) continue;
    any = true;
    box.append(el('div', { class: 'list-head' }, list.title));
    items.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
    for (const t of items) {
      box.append(el('div', { class: 'task' },
        el('input', {
          type: 'checkbox', 'aria-label': `Complete ${t.title}`,
          onchange: () => completeTask(t),
        }),
        el('div', { class: 't' },
          t.title,
          t.due ? el('div', { class: `due${t.due < today ? ' late' : ''}` }, `Due ${dayFmt.format(parseYmd(t.due))}`) : ''),
        el('button', { title: 'Rename', 'aria-label': `Rename ${t.title}`, onclick: () => renameTask(t) }, '✎'),
        el('button', { title: 'Delete', 'aria-label': `Delete ${t.title}`, onclick: () => removeTask(t) }, '✕'),
      ));
    }
  }
  if (!any) box.append(el('p', { class: 'empty' }, 'Nothing to do. 🎉'));
}

// ---------- tasks ----------
async function completeTask(t) {
  await guard(() => state.api.updateTask(t.listId, t.id, { done: true }));
  state.tasks = state.tasks.filter((x) => x.id !== t.id);
  renderTasks();
}

async function renameTask(t) {
  const title = prompt('Task', t.title);
  if (title === null || !title.trim()) return;
  await guard(() => state.api.updateTask(t.listId, t.id, { title: title.trim() }));
  t.title = title.trim();
  renderTasks();
}

async function removeTask(t) {
  if (!confirm(`Delete “${t.title}”?`)) return;
  await guard(() => state.api.deleteTask(t.listId, t.id));
  state.tasks = state.tasks.filter((x) => x.id !== t.id);
  renderTasks();
}

$('task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('task-title').value.trim();
  if (!title) return;
  const listId = $('task-list').value || (state.lists[0] && state.lists[0].id);
  if (!listId) return;
  const made = await guard(() => state.api.createTask(listId, { title, due: $('task-due').value || null }));
  if (made) {
    state.tasks.push(made);
    $('task-title').value = '';
    $('task-due').value = '';
    renderTasks();
  }
});

// ---------- event dialog ----------
const dlg = $('event-dialog');
const f = {
  title: $('ev-title'), allDay: $('ev-allday'),
  sd: $('ev-start-date'), st: $('ev-start-time'), ed: $('ev-end-date'), et: $('ev-end-time'),
  cal: $('ev-calendar'), loc: $('ev-location'), notes: $('ev-notes'),
};
const timeStr = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function syncAllDay() {
  document.querySelectorAll('#event-form .two').forEach((row) => row.classList.toggle('hide-time', f.allDay.checked));
  f.st.disabled = f.et.disabled = f.allDay.checked;
}

function fillDialog(ev, isNew) {
  state.editing = isNew ? null : ev;
  $('event-heading').textContent = isNew ? 'New event' : 'Edit event';
  f.title.value = ev.title || '';
  f.allDay.checked = ev.allDay;
  f.sd.value = ymd(ev.start);
  f.st.value = ev.allDay ? '09:00' : timeStr(ev.start);
  // An all-day event's stored end is the day after; people think of it as the last day.
  const shownEnd = ev.allDay ? addDays(ev.end, -1) : ev.end;
  f.ed.value = ymd(shownEnd < ev.start ? ev.start : shownEnd);
  f.et.value = ev.allDay ? '10:00' : timeStr(ev.end);
  f.loc.value = ev.location || '';
  f.notes.value = ev.notes || '';

  const writable = state.calendars.filter((c) => c.writable);
  f.cal.replaceChildren(...writable.map((c) => el('option', { value: c.id }, c.name)));
  const own = calendarOf(ev.calendarId);
  if (!isNew && own && !own.writable) f.cal.append(el('option', { value: own.id }, `${own.name} (read-only)`));
  f.cal.value = ev.calendarId || (writable.find((c) => c.primary) || writable[0] || {}).id || '';
  f.cal.disabled = !isNew; // moving an event between calendars isn't supported here

  const readOnly = !isNew && own && !own.writable;
  for (const input of [f.title, f.allDay, f.sd, f.st, f.ed, f.et, f.loc, f.notes]) input.disabled = readOnly;
  $('ev-save').hidden = readOnly;
  $('ev-readonly').hidden = !readOnly;
  $('ev-delete').hidden = isNew || readOnly;
  $('ev-error').hidden = true;
  const open = $('ev-open');
  open.hidden = !ev.link;
  if (ev.link) open.href = ev.link;
  if (!readOnly) syncAllDay();
  dlg.showModal();
  f.title.focus();
}

function openEvent(ev) { fillDialog(ev, false); }

function newEventOn(day, hasTime = false) {
  const start = new Date(day);
  if (!hasTime) start.setHours(9, 0, 0, 0);
  const writable = state.calendars.filter((c) => c.writable);
  if (!writable.length) { notify('There is no calendar here you can add events to.', true); return; }
  fillDialog({
    title: '', start, end: new Date(start.getTime() + 3600000), allDay: false, notes: '', location: '',
    calendarId: (writable.find((c) => c.primary) || writable[0]).id,
  }, true);
}

f.allDay.addEventListener('change', syncAllDay);
$('ev-cancel').addEventListener('click', () => dlg.close());
$('new-event').addEventListener('click', () => newEventOn(state.cursor));

$('event-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const allDay = f.allDay.checked;
  const at = (date, time) => {
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = (time || '00:00').split(':').map(Number);
    return new Date(y, m - 1, d, allDay ? 0 : hh, allDay ? 0 : mm);
  };
  const start = at(f.sd.value, f.st.value);
  let end = at(f.ed.value, f.et.value);
  if (allDay) end = addDays(end, 1);
  const err = $('ev-error');
  if (!f.title.value.trim()) { err.textContent = 'Give the event a title.'; err.hidden = false; return; }
  if (end <= start) { err.textContent = 'The event has to end after it starts.'; err.hidden = false; return; }

  const ev = { title: f.title.value.trim(), notes: f.notes.value, location: f.loc.value.trim(), start, end, allDay };
  $('ev-save').disabled = true;
  const done = await guard(async () => {
    if (state.editing) await state.api.updateEvent(state.editing.calendarId, state.editing.id, ev);
    else await state.api.createEvent(f.cal.value, ev);
    return true;
  });
  $('ev-save').disabled = false;
  if (done) {
    dlg.close();
    await refresh();
  } else {
    err.textContent = 'That couldn’t be saved. See the message at the top of the page.';
    err.hidden = false;
  }
});

$('ev-delete').addEventListener('click', async () => {
  const ev = state.editing;
  if (!ev) return;
  const extra = ev.recurring ? '\n\nThis is one occurrence of a repeating event; only this one is removed.' : '';
  if (!confirm(`Delete “${ev.title}” from Google Calendar?${extra}`)) return;
  const done = await guard(async () => { await state.api.deleteEvent(ev.calendarId, ev.id); return true; });
  if (done) {
    dlg.close();
    await refresh();
  }
});

// ---------- navigation ----------
function step(dir) {
  const c = state.cursor;
  if (state.view === 'month') state.cursor = new Date(c.getFullYear(), c.getMonth() + dir, 1);
  else state.cursor = addDays(c, dir * 7);
  return refresh();
}

$('prev').addEventListener('click', () => step(-1));
$('next').addEventListener('click', () => step(1));
$('today').addEventListener('click', () => { state.cursor = new Date(); return refresh(); });
document.querySelectorAll('.views button').forEach((b) => b.addEventListener('click', () => {
  state.view = b.dataset.view;
  store.set('view', state.view);
  return refresh();
}));

// ---------- Google sign-in ----------
let tokenClient = null;
let token = null;
let tokenExpires = 0;
let pending = null;

const clientId = () => (window.TASKFOX_CLIENT_ID || store.get('clientId', '') || '').trim();

function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.accounts) { resolve(); return; }
    const s = el('script', { src: 'https://accounts.google.com/gsi/client', async: true, defer: true });
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Couldn’t load Google sign-in. Check your connection.'));
    document.head.append(s);
  });
}

async function requestToken(prompt) {
  const id = clientId();
  if (!id) throw new AuthError('Add your Google client ID first (see the setup note).');
  await loadGis();
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: SCOPES,
      callback: (resp) => {
        const p = pending;
        pending = null;
        if (!p) return;
        if (resp.error) p.reject(new AuthError(`Google sign-in failed: ${resp.error_description || resp.error}`));
        else {
          token = resp.access_token;
          tokenExpires = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
          p.resolve(token);
        }
      },
      error_callback: (err) => {
        const p = pending;
        pending = null;
        if (p) p.reject(new AuthError(err && err.type === 'popup_closed' ? 'Sign-in was cancelled.' : 'Google sign-in failed.'));
      },
    });
  }
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    tokenClient.requestAccessToken({ prompt });
  });
}

async function getToken() {
  if (token && Date.now() < tokenExpires - 60_000) return token;
  return requestToken(token ? '' : 'consent');
}

async function signIn() {
  state.api = new GoogleApi(getToken);
  $('welcome').hidden = true;
  const ok = await guard(async () => { await getToken(); return true; });
  if (!ok) { state.api = null; $('welcome').hidden = false; return; }
  store.set('signedIn', '1');
  showSignedIn('Google');
  await refresh({ calendars: true, tasks: true });
}

function signOut() {
  if (token && window.google && window.google.accounts) window.google.accounts.oauth2.revoke(token, () => {});
  token = null;
  tokenClient = null;
  store.del('signedIn');
  state.api = null;
  state.calendars = []; state.events = []; state.lists = []; state.tasks = [];
  showSignedOut();
}

function showSignedIn(mode) {
  $('signin').hidden = true;
  $('signout').hidden = mode === 'Demo';
  const badge = $('mode-badge');
  badge.hidden = mode !== 'Demo';
  badge.textContent = 'Sample data';
  $('welcome').hidden = true;
}

function showSignedOut() {
  $('signin').hidden = false;
  $('signout').hidden = true;
  $('mode-badge').hidden = true;
  $('welcome').hidden = false;
  $('main').replaceChildren();
  $('calendars').replaceChildren();
  $('tasks').replaceChildren();
}

async function startDemo() {
  state.api = new DemoApi();
  showSignedIn('Demo');
  await refresh({ calendars: true, tasks: true });
}

$('signin').addEventListener('click', signIn);
$('welcome-signin').addEventListener('click', signIn);
$('welcome-demo').addEventListener('click', startDemo);
$('signout').addEventListener('click', signOut);
$('save-client-id').addEventListener('click', () => {
  store.set('clientId', $('client-id').value.trim());
  tokenClient = null;
  notify('Saved. Now sign in.');
});

// ---------- start ----------
$('client-id').value = store.get('clientId', '');
renderAll();
showSignedOut();
if (new URLSearchParams(location.search).has('demo')) startDemo();
