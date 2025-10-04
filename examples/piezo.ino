
/* Theremin
 * --------
 *
 * Created 24 October 2006
 * copyleft 2006 Tod E. Kurt tod@todbot.com
 * http://todbot.com/
 *
 * Adapted by Noura Howell, 2 October 2017
 * http://nourahowell.com/
 */

 int photocellPin = A0;
 int speakerPin = A5;
 
 int photocellVal = 0;
 int toneVal;
 
 // try changing the noteDuration to hear how that changes the sound
 int noteDuration = 10; // ms
 
 void setup() {
   pinMode(speakerPin, OUTPUT);
   Serial.begin(9600);
 }
 
 void loop() {  
   // read the value from the sensor
   photocellVal = analogRead(photocellPin);
   Serial.print("photocellVal: ");Serial.println(photocellVal);
   
   // decide what tone to play based on the sensor value
   // try changing this calculation to hear how that changes the sound
   toneVal = photocellVal * 3;
    
   // play the tone
   tone(speakerPin, toneVal, noteDuration); 
   // to distinguish the notes, set a minimum time between them.
   // the note's duration + 30% seems to work well:
   // try changing the pauseBetweenNotes to hear how that changes the sound
   int pauseBetweenNotes = noteDuration * 1.3;
   delay(pauseBetweenNotes);
   // stop the tone playing:
   noTone(8);
 }