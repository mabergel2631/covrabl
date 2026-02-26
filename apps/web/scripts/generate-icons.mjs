/**
 * Generate PNG icons from SVG source for iOS and Android.
 *
 * Source: public/icon-512.svg (dark background + rounded corners)
 * Output: public/icons/*.png
 *
 * Run: npm run cap:build:icons
 */

import sharp from 'sharp';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SVG_SOURCE = join(ROOT, 'public', 'icon-512.svg');
const OUTPUT_DIR = join(ROOT, 'public', 'icons');

const IOS_SIZES = [
  { size: 1024, name: 'icon-1024.png' },
  { size: 180, name: 'icon-180.png' },
  { size: 167, name: 'icon-167.png' },
  { size: 152, name: 'icon-152.png' },
  { size: 120, name: 'icon-120.png' },
  { size: 87, name: 'icon-87.png' },
  { size: 80, name: 'icon-80.png' },
  { size: 76, name: 'icon-76.png' },
  { size: 60, name: 'icon-60.png' },
  { size: 58, name: 'icon-58.png' },
  { size: 40, name: 'icon-40.png' },
  { size: 20, name: 'icon-20.png' },
];

const ANDROID_SIZES = [
  { size: 512, name: 'icon-512-android.png' },
  { size: 192, name: 'icon-192.png' },
  { size: 144, name: 'icon-144.png' },
  { size: 96, name: 'icon-96.png' },
  { size: 72, name: 'icon-72.png' },
  { size: 48, name: 'icon-48.png' },
];

async function generate() {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const svgBuffer = readFileSync(SVG_SOURCE);

  console.log('Generating iOS icons...');
  for (const { size, name } of IOS_SIZES) {
    await sharp(svgBuffer, { density: 300 })
      .resize(size, size)
      .png()
      .toFile(join(OUTPUT_DIR, name));
    console.log(`  + ${name} (${size}x${size})`);
  }

  console.log('Generating Android icons...');
  for (const { size, name } of ANDROID_SIZES) {
    await sharp(svgBuffer, { density: 300 })
      .resize(size, size)
      .png()
      .toFile(join(OUTPUT_DIR, name));
    console.log(`  + ${name} (${size}x${size})`);
  }

  console.log('\nDone! Icons written to public/icons/');
}

generate().catch(console.error);
