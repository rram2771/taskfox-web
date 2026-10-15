# TaskFox Web

Your **Google Calendar** and **Google Tasks** on your computer. Anything you change here shows up on your
phone, and the other way round, because both talk to the same Google account.

- **Agenda, Week and Month views** of every calendar in your account (turn calendars on and off at the left)
- **Create, edit and delete events**: title, all-day, start/end, location, notes
- **Tasks** from every Google Tasks list: add, rename, set a due date, tick off, delete
- Read-only calendars (holidays, birthdays, ones shared with you) are shown but can't be changed
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
2. **Create credentials → OAuth client ID → Web application**.
3. **Authorized JavaScript origins**: add
   - `http://localhost:8080` (to try it locally), and
   - `https://YOUR-GITHUB-USERNAME.github.io` (once it's published; no path, no trailing slash).

   You don't need a redirect URI.
4. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`). It isn't a secret: it only works from the
   addresses you listed.
5. Paste it into [`config.js`](config.js), or into the box under *Setup* on the welcome screen.
6. Under **Google Auth Platform → Data access**, make sure these scopes are listed:
   `calendar.events`, `calendar.calendarlist.readonly`, `tasks`. The Calendar API and the Tasks API must be
   enabled for the project (they already are for the phone app).

While the Google project is in **Testing** status, only the test users you added can sign in, and the sign-in
lasts an hour per click. That's a Google rule, not something this site controls.

## Put it on GitHub Pages

```bash
cd TaskFox-web
git remote add origin https://github.com/YOUR-GITHUB-USERNAME/taskfox-web.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**.
Your site will be at `https://YOUR-GITHUB-USERNAME.github.io/taskfox-web/`. Free GitHub Pages needs a
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
