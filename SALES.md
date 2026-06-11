# BePaid — Commission Autopilot

A single-file, mobile-first web app (`sales.html`) that drives commission sales on
autopilot. Same zero-backend design as BeGood: open it on your phone, add it to your
home screen, everything lives in localStorage.

## How it drives sales automatically

The thing that kills commission income is follow-ups that never happen. BePaid
removes that failure mode:

1. **Add a lead** (name, company, email, deal value, commission %).
2. **Autopilot schedules every follow-up** from per-stage cadence rules
   (New Lead every 2 days, Contacted every 3, Meeting next day, Proposal every
   2 — all editable in Settings).
3. **Each morning you get a push notification** (via [ntfy](https://ntfy.sh), same
   setup as BeGood) with how many follow-ups are due and how much commission is
   on the line. Next-day digests are scheduled server-side with ntfy delayed
   delivery, so they arrive even if the app stays closed.
4. **One tap writes the email.** "Draft email" opens Gmail compose pre-filled from
   a stage-specific template with merge fields (`{first}`, `{company}`, `{value}`,
   `{me}`), logs the touch, and schedules the next follow-up automatically.
5. **Move deals through the pipeline** — Lead → Contacted → Meeting → Proposal →
   Won/Lost. Marking a deal Won books the commission.

## Tabs

- **Autopilot** — today's due queue with one-tap email / done / snooze, plus what's
  coming up.
- **Pipeline** — all deals grouped by stage with value totals; tap a deal to edit,
  change stage, or view its activity log.
- **Earnings** — commission won this month vs. your goal, weighted pipeline
  forecast (stage-probability adjusted), win rate, follow-up activity.
- **Settings** — your name, default commission %, monthly goal, cadences, email
  templates, ntfy notifications, JSON export/import.

## Setup

1. Open `sales.html` (GitHub Pages: `https://<user>.github.io/BeGood/sales.html`).
2. Settings → set your name, default commission %, and monthly goal.
3. For background alerts: install the ntfy app, subscribe to a private topic name,
   enter the same topic in Settings, and toggle notifications on.

No accounts, no server, no data leaves your device except notification text sent
to your ntfy topic.
