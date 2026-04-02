function DefaultTabIcon({ active = false }) {
  const color = active ? '#4f46e5' : '#64748b'
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <rect x="4" y="5" width="6" height="6" rx="1" fill={color} />
      <rect x="14" y="5" width="6" height="6" rx="1" fill={color} opacity="0.75" />
      <rect x="4" y="13" width="6" height="6" rx="1" fill={color} opacity="0.75" />
      <rect x="14" y="13" width="6" height="6" rx="1" fill={color} />
    </svg>
  )
}

export default function AdminTabs({ label = '', tabs = [], activeTab, onChange }) {
  return (
    <div className="border border-slate-300 bg-white px-4 py-2">
      {label ? <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</p> : null}
      <div className="flex justify-center">
        <div className="thin-scrollbar flex w-full max-w-[540px] items-end justify-center gap-6 overflow-x-auto border-b border-slate-200 px-2">
          {tabs.map((tab) => {
            const active = activeTab === tab.key
            const Icon = tab.icon

            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => onChange?.(tab.key)}
                className={`flex shrink-0 items-center gap-2 border-b-2 px-1 pb-3 pt-1 text-xs font-semibold transition ${
                  active ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {Icon ? <Icon active={active} /> : <DefaultTabIcon active={active} />}
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
