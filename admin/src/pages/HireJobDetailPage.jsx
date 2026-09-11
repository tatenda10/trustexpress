import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import axios from 'axios'
import BASE_URL from '../context/Api'
import { useAuth } from '../authcontext/AuthContext'

function DetailField({ label, value }) {
  return (
    <div className="border border-slate-200 bg-slate-50 px-3 py-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-800 whitespace-pre-wrap">{value || '-'}</p>
    </div>
  )
}

function formatDateTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function formatMoney(amount, currency = 'USD') {
  if (amount == null || Number.isNaN(Number(amount))) return '-'
  return `${currency || 'USD'} ${Number(amount).toFixed(2)}`
}

function statusClass(status) {
  const value = String(status || '').toLowerCase()
  if (value === 'open' || value === 'pending' || value === 'confirmed') {
    return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
  }
  if (value === 'quoted' || value === 'in_progress') {
    return 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'
  }
  if (value === 'booked' || value === 'accepted' || value === 'completed') {
    return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
  }
  if (value === 'cancelled' || value === 'declined' || value === 'withdrawn') {
    return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
  }
  return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
}

export default function HireJobDetailPage() {
  const { requestId } = useParams()
  const navigate = useNavigate()
  const { token } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [request, setRequest] = useState(null)
  const [quotes, setQuotes] = useState([])
  const [booking, setBooking] = useState(null)
  const [preferredVehicle, setPreferredVehicle] = useState(null)
  const [timeline, setTimeline] = useState([])
  const [transactions, setTransactions] = useState([])

  useEffect(() => {
    let active = true

    const load = async () => {
      if (!token || !requestId) return
      setLoading(true)
      setError('')
      try {
        const { data } = await axios.get(`${BASE_URL}/api/admin/hire/requests/${encodeURIComponent(requestId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!active) return
        setRequest(data.request || null)
        setQuotes(Array.isArray(data.quotes) ? data.quotes : [])
        setBooking(data.booking || null)
        setPreferredVehicle(data.preferredVehicle || null)
        setTimeline(Array.isArray(data.timeline) ? data.timeline : [])
        setTransactions(Array.isArray(data.transactions) ? data.transactions : [])
      } catch (err) {
        if (!active) return
        setError(err?.response?.data?.error || err?.message || 'Failed to load hire job')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => {
      active = false
    }
  }, [requestId, token])

  if (loading) {
    return (
      <section className="border border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
        Loading hire job...
      </section>
    )
  }

  if (error || !request) {
    return (
      <section className="space-y-3">
        <button
          type="button"
          onClick={() => navigate('/dashboard/hire-jobs')}
          className="text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          ← Back to hire jobs
        </button>
        <div className="border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error || 'Hire job not found'}
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate('/dashboard/hire-jobs')}
          className="text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          ← Back to hire jobs
        </button>
        <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium capitalize ${statusClass(request.status)}`}>
          {request.status}
        </span>
      </div>

      <div className="border border-slate-300 bg-[#0f172a] px-4 py-4 text-white">
        <p className="text-[11px] uppercase tracking-wide text-slate-300">Hire job</p>
        <h1 className="mt-1 text-lg font-semibold">{request.title || request.publicId}</h1>
        <p className="mt-1 text-xs text-slate-300">{request.publicId}</p>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="space-y-3">
          <div className="border border-slate-300 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">Job details</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <DetailField label="Passenger" value={request.passengerName} />
              <DetailField label="Passenger phone" value={request.passengerPhone} />
              <DetailField label="Category" value={request.category} />
              <DetailField label="People" value={request.passengerCount} />
              <DetailField label="Start" value={formatDateTime(request.startAt)} />
              <DetailField label="Created" value={formatDateTime(request.createdAt)} />
              <DetailField label="Pickup" value={request.pickupLabel} />
              <DetailField label="Dropoff" value={request.dropoffLabel} />
              <DetailField
                label="Passenger offer"
                value={formatMoney(request.passengerOfferAmount, request.fareCurrency)}
              />
              <DetailField
                label="Recommended range"
                value={
                  request.recommendedFareMin != null && request.recommendedFareMax != null
                    ? `${formatMoney(request.recommendedFareMin, request.fareCurrency)} - ${formatMoney(request.recommendedFareMax, request.fareCurrency)}`
                    : '-'
                }
              />
            </div>
            <div className="mt-2">
              <DetailField label="Description / notes" value={request.notes} />
            </div>
          </div>

          {preferredVehicle ? (
            <div className="border border-slate-300 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-800">Preferred vehicle</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <DetailField label="Title" value={preferredVehicle.title} />
                <DetailField label="Driver" value={preferredVehicle.driverName} />
                <DetailField label="Category" value={preferredVehicle.category} />
                <DetailField label="Plate" value={preferredVehicle.numberPlate} />
                <DetailField
                  label="Daily rate"
                  value={formatMoney(preferredVehicle.dailyRate, preferredVehicle.currency)}
                />
                <DetailField label="Status" value={preferredVehicle.status} />
              </div>
            </div>
          ) : null}

          <div className="border border-slate-300 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">Booking</h2>
            {!booking ? (
              <p className="mt-3 text-sm text-slate-500">No booking yet.</p>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <DetailField label="Booking id" value={booking.publicId} />
                <DetailField label="Status" value={booking.status} />
                <DetailField label="Amount" value={formatMoney(booking.amount, booking.currency)} />
                <DetailField label="Vehicle" value={booking.vehicle?.title} />
                <DetailField label="Driver" value={booking.driverName} />
                <DetailField label="Driver phone" value={booking.driverPhone} />
                <DetailField label="Passenger" value={booking.passengerName} />
                <DetailField label="Created" value={formatDateTime(booking.createdAt)} />
                <DetailField label="Started" value={formatDateTime(booking.startedAt)} />
                <DetailField label="Completed" value={formatDateTime(booking.completedAt)} />
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="border border-slate-300 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">Offers & transactions</h2>
            {transactions.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No offers or quotes yet.</p>
            ) : (
              <div className="mt-3 overflow-hidden border border-slate-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-100 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Type</th>
                      <th className="px-3 py-2 font-semibold">Party</th>
                      <th className="px-3 py-2 font-semibold">Amount</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 font-semibold">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((item, index) => (
                      <tr key={`${item.kind}-${item.quoteId || item.bookingId || index}`} className="border-t border-slate-200">
                        <td className="px-3 py-2 text-slate-700">{item.label}</td>
                        <td className="px-3 py-2 text-slate-700">
                          <div>{item.party}</div>
                          {item.message ? <div className="text-[11px] text-slate-500">{item.message}</div> : null}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{formatMoney(item.amount, item.currency)}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${statusClass(item.status)}`}>
                            {item.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-500">{formatDateTime(item.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="border border-slate-300 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">Driver quotes</h2>
            {quotes.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No driver quotes yet.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {quotes.map((quote) => (
                  <article key={quote.id} className="border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          {formatMoney(quote.amount, quote.currency)}
                        </p>
                        <p className="mt-1 text-sm text-slate-700">
                          {quote.driverName || 'Driver'}
                          {quote.driverPhone ? ` · ${quote.driverPhone}` : ''}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {[quote.vehicle?.title, quote.vehicle?.category, quote.vehicleNumberPlate]
                            .filter(Boolean)
                            .join(' · ') || 'Vehicle'}
                        </p>
                        {quote.message ? (
                          <p className="mt-2 text-sm text-slate-600">{quote.message}</p>
                        ) : null}
                      </div>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${statusClass(quote.status)}`}>
                        {quote.status}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-400">{formatDateTime(quote.createdAt)}</p>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="border border-slate-300 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">Activity timeline</h2>
            {timeline.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No activity yet.</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {timeline.map((item, index) => (
                  <li key={`${item.type}-${index}`} className="border-l-2 border-slate-200 pl-3">
                    <p className="text-sm font-medium text-slate-800">{item.label}</p>
                    {item.detail ? <p className="mt-0.5 text-sm text-slate-600">{item.detail}</p> : null}
                    <p className="mt-0.5 text-[11px] text-slate-400">{formatDateTime(item.at)}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
