// A0 : FSR
// A4 : Photocell 1
// A5 : Photocell 2

const uint8_t FSR_PIN    = A0;
const uint8_t PHOTO1_PIN = A4;
const uint8_t PHOTO2_PIN = A5;

void setup() {
  Serial.begin(9600);
}

void loop() {
  int fsr   = analogRead(FSR_PIN);
  int photo1 = analogRead(PHOTO1_PIN);
  int photo2 = analogRead(PHOTO2_PIN);

  Serial.print('<');
  Serial.print("FSR:"); Serial.print(fsr); Serial.print(',');
  Serial.print("P1:");  Serial.print(photo1); Serial.print(',');
  Serial.print("P2:");  Serial.print(photo2);
  Serial.println('>');

  delay(10);
}
