# 🚇 Metro Buddy

A live-location web app for a group of friends who commute on the Delhi Metro. Everyone
in a group can see **which station each friend is at right now**, so you can decide to
travel together. It also plans the **shortest route** between any two stations and shows
**how long it'll take to arrive**.

Built for your morning crew — open the same group code, and you all show up on each
other's screens.

## What it does

- **Live friend map (list)** — each friend's current station, colour-coded by line, updating in real time.
- **Auto station detection** — uses your phone's GPS to figure out the nearest metro station (with a manual fallback if GPS is blocked or you're underground).
- **"Travel together" cues** — highlights friends at *your* station ("together now") or heading to the *same destination*.
- **Arrival times** — how many minutes a friend is from you, and their ETA to a destination.
- **Route planner** — shortest-time route between any two stations, with line changes, number of stops, and total minutes.
- **Official map** — the July 2026 DMRC/NMRC/NCRTC map is bundled and linked in the app.

## How it's built

- **Backend:** Node + Express + Socket.IO. Each group code is a real-time room; friends broadcast their station and the server syncs everyone (`server.js`).
- **Network graph:** `build-network.js` turns `data/dmrc.csv` (285 stations, all lines) into a routable graph — ordering each line by distance and linking shared station names as interchanges. Output: `public/network.json`.
- **Routing/ETA:** `public/router.js` — Dijkstra over the graph with per-hop ride times, dwell, and interchange penalties. Runs in the browser.
- **Frontend:** plain HTML/CSS/JS, mobile-first (`public/`).

## Run it

```bash
npm install        # one time
npm run build      # regenerates public/network.json from the CSV (optional; already built)
npm start          # serves on http://localhost:3000
```

Open **http://localhost:3000** on your phone/computer, enter a name and a shared group code.

### So your friends can actually join (over the internet)

The app needs to be reachable by everyone. Options:

- **Quick test:** run `npm start` and expose it with a tunnel, e.g. `npx localtunnel --port 3000` or `ngrok http 3000`, then share the URL.
- **Proper hosting:** deploy to any Node host (Render, Railway, Fly.io, a small VPS). It's a single `node server.js` process. The host provides `PORT` automatically.
- **HTTPS note:** browsers only allow GPS on `https://` (or `localhost`). Any real host above gives you HTTPS; a bare IP over http will fall back to manual station picking.

## Notes / limitations

- Station data is a comprehensive ~2019 snapshot (all major lines + interchanges). A few July-2026 changes aren't in it yet — e.g. *Huda City Centre* is now *Millennium City Centre*, and the newest Phase-IV extensions. To refine, edit `data/dmrc.csv` and re-run `npm run build`.
- ETAs are modelled (≈33 km/h effective speed, ~3.5 min per interchange), not live train timings.
- Locations are kept in memory only — nothing is stored to a database or logged.

## File map

```
server.js            real-time backend
build-network.js     CSV -> graph
data/dmrc.csv        station dataset (edit here to update the network)
public/
  index.html         UI
  style.css          styles
  app.js             client logic (GPS, sync, rendering)
  router.js          routing + geo (shared)
  network.json       generated graph
```
