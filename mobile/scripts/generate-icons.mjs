/**
 * generate-icons.mjs
 * 
 * Generates Expo icon assets from the original NALISS logo.
 * The logo is NEVER modified — it is only composited onto the correct backgrounds.
 * 
 * Run from project root: node mobile/scripts/generate-icons.mjs
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const Jimp = require('../node_modules/jimp-compact');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, '..', 'assets');
const SOURCE = path.join(ASSETS, 'images', 'logo.png');

const WHITE       = 0xffffffff;
const TRANSPARENT = 0x00000000;

async function generate() {
  if (!fs.existsSync(SOURCE)) {
    console.error('❌  Source logo not found at:', SOURCE);
    process.exit(1);
  }

  console.log('📂  Loading original NALISS logo…');
  const logo = await Jimp.read(SOURCE);
  const logoW = logo.bitmap.width;
  const logoH = logo.bitmap.height;
  console.log(`    Logo dimensions: ${logoW}×${logoH}`);

  /**
   * Compose the logo onto a canvas.
   * @param {number} canvasSize - output canvas size (square)
   * @param {number} bgColor    - background color (0xRRGGBBAA)
   * @param {number} logoSize   - logo will be scaled to fit this square
   */
  async function compose(canvasSize, bgColor, logoSize) {
    const canvas = new Jimp(canvasSize, canvasSize, bgColor);
    const scaled = logo.clone().scaleToFit(logoSize, logoSize);
    const x = Math.floor((canvasSize - scaled.bitmap.width) / 2);
    const y = Math.floor((canvasSize - scaled.bitmap.height) / 2);
    canvas.composite(scaled, x, y, {
      mode: Jimp.BLEND_SOURCE_OVER,
      opacitySource: 1,
      opacityDest: 1,
    });
    return canvas;
  }

  // ── 1. icon.png ─────────────────────────────────────────────────────────────
  // 1024×1024, WHITE background, logo fills ~85% of canvas
  // iOS requires a solid background — white is the professional standard
  console.log('\n🎨  icon.png — 1024×1024, white bg, original logo…');
  const iconImg = await compose(1024, WHITE, 870);
  await iconImg.writeAsync(path.join(ASSETS, 'icon.png'));
  console.log('    ✅  Saved');

  // ── 2. splash-icon.png ──────────────────────────────────────────────────────
  // 512×512, WHITE background, logo centered
  // The splash screen backgroundColor in app.json is white (#ffffff)
  // so the logo sits on a clean white full-screen background
  console.log('🎨  splash-icon.png — 512×512, white bg, original logo…');
  const splashImg = await compose(512, WHITE, 430);
  await splashImg.writeAsync(path.join(ASSETS, 'splash-icon.png'));
  console.log('    ✅  Saved');

  // ── 3. android-icon-foreground.png ──────────────────────────────────────────
  // 1024×1024, TRANSPARENT background, logo in safe zone (66% = ~680px)
  // Android adaptive icon: foreground layer, background is set in app.json
  console.log('🎨  android-icon-foreground.png — 1024×1024, transparent, original logo…');
  const androidFg = await compose(1024, TRANSPARENT, 660);
  await androidFg.writeAsync(path.join(ASSETS, 'android-icon-foreground.png'));
  console.log('    ✅  Saved');

  // ── 4. android-icon-monochrome.png ──────────────────────────────────────────
  // Same as foreground — Android 13+ uses this for themed/tinted icons
  console.log('🎨  android-icon-monochrome.png — 1024×1024, transparent, original logo…');
  const monoImg = await compose(1024, TRANSPARENT, 660);
  await monoImg.writeAsync(path.join(ASSETS, 'android-icon-monochrome.png'));
  console.log('    ✅  Saved');

  // ── 5. favicon.png ──────────────────────────────────────────────────────────
  // 64×64, white bg, logo
  console.log('🎨  favicon.png — 64×64, white bg, original logo…');
  const faviconImg = await compose(64, WHITE, 54);
  await faviconImg.writeAsync(path.join(ASSETS, 'favicon.png'));
  console.log('    ✅  Saved');

  console.log('\n✅  All assets generated. Original logo was NOT modified.');
  console.log('   icon.png                    — 1024×1024 white bg');
  console.log('   splash-icon.png             — 512×512  white bg');
  console.log('   android-icon-foreground.png — 1024×1024 transparent');
  console.log('   android-icon-monochrome.png — 1024×1024 transparent');
  console.log('   favicon.png                 — 64×64    white bg');
}

generate().catch(err => {
  console.error('❌  Error:', err.message);
  process.exit(1);
});
