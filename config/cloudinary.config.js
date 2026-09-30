const cloudinary = require('cloudinary').v2;

function parseCloudinaryUrl(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('cloudinary://')) {
    return null;
  }
  const rest = url.slice('cloudinary://'.length);
  const at = rest.lastIndexOf('@');
  if (at === -1) return null;
  const cloudName = rest.slice(at + 1).trim();
  const keySecret = rest.slice(0, at);
  const colon = keySecret.indexOf(':');
  if (colon === -1 || !cloudName) return null;
  return {
    api_key: keySecret.slice(0, colon),
    api_secret: keySecret.slice(colon + 1),
    cloud_name: cloudName,
  };
}

const fromUrl = parseCloudinaryUrl(process.env.CLOUDINARY_URL);
const CLOUDINARY_CLOUD_NAME =
  process.env.CLOUDINARY_CLOUD_NAME || fromUrl?.cloud_name;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || fromUrl?.api_key;
const CLOUDINARY_API_SECRET =
  process.env.CLOUDINARY_API_SECRET || fromUrl?.api_secret;

if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  throw new Error(
    'Cloudinary not configured. Set CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.'
  );
}

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
});

module.exports = cloudinary;
