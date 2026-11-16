import { useCallback, useEffect, useRef, useState } from 'react';
import { GameAudioController } from './audio/audioManager';
import { GameArena } from './components/GameArena';
import { loadAllAssetBlobs, loadGameConfig, saveGameConfig } from './storage/indexedDb';
import {
  AudioSlotKey,
  createDefaultGameConfig,
  CustomGameConfig,
  GameSettings,
  ImageSlotKey,
  LoadedMediaAssets,
} from './types/game';

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = url;
  });
}

export default function App() {
  const [hydrated, setHydrated] = useState(false);
  const [config, setConfig] = useState<CustomGameConfig>(() => createDefaultGameConfig());
  const [media, setMedia] = useState<LoadedMediaAssets>({
    imageUrls: {},
    imageElements: {},
    audioUrls: {},
  });

  const audioControllerRef = useRef<GameAudioController | null>(null);
  if (!audioControllerRef.current) {
    audioControllerRef.current = new GameAudioController(config.audio);
  }
  const audioController = audioControllerRef.current;

  const [audioPlaybackState, setAudioPlaybackState] = useState<{
    activeSlot: AudioSlotKey | null;
    previewSlot: AudioSlotKey | null;
    autoplayBlocked: boolean;
    previewTime: number;
    previewDuration: number;
  }>({
    activeSlot: null,
    previewSlot: null,
    autoplayBlocked: false,
    previewTime: 0,
    previewDuration: 0,
  });

  const mediaUrlsRef = useRef<LoadedMediaAssets>({
    imageUrls: {},
    imageElements: {},
    audioUrls: {},
  });

  useEffect(() => {
    return audioController.subscribe((state) => {
      setAudioPlaybackState(state);
    });
  }, [audioController]);

  // Hydrate all saved images, audio tracks, and settings from IndexedDB
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const [loadedConfig, blobs] = await Promise.all([
        loadGameConfig(),
        loadAllAssetBlobs(),
      ]);

      if (cancelled) return;

      const nextImageUrls: Partial<Record<ImageSlotKey, string>> = {};
      const nextImageElements: Partial<Record<ImageSlotKey, HTMLImageElement>> = {};
      const nextAudioUrls: Partial<Record<AudioSlotKey, string>> = {};

      const imageSlots: ImageSlotKey[] = [
        'character',
        'upperPillar',
        'lowerPillar',
        'background',
      ];
      for (const slot of imageSlots) {
        const blob = blobs[`image:${slot}`];
        if (blob) {
          const url = URL.createObjectURL(blob);
          nextImageUrls[slot] = url;
          try {
            const el = await loadImageElement(url);
            if (!cancelled) {
              nextImageElements[slot] = el;
            }
          } catch {
            // Keep fallback if blob fails to decode
          }
        } else if (loadedConfig.images[slot].hasAsset) {
          loadedConfig.images[slot].hasAsset = false;
        }
      }

      const audioSlots: AudioSlotKey[] = [
        'flying',
        'collision',
        'victory',
        'gameOver',
        'startScreen',
      ];
      for (const slot of audioSlots) {
        const blob = blobs[`audio:${slot}`];
        if (blob) {
          const url = URL.createObjectURL(blob);
          nextAudioUrls[slot] = url;
          audioController.setTrackSource(slot, url);
        } else {
          audioController.setTrackSource(slot, undefined);
          if (loadedConfig.audio[slot].hasAsset) {
            loadedConfig.audio[slot].hasAsset = false;
          }
        }
      }

      if (cancelled) return;

      audioController.updateConfigs(
        loadedConfig.audio,
        loadedConfig.settings.masterVolume,
        loadedConfig.settings.muted
      );

      mediaUrlsRef.current = {
        imageUrls: nextImageUrls,
        imageElements: nextImageElements,
        audioUrls: nextAudioUrls,
      };
      setMedia(mediaUrlsRef.current);
      setConfig(loadedConfig);
      setHydrated(true);
    };

    void hydrate();

    return () => {
      cancelled = true;
      audioController.stopAll();
      Object.values(mediaUrlsRef.current.imageUrls).forEach((u) => {
        if (u) URL.revokeObjectURL(u);
      });
      Object.values(mediaUrlsRef.current.audioUrls).forEach((u) => {
        if (u) URL.revokeObjectURL(u);
      });
    };
  }, [audioController]);

  // Keep audio controller synced whenever mute state changes
  useEffect(() => {
    if (!hydrated) return;
    audioController.updateConfigs(
      config.audio,
      config.settings.masterVolume,
      config.settings.muted
    );
  }, [
    hydrated,
    config.audio,
    config.settings.masterVolume,
    config.settings.muted,
    audioController,
  ]);

  const persistConfig = useCallback((next: CustomGameConfig) => {
    void saveGameConfig(next);
  }, []);

  const handleChangeSettings = useCallback(
    (patch: Partial<GameSettings>) => {
      setConfig((prev) => {
        const next: CustomGameConfig = {
          ...prev,
          settings: { ...prev.settings, ...patch },
        };
        persistConfig(next);
        return next;
      });
    },
    [persistConfig]
  );

  const handleRecordRunOutcome = useCallback(
    (score: number, won: boolean) => {
      setConfig((prev) => {
        const next: CustomGameConfig = {
          ...prev,
          bestScore: Math.max(prev.bestScore, score),
          totalWins: won ? prev.totalWins + 1 : prev.totalWins,
        };
        persistConfig(next);
        return next;
      });
    },
    [persistConfig]
  );

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0B1120] text-slate-300">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
          <p className="mt-3 text-sm font-medium">Loading game assets...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-100">
      <header className="border-b border-slate-800/90 bg-[#0D1526]">
        <div className="mx-auto flex max-w-[1040px] items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
          <span className="font-display text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
            Skyline Studio Arcade
          </span>
          <span className="text-xs font-medium text-slate-400 whitespace-nowrap shrink-0">
            45-Second Survival Challenge
          </span>
        </div>
      </header>

      <main>
        <GameArena
          config={config}
          media={media}
          audioController={audioController}
          autoplayBlocked={audioPlaybackState.autoplayBlocked}
          activeAudioSlot={audioPlaybackState.activeSlot}
          onToggleMute={() =>
            handleChangeSettings({ muted: !config.settings.muted })
          }
          onRecordRunOutcome={handleRecordRunOutcome}
        />
      </main>
    </div>
  );
}
