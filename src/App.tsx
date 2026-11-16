import { useCallback, useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { GameAudioController } from './audio/audioManager';
import { GameArena } from './components/GameArena';
import { IndexedDbExportModal } from './components/IndexedDbExportModal';
import { loadAllAssetBlobs, loadGameConfig, saveGameConfig } from './storage/indexedDb';
import {
  AudioSlotKey,
  createDefaultGameConfig,
  CustomGameConfig,
  GameSettings,
  ImageSlotKey,
  LoadedMediaAssets,
} from './types/game';
import { getViteBaseUrl, resolveAssetUrl } from './utils/assetPath';

interface StaticAssetManifest {
  images?: Partial<Record<ImageSlotKey, string | null>>;
  audio?: Partial<Record<AudioSlotKey, string | null>>;
  config?: Partial<CustomGameConfig> | null;
}

async function fetchStaticManifest(): Promise<StaticAssetManifest | null> {
  try {
    const manifestUrl = `${getViteBaseUrl()}assets/manifest.json`;
    const res = await fetch(manifestUrl, { cache: 'no-cache' });
    if (!res.ok) return null;
    return (await res.json()) as StaticAssetManifest;
  } catch {
    return null;
  }
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to decode image: ${url}`));
    img.src = url;
  });
}

export default function App() {
  const [hydrated, setHydrated] = useState(false);
  const [initWarning, setInitWarning] = useState<string | null>(null);
  const [showExporter, setShowExporter] = useState(() =>
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('export') === '1'
  );
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

  // Hydrate static defaults from public/assets/manifest.json and any local IndexedDB overrides
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        const [loadedConfig, blobs, manifest] = await Promise.all([
          loadGameConfig(),
          loadAllAssetBlobs(),
          fetchStaticManifest(),
        ]);

        if (cancelled) return;

        const staticCfg = manifest?.config;

        // Apply static config defaults for transforms/settings if provided
        if (staticCfg) {
          if (staticCfg.settings) {
            loadedConfig.settings = {
              ...loadedConfig.settings,
              ...staticCfg.settings,
              muted: loadedConfig.settings.muted,
            };
          }
          if (staticCfg.images) {
            (['character', 'upperPillar', 'lowerPillar', 'background'] as ImageSlotKey[]).forEach(
              (slot) => {
                if (staticCfg.images?.[slot] && !blobs[`image:${slot}`]) {
                  loadedConfig.images[slot] = {
                    ...loadedConfig.images[slot],
                    ...staticCfg.images[slot],
                  };
                }
              }
            );
          }
          if (staticCfg.audio) {
            (['flying', 'collision', 'victory', 'gameOver', 'startScreen'] as AudioSlotKey[]).forEach(
              (slot) => {
                if (staticCfg.audio?.[slot] && !blobs[`audio:${slot}`]) {
                  loadedConfig.audio[slot] = {
                    ...loadedConfig.audio[slot],
                    ...staticCfg.audio[slot],
                  };
                }
              }
            );
          }
        }

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
          const staticFile = manifest?.images?.[slot];
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
          } else if (staticFile) {
            const staticUrl = resolveAssetUrl(staticFile, 'assets/');
            try {
              const el = await loadImageElement(staticUrl);
              if (!cancelled) {
                nextImageElements[slot] = el;
                loadedConfig.images[slot].hasAsset = true;
                loadedConfig.images[slot].fileName = staticFile;
                loadedConfig.images[slot].naturalWidth = el.naturalWidth;
                loadedConfig.images[slot].naturalHeight = el.naturalHeight;
              }
            } catch {
              loadedConfig.images[slot].hasAsset = false;
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
          const staticFile = manifest?.audio?.[slot];
          if (blob) {
            const url = URL.createObjectURL(blob);
            nextAudioUrls[slot] = url;
            audioController.setTrackSource(slot, url);
          } else if (staticFile) {
            const staticUrl = resolveAssetUrl(staticFile, 'assets/');
            audioController.setTrackSource(slot, staticUrl);
            loadedConfig.audio[slot].hasAsset = true;
            loadedConfig.audio[slot].fileName = staticFile;
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
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setInitWarning(`Could not load locally saved assets (${msg}). Running with default assets.`);
        }
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
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
          <button
            type="button"
            onClick={() => {
              audioController.stopAll();
              setShowExporter(true);
            }}
            className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-slate-100 transition-colors hover:bg-slate-700 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5 text-amber-400" />
            Export Assets
          </button>
        </div>
      </header>

      <main>
        {initWarning && (
          <div className="mx-auto mt-4 max-w-[1040px] px-4 sm:px-6">
            <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200">
              <span>{initWarning}</span>
              <button
                type="button"
                onClick={() => setInitWarning(null)}
                className="rounded px-2 py-1 font-semibold text-amber-300 hover:bg-amber-500/20"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
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

      {showExporter && (
        <IndexedDbExportModal onClose={() => setShowExporter(false)} />
      )}
    </div>
  );
}
