import { AudioSlotConfig, AudioSlotKey } from '../types/game';

const ALL_SLOTS: AudioSlotKey[] = [
  'flying',
  'collision',
  'victory',
  'gameOver',
  'startScreen',
];

export type AudioPlaybackListener = (state: {
  activeSlot: AudioSlotKey | null;
  previewSlot: AudioSlotKey | null;
  autoplayBlocked: boolean;
  previewTime: number;
  previewDuration: number;
}) => void;

/**
 * Single-active-channel audio controller.
 * Enforces strict mutual exclusion so two tracks never play simultaneously,
 * handles browser autoplay restrictions cleanly, and supports dashboard previews.
 */
export class GameAudioController {
  private elements: Partial<Record<AudioSlotKey, HTMLAudioElement>> = {};
  private urls: Partial<Record<AudioSlotKey, string>> = {};
  private configs: Record<AudioSlotKey, AudioSlotConfig>;
  private masterVolume = 0.85;
  private muted = false;

  private activeSlot: AudioSlotKey | null = null;
  private previewSlot: AudioSlotKey | null = null;
  private autoplayBlocked = false;
  private pendingBlockedSlot: AudioSlotKey | null = null;
  private listeners = new Set<AudioPlaybackListener>();
  private collisionFallbackTimer: number | null = null;

  constructor(initialConfigs: Record<AudioSlotKey, AudioSlotConfig>) {
    this.configs = initialConfigs;
  }

  subscribe(listener: AudioPlaybackListener): () => void {
    this.listeners.add(listener);
    this.emit();
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    const previewEl = this.previewSlot ? this.elements[this.previewSlot] : undefined;
    const payload = {
      activeSlot: this.activeSlot,
      previewSlot: this.previewSlot,
      autoplayBlocked: this.autoplayBlocked,
      previewTime: previewEl ? previewEl.currentTime : 0,
      previewDuration: previewEl && Number.isFinite(previewEl.duration) ? previewEl.duration : 0,
    };
    this.listeners.forEach((fn) => fn(payload));
  }

  setTrackSource(slot: AudioSlotKey, url: string | undefined) {
    const existing = this.elements[slot];
    if (existing) {
      existing.pause();
      existing.src = '';
      delete this.elements[slot];
    }
    if (url) {
      this.urls[slot] = url;
      const audio = new Audio(url);
      audio.preload = 'auto';
      audio.addEventListener('timeupdate', () => {
        if (this.previewSlot === slot) {
          this.emit();
        }
      });
      audio.addEventListener('ended', () => {
        if (this.previewSlot === slot && !audio.loop) {
          this.previewSlot = null;
          this.emit();
        }
        if (this.activeSlot === slot && !audio.loop) {
          this.activeSlot = null;
          this.emit();
        }
      });
      this.elements[slot] = audio;
      this.applySettingsToElement(slot);
    } else {
      delete this.urls[slot];
      if (this.activeSlot === slot) this.activeSlot = null;
      if (this.previewSlot === slot) this.previewSlot = null;
      this.emit();
    }
  }

  updateConfigs(
    configs: Record<AudioSlotKey, AudioSlotConfig>,
    masterVolume: number,
    muted: boolean
  ) {
    this.configs = configs;
    this.masterVolume = masterVolume;
    this.muted = muted;
    for (const slot of ALL_SLOTS) {
      this.applySettingsToElement(slot);
    }
  }

  private applySettingsToElement(slot: AudioSlotKey) {
    const el = this.elements[slot];
    const cfg = this.configs[slot];
    if (!el || !cfg) return;
    el.volume = this.muted ? 0 : Math.max(0, Math.min(1, cfg.volume * this.masterVolume));
    // Preview mode shouldn't loop infinitely unless configured, game mode follows cfg.loop
    el.loop = this.previewSlot === slot ? false : cfg.loop;
  }

  private clearCollisionTimer() {
    if (this.collisionFallbackTimer !== null) {
      window.clearTimeout(this.collisionFallbackTimer);
      this.collisionFallbackTimer = null;
    }
  }

  stopAll() {
    this.clearCollisionTimer();
    for (const slot of ALL_SLOTS) {
      const el = this.elements[slot];
      if (el) {
        el.onended = null;
        el.pause();
        try {
          el.currentTime = 0;
        } catch {
          // Ignore seek errors on unloaded media
        }
      }
    }
    this.activeSlot = null;
    this.previewSlot = null;
    this.pendingBlockedSlot = null;
    this.autoplayBlocked = false;
    this.emit();
  }

  pauseActive() {
    if (!this.activeSlot) return;
    const el = this.elements[this.activeSlot];
    if (el) {
      el.pause();
    }
  }

  resumeActive() {
    if (!this.activeSlot) return;
    const el = this.elements[this.activeSlot];
    if (el) {
      this.applySettingsToElement(this.activeSlot);
      el.play().catch(() => {
        this.autoplayBlocked = true;
        this.pendingBlockedSlot = this.activeSlot;
        this.emit();
      });
    }
  }

  /**
   * Plays a specific game state audio slot, strictly stopping any other audio first.
   */
  async playGameSlot(slot: AudioSlotKey, restart = true): Promise<void> {
    this.clearCollisionTimer();
    this.previewSlot = null;

    // Stop every other slot immediately
    for (const other of ALL_SLOTS) {
      if (other !== slot) {
        const otherEl = this.elements[other];
        if (otherEl) {
          otherEl.onended = null;
          otherEl.pause();
          try {
            otherEl.currentTime = 0;
          } catch {
            // Ignore
          }
        }
      }
    }

    const target = this.elements[slot];
    const cfg = this.configs[slot];
    if (!target || !cfg?.hasAsset) {
      this.activeSlot = null;
      this.autoplayBlocked = false;
      this.pendingBlockedSlot = null;
      this.emit();
      return;
    }

    this.activeSlot = slot;
    this.applySettingsToElement(slot);
    if (restart) {
      try {
        target.currentTime = 0;
      } catch {
        // Ignore
      }
    }

    try {
      await target.play();
      this.autoplayBlocked = false;
      this.pendingBlockedSlot = null;
      this.emit();
    } catch {
      this.autoplayBlocked = true;
      this.pendingBlockedSlot = slot;
      this.emit();
    }
  }

  /**
   * Handles collision -> Game Over handoff without ever playing both tracks simultaneously.
   * Stops flying music immediately, plays collision audio, and transitions cleanly to gameOver
   * once collision finishes (or after 3s if collision is a long music track and gameOver exists).
   */
  async playCollisionThenGameOver(onTransitionToGameOverReady?: () => void): Promise<void> {
    this.clearCollisionTimer();
    const hasCollision = this.configs.collision.hasAsset && Boolean(this.elements.collision);
    const hasGameOver = this.configs.gameOver.hasAsset && Boolean(this.elements.gameOver);

    if (!hasCollision) {
      if (hasGameOver) {
        await this.playGameSlot('gameOver', true);
      } else {
        this.stopAll();
      }
      onTransitionToGameOverReady?.();
      return;
    }

    await this.playGameSlot('collision', true);
    const colEl = this.elements.collision;
    if (!colEl) return;

    if (hasGameOver) {
      const duration = Number.isFinite(colEl.duration) ? colEl.duration : 0;
      if (duration > 0 && duration <= 5.5 && !this.configs.collision.loop) {
        colEl.onended = () => {
          colEl.onended = null;
          if (this.activeSlot === 'collision') {
            void this.playGameSlot('gameOver', true);
          }
        };
      } else {
        // Long track or looping collision track: play collision impact for 2.2s, then switch cleanly to Game Over song
        this.collisionFallbackTimer = window.setTimeout(() => {
          if (this.activeSlot === 'collision') {
            void this.playGameSlot('gameOver', true);
          }
        }, 2200);
      }
    }
  }

  async unlockBlockedAudio(): Promise<void> {
    if (this.pendingBlockedSlot) {
      const slot = this.pendingBlockedSlot;
      await this.playGameSlot(slot, false);
    }
  }

  async togglePreview(slot: AudioSlotKey): Promise<void> {
    if (this.previewSlot === slot) {
      this.stopAll();
      return;
    }
    this.stopAll();
    const el = this.elements[slot];
    const cfg = this.configs[slot];
    if (!el || !cfg?.hasAsset) return;

    this.previewSlot = slot;
    el.loop = false;
    el.volume = this.muted ? 0 : Math.max(0, Math.min(1, cfg.volume * this.masterVolume));
    try {
      el.currentTime = 0;
      await el.play();
      this.emit();
    } catch {
      this.previewSlot = null;
      this.emit();
    }
  }

  seekPreview(slot: AudioSlotKey, timeSeconds: number) {
    if (this.previewSlot !== slot) return;
    const el = this.elements[slot];
    if (el && Number.isFinite(el.duration)) {
      el.currentTime = Math.max(0, Math.min(el.duration, timeSeconds));
      this.emit();
    }
  }

  getActiveSlot(): AudioSlotKey | null {
    return this.activeSlot;
  }
}
