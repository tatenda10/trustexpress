import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'
import { resolveMediaCandidates, resolveMediaUrl } from '../utils/media'

function Field({ label, value }) {
  return (
    <div className="min-w-[140px]">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-800">{value || '-'}</p>
    </div>
  )
}

function AssessmentBadge({ passed, children }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${passed ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'}`}>
      {children}
    </span>
  )
}

function requiredDocumentEntries(driver) {
  const profileDocs = driver?.profileDocs || {}
  const vehicleDocs = driver?.vehicleDocs || {}
  const rawCarPhotoUrls = [
    resolveMediaUrl(vehicleDocs.carPhotoFrontUrl),
    resolveMediaUrl(vehicleDocs.carPhotoRearUrl),
    ...(Array.isArray(vehicleDocs.carPhotoUrls)
      ? vehicleDocs.carPhotoUrls.map((url) => resolveMediaUrl(url))
      : []),
  ].filter(Boolean)
  const carPhotoUrls = Array.from(new Set(rawCarPhotoUrls))

  return {
    identity: [
      { key: 'national-id-front', label: 'National ID Front', url: resolveMediaUrl(profileDocs.nationalIdFrontUrl) },
      { key: 'national-id-back', label: 'National ID Back', url: resolveMediaUrl(profileDocs.nationalIdBackUrl) },
      { key: 'driver-licence', label: 'Driver License', url: resolveMediaUrl(profileDocs.driverLicenceUrl) },
      { key: 'selfie', label: 'Selfie', url: resolveMediaUrl(profileDocs.selfieUrl) },
      { key: 'selfie-with-id', label: 'Selfie with National ID', url: resolveMediaUrl(profileDocs.selfieWithIdCardUrl) },
    ],
    vehicle: [
      { key: 'vehicle-registration', label: 'Vehicle Registration', url: resolveMediaUrl(vehicleDocs.vehicleRegistrationUrl || vehicleDocs.vehicleRegistrationBookUrl) },
      { key: 'insurance', label: 'Insurance', url: resolveMediaUrl(vehicleDocs.insuranceUrl) },
      { key: 'zinara', label: 'Zinara', url: resolveMediaUrl(vehicleDocs.zinaraUrl) },
    ],
    carPhotos: carPhotoUrls.map((url, index) => ({
      key: `car-photo-${index + 1}`,
      label: `Car Photo ${index + 1}`,
      url,
    })),
  }
}

function getDocumentKind(url) {
  const value = String(url || '').toLowerCase()
  if (!value) return 'unknown'
  if (value.includes('.pdf')) return 'pdf'
  if (/\.(jpg|jpeg|png|webp|gif|bmp|svg)(\?|#|$)/.test(value)) return 'image'
  return 'file'
}

function DocumentPreview({ url, label }) {
  if (!url) {
    return <div className="px-3 py-6 text-sm text-slate-500">No file uploaded yet.</div>
  }

  const kind = getDocumentKind(url)
  const candidates = resolveMediaCandidates(url)
  const [activeUrlIndex, setActiveUrlIndex] = useState(0)
  const activeUrl = candidates[activeUrlIndex] || url
  const fallbackOpenUrl = candidates[candidates.length - 1] || url

  useEffect(() => {
    setActiveUrlIndex(0)
  }, [url])

  if (kind === 'image') {
    return (
      <>
        <a href={fallbackOpenUrl} target="_blank" rel="noreferrer" className="block bg-slate-100">
          <img
            src={activeUrl}
            alt={label}
            className="h-64 w-full object-contain bg-slate-100"
            onError={() => {
              setActiveUrlIndex((current) => {
                if (current >= candidates.length - 1) return current
                return current + 1
              })
            }}
          />
        </a>
        <div className="border-t border-slate-200 px-3 py-2">
          <a
            href={fallbackOpenUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-[11px] font-semibold text-indigo-700 hover:text-indigo-500"
          >
            Open full image
          </a>
        </div>
      </>
    )
  }

  if (kind === 'pdf') {
    return (
      <>
        <div className="bg-slate-100 p-3">
          <iframe
            src={activeUrl}
            title={label}
            className="h-64 w-full rounded-sm border border-slate-200 bg-white"
          />
        </div>
        <div className="border-t border-slate-200 px-3 py-2">
          <a
            href={fallbackOpenUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-[11px] font-semibold text-indigo-700 hover:text-indigo-500"
          >
            Open PDF
          </a>
        </div>
      </>
    )
  }

  return (
    <div className="space-y-3 bg-slate-100 px-3 py-6">
      <p className="text-sm text-slate-600">Preview is not available for this file type in the admin panel.</p>
      <a
        href={fallbackOpenUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-block text-[11px] font-semibold text-indigo-700 hover:text-indigo-500"
      >
        Open uploaded file
      </a>
    </div>
  )
}

function formatAdminDateTime(value) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value

  return parsed.toLocaleString('en-ZW', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function DriverVerificationDetailPage() {
  const { driverId } = useParams()
  const { token, can, admin } = useAuth()
  const [loading, setLoading] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [error, setError] = useState('')
  const [driver, setDriver] = useState(null)
  const [carPhotoIndex, setCarPhotoIndex] = useState(0)
  const [vehicleTiers, setVehicleTiers] = useState([])
  const [selectedApprovedTierKey, setSelectedApprovedTierKey] = useState('')
  const [activeSection, setActiveSection] = useState('documentation')
  const [rejectReasonPreset, setRejectReasonPreset] = useState('')
  const [customRejectReason, setCustomRejectReason] = useState('')
  const [headerImageUrlIndex, setHeaderImageUrlIndex] = useState(0)

  const loadDriver = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/drivers/${driverId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      setDriver(data.driver || null)
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load driver verification record')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDriver()
  }, [driverId, token])

  useEffect(() => {
    let active = true

    const loadVehicleTiers = async () => {
      try {
        const { data } = await axios.get(`${BASE_URL}/api/admin/vehicle-tiers`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
        if (!active) return
        setVehicleTiers(Array.isArray(data?.tiers) ? data.tiers.filter((tier) => tier?.isActive !== false) : [])
      } catch {
        if (!active) return
        setVehicleTiers([])
      }
    }

    loadVehicleTiers()

    return () => {
      active = false
    }
  }, [token])

  const documentGroups = useMemo(() => requiredDocumentEntries(driver), [driver])
  const identityDocuments = documentGroups.identity
  const vehicleDocuments = documentGroups.vehicle
  const hasProfileDocuments = identityDocuments.some((doc) => !!doc.url)
  const hasVehicleDocuments = vehicleDocuments.some((doc) => !!doc.url) || documentGroups.carPhotos.length > 0
  const profileImageReview = driver?.profileImageReview || null
  const approvedProfilePhotoUrl = resolveMediaUrl(profileImageReview?.approvedImageUrl)
  const pendingProfilePhotoUrl = resolveMediaUrl(profileImageReview?.pendingImageUrl)
  const carPhotoUrls = useMemo(
    () => documentGroups.carPhotos.map((item) => item.url).filter(Boolean),
    [documentGroups]
  )
  const reviewTarget =
    profileImageReview?.status === 'pending' && !!pendingProfilePhotoUrl
      ? 'profile_image'
      : driver?.vehicle?.status === 'pending' && hasVehicleDocuments
      ? 'vehicle'
      : 'profile'
  const incomingType = reviewTarget === 'vehicle'
    ? 'Vehicle Verification'
    : reviewTarget === 'profile_image'
      ? 'Profile Photo Verification'
      : 'Identity Verification'
  const submittedAt = reviewTarget === 'vehicle'
    ? driver?.vehicle?.submittedAt
    : reviewTarget === 'profile_image'
      ? profileImageReview?.submittedAt
      : driver?.profile?.submittedAt
  const submittedAtLabel = formatAdminDateTime(submittedAt)
  const canReview = admin?.role === 'super_admin' || can('verification.review')
  const missingIdentityCount = identityDocuments.filter((doc) => !doc.url).length
  const missingVehicleCount = vehicleDocuments.filter((doc) => !doc.url).length + (documentGroups.carPhotos.length === 0 ? 1 : 0)
  const missingDocumentCount = missingIdentityCount + missingVehicleCount
  // Allow approve when docs exist but status isn't approved (fix drivers approved before Clerk fix / re-sync)
  const canApproveProfile = canReview && !!driver?.profile && !!hasProfileDocuments && missingIdentityCount === 0 && driver.profile.status !== 'approved'
  const canApproveVehicle = canReview && !!driver?.vehicle && !!hasVehicleDocuments && missingVehicleCount === 0 && driver.vehicle.status !== 'approved'
  const canApproveProfileImage = canReview && !!pendingProfilePhotoUrl && profileImageReview?.status === 'pending'
  const canRejectProfileImage = canReview && !!pendingProfilePhotoUrl && profileImageReview?.status === 'pending'
  const canApproveCurrent = reviewTarget === 'vehicle'
    ? canApproveVehicle
    : reviewTarget === 'profile_image'
      ? canApproveProfileImage
      : canApproveProfile
  const canRejectCurrent = canReview && (
    reviewTarget === 'vehicle'
      ? driver?.vehicle?.status === 'pending' && hasVehicleDocuments
      : reviewTarget === 'profile_image'
        ? profileImageReview?.status === 'pending' && !!pendingProfilePhotoUrl
      : driver?.profile?.status === 'pending' && hasProfileDocuments
  )
  const selectedApprovedTier = vehicleTiers.find((tier) => tier.tierKey === selectedApprovedTierKey) || null
  const driverTitle = driver?.fullName || [driver?.firstName, driver?.lastName].filter(Boolean).join(' ').trim() || driver?.email || driver?.id || 'Driver'
  const avatarLabel = (driverTitle || 'D').trim().charAt(0).toUpperCase()
  const detailTabs = [
    { key: 'documentation', label: 'Documentation' },
    { key: 'car', label: 'Car' },
    { key: 'other', label: 'Other Information' },
  ]

  // Status shown in admin must match app: "Verified" only when both approved in Clerk (same source as app)
  const verificationStatusLabel = (() => {
    const p = driver?.profile?.status
    const v = driver?.vehicle?.status
    if (p === 'pending' || v === 'pending') return 'Incoming'
    if (!driver?.profile) return 'Not submitted (identity)'
    if (p === 'approved' && v === 'approved') return 'Verified'
    if (p === 'rejected' || v === 'rejected') return 'Rejected'
    if (p === 'approved' && !driver?.vehicle) return 'Identity approved (vehicle not submitted)'
    if (p === 'approved') return 'Identity approved (vehicle pending/rejected)'
    return 'Not submitted'
  })()
  const informationTabClass =
    verificationStatusLabel === 'Verified'
      ? 'bg-emerald-50'
      : 'bg-white'
  const profileImageUrl = pendingProfilePhotoUrl || approvedProfilePhotoUrl || resolveMediaUrl(driver?.profileDocs?.selfieUrl)
  const profileImageCandidates = useMemo(() => resolveMediaCandidates(profileImageUrl), [profileImageUrl])
  const activeProfileImageUrl = profileImageCandidates[headerImageUrlIndex] || profileImageUrl
  const rejectReasonOptions = reviewTarget === 'vehicle'
    ? [
        'Wrong vehicle document',
        'Vehicle details mismatch',
        'Blurry or unreadable file',
        'Expired vehicle document',
      ]
    : [
        'Wrong identity document',
        'Blurry or unreadable file',
        'Name mismatch',
        'Expired identity document',
      ]

  useEffect(() => {
    if (!driver) return

    console.log('[DriverVerificationDetailPage] document payload', {
      driverId: driver?.id,
      profileDocs: driver?.profileDocs || null,
      vehicleDocs: driver?.vehicleDocs || null,
      identityDocuments,
      vehicleDocuments,
      carPhotos: documentGroups.carPhotos,
      profileImageUrl,
    })
  }, [driver, identityDocuments, vehicleDocuments, documentGroups, profileImageUrl])

  useEffect(() => {
    setHeaderImageUrlIndex(0)
  }, [profileImageUrl])

  function itemStatusLabel(url, sectionStatus) {
    if (!url) return 'Missing'
    if (sectionStatus === 'approved') return 'Approved'
    if (sectionStatus === 'rejected') return 'Rejected'
    return 'Submitted'
  }

  function sectionStatusLabel(kind) {
    if (kind === 'identity') {
      if (!hasProfileDocuments) return 'Not started'
      if (driver?.profile?.status === 'approved') return 'Approved'
      if (driver?.profile?.status === 'rejected') return 'Rejected'
      if (missingIdentityCount > 0) return 'Partially submitted'
      return 'Pending review'
    }

    if (!hasVehicleDocuments) return 'Not started'
    if (driver?.vehicle?.status === 'approved') return 'Approved'
    if (driver?.vehicle?.status === 'rejected') return 'Rejected'
    if (missingVehicleCount > 0) return 'Partially submitted'
    return 'Pending review'
  }

  function itemStatusClass(label) {
    if (label === 'Approved') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
    if (label === 'Rejected') return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
    if (label === 'Missing') return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
    return 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'
  }

  const approveFor = async (target) => {
    if (!driver || !canReview) return
    if (target === 'profile' && !driver?.profile) return
    if (target === 'vehicle' && !driver?.vehicle) return
    if (target === 'profile' && driver.profile?.status === 'approved') return
    if (target === 'vehicle' && driver.vehicle?.status === 'approved') return

    setReviewing(true)
    setError('')
    try {
      const payload = { target, action: 'approve' }
      if (target === 'vehicle') {
        if (selectedApprovedTier?.tierKey) {
          payload.approvedTierKey = selectedApprovedTier.tierKey
          payload.approvedTierName = selectedApprovedTier.tierName
        } else if (driver?.tierAssessment?.recommendedTierKey) {
          payload.approvedTierKey = driver.tierAssessment.recommendedTierKey
          payload.approvedTierName = driver.tierAssessment.recommendedTierName
        }
      }
      await axios.patch(`${BASE_URL}/api/admin/drivers/${driverId}/review`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      })
      await loadDriver()
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to approve')
    } finally {
      setReviewing(false)
    }
  }

  const rejectFor = async (target) => {
    if (!driver || !canReview) return
    const rejectionReason = (customRejectReason.trim() || rejectReasonPreset.trim()).trim()
    if (!rejectionReason) {
      setError('Choose a quick reject reason or enter a custom note before rejecting.')
      return
    }
    const allowResubmit = true
    const canReject = target === 'vehicle'
      ? driver?.vehicle?.status === 'pending'
      : target === 'profile_image'
        ? profileImageReview?.status === 'pending' && !!pendingProfilePhotoUrl
        : driver?.profile?.status === 'pending'
    if (!canReject) return

    setReviewing(true)
    setError('')
    try {
      await axios.patch(
        `${BASE_URL}/api/admin/drivers/${driverId}/review`,
        { target, action: 'reject', rejectionReason: rejectionReason.trim(), allowResubmit },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setRejectReasonPreset('')
      setCustomRejectReason('')
      await loadDriver()
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to reject')
    } finally {
      setReviewing(false)
    }
  }

  const handleApprove = () => approveFor(reviewTarget)
  const handleReject = () => rejectFor(reviewTarget)
  const handleApproveProfileImage = () => approveFor('profile_image')
  const handleRejectProfileImage = () => rejectFor('profile_image')

  useEffect(() => {
    setCarPhotoIndex(0)
  }, [carPhotoUrls.length])

  useEffect(() => {
    const defaultTierKey =
      driver?.vehicle?.vehicleTierKey ||
      driver?.tierAssessment?.recommendedTierKey ||
      ''

    setSelectedApprovedTierKey((current) => {
      if (current && vehicleTiers.some((tier) => tier.tierKey === current)) {
        return current
      }
      return defaultTierKey
    })
  }, [driver?.vehicle?.vehicleTierKey, driver?.tierAssessment?.recommendedTierKey, vehicleTiers])

  if (loading) {
    return <section className="rounded-sm border border-slate-300 bg-white p-6 text-sm text-slate-600">Loading verification record...</section>
  }

  if (!driver) {
    return (
      <section className="rounded-sm border border-slate-300 bg-white p-6">
        <p className="text-sm text-slate-700">{error || 'Driver record not found.'}</p>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <header className={`border border-slate-300 ${informationTabClass}`}>
        <div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Driver Verification / Review</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">{driverTitle}</h1>
            <p className="mt-1 text-sm text-slate-600">{incomingType}</p>
            <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Reviewing: {reviewTarget === 'vehicle' ? 'Vehicle submission' : 'Identity documents'}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-full bg-white/80 px-2 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
                Identity: {sectionStatusLabel('identity')}
              </span>
              <span className="inline-flex rounded-full bg-white/80 px-2 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
                Vehicle: {sectionStatusLabel('vehicle')}
              </span>
              <span className="inline-flex rounded-full bg-white/80 px-2 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
                Missing docs: {missingDocumentCount}
              </span>
            </div>

            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
              <Field label="Phone" value={driver.phoneNumber || '-'} />
              <Field label="Email" value={driver.email || '-'} />
              <Field label="Submitted At" value={submittedAtLabel} />
              <Field label="Current Status" value={verificationStatusLabel} />
              <Field
                label="Referred By Agent"
                value={
                  driver?.referral?.agent?.fullName
                    ? `${driver.referral.agent.fullName}${driver.referral.agent.employeeCode ? ` (${driver.referral.agent.employeeCode})` : ''}`
                    : 'Direct signup'
                }
              />
            </div>
          </div>

          <div className="flex w-full flex-col items-end gap-3 md:w-auto">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleApprove}
                disabled={!canApproveCurrent || reviewing}
                className={`rounded-sm px-3 py-2 text-xs font-semibold text-white ${!canApproveCurrent || reviewing ? 'cursor-not-allowed bg-emerald-300' : 'bg-emerald-600 hover:bg-emerald-500'}`}
              >
                {reviewing ? 'Working...' : canRejectCurrent ? `Approve ${reviewTarget === 'vehicle' ? 'Vehicle' : 'Docs'}` : `Mark ${reviewTarget === 'vehicle' ? 'vehicle' : 'identity'} as approved`}
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={!canRejectCurrent || reviewing}
                className={`rounded-sm px-3 py-2 text-xs font-semibold text-white ${!canRejectCurrent || reviewing ? 'cursor-not-allowed bg-rose-300' : 'bg-rose-600 hover:bg-rose-500'}`}
              >
                Reject {reviewTarget === 'vehicle' ? 'Vehicle' : 'Docs'}
              </button>
            </div>

            <div className="h-28 w-28 shrink-0 overflow-hidden rounded-sm bg-slate-900">
              {profileImageUrl ? (
                <img
                  src={activeProfileImageUrl}
                  alt={driverTitle}
                  className="h-full w-full object-cover"
                  onError={() => {
                    setHeaderImageUrlIndex((current) => {
                      if (current >= profileImageCandidates.length - 1) return current
                      return current + 1
                    })
                  }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-white">
                  {avatarLabel}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-5 px-4 py-2">
          {detailTabs.map((tab) => {
            const active = activeSection === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveSection(tab.key)}
                className={`border-b-2 px-1 pb-2 text-xs font-semibold uppercase tracking-wide transition ${
                  active
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </header>

      {error ? <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}

      {activeSection === 'documentation' ? (
      <section className="border border-slate-300 bg-white">
        <div className="border-b border-slate-300 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Verification Documents</h2>
        </div>
        <div className="p-4">
          <div className="space-y-6">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">Identity Documents</h3>
                <span className="text-xs text-slate-500">{identityDocuments.filter((doc) => !!doc.url).length} of {identityDocuments.length} submitted</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {identityDocuments.map((doc) => {
                  const statusLabel = itemStatusLabel(doc.url, driver?.profile?.status)
                  return (
                    <article key={doc.key} className="overflow-hidden rounded-sm border border-slate-200 bg-slate-50">
                      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                        <p className="text-xs font-semibold text-slate-700">{doc.label}</p>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${itemStatusClass(statusLabel)}`}>
                          {statusLabel}
                        </span>
                      </div>
                      <DocumentPreview url={doc.url} label={doc.label} />
                    </article>
                  )
                })}
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">Car Photos</h3>
                <span className="text-xs text-slate-500">{documentGroups.carPhotos.length} uploaded</span>
              </div>
          {carPhotoUrls.length > 0 ? (
            <div className="mb-4 overflow-hidden rounded border border-slate-200 bg-slate-50">
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                <div>
                  <p className="text-xs font-semibold text-slate-700">Car Photos</p>
                  <p className="text-[11px] text-slate-500">
                    {carPhotoIndex + 1} / {carPhotoUrls.length}
                  </p>
                </div>
                {carPhotoUrls.length > 1 ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCarPhotoIndex((value) => (value === 0 ? carPhotoUrls.length - 1 : value - 1))}
                      className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setCarPhotoIndex((value) => (value === carPhotoUrls.length - 1 ? 0 : value + 1))}
                      className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Next
                    </button>
                  </div>
                ) : null}
              </div>

              <a href={carPhotoUrls[carPhotoIndex]} target="_blank" rel="noreferrer" className="block bg-slate-100">
                <img
                  src={carPhotoUrls[carPhotoIndex]}
                  alt={`Car photo ${carPhotoIndex + 1}`}
                  className="h-72 w-full object-contain bg-slate-100"
                />
              </a>

              <div className="border-t border-slate-200 px-3 py-2">
                <a
                  href={carPhotoUrls[carPhotoIndex]}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-[11px] font-semibold text-indigo-700 hover:text-indigo-500"
                >
                  Open full image
                </a>
              </div>
            </div>
          ) : (
            <div className="rounded-sm border border-dashed border-slate-300 px-3 py-6 text-sm text-slate-500">
              No car photos uploaded yet.
            </div>
          )}
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">Vehicle Documents</h3>
                <span className="text-xs text-slate-500">{vehicleDocuments.filter((doc) => !!doc.url).length} of {vehicleDocuments.length} submitted</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {vehicleDocuments.map((doc) => {
                  const statusLabel = itemStatusLabel(doc.url, driver?.vehicle?.status)
                  return (
                    <article key={doc.key} className="overflow-hidden rounded-sm border border-slate-200 bg-slate-50">
                      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                        <p className="text-xs font-semibold text-slate-700">{doc.label}</p>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${itemStatusClass(statusLabel)}`}>
                          {statusLabel}
                        </span>
                      </div>
                      <DocumentPreview url={doc.url} label={doc.label} />
                    </article>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </section>
      ) : null}

      {activeSection === 'car' ? (
      <div className="space-y-4">
        <section className="border border-slate-300 bg-white">
          <div className="border-b border-slate-300 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-800">Vehicle Details</h2>
          </div>
          <div className="grid gap-2 p-4 md:grid-cols-2">
            <Field label="Plate Number" value={driver.vehicle?.numberPlate} />
            <Field label="Make" value={driver.vehicle?.make} />
            <Field label="Model" value={driver.vehicle?.model} />
            <Field label="Year" value={driver.vehicleDocs?.year} />
            <Field label="Color" value={driver.vehicleDocs?.color} />
            <Field label="Selected Tier" value={driver.vehicle?.vehicleTierName || driver.vehicle?.vehicleTierKey} />
            <Field label="Passenger Seats" value={driver.vehicleSpecs?.seatCount} />
            <Field label="Doors" value={driver.vehicleSpecs?.doorCount} />
            <Field label="Category" value={driver.vehicleSpecs?.vehicleCategory} />
            <Field label="Air Conditioning" value={driver.vehicleSpecs?.hasAirConditioning ? 'Yes' : 'No'} />
            <Field label="Charging Ports" value={driver.vehicleSpecs?.hasChargingPorts ? 'Yes' : 'No'} />
            <Field label="Large Luggage Space" value={driver.vehicleSpecs?.hasLargeLuggageSpace ? 'Yes' : 'No'} />
          </div>
        </section>

        <section className="border border-slate-300 bg-white p-4">
          <div className="flex flex-col gap-2 border-b border-slate-200 pb-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Car Photos</h2>
              <p className="mt-1 text-xs text-slate-500">Submitted vehicle pictures from the driver.</p>
            </div>
            <span className="text-xs text-slate-500">{carPhotoUrls.length} uploaded</span>
          </div>

          {carPhotoUrls.length > 0 ? (
            <div className="mt-4 overflow-hidden rounded border border-slate-200 bg-slate-50">
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                <div>
                  <p className="text-xs font-semibold text-slate-700">Car Photos</p>
                  <p className="text-[11px] text-slate-500">
                    {carPhotoIndex + 1} / {carPhotoUrls.length}
                  </p>
                </div>
                {carPhotoUrls.length > 1 ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCarPhotoIndex((value) => (value === 0 ? carPhotoUrls.length - 1 : value - 1))}
                      className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setCarPhotoIndex((value) => (value === carPhotoUrls.length - 1 ? 0 : value + 1))}
                      className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Next
                    </button>
                  </div>
                ) : null}
              </div>

              <a href={carPhotoUrls[carPhotoIndex]} target="_blank" rel="noreferrer" className="block bg-slate-100">
                <img
                  src={carPhotoUrls[carPhotoIndex]}
                  alt={`Car photo ${carPhotoIndex + 1}`}
                  className="h-72 w-full object-contain bg-slate-100"
                />
              </a>

              <div className="border-t border-slate-200 px-3 py-2">
                <a
                  href={carPhotoUrls[carPhotoIndex]}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-[11px] font-semibold text-indigo-700 hover:text-indigo-500"
                >
                  Open full image
                </a>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-sm border border-dashed border-slate-300 px-3 py-6 text-sm text-slate-500">
              No car photos uploaded yet.
            </div>
          )}
        </section>

        <section className="border border-slate-300 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-800">Vehicle Tier</h2>
          <p className="mt-2 text-sm text-slate-700">
            Review or override the assigned vehicle tier from here.
          </p>
          <div className="mt-3 border border-slate-200 bg-slate-50 p-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Approved Tier</span>
              <select
                value={selectedApprovedTierKey}
                onChange={(event) => setSelectedApprovedTierKey(event.target.value)}
                className="h-10 w-full border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="">Use recommended tier</option>
                {vehicleTiers.map((tier) => (
                  <option key={tier.tierKey} value={tier.tierKey}>
                    {tier.tierName}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-2 text-xs text-slate-600">
              {selectedApprovedTier
                ? `Vehicle will be approved as ${selectedApprovedTier.tierName}.`
                : `Vehicle will use the recommended tier: ${driver?.tierAssessment?.recommendedTierName || 'No automatic match'}.`}
            </p>
          </div>
        </section>
      </div>
      ) : null}

      {activeSection === 'car' && driver.tierAssessment ? (
        <section className="border border-slate-300 bg-white p-4">
          <div className="flex flex-col gap-2 border-b border-slate-200 pb-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Automatic Tier Assessment</h2>
              <p className="mt-1 text-xs text-slate-500">Live assessment from the API using the submitted vehicle data.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-200">
                Selected: {driver.tierAssessment.selectedTierName || 'None'}
              </span>
              <span className="rounded-full bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200">
                Recommended: {driver.tierAssessment.recommendedTierName || 'No match'}
              </span>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {driver.tierAssessment.evaluations?.map((evaluation) => (
              <article key={evaluation.tierKey} className="rounded border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{evaluation.tierName}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Required checks: {evaluation.metRequired}/{evaluation.totalRequired}
                      {evaluation.totalPreferred ? ` - Preferred checks: ${evaluation.metPreferred}/${evaluation.totalPreferred}` : ''}
                    </p>
                  </div>
                  <AssessmentBadge passed={evaluation.eligible}>
                    {evaluation.eligible ? 'Eligible' : 'Not eligible'}
                  </AssessmentBadge>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {evaluation.checks.map((check, index) => (
                    <div key={`${evaluation.tierKey}-${index}`} className="rounded border border-slate-200 bg-white px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold text-slate-800">{check.label}</p>
                        <AssessmentBadge passed={check.passed}>{check.passed ? 'Pass' : 'Fail'}</AssessmentBadge>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">Expected: {check.expected}</p>
                      <p className="mt-0.5 text-[11px] text-slate-600">Actual: {String(check.actual ?? '-')}</p>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {activeSection === 'other' ? (
        <>
          <section className="border border-slate-300 bg-white p-4">
            <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Driver Profile Photo Review</h2>
                <p className="mt-2 text-sm text-slate-700">
                  Profile photo changes stay pending until an admin approves them.
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Status: {profileImageReview?.status || 'No profile photo review yet'}
                </p>
                {profileImageReview?.submittedAt ? (
                  <p className="mt-1 text-xs text-slate-500">Submitted: {formatAdminDateTime(profileImageReview.submittedAt)}</p>
                ) : null}
                {profileImageReview?.rejectionReason ? (
                  <p className="mt-2 text-xs text-rose-600">Rejection reason: {profileImageReview.rejectionReason}</p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleApproveProfileImage}
                  disabled={!canApproveProfileImage || reviewing}
                  className={`rounded-sm px-3 py-2 text-xs font-semibold text-white ${!canApproveProfileImage || reviewing ? 'cursor-not-allowed bg-emerald-300' : 'bg-emerald-600 hover:bg-emerald-500'}`}
                >
                  Approve photo
                </button>
                <button
                  type="button"
                  onClick={handleRejectProfileImage}
                  disabled={!canRejectProfileImage || reviewing}
                  className={`rounded-sm px-3 py-2 text-xs font-semibold text-white ${!canRejectProfileImage || reviewing ? 'cursor-not-allowed bg-rose-300' : 'bg-rose-600 hover:bg-rose-500'}`}
                >
                  Reject photo
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <article className="overflow-hidden rounded-sm border border-slate-200 bg-slate-50">
                <div className="border-b border-slate-200 px-3 py-2">
                  <p className="text-xs font-semibold text-slate-700">Current approved photo</p>
                </div>
                <DocumentPreview url={approvedProfilePhotoUrl} label="Approved driver profile photo" />
              </article>
              <article className="overflow-hidden rounded-sm border border-slate-200 bg-slate-50">
                <div className="border-b border-slate-200 px-3 py-2">
                  <p className="text-xs font-semibold text-slate-700">Pending replacement photo</p>
                </div>
                <DocumentPreview url={pendingProfilePhotoUrl} label="Pending driver profile photo" />
              </article>
            </div>
          </section>

          <section className="border border-slate-300 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Verification Controls</h2>
            <p className="mb-3 text-xs text-slate-500">Use these controls to finalize review decisions and keep the driver app in sync with the backend verification state.</p>
            <div className="flex flex-wrap gap-4">
              <div className="border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-medium text-slate-600">Identity</p>
                <p className="text-xs text-slate-700">
                  {sectionStatusLabel('identity')}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={!canApproveProfile || reviewing}
                    onClick={() => approveFor('profile')}
                    className="bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white disabled:bg-emerald-300"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={driver?.profile?.status !== 'pending' || !hasProfileDocuments || reviewing}
                    onClick={() => rejectFor('profile')}
                    className="bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white disabled:bg-rose-300"
                  >
                    Reject
                  </button>
                </div>
              </div>
              <div className="border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-medium text-slate-600">Vehicle</p>
                <p className="text-xs text-slate-700">
                  {sectionStatusLabel('vehicle')}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={!canApproveVehicle || reviewing}
                    onClick={() => approveFor('vehicle')}
                    className="bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white disabled:bg-emerald-300"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={driver?.vehicle?.status !== 'pending' || !hasVehicleDocuments || reviewing}
                    onClick={() => rejectFor('vehicle')}
                    className="bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white disabled:bg-rose-300"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="border border-slate-300 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">Quick Reject Reasons</h2>
            <p className="mt-2 text-sm text-slate-700">
              Select a quick reason for this <span className="font-semibold">{reviewTarget === 'vehicle' ? 'vehicle verification' : 'identity document verification'}</span> review, or add a custom note.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {rejectReasonOptions.map((option) => {
                const active = rejectReasonPreset === option
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setRejectReasonPreset(option)}
                    className={`rounded-sm border px-3 py-2 text-xs font-medium transition ${
                      active
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                    }`}
                  >
                    {option}
                  </button>
                )
              })}
            </div>
            <label className="mt-4 block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Custom Note</span>
              <textarea
                value={customRejectReason}
                onChange={(event) => setCustomRejectReason(event.target.value)}
                rows={3}
                placeholder="Add extra rejection detail here..."
                className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </label>
          </section>

          <section className="border border-slate-300 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">Review Actions</h2>
            <p className="mt-2 text-sm text-slate-700">
              This review is for: <span className="font-semibold">{reviewTarget === 'vehicle' ? 'vehicle verification' : 'identity document verification'}</span>.
            </p>
            {reviewTarget === 'vehicle' ? null : null}
          </section>
        </>
      ) : null}

    </section>
  )
}
