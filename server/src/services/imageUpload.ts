// Image Upload Service
// Handles uploading base64 images to cloud storage and returning hosted URLs

import { v2 as cloudinary } from 'cloudinary';
import { appLogger } from '../middleware/requestLogger.js';

// Configure Cloudinary from environment
const isConfigured = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (isConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  appLogger.info('Cloudinary configured for image uploads');
} else {
  appLogger.warn('Cloudinary not configured - image uploads will fail. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET');
}

/**
 * Check if a URL is a base64 data URL
 */
export function isDataUrl(url: string): boolean {
  return url?.startsWith('data:');
}

/**
 * Check if image upload service is available
 */
export function isImageUploadAvailable(): boolean {
  return isConfigured;
}

/**
 * Upload a base64 image to Cloudinary and return the hosted URL
 * @param dataUrl - Base64 data URL (data:image/jpeg;base64,...)
 * @param options - Upload options
 * @returns Hosted URL or null if upload fails
 */
export async function uploadImage(
  dataUrl: string,
  options?: {
    folder?: string;
    publicId?: string;
    transformation?: Record<string, unknown>;
  }
): Promise<string | null> {
  if (!isConfigured) {
    appLogger.warn('Cloudinary not configured - cannot upload image');
    return null;
  }

  if (!isDataUrl(dataUrl)) {
    // Already a hosted URL, return as-is
    return dataUrl;
  }

  try {
    const result = await cloudinary.uploader.upload(dataUrl, {
      folder: options?.folder || 'order-pulse/items',
      public_id: options?.publicId,
      transformation: options?.transformation || [
        { width: 800, height: 800, crop: 'limit' }, // Limit size
        { quality: 'auto' },
        { fetch_format: 'auto' },
      ],
      resource_type: 'image',
    });

    appLogger.info({ publicId: result.public_id, url: result.secure_url }, 'Image uploaded to Cloudinary');
    return result.secure_url;
  } catch (error) {
    appLogger.error({ err: error }, 'Failed to upload image to Cloudinary');
    return null;
  }
}

/**
 * Upload multiple images in parallel
 * @param dataUrls - Array of base64 data URLs or hosted URLs
 * @param folder - Folder name in Cloudinary
 * @returns Map of original URL to hosted URL
 */
export async function uploadImages(
  dataUrls: string[],
  folder?: string
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  const uploadPromises = dataUrls.map(async (url) => {
    if (!isDataUrl(url)) {
      // Already hosted
      results.set(url, url);
      return;
    }

    const hostedUrl = await uploadImage(url, { folder });
    if (hostedUrl) {
      results.set(url, hostedUrl);
    }
  });

  await Promise.all(uploadPromises);
  return results;
}

/**
 * Ensure an image URL is hosted (upload if it's a data URL)
 * @param imageUrl - Image URL (data URL or hosted URL)
 * @param folder - Optional folder for organization
 * @returns Hosted URL or original URL if upload fails/not configured
 */
export async function ensureHostedUrl(
  imageUrl: string | undefined,
  folder?: string
): Promise<string | undefined> {
  if (!imageUrl) return undefined;
  
  if (!isDataUrl(imageUrl)) {
    // Already hosted
    return imageUrl;
  }

  if (!isConfigured) {
    appLogger.warn('Image is data URL but Cloudinary not configured - returning undefined');
    return undefined; // Don't send data URLs to Arda
  }

  const hostedUrl = await uploadImage(imageUrl, { folder });
  return hostedUrl || undefined;
}

export const imageUploadService = {
  isDataUrl,
  isImageUploadAvailable,
  uploadImage,
  uploadImages,
  ensureHostedUrl,
};
