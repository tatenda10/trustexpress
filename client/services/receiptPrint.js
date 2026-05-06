import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { getApiUrl } from '../api';

function getReceiptPdfFileName(rideRequestId, audience = 'passenger') {
  return audience === 'driver'
    ? `trustexpress-driver-receipt-${rideRequestId}.pdf`
    : `trustexpress-receipt-${rideRequestId}.pdf`;
}

function getReceiptPdfUri(rideRequestId, audience = 'passenger') {
  const fileName = getReceiptPdfFileName(rideRequestId, audience);
  return `${FileSystem.cacheDirectory}${fileName}`;
}

function getReceiptPdfPath(rideRequestId, audience = 'passenger') {
  if (audience === 'driver') {
    return `/api/drivers/ride-requests/${rideRequestId}/receipt-pdf`;
  }
  return `/api/rides/passenger/${rideRequestId}/receipt-pdf`;
}

export async function downloadReceiptPdfToCache(token, rideRequestId, options = {}) {
  if (!token) {
    throw new Error('Not signed in');
  }

  const audience = options?.audience === 'driver' ? 'driver' : 'passenger';
  const url = getApiUrl(getReceiptPdfPath(rideRequestId, audience));
  const fileUri = getReceiptPdfUri(rideRequestId, audience);

  const result = await FileSystem.downloadAsync(url, fileUri, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (result.status && result.status >= 400) {
    throw new Error('Failed to download receipt PDF.');
  }

  return result.uri;
}

export async function downloadReceiptPdf(token, rideRequestId, options = {}) {
  const audience = options?.audience === 'driver' ? 'driver' : 'passenger';
  const fileName = getReceiptPdfFileName(rideRequestId, audience);
  const cacheUri = await downloadReceiptPdfToCache(token, rideRequestId, { audience });

  if (Platform.OS === 'android' && FileSystem.StorageAccessFramework) {
    const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permissions.granted) {
      throw new Error('Choose a folder to save the receipt.');
    }

    const base64 = await FileSystem.readAsStringAsync(cacheUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
      permissions.directoryUri,
      fileName,
      'application/pdf',
    );
    await FileSystem.StorageAccessFramework.writeAsStringAsync(fileUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { uri: fileUri, fileName };
  }

  const directory = FileSystem.documentDirectory || FileSystem.cacheDirectory;
  const fileUri = `${directory}${fileName}`;
  const existing = await FileSystem.getInfoAsync(fileUri);
  if (existing.exists) {
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
  }
  await FileSystem.copyAsync({ from: cacheUri, to: fileUri });
  return { uri: fileUri, fileName };
}

export async function shareReceiptPdf(token, rideRequestId, options = {}) {
  const fileUri = await downloadReceiptPdfToCache(token, rideRequestId, options);
  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(fileUri, {
    mimeType: 'application/pdf',
    dialogTitle: options?.dialogTitle || 'Share ride receipt',
  });
}

export async function printReceiptPdf(token, rideRequestId, options = {}) {
  const fileUri = await downloadReceiptPdfToCache(token, rideRequestId, options);
  await Print.printAsync({ uri: fileUri });
}
