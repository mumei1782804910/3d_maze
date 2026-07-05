/* global THREE */
// THREE is provided by the classic three.min.js script tag in index.html.

// ============================================================
// Edmund's Little Planet Maze
// A relaxing, truly 3D get-out-of-the-maze game inside a tiny
// planet: multiple stacked floors, glowing lifts between them.
// ============================================================

// ---------- constants ----------
const PLANET_R = 30;          // planet radius
const MAZE_SPAN = 34;         // total maze width (world units)
const SLAB = 0.35;            // thickness of the floor slabs between levels
const LEVEL_HUES = [0.045, 0.75, 0.48, 0.13];  // wall hue per floor

// ---------- global state ----------
let renderer, scene, camera, clock;
let shellMat;                 // planet shell shader material
let decorations = [];         // { obj, mats } — fade with the shell
let cloudGroup, moonPivot, starField;
let mazeGroup = null;         // everything rebuilt per maze
let levelMats = [];           // per level: materials to ghost/unghost
let lifts = [];               // { beamMat } for pulsing
let edmund = null, shadowBlob = null, exitStar = null, exitStarBaseY = 0;
let confettis = [];

let maze = null;              // { N, L, cell, wallH, levelH, y0, wx, wz, wy, start, exit }
let player = null;            // { x, y, z, moving, mode, from, to, t, rotY, targetRotY, walkPhase, escaped }
let mazeN = 7, mazeL = 3;

let state = 'start';          // start | intro | play | won
let heldDir = null;           // 'up' | 'down' | 'left' | 'right'
let introT = 0;

const cam = { az: 0.7, polar: 0.78, dist: 110, target: new THREE.Vector3(0, 0, 0) };

// ============================================================
// Scene setup
// ============================================================
function fatal(msg) {
  let d = document.getElementById('errBanner');
  if (!d) {
    d = document.createElement('div');
    d.id = 'errBanner';
    d.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;background:#c0392b;color:#fff;' +
      'padding:10px 14px;border-radius:10px;font:14px/1.4 sans-serif;z-index:99;white-space:pre-wrap';
    document.body.appendChild(d);
  }
  d.textContent = '⚠️ ' + msg;
}

function init() {
  const canvas = document.getElementById('c');
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (err) {
    console.error(err);
    fatal('This browser could not start 3D graphics (WebGL). Please try a newer browser.');
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x0b1030);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 1200);
  clock = new THREE.Clock();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a90b8, 1.1));
  const dir = new THREE.DirectionalLight(0xfff2dd, 1.6);
  dir.position.set(45, 65, 30);
  scene.add(dir);

  buildStars();
  buildPlanet();
  buildMoon();
  buildMaze(mazeN, mazeL);

  window.addEventListener('resize', onResize);
  setupCameraControls(canvas);
  setupUI();

  renderer.setAnimationLoop(animate);

  // dev hook for testing (harmless in production)
  window.__dbg = {
    cam,
    skipIntro() { state = 'play'; introT = 1; cam.dist = 52; },
    getState() {
      return {
        state, dist: cam.dist, fade: shellMat.uniforms.uFade.value,
        player: player && { x: player.x, y: player.y, z: player.z, moving: player.moving },
        opens: player && {
          n: isOpen(player.x, player.y, player.z, 0, -1, 0),
          s: isOpen(player.x, player.y, player.z, 0, 1, 0),
          w: isOpen(player.x, player.y, player.z, -1, 0, 0),
          e: isOpen(player.x, player.y, player.z, 1, 0, 0),
          u: isOpen(player.x, player.y, player.z, 0, 0, 1),
          d: isOpen(player.x, player.y, player.z, 0, 0, -1),
        },
        lifts: lifts.length,
      };
    },
    exit() { return maze.exit; },
    move(k) { tryMove(k); },
    lift(dy) { tryLift(dy); },
    teleport(x, y, z) {
      player.x = x; player.y = y; player.z = z; player.moving = false;
      edmund.position.copy(cellWorld(x, y, z));
      applyLevelVisibility();
    },
  };
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ============================================================
// Planet — hollow shell that fades away as you zoom in
// ============================================================
function buildPlanet() {
  const vertexShader = `
    varying vec3 vP;
    varying vec3 vN;
    void main() {
      vN = normalize(mat3(modelMatrix) * normal);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vP = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;

  // outer surface: stylized continents, fades on the camera-facing side
  shellMat = new THREE.ShaderMaterial({
    uniforms: {
      uCam: { value: new THREE.Vector3() },
      uFade: { value: 0 },
    },
    vertexShader,
    fragmentShader: `
      uniform vec3 uCam;
      uniform float uFade;
      varying vec3 vP;
      varying vec3 vN;
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(uCam - vP);
        float facing = dot(N, V);
        float alpha = 1.0 - uFade * smoothstep(-0.05, 0.35, facing);
        if (alpha < 0.015) discard;
        float n = sin(vP.x * 0.32) * sin(vP.y * 0.41 + 1.7) * sin(vP.z * 0.36 + 4.2)
                + 0.5 * sin(vP.x * 0.83 + 2.0) * sin(vP.z * 0.71 + 0.5);
        vec3 ocean = vec3(0.42, 0.75, 0.90);
        vec3 land  = vec3(0.55, 0.82, 0.42);
        vec3 col = mix(ocean, land, smoothstep(0.08, 0.30, n));
        float l = dot(N, normalize(vec3(0.5, 0.8, 0.3))) * 0.5 + 0.5;
        col *= 0.55 + 0.5 * l;
        gl_FragColor = vec4(col, alpha);
      }`,
    transparent: true,
    side: THREE.FrontSide,
    depthWrite: false,
  });

  // inner surface: opaque sky backdrop seen from inside the planet.
  // Rendered opaque with depth so the far outer surface is hidden behind it.
  const innerMat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: `
      varying vec3 vP;
      varying vec3 vN;
      void main() {
        float h = clamp(vP.y / 30.0 * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(vec3(1.0, 0.92, 0.80), vec3(0.65, 0.83, 1.0), h);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
  });

  const geo = new THREE.SphereGeometry(PLANET_R, 56, 40);
  scene.add(new THREE.Mesh(geo, innerMat));
  const shell = new THREE.Mesh(geo, shellMat);
  shell.renderOrder = 5;
  scene.add(shell);

  // --- surface decorations (fade together with the shell) ---
  const rng = mulberry32(20260704);

  for (let i = 0; i < 26; i++) addTree(randomOnSphere(rng), rng);
  for (let i = 0; i < 5; i++) addHouse(randomOnSphere(rng), rng);

  cloudGroup = new THREE.Group();
  scene.add(cloudGroup);
  for (let i = 0; i < 8; i++) addCloud(randomOnSphere(rng), rng);
}

function randomOnSphere(rng) {
  const u = rng() * 2 - 1;
  const t = rng() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return new THREE.Vector3(s * Math.cos(t), u, s * Math.sin(t));
}

// orient +Y of a group along the sphere normal and register for fading
function placeOnSphere(group, normal, radius, parent) {
  group.position.copy(normal).multiplyScalar(radius);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  (parent || scene).add(group);
  const mats = [];
  group.traverse((o) => { if (o.isMesh) { o.material.transparent = true; mats.push(o.material); } });
  decorations.push({ obj: group, mats });
}

function addTree(n, rng) {
  const g = new THREE.Group();
  const s = 0.8 + rng() * 0.9;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22 * s, 0.3 * s, 1.2 * s, 6),
    new THREE.MeshLambertMaterial({ color: 0x8a5a33 }));
  trunk.position.y = 0.6 * s;
  const leafCol = [0x4caf50, 0x66bb6a, 0x8bc34a][Math.floor(rng() * 3)];
  const leaves = new THREE.Mesh(
    new THREE.ConeGeometry(1.1 * s, 2.2 * s, 8),
    new THREE.MeshLambertMaterial({ color: leafCol }));
  leaves.position.y = 2.1 * s;
  g.add(trunk, leaves);
  placeOnSphere(g, n, PLANET_R - 0.1);
}

function addHouse(n, rng) {
  const g = new THREE.Group();
  const s = 0.9 + rng() * 0.5;
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(1.6 * s, 1.2 * s, 1.4 * s),
    new THREE.MeshLambertMaterial({ color: [0xffe0b2, 0xfff3e0, 0xffccbc][Math.floor(rng() * 3)] }));
  base.position.y = 0.6 * s;
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(1.35 * s, 1.0 * s, 4),
    new THREE.MeshLambertMaterial({ color: 0xe57373 }));
  roof.position.y = 1.7 * s;
  roof.rotation.y = Math.PI / 4;
  g.add(base, roof);
  placeOnSphere(g, n, PLANET_R - 0.05);
}

function addCloud(n, rng) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const s = 1 + rng();
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry((0.9 - i * 0.2) * s, 10, 8), mat.clone());
    b.position.set((i - 1) * 1.0 * s, (i % 2) * 0.3 * s, (rng() - 0.5) * 0.6 * s);
    b.scale.y = 0.6;
    g.add(b);
  }
  placeOnSphere(g, n, PLANET_R * 1.12, cloudGroup);
}

function buildMoon() {
  moonPivot = new THREE.Group();
  scene.add(moonPivot);
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(2.6, 20, 14),
    new THREE.MeshLambertMaterial({ color: 0xd9d4e8 }));
  moon.position.set(PLANET_R * 2.9, PLANET_R * 0.6, 0);
  moonPivot.add(moon);
}

function buildStars() {
  const n = 900;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = randomOnSphere(Math.random).multiplyScalar(260 + Math.random() * 120);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starField = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.85,
  }));
  scene.add(starField);
}

// ============================================================
// 3D maze generation (recursive backtracker over a 3D grid —
// always solvable; horizontal passages favored for readability)
// ============================================================
// Wall arrays:
//   wx[y][z][x] (x: 0..N) — wall between cells (x-1,z) and (x,z) on level y
//   wz[y][z][x] (z: 0..N) — wall between cells (x,z-1) and (x,z) on level y
//   wy[y][z][x] (y: 0..L) — slab between level y-1 and level y at (x,z)
function generateMaze3D(N, L) {
  const wx = Array.from({ length: L }, () => Array.from({ length: N }, () => Array(N + 1).fill(true)));
  const wz = Array.from({ length: L }, () => Array.from({ length: N + 1 }, () => Array(N).fill(true)));
  const wy = Array.from({ length: L + 1 }, () => Array.from({ length: N }, () => Array(N).fill(true)));
  const visited = Array.from({ length: L }, () => Array.from({ length: N }, () => Array(N).fill(false)));

  const mid = Math.floor(N / 2);
  const start = { x: mid, y: L - 1, z: mid };   // begin on the top floor
  visited[start.y][start.z][start.x] = true;
  const stack = [[start.x, start.y, start.z]];

  // horizontal moves twice as likely as vertical ones
  const DIRS = [
    [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    [0, 1, 0], [0, -1, 0],
  ];

  while (stack.length) {
    const [x, y, z] = stack[stack.length - 1];
    const options = DIRS.filter(([dx, dy, dz]) => {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      return nx >= 0 && nx < N && nz >= 0 && nz < N && ny >= 0 && ny < L && !visited[ny][nz][nx];
    });
    if (!options.length) { stack.pop(); continue; }
    const [dx, dy, dz] = options[Math.floor(Math.random() * options.length)];
    if (dx === 1) wx[y][z][x + 1] = false;
    else if (dx === -1) wx[y][z][x] = false;
    else if (dz === 1) wz[y][z + 1][x] = false;
    else if (dz === -1) wz[y][z][x] = false;
    else if (dy === 1) wy[y + 1][z][x] = false;
    else wy[y][z][x] = false;
    const nx = x + dx, ny = y + dy, nz = z + dz;
    visited[ny][nz][nx] = true;
    stack.push([nx, ny, nz]);
  }

  maze = { N, L, wx, wz, wy, start };  // isOpen needs maze set

  // BFS from the start; the farthest side-border cell becomes the exit
  const dist = Array.from({ length: L }, () => Array.from({ length: N }, () => Array(N).fill(-1)));
  dist[start.y][start.z][start.x] = 0;
  const q = [[start.x, start.y, start.z]];
  const ALL = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
  while (q.length) {
    const [x, y, z] = q.shift();
    for (const [dx, dy, dz] of ALL) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || nx >= N || nz < 0 || nz >= N || ny < 0 || ny >= L) continue;
      if (dist[ny][nz][nx] !== -1 || !isOpen(x, y, z, dx, dz, dy)) continue;
      dist[ny][nz][nx] = dist[y][z][x] + 1;
      q.push([nx, ny, nz]);
    }
  }

  let best = null, bestD = -1;
  for (let y = 0; y < L; y++)
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        if (x !== 0 && x !== N - 1 && z !== 0 && z !== N - 1) continue;
        if (dist[y][z][x] > bestD) { bestD = dist[y][z][x]; best = [x, y, z]; }
      }
  const [ex, ey, ez] = best;
  let dx = 0, dz = 0;
  if (ez === 0) dz = -1;
  else if (ez === N - 1) dz = 1;
  else if (ex === 0) dx = -1;
  else dx = 1;
  if (dz === -1) wz[ey][0][ex] = false;
  else if (dz === 1) wz[ey][N][ex] = false;
  else if (dx === -1) wx[ey][ez][0] = false;
  else wx[ey][ez][N] = false;

  maze.exit = { x: ex, y: ey, z: ez, dx, dz };
  return maze;
}

// is the passage from cell (x,y,z) open in direction (dx,dz,dy)?
function isOpen(x, y, z, dx, dz, dy) {
  const { N, L, wx, wz, wy } = maze;
  if (dy === 1) return y + 1 < L && !wy[y + 1][z][x];
  if (dy === -1) return y > 0 && !wy[y][z][x];
  const nx = x + dx, nz = z + dz;
  if (nx < 0 || nx >= N || nz < 0 || nz >= N) {
    const e = maze.exit;
    return !!e && x === e.x && y === e.y && z === e.z && dx === e.dx && dz === e.dz;
  }
  if (dx === 1) return !wx[y][z][x + 1];
  if (dx === -1) return !wx[y][z][x];
  if (dz === 1) return !wz[y][z + 1][x];
  return !wz[y][z][x];
}

// ============================================================
// Maze meshes
// ============================================================
function levelBase(y) { return maze.y0 + y * maze.levelH; }

function cellWorld(x, y, z) {
  const { N, cell } = maze;
  return new THREE.Vector3((x - (N - 1) / 2) * cell, levelBase(y), (z - (N - 1) / 2) * cell);
}

function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
  scene.remove(g);
}

function buildMaze(N, L) {
  if (mazeGroup) disposeGroup(mazeGroup);
  confettis.forEach((c) => scene.remove(c.points));
  confettis = [];
  levelMats = [];
  lifts = [];

  generateMaze3D(N, L);
  maze.cell = MAZE_SPAN / N;
  maze.wallH = Math.min(Math.max(maze.cell * 0.5, 1.6), 3.0);
  maze.levelH = maze.wallH + SLAB;
  const totalH = L * maze.levelH;
  maze.y0 = -totalH / 2 - 2;

  mazeGroup = new THREE.Group();
  scene.add(mazeGroup);

  const { cell, wallH, levelH, wx, wz, wy, y0 } = maze;
  const thick = Math.min(cell * 0.14, 0.6);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const col = new THREE.Color();

  // --- ground: grassy island floating inside the planet (floor of level 0) ---
  const floorRad = Math.sqrt(PLANET_R * PLANET_R - y0 * y0) * 0.955;
  const floorH = 1.4;
  const ground = new THREE.Mesh(
    new THREE.CylinderGeometry(floorRad, floorRad * 0.93, floorH, 56), [
      new THREE.MeshLambertMaterial({ color: 0x9a6b42 }),   // side (soil)
      new THREE.MeshLambertMaterial({ color: 0x7ec850 }),   // top (grass)
      new THREE.MeshLambertMaterial({ color: 0x7a5433 }),   // bottom
    ]);
  ground.position.y = y0 - floorH / 2;
  mazeGroup.add(ground);

  // --- per-level walls + floor slabs (each level gets its own materials
  //     so floors above Edmund can be ghosted) ---
  for (let y = 0; y < L; y++) {
    const segs = [];
    for (let z = 0; z < N; z++)
      for (let x = 0; x <= N; x++)
        if (wx[y][z][x]) segs.push({
          x: (x - N / 2) * cell, z: (z - (N - 1) / 2) * cell,
          sx: thick, sz: cell + thick,
        });
    for (let z = 0; z <= N; z++)
      for (let x = 0; x < N; x++)
        if (wz[y][z][x]) segs.push({
          x: (x - (N - 1) / 2) * cell, z: (z - N / 2) * cell,
          sx: cell + thick, sz: thick,
        });

    const hue = LEVEL_HUES[y % LEVEL_HUES.length];
    const wallMat = new THREE.MeshLambertMaterial({ transparent: true });
    const walls = new THREE.InstancedMesh(boxGeo, wallMat, segs.length);
    segs.forEach((s, i) => {
      m.compose(
        new THREE.Vector3(s.x, levelBase(y) + wallH / 2, s.z),
        quat,
        new THREE.Vector3(s.sx, wallH, s.sz));
      walls.setMatrixAt(i, m);
      col.setHSL(hue, 0.55, 0.64 + Math.random() * 0.08);
      walls.setColorAt(i, col);
    });
    mazeGroup.add(walls);

    const mats = [wallMat];

    // floor slabs of this level (between level y-1 and y); level 0 uses the ground
    if (y > 0) {
      const tiles = [];
      for (let z = 0; z < N; z++)
        for (let x = 0; x < N; x++)
          if (wy[y][z][x]) tiles.push({ x, z });
      const slabMat = new THREE.MeshLambertMaterial({ color: 0xe8cfa8, transparent: true });
      const slabs = new THREE.InstancedMesh(boxGeo, slabMat, tiles.length);
      tiles.forEach((tPos, i) => {
        m.compose(
          new THREE.Vector3((tPos.x - (N - 1) / 2) * cell, levelBase(y) - SLAB / 2, (tPos.z - (N - 1) / 2) * cell),
          quat,
          new THREE.Vector3(cell + thick, SLAB, cell + thick));
        slabs.setMatrixAt(i, m);
      });
      mazeGroup.add(slabs);
      mats.push(slabMat);
    }

    levelMats.push(mats);
  }

  // --- lifts: glowing columns where a hole connects two levels ---
  for (let y = 1; y < L; y++)
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        if (wy[y][z][x]) continue;
        const cx = (x - (N - 1) / 2) * cell, cz = (z - (N - 1) / 2) * cell;
        const beamMat = new THREE.MeshBasicMaterial({
          color: 0xaef0ff, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide,
        });
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(cell * 0.26, cell * 0.26, levelH - 0.05, 14, 1, true), beamMat);
        beam.position.set(cx, levelBase(y - 1) + levelH / 2, cz);
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(cell * 0.28, 0.08, 8, 24),
          new THREE.MeshBasicMaterial({ color: 0xfff0a0 }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(cx, levelBase(y - 1) + 0.06, cz);
        mazeGroup.add(beam, ring);
        lifts.push({ beamMat });
      }

  // --- exit marker: a golden star just outside the opening ---
  const e = maze.exit;
  const starPos = cellWorld(e.x, e.y, e.z).add(
    new THREE.Vector3(e.dx, 0, e.dz).multiplyScalar(cell * 1.1));
  exitStar = new THREE.Mesh(
    new THREE.OctahedronGeometry(cell * 0.28),
    new THREE.MeshStandardMaterial({ color: 0xffd54f, emissive: 0xcc8800, emissiveIntensity: 0.7, roughness: 0.3 }));
  exitStar.scale.y = 1.5;
  exitStarBaseY = levelBase(e.y) + wallH * 0.8;
  exitStar.position.copy(starPos).setY(exitStarBaseY);
  mazeGroup.add(exitStar);

  // a fluffy cloud to land on if the exit is above the ground floor
  if (e.y > 0) {
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(cell * (0.34 - i * 0.07), 10, 8), cloudMat.clone());
      b.position.set(starPos.x + (i - 1) * cell * 0.3, levelBase(e.y) - cell * 0.12, starPos.z + (i % 2) * cell * 0.15);
      b.scale.y = 0.55;
      mazeGroup.add(b);
    }
  }

  // --- a few flowers on the grass outside the maze ---
  const halfSpan = MAZE_SPAN / 2 + thick;
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = halfSpan * 0.9 + Math.random() * (floorRad - halfSpan * 0.9 - 0.8);
    const fx = Math.cos(a) * r, fz = Math.sin(a) * r;
    if (Math.abs(fx) < halfSpan + 0.5 && Math.abs(fz) < halfSpan + 0.5) continue;
    if (Math.hypot(fx, fz) > floorRad - 0.8) continue;
    const fl = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 5),
      new THREE.MeshLambertMaterial({ color: 0x3f8f3f }));
    stem.position.y = 0.25;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6),
      new THREE.MeshLambertMaterial({ color: [0xff80ab, 0xffd740, 0xb388ff][i % 3] }));
    head.position.y = 0.55;
    fl.add(stem, head);
    fl.position.set(fx, y0, fz);
    mazeGroup.add(fl);
  }

  buildEdmund();
  resetPlayer();
}

// ghost the floors above Edmund, keep his floor solid, dim floors below
function applyLevelVisibility() {
  for (let y = 0; y < maze.L; y++) {
    const op = y === player.y ? 1 : (y < player.y ? 0.85 : 0.13);
    for (const mat of levelMats[y]) {
      mat.opacity = op;
      mat.depthWrite = op > 0.5;
    }
  }
  const chip = document.getElementById('floorChip');
  chip.textContent = `🪜 Floor ${player.y + 1} / ${maze.L}`;
}

// ============================================================
// Edmund — a little boy built from primitives
// ============================================================
function buildEdmund() {
  if (edmund) disposeGroup(edmund);
  if (shadowBlob) disposeGroup(shadowBlob);

  const H = maze.wallH * 0.72;       // Edmund's height
  const s = H / 2.6;                 // base model is ~2.6 units tall

  edmund = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xffd9b3 });
  const shirt = new THREE.MeshLambertMaterial({ color: 0x4a90d9 });
  const pants = new THREE.MeshLambertMaterial({ color: 0x35507a });
  const hairM = new THREE.MeshLambertMaterial({ color: 0x6b4226 });

  const mk = (geo, mat, x, y, z) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x * s, y * s, z * s);
    return mesh;
  };

  const legL = mk(new THREE.CapsuleGeometry(0.16 * s, 0.5 * s, 3, 8), pants, -0.22, 0.55, 0);
  const legR = mk(new THREE.CapsuleGeometry(0.16 * s, 0.5 * s, 3, 8), pants, 0.22, 0.55, 0);
  const body = mk(new THREE.CapsuleGeometry(0.42 * s, 0.6 * s, 4, 10), shirt, 0, 1.3, 0);
  const armL = mk(new THREE.CapsuleGeometry(0.12 * s, 0.5 * s, 3, 8), shirt, -0.58, 1.35, 0);
  const armR = mk(new THREE.CapsuleGeometry(0.12 * s, 0.5 * s, 3, 8), shirt, 0.58, 1.35, 0);
  const head = mk(new THREE.SphereGeometry(0.45 * s, 16, 12), skin, 0, 2.15, 0);
  const hair = mk(new THREE.SphereGeometry(0.47 * s, 16, 12), hairM, 0, 2.3, -0.06);
  hair.scale.set(1, 0.72, 1);
  const eyeL = mk(new THREE.SphereGeometry(0.06 * s, 8, 6), new THREE.MeshBasicMaterial({ color: 0x222222 }), -0.16, 2.2, 0.38);
  const eyeR = mk(new THREE.SphereGeometry(0.06 * s, 8, 6), new THREE.MeshBasicMaterial({ color: 0x222222 }), 0.16, 2.2, 0.38);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.13 * s, 0.025 * s, 6, 12, Math.PI), new THREE.MeshBasicMaterial({ color: 0xa05030 }));
  smile.position.set(0, 2.02 * s, 0.42 * s);
  smile.rotation.z = Math.PI;

  edmund.add(legL, legR, body, armL, armR, head, hair, eyeL, eyeR, smile);
  edmund.userData.parts = { legL, legR, armL, armR };
  scene.add(edmund);

  shadowBlob = new THREE.Mesh(
    new THREE.CircleGeometry(0.42 * H, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
  shadowBlob.rotation.x = -Math.PI / 2;
  scene.add(shadowBlob);
}

function resetPlayer() {
  const { start } = maze;
  player = {
    x: start.x, y: start.y, z: start.z,
    moving: false, mode: 'walk', from: null, to: null, t: 0,
    rotY: 0, targetRotY: 0, walkPhase: 0,
    escaped: false,
  };
  const p = cellWorld(player.x, player.y, player.z);
  edmund.position.copy(p);
  shadowBlob.position.set(p.x, p.y + 0.03, p.z);
  cam.target.y = levelBase(player.y) + maze.wallH * 0.6;
  applyLevelVisibility();
}

// ============================================================
// Movement
// ============================================================
// map a d-pad press to a grid direction relative to the camera
function gridDirFor(key) {
  const f = new THREE.Vector3().subVectors(cam.target, camera.position);
  f.y = 0;
  if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
  f.normalize();
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  let fwd = DIRS[0], bestDot = -Infinity;
  for (const [dx, dz] of DIRS) {
    const d = f.x * dx + f.z * dz;
    if (d > bestDot) { bestDot = d; fwd = [dx, dz]; }
  }
  const [dx, dz] = fwd;
  switch (key) {
    case 'up': return [dx, dz];
    case 'down': return [-dx, -dz];
    case 'right': return [-dz, dx];
    case 'left': return [dz, -dx];
  }
}

function tryMove(key) {
  if (!player || player.moving || state !== 'play') return;
  const [dx, dz] = gridDirFor(key);
  if (!isOpen(player.x, player.y, player.z, dx, dz, 0)) return;

  const nx = player.x + dx, nz = player.z + dz;
  player.moving = true;
  player.mode = 'walk';
  player.t = 0;
  player.from = cellWorld(player.x, player.y, player.z);
  player.to = cellWorld(nx, player.y, nz);
  player.targetRotY = Math.atan2(dx, dz);
  player.x = nx; player.z = nz;
  if (nx < 0 || nx >= maze.N || nz < 0 || nz >= maze.N) player.escaped = true;
  Music.step();
}

function tryLift(dy) {
  if (!player || player.moving || state !== 'play') return;
  if (!isOpen(player.x, player.y, player.z, 0, 0, dy)) return;

  player.moving = true;
  player.mode = 'lift';
  player.t = 0;
  player.from = cellWorld(player.x, player.y, player.z);
  player.y += dy;
  player.to = cellWorld(player.x, player.y, player.z);
  applyLevelVisibility();
  Music.whoosh(dy);
}

function updatePlayer(dt) {
  if (!player) return;
  const parts = edmund.userData.parts;

  if (player.moving) {
    const dur = player.mode === 'lift' ? 0.55 : 0.21;
    player.t += dt / dur;
    if (player.t >= 1) {
      player.t = 1;
      player.moving = false;
      edmund.position.copy(player.to);
      if (player.escaped) { win(); }
    } else if (player.mode === 'lift') {
      const t = easeInOut(player.t);
      edmund.position.lerpVectors(player.from, player.to, t);
      edmund.rotation.y = player.rotY + Math.sin(player.t * Math.PI) * 0.6;  // gentle twirl
    } else {
      const t = player.t;
      player.walkPhase += dt * 13;
      edmund.position.lerpVectors(player.from, player.to, t);
      edmund.position.y = player.from.y + Math.sin(t * Math.PI) * maze.cell * 0.12;
      const swing = Math.sin(player.walkPhase) * 0.7;
      parts.legL.rotation.x = swing;
      parts.legR.rotation.x = -swing;
      parts.armL.rotation.x = -swing * 0.8;
      parts.armR.rotation.x = swing * 0.8;
    }
  } else {
    // relax limbs, gentle idle bob
    for (const k of ['legL', 'legR', 'armL', 'armR']) parts[k].rotation.x *= 0.85;
    edmund.position.y = levelBase(player.y) + Math.sin(clock.elapsedTime * 2) * 0.06;
    if (heldDir) tryMove(heldDir);
  }

  // smooth turn (shortest way around)
  if (!(player.moving && player.mode === 'lift')) {
    let d = player.targetRotY - player.rotY;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    player.rotY += d * Math.min(1, dt * 12);
    edmund.rotation.y = player.rotY;
  }

  shadowBlob.position.set(edmund.position.x, levelBase(player.y) + 0.03, edmund.position.z);
}

// ============================================================
// Winning
// ============================================================
function win() {
  state = 'won';
  heldDir = null;
  Music.chime();
  burstConfetti(edmund.position.clone().add(new THREE.Vector3(0, maze.cell * 0.8, 0)));
  setTimeout(() => burstConfetti(exitStar.position.clone()), 400);
  setTimeout(() => {
    document.getElementById('winOverlay').classList.remove('hidden');
    document.getElementById('dpad').classList.add('hidden');
    document.getElementById('liftBtns').classList.add('hidden');
  }, 1500);
}

function burstConfetti(pos) {
  const n = 140;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const vels = [];
  const palette = [0xff5252, 0xffd740, 0x69f0ae, 0x40c4ff, 0xe040fb, 0xffab40];
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    positions.set([pos.x, pos.y, pos.z], i * 3);
    c.setHex(palette[i % palette.length]);
    colors.set([c.r, c.g, c.b], i * 3);
    const a = Math.random() * Math.PI * 2;
    const up = 6 + Math.random() * 8;
    const out = 2 + Math.random() * 5;
    vels.push(new THREE.Vector3(Math.cos(a) * out, up, Math.sin(a) * out));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    size: maze.cell * 0.14, vertexColors: true, transparent: true, depthWrite: false,
  }));
  scene.add(points);
  confettis.push({ points, vels, age: 0 });
}

function updateConfetti(dt) {
  for (let i = confettis.length - 1; i >= 0; i--) {
    const cf = confettis[i];
    cf.age += dt;
    const pos = cf.points.geometry.attributes.position;
    for (let j = 0; j < cf.vels.length; j++) {
      const v = cf.vels[j];
      v.y -= 18 * dt;
      pos.array[j * 3] += v.x * dt;
      pos.array[j * 3 + 1] += v.y * dt;
      pos.array[j * 3 + 2] += v.z * dt;
    }
    pos.needsUpdate = true;
    cf.points.material.opacity = Math.max(0, 1 - (cf.age - 1.2) / 1.2);
    if (cf.age > 2.4) {
      scene.remove(cf.points);
      cf.points.geometry.dispose();
      cf.points.material.dispose();
      confettis.splice(i, 1);
    }
  }
}

// ============================================================
// Camera controls — drag to orbit, pinch/wheel to zoom
// ============================================================
function setupCameraControls(canvas) {
  const pointers = new Map();
  let pinchDist = 0;

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      cam.az -= dx * 0.0055;
      cam.polar = clamp(cam.polar - dy * 0.0045, 0.22, 1.38);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) cam.dist = clamp(cam.dist * (pinchDist / d), 16, 150);
      pinchDist = d;
    }
  });

  const release = (e) => { pointers.delete(e.pointerId); pinchDist = 0; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.dist = clamp(cam.dist * (1 + e.deltaY * 0.001), 16, 150);
  }, { passive: false });
}

function updateCamera(dt) {
  // camera target gently follows Edmund's floor
  const desiredY = levelBase(player ? player.y : 0) + maze.wallH * 0.6;
  cam.target.y += (desiredY - cam.target.y) * Math.min(1, dt * 4);

  const sp = Math.sin(cam.polar), cp = Math.cos(cam.polar);
  camera.position.set(
    cam.target.x + cam.dist * sp * Math.sin(cam.az),
    cam.target.y + cam.dist * cp,
    cam.target.z + cam.dist * sp * Math.cos(cam.az));
  camera.lookAt(cam.target);
}

// ============================================================
// Generative relaxing music (Web Audio — no files needed)
// ============================================================
const Music = {
  ctx: null, master: null, delay: null, muted: false, started: false,

  start() {
    if (this.started) { this.ctx.resume(); return; }
    this.started = true;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.16;
    this.master.connect(this.ctx.destination);

    // gentle echo for spaciousness
    this.delay = this.ctx.createDelay(1.0);
    this.delay.delayTime.value = 0.42;
    const fb = this.ctx.createGain(); fb.gain.value = 0.32;
    const wet = this.ctx.createGain(); wet.gain.value = 0.3;
    this.delay.connect(fb); fb.connect(this.delay);
    this.delay.connect(wet); wet.connect(this.master);

    this.chordIdx = 0;
    this.nextChordAt = this.ctx.currentTime + 0.2;
    this.nextNoteAt = this.ctx.currentTime + 3;
    setInterval(() => this.schedule(), 400);
  },

  chords: [
    [261.63, 329.63, 392.0],   // C
    [220.0, 261.63, 329.63],   // Am
    [174.61, 220.0, 261.63],   // F
    [196.0, 246.94, 293.66],   // G
  ],
  pentatonic: [523.25, 587.33, 659.26, 783.99, 880.0],

  schedule() {
    const t = this.ctx.currentTime;
    if (t > this.nextChordAt - 1.0) {
      this.playChord(this.chords[this.chordIdx % this.chords.length], this.nextChordAt);
      this.chordIdx++;
      this.nextChordAt += 9;
    }
    if (t > this.nextNoteAt - 0.5) {
      const f = this.pentatonic[Math.floor(Math.random() * this.pentatonic.length)];
      this.pluck(f, this.nextNoteAt);
      this.nextNoteAt += 2.5 + Math.random() * 4;
    }
  },

  playChord(freqs, when) {
    const dur = 10.5;
    const all = [...freqs, freqs[0] / 2];   // add a soft bass root
    for (const f of all) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * (1 + (Math.random() - 0.5) * 0.002);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(f < 200 ? 0.035 : 0.028, when + 3.5);
      g.gain.setValueAtTime(f < 200 ? 0.035 : 0.028, when + dur - 4);
      g.gain.linearRampToValueAtTime(0, when + dur);
      osc.connect(g); g.connect(this.master);
      osc.start(when); osc.stop(when + dur);
    }
  },

  pluck(freq, when, vol = 0.05) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0004, when + 1.8);
    osc.connect(g); g.connect(this.master); g.connect(this.delay);
    osc.start(when); osc.stop(when + 2);
  },

  step() {
    if (!this.ctx || this.muted) return;
    this.pluck(300 + Math.random() * 60, this.ctx.currentTime, 0.014);
  },

  // rising / falling glide for the lifts
  whoosh(dy) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(dy > 0 ? 400 : 700, t);
    osc.frequency.exponentialRampToValueAtTime(dy > 0 ? 700 : 400, t + 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.03, t + 0.1);
    g.gain.linearRampToValueAtTime(0, t + 0.55);
    osc.connect(g); g.connect(this.master); g.connect(this.delay);
    osc.start(t); osc.stop(t + 0.6);
  },

  chime() {
    if (!this.ctx) return;
    [523.25, 659.26, 783.99, 1046.5].forEach((f, i) =>
      this.pluck(f, this.ctx.currentTime + i * 0.13, 0.06));
  },

  toggle() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.16;
    return this.muted;
  },
};

// ============================================================
// UI
// ============================================================
function setupUI() {
  document.querySelectorAll('.size-btn[data-n]').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.size-btn[data-n]').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      mazeN = parseInt(b.dataset.n, 10);
      mazeL = parseInt(b.dataset.l, 10);
    });
  });

  const showControls = (on) => {
    document.getElementById('dpad').classList.toggle('hidden', !on);
    document.getElementById('liftBtns').classList.toggle('hidden', !on);
    document.getElementById('floorChip').classList.toggle('hidden', !on);
  };

  document.getElementById('btnStart').addEventListener('click', () => {
    try {
      // never let audio problems block the game from starting
      try { Music.start(); } catch (err) { console.warn('audio unavailable:', err); }
      buildMaze(mazeN, mazeL);
      document.getElementById('startOverlay').classList.add('hidden');
      document.getElementById('hud').classList.remove('hidden');
      showControls(true);
      state = 'intro';
      introT = 0;
    } catch (err) {
      console.error(err);
      fatal('Could not start: ' + err.message);
    }
  });

  document.getElementById('btnAgain').addEventListener('click', () => {
    document.getElementById('winOverlay').classList.add('hidden');
    showControls(true);
    buildMaze(mazeN, mazeL);
    state = 'play';
  });

  document.getElementById('btnChange').addEventListener('click', () => {
    document.getElementById('winOverlay').classList.add('hidden');
    document.getElementById('startOverlay').classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
    showControls(false);
    state = 'start';
    cam.dist = 110;
  });

  document.getElementById('btnNew').addEventListener('click', () => {
    if (state !== 'play') return;
    buildMaze(mazeN, mazeL);
  });

  document.getElementById('btnMusic').addEventListener('click', () => {
    const muted = Music.toggle();
    document.getElementById('btnMusic').textContent = muted ? '🔇' : '🔊';
  });

  // d-pad: hold to keep walking
  document.querySelectorAll('.dpad-btn[data-dir]').forEach((b) => {
    const press = (e) => { e.preventDefault(); heldDir = b.dataset.dir; b.classList.add('pressed'); tryMove(heldDir); };
    const lift = () => { if (heldDir === b.dataset.dir) heldDir = null; b.classList.remove('pressed'); };
    b.addEventListener('pointerdown', press);
    b.addEventListener('pointerup', lift);
    b.addEventListener('pointercancel', lift);
    b.addEventListener('pointerleave', lift);
  });

  // lift buttons: one floor per tap
  document.getElementById('btnLiftUp').addEventListener('pointerdown', (e) => { e.preventDefault(); tryLift(1); });
  document.getElementById('btnLiftDown').addEventListener('pointerdown', (e) => { e.preventDefault(); tryLift(-1); });

  // keyboard for desktop testing
  const keyMap = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
  };
  window.addEventListener('keydown', (e) => {
    const k = keyMap[e.key];
    if (k) { heldDir = k; tryMove(k); }
    else if (e.key === 'e' || e.key === 'PageUp') tryLift(1);
    else if (e.key === 'q' || e.key === 'PageDown') tryLift(-1);
  });
  window.addEventListener('keyup', (e) => {
    if (keyMap[e.key] === heldDir) heldDir = null;
  });

  // pause audio when the tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (!Music.ctx) return;
    if (document.hidden) Music.ctx.suspend();
    else Music.ctx.resume();
  });
}

// ============================================================
// Main loop
// ============================================================
const _camDir = new THREE.Vector3();
const _decoPos = new THREE.Vector3();

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // intro: glide down toward the planet, shell melts away
  if (state === 'intro') {
    introT += dt / 3.0;
    const k = easeInOut(Math.min(introT, 1));
    cam.dist = 110 - (110 - 52) * k;
    if (introT >= 1) state = 'play';
  }

  // shell fade driven by camera distance
  const fade = clamp((88 - cam.dist) / (88 - 48), 0, 1);
  shellMat.uniforms.uFade.value = fade;
  shellMat.uniforms.uCam.value.copy(camera.position);

  // fade surface decorations on the camera-facing side
  _camDir.copy(camera.position).normalize();
  for (const d of decorations) {
    d.obj.getWorldPosition(_decoPos).normalize();
    const facing = _decoPos.dot(_camDir);
    const op = 1 - fade * smoothstep(-0.25, 0.25, facing);
    d.obj.visible = op > 0.02;
    for (const m of d.mats) m.opacity = op;
  }

  // ambient motion
  cloudGroup.rotation.y += dt * 0.02;
  moonPivot.rotation.y += dt * 0.05;
  starField.rotation.y += dt * 0.004;
  if (exitStar) {
    exitStar.rotation.y += dt * 1.5;
    exitStar.position.y = exitStarBaseY + Math.sin(t * 2.2) * 0.25;
  }
  lifts.forEach((lf, i) => { lf.beamMat.opacity = 0.26 + 0.1 * Math.sin(t * 2 + i * 1.7); });

  if (state === 'play' || state === 'won') updatePlayer(dt);
  updateConfetti(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
}

// ---------- helpers ----------
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function easeInOut(t) { return t * t * (3 - 2 * t); }
function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let z = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

init();

// test hook: open index.html#autostart to skip the start screen
if (location.hash === '#autostart') {
  document.getElementById('btnStart').click();
}
