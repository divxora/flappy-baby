import { CustomGameConfig, ImageSlotConfig } from '../types/game';

export interface PillarPair {
  id: number;
  /** Center X position of the pillar pair */
  x: number;
  /** Vertical center of the playable gap */
  gapY: number;
  gapHeight: number;
  scored: boolean;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  rotation: number;
  vRot: number;
}

export interface BirdState {
  x: number;
  y: number;
  vy: number;
}

/**
 * Computes source crop rectangle in pixels from normalized 0..1 coordinates.
 */
export function getSourceCropRect(
  img: HTMLImageElement,
  cfg: ImageSlotConfig
): { sx: number; sy: number; sw: number; sh: number } {
  const nw = img.naturalWidth || img.width || 1;
  const nh = img.naturalHeight || img.height || 1;
  const sx = Math.max(0, Math.min(nw - 1, cfg.cropX * nw));
  const sy = Math.max(0, Math.min(nh - 1, cfg.cropY * nh));
  const sw = Math.max(1, Math.min(nw - sx, cfg.cropWidth * nw));
  const sh = Math.max(1, Math.min(nh - sy, cfg.cropHeight * nh));
  return { sx, sy, sw, sh };
}

/**
 * Draws a cropped image inside a target rectangle without stretching or distortion.
 */
export function drawCroppedImageInBox(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cfg: ImageSlotConfig,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  options?: {
    extraRotationRad?: number;
    anchorEdge?: 'top' | 'bottom' | 'center';
    scrollOffsetX?: number;
  }
) {
  if (boxW <= 0 || boxH <= 0) return;

  const { sx, sy, sw, sh } = getSourceCropRect(img, cfg);
  const srcAspect = sw / sh;
  const boxAspect = boxW / boxH;
  const scaleMult = Math.max(0.2, cfg.imageScale || 1);

  ctx.save();
  ctx.beginPath();
  ctx.rect(boxX, boxY, boxW, boxH);
  ctx.clip();

  if (cfg.scaleMode === 'tile') {
    // Tile preserves aspect ratio at target box width (for pillars) or scaled unit height
    const tileW = Math.max(12, boxW * scaleMult);
    const tileH = Math.max(12, tileW / srcAspect);
    const anchor = options?.anchorEdge ?? 'center';
    const startY =
      anchor === 'bottom'
        ? boxY + boxH - Math.ceil(boxH / tileH) * tileH
        : boxY;
    const cols = Math.ceil(boxW / tileW) + 2;
    const rows = Math.ceil(boxH / tileH) + 2;
    const scrollX = ((options?.scrollOffsetX ?? 0) % tileW + tileW) % tileW;

    for (let r = -1; r < rows; r++) {
      for (let c = -1; c < cols; c++) {
        const dx = boxX + c * tileW - scrollX + cfg.offsetX;
        const dy = startY + r * tileH + cfg.offsetY;
        ctx.save();
        ctx.translate(dx + tileW / 2, dy + tileH / 2);
        if (cfg.rotation) ctx.rotate((cfg.rotation * Math.PI) / 180);
        ctx.scale(cfg.flipHorizontal ? -1 : 1, cfg.flipVertical ? -1 : 1);
        ctx.drawImage(img, sx, sy, sw, sh, -tileW / 2, -tileH / 2, tileW, tileH);
        ctx.restore();
      }
    }
    ctx.restore();
    return;
  }

  let drawW: number;
  let drawH: number;

  if (cfg.scaleMode === 'cover') {
    if (srcAspect > boxAspect) {
      drawH = boxH;
      drawW = drawH * srcAspect;
    } else {
      drawW = boxW;
      drawH = drawW / srcAspect;
    }
  } else {
    // contain
    if (srcAspect > boxAspect) {
      drawW = boxW;
      drawH = drawW / srcAspect;
    } else {
      drawH = boxH;
      drawW = drawH * srcAspect;
    }
  }

  drawW *= scaleMult;
  drawH *= scaleMult;

  const anchor = options?.anchorEdge ?? 'center';
  const cx = boxX + boxW / 2 + cfg.offsetX;
  let cy = boxY + boxH / 2 + cfg.offsetY;

  if (anchor === 'bottom') {
    // Anchor bottom of artwork toward bottom of upper pillar (the gap lip)
    cy = boxY + boxH - drawH / 2 + cfg.offsetY;
  } else if (anchor === 'top') {
    // Anchor top of artwork toward top of lower pillar (the gap lip)
    cy = boxY + drawH / 2 + cfg.offsetY;
  }

  const totalRot = ((cfg.rotation || 0) * Math.PI) / 180 + (options?.extraRotationRad ?? 0);

  if (options?.scrollOffsetX && Math.abs(options.scrollOffsetX) > 0.01) {
    // Seamless horizontal parallax wrap for background
    const tileSpan = Math.max(boxW, drawW);
    const shift = ((options.scrollOffsetX % tileSpan) + tileSpan) % tileSpan;
    for (let k = -1; k <= 1; k++) {
      ctx.save();
      ctx.translate(cx - shift + k * tileSpan, cy);
      if (totalRot) ctx.rotate(totalRot);
      ctx.scale(cfg.flipHorizontal ? -1 : 1, cfg.flipVertical ? -1 : 1);
      ctx.drawImage(img, sx, sy, sw, sh, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
    }
  } else {
    ctx.translate(cx, cy);
    if (totalRot) ctx.rotate(totalRot);
    ctx.scale(cfg.flipHorizontal ? -1 : 1, cfg.flipVertical ? -1 : 1);
    ctx.drawImage(img, sx, sy, sw, sh, -drawW / 2, -drawH / 2, drawW, drawH);
  }

  ctx.restore();
}

export function renderBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  groundHeight: number,
  scrollDistance: number,
  config: CustomGameConfig,
  bgImage?: HTMLImageElement
) {
  const playableHeight = height - groundHeight;
  const bgCfg = config.images.background;

  if (bgCfg.hasAsset && bgImage && bgImage.complete && bgImage.naturalWidth > 0) {
    ctx.fillStyle = '#0B1120';
    ctx.fillRect(0, 0, width, playableHeight);
    drawCroppedImageInBox(ctx, bgImage, bgCfg, 0, 0, width, playableHeight, {
      scrollOffsetX: scrollDistance * bgCfg.parallaxSpeed,
    });
    if (bgCfg.dimOpacity > 0) {
      ctx.fillStyle = `rgba(11, 17, 32, ${Math.min(0.85, bgCfg.dimOpacity)})`;
      ctx.fillRect(0, 0, width, playableHeight);
    }
  } else {
    // Clean architectural twilight sky gradient (no default cartoon scenery)
    const grad = ctx.createLinearGradient(0, 0, 0, playableHeight);
    grad.addColorStop(0, '#090F1D');
    grad.addColorStop(0.55, '#111C33');
    grad.addColorStop(1, '#1A2942');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, playableHeight);

    // Subtle atmospheric horizon grid lines for depth and speed perception
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
    ctx.lineWidth = 1;
    const gridSpacing = 64;
    const offset = (scrollDistance * 0.25) % gridSpacing;
    for (let x = -offset; x < width; x += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, playableHeight);
      ctx.stroke();
    }
    for (let y = gridSpacing; y < playableHeight; y += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export function renderGround(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  groundHeight: number,
  scrollDistance: number
) {
  const y = height - groundHeight;
  ctx.save();
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, y, width, groundHeight);

  // Top amber-slate horizon rail
  ctx.fillStyle = '#334155';
  ctx.fillRect(0, y, width, 3);

  // Scrolling diagonal chevron markers for clear ground speed feedback
  ctx.fillStyle = 'rgba(245, 158, 11, 0.22)';
  const step = 36;
  const shift = scrollDistance % step;
  for (let x = -step - shift; x < width + step; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, y + 3);
    ctx.lineTo(x + 14, y + 3);
    ctx.lineTo(x + 4, y + 15);
    ctx.lineTo(x - 10, y + 15);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function renderDefaultArchitecturalPillar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  isUpper: boolean
) {
  if (h <= 0) return;
  ctx.save();
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, '#1E293B');
  grad.addColorStop(0.25, '#334155');
  grad.addColorStop(0.85, '#1E293B');
  grad.addColorStop(1, '#0F172A');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  // Subtle architectural outline (never green!)
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);

  // Cap lip near the gap
  const capH = Math.min(18, h);
  const capY = isUpper ? y + h - capH : y;
  ctx.fillStyle = '#334155';
  ctx.fillRect(x - 3, capY, w + 6, capH);
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x - 3, capY, w + 6, capH);
  ctx.restore();
}

export function renderPillarPair(
  ctx: CanvasRenderingContext2D,
  pillar: PillarPair,
  playableHeight: number,
  config: CustomGameConfig,
  upperImg?: HTMLImageElement,
  lowerImg?: HTMLImageElement,
  showHitbox = false
) {
  const upperCfg = config.images.upperPillar;
  const lowerCfg = config.images.lowerPillar;

  const gapTop = Math.max(24, pillar.gapY - pillar.gapHeight / 2);
  const gapBottom = Math.min(playableHeight - 24, pillar.gapY + pillar.gapHeight / 2);

  // Upper pillar bounds
  const upperW = Math.max(32, upperCfg.width);
  const upperX = pillar.x - upperW / 2;
  const upperTotalH = gapTop;

  if (upperTotalH > 0) {
    if (upperCfg.hasAsset && upperImg && upperImg.complete && upperImg.naturalWidth > 0) {
      // Respect user height as target artwork region anchored to gap lip, clipped cleanly inside pillar column
      const renderH = Math.min(upperTotalH, Math.max(40, upperCfg.height));
      const renderY = upperTotalH - renderH;
      if (renderY > 0) {
        // Structural backing above custom graphic if user chose a shorter pillar height
        ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
        ctx.fillRect(upperX, 0, upperW, renderY);
      }
      drawCroppedImageInBox(ctx, upperImg, upperCfg, upperX, renderY, upperW, renderH, {
        anchorEdge: 'bottom',
      });
    } else {
      renderDefaultArchitecturalPillar(ctx, upperX, 0, upperW, upperTotalH, true);
    }

    if (showHitbox) {
      ctx.save();
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.75)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(upperX, 0, upperW, upperTotalH);
      ctx.restore();
    }
  }

  // Lower pillar bounds
  const lowerW = Math.max(32, lowerCfg.width);
  const lowerX = pillar.x - lowerW / 2;
  const lowerTotalH = Math.max(0, playableHeight - gapBottom);

  if (lowerTotalH > 0) {
    if (lowerCfg.hasAsset && lowerImg && lowerImg.complete && lowerImg.naturalWidth > 0) {
      const renderH = Math.min(lowerTotalH, Math.max(40, lowerCfg.height));
      drawCroppedImageInBox(ctx, lowerImg, lowerCfg, lowerX, gapBottom, lowerW, renderH, {
        anchorEdge: 'top',
      });
      if (renderH < lowerTotalH) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
        ctx.fillRect(lowerX, gapBottom + renderH, lowerW, lowerTotalH - renderH);
      }
    } else {
      renderDefaultArchitecturalPillar(ctx, lowerX, gapBottom, lowerW, lowerTotalH, false);
    }

    if (showHitbox) {
      ctx.save();
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.75)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(lowerX, gapBottom, lowerW, lowerTotalH);
      ctx.restore();
    }
  }
}

export function getCharacterHitbox(
  bird: BirdState,
  config: CustomGameConfig
): { cx: number; cy: number; rx: number; ry: number } {
  const charCfg = config.images.character;
  const forgiveness = Math.max(0, Math.min(0.4, config.settings.hitboxForgiveness));
  const w = Math.max(20, charCfg.width) * (1 - forgiveness);
  const h = Math.max(20, charCfg.height) * (1 - forgiveness);
  return {
    cx: bird.x,
    cy: bird.y,
    rx: w / 2,
    ry: h / 2,
  };
}

export function checkPillarCollision(
  bird: BirdState,
  pillars: PillarPair[],
  playableHeight: number,
  config: CustomGameConfig
): boolean {
  const hb = getCharacterHitbox(bird, config);

  // Ground collision always ends flight
  if (hb.cy + hb.ry >= playableHeight) {
    return true;
  }

  // Optional ceiling collision
  if (config.settings.ceilingMode === 'collide' && hb.cy - hb.ry <= 0) {
    return true;
  }

  const upperW = Math.max(32, config.images.upperPillar.width);
  const lowerW = Math.max(32, config.images.lowerPillar.width);

  for (const p of pillars) {
    const gapTop = Math.max(24, p.gapY - p.gapHeight / 2);
    const gapBottom = Math.min(playableHeight - 24, p.gapY + p.gapHeight / 2);

    // Upper pillar collision check (ellipse-rect approximation using shrunk AABB for clean accuracy)
    const uLeft = p.x - upperW / 2;
    const uRight = p.x + upperW / 2;
    if (hb.cx + hb.rx > uLeft && hb.cx - hb.rx < uRight && hb.cy - hb.ry < gapTop) {
      return true;
    }

    // Lower pillar collision check
    const lLeft = p.x - lowerW / 2;
    const lRight = p.x + lowerW / 2;
    if (hb.cx + hb.rx > lLeft && hb.cx - hb.rx < lRight && hb.cy + hb.ry > gapBottom) {
      return true;
    }
  }

  return false;
}

export function renderCharacter(
  ctx: CanvasRenderingContext2D,
  bird: BirdState,
  config: CustomGameConfig,
  charImg?: HTMLImageElement,
  showHitbox = false
) {
  const cfg = config.images.character;
  const w = Math.max(20, cfg.width);
  const h = Math.max(20, cfg.height);
  const tiltRad = cfg.dynamicTilt
    ? Math.max(-0.42, Math.min(0.95, bird.vy / 540))
    : 0;

  if (cfg.hasAsset && charImg && charImg.complete && charImg.naturalWidth > 0) {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    // Apply tilt + user base rotation around character center
    const totalRot = tiltRad + ((cfg.rotation || 0) * Math.PI) / 180;
    if (totalRot) ctx.rotate(totalRot);

    const { sx, sy, sw, sh } = getSourceCropRect(charImg, cfg);
    const scaleMult = Math.max(0.2, cfg.imageScale || 1);
    const srcAspect = sw / sh;
    const boxAspect = w / h;

    let drawW = w;
    let drawH = h;
    if (cfg.scaleMode === 'contain') {
      if (srcAspect > boxAspect) {
        drawW = w;
        drawH = w / srcAspect;
      } else {
        drawH = h;
        drawW = h * srcAspect;
      }
    } else if (cfg.scaleMode === 'cover') {
      if (srcAspect > boxAspect) {
        drawH = h;
        drawW = h * srcAspect;
      } else {
        drawW = w;
        drawH = w / srcAspect;
      }
      ctx.beginPath();
      ctx.rect(-w / 2, -h / 2, w, h);
      ctx.clip();
    }

    drawW *= scaleMult;
    drawH *= scaleMult;

    ctx.scale(cfg.flipHorizontal ? -1 : 1, cfg.flipVertical ? -1 : 1);
    ctx.drawImage(
      charImg,
      sx,
      sy,
      sw,
      sh,
      -drawW / 2 + cfg.offsetX,
      -drawH / 2 + cfg.offsetY,
      drawW,
      drawH
    );
    ctx.restore();
  } else {
    // Clean minimal geometric wing emblem (placeholder silhouette until user uploads their character)
    ctx.save();
    ctx.translate(bird.x + cfg.offsetX, bird.y + cfg.offsetY);
    const totalRot = tiltRad + ((cfg.rotation || 0) * Math.PI) / 180;
    ctx.rotate(totalRot);
    ctx.scale(cfg.flipHorizontal ? -1 : 1, cfg.flipVertical ? -1 : 1);

    const rw = w / 2;
    const rh = h / 2;

    // Delta glider body
    ctx.beginPath();
    ctx.moveTo(rw, 0);
    ctx.lineTo(-rw * 0.85, -rh * 0.78);
    ctx.lineTo(-rw * 0.45, 0);
    ctx.lineTo(-rw * 0.85, rh * 0.78);
    ctx.closePath();

    const grad = ctx.createLinearGradient(-rw, -rh, rw, rh);
    grad.addColorStop(0, '#F59E0B');
    grad.addColorStop(1, '#D97706');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#FEF3C7';
    ctx.stroke();

    // Inner cockpit chevron
    ctx.beginPath();
    ctx.moveTo(rw * 0.45, 0);
    ctx.lineTo(-rw * 0.2, -rh * 0.28);
    ctx.lineTo(-rw * 0.2, rh * 0.28);
    ctx.closePath();
    ctx.fillStyle = '#0F172A';
    ctx.fill();

    ctx.restore();
  }

  if (showHitbox) {
    const hb = getCharacterHitbox(bird, config);
    ctx.save();
    ctx.strokeStyle = '#10B981';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(hb.cx - hb.rx, hb.cy - hb.ry, hb.rx * 2, hb.ry * 2);
    ctx.restore();
  }
}

export function updateAndRenderParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  dt: number
) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.maxLife) {
      particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 320 * dt;
    p.rotation += p.vRot * dt;
    const alpha = Math.max(0, 1 - p.life / p.maxLife) * p.alpha;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65);
    ctx.restore();
  }
}
