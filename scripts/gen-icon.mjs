/**
 * Tauri ikon seti için kaynak PNG (1024x1024) üretir.
 * Kullanım: npm run icon  →  app-icon.png oluşur.
 * Ardından: npx tauri icon app-icon.png  (src-tauri/icons/ setini üretir)
 *
 * Bağımlılık gerektirmez; PNG'yi Node'un zlib modülüyle elle kodlar.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const SIZE = 1024;

// --- CRC32 ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

// --- Pikseller: indigo→violet diyagonal gradyan + merkezi açık çekirdek ---
const raw = Buffer.alloc((1 + SIZE * 3) * SIZE);
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (1 + SIZE * 3);
  raw[rowStart] = 0; // filtre: none
  for (let x = 0; x < SIZE; x++) {
    const t = (x + y) / (2 * SIZE); // 0..1 diyagonal
    let r = Math.round(30 + 50 * t);
    let g = Math.round(27 + 30 * t);
    let b = Math.round(75 + 90 * t);
    // Merkezde yumuşak "hub" parlaması
    const dx = (x - SIZE / 2) / (SIZE / 2);
    const dy = (y - SIZE / 2) / (SIZE / 2);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.35) {
      const glow = 1 - dist / 0.35;
      r = Math.min(255, r + Math.round(120 * glow));
      g = Math.min(255, g + Math.round(180 * glow));
      b = Math.min(255, b + Math.round(220 * glow));
    }
    const i = rowStart + 1 + x * 3;
    raw[i] = r;
    raw[i + 1] = g;
    raw[i + 2] = b;
  }
}

// --- PNG birleştirme ---
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit derinliği
ihdr[9] = 2; // renk tipi: truecolor RGB
// 10..12 = compression, filter, interlace (0)

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

writeFileSync('app-icon.png', png);
console.log('app-icon.png üretildi (%d KB)', Math.round(png.length / 1024));
