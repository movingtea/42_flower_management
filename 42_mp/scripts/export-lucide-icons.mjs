#!/usr/bin/env node
/**
 * Export Lucide SVG icons to PNG for WeChat mini-program.
 * Do NOT use Python/PIL self-drawn icons — run this script when adding icons.
 *
 * Usage: node scripts/export-lucide-icons.mjs
 * Requires: npm install lucide-static sharp (devDependencies in 42_mp/)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MP_ROOT = path.join(__dirname, '..', 'miniprogram');
const ICONS_ROOT = path.join(MP_ROOT, 'assets', 'icons');
const TABBAR_ROOT = path.join(MP_ROOT, 'images', 'tabbar');
const LUCIDE_DIR = path.join(__dirname, '..', 'node_modules', 'lucide-static', 'icons');

const BRAND = '#8fa89b';
const MUTED = '#777777';
const ICON_SIZE = 96;
const TAB_SIZE = 81;

/** @type {Array<{ lucide: string; out: string; color?: string; size?: number }>} */
const EXPORTS = [
  // scenes — home scene entries (kebab-case filenames for CMS iconKey)
  { lucide: 'cake', out: 'scenes/birthday.png' },
  { lucide: 'calendar-heart', out: 'scenes/anniversary.png' },
  { lucide: 'hand-heart', out: 'scenes/visit.png' },
  { lucide: 'message-circle-heart', out: 'scenes/apology.png' },
  { lucide: 'handshake', out: 'scenes/business.png' },
  { lucide: 'sparkles', out: 'scenes/daily-surprise.png' },
  { lucide: 'heart', out: 'scenes/valentine.png' },
  { lucide: 'star', out: 'scenes/qixi.png' },
  { lucide: 'flower-2', out: 'scenes/mothers-day.png' },
  { lucide: 'graduation-cap', out: 'scenes/graduation.png' },
  { lucide: 'store', out: 'scenes/opening.png' },
  { lucide: 'gem', out: 'scenes/wedding.png' },
  { lucide: 'gift', out: 'scenes/gift.png' },
  { lucide: 'heart', out: 'scenes/heart.png' },
  { lucide: 'calendar-days', out: 'scenes/calendar.png' },
  { lucide: 'sparkles', out: 'scenes/sparkle.png' },
  { lucide: 'circle', out: 'scenes/custom.png' },

  // product — tags & product detail
  { lucide: 'sparkles', out: 'product/sparkles.png' },
  { lucide: 'palette', out: 'product/palette.png' },
  { lucide: 'brush', out: 'product/brush.png' },
  { lucide: 'wallet', out: 'product/wallet.png' },
  { lucide: 'users', out: 'product/users.png' },
  { lucide: 'flower-2', out: 'product/flower-2.png' },
  { lucide: 'circle-user-round', out: 'product/user-round-heart.png' },
  { lucide: 'truck', out: 'product/truck.png' },
  { lucide: 'leaf', out: 'product/leaf.png' },
  { lucide: 'mail', out: 'product/mail.png' },

  // order — checkout & recipients
  { lucide: 'circle-user-round', out: 'order/recipient.png' },
  { lucide: 'truck', out: 'order/delivery.png' },
  { lucide: 'clock', out: 'order/delivery-time.png' },
  { lucide: 'mail', out: 'order/card-message.png' },
  { lucide: 'calendar-heart', out: 'order/important-date.png' },
  { lucide: 'palette', out: 'order/preference.png' },
  { lucide: 'ban', out: 'order/disliked-flowers.png' },
  { lucide: 'sparkles', out: 'order/occasion.png' },
  { lucide: 'users', out: 'order/relation.png' },
  { lucide: 'phone', out: 'order/phone.png' },
  { lucide: 'map-pin', out: 'order/address.png' },

  // profile — mine
  { lucide: 'user-round', out: 'profile/profile.png' },
  { lucide: 'clipboard-list', out: 'profile/orders.png' },
  { lucide: 'circle-user-round', out: 'profile/recipients.png' },
  { lucide: 'calendar-days', out: 'profile/dates.png' },
  { lucide: 'headset', out: 'profile/contact.png' },
  { lucide: 'info', out: 'profile/about.png' },

  // common
  { lucide: 'circle', out: 'common/fallback.png' },
  { lucide: 'inbox', out: 'common/empty.png' },
  { lucide: 'inbox', out: 'common/empty-order.png' },
  { lucide: 'inbox', out: 'common/empty-recipient.png' },
  { lucide: 'inbox', out: 'common/empty-product.png' },
  { lucide: 'sparkles', out: 'common/scene.png' },
  { lucide: 'users', out: 'common/relationship.png' },
  { lucide: 'flower-2', out: 'common/flower.png' },
  { lucide: 'truck', out: 'common/delivery-info.png' },
  { lucide: 'leaf', out: 'common/care.png' },
  { lucide: 'shopping-cart', out: 'common/cart.png' },
  { lucide: 'sliders-horizontal', out: 'common/filter.png' },

  // tabs (assets/icons/tabs — optional reference)
  { lucide: 'house', out: 'tabs/home.png', color: MUTED },
  { lucide: 'house', out: 'tabs/home-active.png', color: BRAND },
  { lucide: 'flower-2', out: 'tabs/category.png', color: MUTED },
  { lucide: 'flower-2', out: 'tabs/category-active.png', color: BRAND },
  { lucide: 'shopping-cart', out: 'tabs/cart.png', color: MUTED },
  { lucide: 'shopping-cart', out: 'tabs/cart-active.png', color: BRAND },
  { lucide: 'user-round', out: 'tabs/mine.png', color: MUTED },
  { lucide: 'user-round', out: 'tabs/mine-active.png', color: BRAND },
];

/** TabBar paths used by app.json */
const TABBAR_EXPORTS = [
  { lucide: 'house', out: 'home.png', color: MUTED, size: TAB_SIZE },
  { lucide: 'house', out: 'home-active.png', color: BRAND, size: TAB_SIZE },
  { lucide: 'flower-2', out: 'category.png', color: MUTED, size: TAB_SIZE },
  { lucide: 'flower-2', out: 'category-active.png', color: BRAND, size: TAB_SIZE },
  { lucide: 'shopping-cart', out: 'cart.png', color: MUTED, size: TAB_SIZE },
  { lucide: 'shopping-cart', out: 'cart-active.png', color: BRAND, size: TAB_SIZE },
  { lucide: 'user-round', out: 'mine.png', color: MUTED, size: TAB_SIZE },
  { lucide: 'user-round', out: 'mine-active.png', color: BRAND, size: TAB_SIZE },
];

function readLucideSvg(name) {
  const file = path.join(LUCIDE_DIR, `${name}.svg`);
  if (!fs.existsSync(file)) {
    throw new Error(`Lucide icon not found: ${name} (${file})`);
  }
  return fs.readFileSync(file, 'utf8');
}

function colorizeSvg(svg, color) {
  return svg
    .replace(/stroke="currentColor"/g, `stroke="${color}"`)
    .replace(/fill="currentColor"/g, `fill="${color}"`)
    .replace(/<svg /, `<svg width="100%" height="100%" `);
}

async function exportPng({ lucide, out, color = BRAND, size = ICON_SIZE }, rootDir) {
  const svg = colorizeSvg(readLucideSvg(lucide), color);
  const outPath = path.join(rootDir, out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const padding = Math.round(size * 0.18);
  const inner = size - padding * 2;
  await sharp(Buffer.from(svg), { density: 300 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(outPath);
  return outPath;
}

async function main() {
  if (!fs.existsSync(LUCIDE_DIR)) {
    console.error('Missing lucide-static. Run: npm install lucide-static sharp --save-dev');
    process.exit(1);
  }

  console.log('Exporting Lucide icons to', ICONS_ROOT);
  for (const item of EXPORTS) {
    const p = await exportPng(item, ICONS_ROOT);
    console.log('  ✓', path.relative(ICONS_ROOT, p));
  }

  console.log('Exporting TabBar icons to', TABBAR_ROOT);
  for (const item of TABBAR_EXPORTS) {
    const p = await exportPng(item, TABBAR_ROOT);
    console.log('  ✓ tabbar/', path.basename(p));
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
