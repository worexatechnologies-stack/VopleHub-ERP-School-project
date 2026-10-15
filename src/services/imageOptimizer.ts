import imageCompression from 'browser-image-compression';

export interface OptimizedImage {
  file: File;
  previewUrl: string;
  originalBytes: number;
  optimizedBytes: number;
  width: number;
  height: number;
}

const MAX_DIMENSION = 1024;
const MAX_OPTIMIZED_SIZE_MB = 1.5;
const WEBP_QUALITY = 0.86;

export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Browser-side optimization only improves upload speed; the server revalidates every image. */
export async function optimizeImageForUpload(source: File): Promise<OptimizedImage> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(source.type)) throw new Error('Choose a JPEG, PNG, or WebP image.');
  if (source.size > 10 * 1024 * 1024) throw new Error('Image must be 10 MB or smaller before optimization.');

  const compressed = await imageCompression(source, {
    maxSizeMB: MAX_OPTIMIZED_SIZE_MB,
    maxWidthOrHeight: MAX_DIMENSION,
    useWebWorker: true,
    fileType: 'image/webp',
    initialQuality: WEBP_QUALITY,
    preserveExif: false,
    maxIteration: 6,
  });
  // browser-image-compression preserves the source filename.  Since the
  // encoded bytes above are WebP, give the multipart file a matching `.webp`
  // extension.  The server intentionally rejects mismatched names and bytes.
  const basename = source.name.replace(/\.[^/.]+$/, '') || 'image';
  const file = new File([compressed], `${basename}.webp`, {
    type: 'image/webp',
    lastModified: Date.now(),
  });
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = bitmap;
  bitmap.close();

  return { file, previewUrl: URL.createObjectURL(file), originalBytes: source.size, optimizedBytes: file.size, width, height };
}
