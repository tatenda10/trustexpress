import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

const LOCAL_PHONE_REGEX = /^07\d{8}$/

function sanitizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.startsWith('263') && digits.length === 12) return `0${digits.slice(3)}`.slice(0, 10)
  if (digits.length === 9 && digits.startsWith('7')) return `0${digits}`.slice(0, 10)
  return digits.slice(0, 10)
}

function PlaceSearchField({ label, value, onChange, onSelect, origin, disabled }) {
  const [query, setQuery] = useState(value || '')
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const { token } = useAuth()
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const blurTimer = useRef(null)

  useEffect(() => {
    setQuery(value || '')
  }, [value])

  useEffect(() => {
    const text = String(query || '').trim()
    if (text.length < 2 || text === value) {
      setSuggestions([])
      return undefined
    }
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const { data } = await axios.get(`${BASE_URL}/api/admin/rides/dispatch/places`, {
          headers,
          params: {
            query: text,
            latitude: origin?.latitude,
            longitude: origin?.longitude,
          },
        })
        setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : [])
        setOpen(true)
      } catch {
        setSuggestions([])
      } finally {
        setLoading(false)
      }
    }, 280)
    return () => clearTimeout(timer)
  }, [headers, origin?.latitude, origin?.longitude, query, value])

  const chooseSuggestion = async (suggestion) => {
    const placeId = suggestion.placeId || suggestion.providerPlaceId
    try {
      const { data } = await axios.post(
        `${BASE_URL}/api/admin/rides/dispatch/place-details`,
        { placeId },
        { headers }
      )
      const place = data?.place || suggestion
      const title = place.title || suggestion.title || ''
      const subtitle = place.subtitle || suggestion.subtitle || ''
      const label = [title, subtitle].filter(Boolean).join(', ')
      const coordinate = place.coordinate || suggestion.coordinate
      setQuery(label)
      setOpen(false)
      setSuggestions([])
      onChange(label)
      onSelect({
        label,
        coordinate: {
          latitude: Number(coordinate?.latitude),
          longitude: Number(coordinate?.longitude),
        },
      })
    } catch {
      const label = suggestion.title || suggestion.subtitle || query
      setQuery(label)
      onChange(label)
    }
  }

  return (
    <label className="relative block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <input
        type="text"
        value={query}
        disabled={disabled}
        onChange={(event) => {
          setQuery(event.target.value)
          onChange(event.target.value)
        }}
        onFocus={() => suggestions.length && setOpen(true)}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 150)
        }}
        placeholder={`Search ${String(label || '').toLowerCase()}`}
        className="h-10 w-full border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-500"
      />
      {loading ? <p className="mt-1 text-[11px] text-slate-400">Searching...</p> : null}
      {open && suggestions.length ? (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto border border-slate-200 bg-white shadow-sm">
          {suggestions.map((suggestion) => (
            <li key={suggestion.placeId || suggestion.providerPlaceId || suggestion.title}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseSuggestion(suggestion)}
              >
                <span className="block font-medium text-slate-900">{suggestion.title}</span>
                {suggestion.subtitle ? <span className="block text-xs text-slate-500">{suggestion.subtitle}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </label>
  )
}

export default function DispatchRidePage() {
  const navigate = useNavigate()
  const { token } = useAuth()
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  const [options, setOptions] = useState({ tiers: [], defaultPaymentMethod: 'cash' })
  const [passengerName, setPassengerName] = useState('')
  const [passengerPhone, setPassengerPhone] = useState('')
  const [lookupNote, setLookupNote] = useState('')
  const [pickupLabel, setPickupLabel] = useState('')
  const [dropoffLabel, setDropoffLabel] = useState('')
  const [pickupCoordinate, setPickupCoordinate] = useState(null)
  const [dropoffCoordinate, setDropoffCoordinate] = useState(null)
  const [tierKey, setTierKey] = useState('')
  const [passengerCount, setPassengerCount] = useState(1)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [quote, setQuote] = useState(null)
  const [quoting, setQuoting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const selectedTier = options.tiers.find((tier) => tier.tierKey === tierKey) || options.tiers[0]
  const maxPeople = Number(selectedTier?.maxPassengerCount || 4)

  useEffect(() => {
    if (!token) return undefined
    let active = true
    axios.get(`${BASE_URL}/api/admin/rides/dispatch/options`, { headers })
      .then(({ data }) => {
        if (!active) return
        setOptions(data || { tiers: [] })
        setTierKey(data?.tiers?.[0]?.tierKey || '')
        setPaymentMethod(data?.defaultPaymentMethod || 'cash')
      })
      .catch((err) => {
        if (!active) return
        setError(err?.response?.data?.error || err?.message || 'Could not load booking options')
      })
    return () => {
      active = false
    }
  }, [headers, token])

  useEffect(() => {
    if (passengerCount > maxPeople) setPassengerCount(maxPeople)
  }, [maxPeople, passengerCount])

  useEffect(() => {
    if (!pickupCoordinate || !dropoffCoordinate || !tierKey) {
      setQuote(null)
      return undefined
    }
    let active = true
    setQuoting(true)
    axios.post(
      `${BASE_URL}/api/admin/rides/dispatch/quote`,
      {
        pickupCoordinate,
        dropoffCoordinate,
        pickupLabel,
        dropoffLabel,
        selectedTierKey: tierKey,
        passengerCount,
        paymentMethod,
      },
      { headers }
    ).then(({ data }) => {
      if (!active) return
      setQuote(data?.quote || null)
      setError('')
    }).catch((err) => {
      if (!active) return
      setQuote(null)
      setError(err?.response?.data?.error || err?.message || 'Could not estimate this trip')
    }).finally(() => {
      if (active) setQuoting(false)
    })
    return () => {
      active = false
    }
  }, [dropoffCoordinate, dropoffLabel, headers, passengerCount, paymentMethod, pickupCoordinate, pickupLabel, tierKey])

  const lookupPassenger = async () => {
    const phone = sanitizePhone(passengerPhone)
    if (!LOCAL_PHONE_REGEX.test(phone)) {
      setError('Enter a valid 10-digit number starting with 07.')
      return
    }
    setLookingUp(true)
    setError('')
    setLookupNote('')
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/rides/dispatch/passenger`, {
        headers,
        params: { phone },
      })
      setPassengerPhone(data?.localPhone || phone)
      if (data?.found && data?.name) {
        setPassengerName((current) => current.trim() || data.name)
        setLookupNote(data.passengerUserId
          ? 'Found an existing Trust Express account. Drivers will still call the number you entered.'
          : 'Phone matched a saved passenger. Confirm the name before sending.')
      } else {
        setLookupNote('No app account for this number. The ride will still be sent to nearby drivers using this name and phone.')
      }
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Could not look up this number')
    } finally {
      setLookingUp(false)
    }
  }

  const submitRide = async (event) => {
    event.preventDefault()
    const phone = sanitizePhone(passengerPhone)
    if (!passengerName.trim()) {
      setError('Enter the passenger\'s name.')
      return
    }
    if (!LOCAL_PHONE_REGEX.test(phone)) {
      setError('Enter a valid 10-digit number starting with 07.')
      return
    }
    if (!pickupCoordinate || !dropoffCoordinate) {
      setError('Choose pickup and drop-off from the search results.')
      return
    }
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      const { data } = await axios.post(
        `${BASE_URL}/api/admin/rides/dispatch`,
        {
          passengerName: passengerName.trim(),
          passengerPhone: phone,
          pickupCoordinate,
          dropoffCoordinate,
          pickupLabel,
          dropoffLabel,
          selectedTierKey: tierKey,
          passengerCount,
          paymentMethod,
        },
        { headers }
      )
      const ride = data?.rideRequest
      setSuccess(
        ride?.nearbyDriverCount
          ? `Ride ${ride.publicId} sent to ${ride.nearbyDriverCount} nearby driver${ride.nearbyDriverCount === 1 ? '' : 's'}. The first driver who accepts is assigned automatically.`
          : `Ride ${ride?.publicId || ''} was created. No nearby drivers are online right now.`
      )
      if (ride?.id) {
        navigate(`/dashboard/ride-operations/${ride.id}`)
      }
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Could not request this ride')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="space-y-3">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Operations</p>
        <h1 className="text-xl font-semibold text-slate-900">Book a ride for a passenger</h1>
        <p className="mt-1 text-xs text-slate-500">
          Use this when a passenger cannot open the app. Enter their name and phone so the driver calls them directly. You can book more than one ride at a time.
        </p>
      </div>

      {error ? <div className="border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div> : null}
      {success ? <div className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">{success}</div> : null}

      <form onSubmit={submitRide} className="space-y-3">
        <div className="border border-slate-300 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-800">Passenger</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label>
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Full name</span>
              <input
                value={passengerName}
                onChange={(event) => setPassengerName(event.target.value)}
                placeholder="Passenger's name"
                className="h-10 w-full border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500"
              />
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Phone number</span>
              <div className="flex gap-2">
                <input
                  value={passengerPhone}
                  onChange={(event) => setPassengerPhone(sanitizePhone(event.target.value))}
                  placeholder="0771234567"
                  inputMode="numeric"
                  className="h-10 w-full border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={lookupPassenger}
                  disabled={lookingUp}
                  className="h-10 shrink-0 border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {lookingUp ? 'Checking...' : 'Look up'}
                </button>
              </div>
            </label>
          </div>
          {lookupNote ? <p className="mt-2 text-xs text-slate-500">{lookupNote}</p> : null}
        </div>

        <div className="border border-slate-300 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-800">Trip</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <PlaceSearchField
              label="Pickup"
              value={pickupLabel}
              origin={options.centerCoordinate}
              onChange={setPickupLabel}
              onSelect={(place) => {
                setPickupLabel(place.label)
                setPickupCoordinate(place.coordinate)
              }}
            />
            <PlaceSearchField
              label="Drop-off"
              value={dropoffLabel}
              origin={pickupCoordinate || options.centerCoordinate}
              onChange={setDropoffLabel}
              onSelect={(place) => {
                setDropoffLabel(place.label)
                setDropoffCoordinate(place.coordinate)
              }}
            />
            <label>
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ride type</span>
              <select
                value={tierKey}
                onChange={(event) => setTierKey(event.target.value)}
                className="h-10 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-indigo-500"
              >
                {options.tiers.map((tier) => (
                  <option key={tier.tierKey} value={tier.tierKey}>{tier.tierName}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">People</span>
              <select
                value={passengerCount}
                onChange={(event) => setPassengerCount(Number(event.target.value))}
                className="h-10 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-indigo-500"
              >
                {Array.from({ length: maxPeople }, (_, index) => index + 1).map((count) => (
                  <option key={count} value={count}>{count === 1 ? '1 person' : `${count} people`}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Payment</span>
              <select
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
                className="h-10 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-indigo-500"
              >
                <option value="cash">Cash</option>
                <option value="online">Pay online</option>
              </select>
            </label>
          </div>
        </div>

        <div className="border border-slate-300 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-800">Fare</h2>
          {quoting ? (
            <p className="mt-2 text-sm text-slate-500">Calculating road distance...</p>
          ) : quote ? (
            <div className="mt-2 flex flex-wrap items-end gap-6">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Estimate</p>
                <p className="text-2xl font-semibold text-slate-900">${Number(quote.estimatedAmount || 0).toFixed(2)}</p>
              </div>
              <p className="text-sm text-slate-600">
                {Number(quote.distanceKm || 0).toFixed(1)} km · {Math.max(1, Math.round(quote.durationMinutes || 1))} min · {quote.tierName}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Choose pickup and drop-off to see the fare.</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting || quoting || !quote}
            className="h-10 bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {submitting ? 'Requesting...' : 'Request ride'}
          </button>
          <Link to="/dashboard/ride-operations" className="text-sm text-slate-500 hover:text-slate-800">
            Back to ride operations
          </Link>
        </div>
      </form>
    </section>
  )
}
