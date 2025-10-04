// ===== Existing variables =====
let utterance;
let isSpeaking = false;
let currentWordIndex = -1;
let words = [];
let scrollOffset = 0;
let maxScroll = 0;
let contentHeight = 0;
let wordPositions = [];

// Arduino sensor variables
let port;
let reader;
let photo1Value = 0;
let photo2Value = 0;
let fsrValue = 0;

// For hand detection
let photo1Baseline = 1020;
let photo2Baseline = 1020;
let baselineSet = false;
let sensitivityThreshold = 50;
let handDetected = false;

// Hand shadow animation
let handX = 0;
let handY = 0;
let targetHandX = 0;
let targetHandY = 0;

// Hand left right position
let handRatio = 0.5;
let handRatioSmooth = 0.5;

// ====== FSR based effect variables ======
let fsrLevelSmooth = 0; 
const FSR_MIN_ACTIVE = 300;   // Setting to 300 considering default value of 109
const FSR_MAX_ACTIVE = 700;  

// ====== New 3D effect variables ======
let isLifting = false;
let liftedWordIndex = -1;
let liftedWord = "";
let liftAmount = 0;
let liftTargetAmount = 0;
let fsrPressed = false;
let lastPhotoAvg = 1020;
let liftStartPhotoAvg = 0;

const textToRead = "What is Experience Prototyping? First, let's think for a moment about what we mean by experience. Experience is a very dynamic, complex and subjective phenomenon. It depends upon the perception of multiple sensory qualities of a design, interpreted through filters relating to contextual factors. For example, what is the experience of a run down a mountain on a snowboard? It depends upon the weight and material qualities of the board, the bindings and your boots, the snow conditions, the weather, the terrain, the temperature of air in your hair, your skill level, your current state of mind, the mood and expression of your companions. The experience of even simple artifacts does not exist in a vacuum but, rather, in dynamic relationship with other people, places and objects. Additionally, the quality of people's experience changes over time as it is influenced by variations in these multiple contextual factors. With respect to prototyping, our understanding of experience is close to what Houde and Hill call the look and feel of a product or system, that is the concrete sensory experience of using an artifact — what the user looks at, feels and hears while using it.";

// Button styling function
function styleButton(btn, bgColor, textColor = "#2c3e50") {
  btn.style('padding', '12px 24px');
  btn.style('font-size', '15px');
  btn.style('font-family', 'Arial, sans-serif');
  btn.style('border', '1px solid #ccc');
  btn.style('border-radius', '6px');
  btn.style('cursor', 'pointer');
  btn.style('background-color', bgColor);
  btn.style('color', textColor);
  btn.style('box-shadow', '0 2px 4px rgba(0,0,0,0.08)');
  btn.mouseOver(() => btn.style('background-color', '#e0e0dc'));
  btn.mouseOut(() => btn.style('background-color', bgColor));
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  textSize(16);
  textAlign(CENTER, CENTER);

  words = textToRead.split(' ');

  // Connect button
  let connectButton = createButton("🔌 Connect Arduino");
  connectButton.position(width - 250, 20);
  styleButton(connectButton, "#f0f0ed");
  connectButton.mousePressed(initSerial);

  // Start button
  let startButton = createButton("▶ Start Lecture");
  startButton.position(50, height - 70);
  styleButton(startButton, "#e8e8e4");
  startButton.mousePressed(startReading);

  // Stop button
  let stopButton = createButton("■ Stop");
  stopButton.position(220, height - 70);
  styleButton(stopButton, "#dcdcd7");
  stopButton.mousePressed(stopReading);

  // Speech Synthesis settings
  utterance = new SpeechSynthesisUtterance(textToRead);
  utterance.rate = 0.9;
  utterance.pitch = 1.05;
  utterance.volume = 1.0;
  utterance.lang = 'en-US';

  setTimeout(() => {
    let voices = speechSynthesis.getVoices();
    let preferredVoice = voices.find(voice => 
      voice.lang === 'en-US' && 
      (voice.name.includes('Google') || 
       voice.name.includes('Natural') ||
       voice.name.includes('Premium') ||
       voice.name.includes('Enhanced') ||
       voice.name.includes('Samantha') ||
       voice.name.includes('Alex'))
    );
    if (preferredVoice) utterance.voice = preferredVoice;
  }, 100);

  utterance.onstart = () => { isSpeaking = true; currentWordIndex = 0; };
  utterance.onend = () => { isSpeaking = false; currentWordIndex = -1; };
  utterance.onboundary = (event) => {
    if (event.name === 'word' && !fsrPressed) { // Stop progression when FSR is pressed
      let charIndex = event.charIndex;
      let textSoFar = textToRead.substring(0, charIndex);
      currentWordIndex = textSoFar.split(' ').length - 1;
    }
  };
}

async function initSerial() {
  port = await navigator.serial.requestPort();
  await port.open({ baudRate: 9600 });
  reader = port.readable.getReader();
  readSerial();
}

async function readSerial() {
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      let text = new TextDecoder().decode(value);
      buffer += text;
      let startIdx = buffer.indexOf('<');
      let endIdx = buffer.indexOf('>');
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        let frame = buffer.substring(startIdx + 1, endIdx);
        parseData(frame);
        buffer = buffer.substring(endIdx + 1);
      }
      if (buffer.length > 200) buffer = '';
    }
  }
}

function parseData(frame) {
  let parts = frame.split(',');
  for (let part of parts) {
    let keyValue = part.split(':');
    if (keyValue.length === 2) {
      let key = keyValue[0].trim();
      let value = parseInt(keyValue[1].trim());
      if (key === 'FSR') fsrValue = value;
      else if (key === 'P1') photo1Value = value;
      else if (key === 'P2') photo2Value = value;
    }
  }
  
  if (!baselineSet && photo1Value > 1000 && photo2Value > 1000) {
    photo1Baseline = photo1Value;
    photo2Baseline = photo2Value;
    baselineSet = true;
  }
  
  // FSR detection logic
  const currentPhotoAvg = (photo1Value + photo2Value) / 2;
  
  if (fsrValue > FSR_MIN_ACTIVE) {
    if (!fsrPressed) {
      // When FSR is first pressed
      fsrPressed = true;
      liftStartPhotoAvg = currentPhotoAvg;
      if (isSpeaking) {
        speechSynthesis.pause();
      }
      // Store the current word
      if (currentWordIndex >= 0) {
        liftedWordIndex = currentWordIndex;
        liftedWord = words[currentWordIndex];
      }
    }
    
    // When hand moves away while FSR is pressed
    if (currentPhotoAvg > liftStartPhotoAvg + 30 && liftedWordIndex >= 0) {
      isLifting = true;
      // Make lift amount proportional to photocell distance
      let distanceFromStart = currentPhotoAvg - liftStartPhotoAvg;
      liftTargetAmount = map(distanceFromStart, 0, 200, 0, 1);
      liftTargetAmount = constrain(liftTargetAmount, 0, 1);
    }
  } else {
    // When FSR is released
    if (fsrPressed) {
      fsrPressed = false;
      isLifting = false;
      liftTargetAmount = 0;
      if (isSpeaking && speechSynthesis.paused) {
        speechSynthesis.resume();
      }
    }
  }
  
  // Pause resume logic only when FSR is not pressed
  if (!fsrPressed) {
    if (photo1Value < 970 || photo2Value < 970) {
      if (!handDetected && isSpeaking) {
        speechSynthesis.pause();
        handDetected = true;
      }
    } else {
      if (handDetected && isSpeaking) {
        speechSynthesis.resume();
        handDetected = false;
      }
    }
  }
  
  lastPhotoAvg = currentPhotoAvg;
}

function computeHandLRRatio() {
  const d1 = max(0, photo1Baseline - photo1Value);
  const d2 = max(0, photo2Baseline - photo2Value);
  const total = d1 + d2;
  if (total < 1) return 0.5;
  let ratio = d2 / total;
  ratio = 1 - ratio;  // Reverse left right
  return constrain(ratio, 0, 1);
}

function updateIndexFromHand() {
  if (currentWordIndex < 0 || !wordPositions[currentWordIndex]) return;
  const lineY = wordPositions[currentWordIndex].y;
  const lineIdx = [];
  for (let i = 0; i < wordPositions.length; i++) {
    if (wordPositions[i] && wordPositions[i].y === lineY) lineIdx.push(i);
  }
  if (lineIdx.length === 0) return;
  const minX = wordPositions[lineIdx[0]].x;
  const last = lineIdx[lineIdx.length - 1];
  const maxX = wordPositions[last].x + wordPositions[last].width;
  const targetX = lerp(minX, maxX, handRatioSmooth);
  let bestIdx = lineIdx[0];
  let bestDist = Infinity;
  for (const idx of lineIdx) {
    const cx = wordPositions[idx].x + wordPositions[idx].width / 2;
    const d = Math.abs(cx - targetX);
    if (d < bestDist) { bestDist = d; bestIdx = idx; }
  }
  currentWordIndex = bestIdx;
}

function startReading() {
  if (!isSpeaking) {
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }
}

function stopReading() {
  if (isSpeaking) {
    speechSynthesis.cancel();
    isSpeaking = false;
    currentWordIndex = -1;
  }
}

// ===== 잔진동 헬퍼 함수 추가 =====
function getVibrationOffset(intensity = fsrLevelSmooth) {
  const shake = constrain(intensity, 0, 1);
  const maxAmp = 3;                 // 진동 세기
  const amp = maxAmp * shake;
  const speed = 0.9 + shake * 0.4;  // 진동 속도
  const ox = sin(frameCount * speed) * amp;
  const oy = cos(frameCount * speed * 0.92) * amp * 0.85;
  return { ox, oy };
}

function draw() {
  // Background
  background(245, 245, 240);

  // Top header
  fill(230, 230, 225);
  noStroke();
  rect(0, 0, width, 100);

  // Title
  fill(50, 60, 70);
  textSize(24);
  textAlign(LEFT);
  textStyle(NORMAL);
  text('Human Centered Design', 50, 50);

  // Subtitle
  fill(100, 110, 120);
  textSize(14);
  text('Tangible User Interface', 50, 75);

  // Draw text and save positions
  textAlign(LEFT, TOP);
  let x = 80;
  let y = 150;
  let lineHeight = 45;
  let maxWidth = width - 160;

  wordPositions = [];

  // Update FSR level
  let fsrLevelRaw = map(fsrValue, FSR_MIN_ACTIVE, FSR_MAX_ACTIVE, 0, 1);
  fsrLevelRaw = constrain(fsrLevelRaw, 0, 1);
  const upLerp = 0.35;
  const downLerp = 0.15;
  fsrLevelSmooth = lerp(
    fsrLevelSmooth,
    fsrLevelRaw,
    fsrLevelRaw > fsrLevelSmooth ? upLerp : downLerp
  );
  
  // Smoothly update lift amount
  liftAmount = lerp(liftAmount, liftTargetAmount, 0.15);

  for (let i = 0; i < words.length; i++) {
    let word = words[i];

    let baseFontSize = (i === currentWordIndex) ? 28 : 20;
    let baseFill = (i === currentWordIndex) ? [220, 100, 50] : [60, 70, 80];
    textStyle(i === currentWordIndex ? BOLD : NORMAL);
    textSize(baseFontSize);

    let wordWidth = textWidth(word + ' ');

    if (x + wordWidth > maxWidth) {
      x = 80;
      y += lineHeight;
    }

    if (isLifting && i === liftedWordIndex) {
      // skip here, draw in 3D block
    } else if (i === currentWordIndex && fsrPressed && !isLifting) {
      // Apply shake when FSR is pressed
      const maxGrowPx = 18;
      const grow = maxGrowPx * fsrLevelSmooth;
      const drawFontSize = baseFontSize + grow;

      const targetRed = [255, 30, 30];
      const r = lerp(baseFill[0], targetRed[0], fsrLevelSmooth);
      const g = lerp(baseFill[1], targetRed[1], fsrLevelSmooth);
      const b = lerp(baseFill[2], targetRed[2], fsrLevelSmooth);

      const maxShake = 3;
      const shakeIntensity = fsrLevelSmooth;
      const amp = maxShake * shakeIntensity;
      const shakeSpeed = 0.8 + (shakeIntensity * 0.4);
      const ox = sin(frameCount * shakeSpeed) * amp;
      const oy = cos(frameCount * shakeSpeed * 0.9) * amp * 0.8;

      push();
      translate(ox, oy);
      fill(r, g, b);
      textSize(drawFontSize);
      text(word, x, y);
      pop();
    } else if (i === currentWordIndex && !fsrPressed) {
      const maxGrowPx = 18;
      const grow = maxGrowPx * fsrLevelSmooth;
      const drawFontSize = baseFontSize + grow;

      const targetRed = [255, 30, 30];
      const r = lerp(baseFill[0], targetRed[0], fsrLevelSmooth);
      const g = lerp(baseFill[1], targetRed[1], fsrLevelSmooth);
      const b = lerp(baseFill[2], targetRed[2], fsrLevelSmooth);

      const maxShake = 6;
      const amp = maxShake * fsrLevelSmooth;
      const ox = sin(frameCount * 0.45) * amp;
      const oy = cos(frameCount * 0.38) * amp * 0.7;

      push();
      translate(ox, oy);
      fill(r, g, b);
      textSize(drawFontSize);
      text(word, x, y);
      pop();
    } else {
      fill(baseFill[0], baseFill[1], baseFill[2]);
      textSize(baseFontSize);
      text(word, x, y);
    }

    wordPositions.push({x: x, y: y, width: wordWidth, height: lineHeight});
    x += wordWidth;
  }

  // Hand shadow only when not pressing FSR
  if (!fsrPressed && handDetected && currentWordIndex >= 0 && wordPositions[currentWordIndex]) {
    handRatio = computeHandLRRatio();
    handRatioSmooth = lerp(handRatioSmooth, handRatio, 0.25);
    updateIndexFromHand();
    drawHandShadow();
  }

  // 3D lift effect
  if (isLifting && liftedWordIndex >= 0 && wordPositions[liftedWordIndex]) {
    draw3DLiftedWord();
  }

  // Bottom status bar
  fill(230, 230, 225);
  rect(0, height - 120, width, 120);

  textAlign(LEFT);
  textStyle(NORMAL);
  textSize(16);

  if (isSpeaking) {
    if (fsrPressed) {
      fill(255, 100, 50);
      text('✋ FSR PRESSED', width - 280, height - 70);
    } else if (handDetected) {
      fill(200, 120, 60);
      text('⏸ PAUSED (Hand Detected)', width - 280, height - 70);
    } else {
      fill(80, 160, 80);
      text('● SPEAKING', width - 180, height - 70);
    }

    let progress = map(currentWordIndex, 0, words.length - 1, 0, 1);
    fill(200, 200, 195);
    rect(350, height - 75, width - 650, 10, 5);
    fill(80, 160, 80);
    rect(350, height - 75, (width - 650) * progress, 10, 5);
  } else {
    fill(120, 130, 140);
    text('● READY', width - 180, height - 70);
  }

  fill(100, 110, 120);
  textSize(14);
  if (currentWordIndex >= 0) {
    text(`Word ${currentWordIndex + 1} of ${words.length}`, 350, height - 45);
  }

  fill(120, 130, 140);
  textSize(12);
  text(`P1: ${photo1Value} | P2: ${photo2Value} | FSR: ${fsrValue}`, 350, height - 95);
  
  if (isLifting) {
    fill(255, 100, 50);
    text(`LIFTING: ${liftedWord} (${floor(liftAmount * 100)}%)`, 350, height - 25);
  }
}

// ===== 3D lifted word with vibration applied =====
function draw3DLiftedWord() {
  const pos = wordPositions[liftedWordIndex];
  const word = liftedWord;
  
  push();

  // Keep micro vibration while lifting based on fsrLevelSmooth
  const { ox, oy } = getVibrationOffset(fsrLevelSmooth);
  translate(ox, oy);
  
  // Distance based on photocell
  const currentPhotoAvg = (photo1Value + photo2Value) / 2;
  const photoDistance = map(currentPhotoAvg, 800, 1020, 0, 1);
  const photoDistanceConstrained = constrain(photoDistance, 0, 1);
  
  // Shadow style
  const shadowLayers = floor(map(photoDistanceConstrained, 0, 1, 3, 8));
  const maxShadowOffset = map(photoDistanceConstrained, 0, 1, 3, 12);
  const baseShadowAlpha = map(photoDistanceConstrained, 0, 1, 150, 60);
  
  for (let i = shadowLayers; i > 0; i--) {
    const layerRatio = i / shadowLayers;
    const shadowOffset = layerRatio * maxShadowOffset * liftAmount;
    const shadowAlpha = baseShadowAlpha * layerRatio * liftAmount * (1 - photoDistanceConstrained * 0.3);
    
    fill(0, 0, 0, shadowAlpha);
    noStroke();
    
    const shadowSize = 28 + (liftAmount * 80) + (i * 2 * (1 + photoDistanceConstrained));
    textSize(shadowSize);
    textStyle(BOLD);
    
    if (photoDistanceConstrained > 0.5 && i > 1) {
      drawingContext.filter = `blur(${(i - 1) * photoDistanceConstrained * 2}px)`;
    }
    
    text(word, pos.x + shadowOffset, pos.y + shadowOffset);
    drawingContext.filter = 'none';
  }
  
  // Main word
  const mainSize = 28 + (liftAmount * 120);
  fill(255, 30, 30);
  textSize(mainSize);
  textStyle(BOLD);
  
  const liftY = pos.y - (liftAmount * 150);
  const liftX = pos.x - (liftAmount * 30);
  text(word, liftX, liftY);
  
  pop();
}

// Hand side variable
let handSide = 'right';

function drawHandShadow() {
  push();

  const currentWord = wordPositions[currentWordIndex];
  if (!currentWord) return;

  // Target word center
  targetHandX = currentWord.x + currentWord.width / 2;
  targetHandY = currentWord.y + currentWord.height / 2;

  handX = lerp(handX || targetHandX, targetHandX, 0.1);
  handY = lerp(handY || targetHandY, targetHandY, 0.1);

  // Distance scale
  const minValue = min(photo1Value, photo2Value);
  const distance = map(minValue, 800, 1020, 0, 1); // 0 close 1 far

  const shadowIntensity = map(distance, 0, 1, 180, 20);
  const shadowSize = map(distance, 0, 1, 1.0, 1.8);
  const blurLayers = floor(map(distance, 0, 1, 2, 8));
  const blurAmount = map(distance, 0, 1, 2, 20);

  // Smooth transition
  const handWeight = smoothstep(0.35, 0.55, distance);
  const blobWeight = 1 - handWeight;

  const s = handSide === 'right' ? 1 : -1;

  function smoothstep(edge0, edge1, x) {
    const t = constrain((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // Hand silhouette path
  function drawHandPath(scale) {
    beginShape();
    vertex(handX + (-35 * s) * scale, handY + 70 * scale);
    bezierVertex(
      handX + (-40 * s) * scale, handY + 50 * scale,
      handX + (-42 * s) * scale, handY + 20 * scale,
      handX + (-40 * s) * scale, handY - 10 * scale
    );
    bezierVertex(
      handX + (-38 * s) * scale, handY - 30 * scale,
      handX + (-35 * s) * scale, handY - 65 * scale,
      handX + (-32 * s) * scale, handY - 70 * scale
    );
    bezierVertex(
      handX + (-28 * s) * scale, handY - 72 * scale,
      handX + (-24 * s) * scale, handY - 70 * scale,
      handX + (-22 * s) * scale, handY - 65 * scale
    );
    bezierVertex(
      handX + (-20 * s) * scale, handY - 50 * scale,
      handX + (-18 * s) * scale, handY - 35 * scale,
      handX + (-17 * s) * scale, handY - 25 * scale
    );
    bezierVertex(
      handX + (-15 * s) * scale, handY - 40 * scale,
      handX + (-12 * s) * scale, handY - 75 * scale,
      handX + (-8 * s) * scale, handY - 80 * scale
    );
    bezierVertex(
      handX + (-4 * s) * scale, handY - 82 * scale,
      handX + (0 * s) * scale, handY - 80 * scale,
      handX + (2 * s) * scale, handY - 75 * scale
    );
    bezierVertex(
      handX + (4 * s) * scale, handY - 60 * scale,
      handX + (5 * s) * scale, handY - 40 * scale,
      handX + (6 * s) * scale, handY - 28 * scale
    );
    bezierVertex(
      handX + (8 * s) * scale, handY - 45 * scale,
      handX + (12 * s) * scale, handY - 80 * scale,
      handX + (16 * s) * scale, handY - 85 * scale
    );
    bezierVertex(
      handX + (20 * s) * scale, handY - 87 * scale,
      handX + (24 * s) * scale, handY - 85 * scale,
      handX + (26 * s) * scale, handY - 80 * scale
    );
    bezierVertex(
      handX + (28 * s) * scale, handY - 65 * scale,
      handX + (29 * s) * scale, handY - 40 * scale,
      handX + (30 * s) * scale, handY - 25 * scale
    );
    bezierVertex(
      handX + (32 * s) * scale, handY - 40 * scale,
      handX + (36 * s) * scale, handY - 72 * scale,
      handX + (40 * s) * scale, handY - 75 * scale
    );
    bezierVertex(
      handX + (44 * s) * scale, handY - 77 * scale,
      handX + (48 * s) * scale, handY - 75 * scale,
      handX + (50 * s) * scale, handY - 70 * scale
    );
    bezierVertex(
      handX + (52 * s) * scale, handY - 55 * scale,
      handX + (53 * s) * scale, handY - 30 * scale,
      handX + (52 * s) * scale, handY - 5 * scale
    );
    bezierVertex(
      handX + (50 * s) * scale, handY + 20 * scale,
      handX + (45 * s) * scale, handY + 50 * scale,
      handX + (35 * s) * scale, handY + 70 * scale
    );
    bezierVertex(
      handX + (15 * s) * scale, handY + 75 * scale,
      handX + (-15 * s) * scale, handY + 75 * scale,
      handX + (-35 * s) * scale, handY + 70 * scale
    );
    endShape(CLOSE);
  }

  // Rounded blob path
  function drawBlobPath(scale) {
    const shrink = 0.8;
    noStroke();
    beginShape();
    ellipse(handX, handY, 120 * scale * shrink, 90 * scale * shrink); 
    endShape();
  }

  drawingContext.save();
  drawingContext.filter = `blur(${blurAmount}px)`;
  noStroke();
  fill(0, 0, 0);

  // Spread layers
  for (let layer = blurLayers; layer > 0; layer--) {
    const layerScale = shadowSize * (1 + layer * distance * 0.2);
    const baseAlpha = shadowIntensity * (0.5 / blurLayers);

    if (blobWeight > 0) {
      drawingContext.globalAlpha = (baseAlpha * blobWeight) / 255;
      drawBlobPath(layerScale);
    }
    if (handWeight > 0) {
      drawingContext.globalAlpha = (baseAlpha * handWeight) / 255;
      drawHandPath(layerScale);
    }
  }

  // Center clear layer
  drawingContext.filter = 'blur(1px)';
  const coreAlpha = map(distance, 0, 0.5, 0.8, 0.2);
  if (blobWeight > 0) {
    drawingContext.globalAlpha = coreAlpha * blobWeight;
    drawBlobPath(shadowSize);
  }
  if (handWeight > 0) {
    drawingContext.globalAlpha = coreAlpha * handWeight;
    drawHandPath(shadowSize);
  }

  drawingContext.restore();
  pop();
}

function mouseWheel(event) {
  scrollOffset += event.delta * 0.5;
  scrollOffset = constrain(scrollOffset, 0, maxScroll);
  return false;
}
