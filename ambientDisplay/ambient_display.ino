// =======================
// RGB Sky and Effects Controller for Arduino Uno
// Intent: Drive an RGB LED with sky-themed palettes and animated effects,
// and switch effects via serial text commands.
// =======================

#include <Arduino.h>

int LED_PIN_RED   = 3;
int LED_PIN_GREEN = 5;
int LED_PIN_BLUE  = 9;

const uint8_t BRIGHTNESS = 255;   // Global brightness cap (0..255)
const bool USE_GAMMA = true;      // Enable LED gamma correction

uint8_t gammaLUT[256];

// ===== Utilities =====

// Build a simple gamma LUT (~2.2) so fades look perceptually smooth on LEDs
void buildGammaLUT() {
  for (int i = 0; i < 256; i++) {
    float x = i / 255.0;
    uint8_t g = (uint8_t)round(pow(x, 2.2) * 255.0);
    gammaLUT[i] = g;
  }
}

// Apply gamma if enabled
uint8_t applyGamma(uint8_t v) {
  if (!USE_GAMMA) return v;
  return gammaLUT[v];
}

// Write raw RGB (0..255 each) through PWM with gamma and global cap
void writeRGB(uint8_t r, uint8_t g, uint8_t b) {
  uint16_t rr = (uint16_t)r * BRIGHTNESS / 255;
  uint16_t gg = (uint16_t)g * BRIGHTNESS / 255;
  uint16_t bb = (uint16_t)b * BRIGHTNESS / 255;

  analogWrite(LED_PIN_RED,   applyGamma(rr));
  analogWrite(LED_PIN_GREEN, applyGamma(gg));
  analogWrite(LED_PIN_BLUE,  applyGamma(bb));
}

// Standard HSV→RGB, continuous hue 0..360
void hsvToRgb(float hue, float sat, float val, uint8_t &r, uint8_t &g, uint8_t &b) {
  float c = val * sat;
  float x = c * (1 - fabs(fmod(hue / 60.0, 2) - 1));
  float m = val - c;

  float rf, gf, bf;
  if      (hue < 60)  { rf = c; gf = x; bf = 0; }
  else if (hue < 120) { rf = x; gf = c; bf = 0; }
  else if (hue < 180) { rf = 0; gf = c; bf = x; }
  else if (hue < 240) { rf = 0; gf = x; bf = c; }
  else if (hue < 300) { rf = x; gf = 0; bf = c; }
  else                { rf = c; gf = 0; bf = x; }

  r = (uint8_t)constrain((rf + m) * 255, 0, 255);
  g = (uint8_t)constrain((gf + m) * 255, 0, 255);
  b = (uint8_t)constrain((bf + m) * 255, 0, 255);
}

// Ease the current color to a target RGB over time (stepwise tween)
// Also checks Serial frequently so a new command can interrupt mid-fade.
void fadeToRGB(uint8_t r2, uint8_t g2, uint8_t b2, uint16_t durationMs, uint8_t steps) {
  static uint8_t r1 = 0, g1 = 0, b1 = 0;
  int dr = ((int)r2 - r1);
  int dg = ((int)g2 - g1);
  int db = ((int)b2 - b1);

  for (uint8_t i = 1; i <= steps; i++) {
    if (Serial.available()) return; // interrupt fade if a new command arrives
    uint8_t rr = r1 + dr * i / steps;
    uint8_t gg = g1 + dg * i / steps;
    uint8_t bb = b1 + db * i / steps;
    writeRGB(rr, gg, bb);
    delay(durationMs / steps);
  }
  r1 = r2; g1 = g2; b1 = b2;
}

// ===== Sky colors for 1..9 =====
// Maps digits to sky-like hues/brightness across the day timeline.
// 1..5: clean blue daylight, 6: brief warm yellow hint, 7: orange-red sunset,
// 8: deep navy dusk (very dim), 9: lights off (night).
void skyColorForHour(uint8_t h, uint8_t &r, uint8_t &g, uint8_t &b) {
  float H, S, V;
  switch (h) {
    case 1:  H = 205; S = 0.35; V = 1.00; break;
    case 2:  H = 205; S = 0.40; V = 0.95; break;
    case 3:  H = 210; S = 0.45; V = 0.90; break;
    case 4:  H = 210; S = 0.50; V = 0.80; break;
    case 5:  H = 200; S = 0.45; V = 0.70; break;
    case 6:  H = 50;  S = 0.80; V = 0.75; break; // pre-sunset yellow hint
    case 7:  H = 18;  S = 0.90; V = 0.60; break; // orange-red sunset
    case 8:  H = 235; S = 0.60; V = 0.08; break; // deep navy dusk (dim)
    case 9:  r = 0; g = 0; b = 0; return;        // night/off
    default: H = 210; S = 0.40; V = 0.90; break;
  }
  hsvToRgb(H, S, V, r, g, b);
}

// ===== Effects (each loops forever until a new serial command arrives) =====

// FIREWORK — "pop + afterglow"
// Intent: a bright ignition flash, then a quick switch to a saturated color,
// then a rapid decay to black (afterglow). Random timing between bursts.
// Where: ignition (writeRGB 255,230,120), color spark (random hue), decay loop.
void effectFirework() {
  while (true) {
    writeRGB(255, 230, 120);                    // ignition flash
    delay(40 + random(20, 60));
    uint8_t r, g, b;
    float hue = random(0, 360);
    hsvToRgb(hue, 1.0, 1.0, r, g, b);           // colored spark
    writeRGB(r, g, b);
    for (int v = 255; v >= 0; v -= 12) {        // afterglow decay
      if (Serial.available()) return;
      uint8_t rr = (uint8_t)((uint16_t)r * v / 255);
      uint8_t gg = (uint8_t)((uint16_t)g * v / 255);
      uint8_t bb = (uint8_t)((uint16_t)b * v / 255);
      writeRGB(rr, gg, bb);
      delay(14);
    }
    if (Serial.available()) return;
    delay(80 + random(40, 250));                // random gap between bursts
    if (Serial.available()) return;
  }
}

// LIGHTNING — "random staccato flashes"
// Intent: chaotic bright flashes (white/yellowish), sometimes in quick succession,
// with short residual dim state in between. Randomized intervals.
// Where: inner loop flashes (20–60ms), residual dim (30–120ms), gaps (120–420ms).
void effectLightning() {
  while (true) {
    if (Serial.available()) return;
    bool yellowish = random(0, 100) < 65;
    uint8_t r = yellowish ? 255 : 255;
    uint8_t g = yellowish ? 230 : 255;
    uint8_t b = yellowish ? 60  : 255;

    for (uint8_t s = 0; s < random(1, 4); s++) { // 1–3 quick sub-flashes
      if (Serial.available()) return;
      writeRGB(r, g, b);                         // intense flash
      delay(random(20, 60));
      writeRGB(10, 10, 10);                      // brief residual glow
      delay(random(30, 120));
    }
    delay(random(120, 420));                     // quiet gap before next strike
  }
}

// BREEZE — "gentle breathing brightness"
// Intent: keep a fixed overcast sky color and modulate only the brightness
// with a smooth sine wave. Feels like wind/breeze moving clouds softly.
// Where: sine on brightness (period ~1.2s), no hue changes.
void effectBreeze() {
  uint8_t rBase, gBase, bBase;
  hsvToRgb(210, 0.12, 0.55, rBase, gBase, bBase); // overcast blue-gray

  const float periodSec = 1.2f;
  const float w = TWO_PI / periodSec;
  const float vMin = 0.80f, vMax = 1.00f;

  uint32_t tStart = millis();
  while (true) {
    if (Serial.available()) return;
    float t = (millis() - tStart) / 1000.0f;
    float s = 0.5f + 0.5f * sin(w * t);          // 0..1
    float scale = vMin + (vMax - vMin) * s;      // brightness envelope

    uint8_t rr = (uint8_t)constrain(rBase * scale, 0, 255);
    uint8_t gg = (uint8_t)constrain(gBase * scale, 0, 255);
    uint8_t bb = (uint8_t)constrain(bBase * scale, 0, 255);

    writeRGB(rr, gg, bb);
    delay(25);
  }
}

// RAIN — "short, muted staccato drops"
// Intent: very dim, desaturated gray-blue base with quick ON/OFF pulses.
// Feels like sparse raindrops: brief on (40–90ms) then dark gap (60–180ms).
// Where: random small bursts + full off between pulses.
void effectRain() {
  uint8_t rBase, gBase, bBase;
  hsvToRgb(210, 0.20, 0.35, rBase, gBase, bBase); // more muted/overcast

  while (true) {
    if (Serial.available()) return;

    writeRGB(0, 0, 0);                            // off baseline

    // one quick drop: short ON with slightly randomized amplitude
    uint8_t rr = (uint8_t)((uint16_t)rBase * random(50, 80) / 100);
    uint8_t gg = (uint8_t)((uint16_t)gBase * random(50, 80) / 100);
    uint8_t bb = (uint8_t)((uint16_t)bBase * random(50, 80) / 100);
    writeRGB(rr, gg, bb);

    delay(random(40, 90));                        // staccato on-time

    writeRGB(0, 0, 0);                            // off again
    delay(random(60, 180));                       // short gap to next drop
  }
}

// AURORA — "deep green flow, rare soft red drape"
// Intent: avoid blue, center on saturated deep green that slowly "flows"
// (slowly varying hue/sat/val). Occasionally a very faint red curtain
// appears with a long-period envelope. Final output further suppresses blue.
// Where: green wave (sin/cos envelopes), rare red envelope (slow sin^3),
// and a post-mix blue attenuation.
void effectAurora() {
  uint32_t t0 = millis();

  while (true) {
    if (Serial.available()) return;

    float t = (millis() - t0) / 1000.0f;

    // Deep green band (126..138 hue), breathing sat/val
    float hueG = 132.0f + 6.0f * sin(t * 0.5f);
    float satG = 0.90f - 0.05f * cos(t * 0.30f);
    float valG = 0.18f + 0.52f * (0.5f + 0.5f * sin(t * 0.80f));

    uint8_t rG, gG, bG;
    hsvToRgb(hueG, satG, valG, rG, gG, bG);

    // Rare, very soft red curtain using a long-period envelope (sin^3+ clamp)
    float redEnv = sin(t * 0.08f);               // ~80s period
    redEnv = redEnv > 0 ? redEnv : 0;
    float redVal = 0.12f * redEnv * redEnv * redEnv;

    uint8_t rR = 0, gR = 0, bR = 0;
    if (redVal > 0.001f) {
      hsvToRgb(0.0f, 0.90f, redVal, rR, gR, bR);
    }

    // Additive mix of green base + faint red
    uint16_t r = min(255, (uint16_t)rG + rR);
    uint16_t g = min(255, (uint16_t)gG + gR);
    uint16_t b = min(255, (uint16_t)bG + bR);

    // Extra blue suppression to keep the look "deep green"
    b = (uint16_t)(b * 0.70f);
    g = min<uint16_t>(255, (uint16_t)(g * 1.05f));

    writeRGB((uint8_t)r, (uint8_t)g, (uint8_t)b);
    delay(18);
  }
}

// RAINBOW — "buttery-smooth hue sweep"
// Intent: rotate hue 0..360 continuously at a steady speed,
// no flicker, just smooth color travel.
// Where: hue = phase*360, fixed sat/val, short delay for smoothness.
void effectRainbow() {
  uint32_t t0 = millis();
  const uint16_t cycleMs = 8000;                 // one full rotation
  while (true) {
    if (Serial.available()) return;
    float phase = (float)(millis() - t0) / (float)cycleMs;
    float hue   = fmod(phase * 360.0f, 360.0f);
    uint8_t r, g, b;
    hsvToRgb(hue, 1.0, 1.0, r, g, b);
    writeRGB(r, g, b);
    delay(14);
  }
}

// Play a digit string like "123456789" as a looping day→night timeline,
// fading between each mapped hour color. Interruptible by new command.
void playSkyTimelineLoop(const String &digits) {
  const uint8_t MAX_N = 32;
  uint8_t cols[MAX_N][3];
  uint8_t N = 0;
  for (size_t i = 0; i < digits.length() && N < MAX_N; i++) {
    char c = digits.charAt(i);
    if (c < '1' || c > '9') continue;
    uint8_t h = c - '0';
    skyColorForHour(h, cols[N][0], cols[N][1], cols[N][2]);
    N++;
  }
  if (N == 0) return;

  uint8_t idx = 0;
  while (true) {
    if (Serial.available()) return;
    uint8_t r = cols[idx][0], g = cols[idx][1], b = cols[idx][2];
    fadeToRGB(r, g, b, 1200, 40);                // smooth transition per step
    if (Serial.available()) return;
    idx = (idx + 1) % N;                         // loop through the sequence
  }
}

// ===== IO helpers =====

// Check if a string is all digits (used for timeline commands)
bool isDigitsOnly(const String &s) {
  if (s.length() == 0) return false;
  for (size_t i = 0; i < s.length(); i++) {
    char c = s.charAt(i);
    if (c < '0' || c > '9') return false;
  }
  return true;
}

// Read a single line from Serial (lowercased), interrupt-friendly
String readCommandLine() {
  String line = "";
  if (Serial.available()) {
    line = Serial.readStringUntil('\n');
    line.trim();
    line.toLowerCase();
  }
  return line;
}

// =======================

void setup() {
  pinMode(LED_PIN_RED,   OUTPUT);
  pinMode(LED_PIN_GREEN, OUTPUT);
  pinMode(LED_PIN_BLUE,  OUTPUT);

  buildGammaLUT();

  Serial.begin(115200);
  randomSeed(analogRead(A0));
  writeRGB(0, 0, 0);
  delay(200);

  // Soft boot color to show we're alive
  uint8_t r, g, b;
  hsvToRgb(205, 0.35, 0.6, r, g, b);
  fadeToRGB(r, g, b, 800, 30);
  Serial.println("Type: firework / lightning / lightening / breeze / rain / aurora / rainbow / 123456789");
}

void loop() {
  String cmd = readCommandLine();

  if (cmd.length() > 0) {
    if (cmd == "firework") {
      effectFirework();
    } else if (cmd == "lightning" || cmd == "lightening") {
      effectLightning();
    } else if (cmd == "breeze") {
      effectBreeze();            // gentle breathing brightness (wind-like)
    } else if (cmd == "rain") {
      effectRain();              // short dim pulses (staccato rain)
    } else if (cmd == "aurora") {
      effectAurora();            // deep green flow, rare soft red
    } else if (cmd == "rainbow") {
      effectRainbow();           // smooth continuous hue sweep
    } else if (isDigitsOnly(cmd)) {
      playSkyTimelineLoop(cmd);  // day→night mapping per digit string
    } else {
      // Fallback: infinite smooth hue wave, interruptible
      while (true) {
        if (Serial.available()) break;
        for (int hue = 0; hue < 360; hue += 2) {
          if (Serial.available()) break;
          uint8_t r, g, b;
          hsvToRgb(hue, 1.0, 1.0, r, g, b);
          writeRGB(r, g, b);
          delay(12);
        }
      }
    }
  }

  delay(10); // idle tick
}

