// Data layer. Two implementations of the same interface:
//   GoogleApi - your real Google Calendar and Google Tasks (needs sign-in)
//   DemoApi   - made-up data in memory, so every screen can be tried without signing in
//
// Events are plain objects: { id, calendarId, title, notes, location, start: Date, end: Date, allDay, link }
// An all-day event's `end` is the day AFTER it ends (Google's convention), at local midnight.

const CAL = 'https://www.googleapis.com/calendar/v3';
const TASKS = 'https://tasks.googleapis.com/tasks/v1';

export class AuthError extends Error {}

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** The calendar API wants an offset on every dateTime: "2026-10-14T09:30:00-04:00". */
function offsetIso(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`
  );
}

/** Body for create/patch. Only the fields named here change on an existing event. */
export function eventBody(ev) {
  const body = { summary: ev.title, description: ev.notes || '', location: ev.location || '' };
  if (ev.allDay) {
    body.start = { date: ymd(ev.start) };
    body.end = { date: ymd(ev.end) };
  } else {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    body.start = { dateTime: offsetIso(ev.start), timeZone: zone };
    body.end = { dateTime: offsetIso(ev.end), timeZone: zone };
  }
  return body;
}

/** Google Calendar's event colour ids. "Basil" (10) is the green TaskFox Web uses to mean "done". */
export const BASIL = '10';
export const EVENT_COLORS = {
  1: '#7986cb', 2: '#33b679', 3: '#8e24aa', 4: '#e67c73', 5: '#f6bf26', 6: '#f4511e',
  7: '#039be5', 8: '#616161', 9: '#3f51b5', 10: '#0b8043', 11: '#d50000',
};
const PREV_COLOR_KEY = 'taskfoxPrevColor';

/**
 * The patch that ticks an event off (colours it Basil) or un-ticks it. Ticking remembers the colour the
 * event had so un-ticking puts it back; null in a patch clears the field on Google's side.
 */
export function doneBody(ev, done) {
  if (done) {
    const had = ev.colorId && ev.colorId !== BASIL ? ev.colorId : (ev.prevColorId || '');
    return { colorId: BASIL, extendedProperties: { private: { [PREV_COLOR_KEY]: had } } };
  }
  return {
    colorId: ev.prevColorId || null,
    extendedProperties: { private: { [PREV_COLOR_KEY]: null } },
  };
}

export function readEvent(json, calendarId) {
  if (json.status === 'cancelled' || !json.start) return null;
  const allDay = !json.start.dateTime;
  const start = allDay ? parseYmd(json.start.date) : new Date(json.start.dateTime);
  let end = json.end ? (allDay ? parseYmd(json.end.date) : new Date(json.end.dateTime)) : start;
  if (allDay && end <= start) end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return {
    id: json.id,
    calendarId,
    title: json.summary || '(No title)',
    notes: json.description || '',
    location: json.location || '',
    start,
    end,
    allDay,
    link: json.htmlLink || null,
    recurring: Boolean(json.recurringEventId),
    colorId: json.colorId || null,
    prevColorId: (json.extendedProperties && json.extendedProperties.private
      && json.extendedProperties.private[PREV_COLOR_KEY]) || null,
  };
}

export class GoogleApi {
  /** @param getToken async () => access token string; may prompt the user to sign in again */
  constructor(getToken) {
    this.getToken = getToken;
    this.mode = 'google';
  }

  async req(url, { method = 'GET', body } = {}) {
    const token = await this.getToken();
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) throw new AuthError('Your Google sign-in expired. Sign in again.');
    if (res.status === 204) return null;
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const reason = json && json.error && json.error.message ? json.error.message : `HTTP ${res.status}`;
      throw new Error(reason);
    }
    return json;
  }

  async calendars() {
    const out = [];
    let pageToken = '';
    do {
      const q = new URLSearchParams({ maxResults: '250', minAccessRole: 'reader' });
      if (pageToken) q.set('pageToken', pageToken);
      const json = await this.req(`${CAL}/users/me/calendarList?${q}`);
      for (const c of json.items || []) {
        if (c.deleted || c.hidden || c.selected === false) continue;
        out.push({
          id: c.id,
          name: c.summaryOverride || c.summary || c.id,
          color: c.backgroundColor || '#1a73e8',
          writable: c.accessRole === 'owner' || c.accessRole === 'writer',
          primary: Boolean(c.primary),
        });
      }
      pageToken = json.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  async events(calendarId, from, to) {
    const out = [];
    let pageToken = '';
    let pages = 0;
    do {
      const q = new URLSearchParams({
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
      });
      if (pageToken) q.set('pageToken', pageToken);
      const json = await this.req(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
      for (const e of json.items || []) {
        const ev = readEvent(e, calendarId);
        if (ev) out.push(ev);
      }
      pageToken = json.nextPageToken || '';
    } while (pageToken && ++pages < 8);
    return out;
  }

  async createEvent(calendarId, ev) {
    const json = await this.req(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      body: eventBody(ev),
    });
    return readEvent(json, calendarId);
  }

  async updateEvent(calendarId, id, ev) {
    const json = await this.req(
      `${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: eventBody(ev) },
    );
    return readEvent(json, calendarId);
  }

  /** Tick (colour Basil) or un-tick an event. Only the colour changes; title, time and guests are untouched. */
  async setEventDone(calendarId, ev, done) {
    const json = await this.req(
      `${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(ev.id)}`,
      { method: 'PATCH', body: doneBody(ev, done) },
    );
    return readEvent(json, calendarId);
  }

  async deleteEvent(calendarId, id) {
    await this.req(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async taskLists() {
    const json = await this.req(`${TASKS}/users/@me/lists?maxResults=100`);
    return (json.items || []).map((l) => ({ id: l.id, title: l.title }));
  }

  async tasks(listId) {
    const out = [];
    let pageToken = '';
    do {
      const q = new URLSearchParams({ showCompleted: 'false', showHidden: 'false', maxResults: '100' });
      if (pageToken) q.set('pageToken', pageToken);
      const json = await this.req(`${TASKS}/lists/${encodeURIComponent(listId)}/tasks?${q}`);
      for (const t of json.items || []) {
        if (t.deleted) continue;
        out.push({
          id: t.id,
          listId,
          title: t.title || '',
          notes: t.notes || '',
          due: t.due ? t.due.slice(0, 10) : null,
          done: t.status === 'completed',
        });
      }
      pageToken = json.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  async createTask(listId, { title, due }) {
    const body = { title };
    if (due) body.due = `${due}T00:00:00.000Z`;
    const t = await this.req(`${TASKS}/lists/${encodeURIComponent(listId)}/tasks`, { method: 'POST', body });
    return { id: t.id, listId, title: t.title || '', notes: '', due: due || null, done: false };
  }

  async updateTask(listId, id, patch) {
    const body = {};
    if ('title' in patch) body.title = patch.title;
    if ('notes' in patch) body.notes = patch.notes;
    if ('due' in patch) body.due = patch.due ? `${patch.due}T00:00:00.000Z` : null;
    if ('done' in patch) {
      body.status = patch.done ? 'completed' : 'needsAction';
      if (!patch.done) body.completed = null;
    }
    await this.req(`${TASKS}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body,
    });
  }

  async deleteTask(listId, id) {
    await this.req(`${TASKS}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }
}

/** Made-up data, relative to today, kept in memory. */
export class DemoApi {
  constructor() {
    this.mode = 'demo';
    this.nextId = 100;
    const day = (offset, h = 0, m = 0) => {
      const d = new Date();
      d.setHours(h, m, 0, 0);
      d.setDate(d.getDate() + offset);
      return d;
    };
    const ev = (id, calendarId, title, start, end, extra = {}) => ({
      id, calendarId, title, notes: '', location: '', start, end, allDay: false, link: null, recurring: false, ...extra,
    });
    this._calendars = [
      { id: 'me', name: 'Me', color: '#1a73e8', writable: true, primary: true },
      { id: 'work', name: 'Work', color: '#d93025', writable: true, primary: false },
      { id: 'holidays', name: 'Holidays', color: '#188038', writable: false, primary: false },
    ];
    this._events = [
      ev('1', 'me', 'Dentist appointment', day(0, 15, 0), day(0, 16, 0), { location: 'Main St Dental', notes: 'Bring insurance card' }),
      ev('2', 'work', 'Team standup', day(1, 9, 30), day(1, 10, 0)),
      ev('3', 'work', 'Quarterly planning', day(2, 13, 0), day(2, 15, 30), { notes: 'Slides due Monday' }),
      ev('4', 'me', 'Call the landlord', day(3, 11, 0), day(3, 11, 30)),
      ev('5', 'holidays', 'Bank holiday', day(4), day(5), { allDay: true }),
      ev('6', 'me', 'Gym', day(0, 7, 0), day(0, 8, 0)),
      ev('7', 'work', 'Project review', day(5, 10, 0), day(5, 11, 0)),
    ];
    this._lists = [
      { id: 'l1', title: 'My Tasks' },
      { id: 'l2', title: 'Shopping' },
    ];
    this._tasks = [
      { id: 't1', listId: 'l1', title: 'Buy stamps', notes: '', due: ymd(day(1)), done: false },
      { id: 't2', listId: 'l1', title: 'Renew car registration', notes: '', due: ymd(day(6)), done: false },
      { id: 't3', listId: 'l2', title: 'Milk', notes: '', due: null, done: false },
      { id: 't4', listId: 'l2', title: 'Batteries', notes: '', due: null, done: false },
    ];
  }

  async calendars() { return this._calendars.map((c) => ({ ...c })); }

  async events(calendarId, from, to) {
    return this._events.filter((e) => e.calendarId === calendarId && e.end > from && e.start < to).map((e) => ({ ...e }));
  }

  async createEvent(calendarId, e) {
    const made = { ...e, id: String(this.nextId++), calendarId, link: null, recurring: false };
    this._events.push(made);
    return { ...made };
  }

  async updateEvent(calendarId, id, e) {
    const i = this._events.findIndex((x) => x.id === id);
    if (i < 0) throw new Error('That event no longer exists');
    this._events[i] = { ...this._events[i], ...e, id, calendarId };
    return { ...this._events[i] };
  }

  async setEventDone(calendarId, ev, done) {
    const e = this._events.find((x) => x.id === ev.id);
    if (!e) throw new Error('That event no longer exists');
    const patch = doneBody(ev, done);
    e.colorId = patch.colorId;
    e.prevColorId = patch.extendedProperties.private[PREV_COLOR_KEY] || null;
    return { ...e };
  }

  async deleteEvent(calendarId, id) { this._events = this._events.filter((x) => x.id !== id); }

  async taskLists() { return this._lists.map((l) => ({ ...l })); }
  async tasks(listId) { return this._tasks.filter((t) => t.listId === listId && !t.done).map((t) => ({ ...t })); }

  async createTask(listId, { title, due }) {
    const t = { id: `t${this.nextId++}`, listId, title, notes: '', due: due || null, done: false };
    this._tasks.push(t);
    return { ...t };
  }

  async updateTask(listId, id, patch) {
    const t = this._tasks.find((x) => x.id === id);
    if (t) Object.assign(t, patch);
  }

  async deleteTask(listId, id) { this._tasks = this._tasks.filter((x) => x.id !== id); }
}
