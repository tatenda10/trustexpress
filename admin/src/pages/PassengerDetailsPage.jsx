import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'
import { resolveMediaUrl } from '../utils/media'

const tabs = [
  { key: 'profile', label: 'Profile' },
  { key: 'activity', label: 'Activity' },
  { key: 'safety', label: 'Safety' },
  { key: 'payment', label: 'Payment' },
  { key: 'timeline', label: 'Timeline' },
]

function Field({ label, value }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-800">{value || '-'}</p>
    </div>
  )
}

export default function PassengerDetailsPage() {
  const { token, can, admin } = useAuth()
  const { passengerId } = useParams()
  const location = useLocation()
  const [activeTab, setActiveTab] = useState('profile')
  const [loading, setLoading] = useState(false)
  const [warning, setWarning] = useState('')
  const [passenger, setPassenger] = useState(location.state?.passenger || null)
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      setWarning('')
      try {
        const { data } = await axios.get(`${BASE_URL}/api/admin/passengers/${passengerId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
        setPassenger(data.passenger || null)
      } catch (err) {
        const apiError = err?.response?.data?.error
        setWarning(apiError || err?.message || 'Unable to refresh latest details')
      } finally {
        setLoading(false)
      }
    }

    run()
  }, [passengerId, token])

  if (loading) {
    return <section className="rounded-sm border border-slate-300 bg-white p-6 text-sm text-slate-600">Loading passenger details...</section>
  }

  if (!passenger) {
    return <section className="rounded-sm border border-slate-300 bg-white p-6 text-sm text-slate-600">Passenger not found.</section>
  }

  const timelineEvents = [
    {
      title: 'Passenger account created',
      when: passenger.createdAt,
      details: `ID: ${passenger.id}`,
    },
    passenger.phoneVerifiedAt
      ? {
          title: 'Phone verified',
          when: passenger.phoneVerifiedAt,
          details: passenger.phoneNumber || '',
        }
      : null,
    passenger.lastRideAt
      ? {
          title: 'Last ride completed',
          when: passenger.lastRideAt,
          details: `Total rides: ${passenger.totalRides || 0}`,
        }
      : null,
  ]
    .filter(Boolean)
    .map((event) => ({ ...event, time: Number(new Date(event.when).getTime()) || 0 }))
    .sort((a, b) => b.time - a.time)

  const identity = passenger.passengerIdentity || null
  const identityDocs = [
    { label: 'National ID Front', url: resolveMediaUrl(identity?.nationalIdFrontUrl) },
    { label: 'National ID Back', url: resolveMediaUrl(identity?.nationalIdBackUrl) },
  ].filter((item) => !!item.url)
  const canReviewIdentity = admin?.role === 'super_admin' || can('verification.review')

  const handleReview = async (action) => {
    if (!canReviewIdentity || !passenger) return
    let rejectionReason = ''
    let allowResubmit = true

    if (action === 'reject') {
      rejectionReason = window.prompt('Enter rejection reason for passenger identity verification (required):') || ''
      if (!rejectionReason.trim()) return
      const blockResubmit = window.confirm(
        'Block this passenger from resubmitting?\n\nOK = Block resubmission\nCancel = Allow resubmission'
      )
      allowResubmit = !blockResubmit
    }

    setReviewing(true)
    setWarning('')
    try {
      const { data } = await axios.patch(
        `${BASE_URL}/api/admin/passengers/${passengerId}/review`,
        {
          action,
          rejectionReason: rejectionReason.trim(),
          allowResubmit,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      )
      setPassenger(data.passenger || null)
    } catch (err) {
      const apiError = err?.response?.data?.error
      setWarning(apiError || err?.message || `Unable to ${action} passenger identity verification`)
    } finally {
      setReviewing(false)
    }
  }

  return (
    <section className="space-y-4">
      <header className="rounded-sm border border-slate-300 bg-white px-4 py-3">
        <p className="text-xs text-slate-500">Passengers / {passenger.id}</p>
        <h1 className="text-lg font-semibold text-slate-900">{passenger.email || passenger.id}</h1>
        <p className="text-xs text-slate-600">Phone: {passenger.phoneNumber || '-'}</p>
      </header>

      {warning ? <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{warning}</p> : null}

      <div className="flex flex-wrap gap-2 rounded-sm border border-slate-300 bg-white px-4 py-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === tab.key ? 'bg-[#6f54ff] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'profile' ? (
        <section className="grid gap-3 rounded-sm border border-slate-300 bg-white p-4 md:grid-cols-2">
          <Field label="Passenger ID" value={passenger.id} />
          <Field label="Email" value={passenger.email} />
          <Field label="Phone" value={passenger.phoneNumber} />
          <Field label="Phone Verified" value={passenger.phoneVerified ? 'Yes' : 'No'} />
          <Field label="Status" value={passenger.status} />
          <Field label="Joined" value={String(passenger.createdAt || '').slice(0, 19).replace('T', ' ')} />
        </section>
      ) : null}

      {activeTab === 'activity' ? (
        <section className="grid gap-3 rounded-sm border border-slate-300 bg-white p-4 md:grid-cols-2">
          <Field label="Total Rides" value={passenger.totalRides} />
          <Field label="Total Spend" value={`$${Number(passenger.totalSpend || 0).toFixed(2)}`} />
          <Field label="Last Ride At" value={passenger.lastRideAt || '-'} />
          <Field label="Saved Addresses" value={passenger.savedAddresses?.length || 0} />
        </section>
      ) : null}

      {activeTab === 'safety' ? (
        <section className="space-y-4">
          <div className="grid gap-3 rounded-sm border border-slate-300 bg-white p-4 md:grid-cols-2">
            <Field label="Emergency Contact" value={passenger.emergencyContact || '-'} />
            <Field label="Account Status" value={passenger.status} />
            <Field label="Admin Notes" value={passenger.notes || '-'} />
            <Field label="Passenger Identity Status" value={identity?.status || 'not_submitted'} />
            <Field label="Identity Submitted At" value={identity?.submittedAt || '-'} />
            <Field label="Identity Reviewed At" value={identity?.reviewedAt || '-'} />
          </div>

          <section className="rounded-sm border border-slate-300 bg-white">
            <div className="flex flex-col gap-3 border-b border-slate-300 px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Identity Verification</h2>
                <p className="text-xs text-slate-500">Passenger national ID documents and review actions.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleReview('approve')}
                  disabled={!canReviewIdentity || !identity || identityDocs.length < 2 || identity?.status === 'approved' || reviewing}
                  className="rounded bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  {reviewing ? 'Working...' : 'Approve'}
                </button>
                <button
                  type="button"
                  onClick={() => handleReview('reject')}
                  disabled={!canReviewIdentity || !identity || identityDocs.length < 2 || reviewing}
                  className="rounded bg-rose-600 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-rose-300"
                >
                  Reject
                </button>
              </div>
            </div>

            <div className="p-4">
              {identity?.rejectionReason ? (
                <p className="mb-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  Rejection reason: {identity.rejectionReason}
                </p>
              ) : null}

              {identityDocs.length === 0 ? (
                <p className="text-sm text-slate-500">No identity documents submitted yet.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {identityDocs.map((doc) => (
                    <article key={doc.label} className="overflow-hidden rounded border border-slate-200 bg-slate-50">
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
                  ))}
                </div>
              )}
            </div>
          </section>
        </section>
      ) : null}

      {activeTab === 'payment' ? (
        <section className="grid gap-3 rounded-sm border border-slate-300 bg-white p-4 md:grid-cols-2">
          <Field label="Payment Methods" value={passenger.paymentMethods?.length || 0} />
          <Field label="Total Spend" value={`$${Number(passenger.totalSpend || 0).toFixed(2)}`} />
        </section>
      ) : null}

      {activeTab === 'timeline' ? (
        <section className="rounded-sm border border-slate-300 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-800">Activity Timeline</h2>
          {timelineEvents.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">No timeline events available.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {timelineEvents.map((event, index) => (
                <li key={`${event.title}-${event.time}-${index}`} className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold text-slate-800">{event.title}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{new Date(event.when).toLocaleString()}</p>
                  {event.details ? <p className="mt-1 text-xs text-slate-700">{event.details}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <Link to="/dashboard/passengers" className="inline-block text-sm font-semibold text-indigo-700 hover:text-indigo-500">
        Back to passengers
      </Link>
    </section>
  )
}
