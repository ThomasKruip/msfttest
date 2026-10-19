// Wist de pincode van een gezinslid, voor als iemand hem vergeten is en er geen
// andere beheerder is die dat in de app kan doen. Gebruik: npm run pincode-wissen -- Papa
// Stop de agenda eerst en start hem daarna opnieuw.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FAMILY_FILE = path.join(DATA_DIR, 'family.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

const name = process.argv.slice(2).join(' ').trim();
let family;
try {
  family = JSON.parse(fs.readFileSync(FAMILY_FILE, 'utf8'));
} catch {
  console.error(`Geen gezinsleden gevonden in ${FAMILY_FILE}.`);
  process.exit(1);
}

const member = family.find((m) => m.name.toLowerCase() === name.toLowerCase());
if (!member) {
  console.error(name ? `Geen gezinslid met de naam "${name}".` : 'Geef een naam op, bijvoorbeeld: npm run pincode-wissen -- Papa');
  console.error('Gezinsleden: ' + family.map((m) => m.name).join(', '));
  process.exit(1);
}

delete member.pinHash;
delete member.pinSalt;
fs.writeFileSync(FAMILY_FILE, JSON.stringify(family, null, 2));

try {
  const sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  for (const [key, s] of Object.entries(sessions)) if (s.memberId === member.id) delete sessions[key];
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
} catch {
  // Geen sessies: niets te doen.
}

console.log(`De pincode van ${member.name} is gewist. Start de agenda opnieuw;`);
console.log(`${member.name} kiest bij de volgende keer inloggen een nieuwe pincode.`);
