import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, Image, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { PRIMARY_BLUE } from '../../constants/colors';
import { getApiUrl } from '../../api';
import { useDriverStatus } from '../../context/DriverStatusContext';

const DOC_ITEMS = [
  { key: 'driverLicenceUrl', title: "Driver's licence", subtitle: 'Licence document', icon: 'id-card-outline' },
  { key: 'nationalIdFrontUrl', title: 'National ID front', subtitle: 'Front side of ID', icon: 'document-outline' },
  { key: 'nationalIdBackUrl', title: 'National ID back', subtitle: 'Back side of ID', icon: 'document-outline' },
  { key: 'selfieUrl', title: 'Verification selfie', subtitle: 'Selfie used for identity check', icon: 'person-outline' },
  { key: 'selfieWithIdCardUrl', title: 'Selfie with national ID', subtitle: 'Face shown while holding ID card', icon: 'camera-outline' },
];

function getDocumentStatus(profile, key) {
  const hasFile = !!profile?.[key];
  if (!hasFile) return { label: 'Missing', tone: 'missing' };
  if (profile?.status === 'approved') return { label: 'Approved', tone: 'approved' };
  if (profile?.status === 'pending') return { label: 'Sent for review', tone: 'pending' };
  if (profile?.status === 'rejected') return { label: 'Needs resubmission', tone: 'rejected' };
  return { label: 'Uploaded', tone: 'uploaded' };
}

function statusStyles(tone) {
  if (tone === 'approved') return { bg: '#dcfce7', text: '#166534' };
  if (tone === 'pending') return { bg: '#fef3c7', text: '#92400e' };
  if (tone === 'rejected') return { bg: '#fee2e2', text: '#b91c1c' };
  if (tone === 'uploaded') return { bg: '#dbeafe', text: '#1d4ed8' };
  return { bg: '#f3f4f6', text: '#6b7280' };
}

function normalizeDocumentUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  if (raw.startsWith('/')) return getApiUrl(raw);
  try {
    const parsed = new URL(raw);
    if (parsed.pathname.startsWith('/uploads/')) return getApiUrl(parsed.pathname);
    return raw;
  } catch {
    if (raw.startsWith('uploads/')) return getApiUrl(`/${raw}`);
    return raw;
  }
}

export default function DriverDocumentationPage({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { driverStatus: contextDriverStatus } = useDriverStatus();
  const [previewDocument, setPreviewDocument] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const driverStatus = contextDriverStatus ?? route.params?.driverStatus ?? {};
  const profile = driverStatus?.driverProfile;
  const hasSubmittedDocs = !!(
    profile?.driverLicenceUrl ||
    profile?.nationalIdFrontUrl ||
    profile?.nationalIdBackUrl ||
    profile?.selfieUrl ||
    profile?.selfieWithIdCardUrl
  );
  const status = profile?.status;
  const isApproved = status === 'approved';
  const isPending = status === 'pending';
  const isRejected = status === 'rejected';
  const canResubmit = profile?.canResubmit !== false;
  const notSubmitted = !hasSubmittedDocs;

  const uploadedDocs = useMemo(
    () =>
      DOC_ITEMS.map((item) => ({
        ...item,
        url: normalizeDocumentUrl(profile?.[item.key]),
        statusMeta: getDocumentStatus(profile, item.key),
      })),
    [profile]
  );

  const missingDocs = uploadedDocs.filter((item) => item.statusMeta.tone === 'missing');
  const sentForReviewDocs = uploadedDocs.filter((item) => item.statusMeta.tone === 'pending');
  const approvedDocs = uploadedDocs.filter((item) => item.statusMeta.tone === 'approved');

  const statusLabel = notSubmitted
    ? 'Not yet submitted'
    : isApproved
      ? 'Verified'
      : isPending
        ? 'Under review'
        : 'Rejected';

  const openPreview = (item) => {
    setPreviewFailed(false);
    setPreviewLoading(true);
    setPreviewDocument(item);
  };

  return (
    <View className="flex-1 bg-white">
      <View
        className="flex-row items-center border-b border-gray-100 bg-white"
        style={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: 12 }}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} className="p-2 -ml-2">
          <Ionicons name="arrow-back" size={24} color="#111" />
        </TouchableOpacity>
        <Text className="ml-2 flex-1 text-lg font-bold text-gray-900">Documentation</Text>
        <View className="w-6" />
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <View className="items-center py-6">
          {isApproved ? (
            <View className="mb-4 h-20 w-20 items-center justify-center rounded-full bg-green-100">
              <Ionicons name="checkmark-circle" size={48} color="#16a34a" />
            </View>
          ) : (
            <View className={`mb-4 h-20 w-20 items-center justify-center rounded-full ${isRejected ? 'bg-red-100' : 'bg-amber-100'}`}>
              <Ionicons name="document-text-outline" size={40} color={isRejected ? '#dc2626' : '#d97706'} />
            </View>
          )}
          <Text className="mb-1 text-xl font-semibold text-gray-900">{statusLabel}</Text>
          <Text className="px-4 text-center text-sm text-gray-500">
            {notSubmitted && 'Submit your driver licence, national ID, selfie, and selfie with your ID for verification.'}
            {isPending && 'Your documents are being reviewed. The files you submitted are listed below.'}
            {isApproved && 'Your identity documents have been verified. You can review them below.'}
            {isRejected && !canResubmit && 'You are not allowed to resubmit. Contact support if you believe this is an error.'}
            {isRejected && canResubmit && (profile?.rejectionReason || 'Your documents were not approved. Review them below and resubmit when ready.')}
          </Text>
        </View>

        <View className="mb-6 rounded-[20px] bg-[#f8fafc] px-4 py-5">
          <Text className="text-base font-semibold text-gray-900">Verification progress</Text>
          <Text className="mt-3 text-sm text-gray-500">
            Missing: <Text className="font-semibold text-gray-900">{missingDocs.length}</Text>
          </Text>
          <Text className="mt-1 text-sm text-gray-500">
            Sent for review: <Text className="font-semibold text-gray-900">{sentForReviewDocs.length}</Text>
          </Text>
          <Text className="mt-1 text-sm text-gray-500">
            Approved: <Text className="font-semibold text-gray-900">{approvedDocs.length}</Text>
          </Text>
        </View>

        {uploadedDocs.length ? (
          <View className="mb-6">
            <Text className="mb-3 text-base font-semibold text-gray-900">Documentation status</Text>
            {uploadedDocs.map((item) => (
              <View
                key={item.key}
                className="mb-4 flex-row items-center rounded-[20px] border border-gray-200 bg-white p-4"
              >
                <View className="mr-4 h-14 w-14 items-center justify-center rounded-[16px] bg-[#eff6ff]">
                  <Ionicons name={item.icon} size={24} color={PRIMARY_BLUE} />
                </View>
                <View className="flex-1 pr-3">
                  <Text className="text-base font-semibold text-gray-900">{item.title}</Text>
                  <Text className="mt-1 text-sm text-gray-500">{item.subtitle}</Text>
                  <View
                    className="mt-2 self-start rounded-full px-2.5 py-1"
                    style={{ backgroundColor: statusStyles(item.statusMeta.tone).bg }}
                  >
                    <Text
                      className="text-[11px] font-semibold uppercase tracking-[0.6px]"
                      style={{ color: statusStyles(item.statusMeta.tone).text }}
                    >
                      {item.statusMeta.label}
                    </Text>
                  </View>
                </View>
                {item.url ? (
                  <TouchableOpacity
                    onPress={() => openPreview(item)}
                    className="rounded-[14px] px-4 py-2"
                    style={{ backgroundColor: '#eff6ff' }}
                  >
                    <Text className="text-sm font-semibold" style={{ color: PRIMARY_BLUE }}>View</Text>
                  </TouchableOpacity>
                ) : (
                  <View className="h-9 w-9 items-center justify-center rounded-full bg-gray-100">
                    <Ionicons name="alert-circle-outline" size={18} color="#9ca3af" />
                  </View>
                )}
              </View>
            ))}
          </View>
        ) : (
          <View className="mb-6 rounded-[20px] bg-[#f8fafc] px-4 py-5">
            <Text className="text-base font-semibold text-gray-900">No documents uploaded yet</Text>
            <Text className="mt-1 text-sm text-gray-500">
              Your uploaded identity files will appear here once they are available in your driver profile.
            </Text>
          </View>
        )}

        {isRejected && !canResubmit ? (
          <View className="rounded-xl bg-gray-100 p-4 items-center">
            <Ionicons name="lock-closed-outline" size={24} color="#6b7280" />
            <Text className="mt-2 text-center text-sm text-gray-600">Resubmission is disabled. Contact support.</Text>
          </View>
        ) : null}

        {(notSubmitted || (isRejected && canResubmit)) ? (
          <TouchableOpacity
            className="flex-row items-center justify-center gap-2 rounded-xl p-4"
            style={{ backgroundColor: PRIMARY_BLUE }}
            onPress={() => navigation.getParent()?.getParent()?.navigate?.('DriverUploadDocuments')}
          >
            <Text className="font-semibold text-white">{notSubmitted ? 'Submit documents' : 'Resubmit documents'}</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      <Modal visible={!!previewDocument} transparent animationType="fade" onRequestClose={() => setPreviewDocument(null)}>
        <SafeAreaView className="flex-1 bg-black/90" edges={['top', 'bottom', 'left', 'right']}>
          <View className="flex-row items-center justify-between px-5 pt-3 pb-4">
            <TouchableOpacity
              onPress={() => setPreviewDocument(null)}
              className="h-10 w-10 items-center justify-center rounded-full bg-white/10"
            >
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </TouchableOpacity>
            <Text className="flex-1 px-4 text-center text-lg font-semibold text-white" numberOfLines={1}>
              {previewDocument?.title || 'Document preview'}
            </Text>
            <View className="h-10 w-10" />
          </View>

          <View
            className="flex-1 items-center justify-center px-4"
            style={{
              paddingTop: 4,
              paddingBottom: Math.max(insets.bottom + 12, 24),
            }}
          >
            {previewDocument?.url ? (
              <>
                <Image
                  source={{ uri: previewDocument.url }}
                  style={{ width: '100%', height: '100%', maxWidth: 420, maxHeight: '84%', borderRadius: 24 }}
                  resizeMode="contain"
                  onLoadStart={() => {
                    setPreviewLoading(true);
                  }}
                  onLoadEnd={() => {
                    setPreviewLoading(false);
                  }}
                  onError={() => {
                    setPreviewLoading(false);
                    setPreviewFailed(true);
                  }}
                />
                {previewLoading ? (
                  <View className="absolute inset-0 items-center justify-center">
                    <ActivityIndicator size="large" color="#fff" />
                  </View>
                ) : null}
                {previewFailed ? (
                  <View className="absolute inset-0 items-center justify-center px-8">
                    <Ionicons name="alert-circle-outline" size={42} color="#fff" />
                    <Text className="mt-3 text-center text-sm text-white">
                      File not found on server.
                    </Text>
                  </View>
                ) : null}
              </>
            ) : null}
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
