import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { getApiUrl } from '../api';

function getReceiptPdfUri(rideRequestId) {
  const fileName = `trustexpress-receipt-${rideRequestId}.pdf`;
  return `${FileSystem.cacheDirectory}${fileName}`;
}

export async function downloadReceiptPdfToCache(token, rideRequestId) {
  if (!token) {
    throw new Error('Not signed in');
  }

  const url = getApiUrl(`/api/rides/passenger/${rideRequestId}/receipt-pdf`);
  const fileUri = getReceiptPdfUri(rideRequestId);

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

export async function shareReceiptPdf(token, rideRequestId) {
  const fileUri = await downloadReceiptPdfToCache(token, rideRequestId);
  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(fileUri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Share ride receipt',
  });
}

export async function printReceiptPdf(token, rideRequestId) {
  const fileUri = await downloadReceiptPdfToCache(token, rideRequestId);
  await Print.printAsync({ uri: fileUri });
}
