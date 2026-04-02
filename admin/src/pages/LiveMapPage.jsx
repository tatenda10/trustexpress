const liveDrivers = [
  { id: 'D-104', name: 'Kelvin Musona', area: 'CBD', status: 'On Trip', eta: '4 min', lat: -17.8292, lng: 31.0522 },
  { id: 'D-221', name: 'Blessing Ncube', area: 'Avondale', status: 'Available', eta: '2 min', lat: -17.8045, lng: 31.0419 },
  { id: 'D-332', name: 'Sarah Chidza', area: 'Borrowdale', status: 'Pickup', eta: '6 min', lat: -17.7824, lng: 31.0898 },
]

const liveTrips = [
  { id: 'TR-90214', rider: 'Lerato Ncube', driver: 'Kelvin Musona', stage: 'In Progress', route: 'Borrowdale -> Avondale' },
  { id: 'TR-90221', rider: 'Simba Dube', driver: 'Blessing Ncube', stage: 'Driver Arriving', route: 'CBD -> Eastlea' },
  { id: 'TR-90224', rider: 'Tariro Moyo', driver: 'Sarah Chidza', stage: 'Pickup', route: 'Mt Pleasant -> Belgravia' },
]

function statusBadge(status) {
  if (status === 'Available') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
  if (status === 'On Trip') return 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'
  return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
}

export default function LiveMapPage() {
  return (
    <section className="space-y-3">
      <header className="rounded-sm border border-slate-300 bg-white px-4 py-3">
        <h1 className="text-sm font-semibold text-slate-800">Live Map</h1>
        <p className="text-xs text-slate-500">Real-time view of drivers and trips across active service zones.</p>
      </header>

      <div className="grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <article className="overflow-hidden rounded-sm border border-slate-300 bg-white">
          <div className="border-b border-slate-300 px-4 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Map Canvas</h2>
          </div>

          <div className="relative h-[460px] overflow-hidden bg-[radial-gradient(circle_at_20%_20%,_#dbeafe_0,_#eff6ff_35%,_#f8fafc_100%)]">
            <div className="absolute inset-0 opacity-40" style={{
              backgroundImage:
                'linear-gradient(to right, rgba(15,23,42,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.08) 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            }} />

            {liveDrivers.map((driver, index) => (
              <div
                key={driver.id}
                className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1"
                style={{ left: `${25 + index * 24}%`, top: `${35 + index * 18}%` }}
              >
                <span className="relative inline-flex h-3.5 w-3.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-40" />
                  <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-indigo-600 ring-2 ring-white" />
                </span>
                <span className="rounded bg-white/95 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-sm">
                  {driver.id}
                </span>
              </div>
            ))}

            <div className="absolute bottom-3 right-3 rounded border border-slate-200 bg-white/90 px-3 py-2 text-[11px] text-slate-600">
              Map preview mode. Connect provider API (Mapbox/Google) for real GPS rendering.
            </div>
          </div>
        </article>

        <div className="space-y-3">
          <article className="overflow-hidden rounded-sm border border-slate-300 bg-white">
            <div className="border-b border-slate-300 px-4 py-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Live Drivers</h2>
            </div>
            <ul className="divide-y divide-slate-200">
              {liveDrivers.map((driver) => (
                <li key={driver.id} className="space-y-1 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-800">{driver.name}</p>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadge(driver.status)}`}>
                      {driver.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">{driver.area} • ETA {driver.eta}</p>
                  <p className="text-[11px] text-slate-500">{driver.lat}, {driver.lng}</p>
                </li>
              ))}
            </ul>
          </article>

          <article className="overflow-hidden rounded-sm border border-slate-300 bg-white">
            <div className="border-b border-slate-300 px-4 py-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Active Trips</h2>
            </div>
            <ul className="divide-y divide-slate-200">
              {liveTrips.map((trip) => (
                <li key={trip.id} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-800">{trip.id}</p>
                    <span className="text-[11px] font-semibold text-indigo-700">{trip.stage}</span>
                  </div>
                  <p className="text-xs text-slate-600">{trip.rider} • {trip.driver}</p>
                  <p className="text-[11px] text-slate-500">{trip.route}</p>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </section>
  )
}