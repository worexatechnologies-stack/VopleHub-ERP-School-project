// Robust notification sound engine for School ERP Dashboard
// Implements Web Audio API with auto-unlock, rich multi-tone chime, and fallback audio.

const SOUND_STORAGE_KEY = 'erp_notification_sound_enabled';
const VOLUME_STORAGE_KEY = 'erp_notification_sound_volume';

let sharedAudioCtx: AudioContext | null = null;
let isAudioUnlocked = false;

/**
 * Returns or creates the shared AudioContext.
 */
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    try {
      sharedAudioCtx = new AudioContextClass();
    } catch {
      return null;
    }
  }
  return sharedAudioCtx;
}

/**
 * Proactively unlocks AudioContext on the first user interaction.
 * Modern browsers require a user gesture before playing audio.
 */
export function unlockAudioContext(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    ctx.resume().then(() => {
      isAudioUnlocked = true;
    }).catch(() => {
      // Ignored - will retry on next user gesture
    });
  } else if (ctx.state === 'running') {
    isAudioUnlocked = true;
  }
}

// Auto-register unlock listeners
if (typeof window !== 'undefined') {
  const userGestureEvents = ['click', 'keydown', 'pointerdown', 'touchstart'];
  const handleUserGesture = () => {
    unlockAudioContext();
    if (isAudioUnlocked) {
      userGestureEvents.forEach((evt) => window.removeEventListener(evt, handleUserGesture));
    }
  };
  userGestureEvents.forEach((evt) => window.addEventListener(evt, handleUserGesture, { passive: true }));
}

/**
 * Checks if notification sound is enabled in user settings.
 */
export function isNotificationSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(SOUND_STORAGE_KEY) !== 'false';
}

/**
 * Sets notification sound preference.
 */
export function setNotificationSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SOUND_STORAGE_KEY, enabled ? 'true' : 'false');
}

/**
 * Gets notification volume preference (0.0 to 1.0).
 */
export function getNotificationSoundVolume(): number {
  if (typeof window === 'undefined') return 0.5;
  const stored = localStorage.getItem(VOLUME_STORAGE_KEY);
  if (stored) {
    const parsed = parseFloat(stored);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) return parsed;
  }
  return 0.5;
}

/**
 * Sets notification volume (0.0 to 1.0).
 */
export function setNotificationSoundVolume(volume: number): void {
  if (typeof window === 'undefined') return;
  const clamped = Math.max(0, Math.min(1, volume));
  localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped));
}

export type NotificationSoundType = 'default' | 'success' | 'warning' | 'urgent' | 'message';

interface PlaySoundOptions {
  type?: NotificationSoundType;
  force?: boolean;
  volume?: number;
}

/**
 * Generates an in-memory WAV data URL chime as a zero-dependency fallback
 * in case Web Audio API is disabled or blocked.
 */
function createFallbackChimeWavUrl(): string {
  const sampleRate = 22050;
  const duration = 0.35;
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  // RIFF identifier
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 = PCM)
  view.setUint16(22, 1, true);  // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // ByteRate
  view.setUint16(32, 2, true);  // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  // Synthesize dual-tone pleasant chime
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Chime progression: 880Hz (A5) -> 1318Hz (E6)
    const freq = t < 0.12 ? 880 : 1318.51;
    const decay = Math.exp(-t * 8);
    const sample = Math.sin(2 * Math.PI * freq * t) * 0.7 * decay;
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    view.setInt16(44 + i * 2, intSample, true);
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

let cachedFallbackAudioUrl: string | null = null;

function playFallbackAudio(volume: number) {
  try {
    if (!cachedFallbackAudioUrl) {
      cachedFallbackAudioUrl = createFallbackChimeWavUrl();
    }
    const audio = new Audio(cachedFallbackAudioUrl);
    audio.volume = Math.max(0, Math.min(1, volume));
    void audio.play().catch(() => {
      // Audio play error ignored
    });
  } catch {
    // Fallback ignored
  }
}

/**
 * Plays a rich, clear notification sound for dashboard events.
 * Uses Web Audio API with harmonic frequencies and an ADSR curve.
 */
export async function playNotificationSound(options: PlaySoundOptions = {}): Promise<boolean> {
  const { type = 'default', force = false, volume } = options;

  if (!force && !isNotificationSoundEnabled()) {
    return false;
  }

  const masterVol = typeof volume === 'number' ? Math.max(0, Math.min(1, volume)) : getNotificationSoundVolume();
  if (masterVol <= 0) return false;

  const ctx = getAudioContext();
  if (!ctx) {
    playFallbackAudio(masterVol);
    return true;
  }

  try {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(masterVol, now);
    masterGain.connect(ctx.destination);

    // Multi-tone chord configurations for distinct notification flavors
    const chordConfigs: Record<NotificationSoundType, Array<{ freq: number; delay: number; duration: number; type: OscillatorType; peak: number }>> = {
      default: [
        // Bright friendly modern chime: G5 -> C6 with warm harmonics
        { freq: 783.99, delay: 0.00, duration: 0.28, type: 'sine', peak: 0.38 },
        { freq: 1046.50, delay: 0.08, duration: 0.34, type: 'sine', peak: 0.45 },
        { freq: 1567.98, delay: 0.08, duration: 0.25, type: 'triangle', peak: 0.12 }, // Shimmer
      ],
      success: [
        // Upward triad: C5 -> E5 -> G5
        { freq: 523.25, delay: 0.00, duration: 0.20, type: 'sine', peak: 0.35 },
        { freq: 659.25, delay: 0.07, duration: 0.22, type: 'sine', peak: 0.38 },
        { freq: 783.99, delay: 0.14, duration: 0.36, type: 'sine', peak: 0.45 },
      ],
      warning: [
        // Attention chime: E5 -> G#5
        { freq: 659.25, delay: 0.00, duration: 0.24, type: 'sine', peak: 0.40 },
        { freq: 830.61, delay: 0.10, duration: 0.32, type: 'triangle', peak: 0.42 },
      ],
      urgent: [
        // Double-ping alert
        { freq: 880.00, delay: 0.00, duration: 0.14, type: 'sine', peak: 0.45 },
        { freq: 880.00, delay: 0.16, duration: 0.28, type: 'sine', peak: 0.45 },
      ],
      message: [
        // Soft bubble-pop chime: F5 -> A5
        { freq: 698.46, delay: 0.00, duration: 0.18, type: 'sine', peak: 0.36 },
        { freq: 880.00, delay: 0.06, duration: 0.30, type: 'sine', peak: 0.42 },
      ],
    };

    const notes = chordConfigs[type] || chordConfigs.default;

    notes.forEach((note) => {
      const osc = ctx.createOscillator();
      const noteGain = ctx.createGain();

      osc.type = note.type;
      osc.frequency.setValueAtTime(note.freq, now + note.delay);

      const startTime = now + note.delay;
      const attackTime = 0.015;
      const releaseTime = note.duration;

      // Clean ADSR curve to avoid clicking
      noteGain.gain.setValueAtTime(0.0001, startTime);
      noteGain.gain.exponentialRampToValueAtTime(note.peak, startTime + attackTime);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, startTime + releaseTime);

      osc.connect(noteGain);
      noteGain.connect(masterGain);

      osc.start(startTime);
      osc.stop(startTime + releaseTime + 0.05);
    });

    return true;
  } catch (error) {
    // If Web Audio throws, fallback to audio element
    playFallbackAudio(masterVol);
    return true;
  }
}

/**
 * Triggers a test sound with force=true so the user can preview the chime immediately.
 */
export async function testNotificationSound(type: NotificationSoundType = 'default'): Promise<boolean> {
  unlockAudioContext();
  return playNotificationSound({ type, force: true });
}
