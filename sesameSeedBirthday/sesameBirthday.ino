#include <Arduino.h>
#include "pitches.h"
#include <math.h>

// Hardware pins
const int piezoPin = A0;   // Output for tone()
const int potPin   = A5;   // Potentiometer input
const int fsrPin   = A4;   // FSR trigger input

// Potentiometer → frequency mapping
const int F_MIN = 0;
const int F_MAX = 6000;

// EMA smoothing for the potentiometer
float ema = 0.0f;
const float alpha = 0.2f;   // 0.0 to 1.0

int lastFreq = 0;
unsigned long lastUpdate = 0;

// FSR trigger
int FSR_THRESHOLD = 700;          // Adjust depending on your FSR sensitivity
unsigned long triggerCooldownMs = 1000;
unsigned long lastTriggerTime = 0;

// State machine
enum State { LIVE, PLAYING };
State state = LIVE;

// "Happy Birthday" melody (base key centered around G4)
const int melody[] = {
  NOTE_G4, NOTE_G4, NOTE_A4, NOTE_G4, NOTE_C5, NOTE_B4,
  NOTE_G4, NOTE_G4, NOTE_A4, NOTE_G4, NOTE_D5, NOTE_C5,
  NOTE_G4, NOTE_G4, NOTE_G5, NOTE_E5, NOTE_C5, NOTE_B4, NOTE_A4,
  NOTE_F5, NOTE_F5, NOTE_E5, NOTE_C5, NOTE_D5, NOTE_C5
};

// Note durations: 4 = quarter note, 8 = eighth note, etc.
const int noteDurations[] = {
  8, 8, 4, 4, 4, 2,
  8, 8, 4, 4, 4, 2,
  8, 8, 4, 4, 4, 4, 2,
  8, 8, 4, 4, 4, 2
};

const int MELODY_LEN = sizeof(melody) / sizeof(melody[0]);

// Utility: calculate frequency multiplier for transposing semitones
inline float semitoneFactor(int semitones) {
  return powf(2.0f, semitones / 12.0f);
}

// Play "Happy Birthday" transposed based on target frequency
void playHappyBirthdayTransposed(int targetFreq) {
  const float anchor = NOTE_G4; // 392 Hz
  int semis = (int)roundf(12.0f * (logf(targetFreq / anchor) / logf(2.0f)));
  float k = semitoneFactor(semis);

  const int quarterMs = 300;

  for (int i = 0; i < MELODY_LEN; i++) {
    int baseHz = melody[i];
    if (baseHz <= 0) {
      noTone(piezoPin);
      delay(quarterMs);
      continue;
    }
    int hz = (int)roundf(baseHz * k);
    hz = constrain(hz, 50, 7000);

    int duration = quarterMs * 4 / noteDurations[i];
    tone(piezoPin, hz, (int)(duration * 0.90f));
    delay(duration);
  }
}

void setup() {
  ema = analogRead(potPin); // Initialize EMA with current pot reading
  noTone(piezoPin);         // Start silent
  // Serial.begin(115200);   // Optional for debugging
}

void loop() {
  if (state == LIVE) {
    // Read and smooth the potentiometer
    if (millis() - lastUpdate >= 15) {
      lastUpdate = millis();

      int raw = analogRead(potPin);         // 0 to 1023
      ema = alpha * raw + (1.0f - alpha) * ema;

      // Normalize to 0.0 to 1.0
      float norm = ema / 1023.0f;
      norm = constrain(norm, 0.0f, 1.0f);

      // Optional curve for finer control near low end
      // Use a squared curve for smoother low range response
      float ratio = norm * norm;

      // Map to frequency
      int freq = (int)roundf(F_MIN + ratio * (F_MAX - F_MIN));

      // Silence when the potentiometer is at minimum or near it
      // Deadband avoids tiny residual tones at very low values
      const int silentDeadbandFreq = 20; // Hz
      if (ratio <= 0.001f || freq <= silentDeadbandFreq) {
        if (lastFreq != 0) {
          noTone(piezoPin);
          lastFreq = 0;
        }
      } else {
        if (abs(freq - lastFreq) >= 3) {
          tone(piezoPin, freq);
          lastFreq = freq;
        }
      }
    }

    // FSR trigger detection
    int fsr = analogRead(fsrPin);
    unsigned long now = millis();
    if (fsr >= FSR_THRESHOLD && (now - lastTriggerTime) > triggerCooldownMs) {
      lastTriggerTime = now;

      // Store current frequency as resonance point
      int f_res = lastFreq;
      if (f_res < 80) {
        // If currently silent or too low, choose a safe default anchor
        f_res = NOTE_G4; // 392 Hz
      }

      noTone(piezoPin);
      state = PLAYING;

      // Play transposed melody
      playHappyBirthdayTransposed(f_res);

      // Resume continuous tone after playback if lastFreq was audible
      if (lastFreq > 20) {
        tone(piezoPin, lastFreq);
      } else {
        noTone(piezoPin);
        lastFreq = 0;
      }
      state = LIVE;
    }

  } else {
    // PLAYING state
  }
}
