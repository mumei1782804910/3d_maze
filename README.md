# 🌍 Edmund's Little Planet Maze

A relaxing, truly 3D get-out-of-the-maze game for kids. A multi-floor maze is
hidden inside a tiny stylized planet — as you zoom in, the planet's surface
gently fades away to reveal the maze inside. Edmund can walk in four
directions and ride glowing lifts up and down between floors. Help him find
his way out. No timer, no score, just thinking.

**Play it:** open `index.html` on any static host (works great on a phone).

## Controls

- 🖐 **Drag** — spin the planet / rotate the view
- 🤏 **Pinch** (or mouse wheel) — zoom in and out
- **▲ ▼ ◀ ▶ d-pad** (or arrow keys / WASD) — walk Edmund, relative to the camera
- **⏫ ⏬** (or E/Q, PageUp/PageDown) — ride a glowing lift up or down a floor
- 🔄 — new maze, 🔊 — music on/off

## Features

- Truly 3D procedurally generated maze (recursive backtracker over a 3D grid —
  always solvable): 2–3 stacked floors connected by lifts, three sizes,
  new maze every game
- The floor Edmund is on renders solid, floors above turn ghost-transparent so
  you can always see him, floors below stay dimly visible; each floor has its
  own pastel color and a floor indicator chip
- Hollow planet with a view-dependent fading shell (custom shader), trees,
  houses, clouds, moon and stars
- Generative relaxing music via the Web Audio API — no audio files, no licensing
- Pure static files: no build step, no server code, no dependencies to install
  (Three.js loads from a CDN)

## Deploy to GitHub Pages

1. Create a new GitHub repository and push these files:
   ```bash
   git init
   git add index.html style.css game.js README.md
   git commit -m "Edmund's Little Planet Maze"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
2. On GitHub: **Settings → Pages → Source: Deploy from a branch**,
   select `main` / `(root)`, and save.
3. After a minute, the game is live at
   `https://<your-username>.github.io/<repo-name>/` — open that URL on your
   phone's browser.

## Run locally

Just double-click `index.html` — it opens straight from the file system
(an internet connection is still needed the first time, to fetch Three.js
from the CDN).

A local server also works, e.g.:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```
