// 앱 아이콘/스플래시 생성기 — `cd scripts && node generate-icons.js`
//
// source/capybara.jpg(캐릭터 원본)를 인형뽑기 기계 창(분홍 테두리 + 전구 + 유리 반사) 안에 넣는다.
//
// 출력:
//   assets/icon.png, adaptive-icon.png, splash-icon.png, favicon.png  (app.json — prebuild 시 사용)
//   assets/store/play-icon-512.png                                    (Play Console 고해상도 아이콘)
//   android/app/src/main/res/mipmap-*, drawable-*/splashscreen_logo.png
//
// android/ 는 prebuild 없이 Gradle로 직접 빌드하므로 assets/ 만 바꾸면 실제 런처 아이콘은 그대로다.
// 그래서 네이티브 리소스도 여기서 함께 덮어쓴다.

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'assets');
const RES_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const SOURCE = path.join(__dirname, 'source', 'capybara.jpg');

// app.json의 adaptiveIcon.backgroundColor / colors.xml의 iconBackground 와 같은 값
const BG = '#1a1a2e';

// 마크(창 + 테두리 + 전구)의 중심과 바깥 반지름(전구 포함). 변형 크기는 이 값 기준으로 잡는다.
const C = 512;
const MARK_R = 392;
const WINDOW_R = 330;
const FRAME_R = 368;

// 원본은 정사각형 안에 꽉 찬 크림색 원 배경(반지름 ≈ 이미지 폭의 절반)이고 모서리만 흰색이다.
// 원 테두리의 안티앨리어싱이 보이지 않도록 원의 97% 지점을 창 가장자리 바로 바깥에 맞춘다.
const SOURCE_CIRCLE = 0.97;
const IMAGE_SIZE = Math.round(((WINDOW_R + 4) * 2) / SOURCE_CIRCLE);

// 중심 C 기준 반지름 r, 각도 a0→a1(도, 시계 방향) 호
function arc(r, a0, a1) {
  const pt = (a) => [C + r * Math.cos((a * Math.PI) / 180), C + r * Math.sin((a * Math.PI) / 180)].map((v) => v.toFixed(1));
  const [x0, y0] = pt(a0);
  const [x1, y1] = pt(a1);
  return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
}

function svg(imageHref, { scale, background = '' }) {
  const bulbs = Array.from({ length: 20 }, (_, i) => {
    const a = ((i + 0.5) / 20) * Math.PI * 2 - Math.PI / 2;
    const x = (C + Math.cos(a) * FRAME_R).toFixed(1);
    const y = (C + Math.sin(a) * FRAME_R).toFixed(1);
    const fill = i % 2 ? '#ffd54f' : '#fff8d6';
    return `<circle cx="${x}" cy="${y}" r="13" fill="${fill}" filter="url(#glow)"/>`;
  }).join('');

  return `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <radialGradient id="bgGlow" cx="50%" cy="48%" r="60%">
      <stop offset="0%" stop-color="#2a2350"/>
      <stop offset="100%" stop-color="${BG}"/>
    </radialGradient>
    <linearGradient id="frame" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ff7ab2"/>
      <stop offset="100%" stop-color="#e2407f"/>
    </linearGradient>
    <clipPath id="windowClip"><circle cx="${C}" cy="${C}" r="${WINDOW_R}"/></clipPath>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="7" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  ${background}
  <g transform="translate(512 512) scale(${scale}) translate(${-C} ${-C})">
    <circle cx="${C}" cy="${C}" r="${FRAME_R}" fill="none" stroke="url(#frame)" stroke-width="46"/>
    <circle cx="${C}" cy="${C}" r="${WINDOW_R + 8}" fill="${BG}"/>
    <g clip-path="url(#windowClip)">
      <image xlink:href="${imageHref}" x="${C - IMAGE_SIZE / 2}" y="${C - IMAGE_SIZE / 2}" width="${IMAGE_SIZE}" height="${IMAGE_SIZE}" preserveAspectRatio="none"/>
    </g>
    <!-- 유리 반사: 얼굴을 가리지 않도록 창 가장자리를 따라 짧은 호로만 -->
    <path d="${arc(WINDOW_R - 28, 196, 248)}" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="16" stroke-linecap="round"/>
    <path d="${arc(WINDOW_R - 28, 257, 266)}" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="16" stroke-linecap="round"/>
    ${bulbs}
  </g>
</svg>`;
}

const fullBg = `<rect width="1024" height="1024" fill="url(#bgGlow)"/>`;
const roundedBg = `<rect x="32" y="32" width="960" height="960" rx="200" fill="url(#bgGlow)"/>`;
const circleBg = `<circle cx="512" cy="512" r="496" fill="url(#bgGlow)"/>`;

// scale: 마크 바깥 반지름(MARK_R) 대비 배율
const VARIANT_OPTS = {
  // iOS·Play 스토어용: 정사각형 꽉 채움(모서리 마스크는 OS/스토어가 씌운다)
  full: { scale: 460 / MARK_R, background: fullBg },
  // Android 7.x 이하 레거시 런처 아이콘
  legacy: { scale: 430 / MARK_R, background: roundedBg },
  legacyRound: { scale: 440 / MARK_R, background: circleBg },
  // 적응형 전경: 108dp 중 지름 66dp(반지름 ≈313px) 안전 영역 안에 마크를 넣는다
  foreground: { scale: 312 / MARK_R },
  splash: { scale: 300 / MARK_R },
};

async function buildVariants() {
  // 원본이 작으므로(160px) SVG 렌더러에 맡기지 않고 lanczos로 미리 키워 넣는다
  const png = await sharp(SOURCE).resize(1024, 1024, { kernel: 'lanczos3' }).png().toBuffer();
  const href = `data:image/png;base64,${png.toString('base64')}`;
  return Object.fromEntries(Object.entries(VARIANT_OPTS).map(([k, o]) => [k, svg(href, o)]));
}

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

async function generateIcons() {
  const variants = await buildVariants();
  const render = (key, size) => sharp(Buffer.from(variants[key])).resize(size, size);

  await render('full', 1024).png().toFile(path.join(ASSETS_DIR, 'icon.png'));
  await render('foreground', 1024).png().toFile(path.join(ASSETS_DIR, 'adaptive-icon.png'));
  await render('splash', 1024).png().toFile(path.join(ASSETS_DIR, 'splash-icon.png'));
  await render('legacy', 48).png().toFile(path.join(ASSETS_DIR, 'favicon.png'));

  fs.mkdirSync(path.join(ASSETS_DIR, 'store'), { recursive: true });
  await render('full', 512).png().toFile(path.join(ASSETS_DIR, 'store', 'play-icon-512.png'));
  console.log('assets/ done');

  if (!fs.existsSync(RES_DIR)) {
    console.log('android/ not found — skipped native resources');
    return;
  }
  for (const [dpi, k] of Object.entries(DENSITIES)) {
    const mipmap = path.join(RES_DIR, `mipmap-${dpi}`);
    await render('legacy', 48 * k).webp({ lossless: true }).toFile(path.join(mipmap, 'ic_launcher.webp'));
    await render('legacyRound', 48 * k).webp({ lossless: true }).toFile(path.join(mipmap, 'ic_launcher_round.webp'));
    await render('foreground', 108 * k).webp({ lossless: true }).toFile(path.join(mipmap, 'ic_launcher_foreground.webp'));
    await render('splash', 288 * k).png().toFile(path.join(RES_DIR, `drawable-${dpi}`, 'splashscreen_logo.png'));
  }
  console.log('android/ res done');
}

module.exports = { buildVariants };

if (require.main === module) {
  generateIcons().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
