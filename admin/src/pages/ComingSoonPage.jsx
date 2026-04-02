export default function ComingSoonPage({ title = 'Coming Soon', description = 'This section is still being prepared.' }) {
  return (
    <section className="space-y-3">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Business / Placeholder</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>

      <div className="border border-slate-300 bg-white px-6 py-12">
        <div className="mx-auto max-w-xl text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-2xl text-slate-500">
            ...
          </div>
          <h2 className="mt-4 text-lg font-semibold text-slate-900">{title}</h2>
          <p className="mt-2 text-sm text-slate-500">
            This area is coming soon. The structure is reserved, but the feature is not ready to use yet.
          </p>
        </div>
      </div>
    </section>
  )
}
