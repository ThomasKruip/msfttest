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

// Op Windows staat openssl meestal niet in het zoekpad, maar wel bij Git for Windows.
const candidates = ['openssl'];
if (process.platform === 'win32') {
  for (const dir of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) {
    if (dir) candidates.push(path.join(dir, 'Git', 'usr', 'bin', 'openssl.exe'), path.join(dir, 'Git', 'mingw64', 'bin', 'openssl.exe'));
  }
}
const openssl = candidates.slice(1).find((c) => fs.existsSync(c)) || 'openssl';

try {
  execFileSync(openssl, [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256',
    '-days', '3650',
    '-subj', '/CN=Gezinsagenda',
    '-addext', `subjectAltName=${altNames}`,
    '-keyout', path.join(CERT_DIR, 'key.pem'),
    '-out', path.join(CERT_DIR, 'cert.pem'),
  ], { stdio: 'pipe' });
} catch (err) {
  console.error('Het certificaat kon niet worden gemaakt: het programma "openssl" is niet gevonden of gaf een fout.');
  console.error('Op Windows: installeer Git for Windows (https://git-scm.com), daar zit openssl bij.');
  console.error('Op macOS en Linux is openssl meestal al aanwezig.');
  console.error('Je kunt de agenda ook zonder certificaat gebruiken; alleen opnemen op de telefoon werkt dan niet.');
  if (err.stderr) console.error(String(err.stderr));
  process.exit(1);
}

console.log(`Certificaat gemaakt in ${CERT_DIR}`);
console.log('Vanaf nu draait de agenda via https (start hem opnieuw als hij al draaide).');
console.log('De eerste keer geeft de telefoon een waarschuwing. Kies "Geavanceerd" en "Doorgaan" om de agenda te openen.');
