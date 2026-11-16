import React, { useEffect, useState } from 'react';
import { Download, FileJson, Image as ImageIcon, Music, X } from 'lucide-react';
import { loadAllAssetBlobs, loadGameConfig } from '../storage/indexedDb';
import { AudioSlotKey, CustomGameConfig, ImageSlotKey } from '../types/game';

interface IndexedDbExportModalProps {
  onClose: () => void;
}

interface ExportableItem {
  key: string;
  slotType: 'image' | 'audio';
  slotName: ImageSlotKey | AudioSlotKey;
  targetFilename: string;
  originalName: string;
  blob: Blob;
}

const IMAGE_TARGET_NAMES: Record<ImageSlotKey, string> = {
  character: 'character',
  upperPillar: 'upper-pillar',
  lowerPillar: 'lower-pillar',
  background: 'background',
};

const AUDIO_TARGET_NAMES: Record<AudioSlotKey, string> = {
  flying: 'flying',
  collision: 'collision',
  victory: 'victory',
  gameOver: 'game-over',
  startScreen: 'start-screen',
};

function getExtension(filename: string, mimeType: string, fallback: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(filename);
  if (match) return match[1].toLowerCase();
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  return fallback;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const IndexedDbExportModal: React.FC<IndexedDbExportModalProps> = ({
  onClose,
}) => {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ExportableItem[]>([]);
  const [savedConfig, setSavedConfig] = useState<CustomGameConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    const readDb = async () => {
      const [cfg, blobs] = await Promise.all([loadGameConfig(), loadAllAssetBlobs()]);
      if (cancelled) return;

      const list: ExportableItem[] = [];
      (['character', 'upperPillar', 'lowerPillar', 'background'] as ImageSlotKey[]).forEach(
        (slot) => {
          const blob = blobs[`image:${slot}`];
          if (blob) {
            const orig = cfg.images[slot].fileName || `${IMAGE_TARGET_NAMES[slot]}.png`;
            const ext = getExtension(orig, blob.type, 'png');
            list.push({
              key: `image:${slot}`,
              slotType: 'image',
              slotName: slot,
              targetFilename: `${IMAGE_TARGET_NAMES[slot]}.${ext}`,
              originalName: orig,
              blob,
            });
          }
        }
      );

      (['flying', 'collision', 'victory', 'gameOver', 'startScreen'] as AudioSlotKey[]).forEach(
        (slot) => {
          const blob = blobs[`audio:${slot}`];
          if (blob) {
            const orig = cfg.audio[slot].fileName || `${AUDIO_TARGET_NAMES[slot]}.mp3`;
            const ext = getExtension(orig, blob.type, 'mp3');
            list.push({
              key: `audio:${slot}`,
              slotType: 'audio',
              slotName: slot,
              targetFilename: `${AUDIO_TARGET_NAMES[slot]}.${ext}`,
              originalName: orig,
              blob,
            });
          }
        }
      );

      setSavedConfig(cfg);
      setItems(list);
      setLoading(false);
    };

    void readDb();
    return () => {
      cancelled = true;
    };
  }, []);

  const buildManifestBlob = (): Blob => {
    const manifest: {
      images: Record<ImageSlotKey, string | null>;
      audio: Record<AudioSlotKey, string | null>;
      config: CustomGameConfig | null;
    } = {
      images: {
        character: null,
        upperPillar: null,
        lowerPillar: null,
        background: null,
      },
      audio: {
        flying: null,
        collision: null,
        victory: null,
        gameOver: null,
        startScreen: null,
      },
      config: savedConfig,
    };

    for (const item of items) {
      if (item.slotType === 'image') {
        manifest.images[item.slotName as ImageSlotKey] = item.targetFilename;
      } else {
        manifest.audio[item.slotName as AudioSlotKey] = item.targetFilename;
      }
    }

    return new Blob([JSON.stringify(manifest, null, 2)], {
      type: 'application/json',
    });
  };

  const handleDownloadAll = async () => {
    triggerDownload(buildManifestBlob(), 'manifest.json');
    for (const item of items) {
      await new Promise((r) => window.setTimeout(r, 250));
      triggerDownload(item.blob, item.targetFilename);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Export IndexedDB Assets for public/assets"
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-700 bg-[#0F172A] shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-100">
              Export Browser Assets to public/assets/
            </h2>
            <p className="text-xs text-slate-400">
              Download your locally saved IndexedDB files and manifest.json to place in public/assets/
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close exporter"
            className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-5 space-y-4">
          {loading ? (
            <p className="text-sm text-slate-400">Reading IndexedDB storage...</p>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-300">
              No custom image or audio blobs were found in this browser origin&apos;s IndexedDB. Make sure you open <code className="text-amber-300">?export=1</code> on the exact URL where you originally uploaded your assets.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="text-xs text-slate-300">
                  Found <strong className="text-amber-400">{items.length}</strong> uploaded files in IndexedDB.
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => triggerDownload(buildManifestBlob(), 'manifest.json')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    <FileJson className="h-3.5 w-3.5 text-emerald-400" />
                    Download manifest.json
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadAll()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download All ({items.length + 1} files)
                  </button>
                </div>
              </div>

              <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/40">
                {items.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {item.slotType === 'image' ? (
                        <ImageIcon className="h-4 w-4 shrink-0 text-amber-400" />
                      ) : (
                        <Music className="h-4 w-4 shrink-0 text-emerald-400" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-100">
                          {item.targetFilename}
                        </p>
                        <p className="truncate text-xs text-slate-400">
                          {item.slotName} · {item.originalName} ({Math.round(item.blob.size / 1024)} KB)
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => triggerDownload(item.blob, item.targetFilename)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 shrink-0"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
