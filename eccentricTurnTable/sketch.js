// ===== File Preparation =====
// Place song1.mp3 ~ song4.mp3, album1.jpg ~ album4.jpg in the same folder.

// ── Serial
let port, reader, buffer = "";
let latestData = { pot: 0, motor: 0, light: 0, lightAvg: 0, delta: 0 };

// ── Sound/Playback
let songs = [];
let currentSong = 0;   // UI default display
let mainSong = 0;      // Main track
let isPlaying = false;
let playbackRate = 1.0;

// ── Light Sensor
let lightBaseline = 0;
let calibrated = false;
let autoCalibrationDone = false;
const lightHistory = [];
const lightHistorySize = 30; // ~1.5s
const eccentricThreshold = 80;

// ── Eccentric Control
let eccentricMode = false;      // Screen/visual flag
let eccentricLocked = false;    // Continuous eccentric lock
let eccentricTimer = 0;         // UI counter
let currentEccentricSongIndex = null;
let isSelfMixing = false;

// ── Eccentric Rotation/Sections
let nextEccentricIndex = 0;           // 0,1,2,3 fair rotation
let eccentricOffsetsSec = [0,0,0,0];  // Resume offset for each song
let hopTimeoutId = null;              // Hop timer
let scratchIntervalId = null;         // Scratch loop timer

// ── Effects
let noise, noiseFilter;
let reverb, distortion, hpFilter;

// ── Visualization
let albumImages = [];
let currentAlbumSize = 400;
let particles = [];

// ── Song Metadata
const songInfo = [
  { title: "Just Give Me a Reason", artist: "P!nk ft. Nate Ruess", color: [255,20,147],  bgColor: [40,10,25] },
  { title: "APT.",                   artist: "ROSÉ & Bruno Mars",  color: [255,0,100],   bgColor: [40,0,20] },
  { title: "Around Thirty",          artist: "Kim Kwang Seok",     color: [70,130,180],  bgColor: [10,20,30] },
  { title: "Everglow",               artist: "Coldplay",           color: [138,43,226],  bgColor: [20,10,40] }
];

function preload() {
  // Music
  songs[0] = loadSound('song1.mp3');
  songs[1] = loadSound('song2.mp3');
  songs[2] = loadSound('song3.mp3');
  songs[3] = loadSound('song4.mp3');
  // Albums
  albumImages[0] = loadImage('album1.jpg');
  albumImages[1] = loadImage('album2.jpg');
  albumImages[2] = loadImage('album3.jpg');
  albumImages[3] = loadImage('album4.jpg');
}

function setup() {
  createCanvas(windowWidth, windowHeight);

  // Buttons
  createBtn("🔌 Connect Arduino", 30, 30, connectSerial);
  createBtn("▶ Play/Pause", 30, 70, toggleMusic);
  createBtn("📍 Calibrate Light Sensor", 30, 110, calibrateLight);
  createBtn("🎭 Lock Eccentric (Test)", 30, 150, () => { if (!eccentricLocked) { eccentricLocked = true; startContinuousEccentric(); }});
  createBtn("⏹ Stop Eccentric", 30, 190, stopEccentricCompletely);

  // Particles
  for (let i = 0; i < 36; i++) particles.push(new Particle());

  // Effects setup
  noise = new p5.Noise('white');
  noiseFilter = new p5.BandPass();
  noise.disconnect(); noise.connect(noiseFilter);
  noiseFilter.freq(2800); noiseFilter.res(6);
  noise.amp(0);

  reverb = new p5.Reverb();
  distortion = new p5.Distortion(0.08);
  hpFilter = new p5.HighPass();
  hpFilter.freq(80); // Clean up low frequencies

  // Connect all songs to high-pass filter
  for (let s of songs) s && s.disconnect();
  for (let s of songs) s && s.connect(hpFilter);
  // Subtle reverb for main/eccentric tracks
  reverb.process(hpFilter, 2.5, 0.2);
}

function createBtn(label, x, y, handler) {
  const b = createButton(label);
  b.position(x, y);
  b.mousePressed(handler);
  return b;
}

// ── Serial
async function connectSerial() {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    const textDecoder = new TextDecoderStream();
    port.readable.pipeTo(textDecoder.writable);
    reader = textDecoder.readable.getReader();
    readLoop();
    console.log("Arduino connected!");
  } catch (err) {
    console.error("Connection failed:", err);
  }
}

async function readLoop() {
  while (true) {
    try {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) handleSerialData(value);
    } catch (err) {
      console.error("Read error:", err);
      break;
    }
  }
}

function handleSerialData(data) {
  buffer += data;
  const lines = buffer.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim();
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        latestData = JSON.parse(line);
        processArduinoData();
      } catch (e) { console.log('Parse error:', e); }
    }
  }
  buffer = lines[lines.length - 1];
}

// ── Main Logic
function processArduinoData() {
  // Speed mapping
  if (latestData.pot <= 600) playbackRate = map(latestData.pot, 10, 600, 0.1, 1.0);
  else                        playbackRate = map(latestData.pot, 600, 1023, 1.0, 2.0);

  // Play/Stop
  if (latestData.pot <= 30) {
    if (isPlaying) { isPlaying = false; songs[mainSong]?.pause(); }
    if (eccentricLocked) stopEccentricCompletely();
  } else {
    if (!isPlaying) { isPlaying = true; songs[mainSong]?.loop(); }
  }

  // Light average
  lightHistory.push(latestData.light);
  if (lightHistory.length > lightHistorySize) lightHistory.shift();

  let currentAvgLight = 0;
  if (lightHistory.length > 0) {
    const sum = lightHistory.reduce((a,b)=>a+b,0);
    currentAvgLight = sum / lightHistory.length;
  }

  // Auto calibration
  if (!autoCalibrationDone && lightHistory.length >= lightHistorySize) {
    lightBaseline = currentAvgLight;
    autoCalibrationDone = true; calibrated = true;
    console.log("Auto-calibrated @", lightBaseline.toFixed(1));
  }

  // Enter continuous eccentric mode
  if (calibrated && isPlaying && !eccentricLocked) {
    const avgDelta = Math.abs(currentAvgLight - lightBaseline);
    if (avgDelta > eccentricThreshold) {
      eccentricLocked = true;
      startContinuousEccentric();
    }
  }

  // Apply main track speed
  if (songs[mainSong]?.isPlaying()) songs[mainSong].rate(playbackRate);
}

function calibrateLight() {
  if (lightHistory.length > 0) {
    const sum = lightHistory.reduce((a,b)=>a+b,0);
    lightBaseline = sum / lightHistory.length;
  } else {
    lightBaseline = latestData.light;
  }
  calibrated = true;
  console.log("Light calibrated @", lightBaseline.toFixed(1));
}

// ── Display Index
function getDisplaySongIndex() {
  return (eccentricLocked && currentEccentricSongIndex !== null) ? currentEccentricSongIndex : currentSong;
}

// ── Start/Stop Continuous Eccentric
function startContinuousEccentric() {
  if (!isPlaying || latestData.pot <= 30) return;
  if (hopTimeoutId) return; // Already running, ignore
  eccentricMode = true;     // Visual flag ON
  startScratchLoop();       // Start scratch/noise loop
  doOneEccentricHop();      // First hop
}

function stopEccentricCompletely() {
  if (hopTimeoutId) { clearTimeout(hopTimeoutId); hopTimeoutId = null; }
  stopScratchLoop();
  if (!isSelfMixing && currentEccentricSongIndex !== null) songs[currentEccentricSongIndex]?.stop();
  if (isSelfMixing) songs[mainSong]?.rate?.(playbackRate);

  currentEccentricSongIndex = null;
  isSelfMixing = false;
  eccentricLocked = false;
  eccentricMode = false;
  eccentricTimer = 0;
  currentSong = mainSong;
  noise?.amp(0, 0.08);
  console.log("Eccentric stopped.");
}

// ── Single Hop (immediately schedule next hop after completion)
function doOneEccentricHop() {
  if (!eccentricLocked || !isPlaying || latestData.pot <= 30) { stopEccentricCompletely(); return; }

  // Keep strong visual effect: don't turn off eccentricMode in the middle
  eccentricMode = true;

  // Detour duration (inversely proportional to speed)
  const baseMs = 2000;
  const rate = constrain(playbackRate || 1.0, 0.1, 3.0);
  let detourMs = Math.round(baseMs / rate);
  detourMs = constrain(detourMs, 500, 2800);
  const detourSec = detourMs / 1000;

  // UI timer (just decoration)
  eccentricTimer = Math.floor(detourMs / (1000 / 60));

  // Next target track
  const tempSong = nextEccentricIndex;
  nextEccentricIndex = (nextEccentricIndex + 1) % songInfo.length;

  // Display
  currentSong = tempSong;
  currentEccentricSongIndex = tempSong;
  isSelfMixing = (tempSong === mainSong);

  // Particle explosion
  for (let p of particles) p.explode();

  // Self-mix
  if (isSelfMixing && songs[mainSong]) {
    const dur = songs[mainSong].duration ? songs[mainSong].duration() : null;
    const t0  = songs[mainSong].currentTime ? songs[mainSong].currentTime() : 0;
    let startSec = eccentricOffsetsSec[mainSong] || 0;
    if (dur && dur > 0) startSec = startSec % Math.max(dur - 0.05, 0.05);

    songs[mainSong].rate?.(rate * random(0.85, 1.15));
    if (songs[mainSong].jump && typeof startSec === 'number') songs[mainSong].jump(startSec);

    // After hop ends, immediately schedule next hop (0ms) — eliminate gaps
    hopTimeoutId = setTimeout(() => {
      hopTimeoutId = null;
      eccentricOffsetsSec[mainSong] = (eccentricOffsetsSec[mainSong] || 0) + detourSec;

      songs[mainSong].rate?.(playbackRate);
      if (songs[mainSong].jump && typeof t0 === 'number') songs[mainSong].jump(t0 + detourSec);

      currentEccentricSongIndex = null;
      isSelfMixing = false;

      // Next hop immediately
      hopTimeoutId = setTimeout(() => { hopTimeoutId = null; doOneEccentricHop(); }, 0);
    }, detourMs);

    return;
  }

  // Hop to different song
  if (songs.length > 0 && songs[mainSong]) {
    const mainT0 = songs[mainSong].currentTime ? songs[mainSong].currentTime() : 0;
    songs[mainSong].pause?.();

    if (songs[tempSong]) {
      const dur = songs[tempSong].duration ? songs[tempSong].duration() : null;
      let startSec = eccentricOffsetsSec[tempSong] || 0;
      if (dur && dur > 0) startSec = startSec % Math.max(dur - 0.05, 0.05);

      songs[tempSong].play?.();
      // Slight distortion for scratchy feel
      songs[tempSong].rate?.(rate * random(0.9, 1.2));
      if (songs[tempSong].jump && typeof startSec === 'number') songs[tempSong].jump(startSec);

      hopTimeoutId = setTimeout(() => {
        hopTimeoutId = null;
        eccentricOffsetsSec[tempSong] = (eccentricOffsetsSec[tempSong] || 0) + detourSec;

        songs[tempSong].stop?.();
        songs[mainSong].play?.();
        if (songs[mainSong].jump && typeof mainT0 === 'number') songs[mainSong].jump(mainT0 + detourSec);
        songs[mainSong].rate?.(playbackRate);

        currentEccentricSongIndex = null;

        // Immediately next hop
        hopTimeoutId = setTimeout(() => { hopTimeoutId = null; doOneEccentricHop(); }, 0);
      }, detourMs);
    }
  } else {
    // No source available, maintain visual effect and immediately next hop
    hopTimeoutId = setTimeout(() => { hopTimeoutId = null; doOneEccentricHop(); }, 0);
  }
}

// ── Scratch/Noise Loop
function startScratchLoop() {
  if (scratchIntervalId) return;
  noise?.start();
  noise?.amp(0.0);

  scratchIntervalId = setInterval(() => {
    if (!eccentricLocked) return;

    // Target file: eccentric track if active, otherwise main
    let target = (currentEccentricSongIndex !== null && songs[currentEccentricSongIndex])
                  ? songs[currentEccentricSongIndex]
                  : songs[mainSong];
    if (!target) return;

    // Short scratch: rate fluctuation + small jump
    try {
      const base = constrain(playbackRate || 1.0, 0.1, 2.0);
      const r = base * random(0.65, 1.35);
      target.rate(r);
      if (target.currentTime && target.jump) {
        const t = target.currentTime();
        const jitter = random([-0.06, -0.03, 0.03, 0.06]);
        let jumpTo = max(0.02, t + jitter);
        target.jump(jumpTo);
      }
    } catch(e){}

    // Noise gate: slightly open then close
    const nv = random(0.02, 0.06);
    noise?.amp(nv, 0.02);
    setTimeout(()=> noise?.amp(0, 0.06), 90);

    // Occasionally add more distortion
    if (random() < 0.25) {
      distortion?.set(random(0.05, 0.14));
      setTimeout(()=> distortion?.set(0.08), 160);
    }
  }, 120); // Scratch every 120ms
}

function stopScratchLoop() {
  if (scratchIntervalId) {
    clearInterval(scratchIntervalId);
    scratchIntervalId = null;
  }
  noise?.amp(0, 0.1);
}

// ── Manual Test
function toggleMusic() {
  isPlaying = !isPlaying;
  if (songs[mainSong]) {
    if (isPlaying) songs[mainSong].loop();
    else           songs[mainSong].pause();
  }
  if (!isPlaying && eccentricLocked) stopEccentricCompletely();
}

// ── Rendering
function draw() {
  const dispIdx = getDisplaySongIndex();
  const bgCol = songInfo[dispIdx].bgColor;
  background(bgCol[0], bgCol[1], bgCol[2]);

  // Eccentric visuals: scanlines + pulse
  if (eccentricLocked) {
    for (let i = 0; i < 6; i++) {
      fill(random(255), random(255), random(255), 28);
      noStroke();
      rect(random(width), random(height), random(width), random(3, 18));
    }
    push();
    translate(width/2, height/2);
    noFill();
    stroke(255, 25);
    const rad = 180 + 8 * sin(frameCount * 0.3);
    ellipse(0, 0, rad*2);
    pop();
  }

  // Center album
  push();
  translate(width/2, height/2);
  if (eccentricLocked) {
    // Strong vibration without gaps
    const jitter = 26;
    translate(random(-jitter, jitter), random(-jitter, jitter));
    rotate(radians(random(-0.6, 0.6)));
  }
  drawAlbumArt(dispIdx);
  pop();

  // Particles
  for (let p of particles) { p.update(); p.display(dispIdx); }

  drawUI(dispIdx);
  drawMusicInfo(dispIdx);

  // UI timer (decoration)
  if (eccentricTimer > 0) {
    eccentricTimer--;
  }
}

function drawAlbumArt(idx) {
  const col = songInfo[idx].color;
  noStroke();
  fill(0,0,0,100);
  rect(15, 15, currentAlbumSize, currentAlbumSize, 10);

  fill(col[0], col[1], col[2]);
  stroke(255);
  strokeWeight(4);
  rect(0, 0, currentAlbumSize, currentAlbumSize, 10);

  if (albumImages[idx]) {
    image(albumImages[idx], 0, 0, currentAlbumSize, currentAlbumSize);
  } else {
    fill(255,255,255,210);
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(40);
    text(songInfo[idx].artist.split(' ')[0], 0, -50);
    textSize(20);
    text(songInfo[idx].title, 0, 50);
    stroke(255,255,255,50);
    strokeWeight(2);
    noFill();
    ellipse(0,0,currentAlbumSize*0.8);
    ellipse(0,0,currentAlbumSize*0.6);
  }

  // Glitch bars
  if (eccentricLocked && frameCount % 2 === 0) {
    for (let i = 0; i < 3; i++) {
      let y = random(-currentAlbumSize/2, currentAlbumSize/2);
      fill(255, 200, random(200,255), random(110, 200));
      noStroke();
      rect(-currentAlbumSize/2, y, currentAlbumSize, random(2, 10));
    }
  }
}

function drawUI(idx) {
  fill(0,0,0,200);
  noStroke();
  rect(30, height - 310, 380, 290, 15);

  fill(255);
  textAlign(LEFT);
  textSize(18);
  text("ECCENTRIC TURNTABLE", 50, height - 280);

  textSize(14);
  fill(200);
  text("Speed: " + playbackRate.toFixed(2) + "x", 50, height - 250);
  text("Pot Value: " + latestData.pot.toFixed(0), 50, height - 230);
  text("Mode: " + (eccentricLocked ? "ECCENTRIC (continuous)" : "CENTRIC"), 50, height - 210);

  // Light
  let currentAvg = 0;
  if (lightHistory.length > 0) {
    const sum = lightHistory.reduce((a,b)=>a+b,0);
    currentAvg = sum / lightHistory.length;
  }
  text("Light (raw): " + latestData.light.toFixed(0), 50, height - 185);
  text("Light (avg): " + currentAvg.toFixed(0) + " | Base: " + lightBaseline.toFixed(0), 50, height - 165);
  text("Delta: " + Math.abs(currentAvg - lightBaseline).toFixed(0), 50, height - 145);

  // Status
  textSize(16);
  if (latestData.pot <= 30) {
    fill(150);
    text("⏸ STOPPED — knob ≤ 30", 50, height - 110);
  } else if (eccentricLocked) {
    fill(255,100,120);
    text("🔴 CONTINUOUS ECCENTRIC — Now: " + songInfo[idx].title, 50, height - 110);
  } else {
    fill(100,255,150);
    text("🟢 CENTRIC — Playing at " + playbackRate.toFixed(1) + "x", 50, height - 110);
  }

  if (!calibrated) {
    fill(255,255,120);
    text("⚠ Calibrate light sensor before test", 50, height - 80);
  }

  // Poetic text
  if (eccentricLocked) {
    fill(255, 200);
    textSize(12);
    const lines = [
      "needle drifts / vinyl breathes",
      "a pink spark, a midnight bruise",
      "scratches become syllables",
      "turn, turn — the room remembers"
    ];
    text(lines[floor((frameCount/30)%lines.length)], 50, height - 55);
  }
}

function drawMusicInfo(idx) {
  fill(0,0,0,200);
  noStroke();
  rect(width/2 - 240, 30, 480, 120, 15);

  fill(255);
  textAlign(CENTER);
  textSize(26);
  text(songInfo[idx].title, width/2, 68);

  textSize(18);
  fill(200);
  text(songInfo[idx].artist, width/2, 98);

  if (eccentricLocked) {
    fill(255,120,140);
    textSize(14);
    text("🎭 CONTINUOUS REMIX — no silence, just motion", width/2, 120);
  }
}

// ── Particle
class Particle {
  constructor() { this.reset(); }
  reset() {
    const angle = random(TWO_PI);
    const dist = random(220, 280);
    this.x = width/2 + cos(angle)*dist;
    this.y = height/2 + sin(angle)*dist;
    this.vx = 0; this.vy = 0;
    this.size = random(2,4);
    this.alpha = 0;
  }
  explode() {
    const angle = atan2(this.y - height/2, this.x - width/2);
    const force = random(8,22);
    this.vx = cos(angle)*force;
    this.vy = sin(angle)*force;
    this.alpha = 255;
  }
  update() {
    this.x += this.vx; this.y += this.vy;
    this.vx *= 0.93; this.vy *= 0.93;
    this.alpha *= 0.95;
    if (this.alpha < 5) this.reset();
  }
  display(idx) {
    if (this.alpha > 5) {
      const col = songInfo[idx].color;
      noStroke();
      fill(col[0], col[1], col[2], this.alpha);
      ellipse(this.x, this.y, this.size*2);
    }
  }
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }