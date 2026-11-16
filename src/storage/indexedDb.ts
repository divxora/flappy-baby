import {
  AudioSlotKey,
  createDefaultGameConfig,
  CustomGameConfig,
  CustomizationBundle,
  ImageSlotKey,
  SavedCustomizationProfile,
  SerializedBlobEntry,
} from '../types/game';

const DB_NAME = 'skyline_studio_arcade_db';
const DB_VERSION = 2;
const STORE_CONFIG = 'config';
const STORE_BLOBS = 'asset_blobs';
const STORE_PROFILES = 'saved_profiles';
const STORE_PROFILE_BLOBS = 'saved_profile_blobs';
const CONFIG_KEY = 'active_config';

export type StoredAssetKey = `image:${ImageSlotKey}` | `audio:${AudioSlotKey}`;

const ALL_ASSET_KEYS: StoredAssetKey[] = [
  'image:character',
  'image:upperPillar',
  'image:lowerPillar',
  'image:background',
  'audio:flying',
  'audio:collision',
  'audio:victory',
  'audio:gameOver',
  'audio:startScreen',
];

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_CONFIG)) {
        db.createObjectStore(STORE_CONFIG);
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
      if (!db.objectStoreNames.contains(STORE_PROFILES)) {
        db.createObjectStore(STORE_PROFILES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_PROFILE_BLOBS)) {
        db.createObjectStore(STORE_PROFILE_BLOBS);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
}

function mergeWithDefaults(saved?: Partial<CustomGameConfig>): CustomGameConfig {
  const defaults = createDefaultGameConfig();
  if (!saved) return defaults;
  return {
    images: {
      character: { ...defaults.images.character, ...saved.images?.character },
      upperPillar: { ...defaults.images.upperPillar, ...saved.images?.upperPillar },
      lowerPillar: { ...defaults.images.lowerPillar, ...saved.images?.lowerPillar },
      background: { ...defaults.images.background, ...saved.images?.background },
    },
    audio: {
      flying: { ...defaults.audio.flying, ...saved.audio?.flying },
      collision: { ...defaults.audio.collision, ...saved.audio?.collision },
      victory: { ...defaults.audio.victory, ...saved.audio?.victory },
      gameOver: { ...defaults.audio.gameOver, ...saved.audio?.gameOver },
      startScreen: { ...defaults.audio.startScreen, ...saved.audio?.startScreen },
    },
    settings: {
      ...defaults.settings,
      ...saved.settings,
    },
    bestScore: typeof saved.bestScore === 'number' ? saved.bestScore : 0,
    totalWins: typeof saved.totalWins === 'number' ? saved.totalWins : 0,
  };
}

export async function loadGameConfig(): Promise<CustomGameConfig> {
  const defaults = createDefaultGameConfig();
  try {
    const db = await openDatabase();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_CONFIG, 'readonly');
      const store = tx.objectStore(STORE_CONFIG);
      const req = store.get(CONFIG_KEY);
      req.onsuccess = () => {
        const saved = req.result as Partial<CustomGameConfig> | undefined;
        resolve(mergeWithDefaults(saved));
      };
      req.onerror = () => resolve(defaults);
    });
  } catch {
    return defaults;
  }
}

export async function saveGameConfig(config: CustomGameConfig): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CONFIG, 'readwrite');
    tx.objectStore(STORE_CONFIG).put(config, CONFIG_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save configuration'));
  });
}

export async function saveAssetBlob(key: StoredAssetKey, blob: Blob): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, 'readwrite');
    tx.objectStore(STORE_BLOBS).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save asset blob'));
  });
}

export async function loadAssetBlob(key: StoredAssetKey): Promise<Blob | null> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_BLOBS, 'readonly');
      const req = tx.objectStore(STORE_BLOBS).get(key);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function deleteAssetBlob(key: StoredAssetKey): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, 'readwrite');
    tx.objectStore(STORE_BLOBS).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete asset blob'));
  });
}

export async function loadAllAssetBlobs(): Promise<Record<string, Blob>> {
  const entries = await Promise.all(
    ALL_ASSET_KEYS.map(async (k) => [k, await loadAssetBlob(k)] as const)
  );
  const result: Record<string, Blob> = {};
  for (const [k, blob] of entries) {
    if (blob) {
      result[k] = blob;
    }
  }
  return result;
}

export async function listSavedProfiles(): Promise<SavedCustomizationProfile[]> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_PROFILES, 'readonly');
      const req = tx.objectStore(STORE_PROFILES).getAll();
      req.onsuccess = () => {
        const items = (req.result as SavedCustomizationProfile[] | undefined) ?? [];
        items.sort((a, b) => b.savedAt - a.savedAt);
        resolve(items);
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function saveCustomizationProfile(
  name: string,
  config: CustomGameConfig,
  existingId?: string
): Promise<SavedCustomizationProfile> {
  const id =
    existingId ??
    `profile_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const activeBlobs = await loadAllAssetBlobs();
  const db = await openDatabase();

  const imageCount = Object.values(config.images).filter((i) => i.hasAsset).length;
  const audioCount = Object.values(config.audio).filter((a) => a.hasAsset).length;

  const profile: SavedCustomizationProfile = {
    id,
    name: name.trim() || 'Custom Setup',
    savedAt: Date.now(),
    config: structuredClone(config),
    imageCount,
    audioCount,
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_PROFILES, STORE_PROFILE_BLOBS], 'readwrite');
    tx.objectStore(STORE_PROFILES).put(profile);
    const blobStore = tx.objectStore(STORE_PROFILE_BLOBS);
    for (const key of ALL_ASSET_KEYS) {
      const compositeKey = `${id}:${key}`;
      const blob = activeBlobs[key];
      if (blob) {
        blobStore.put(blob, compositeKey);
      } else {
        blobStore.delete(compositeKey);
      }
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save customization profile'));
  });

  return profile;
}

export async function applySavedProfileToActive(
  profileId: string
): Promise<{ config: CustomGameConfig; blobs: Record<string, Blob> } | null> {
  const db = await openDatabase();
  const profile = await new Promise<SavedCustomizationProfile | null>((resolve) => {
    const tx = db.transaction(STORE_PROFILES, 'readonly');
    const req = tx.objectStore(STORE_PROFILES).get(profileId);
    req.onsuccess = () => resolve((req.result as SavedCustomizationProfile | undefined) ?? null);
    req.onerror = () => resolve(null);
  });

  if (!profile) return null;

  const profileBlobs: Record<string, Blob> = {};
  await Promise.all(
    ALL_ASSET_KEYS.map(
      (key) =>
        new Promise<void>((resolve) => {
          const tx = db.transaction(STORE_PROFILE_BLOBS, 'readonly');
          const req = tx.objectStore(STORE_PROFILE_BLOBS).get(`${profileId}:${key}`);
          req.onsuccess = () => {
            if (req.result) {
              profileBlobs[key] = req.result as Blob;
            }
            resolve();
          };
          req.onerror = () => resolve();
        })
    )
  );

  const mergedConfig = mergeWithDefaults(profile.config);

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_CONFIG, STORE_BLOBS], 'readwrite');
    tx.objectStore(STORE_CONFIG).put(mergedConfig, CONFIG_KEY);
    const activeStore = tx.objectStore(STORE_BLOBS);
    activeStore.clear();
    for (const [key, blob] of Object.entries(profileBlobs)) {
      activeStore.put(blob, key);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to apply saved customization'));
  });

  return { config: mergedConfig, blobs: profileBlobs };
}

export async function deleteSavedProfile(profileId: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_PROFILES, STORE_PROFILE_BLOBS], 'readwrite');
    tx.objectStore(STORE_PROFILES).delete(profileId);
    const blobStore = tx.objectStore(STORE_PROFILE_BLOBS);
    for (const key of ALL_ASSET_KEYS) {
      blobStore.delete(`${profileId}:${key}`);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete saved customization'));
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export async function exportCustomizationBundle(
  name: string,
  config: CustomGameConfig
): Promise<CustomizationBundle> {
  const activeBlobs = await loadAllAssetBlobs();
  const serializedBlobs: Record<string, SerializedBlobEntry> = {};

  for (const [key, blob] of Object.entries(activeBlobs)) {
    serializedBlobs[key] = {
      mimeType: blob.type || 'application/octet-stream',
      dataUrl: await blobToDataUrl(blob),
    };
  }

  return {
    format: 'skyline-studio-arcade-customization',
    version: 1,
    exportedAt: Date.now(),
    name: name.trim() || 'Skyline Customization',
    config: structuredClone(config),
    blobs: serializedBlobs,
  };
}

export async function importCustomizationBundle(
  bundle: CustomizationBundle
): Promise<{ config: CustomGameConfig; blobs: Record<string, Blob> }> {
  if (bundle.format !== 'skyline-studio-arcade-customization' || !bundle.config) {
    throw new Error('Invalid customization bundle file.');
  }

  const mergedConfig = mergeWithDefaults(bundle.config);
  const decodedBlobs: Record<string, Blob> = {};

  for (const key of ALL_ASSET_KEYS) {
    const entry = bundle.blobs?.[key];
    if (entry?.dataUrl) {
      decodedBlobs[key] = await dataUrlToBlob(entry.dataUrl);
    }
  }

  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_CONFIG, STORE_BLOBS], 'readwrite');
    tx.objectStore(STORE_CONFIG).put(mergedConfig, CONFIG_KEY);
    const activeStore = tx.objectStore(STORE_BLOBS);
    activeStore.clear();
    for (const [key, blob] of Object.entries(decodedBlobs)) {
      activeStore.put(blob, key);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to import customization bundle'));
  });

  return { config: mergedConfig, blobs: decodedBlobs };
}

export async function clearAllStoredData(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CONFIG, STORE_BLOBS], 'readwrite');
    tx.objectStore(STORE_CONFIG).clear();
    tx.objectStore(STORE_BLOBS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to clear database'));
  });
}
