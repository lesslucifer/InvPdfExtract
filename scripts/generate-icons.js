// Generate simple 22x22 tray icon PNGs (macOS template size)
// Uses raw PNG encoding - creates simple circle icons
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 22;
const RADIUS = 7;
const CENTER = SIZE / 2;

// Colors: [R, G, B] for each state
const COLORS = {
  'tray-idle': [76, 175, 80],       // Green
  'tray-processing': [33, 150, 243], // Blue
  'tray-review': [255, 193, 7],      // Yellow/Amber
  'tray-error': [244, 67, 54],       // Red
};

function createPNG(color) {
  const width = SIZE;
  const height = SIZE;

  // Create raw pixel data (RGBA)
  const rawData = Buffer.alloc(height * (width * 4 + 1)); // +1 for filter byte per row

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width * 4 + 1);
    rawData[rowOffset] = 0; // Filter: None

    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;
      const dx = x - CENTER;
      const dy = y - CENTER;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= RADIUS) {
        // Anti-aliased edge
        const alpha = dist > RADIUS - 1 ? Math.max(0, (RADIUS - dist)) * 255 : 255;
        rawData[pixelOffset] = color[0];     // R
        rawData[pixelOffset + 1] = color[1]; // G
        rawData[pixelOffset + 2] = color[2]; // B
        rawData[pixelOffset + 3] = Math.round(alpha); // A
      } else {
        rawData[pixelOffset] = 0;
        rawData[pixelOffset + 1] = 0;
        rawData[pixelOffset + 2] = 0;
        rawData[pixelOffset + 3] = 0;
      }
    }
  }

  // Compress
  const compressed = zlib.deflateSync(rawData);

  // Build PNG
  const chunks = [];

  // Signature
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  chunks.push(makeChunk('IHDR', ihdr));

  // IDAT
  chunks.push(makeChunk('IDAT', compressed));

  // IEND
  chunks.push(makeChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeBuffer, data]));
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

// CRC32 table
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Generate icons
const resourceDir = path.join(__dirname, '..', 'resources');

for (const [name, color] of Object.entries(COLORS)) {
  const png = createPNG(color);
  const filePath = path.join(resourceDir, `${name}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Generated ${filePath} (${png.length} bytes)`);
}

console.log('Done!');
