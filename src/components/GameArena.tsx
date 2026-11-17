import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download,
  Pause,
  Play,
  RotateCcw,
  Trophy,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GameAudioController } from '../audio/audioManager';
import {
  BirdState,
  checkPillarCollision,
  Particle,
  PillarPair,
  renderBackground,
  renderCharacter,
  renderGround,
  renderPillarPair,
  updateAndRenderParticles,
} from '../engine/gameRenderer';
import {
  AudioSlotKey,
  CustomGameConfig,
  GameState,
  LoadedMediaAssets,
  SURVIVAL_DURATION_SECONDS,
} from '../types/game';

interface GameArenaProps {
  config: CustomGameConfig;
  media: LoadedMediaAssets;
  audioController: GameAudioController;
  autoplayBlocked: boolean;
  activeAudioSlot: AudioSlotKey | null;
  onToggleMute: () => void;
  onOpenExporter: () => void;
  onRecordRunOutcome: (score: number, won: boolean) => void;
}

interface WorldMetrics {
  cssW: number;
  cssH: number;
  dpr: number;
  worldW: number;
  worldH: number;
  playableH: number;
  groundH: number;
  scale: number;
  birdX: number;
  isPortrait: boolean;
}

function computeWorldMetrics(cssW: number, cssH: number): WorldMetrics {
  const safeW = Math.max(240, cssW);
  const safeH = Math.max(240, cssH);
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const aspect = safeW / safeH;
  const isPortrait = aspect < 1.05;

  if (isPortrait) {
    const worldW = 360;
    const scale = safeW / worldW;
    const worldH = safeH / scale;
    const groundH = 52;
    const playableH = Math.max(320, worldH - groundH);
    return {
      cssW: safeW,
      cssH: safeH,
      dpr,
      worldW,
      worldH,
      playableH,
      groundH,
      scale,
      birdX: 92,
      isPortrait: true,
    };
  }

  const worldH = 540;
  const scale = safeH / worldH;
  const worldW = safeW / scale;
  const groundH = 48;
  const playableH = worldH - groundH;
  const birdX = Math.max(120, Math.min(230, Math.round(worldW * 0.22)));
  return {
    cssW: safeW,
    cssH: safeH,
    dpr,
    worldW,
    worldH,
    playableH,
    groundH,
    scale,
    birdX,
    isPortrait: false,
  };
}

export const GameArena: React.FC<GameArenaProps> = ({
  config,
  media,
  audioController,
  autoplayBlocked,
  activeAudioSlot,
  onToggleMute,
  onOpenExporter,
  onRecordRunOutcome,
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastTouchTimeRef = useRef(0);

  const metricsRef = useRef<WorldMetrics>(
    computeWorldMetrics(
      typeof window !== 'undefined' ? window.innerWidth : 900,
      typeof window !== 'undefined' ? window.innerHeight : 540
    )
  );

  const [gameState, setGameState] = useState<GameState>('START_SCREEN');
  const [score, setScore] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(SURVIVAL_DURATION_SECONDS);
  const [collisionFlash, setCollisionFlash] = useState(false);

  // Mutable simulation refs for 60fps zero-stutter physics loop
  const simRef = useRef<{
    state: GameState;
    bird: BirdState;
    pillars: PillarPair[];
    particles: Particle[];
    scrollDistance: number;
    score: number;
    timeRemaining: number;
    nextPillarId: number;
    collidingElapsed: number;
    outcomeRecorded: boolean;
  }>({
    state: 'START_SCREEN',
    bird: {
      x: metricsRef.current.birdX,
      y: metricsRef.current.playableH / 2,
      vy: 0,
    },
    pillars: [],
    particles: [],
    scrollDistance: 0,
    score: 0,
    timeRemaining: SURVIVAL_DURATION_SECONDS,
    nextPillarId: 1,
    collidingElapsed: 0,
    outcomeRecorded: false,
  });

  const configRef = useRef(config);
  const mediaRef = useRef(media);
  configRef.current = config;
  mediaRef.current = media;

  // Sync canvas physical backing resolution and logical world metrics on resize/orientation change
  useEffect(() => {
    const stageEl = stageRef.current;
    const canvasEl = canvasRef.current;
    if (!stageEl || !canvasEl) return;

    const syncCanvasSize = () => {
      const rect = stageEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const next = computeWorldMetrics(rect.width, rect.height);
      const prev = metricsRef.current;
      metricsRef.current = next;

      const targetPixelW = Math.max(1, Math.round(next.cssW * next.dpr));
      const targetPixelH = Math.max(1, Math.round(next.cssH * next.dpr));
      if (canvasEl.width !== targetPixelW || canvasEl.height !== targetPixelH) {
        canvasEl.width = targetPixelW;
        canvasEl.height = targetPixelH;
      }

      simRef.current.bird.x = next.birdX;
      if (prev.playableH > 0 && Math.abs(prev.playableH - next.playableH) > 2) {
        const ratio = simRef.current.bird.y / prev.playableH;
        simRef.current.bird.y = Math.max(
          24,
          Math.min(next.playableH - 24, ratio * next.playableH)
        );
      }
    };

    syncCanvasSize();

    const ro = new ResizeObserver(syncCanvasSize);
    ro.observe(stageEl);
    window.addEventListener('resize', syncCanvasSize);
    window.addEventListener('orientationchange', syncCanvasSize);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', syncCanvasSize);
      window.removeEventListener('orientationchange', syncCanvasSize);
    };
  }, []);

  // Start Screen music activation when entering START_SCREEN
  useEffect(() => {
    if (gameState === 'START_SCREEN') {
      if (config.audio.startScreen.hasAsset) {
        void audioController.playGameSlot('startScreen', true);
      } else {
        audioController.stopAll();
      }
    }
  }, [gameState, config.audio.startScreen.hasAsset, audioController]);

  const spawnWingParticles = (x: number, y: number) => {
    const colors = ['#F59E0B', '#FBBF24', '#F8FAFC'];
    for (let i = 0; i < 6; i++) {
      simRef.current.particles.push({
        x: x - 12,
        y: y + (Math.random() - 0.5) * 14,
        vx: -80 - Math.random() * 90,
        vy: (Math.random() - 0.5) * 110,
        size: 4 + Math.random() * 4,
        color: colors[i % colors.length],
        alpha: 0.9,
        life: 0,
        maxLife: 0.35 + Math.random() * 0.25,
        rotation: Math.random() * Math.PI,
        vRot: (Math.random() - 0.5) * 8,
      });
    }
  };

  const spawnCollisionParticles = (x: number, y: number) => {
    const colors = ['#EF4444', '#F97316', '#FBBF24', '#F8FAFC'];
    for (let i = 0; i < 24; i++) {
      const angle = (Math.PI * 2 * i) / 24 + Math.random() * 0.2;
      const speed = 110 + Math.random() * 220;
      simRef.current.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 80,
        size: 5 + Math.random() * 6,
        color: colors[i % colors.length],
        alpha: 1,
        life: 0,
        maxLife: 0.55 + Math.random() * 0.4,
        rotation: Math.random() * Math.PI,
        vRot: (Math.random() - 0.5) * 12,
      });
    }
  };

  const spawnVictoryConfetti = () => {
    const colors = ['#10B981', '#F59E0B', '#38BDF8', '#F43F5E', '#FEF08A'];
    const { worldW } = metricsRef.current;
    for (let i = 0; i < 95; i++) {
      simRef.current.particles.push({
        x: Math.random() * worldW,
        y: -20 - Math.random() * 140,
        vx: (Math.random() - 0.5) * 190,
        vy: 60 + Math.random() * 140,
        size: 6 + Math.random() * 7,
        color: colors[i % colors.length],
        alpha: 1,
        life: 0,
        maxLife: 2.2 + Math.random() * 1.4,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 10,
      });
    }
  };

  const resetAndStartGame = useCallback(() => {
    const cfg = configRef.current;
    const { worldW, playableH, birdX } = metricsRef.current;

    simRef.current = {
      state: 'PLAYING',
      bird: { x: birdX, y: playableH * 0.46, vy: -cfg.settings.flapStrength * 0.78 },
      pillars: [],
      particles: [],
      scrollDistance: 0,
      score: 0,
      timeRemaining: SURVIVAL_DURATION_SECONDS,
      nextPillarId: 1,
      collidingElapsed: 0,
      outcomeRecorded: false,
    };

    const topMargin = Math.max(96, cfg.settings.pillarGap * 0.65);
    const bottomMargin = Math.max(76, cfg.settings.pillarGap * 0.65);
    const span = Math.max(40, playableH - topMargin - bottomMargin);
    const firstGapY = topMargin + Math.random() * span;

    simRef.current.pillars.push({
      id: simRef.current.nextPillarId++,
      x: worldW + 90,
      gapY: firstGapY,
      gapHeight: cfg.settings.pillarGap,
      scored: false,
    });

    setScore(0);
    setTimeRemaining(SURVIVAL_DURATION_SECONDS);
    setCollisionFlash(false);
    setGameState('PLAYING');

    void audioController.playGameSlot('flying', true);
  }, [audioController]);

  const performFlap = useCallback(() => {
    const sim = simRef.current;
    if (sim.state !== 'PLAYING') return;
    sim.bird.vy = -configRef.current.settings.flapStrength;
    spawnWingParticles(sim.bird.x, sim.bird.y);
  }, []);

  const togglePause = useCallback(() => {
    const sim = simRef.current;
    if (sim.state === 'PLAYING') {
      sim.state = 'PAUSED';
      setGameState('PAUSED');
      audioController.pauseActive();
    } else if (sim.state === 'PAUSED') {
      sim.state = 'PLAYING';
      setGameState('PLAYING');
      audioController.resumeActive();
    }
  }, [audioController]);

  // Direct non-passive touchstart & touchend listeners for 0ms latency without passive warnings
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleTouchStart = (e: TouchEvent) => {
      lastTouchTimeRef.current = performance.now();
      if (simRef.current.state === 'PLAYING') {
        e.preventDefault();
        performFlap();
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      lastTouchTimeRef.current = performance.now();
      if (simRef.current.state === 'PLAYING') {
        e.preventDefault();
      }
    };

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchend', handleTouchEnd);
    };
  }, [performFlap]);

  // Keyboard controls: Space, ArrowUp, W to flap; P / Escape to pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        if (simRef.current.state === 'PLAYING') {
          performFlap();
        } else if (simRef.current.state === 'START_SCREEN') {
          resetAndStartGame();
        }
      } else if (e.code === 'KeyP' || e.code === 'Escape') {
        if (simRef.current.state === 'PLAYING' || simRef.current.state === 'PAUSED') {
          e.preventDefault();
          togglePause();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [performFlap, resetAndStartGame, togglePause]);

  // Main 60fps requestAnimationFrame Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let lastTime = performance.now();
    let hudSyncAccum = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const sim = simRef.current;
      const cfg = configRef.current;
      const assets = mediaRef.current;
      const m = metricsRef.current;

      if (sim.state === 'START_SCREEN') {
        sim.scrollDistance += cfg.settings.scrollSpeed * 0.35 * dt;
        sim.bird.y = m.playableH * 0.48 + Math.sin(now * 0.0032) * 14;
        sim.bird.vy = Math.cos(now * 0.0032) * 120;
      } else if (sim.state === 'PLAYING') {
        // 1. Update countdown timer first (mutually exclusive check)
        sim.timeRemaining = Math.max(0, sim.timeRemaining - dt);
        hudSyncAccum += dt;

        if (sim.timeRemaining <= 0) {
          // WIN CONDITION TRIGGERED IMMEDIATELY AT 45.0s!
          sim.state = 'WIN';
          sim.timeRemaining = 0;
          setTimeRemaining(0);
          setGameState('WIN');
          spawnVictoryConfetti();
          if (!sim.outcomeRecorded) {
            sim.outcomeRecorded = true;
            onRecordRunOutcome(sim.score, true);
          }
          void audioController.playGameSlot('victory', true);
        } else {
          // 2. Scroll world & pillars
          const speed = cfg.settings.scrollSpeed;
          sim.scrollDistance += speed * dt;

          for (const p of sim.pillars) {
            p.x -= speed * dt;
            if (!p.scored && p.x < sim.bird.x) {
              p.scored = true;
              sim.score += 1;
              setScore(sim.score);
            }
          }

          // Spawn new pillars cleanly at configured spacing
          const spacing = Math.max(190, cfg.settings.pillarSpacing);
          const lastPillar = sim.pillars[sim.pillars.length - 1];
          if (!lastPillar || lastPillar.x <= m.worldW + 40 - spacing) {
            const topMargin = Math.max(96, cfg.settings.pillarGap * 0.62);
            const bottomMargin = Math.max(72, cfg.settings.pillarGap * 0.62);
            const minY = topMargin;
            const maxY = Math.max(minY + 30, m.playableH - bottomMargin);
            const gapY = minY + Math.random() * (maxY - minY);
            sim.pillars.push({
              id: sim.nextPillarId++,
              x: lastPillar ? Math.max(m.worldW + 60, lastPillar.x + spacing) : m.worldW + 80,
              gapY,
              gapHeight: cfg.settings.pillarGap,
              scored: false,
            });
          }

          // Remove off-screen pillars
          const maxW = Math.max(cfg.images.upperPillar.width, cfg.images.lowerPillar.width);
          while (sim.pillars.length > 0 && sim.pillars[0].x < -maxW - 40) {
            sim.pillars.shift();
          }

          // 3. Bird vertical physics
          sim.bird.vy += cfg.settings.gravity * dt;
          sim.bird.y += sim.bird.vy * dt;

          if (cfg.settings.ceilingMode === 'clamp') {
            const halfH = Math.max(12, cfg.images.character.height / 2);
            if (sim.bird.y < halfH) {
              sim.bird.y = halfH;
              sim.bird.vy = Math.max(0, sim.bird.vy);
            }
          }

          // 4. Collision Check (only while still PLAYING and timeRemaining > 0)
          if (checkPillarCollision(sim.bird, sim.pillars, m.playableH, cfg)) {
            sim.state = 'COLLIDING';
            sim.collidingElapsed = 0;
            sim.bird.vy = Math.min(sim.bird.vy, -140);
            setGameState('COLLIDING');
            setCollisionFlash(true);
            window.setTimeout(() => setCollisionFlash(false), 180);

            spawnCollisionParticles(sim.bird.x, sim.bird.y);

            if (!sim.outcomeRecorded) {
              sim.outcomeRecorded = true;
              onRecordRunOutcome(sim.score, false);
            }

            void audioController.playCollisionThenGameOver();
          }

          if (hudSyncAccum >= 0.05) {
            hudSyncAccum = 0;
            setTimeRemaining(sim.timeRemaining);
          }
        }
      } else if (sim.state === 'COLLIDING') {
        sim.collidingElapsed += dt;
        sim.bird.vy += cfg.settings.gravity * 1.15 * dt;
        sim.bird.y = Math.min(
          m.playableH - Math.max(12, cfg.images.character.height * 0.35),
          sim.bird.y + sim.bird.vy * dt
        );

        const landed =
          sim.bird.y >= m.playableH - Math.max(12, cfg.images.character.height * 0.35) - 2;
        if (sim.collidingElapsed >= 0.65 || (landed && sim.collidingElapsed >= 0.35)) {
          sim.state = 'GAME_OVER';
          setGameState('GAME_OVER');
        }
      } else if (sim.state === 'WIN') {
        sim.bird.y = m.playableH * 0.45 + Math.sin(now * 0.005) * 10;
        sim.bird.vy = 0;
        if (Math.random() < 0.35) {
          const colors = ['#10B981', '#F59E0B', '#38BDF8', '#FEF08A'];
          sim.particles.push({
            x: Math.random() * m.worldW,
            y: -10,
            vx: (Math.random() - 0.5) * 110,
            vy: 80 + Math.random() * 100,
            size: 5 + Math.random() * 5,
            color: colors[Math.floor(Math.random() * colors.length)],
            alpha: 0.95,
            life: 0,
            maxLife: 2.4,
            rotation: Math.random() * Math.PI,
            vRot: (Math.random() - 0.5) * 8,
          });
        }
      }

      // Render Frame scaled uniformly to fill 100% of container with crisp Retina DPR
      const totalScale = m.dpr * m.scale;
      ctx.setTransform(totalScale, 0, 0, totalScale, 0, 0);
      ctx.clearRect(0, 0, m.worldW, m.worldH);

      renderBackground(
        ctx,
        m.worldW,
        m.worldH,
        m.groundH,
        sim.scrollDistance,
        cfg,
        assets.imageElements.background
      );

      for (const p of sim.pillars) {
        renderPillarPair(
          ctx,
          p,
          m.playableH,
          cfg,
          assets.imageElements.upperPillar,
          assets.imageElements.lowerPillar,
          false
        );
      }

      renderGround(ctx, m.worldW, m.worldH, m.groundH, sim.scrollDistance);
      renderCharacter(ctx, sim.bird, cfg, assets.imageElements.character, false);
      updateAndRenderParticles(ctx, sim.particles, dt);

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [audioController, onRecordRunOutcome]);

  const progressPct = Math.max(
    0,
    Math.min(100, ((SURVIVAL_DURATION_SECONDS - timeRemaining) / SURVIVAL_DURATION_SECONDS) * 100)
  );

  const activeSlotLabel: Record<AudioSlotKey, string> = {
    flying: 'Flying Track',
    collision: 'Collision Audio',
    victory: 'Victory Song',
    gameOver: 'Game Over Song',
    startScreen: 'Start Screen Song',
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full flex-1 flex-col md:max-w-[1040px] md:px-6 md:py-4">
      {/* Desktop Top HUD Bar (hidden on mobile where HUD floats sleekly over full-screen canvas) */}
      <div className="mb-3 hidden items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-[#11192B] px-5 py-2.5 md:flex">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-[11px] font-medium text-slate-400">
              Survival Countdown
            </div>
            <div className="flex items-baseline gap-1.5">
              <span
                className={`font-mono-tabular text-2xl font-bold ${
                  timeRemaining <= 10 && gameState === 'PLAYING'
                    ? 'text-emerald-400'
                    : 'text-amber-400'
                }`}
              >
                {timeRemaining.toFixed(1)}s
              </span>
              <span className="font-mono-tabular text-xs text-slate-500">
                / {SURVIVAL_DURATION_SECONDS}s
              </span>
            </div>
          </div>

          <div className="w-36">
            <div className="mb-1 flex justify-between text-[11px] text-slate-400">
              <span>Progress</span>
              <span className="font-mono-tabular">{Math.round(progressPct)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-amber-500 transition-[width] duration-75"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className="text-[11px] font-medium text-slate-400">Obstacles</div>
            <div className="font-mono-tabular text-2xl font-bold text-slate-100">
              {score}
            </div>
          </div>
          <div className="h-8 w-px bg-slate-800" />
          <div className="text-center">
            <div className="text-[11px] font-medium text-slate-400">Best</div>
            <div className="font-mono-tabular text-xl font-semibold text-slate-300">
              {Math.max(config.bestScore, score)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeAudioSlot && (
            <span className="hidden lg:inline text-xs text-emerald-400 mr-2">
              {activeSlotLabel[activeAudioSlot]}
            </span>
          )}

          {(gameState === 'PLAYING' || gameState === 'PAUSED') && (
            <button
              type="button"
              onClick={togglePause}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              {gameState === 'PAUSED' ? (
                <>
                  <Play className="h-3.5 w-3.5 text-emerald-400" />
                  Resume
                </>
              ) : (
                <>
                  <Pause className="h-3.5 w-3.5 text-amber-400" />
                  Pause
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onToggleMute}
            aria-label={config.settings.muted ? 'Unmute audio' : 'Mute audio'}
            className="inline-flex min-h-[42px] min-w-[42px] items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
          >
            {config.settings.muted ? (
              <VolumeX className="h-4 w-4 text-red-400" />
            ) : (
              <Volume2 className="h-4 w-4 text-slate-200" />
            )}
          </button>
        </div>
      </div>

      {/* Full-Screen Mobile / Responsive Desktop Canvas Stage */}
      <div
        ref={stageRef}
        className="relative flex-1 min-h-0 w-full h-full overflow-hidden bg-[#070B14] select-none touch-none md:rounded-2xl md:border md:border-slate-800 md:shadow-2xl"
      >
        <canvas
          ref={canvasRef}
          onMouseDown={(e) => {
            if (performance.now() - lastTouchTimeRef.current < 500) return;
            if (simRef.current.state === 'PLAYING') {
              e.preventDefault();
              performFlap();
            }
          }}
          className="block h-full w-full cursor-pointer select-none touch-none"
        />

        {/* Slim Floating Mobile HUD Bar (overlays top sky cleanly with zero wasted black space) */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-2.5 pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden">
          <div className="pointer-events-auto flex items-center justify-between gap-2 rounded-xl border border-slate-700/60 bg-[#0F172A]/80 px-2.5 py-1.5 backdrop-blur-md shadow-lg">
            {/* Timer & slim progress bar */}
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`font-mono-tabular text-base font-bold ${
                  timeRemaining <= 10 && gameState === 'PLAYING'
                    ? 'text-emerald-400'
                    : 'text-amber-400'
                }`}
              >
                {timeRemaining.toFixed(1)}s
              </span>
              <div className="w-12 sm:w-20">
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-amber-500 transition-[width] duration-75"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Score & Best */}
            <div className="flex items-center gap-2.5 text-center">
              <div className="flex items-baseline gap-1">
                <span className="text-[10px] font-medium text-slate-400">Score</span>
                <span className="font-mono-tabular text-base font-bold text-slate-100">
                  {score}
                </span>
              </div>
              <div className="h-4 w-px bg-slate-700" />
              <div className="flex items-baseline gap-1">
                <span className="text-[10px] font-medium text-slate-400">Best</span>
                <span className="font-mono-tabular text-sm font-semibold text-emerald-400">
                  {Math.max(config.bestScore, score)}
                </span>
              </div>
            </div>

            {/* Touch-sized action buttons */}
            <div className="flex items-center gap-1 shrink-0">
              {(gameState === 'PLAYING' || gameState === 'PAUSED') && (
                <button
                  type="button"
                  onClick={togglePause}
                  aria-label={gameState === 'PAUSED' ? 'Resume game' : 'Pause game'}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-700/80 bg-slate-800/90 text-slate-200 active:bg-slate-600"
                >
                  {gameState === 'PAUSED' ? (
                    <Play className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <Pause className="h-4 w-4 text-amber-400" />
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={onToggleMute}
                aria-label={config.settings.muted ? 'Unmute audio' : 'Mute audio'}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-700/80 bg-slate-800/90 text-slate-200 active:bg-slate-600"
              >
                {config.settings.muted ? (
                  <VolumeX className="h-4 w-4 text-red-400" />
                ) : (
                  <Volume2 className="h-4 w-4 text-slate-200" />
                )}
              </button>

              {gameState !== 'PLAYING' && (
                <button
                  type="button"
                  onClick={onOpenExporter}
                  aria-label="Export Assets"
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-700/80 bg-slate-800/90 text-amber-400 active:bg-slate-600"
                >
                  <Download className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Brief collision flash */}
        {collisionFlash && (
          <div className="pointer-events-none absolute inset-0 bg-red-500/30" />
        )}

        {/* START SCREEN OVERLAY */}
        <AnimatePresence>
          {gameState === 'START_SCREEN' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]"
            >
              <div className="w-full max-w-md max-h-[82dvh] overflow-y-auto rounded-2xl border border-slate-700/80 bg-[#0F172A]/95 p-5 text-center shadow-2xl sm:p-6">
                <h1 className="text-2xl font-extrabold tracking-tight text-slate-100 sm:text-3xl">
                  45-Second Flight
                </h1>
                <p className="mt-2 text-xs text-slate-300 sm:text-sm">
                  Tap anywhere or press Space to fly. Survive all 45 seconds without hitting a pillar to win.
                </p>

                {autoplayBlocked && config.audio.startScreen.hasAsset && (
                  <button
                    type="button"
                    onClick={() => void audioController.unlockBlockedAudio()}
                    className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-medium text-amber-300 hover:bg-amber-500/20 sm:mt-4"
                  >
                    <Volume2 className="h-4 w-4" />
                    Enable Start Screen Music
                  </button>
                )}

                <div className="mt-5 flex justify-center sm:mt-6">
                  <button
                    type="button"
                    onClick={resetAndStartGame}
                    className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-8 py-3 text-base font-bold text-slate-950 transition-colors hover:bg-amber-400 active:bg-amber-300 sm:w-auto"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    START
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* PAUSED OVERLAY */}
        <AnimatePresence>
          {gameState === 'PAUSED' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
            >
              <div className="w-full max-w-sm max-h-[82dvh] overflow-y-auto rounded-2xl border border-slate-700 bg-[#0F172A] p-5 text-center shadow-2xl sm:p-6">
                <h2 className="text-xl font-bold text-slate-100 sm:text-2xl">Game Paused</h2>
                <p className="mt-1.5 font-mono-tabular text-xs text-slate-400 sm:text-sm">
                  {timeRemaining.toFixed(1)}s remaining · Score {score}
                </p>
                <div className="mt-5 flex flex-col gap-3 sm:mt-6">
                  <button
                    type="button"
                    onClick={togglePause}
                    className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400 active:bg-amber-300"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    Resume Flight
                  </button>
                  <button
                    type="button"
                    onClick={resetAndStartGame}
                    className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-5 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 active:bg-slate-600"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Restart 45s Run
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* GAME OVER OVERLAY */}
        <AnimatePresence>
          {gameState === 'GAME_OVER' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
            >
              <div className="w-full max-w-md max-h-[82dvh] overflow-y-auto rounded-2xl border border-red-500/35 bg-[#0F172A]/95 p-5 text-center shadow-2xl sm:p-6">
                <div className="text-[11px] font-semibold tracking-wide text-red-400 sm:text-xs">
                  Collision Before 45 Seconds
                </div>
                <h2 className="mt-1 text-2xl font-extrabold text-slate-100 sm:text-3xl">
                  Game Over
                </h2>

                <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3 sm:mt-5 sm:gap-3 sm:p-4">
                  <div>
                    <div className="text-[10px] text-slate-400 sm:text-[11px]">Survived</div>
                    <div className="font-mono-tabular mt-0.5 text-base font-bold text-slate-100 sm:text-lg">
                      {(SURVIVAL_DURATION_SECONDS - timeRemaining).toFixed(1)}s
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 sm:text-[11px]">Score</div>
                    <div className="font-mono-tabular mt-0.5 text-base font-bold text-amber-400 sm:text-lg">
                      {score}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 sm:text-[11px]">Best</div>
                    <div className="font-mono-tabular mt-0.5 text-base font-bold text-emerald-400 sm:text-lg">
                      {Math.max(config.bestScore, score)}
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex justify-center sm:mt-6">
                  <button
                    type="button"
                    onClick={resetAndStartGame}
                    className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-7 py-3 text-sm font-bold text-slate-950 transition-colors hover:bg-amber-400 active:bg-amber-300 sm:w-auto"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Play Again
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* VICTORY (WIN) OVERLAY */}
        <AnimatePresence>
          {gameState === 'WIN' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-[2px]"
            >
              <div className="w-full max-w-md max-h-[82dvh] overflow-y-auto rounded-2xl border border-emerald-500/45 bg-[#0F172A]/95 p-5 text-center shadow-2xl sm:p-7">
                <motion.div
                  initial={{ scale: 0.6, rotate: -10 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                  className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/40 bg-emerald-500/20 text-emerald-400 sm:h-16 sm:w-16"
                >
                  <Trophy className="h-6 w-6 sm:h-8 sm:w-8" />
                </motion.div>

                <div className="mt-3 text-[11px] font-semibold tracking-wide text-emerald-400 sm:mt-4 sm:text-xs">
                  45-Second Survival Completed
                </div>
                <h2 className="mt-1 text-2xl font-extrabold text-slate-100 sm:text-3xl">
                  You Win!
                </h2>
                <p className="mt-1.5 text-xs text-slate-300 sm:text-sm">
                  Flawless flight through all 45 seconds without collision.
                </p>

                <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3 sm:mt-5 sm:gap-3 sm:p-4">
                  <div>
                    <div className="text-[10px] text-slate-400 sm:text-[11px]">Duration</div>
                    <div className="font-mono-tabular mt-0.5 text-base font-bold text-emerald-400 sm:text-lg">
                      45.0s
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 sm:text-[11px]">Obstacles</div>
                    <div className="font-mono-tabular mt-0.5 text-base font-bold text-amber-400 sm:text-lg">
                      {score}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 sm:text-[11px]">Total Wins</div>
                    <div className="font-mono-tabular mt-0.5 text-base font-bold text-slate-100 sm:text-lg">
                      {config.totalWins}
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex justify-center sm:mt-6">
                  <button
                    type="button"
                    onClick={resetAndStartGame}
                    className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-7 py-3 text-sm font-bold text-slate-950 transition-colors hover:bg-emerald-400 active:bg-emerald-300 sm:w-auto"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Play Again
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Subtle Desktop Controls Legend */}
      <div className="mt-2.5 hidden flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-400 md:flex">
        <span>
          Controls: Tap screen, Click mouse, or press Space / Up Arrow to fly · P to pause
        </span>
        <span>
          Goal: Survive full 45.0 seconds to trigger Victory
        </span>
      </div>
    </div>
  );
};
