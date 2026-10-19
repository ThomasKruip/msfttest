// Maakt een eigen (self-signed) certificaat in data/cert, zodat de agenda via https draait.
// Telefoons staan opnemen met de microfoon alleen toe via https.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const CERT_DIR = path.join(DATA_DIR, 'cert');

const ips = Object.values(os.networkInterfaces())
  .flat()
  .filter((a) => a && a.family === 'IPv4')
  .map((a) => a.address);
const altNames = ['DNS:localhost', `DNS:${os.hostname()}`, ...ips.map((ip) => `IP:${ip}`)].join(',');

fs.mkdirSync(CERT_DIR, { recursive: true });

try {
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256',
    '-days', '3650',
    '-subj', '/CN=Gezinsagenda',
    '-addext', `subjectAltName=${altNames}`,
    '-keyout', path.join(CERT_DIR, 'key.pem'),
    '-out', path.join(CERT_DIR, 'cert.pem'),
  ], { stdio: 'pipe' });
} catch (err) {
  console.error('Het certificaat kon niet worden gemaakt: het programma "openssl" is niet gevonden of gaf een fout.');
  console.error('Op Windows zit openssl bij Git for Windows (Git Bash); op macOS en Linux is het meestal al aanwezig.');
  if (err.stderr) console.error(String(err.stderr));
  process.exit(1);
}

console.log(`Certificaat gemaakt in ${CERT_DIR}`);
console.log('Start de agenda opnieuw met `npm start`; hij draait dan via https.');
console.log('De eerste keer geeft de telefoon een waarschuwing. Kies "Geavanceerd" en "Doorgaan" om de agenda te openen.');
