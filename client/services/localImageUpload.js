import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';

function isRemoteOrServerUri(uri) {
  return !uri || /^https?:\/\//i.test(uri) || String(uri).startsWith('/uploads/');
}

function inferExtension(uri) {
  const match = String(uri || '').match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
  const extension = String(match?.[1] || 'jpg').toLowerCase();
  return extension === 'jpeg' ? 'jpg' : extension;
}

function buildStableCacheUri(extension = 'jpg') {
  const directory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!directory) return null;
  const suffix = Math.random().toString(36).slice(2, 10);
  return `${directory}upload-${Date.now()}-${suffix}.${extension}`;
}

export async function persistLocalImageUri(uri, options = {}) {
  if (isRemoteOrServerUri(uri) || !String(uri).startsWith('file://')) return uri;

  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info?.exists) return uri;

    const targetUri = buildStableCacheUri(options.fileExtension || inferExtension(uri));
    if (!targetUri) return uri;

    await FileSystem.copyAsync({ from: uri, to: targetUri });
    return targetUri;
  } catch (error) {
    console.warn('[localImageUpload] persistLocalImageUri fallback', {
      uri,
      error: error?.message || null,
    });
    return uri;
  }
}

export async function prepareImageForUpload(uri, { maxWidth = 1280, compress = 0.7 } = {}) {
  if (isRemoteOrServerUri(uri)) return uri;

  const stableUri = await persistLocalImageUri(uri, { fileExtension: 'jpg' });

  try {
    const actions = maxWidth ? [{ resize: { width: maxWidth } }] : [];
    const result = await ImageManipulator.manipulateAsync(stableUri, actions, {
      compress,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return result?.uri || stableUri || uri;
  } catch (error) {
    console.warn('[localImageUpload] prepareImageForUpload fallback', {
      uri,
      stableUri,
      error: error?.message || null,
    });
    return stableUri || uri;
  }
}
