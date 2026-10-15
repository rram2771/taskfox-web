# TaskFox Web

Your **Google Calendar** and **Google Tasks** on your computer. Anything you change here shows up on your
phone, and the other way round, because both talk to the same Google account.

- **Agenda, Week and Month views** of every calendar in your account (turn calendars on and off at the left). The Agenda can look ahead 30 days up to 2 years; pick it next to the view tabs
- **Projects**: events made in the TaskFox phone app show the project they belong to, and a Projects picker at the left shows just one project's events
- **Create, edit and delete events**: title, all-day, start/end, location, notes
- **Tasks** from every Google Tasks list: add, rename, set a due date, tick off, delete
- **Same look as the phone app** (cream, peach, teal, Poppins). Icons you give a task on the phone show before its title, and “Show completed” hides the green ticked events
- **Tick events off in the Agenda.** The tick box colours the event **Basil** (green) in Google Calendar, so it
  shows as done there and on your phone; un-ticking puts its old colour back
- Read-only calendars (holidays, birthdays, ones shared with you) are shown but can't be changed
- **Stays signed in**: reopening the site signs you back in without asking, as long as you are still signed
  in to Google in that browser (see below)
- Light and dark, keyboard friendly
- **No server and no tracking.** It's three static files. Your events and tasks travel only between your
  browser and Google.

> What it is *not*: the whole phone app. Projects, priorities, notes syntax (`NA`, `CAL`, `#tags`), points and
> reminders that nag you live on the phone. This is the calendar and the task list, on a big screen.

## Try it right now (no setup)

Open the site and press **Try it with sample data**, or add `?demo` to the address. Nothing is saved.

## Run it on your computer

Browsers won't run the site straight from a folder, so serve it:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1
```

then open <http://localhost:8080/>.

## Sign in with your own Google account (one-time, about two minutes)

The site needs a Google OAuth **Web** client ID for the address it is served from.

1. Open <https://console.cloud.google.com/apis/credentials> (use the same project as the phone app,
   `taskfox-509616`).
2. **Create credentials â OAuth client ID â Web application**.
3. **Authorized JavaScript origins**: add
   - `http://localhost:8080` (to try it locally), and
   - `https://rram2771.github.io` (once it's published; no path, no trailing slash).

   You don't need a redirect URI.
4. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`). It isn't a secret: it only works from the
   addresses you listed.
5. Paste it into [`config.js`](config.js), or into the box under *Setup* on the welcome screen.
6. Under **Google Auth Platform â Data access**, make sure these scopes are listed:
   `calendar.events`, `calendar.calendarlist.readonly`, `tasks`. The Calendar API and the Tasks API must be
   enabled for the project (they already are for the phone app).

While the Google project is in **Testing** status, only the test users you added can sign in, and Google
re-asks for your agreement about once a week. That's a Google rule, not something this site controls.

**Why it can't remember you forever:** a site with no server only gets one-hour passes from Google. The page
renews the pass quietly in the background and again each time you open it, using your Google session in the
browser. To keep that smooth: stay signed in to Google in the browser, allow pop-ups for the site, and don't
clear site data on exit.

## Put it on GitHub Pages

```bash
cd TaskFox-web
git remote add origin https://github.com/rram2771/taskfox-web.git
git push -u origin main
```

Then on GitHub: **Settings â Pages â Build and deployment â Deploy from a branch â `main` / `(root)` â Save**.
Your site will be at `https://rram2771.github.io/taskfox-web/`. Free GitHub Pages needs a
**public** repository; the repository contains no personal data (only the public client ID, if you add it).

## Notes and limits

- **Repeating events:** editing or deleting one changes only that occurrence.
- **Moving an event to a different calendar** isn't supported here (use Google Calendar for that).
- **Google Tasks keeps the due *date* only**, never a time of day.
- A change made here reaches the phone the next time it checks (every 15 minutes, or at once when you open
  the app and tap *Sync now* in Settings).

## Files

| File | What it is |
| --- | --- |
| `index.html`, `styles.css` | the page |
| `app.js` | the screens and sign-in |
| `api.js` | talks to Google Calendar and Google Tasks (and the sample-data stand-in) |
| `config.js` | where your client ID goes |
| `serve.ps1` | tiny local web server for Windows |
