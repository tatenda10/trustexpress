import { useEffect, useState } from 'react'
import AdminSidebar from './AdminSidebar'
import { useAuth } from '../authcontext/AuthContext'
import { Outlet } from 'react-router-dom'

export default function AdminLayout() {
  const { admin } = useAuth()
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 768) {
        setMobileSidebarOpen(false)
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 md:grid md:h-screen md:grid-cols-[260px_1fr] md:overflow-hidden">
      <div className="hidden md:block">
        <AdminSidebar admin={admin} />
      </div>

      {mobileSidebarOpen ? (
        <div className="fixed inset-0 z-40 bg-slate-950/55 md:hidden" onClick={() => setMobileSidebarOpen(false)}>
          <div className="h-full w-[285px]" onClick={(event) => event.stopPropagation()}>
            <AdminSidebar admin={admin} mobile onClose={() => setMobileSidebarOpen(false)} />
          </div>
        </div>
      ) : null}

      <main className="min-h-screen md:h-screen md:overflow-y-auto">
        <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                <path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">TrustCars Admin</p>
              <p className="truncate text-xs text-slate-500">{admin?.fullName || 'Admin User'}</p>
            </div>

            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-900 text-sm font-semibold text-white">
              {(admin?.fullName || 'A')
                .split(' ')
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0]?.toUpperCase() || '')
                .join('')}
            </div>
          </div>
        </div>

        <div className="p-2 sm:p-2.5 md:p-4">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
