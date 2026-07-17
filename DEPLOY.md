# Deploying Metro Buddy to Render (free)

Your repo: https://github.com/suneet07/metro-buddy

## 1. Commit and push everything (incl. the new UI + video)
From the project folder:

```bash
git add -A
git commit -m "Playful UI + polish, archive coords, Render config"
git push origin main
```
(If your branch is `master`, use `git push origin master`.)

> This matters: the cave video and restyled files are new/untracked — Render only
> deploys what's in the repo.

## 2. Create the service on Render
1. Go to https://render.com and sign up / log in (use "Sign in with GitHub").
2. Click **New +** → **Blueprint**.
3. Pick the **metro-buddy** repository. Render reads `render.yaml` automatically
   and fills in everything (build `npm install && npm run build`, start `npm start`,
   free plan, health check `/health`).
4. Click **Apply** / **Create**. First build takes ~2–4 minutes.

*(No `render.yaml`? Use **New +** → **Web Service** instead, pick the repo, and set:
Runtime **Node**, Build `npm install && npm run build`, Start `npm start`, Plan **Free**.)*

## 3. Open and share
- Render gives you a URL like `https://metro-buddy.onrender.com`.
- It's HTTPS, so GPS works. Share that link + your group code with your crew.

## 4. (Optional) Keep it awake
Free instances sleep after ~15 min idle and take ~1 min to wake.
- Easiest fix: a free uptime pinger (e.g. cron-job.org / UptimeRobot) hitting
  `https://<your-app>.onrender.com/health` every 10 minutes.
- Or upgrade to the always-on Starter instance (~$7/mo).

## Updating later
Just push to GitHub — `autoDeploy` rebuilds automatically:
```bash
git add -A && git commit -m "tweak" && git push
```

## Notes
- Group locations are kept in memory, so a restart/sleep just means everyone
  re-joins with the same code. Nothing to back up.
- `cave.mp4` is ~15 MB and ships in the repo. If deploys feel heavy, ask me to
  compress it or move it to a CDN.
