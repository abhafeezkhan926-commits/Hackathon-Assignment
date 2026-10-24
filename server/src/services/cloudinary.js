import { v2 as cloudinary } from 'cloudinary';

export function cloudinaryConfigured() {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}
export function configureCloudinary() {
  cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, secure: true });
}
export function uploadAvatar(buffer, userId) {
  configureCloudinary();
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream({ folder: 'hcm-lite/avatars', public_id: `user-${userId}-${Date.now()}`, overwrite: false, resource_type: 'image', transformation: [{ width: 512, height: 512, crop: 'fill', gravity: 'face' }] }, (error, result) => error ? reject(error) : resolve(result)).end(buffer);
  });
}
export function uploadLiveCover(buffer, userId) {
  configureCloudinary();
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream({ folder: 'hcm-lite/live', public_id: `live-${userId}-${Date.now()}`, overwrite: false, resource_type: 'image', transformation: [{ width: 1280, height: 720, crop: 'fill' }] }, (error, result) => error ? reject(error) : resolve(result)).end(buffer);
  });
}
export async function deleteCloudAsset(publicId) {
  if (!publicId || !cloudinaryConfigured()) return;
  configureCloudinary();
  await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
}
