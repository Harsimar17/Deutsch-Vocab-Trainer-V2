// Büro in 3D: a small real-time office seen through your own eyes, like a game. You sit at
// your desk looking at your laptop. When a colleague comes over they walk in through the door
// at the back and down the aisle; your view turns towards them as they get close. While the
// call runs they breathe, blink, nod and gesture, and their mouth follows the voice you hear.
// When they leave they walk back out and your view turns back to the laptop.
//
// Everything is built from simple shapes in code (no model files), so it loads fast and every
// movement is under our control. Three.js comes from the CDN via the import map in index.html.
import * as THREE from "three";

const SEAT = new THREE.Vector3(0, 1.18, 0.35); // your eyes, sitting at your desk
const LAPTOP_LOOK = { yaw: 0, pitch: -0.27 };
const STAND = new THREE.Vector3(1.2, 0, -1.15); // where a colleague stands: beside your desk, at your right
const PATH_IN = [new THREE.Vector3(3.6, 0, -11.2), new THREE.Vector3(1.75, 0, -9.6), new THREE.Vector3(1.75, 0, -2.2), STAND];
const WALK_SPEED = 1.25; // m/s
const TURN_WITHIN = 4.2; // m: you look up when they are this close

const mat = (color, roughness = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

function mesh(geo, material, { x = 0, y = 0, z = 0, shadow = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}
const box = (w, h, d, material, pos) => mesh(new THREE.BoxGeometry(w, h, d), material, pos);
const capsule = (r, len, material, pos) => mesh(new THREE.CapsuleGeometry(r, len, 6, 14), material, pos);
const sphere = (r, material, pos) => mesh(new THREE.SphereGeometry(r, 20, 14), material, pos);
const joint = (parent, x = 0, y = 0, z = 0) => {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
};

// ---------- the office ----------

// A laptop or monitor screen: a few lines of "code" on a dark background.
function screenTexture(light = false) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 160;
  const g = c.getContext("2d");
  g.fillStyle = light ? "#f4f6fa" : "#1e2230";
  g.fillRect(0, 0, 256, 160);
  const colors = light ? ["#5b6b8c", "#9aa6bf", "#2f6fdb"] : ["#c792ea", "#82aaff", "#c3e88d", "#f78c6c", "#89ddff"];
  for (let y = 10; y < 155; y += 9) {
    let x = 10 + (Math.floor(y / 9) % 5) * 8;
    while (x < 230 && Math.random() < 0.85) {
      const w = 10 + Math.random() * 40;
      g.fillStyle = colors[Math.floor(Math.random() * colors.length)];
      g.fillRect(x, y, w, 4);
      x += w + 6;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function desk(scene, x, z, { monitor = true, rotate = 0, chair = true } = {}) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotate;
  const wood = mat("#c8a882", 0.6);
  const metal = mat("#3a3d44", 0.4, { metalness: 0.6 });
  g.add(box(1.6, 0.04, 0.8, wood, { y: 0.74 }));
  for (const [lx, lz] of [[-0.75, -0.35], [0.75, -0.35], [-0.75, 0.35], [0.75, 0.35]]) g.add(box(0.05, 0.72, 0.05, metal, { x: lx, y: 0.36, z: lz }));
  if (monitor) {
    g.add(box(0.62, 0.38, 0.03, mat("#16181d", 0.4), { y: 1.05, z: -0.25 }));
    const s = mesh(new THREE.PlaneGeometry(0.58, 0.34), new THREE.MeshBasicMaterial({ map: screenTexture(Math.random() < 0.4) }), { y: 1.05, z: -0.233, shadow: false });
    g.add(s);
    g.add(box(0.06, 0.16, 0.06, metal, { y: 0.83, z: -0.27 }));
  }
  if (chair) {
    const fabric = mat("#2b2f3a", 0.9);
    g.add(box(0.5, 0.08, 0.5, fabric, { y: 0.48, z: 0.55 }));
    g.add(box(0.48, 0.55, 0.07, fabric, { y: 0.82, z: 0.8 }));
    g.add(box(0.06, 0.42, 0.06, metal, { y: 0.24, z: 0.55 }));
  }
  scene.add(g);
  return g;
}

function plant(scene, x, z, s = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(s);
  g.add(mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.36, 16), mat("#e9e4dc", 0.7), { y: 0.18 }));
  const leaf = mat("#3f7d3c", 0.75);
  for (let i = 0; i < 7; i++) {
    const l = sphere(0.16 + Math.random() * 0.06, leaf, { x: (Math.random() - 0.5) * 0.3, y: 0.55 + Math.random() * 0.45, z: (Math.random() - 0.5) * 0.3 });
    l.scale.set(1, 1.4, 1);
    g.add(l);
  }
  scene.add(g);
}

function buildOffice(scene) {
  // Room: 12 m wide, 15 m deep, 3 m high. You sit near the front, facing the back wall.
  const wall = mat("#eceae6", 0.95);
  const floor = mesh(new THREE.PlaneGeometry(12, 15), mat("#8c8f96", 1));
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -4.5;
  scene.add(floor);
  const ceiling = mesh(new THREE.PlaneGeometry(12, 15), mat("#f4f3f0", 1, { emissive: "#c9c8c4" }), { y: 3, z: -4.5, shadow: false });
  ceiling.rotation.x = Math.PI / 2;
  scene.add(ceiling);
  const back = mesh(new THREE.PlaneGeometry(12, 3), wall, { y: 1.5, z: -12, shadow: false });
  scene.add(back);
  const right = mesh(new THREE.PlaneGeometry(15, 3), wall, { x: 6, y: 1.5, z: -4.5, shadow: false });
  right.rotation.y = -Math.PI / 2;
  scene.add(right);
  const front = mesh(new THREE.PlaneGeometry(12, 3), wall, { y: 1.5, z: 3, shadow: false });
  front.rotation.y = Math.PI;
  scene.add(front);

  // Left: a wall of windows with daylight.
  const frame = mat("#2e3238", 0.5, { metalness: 0.4 });
  const sky = new THREE.MeshBasicMaterial({ color: "#cfe6f7" });
  const glass = mesh(new THREE.PlaneGeometry(15, 2.3), sky, { x: -6, y: 1.55, z: -4.5, shadow: false });
  glass.rotation.y = Math.PI / 2;
  scene.add(glass);
  scene.add(box(0.1, 0.4, 15, wall, { x: -6, y: 0.2, z: -4.5, shadow: false }));
  scene.add(box(0.1, 0.3, 15, wall, { x: -6, y: 2.85, z: -4.5, shadow: false }));
  for (let z = 3; z >= -12; z -= 1.5) scene.add(box(0.12, 2.3, 0.07, frame, { x: -5.95, y: 1.55, z, shadow: false }));
  // Buildings and trees outside, softly.
  for (let i = 0; i < 6; i++) {
    const b = mesh(new THREE.PlaneGeometry(1.6 + Math.random(), 1 + Math.random() * 1.2), new THREE.MeshBasicMaterial({ color: ["#b9c4cf", "#c9c2b6", "#aab6c2"][i % 3] }), { x: -6.3, y: 1.0, z: 1 - i * 2.4, shadow: false });
    b.position.y = 0.4 + b.geometry.parameters.height / 2;
    b.rotation.y = Math.PI / 2;
    scene.add(b);
  }

  // Ceiling light panels.
  const panel = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  for (let z = 1; z >= -11; z -= 3) for (const x of [-3, 1.5]) {
    const p = mesh(new THREE.PlaneGeometry(1.2, 0.3), panel, { x, y: 2.98, z, shadow: false });
    p.rotation.x = Math.PI / 2;
    scene.add(p);
  }

  // Back wall: the door (where colleagues come in), a whiteboard with sticky notes, folders.
  scene.add(box(1.0, 2.15, 0.06, mat("#9b7653", 0.6), { x: 3.6, y: 1.075, z: -11.96 }));
  scene.add(sphere(0.035, mat("#c9c9c9", 0.3, { metalness: 0.8 }), { x: 3.25, y: 1.05, z: -11.9 }));
  scene.add(box(2.4, 1.2, 0.04, mat("#fbfbf8", 0.4), { x: -0.6, y: 1.6, z: -11.97 }));
  const notes = ["#ffe066", "#ff8fab", "#8ce99a", "#74c0fc", "#ffa94d"];
  for (let i = 0; i < 14; i++) scene.add(box(0.14, 0.14, 0.01, mat(notes[i % 5], 0.8), { x: -1.6 + (i % 7) * 0.3, y: 1.9 - Math.floor(i / 7) * 0.35, z: -11.94, shadow: false }));
  const shelfWood = mat("#b89470", 0.7);
  scene.add(box(1.8, 1.9, 0.4, shelfWood, { x: 5.7, y: 0.95, z: -6 }));
  const folder = ["#1f4e9c", "#c0392b", "#2d6a4f", "#f1c40f", "#4a4e69"];
  for (let r = 0; r < 4; r++) for (let i = 0; i < 9; i++) scene.add(box(0.07, 0.32, 0.28, mat(folder[(i + r) % 5], 0.7), { x: 5.45, y: 0.3 + r * 0.45, z: -6.75 + i * 0.17 + (r % 2) * 0.03, shadow: false }));

  // Rows of desks with people working; the aisle on your right (x 1–2.4) stays free.
  const desks = [];
  for (const z of [-3.6, -6.6, -9.4]) {
    desks.push(desk(scene, -3.6, z), desk(scene, -1.6, z));
    desks.push(desk(scene, 3.6, z));
  }
  desk(scene, -1.9, -0.2, { monitor: true });
  for (const [x, z, s] of [[-5.3, 1.6, 1.1], [0.9, -11.3, 1], [5.4, -10.8, 1.2], [5.4, 1.8, 1], [-5.3, -7.8, 1]]) plant(scene, x, z, s);
  return desks;
}

// Your own desk, close in front of you: laptop with code, a second monitor, mug, notebook.
function buildMyDesk(scene) {
  const g = new THREE.Group();
  const wood = mat("#d2b48c", 0.55);
  g.add(box(1.7, 0.04, 0.85, wood, { y: 0.74, z: -0.38 }));
  const metal = mat("#3a3d44", 0.4, { metalness: 0.6 });
  for (const [lx, lz] of [[-0.8, -0.75], [0.8, -0.75]]) g.add(box(0.05, 0.72, 0.05, metal, { x: lx, y: 0.36, z: lz }));
  const alu = mat("#9da3ab", 0.35, { metalness: 0.7 });
  g.add(box(0.36, 0.015, 0.24, alu, { y: 0.768, z: -0.2 }));
  g.add(box(0.3, 0.004, 0.12, mat("#2a2c31", 0.6), { y: 0.777, z: -0.22, shadow: false }));
  const lid = new THREE.Group();
  lid.position.set(0, 0.775, -0.32);
  lid.rotation.x = -0.32;
  lid.add(box(0.36, 0.24, 0.012, alu, { y: 0.12 }));
  lid.add(mesh(new THREE.PlaneGeometry(0.33, 0.21), new THREE.MeshBasicMaterial({ map: screenTexture() }), { y: 0.12, z: 0.0065, shadow: false }));
  g.add(lid);
  const mon = new THREE.Group(); // second monitor, on your left (the aisle on your right stays in view)
  mon.position.set(-0.5, 0, -0.62);
  mon.rotation.y = 0.35;
  mon.add(box(0.62, 0.38, 0.03, mat("#16181d", 0.4), { y: 1.07 }));
  mon.add(mesh(new THREE.PlaneGeometry(0.58, 0.34), new THREE.MeshBasicMaterial({ map: screenTexture() }), { y: 1.07, z: 0.016, shadow: false }));
  mon.add(box(0.06, 0.18, 0.06, metal, { y: 0.84, z: -0.02 }));
  g.add(mon);
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.036, 0.1, 18), mat("#f2f2f2", 0.4), { x: 0.36, y: 0.81, z: -0.22 }));
  g.add(mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.002, 18), mat("#6b4226", 0.3), { x: 0.36, y: 0.858, z: -0.22, shadow: false }));
  const book = box(0.22, 0.02, 0.29, mat("#2f3e5c", 0.7), { x: -0.5, y: 0.77, z: -0.08 });
  book.rotation.y = 0.25;
  g.add(book);
  scene.add(g);
}

// ---------- people ----------

const HAIR = {
  short(head, m) { const h = sphere(0.122, m, { y: 0.135, z: -0.01 }); h.scale.set(1, 0.72, 1.04); head.add(h); },
  long(head, m) {
    const h = sphere(0.125, m, { y: 0.13, z: -0.01 }); h.scale.set(1.04, 0.78, 1.06); head.add(h);
    const back = capsule(0.105, 0.16, m, { y: 0.0, z: -0.05 }); back.scale.set(1.05, 1, 0.65); head.add(back);
  },
  bun(head, m) {
    const h = sphere(0.122, m, { y: 0.135, z: -0.01 }); h.scale.set(1, 0.74, 1.04); head.add(h);
    head.add(sphere(0.055, m, { y: 0.17, z: -0.11 }));
  },
  curly(head, m) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      head.add(sphere(0.045, m, { x: Math.cos(a) * 0.085, y: 0.19 + Math.sin(i * 1.7) * 0.015, z: Math.sin(a) * 0.08 - 0.01 }));
    }
    const h = sphere(0.12, m, { y: 0.13, z: -0.01 }); h.scale.set(1, 0.7, 1.02); head.add(h);
  },
  receding(head, m) {
    for (const s of [-1, 1]) { const h = sphere(0.06, m, { x: s * 0.095, y: 0.1, z: -0.03 }); h.scale.set(0.5, 0.9, 1.2); head.add(h); }
    const b = sphere(0.1, m, { y: 0.1, z: -0.07 }); b.scale.set(1.1, 0.8, 0.6); head.add(b);
  },
};

const PROPS = {
  notebook: (hand) => { const b = box(0.16, 0.22, 0.025, mat("#1d1d1f", 0.7), { y: -0.04, z: 0.06 }); b.rotation.x = -0.2; hand.add(b); },
  mug: (hand) => hand.add(mesh(new THREE.CylinderGeometry(0.04, 0.036, 0.1, 16), mat("#f4f4f4", 0.4), { y: 0.02, z: 0.05 })),
  tablet: (hand) => { const b = box(0.18, 0.25, 0.012, mat("#2b2d31", 0.4), { y: -0.03, z: 0.06 }); b.rotation.x = -0.25; hand.add(b); },
  laptop: (hand) => { const b = box(0.03, 0.24, 0.33, mat("#a3a8ae", 0.35, { metalness: 0.6 }), { x: -0.03, y: 0.02, z: 0.04 }); hand.add(b); },
  papers: (hand) => { const b = box(0.21, 0.28, 0.006, mat("#fafafa", 0.9), { y: -0.04, z: 0.06 }); b.rotation.x = -0.3; hand.add(b); },
  folder: (hand) => { const b = box(0.23, 0.31, 0.03, mat("#e8dfc7", 0.8), { y: -0.05, z: 0.06 }); b.rotation.x = -0.2; hand.add(b); },
};

// A person, feet at the origin, facing +z. Returns the joints the animation drives.
function makePerson(look = {}) {
  const skin = mat(look.skin ?? "#e2b796", 0.65);
  const shirt = mat(look.shirt ?? "#3d6fa5", 0.85);
  const trousers = mat(look.trousers ?? "#2d3340", 0.85);
  const shoes = mat("#1e1e20", 0.5);
  const hairM = mat(look.hair ?? "#3b2a1d", 0.9);
  const dark = mat("#1a1a1a", 0.5);
  const root = new THREE.Group();
  const body = joint(root);
  body.scale.setScalar(look.height ?? 1);
  const hips = joint(body, 0, 0.95, 0);
  const pelvis = sphere(0.17, trousers, { y: 0.02 });
  pelvis.scale.set(1.12 * (look.hipWidth ?? 1), 0.7, 0.78);
  hips.add(pelvis);

  const legs = [-1, 1].map((s) => {
    const hip = joint(hips, s * 0.095, 0, 0);
    hip.add(capsule(0.072, 0.36, trousers, { y: -0.22 }));
    const knee = joint(hip, 0, -0.45, 0);
    knee.add(capsule(0.06, 0.36, trousers, { y: -0.21 }));
    const foot = box(0.1, 0.07, 0.25, shoes, { y: -0.44, z: 0.05 });
    knee.add(foot);
    return { hip, knee };
  });

  const torso = joint(hips, 0, 0.04, 0);
  const chest = capsule(0.165, 0.34, shirt, { y: 0.3 });
  chest.scale.set(1.12 * (look.shoulders ?? 1), 1, 0.72);
  torso.add(chest);
  if (look.lanyard) {
    const l = box(0.012, 0.3, 0.01, mat(look.lanyard, 0.6), { y: 0.42, z: 0.122, shadow: false });
    torso.add(l);
    torso.add(box(0.07, 0.09, 0.008, mat("#f5f5f5", 0.6), { y: 0.26, z: 0.125, shadow: false }));
  }
  if (look.tie) torso.add(box(0.045, 0.3, 0.01, mat(look.tie, 0.6), { y: 0.42, z: 0.121, shadow: false }));
  if (look.jacket) {
    for (const s of [-1, 1]) {
      const lapel = box(0.1, 0.36, 0.02, mat(look.jacket, 0.8), { x: s * 0.085, y: 0.36, z: 0.115 });
      lapel.rotation.z = s * 0.12;
      torso.add(lapel);
    }
  }

  const arms = [-1, 1].map((s) => {
    const shoulder = joint(torso, s * 0.215, 0.5, 0);
    shoulder.rotation.z = s * 0.06;
    shoulder.add(capsule(0.053, 0.25, shirt, { y: -0.15 }));
    const elbow = joint(shoulder, 0, -0.3, 0);
    elbow.add(capsule(0.046, 0.22, look.sleeves === "short" ? skin : shirt, { y: -0.13 }));
    const hand = joint(elbow, 0, -0.28, 0);
    hand.add(sphere(0.048, skin));
    return { shoulder, elbow, hand, side: s };
  });
  const propArm = arms[1]; // the left hand (on the viewer's right) carries the prop
  if (look.prop && PROPS[look.prop]) PROPS[look.prop](propArm.hand);

  const neck = joint(torso, 0, 0.66, 0);
  neck.add(mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.1, 14), skin, { y: 0.03 }));
  const head = joint(neck, 0, 0.08, 0);
  const skull = sphere(0.115, skin, { y: 0.1 });
  skull.scale.set(0.9, 1.08, 1);
  head.add(skull);
  for (const s of [-1, 1]) head.add(sphere(0.025, skin, { x: s * 0.103, y: 0.095, z: 0 }));
  const nose = sphere(0.016, skin, { y: 0.088, z: 0.11 });
  nose.scale.set(0.8, 1.2, 1);
  head.add(nose);
  const eyes = [-1, 1].map((s) => {
    const white = sphere(0.019, mat("#f6f6f6", 0.3), { x: s * 0.042, y: 0.118, z: 0.098, shadow: false });
    white.scale.set(1, 0.8, 0.5);
    head.add(white);
    const pupil = sphere(0.011, dark, { x: s * 0.042, y: 0.118, z: 0.106, shadow: false });
    head.add(pupil);
    return [white, pupil];
  });
  const brows = [-1, 1].map((s) => {
    const b = box(0.04, 0.008, 0.01, hairM, { x: s * 0.043, y: 0.148, z: 0.106, shadow: false });
    b.rotation.z = s * -0.08;
    head.add(b);
    return b;
  });
  const mouth = sphere(0.026, mat("#7a3b38", 0.6), { y: 0.048, z: 0.098, shadow: false });
  mouth.scale.set(1, 0.18, 0.35);
  head.add(mouth);
  if (look.beard) {
    const b = sphere(0.1, hairM, { y: 0.045, z: 0.03 });
    b.scale.set(0.92, 0.6, 0.85);
    head.add(b);
    head.add(mouth); // drawn over the beard
  }
  (HAIR[look.hairStyle] ?? HAIR.short)(head, hairM);
  if (look.glasses) {
    const rim = mat(look.glasses, 0.3, { metalness: 0.4 });
    for (const s of [-1, 1]) {
      const r = mesh(new THREE.TorusGeometry(0.026, 0.004, 8, 20), rim, { x: s * 0.042, y: 0.118, z: 0.112, shadow: false });
      head.add(r);
    }
    head.add(box(0.03, 0.004, 0.004, rim, { y: 0.122, z: 0.114, shadow: false }));
  }

  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, body, hips, torso, legs, arms, propArm, neck, head, eyes, brows, mouth, hasProp: Boolean(look.prop) };
}

// Seated people at the other desks, typing; they move a little so the room feels alive.
function seat(p) {
  p.hips.position.y = 0.52;
  for (const { hip, knee } of p.legs) { hip.rotation.x = -1.45; knee.rotation.x = 1.45; }
  for (const a of p.arms) { a.shoulder.rotation.x = -0.75; a.elbow.rotation.x = -0.75; }
}

// ---------- animation ----------

function animatePerson(p, t, dt, st) {
  const { walking, phase, speaking, level, youTalking, lookYaw } = st;
  const breath = Math.sin(t * 1.7);
  if (walking) {
    const s = Math.sin(phase);
    p.legs[0].hip.rotation.x = -s * 0.45;
    p.legs[1].hip.rotation.x = s * 0.45;
    p.legs[0].knee.rotation.x = 0.1 + Math.max(0, Math.cos(phase)) * 0.75;
    p.legs[1].knee.rotation.x = 0.1 + Math.max(0, -Math.cos(phase)) * 0.75;
    p.hips.position.y = 0.94 + Math.abs(Math.cos(phase)) * 0.025;
    p.hips.position.x = Math.sin(phase) * 0.012;
    p.torso.rotation.y = s * 0.07;
    p.torso.rotation.x = 0.04;
    for (const a of p.arms) {
      if (a === p.propArm && p.hasProp) { a.shoulder.rotation.x = -0.35; a.elbow.rotation.x = -1.25; continue; }
      a.shoulder.rotation.x = s * 0.4 * a.side * -1;
      a.elbow.rotation.x = -0.25 - Math.max(0, s * a.side * -1) * 0.25;
      a.shoulder.rotation.z = a.side * 0.06;
    }
    p.neck.rotation.x = 0;
  } else {
    // Standing: weight shifts, breathing, and the free arm talks with them.
    for (const [i, { hip, knee }] of p.legs.entries()) {
      hip.rotation.x = damp(hip.rotation.x, 0, 8, dt);
      knee.rotation.x = damp(knee.rotation.x, i === 0 ? 0.05 : 0.02, 8, dt);
    }
    p.hips.position.y = damp(p.hips.position.y, 0.945, 6, dt);
    p.hips.position.x = Math.sin(t * 0.45) * 0.012;
    p.hips.rotation.z = Math.sin(t * 0.45) * 0.015;
    p.torso.rotation.y = damp(p.torso.rotation.y, 0, 4, dt);
    p.torso.rotation.x = 0.01 + breath * 0.006;
    p.torso.scale.y = 1 + breath * 0.006;
    for (const a of p.arms) {
      let sx = 0.04, ex = -0.12, sz = a.side * 0.07;
      if (a === p.propArm && p.hasProp) { sx = -0.35; ex = -1.3; }
      else if (speaking) {
        // Talking with the hand: lifts and opens in a slow rhythm, more with a louder voice.
        const g = 0.5 + 0.5 * Math.sin(t * 2.1 + a.side);
        sx = -0.45 - g * 0.45 * (0.5 + level);
        ex = -1.05 - 0.25 * Math.sin(t * 3.3);
        sz = a.side * (0.12 + 0.12 * g);
      }
      a.shoulder.rotation.x = damp(a.shoulder.rotation.x, sx, 5, dt);
      a.elbow.rotation.x = damp(a.elbow.rotation.x, ex, 5, dt);
      a.shoulder.rotation.z = damp(a.shoulder.rotation.z, sz, 5, dt);
    }
  }
  // Head: looks at you (lookYaw), nods while talking and while you talk.
  const nod = speaking ? Math.sin(t * 4.2) * 0.04 * (0.4 + level) : youTalking ? Math.max(0, Math.sin(t * 2.2)) * 0.07 : 0;
  p.head.rotation.x = damp(p.head.rotation.x, -0.08 + nod, 8, dt);
  p.head.rotation.y = damp(p.head.rotation.y, (lookYaw ?? 0) + Math.sin(t * 0.37) * 0.05, 4, dt);
  p.head.rotation.z = damp(p.head.rotation.z, speaking ? Math.sin(t * 1.3) * 0.04 : youTalking ? 0.06 : 0, 3, dt);
  // Mouth follows the voice; brows lift with it; eyes blink every few seconds.
  const open = speaking ? 0.18 + Math.min(1, level * 2.4) * 0.9 : 0.18;
  p.mouth.scale.y = damp(p.mouth.scale.y, open, 25, dt);
  for (const b of p.brows) b.position.y = damp(b.position.y, 0.148 + (speaking ? level * 0.012 : 0), 10, dt);
  const blink = (t % 4.3) < 0.13 ? 0.1 : 1;
  for (const [white, pupil] of p.eyes) { white.scale.y = 0.8 * blink; pupil.scale.y = blink; }
}

// ---------- the scene ----------

export function createOffice3D(container, { speaking = () => false, level = () => 0, youTalking = () => false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#dfe6ec");
  scene.fog = new THREE.Fog("#dfe6ec", 12, 24);
  const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.05, 40);
  camera.rotation.order = "YXZ";
  camera.position.copy(SEAT);

  scene.add(new THREE.HemisphereLight("#f3f6ff", "#8a8070", 1.1));
  const sun = new THREE.DirectionalLight("#fff3e0", 2.2);
  sun.position.set(-9, 6, -2);
  sun.target.position.set(1, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const fill = new THREE.PointLight("#ffffff", 6, 9, 1.6);
  fill.position.set(0.8, 2.7, -0.8);
  scene.add(fill);

  const desks = buildOffice(scene);
  buildMyDesk(scene);

  // Colleagues at the other desks, working.
  const workers = [];
  const workerLooks = [
    { shirt: "#6c7a89", hair: "#2b1d14", skin: "#e1b48e" },
    { shirt: "#b5651d", hair: "#c9a26b", hairStyle: "long", skin: "#f0c9a7" },
    { shirt: "#2f4858", hair: "#111", hairStyle: "curly", skin: "#8d5b3e" },
    { shirt: "#7b2cbf", hair: "#5a3a22", hairStyle: "bun", skin: "#f1c5a5" },
  ];
  [desks[1], desks[2], desks[3], desks[6]].forEach((d, i) => {
    const p = makePerson(workerLooks[i]);
    seat(p);
    p.root.position.set(d.position.x, 0, d.position.z + 0.58);
    p.root.rotation.y = Math.PI; // facing their monitor
    scene.add(p.root);
    workers.push(p);
  });

  // The colleague who comes over (one at a time).
  let visitor = null; // { p, path, dist, total, state: "in" | "here" | "out", phase, resolve }
  let look = { ...LAPTOP_LOOK };
  let lookTarget = { ...LAPTOP_LOOK };
  let turnFrom = null; // { from, to, start, dur } while turning

  function pathLength(path) {
    let len = 0;
    for (let i = 1; i < path.length; i++) len += path[i].distanceTo(path[i - 1]);
    return len;
  }
  function pointAt(path, d) {
    for (let i = 1; i < path.length; i++) {
      const seg = path[i].distanceTo(path[i - 1]);
      if (d <= seg) return { pos: path[i - 1].clone().lerp(path[i], d / seg), dir: path[i].clone().sub(path[i - 1]).normalize() };
      d -= seg;
    }
    return { pos: path.at(-1).clone(), dir: path.at(-1).clone().sub(path.at(-2)).normalize() };
  }
  function turnTo(target, dur = 1.1) {
    turnFrom = { from: { ...look }, to: target, start: clock.elapsedTime, dur };
    lookTarget = target;
  }
  // Where to look to see a person's face at position pos.
  function faceLook(pos) {
    const head = new THREE.Vector3(pos.x, 1.42, pos.z); // between face and chest, as you'd look at someone
    const d = head.sub(SEAT);
    return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
  }

  const clock = new THREE.Clock();
  let running = true;
  function resize() {
    const w = container.clientWidth || 640;
    const h = container.clientHeight || 360;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const talking = Boolean(speaking());
    const lvl = talking ? level() : 0;
    const you = Boolean(youTalking());

    for (const [i, w] of workers.entries()) {
      animatePerson(w, t + i, dt, { walking: false, speaking: false, level: 0, lookYaw: Math.sin(t * 0.3 + i * 2) * 0.25 });
      seat(w); // typing at their desk
      for (const a of w.arms) a.elbow.rotation.x = -0.75 + Math.sin(t * 9 + i + a.side) * 0.04;
    }

    if (visitor) {
      const v = visitor;
      if (v.state === "in" || v.state === "out") {
        v.dist = Math.min(v.total, v.dist + WALK_SPEED * dt);
        v.phase += dt * WALK_SPEED * 5.2;
        const { pos, dir } = pointAt(v.path, v.dist);
        v.p.root.position.copy(pos);
        v.p.root.rotation.y = damp(v.p.root.rotation.y, Math.atan2(dir.x, dir.z), 7, dt);
        const left = v.total - v.dist;
        if (v.state === "in" && left < TURN_WITHIN && !v.noticed) { v.noticed = true; turnTo(faceLook(STAND), 1.2); }
        if (v.state === "out" && v.dist > 2.2 && !v.turnedBack) { v.turnedBack = true; turnTo(LAPTOP_LOOK, 1.3); }
        if (v.dist >= v.total) {
          if (v.state === "in") { v.state = "here"; v.resolve?.(); }
          else { scene.remove(v.p.root); visitor = null; }
        }
      } else {
        // At your desk: turn to face you.
        const toYou = Math.atan2(SEAT.x - v.p.root.position.x, SEAT.z - v.p.root.position.z);
        v.p.root.rotation.y = damp(v.p.root.rotation.y, toYou, 4, dt);
      }
      if (visitor) {
        animatePerson(v.p, t, dt, { walking: v.state !== "here", phase: v.phase, speaking: v.state === "here" && talking, level: lvl, youTalking: v.state === "here" && you, lookYaw: 0 });
      }
    }

    // Your view: turning between the laptop and the visitor, plus a little life (breathing,
    // tiny head movements), and following the visitor's face while they are here.
    if (turnFrom) {
      const k = ease((t - turnFrom.start) / turnFrom.dur);
      look.yaw = turnFrom.from.yaw + (turnFrom.to.yaw - turnFrom.from.yaw) * k;
      look.pitch = turnFrom.from.pitch + (turnFrom.to.pitch - turnFrom.from.pitch) * k;
      if (k >= 1) turnFrom = null;
    } else if (visitor && visitor.noticed && !visitor.turnedBack) {
      const f = faceLook(visitor.p.root.position);
      look.yaw = damp(look.yaw, f.yaw, 2, dt);
      look.pitch = damp(look.pitch, f.pitch, 2, dt);
    } else {
      look.yaw = damp(look.yaw, lookTarget.yaw, 2, dt);
      look.pitch = damp(look.pitch, lookTarget.pitch, 2, dt);
    }
    camera.rotation.y = look.yaw + Math.sin(t * 0.23) * 0.008;
    camera.rotation.x = look.pitch + Math.sin(t * 1.7) * 0.003;
    camera.position.y = SEAT.y + Math.sin(t * 1.7) * 0.004;
    renderer.render(scene, camera);
  }
  frame();

  return {
    // A colleague walks in; resolves when they are standing at your desk.
    enter(look) {
      if (visitor) { scene.remove(visitor.p.root); visitor = null; }
      const p = makePerson(look);
      scene.add(p.root);
      const path = PATH_IN.map((v) => v.clone());
      return new Promise((resolve) => {
        visitor = { p, path, dist: 0, total: pathLength(path), state: "in", phase: 0, resolve, noticed: false, turnedBack: false };
      });
    },
    // They walk back out; your view turns back to the laptop on the way.
    leave() {
      if (!visitor) return;
      const path = [...PATH_IN].reverse().map((v) => v.clone());
      Object.assign(visitor, { path, dist: 0, total: pathLength(path), state: "out", turnedBack: false });
    },
    get busy() { return Boolean(visitor); },
    dispose() {
      running = false;
      ro.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
