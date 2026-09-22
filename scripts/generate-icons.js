const sharp = require('sharp');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

const iconSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0f0f23"/>
      <stop offset="50%" style="stop-color:#1a1a2e"/>
      <stop offset="100%" style="stop-color:#16213e"/>
    </linearGradient>
    <linearGradient id="metalShaft" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#999"/>
      <stop offset="30%" style="stop-color:#ddd"/>
      <stop offset="50%" style="stop-color:#eee"/>
      <stop offset="70%" style="stop-color:#ddd"/>
      <stop offset="100%" style="stop-color:#999"/>
    </linearGradient>
    <linearGradient id="metalJoint" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#bbb"/>
      <stop offset="50%" style="stop-color:#888"/>
      <stop offset="100%" style="stop-color:#666"/>
    </linearGradient>
    <linearGradient id="armLeft" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#ccc"/>
      <stop offset="40%" style="stop-color:#aaa"/>
      <stop offset="100%" style="stop-color:#888"/>
    </linearGradient>
    <linearGradient id="armRight" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#ccc"/>
      <stop offset="40%" style="stop-color:#aaa"/>
      <stop offset="100%" style="stop-color:#888"/>
    </linearGradient>
    <!-- 카피바라 색상 -->
    <linearGradient id="capyBody" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#9B7654"/>
      <stop offset="100%" style="stop-color:#7D5E3E"/>
    </linearGradient>
    <linearGradient id="capyBelly" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#C4A67A"/>
      <stop offset="100%" style="stop-color:#B08F66"/>
    </linearGradient>
    <radialGradient id="capyHeadG" cx="50%" cy="45%" r="55%">
      <stop offset="0%" style="stop-color:#B8926C"/>
      <stop offset="100%" style="stop-color:#9B7654"/>
    </radialGradient>
    <radialGradient id="capySnoutG" cx="50%" cy="40%" r="55%">
      <stop offset="0%" style="stop-color:#C4A67A"/>
      <stop offset="100%" style="stop-color:#A08460"/>
    </radialGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glowStrong">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="shadow">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="rgba(0,0,0,0.4)"/>
    </filter>
  </defs>

  <!-- 배경 -->
  <rect width="1024" height="1024" rx="220" fill="url(#bg)"/>

  <!-- ===== 크레인 집게 ===== -->
  <line x1="512" y1="0" x2="512" y2="80" stroke="#777" stroke-width="6"/>
  <line x1="510" y1="0" x2="510" y2="80" stroke="#aaa" stroke-width="2"/>
  <!-- 샤프트 -->
  <rect x="488" y="68" width="48" height="130" rx="6" fill="url(#metalShaft)" stroke="#777" stroke-width="2"/>
  <rect x="505" y="72" width="8" height="122" rx="3" fill="rgba(255,255,255,0.25)"/>
  <circle cx="512" cy="98" r="5" fill="#999" stroke="#777" stroke-width="1.5"/>
  <circle cx="512" cy="132" r="5" fill="#999" stroke="#777" stroke-width="1.5"/>
  <circle cx="512" cy="166" r="5" fill="#999" stroke="#777" stroke-width="1.5"/>
  <!-- 조인트 -->
  <rect x="468" y="195" width="88" height="42" rx="10" fill="url(#metalJoint)" stroke="#666" stroke-width="2.5"/>
  <circle cx="485" cy="216" r="7" fill="#999" stroke="#777" stroke-width="2"/>
  <circle cx="485" cy="216" r="3" fill="#777"/>
  <circle cx="539" cy="216" r="7" fill="#999" stroke="#777" stroke-width="2"/>
  <circle cx="539" cy="216" r="3" fill="#777"/>
  <rect x="472" y="199" width="80" height="4" rx="2" fill="rgba(255,255,255,0.15)"/>
  <!-- 왼쪽 팔 -->
  <path d="M 478 237 C 460 288, 430 348, 405 408 C 398 426, 395 436, 400 446 C 405 456, 418 458, 425 450 C 435 436, 450 378, 470 308 Z"
        fill="url(#armLeft)" stroke="#777" stroke-width="2.5" stroke-linejoin="round" filter="url(#shadow)"/>
  <path d="M 472 250 C 458 290, 438 340, 420 400" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="4" stroke-linecap="round"/>
  <path d="M 400 446 C 392 460, 390 470, 398 478 C 406 486, 420 483, 425 473 C 430 463, 428 453, 425 450" fill="#aaa" stroke="#777" stroke-width="2"/>
  <path d="M 398 478 L 403 472 L 408 478 L 413 472 L 418 478" fill="none" stroke="#888" stroke-width="2"/>
  <!-- 오른쪽 팔 -->
  <path d="M 546 237 C 564 288, 594 348, 619 408 C 626 426, 629 436, 624 446 C 619 456, 606 458, 599 450 C 589 436, 574 378, 554 308 Z"
        fill="url(#armRight)" stroke="#777" stroke-width="2.5" stroke-linejoin="round" filter="url(#shadow)"/>
  <path d="M 552 250 C 566 290, 586 340, 604 400" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="4" stroke-linecap="round"/>
  <path d="M 624 446 C 632 460, 634 470, 626 478 C 618 486, 604 483, 599 473 C 594 463, 596 453, 599 450" fill="#aaa" stroke="#777" stroke-width="2"/>
  <path d="M 606 478 L 611 472 L 616 478 L 621 472 L 626 478" fill="none" stroke="#888" stroke-width="2"/>

  <!-- ===== 카피바라 인형 ===== -->

  <!-- 몸통 (통통한 배럴형) -->
  <ellipse cx="512" cy="720" rx="155" ry="145" fill="url(#capyBody)" filter="url(#shadow)"/>
  <!-- 배 -->
  <ellipse cx="512" cy="740" rx="108" ry="100" fill="url(#capyBelly)"/>

  <!-- 앞발 (짧고 통통) -->
  <ellipse cx="388" cy="740" rx="35" ry="50" fill="#8B6B48" transform="rotate(-8 388 740)"/>
  <ellipse cx="388" cy="772" rx="28" ry="15" fill="#7D5E3E" transform="rotate(-5 388 772)"/>
  <ellipse cx="636" cy="740" rx="35" ry="50" fill="#8B6B48" transform="rotate(8 636 740)"/>
  <ellipse cx="636" cy="772" rx="28" ry="15" fill="#7D5E3E" transform="rotate(5 636 772)"/>

  <!-- 뒷발 -->
  <ellipse cx="435" cy="842" rx="44" ry="20" fill="#7D5E3E"/>
  <ellipse cx="589" cy="842" rx="44" ry="20" fill="#7D5E3E"/>

  <!-- 머리 (카피바라 특유의 크고 넓적한 직사각형 머리) -->
  <rect x="370" y="430" width="284" height="200" rx="90" fill="url(#capyHeadG)"/>
  <!-- 머리 상단 둥근 부분 -->
  <ellipse cx="512" cy="445" rx="135" ry="60" fill="url(#capyHeadG)"/>
  <!-- 머리 측면 볼록 -->
  <ellipse cx="395" cy="520" rx="40" ry="60" fill="#A07B58"/>
  <ellipse cx="629" cy="520" rx="40" ry="60" fill="#A07B58"/>

  <!-- 귀 (카피바라 = 아주 작고 둥근 귀, 머리 옆 위) -->
  <ellipse cx="390" cy="425" rx="22" ry="18" fill="#8B6B48" transform="rotate(-20 390 425)"/>
  <ellipse cx="390" cy="425" rx="13" ry="10" fill="#A08460" transform="rotate(-20 390 425)"/>
  <ellipse cx="634" cy="425" rx="22" ry="18" fill="#8B6B48" transform="rotate(20 634 425)"/>
  <ellipse cx="634" cy="425" rx="13" ry="10" fill="#A08460" transform="rotate(20 634 425)"/>

  <!-- 눈 (카피바라 = 작고 동그랗고 머리 높은 곳에 위치, 간격 넓음) -->
  <circle cx="448" cy="480" r="14" fill="#1a0e05"/>
  <circle cx="454" cy="475" r="5" fill="#fff"/>
  <circle cx="447" cy="484" r="2.5" fill="rgba(255,255,255,0.35)"/>
  <circle cx="576" cy="480" r="14" fill="#1a0e05"/>
  <circle cx="582" cy="475" r="5" fill="#fff"/>
  <circle cx="575" cy="484" r="2.5" fill="rgba(255,255,255,0.35)"/>

  <!-- 주둥이 (카피바라 = 매우 크고 네모난 코 영역, 얼굴의 절반 차지) -->
  <rect x="440" y="510" width="144" height="100" rx="42" fill="url(#capySnoutG)" stroke="#8B6B48" stroke-width="2"/>
  <!-- 주둥이 하이라이트 -->
  <rect x="460" y="520" width="104" height="55" rx="26" fill="rgba(255,255,255,0.08)"/>

  <!-- 콧구멍 (카피바라 = 크고 동그란 콧구멍 2개, 간격 넓음) -->
  <ellipse cx="486" cy="540" rx="14" ry="11" fill="#6B4F35"/>
  <ellipse cx="486" cy="538" rx="8" ry="5" fill="#5A4030"/>
  <ellipse cx="538" cy="540" rx="14" ry="11" fill="#6B4F35"/>
  <ellipse cx="538" cy="538" rx="8" ry="5" fill="#5A4030"/>

  <!-- 입 (카피바라 특유의 살짝 미소) -->
  <path d="M 486 575 Q 500 590 512 590 Q 524 590 538 575" fill="none" stroke="#6B4F35" stroke-width="3.5" stroke-linecap="round"/>
  <!-- 이빨 (카피바라 특유의 앞니 살짝) -->
  <rect x="503" y="585" width="7" height="9" rx="2" fill="#F5F0E0" stroke="#D5C8B0" stroke-width="0.8"/>
  <rect x="514" y="585" width="7" height="9" rx="2" fill="#F5F0E0" stroke="#D5C8B0" stroke-width="0.8"/>

  <!-- 수염 점 (카피바라 특유의 주둥이 점) -->
  <circle cx="445" cy="545" r="3" fill="#7D5E3E"/>
  <circle cx="440" cy="555" r="2.5" fill="#7D5E3E"/>
  <circle cx="450" cy="562" r="2.5" fill="#7D5E3E"/>
  <circle cx="579" cy="545" r="3" fill="#7D5E3E"/>
  <circle cx="584" cy="555" r="2.5" fill="#7D5E3E"/>
  <circle cx="574" cy="562" r="2.5" fill="#7D5E3E"/>

  <!-- 볼터치 -->
  <ellipse cx="425" cy="530" rx="25" ry="14" fill="rgba(200,130,90,0.25)"/>
  <ellipse cx="599" cy="530" rx="25" ry="14" fill="rgba(200,130,90,0.25)"/>

  <!-- 머리 위 털 (카피바라 거친 털 표현) -->
  <path d="M 480 400 Q 485 385 490 400" fill="none" stroke="#8B6B48" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M 505 395 Q 512 378 519 395" fill="none" stroke="#8B6B48" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M 530 400 Q 535 385 540 400" fill="none" stroke="#8B6B48" stroke-width="2.5" stroke-linecap="round"/>

  <!-- ===== 조준경 (네온 글로우) ===== -->
  <circle cx="512" cy="580" r="220" fill="none" stroke="#00e676" stroke-width="4.5" opacity="0.65" filter="url(#glow)"/>
  <circle cx="512" cy="580" r="148" fill="none" stroke="#00e676" stroke-width="3" opacity="0.45" filter="url(#glow)"/>
  <circle cx="512" cy="580" r="75" fill="none" stroke="#00e676" stroke-width="2" opacity="0.35"/>
  <!-- 크로스헤어 -->
  <line x1="258" y1="580" x2="425" y2="580" stroke="#00e676" stroke-width="3.5" opacity="0.75" filter="url(#glow)"/>
  <line x1="599" y1="580" x2="766" y2="580" stroke="#00e676" stroke-width="3.5" opacity="0.75" filter="url(#glow)"/>
  <line x1="512" y1="326" x2="512" y2="493" stroke="#00e676" stroke-width="3.5" opacity="0.75" filter="url(#glow)"/>
  <line x1="512" y1="667" x2="512" y2="834" stroke="#00e676" stroke-width="3.5" opacity="0.75" filter="url(#glow)"/>
  <!-- 눈금 -->
  <line x1="425" y1="572" x2="425" y2="588" stroke="#00e676" stroke-width="2" opacity="0.5"/>
  <line x1="599" y1="572" x2="599" y2="588" stroke="#00e676" stroke-width="2" opacity="0.5"/>
  <line x1="504" y1="493" x2="520" y2="493" stroke="#00e676" stroke-width="2" opacity="0.5"/>
  <line x1="504" y1="667" x2="520" y2="667" stroke="#00e676" stroke-width="2" opacity="0.5"/>
  <!-- 중앙 다이아몬드 -->
  <polygon points="512,570 522,580 512,590 502,580" fill="#00e676" opacity="0.9" filter="url(#glowStrong)"/>

  <!-- AI 텍스트 -->
  <text x="512" y="955" text-anchor="middle" font-family="Arial, sans-serif" font-size="74" font-weight="bold" fill="#00e676" filter="url(#glow)">AI</text>
</svg>`;

const adaptiveIconSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="metalShaft" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#999"/><stop offset="30%" style="stop-color:#ddd"/>
      <stop offset="50%" style="stop-color:#eee"/><stop offset="70%" style="stop-color:#ddd"/>
      <stop offset="100%" style="stop-color:#999"/>
    </linearGradient>
    <linearGradient id="metalJoint" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#bbb"/><stop offset="50%" style="stop-color:#888"/>
      <stop offset="100%" style="stop-color:#666"/>
    </linearGradient>
    <linearGradient id="armLeft" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#ccc"/><stop offset="40%" style="stop-color:#aaa"/>
      <stop offset="100%" style="stop-color:#888"/>
    </linearGradient>
    <linearGradient id="armRight" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#ccc"/><stop offset="40%" style="stop-color:#aaa"/>
      <stop offset="100%" style="stop-color:#888"/>
    </linearGradient>
    <linearGradient id="capyBody" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#9B7654"/><stop offset="100%" style="stop-color:#7D5E3E"/>
    </linearGradient>
    <linearGradient id="capyBelly" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#C4A67A"/><stop offset="100%" style="stop-color:#B08F66"/>
    </linearGradient>
    <radialGradient id="capyHeadG" cx="50%" cy="45%" r="55%">
      <stop offset="0%" style="stop-color:#B8926C"/><stop offset="100%" style="stop-color:#9B7654"/>
    </radialGradient>
    <radialGradient id="capySnoutG" cx="50%" cy="40%" r="55%">
      <stop offset="0%" style="stop-color:#C4A67A"/><stop offset="100%" style="stop-color:#A08460"/>
    </radialGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glowStrong">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- 크레인 -->
  <line x1="512" y1="30" x2="512" y2="98" stroke="#777" stroke-width="5"/>
  <rect x="490" y="88" width="44" height="115" rx="5" fill="url(#metalShaft)" stroke="#777" stroke-width="2"/>
  <rect x="505" y="92" width="7" height="108" rx="3" fill="rgba(255,255,255,0.2)"/>
  <circle cx="512" cy="115" r="4" fill="#999" stroke="#777" stroke-width="1.5"/>
  <circle cx="512" cy="148" r="4" fill="#999" stroke="#777" stroke-width="1.5"/>
  <rect x="474" y="202" width="76" height="36" rx="9" fill="url(#metalJoint)" stroke="#666" stroke-width="2"/>
  <circle cx="490" cy="220" r="5.5" fill="#999" stroke="#777" stroke-width="1.5"/>
  <circle cx="534" cy="220" r="5.5" fill="#999" stroke="#777" stroke-width="1.5"/>
  <path d="M 484 238 C 468 284, 442 338, 420 392 C 414 408, 412 416, 416 424 C 420 432, 430 434, 435 427 C 442 416, 456 368, 474 304 Z"
        fill="url(#armLeft)" stroke="#777" stroke-width="2"/>
  <path d="M 416 424 C 410 436, 408 444, 414 450 C 420 456, 430 454, 435 446 C 438 438, 436 430, 435 427" fill="#aaa" stroke="#777" stroke-width="1.5"/>
  <path d="M 540 238 C 556 284, 582 338, 604 392 C 610 408, 612 416, 608 424 C 604 432, 594 434, 589 427 C 582 416, 568 368, 550 304 Z"
        fill="url(#armRight)" stroke="#777" stroke-width="2"/>
  <path d="M 608 424 C 614 436, 616 444, 610 450 C 604 456, 594 454, 589 446 C 586 438, 588 430, 589 427" fill="#aaa" stroke="#777" stroke-width="1.5"/>

  <!-- 카피바라 -->
  <ellipse cx="512" cy="710" rx="145" ry="138" fill="url(#capyBody)"/>
  <ellipse cx="512" cy="728" rx="100" ry="95" fill="url(#capyBelly)"/>
  <ellipse cx="396" cy="730" rx="32" ry="45" fill="#8B6B48" transform="rotate(-8 396 730)"/>
  <ellipse cx="628" cy="730" rx="32" ry="45" fill="#8B6B48" transform="rotate(8 628 730)"/>
  <ellipse cx="440" cy="830" rx="40" ry="18" fill="#7D5E3E"/>
  <ellipse cx="584" cy="830" rx="40" ry="18" fill="#7D5E3E"/>

  <rect x="378" y="432" width="268" height="188" rx="84" fill="url(#capyHeadG)"/>
  <ellipse cx="512" cy="446" rx="128" ry="55" fill="url(#capyHeadG)"/>
  <ellipse cx="402" cy="518" rx="36" ry="55" fill="#A07B58"/>
  <ellipse cx="622" cy="518" rx="36" ry="55" fill="#A07B58"/>

  <ellipse cx="396" cy="425" rx="20" ry="16" fill="#8B6B48" transform="rotate(-20 396 425)"/>
  <ellipse cx="396" cy="425" rx="12" ry="9" fill="#A08460" transform="rotate(-20 396 425)"/>
  <ellipse cx="628" cy="425" rx="20" ry="16" fill="#8B6B48" transform="rotate(20 628 425)"/>
  <ellipse cx="628" cy="425" rx="12" ry="9" fill="#A08460" transform="rotate(20 628 425)"/>

  <circle cx="452" cy="480" r="13" fill="#1a0e05"/>
  <circle cx="457" cy="476" r="4.5" fill="#fff"/>
  <circle cx="572" cy="480" r="13" fill="#1a0e05"/>
  <circle cx="577" cy="476" r="4.5" fill="#fff"/>

  <rect x="446" y="510" width="132" height="92" rx="38" fill="url(#capySnoutG)" stroke="#8B6B48" stroke-width="1.5"/>
  <ellipse cx="490" cy="538" rx="12" ry="10" fill="#6B4F35"/>
  <ellipse cx="534" cy="538" rx="12" ry="10" fill="#6B4F35"/>
  <path d="M 490 570 Q 502 584 512 584 Q 522 584 534 570" fill="none" stroke="#6B4F35" stroke-width="3" stroke-linecap="round"/>
  <rect x="505" y="580" width="6" height="8" rx="1.5" fill="#F5F0E0" stroke="#D5C8B0" stroke-width="0.7"/>
  <rect x="514" y="580" width="6" height="8" rx="1.5" fill="#F5F0E0" stroke="#D5C8B0" stroke-width="0.7"/>

  <circle cx="450" cy="542" r="2.5" fill="#7D5E3E"/>
  <circle cx="446" cy="552" r="2" fill="#7D5E3E"/>
  <circle cx="574" cy="542" r="2.5" fill="#7D5E3E"/>
  <circle cx="578" cy="552" r="2" fill="#7D5E3E"/>

  <path d="M 484 398 Q 488 385 492 398" fill="none" stroke="#8B6B48" stroke-width="2" stroke-linecap="round"/>
  <path d="M 508 394 Q 512 380 516 394" fill="none" stroke="#8B6B48" stroke-width="2" stroke-linecap="round"/>
  <path d="M 532 398 Q 536 385 540 398" fill="none" stroke="#8B6B48" stroke-width="2" stroke-linecap="round"/>

  <!-- 조준경 -->
  <circle cx="512" cy="575" r="210" fill="none" stroke="#00e676" stroke-width="4" opacity="0.65" filter="url(#glow)"/>
  <circle cx="512" cy="575" r="140" fill="none" stroke="#00e676" stroke-width="2.8" opacity="0.45" filter="url(#glow)"/>
  <circle cx="512" cy="575" r="70" fill="none" stroke="#00e676" stroke-width="1.8" opacity="0.35"/>
  <line x1="270" y1="575" x2="430" y2="575" stroke="#00e676" stroke-width="3" opacity="0.75" filter="url(#glow)"/>
  <line x1="594" y1="575" x2="754" y2="575" stroke="#00e676" stroke-width="3" opacity="0.75" filter="url(#glow)"/>
  <line x1="512" y1="333" x2="512" y2="493" stroke="#00e676" stroke-width="3" opacity="0.75" filter="url(#glow)"/>
  <line x1="512" y1="657" x2="512" y2="817" stroke="#00e676" stroke-width="3" opacity="0.75" filter="url(#glow)"/>
  <polygon points="512,566 521,575 512,584 503,575" fill="#00e676" opacity="0.9" filter="url(#glowStrong)"/>

  <text x="512" y="940" text-anchor="middle" font-family="Arial, sans-serif" font-size="66" font-weight="bold" fill="#00e676" filter="url(#glow)">AI</text>
</svg>`;

async function generateIcons() {
  await sharp(Buffer.from(iconSvg))
    .resize(1024, 1024).png()
    .toFile(path.join(ASSETS_DIR, 'icon.png'));
  console.log('icon.png');

  await sharp(Buffer.from(adaptiveIconSvg))
    .resize(1024, 1024).png()
    .toFile(path.join(ASSETS_DIR, 'adaptive-icon.png'));
  console.log('adaptive-icon.png');

  const splashIcon = await sharp(Buffer.from(iconSvg))
    .resize(400, 400).png().toBuffer();
  await sharp({
    create: { width: 1284, height: 2778, channels: 4, background: { r: 15, g: 15, b: 35, alpha: 1 } }
  }).composite([{ input: splashIcon, gravity: 'center' }])
    .png().toFile(path.join(ASSETS_DIR, 'splash-icon.png'));
  console.log('splash-icon.png');

  await sharp(Buffer.from(iconSvg))
    .resize(48, 48).png()
    .toFile(path.join(ASSETS_DIR, 'favicon.png'));
  console.log('favicon.png');

  console.log('Done!');
}

generateIcons().catch(console.error);
