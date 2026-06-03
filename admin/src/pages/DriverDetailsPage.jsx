import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'
import { resolveMediaUrl } from '../utils/media'

function Field({ label, value }) {
  return (
    <div className="border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-800">{value || '-'}</p>
    </div>
  )
}

function HeaderField({ label, value }) {
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

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getDriverDisplayName(driver) {
  const fullName = driver?.fullName || [driver?.firstName, driver?.lastName].filter(Boolean).join(' ').trim()
  return fullName || driver?.email || driver?.id || 'Driver'
}

function getInitials(driver) {
  const name = getDriverDisplayName(driver)
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('') || 'D'
  )
}

function docItems(driver) {
  const profileDocs = driver?.profileDocs || {}
  const vehicleDocs = driver?.vehicleDocs || {}
  const carPhotoUrls = Array.isArray(vehicleDocs.carPhotoUrls) ? vehicleDocs.carPhotoUrls.filter(Boolean) : []

  const carPhotos = carPhotoUrls.map((url, index) => ({
    label: `Car Photo ${index + 1}`,
    url: resolveMediaUrl(url),
    type: 'vehicle',
  }))

  return [
    { label: 'National ID Front', url: resolveMediaUrl(profileDocs.nationalIdFrontUrl), type: 'identity' },
    { label: 'National ID Back', url: resolveMediaUrl(profileDocs.nationalIdBackUrl), type: 'identity' },
    { label: 'Driver License', url: resolveMediaUrl(profileDocs.driverLicenceUrl), type: 'identity' },
    { label: 'Selfie', url: resolveMediaUrl(profileDocs.selfieUrl), type: 'identity' },
    { label: 'Selfie with ID', url: resolveMediaUrl(profileDocs.selfieWithIdCardUrl), type: 'identity' },
    ...carPhotos,
    { label: 'Vehicle Registration', url: resolveMediaUrl(vehicleDocs.vehicleRegistrationUrl), type: 'vehicle' },
    { label: 'Vehicle Registration Book', url: resolveMediaUrl(vehicleDocs.vehicleRegistrationBookUrl), type: 'vehicle' },
    { label: 'Insurance', url: resolveMediaUrl(vehicleDocs.insuranceUrl), type: 'vehicle' },
    { label: 'Zinara', url: resolveMediaUrl(vehicleDocs.zinaraUrl), type: 'vehicle' },
  ].filter((item) => !!item.url)
}

function StarRating({ value }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <svg key={star} viewBox="0 0 20 20" width="14" height="14" fill={star <= Number(value || 0) ? '#f59e0b' : '#cbd5e1'} aria-hidden="true">
          <path d="m10 1.7 2.5 5.1 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8L10 1.7Z" />
        </svg>
      ))}
    </div>
  )
}

export default function DriverDetailsPage() {
  const navigate = useNavigate()
  const { token } = useAuth()
  const { driverId } = useParams()
  const location = useLocation()
  const [activeTab, setActiveTab] = useState('profile')
  const [loading, setLoading] = useState(false)
  const [warning, setWarning] = useState('')
  const [driver, setDriver] = useState(location.state?.driver || null)
  const [carPhotoIndex, setCarPhotoIndex] = useState(0)

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      setWarning('')
      try {
        const { data } = await axios.get(`${BASE_URL}/api/admin/drivers/${driverId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
        setDriver(data.driver || null)
      } catch (err) {
        const apiError = err?.response?.data?.error
        setWarning(apiError || err?.message || 'Unable to refresh latest details')
      } finally {
        setLoading(false)
      }
    }

    run()
  }, [driverId, token])

  const documents = useMemo(() => docItems(driver), [driver])
  const carPhotoUrls = useMemo(() => {
    const vehicleDocs = driver?.vehicleDocs || {}
    return Array.isArray(vehicleDocs.carPhotoUrls) ? vehicleDocs.carPhotoUrls.map((url) => resolveMediaUrl(url)).filter(Boolean) : []
  }, [driver])
  const trips = useMemo(() => (Array.isArray(driver?.trips) ? driver.trips : []), [driver])
  const reviews = useMemo(() => (Array.isArray(driver?.reviews) ? driver.reviews : []), [driver])
  const averageRating = useMemo(() => {
    const rated = reviews.filter((review) => review.rating !== null)
    if (!rated.length) return null
    return rated.reduce((sum, review) => sum + Number(review.rating || 0), 0) / rated.length
  }, [reviews])

  useEffect(() => {
    setCarPhotoIndex(0)
  }, [carPhotoUrls.length])

  if (loading) {
    return <section className="border border-slate-300 bg-white p-6 text-sm text-slate-600">Loading driver details...</section>
  }

  if (!driver) {
    return <section className="border border-slate-300 bg-white p-6 text-sm text-slate-600">Driver not found.</section>
  }

  const sectionTabs = [
    { key: 'profile', label: 'Profile' },
    { key: 'vehicle', label: 'Vehicle' },
    { key: 'documents', label: 'Documents' },
    { key: 'trips', label: 'Trips' },
    { key: 'reviews', label: 'Reviews' },
    { key: 'verification', label: 'Verification' },
  ]

  return (
    <section className="space-y-4">
      <header className="border border-slate-300 bg-white">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => navigate('/dashboard/drivers')}
              className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 hover:text-slate-800"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
                <path d="M15 6 9 12l6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back To Drivers
            </button>
            <h1 className="mt-2 text-xl font-semibold text-slate-900">{getDriverDisplayName(driver)}</h1>
            <p className="text-xs text-slate-500">{driver.email || '-'}</p>

            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
              <HeaderField label="Phone" value={driver.phoneNumber || '-'} />
              <HeaderField label="Joined" value={formatDateTime(driver.createdAt)} />
              <HeaderField label="Completed Trips" value={trips.filter((trip) => trip.status === 'completed').length} />
              <HeaderField label="Average Rating" value={averageRating ? `${averageRating.toFixed(1)} / 5` : 'No ratings yet'} />
            </div>
          </div>

          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-sm border border-slate-200 bg-slate-50">
            {driver?.profileDocs?.selfieUrl ? (
              <img
                src={resolveMediaUrl(driver.profileDocs.selfieUrl)}
                alt={getDriverDisplayName(driver)}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-slate-900 text-lg font-semibold text-white">
                {getInitials(driver)}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-5 px-4 py-2">
          {sectionTabs.map((tab) => {
            const active = activeTab === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
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

      {warning ? (
        <p className="border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{warning}</p>
      ) : null}

      {activeTab === 'profile' ? (
        <section className="grid gap-3 border border-slate-300 bg-white p-4 md:grid-cols-2">
          <Field label="Driver ID" value={driver.id} />
          <Field label="First Name" value={driver.firstName || '-'} />
          <Field label="Last Name" value={driver.lastName || '-'} />
          <Field label="Email" value={driver.email} />
          <Field label="Phone" value={driver.phoneNumber} />
          <Field label="Phone Verified" value={driver.phoneVerified ? 'Yes' : 'No'} />
          <Field label="EcoCash Number" value={driver.profile?.ecocashNumber || '-'} />
          <Field label="EcoCash Registered Name" value={driver.profile?.ecocashRegisteredName || '-'} />
          <Field label="Joined" value={formatDateTime(driver.createdAt)} />
          <Field
            label="Referred By Agent"
            value={
              driver?.referral?.agent?.fullName
                ? `${driver.referral.agent.fullName}${driver.referral.agent.employeeCode ? ` (${driver.referral.agent.employeeCode})` : ''}`
                : 'Direct signup'
            }
          />
          <Field label="Referral Source" value={driver?.referral?.source || '-'} />
        </section>
      ) : null}

      {activeTab === 'vehicle' ? (
        <div className="space-y-4">
          {carPhotoUrls.length > 0 ? (
            <section className="overflow-hidden border border-slate-300 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">Car Photos</h2>
                  <p className="text-[11px] text-slate-500">
                    {carPhotoIndex + 1} / {carPhotoUrls.length}
                  </p>
                </div>
                {carPhotoUrls.length > 1 ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCarPhotoIndex((value) => (value === 0 ? carPhotoUrls.length - 1 : value - 1))}
                      className="border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setCarPhotoIndex((value) => (value === carPhotoUrls.length - 1 ? 0 : value + 1))}
                      className="border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
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
                  className="h-80 w-full object-contain bg-slate-100"
                />
              </a>
            </section>
          ) : null}

          <section className="grid gap-3 border border-slate-300 bg-white p-4 md:grid-cols-2">
            <Field label="Vehicle Status" value={driver.vehicle?.status || 'Not submitted'} />
            <Field label="Vehicle Submitted" value={formatDateTime(driver.vehicle?.submittedAt)} />
            <Field label="Make" value={driver.vehicle?.make || '-'} />
            <Field label="Model" value={driver.vehicle?.model || '-'} />
            <Field label="Plate" value={driver.vehicle?.numberPlate || '-'} />
            <Field label="Selected Tier" value={driver.vehicle?.vehicleTierName || driver.vehicle?.vehicleTierKey || '-'} />
            <Field label="Year" value={driver.vehicleDocs?.year || '-'} />
            <Field label="Color" value={driver.vehicleDocs?.color || '-'} />
            <Field label="Passenger Seats" value={driver.vehicleSpecs?.seatCount ?? '-'} />
            <Field label="Doors" value={driver.vehicleSpecs?.doorCount ?? '-'} />
            <Field label="Category" value={driver.vehicleSpecs?.vehicleCategory || '-'} />
            <Field label="Rejection Reason" value={driver.vehicle?.rejectionReason || '-'} />
          </section>

          {driver.vehicleSpecs ? (
            <section className="border border-slate-300 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-800">Vehicle Features</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label="Air Conditioning" value={driver.vehicleSpecs.hasAirConditioning ? 'Yes' : 'No'} />
                <Field label="Charging Ports" value={driver.vehicleSpecs.hasChargingPorts ? 'Yes' : 'No'} />
                <Field label="Wi-Fi" value={driver.vehicleSpecs.hasWifi ? 'Yes' : 'No'} />
                <Field label="Leather Seats" value={driver.vehicleSpecs.hasLeatherSeats ? 'Yes' : 'No'} />
                <Field label="Large Luggage Space" value={driver.vehicleSpecs.hasLargeLuggageSpace ? 'Yes' : 'No'} />
                <Field label="Sliding Doors" value={driver.vehicleSpecs.hasSlidingDoors ? 'Yes' : 'No'} />
                <Field label="High-End Vehicle" value={driver.vehicleSpecs.isHighEnd ? 'Yes' : 'No'} />
              </div>
            </section>
          ) : null}

          {driver.tierAssessment ? (
            <section className="border border-slate-300 bg-white p-4">
              <div className="flex flex-col gap-2 border-b border-slate-200 pb-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">Automatic Tier Assessment</h2>
                  <p className="mt-1 text-xs text-slate-500">Based on the structured vehicle details submitted by the driver.</p>
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
                  <article key={evaluation.tierKey} className="border border-slate-200 bg-slate-50 p-3">
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
                        <div key={`${evaluation.tierKey}-${index}`} className="border border-slate-200 bg-white px-3 py-2">
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
        </div>
      ) : null}

      {activeTab === 'documents' ? (
        <section className="overflow-hidden border border-slate-300 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-800">Documents</h2>
          </div>
          <div className="p-4">
            <div className="grid gap-3 md:grid-cols-2">
              {documents.length === 0 ? (
                <p className="text-sm text-slate-500">No documents submitted.</p>
              ) : (
                documents.map((doc) => (
                  <article key={`${doc.label}-${doc.url}`} className="overflow-hidden border border-slate-200 bg-slate-50">
                    <a href={doc.url} target="_blank" rel="noreferrer" className="block bg-slate-100">
                      <img src={doc.url} alt={doc.label} className="h-64 w-full object-contain bg-slate-100" />
                    </a>
                    <div className="border-t border-slate-200 px-3 py-2">
                      <p className="text-xs font-semibold text-slate-700">{doc.label}</p>
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-[11px] font-semibold text-indigo-700 hover:text-indigo-500"
                      >
                        Open full image
                      </a>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === 'trips' ? (
        <section className="overflow-hidden border border-slate-300 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-800">Trips</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-xs">
              <thead>
                <tr className="bg-[#0f172a] text-left text-[11px] uppercase tracking-wide text-slate-200">
                  <th className="rounded-tl-sm px-4 py-3 font-semibold">Passenger</th>
                  <th className="px-4 py-3 font-semibold">Route</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Fare</th>
                  <th className="px-4 py-3 font-semibold">Completed</th>
                  <th className="rounded-tr-sm px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {trips.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">No trips yet.</td>
                  </tr>
                ) : (
                  trips.map((trip) => (
                    <tr key={trip.id} className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-800">{trip.passengerName || trip.passengerUserId || '-'}</td>
                      <td className="px-4 py-3 text-slate-700">{trip.pickupLabel} to {trip.dropoffLabel}</td>
                      <td className="px-4 py-3 text-slate-700">{trip.status}</td>
                      <td className="px-4 py-3 text-slate-700">{trip.estimatedAmount !== null ? `$${Number(trip.estimatedAmount).toFixed(2)}` : '-'}</td>
                      <td className="px-4 py-3 text-slate-700">{formatDateTime(trip.completedAt || trip.cancelledAt || trip.requestedAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            navigate(`/dashboard/ride-operations/${trip.publicId || trip.id}`, {
                              state: {
                                fromDriverId: driver.id,
                                fromDriverName: getDriverDisplayName(driver),
                              },
                            })
                          }
                          className="text-slate-700 transition hover:text-indigo-600"
                          title="View trip"
                        >
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                            <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" stroke="currentColor" strokeWidth="1.8" />
                            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === 'reviews' ? (
        <section className="border border-slate-300 bg-white p-4">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Passenger Reviews</h2>
              <p className="mt-1 text-xs text-slate-500">Ratings and comments left after completed trips.</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Average</p>
              <p className="text-lg font-semibold text-slate-900">{averageRating ? averageRating.toFixed(1) : '-'}</p>
            </div>
          </div>

          {reviews.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No reviews yet.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {reviews.map((review) => (
                <article key={`${review.rideId}-${review.completedAt || review.review}`} className="border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{review.pickupLabel} to {review.dropoffLabel}</p>
                      <p className="mt-1 text-[11px] text-slate-500">{formatDateTime(review.completedAt)}</p>
                    </div>
                    {review.rating !== null ? <StarRating value={review.rating} /> : null}
                  </div>
                  <p className="mt-3 text-sm text-slate-700">{review.review || 'No written review.'}</p>
                  <button
                    type="button"
                    onClick={() =>
                      navigate(`/dashboard/ride-operations/${review.ridePublicId || review.rideId}`, {
                        state: {
                          fromDriverId: driver.id,
                          fromDriverName: getDriverDisplayName(driver),
                        },
                      })
                    }
                    className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-indigo-700 hover:text-indigo-500"
                  >
                    View Trip
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
                      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'verification' ? (
        <section className="grid gap-3 border border-slate-300 bg-white p-4 md:grid-cols-2">
          <Field label="Profile Status" value={driver.profile?.status || 'Not submitted'} />
          <Field label="Profile Submitted" value={formatDateTime(driver.profile?.submittedAt)} />
          <Field label="Profile Rejection" value={driver.profile?.rejectionReason || '-'} />
          <Field label="Vehicle Status" value={driver.vehicle?.status || 'Not submitted'} />
          <Field label="Vehicle Submitted" value={formatDateTime(driver.vehicle?.submittedAt)} />
          <Field label="Vehicle Rejection" value={driver.vehicle?.rejectionReason || '-'} />
        </section>
      ) : null}
    </section>
  )
}
