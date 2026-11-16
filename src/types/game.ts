export type GameState =
  | 'START_SCREEN'
  | 'PLAYING'
  | 'PAUSED'
  | 'COLLIDING'
  | 'GAME_OVER'
  | 'WIN';

export type ImageSlotKey = 'character' | 'upperPillar' | 'lowerPillar' | 'background';

export type AudioSlotKey =
  | 'flying'
  | 'collision'
  | 'victory'
  | 'gameOver'
  | 'startScreen';

export type ScaleMode = 'cover' | 'contain' | 'tile';

export interface ImageSlotConfig {
  hasAsset: boolean;
  fileName: string;
  fileSize: number;
  mimeType: string;
  naturalWidth: number;
  naturalHeight: number;
  /** Normalized 0..1 crop box in source image coordinates */
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  /** Fine offset in rendered pixels */
  offsetX: number;
  offsetY: number;
  /** Base rotation in degrees (-180..180) */
  rotation: number;
  /** Rendered dimensions (character width/height, pillar width/height scale) */
  width: number;
  height: number;
  aspectLock: boolean;
  scaleMode: ScaleMode;
  imageScale: number;
  dynamicTilt: boolean;
  flipHorizontal: boolean;
  flipVertical: boolean;
  /** Background-specific options */
  dimOpacity: number;
  parallaxSpeed: number;
}

export interface AudioSlotConfig {
  hasAsset: boolean;
  fileName: string;
  fileSize: number;
  mimeType: string;
  duration: number;
  volume: number;
  loop: boolean;
}

export interface GameSettings {
  gravity: number;
  flapStrength: number;
  scrollSpeed: number;
  pillarGap: number;
  pillarSpacing: number;
  hitboxForgiveness: number;
  masterVolume: number;
  muted: boolean;
  ceilingMode: 'clamp' | 'collide';
  showHitboxInPreview: boolean;
}

export interface CustomGameConfig {
  images: Record<ImageSlotKey, ImageSlotConfig>;
  audio: Record<AudioSlotKey, AudioSlotConfig>;
  settings: GameSettings;
  bestScore: number;
  totalWins: number;
}

export interface LoadedMediaAssets {
  imageUrls: Partial<Record<ImageSlotKey, string>>;
  imageElements: Partial<Record<ImageSlotKey, HTMLImageElement>>;
  audioUrls: Partial<Record<AudioSlotKey, string>>;
}

export interface SavedCustomizationProfile {
  id: string;
  name: string;
  savedAt: number;
  config: CustomGameConfig;
  imageCount: number;
  audioCount: number;
}

export interface SerializedBlobEntry {
  mimeType: string;
  dataUrl: string;
}

export interface CustomizationBundle {
  format: 'skyline-studio-arcade-customization';
  version: 1;
  exportedAt: number;
  name: string;
  config: CustomGameConfig;
  blobs: Record<string, SerializedBlobEntry>;
}

export const SURVIVAL_DURATION_SECONDS = 45;

export function createDefaultImageConfig(slot: ImageSlotKey): ImageSlotConfig {
  const base: ImageSlotConfig = {
    hasAsset: false,
    fileName: '',
    fileSize: 0,
    mimeType: '',
    naturalWidth: 0,
    naturalHeight: 0,
    cropX: 0,
    cropY: 0,
    cropWidth: 1,
    cropHeight: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    width: slot === 'character' ? 56 : 78,
    height: slot === 'character' ? 56 : 420,
    aspectLock: slot === 'character',
    scaleMode: slot === 'background' ? 'cover' : slot === 'character' ? 'contain' : 'cover',
    imageScale: 1,
    dynamicTilt: slot === 'character',
    flipHorizontal: false,
    flipVertical: false,
    dimOpacity: slot === 'background' ? 0.15 : 0,
    parallaxSpeed: slot === 'background' ? 0.35 : 0,
  };
  return base;
}

export function createDefaultAudioConfig(slot: AudioSlotKey): AudioSlotConfig {
  return {
    hasAsset: false,
    fileName: '',
    fileSize: 0,
    mimeType: '',
    duration: 0,
    volume: slot === 'collision' ? 0.95 : 0.8,
    loop: slot === 'flying' || slot === 'startScreen',
  };
}

export function createDefaultGameConfig(): CustomGameConfig {
  return {
    images: {
      character: createDefaultImageConfig('character'),
      upperPillar: createDefaultImageConfig('upperPillar'),
      lowerPillar: createDefaultImageConfig('lowerPillar'),
      background: createDefaultImageConfig('background'),
    },
    audio: {
      flying: createDefaultAudioConfig('flying'),
      collision: createDefaultAudioConfig('collision'),
      victory: createDefaultAudioConfig('victory'),
      gameOver: createDefaultAudioConfig('gameOver'),
      startScreen: createDefaultAudioConfig('startScreen'),
    },
    settings: {
      gravity: 1380,
      flapStrength: 430,
      scrollSpeed: 215,
      pillarGap: 172,
      pillarSpacing: 295,
      hitboxForgiveness: 0.16,
      masterVolume: 0.85,
      muted: false,
      ceilingMode: 'clamp',
      showHitboxInPreview: true,
    },
    bestScore: 0,
    totalWins: 0,
  };
}
