import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-ZW', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function getThreadName(thread) {
  return thread?.user?.fullName || thread?.user?.email || thread?.userId || 'Support user'
}

function getInitials(thread) {
  const name = getThreadName(thread)
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('') || 'S'
  )
}

export default function SupportInboxPage() {
  const { token } = useAuth()
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const [threads, setThreads] = useState([])
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 10, totalPages: 1 })
  const [summary, setSummary] = useState({ open: 0, new: 0, closed: 0 })
  const [selectedThreadId, setSelectedThreadId] = useState(null)
  const [selectedThread, setSelectedThread] = useState(null)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [messageFilter, setMessageFilter] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [loadingThreads, setLoadingThreads] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [updatingThread, setUpdatingThread] = useState(false)
  const [error, setError] = useState('')

  const loadThreads = async ({ silent = false } = {}) => {
    if (!silent) setLoadingThreads(true)
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/support/threads`, {
        headers,
        params: {
          status: statusFilter,
          filter: messageFilter,
          q: appliedSearch,
          page: pagination.page,
          pageSize: pagination.pageSize,
        },
      })
      const nextThreads = Array.isArray(data?.threads) ? data.threads : []
      const nextPagination = data?.pagination || { total: nextThreads.length, page: 1, pageSize: pagination.pageSize, totalPages: 1 }
      setThreads(nextThreads)
      setPagination((prev) => ({
        ...prev,
        total: Number(nextPagination.total || 0),
        page: Number(nextPagination.page || 1),
        pageSize: Number(nextPagination.pageSize || prev.pageSize),
        totalPages: Number(nextPagination.totalPages || 1),
      }))
      setSummary({
        open: Number(data?.summary?.open || 0),
        new: Number(data?.summary?.new || 0),
        closed: Number(data?.summary?.closed || 0),
      })
      if (!selectedThreadId && nextThreads.length > 0) setSelectedThreadId(nextThreads[0].id)
      if (selectedThreadId && !nextThreads.some((thread) => String(thread.id) === String(selectedThreadId))) {
        setSelectedThreadId(nextThreads[0]?.id || null)
      }
      setError('')
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load support threads')
    } finally {
      if (!silent) setLoadingThreads(false)
    }
  }

  const loadMessages = async (threadId, { silent = false } = {}) => {
    if (!threadId) {
      setSelectedThread(null)
      setMessages([])
      return
    }
    if (!silent) setLoadingMessages(true)
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/support/threads/${threadId}/messages`, { headers })
      setSelectedThread(data?.thread || null)
      setMessages(Array.isArray(data?.messages) ? data.messages : [])
      setError('')
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load thread messages')
      if (!silent) {
        setSelectedThread(null)
        setMessages([])
      }
    } finally {
      if (!silent) setLoadingMessages(false)
    }
  }

  useEffect(() => {
    loadThreads()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, statusFilter, messageFilter, appliedSearch, pagination.page, pagination.pageSize])

  useEffect(() => {
    if (!selectedThreadId) return
    loadMessages(selectedThreadId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedThreadId])

  useEffect(() => {
    const interval = setInterval(() => {
      loadThreads({ silent: true })
      if (selectedThreadId) loadMessages(selectedThreadId, { silent: true })
    }, 5000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedThreadId, token, statusFilter, messageFilter, appliedSearch, pagination.page, pagination.pageSize])

  const applySearch = () => {
    setPagination((prev) => ({ ...prev, page: 1 }))
    setAppliedSearch(String(searchInput || '').trim())
  }

  const onFilterChange = (setter, value) => {
    setter(value)
    setPagination((prev) => ({ ...prev, page: 1 }))
  }

  const sendReply = async () => {
    const message = String(draft || '').trim()
    if (!message || !selectedThreadId || sending) return
    setSending(true)
    try {
      const { data } = await axios.post(
        `${BASE_URL}/api/admin/support/threads/${selectedThreadId}/messages`,
        { message },
        { headers }
      )
      setMessages((prev) => [...prev, data.messageRecord].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)))
      setDraft('')
      loadThreads()
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to send reply')
    } finally {
      setSending(false)
    }
  }

  const updateThreadStatus = async (status) => {
    if (!selectedThreadId || updatingThread) return
    setUpdatingThread(true)
    try {
      const { data } = await axios.patch(
        `${BASE_URL}/api/admin/support/threads/${selectedThreadId}/status`,
        { status },
        { headers },
      )
      setSelectedThread(data?.thread || null)
      await loadThreads()
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to update issue status')
    } finally {
      setUpdatingThread(false)
    }
  }

  const deleteThread = async () => {
    if (!selectedThreadId || updatingThread) return
    const confirmed = window.confirm('Delete this support conversation permanently?')
    if (!confirmed) return

    setUpdatingThread(true)
    try {
      await axios.delete(`${BASE_URL}/api/admin/support/threads/${selectedThreadId}`, { headers })
      setSelectedThread(null)
      setMessages([])
      setSelectedThreadId(null)
      await loadThreads()
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to delete support conversation')
    } finally {
      setUpdatingThread(false)
    }
  }

  return (
    <section className="space-y-3">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Support / Inbox</p>
        <div className="mt-1 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Support Inbox</h1>
            <p className="text-xs text-slate-500">Read and reply to driver and passenger support conversations.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="min-w-[110px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Open</p>
              <p className="mt-1 text-lg font-semibold text-emerald-700">{summary.open}</p>
            </div>
            <div className="min-w-[110px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">New</p>
              <p className="mt-1 text-lg font-semibold text-amber-700">{summary.new}</p>
            </div>
            <div className="min-w-[110px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Closed</p>
              <p className="mt-1 text-lg font-semibold text-slate-800">{summary.closed}</p>
            </div>
          </div>
        </div>
      </div>

      {error ? (
        <div className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="overflow-hidden border border-slate-300 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="grid gap-2">
              <div className="flex gap-2">
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') applySearch()
                  }}
                  placeholder="Search by name, email, phone, or message"
                  className="h-10 flex-1 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={applySearch}
                  className="h-10 bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  Search
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
              <select
                value={statusFilter}
                onChange={(event) => onFilterChange(setStatusFilter, event.target.value)}
                className="h-10 border border-slate-300 bg-white px-2 text-xs"
              >
                <option value="all">All issues</option>
                <option value="open">Open issues</option>
                <option value="closed">Closed issues</option>
              </select>
              <select
                value={messageFilter}
                onChange={(event) => onFilterChange(setMessageFilter, event.target.value)}
                className="h-10 border border-slate-300 bg-white px-2 text-xs"
              >
                <option value="all">All messages</option>
                <option value="new">New messages</option>
                <option value="waiting_admin">Waiting on admin</option>
                <option value="replied">Admin replied</option>
              </select>
              </div>
            </div>
          </div>

          <div className="max-h-[66vh] overflow-y-auto bg-[#efeae2]">
            {loadingThreads ? (
              <div className="px-4 py-6 text-sm text-slate-500">Loading support inbox...</div>
            ) : threads.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-500">No support conversations yet.</div>
            ) : threads.map((thread) => {
              const isSelected = String(thread.id) === String(selectedThreadId)
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => setSelectedThreadId(thread.id)}
                  className={`flex w-full items-start gap-3 border-b border-[#d9dbd4] px-4 py-3 text-left transition ${
                    isSelected ? 'bg-[#d9fdd3]' : 'bg-white hover:bg-[#f5f6f6]'
                  }`}
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-700 text-sm font-semibold text-white">
                    {getInitials(thread)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">{getThreadName(thread)}</p>
                      <p className="whitespace-nowrap text-[11px] text-slate-400">{formatTime(thread.lastMessageAt || thread.updatedAt || thread.createdAt)}</p>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">{thread.user?.role || thread.userRole}</p>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        thread.status === 'open' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {thread.status}
                      </span>
                      {thread.latestSenderType !== 'admin' ? (
                        <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                          New
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs text-slate-500">{thread.latestMessage || 'No messages yet'}</p>
                  </div>
                </button>
              )
            })}
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
            <p>
              Showing {threads.length === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1}
              {' '}-{' '}
              {Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}
            </p>
            <div className="flex items-center gap-2">
              <select
                value={pagination.pageSize}
                onChange={(event) => setPagination((prev) => ({ ...prev, page: 1, pageSize: Number(event.target.value) }))}
                className="h-9 border border-slate-300 bg-white px-2 text-xs"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
              </select>
              <button
                type="button"
                onClick={() => setPagination((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                disabled={pagination.page <= 1}
                className="h-9 border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 disabled:opacity-40"
              >
                Prev
              </button>
              <span className="min-w-[72px] text-center text-xs font-semibold text-slate-600">
                Page {pagination.page}/{pagination.totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPagination((prev) => ({ ...prev, page: Math.min(prev.totalPages, prev.page + 1) }))}
                disabled={pagination.page >= pagination.totalPages}
                className="h-9 border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-hidden border border-slate-300 bg-[#efeae2]">
          {!selectedThreadId ? (
            <div className="flex min-h-[74vh] items-center justify-center px-6 text-sm text-slate-500">
              Choose a support conversation from the left.
            </div>
          ) : (
            <>
              <div className="border-b border-[#d9dbd4] bg-[#f0f2f5] px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-700 text-sm font-semibold text-white">
                      {getInitials(selectedThread)}
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">{getThreadName(selectedThread)}</h2>
                      <p className="mt-0.5 text-xs text-slate-500">{selectedThread?.user?.role || 'Support conversation'}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateThreadStatus(selectedThread?.status === 'closed' ? 'open' : 'closed')}
                      disabled={updatingThread}
                      className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    >
                      {selectedThread?.status === 'closed' ? 'Reopen Issue' : 'Mark Issue Closed'}
                    </button>
                    <button
                      type="button"
                      onClick={deleteThread}
                      disabled={updatingThread}
                      className="border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>

              {loadingMessages ? (
                <div className="flex min-h-[62vh] items-center justify-center text-sm text-slate-500">Loading messages...</div>
              ) : (
                <>
                  <div className="max-h-[62vh] min-h-[62vh] space-y-3 overflow-y-auto bg-[#efeae2] px-4 py-4">
                    {messages.length === 0 ? (
                      <p className="text-sm text-slate-500">No messages yet.</p>
                    ) : messages.map((message) => {
                      const isAdmin = message.senderType === 'admin'
                      return (
                        <div key={message.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[78%] rounded-lg px-4 py-2 text-sm shadow-sm ${
                            isAdmin
                              ? 'bg-[#d9fdd3] text-slate-900'
                              : 'bg-white text-slate-800'
                          }`}>
                            <p className="leading-6">{message.message}</p>
                            <p className="mt-1 text-right text-[11px] text-slate-400">{formatTime(message.createdAt)}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="border-t border-[#d9dbd4] bg-[#f0f2f5] px-4 py-4">
                    <div className="flex gap-3">
                      <textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder="Type a reply"
                        className="min-h-[62px] flex-1 border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={sendReply}
                        disabled={sending || !String(draft || '').trim() || selectedThread?.status === 'closed'}
                        className={`h-[62px] px-5 text-sm font-semibold text-white ${
                          sending || !String(draft || '').trim() || selectedThread?.status === 'closed'
                            ? 'bg-emerald-300'
                            : 'bg-emerald-600 hover:bg-emerald-500'
                        }`}
                      >
                        {sending ? 'Sending...' : 'Send'}
                      </button>
                    </div>
                    {selectedThread?.status === 'closed' ? (
                      <p className="mt-2 text-xs text-slate-500">This issue is closed. Reopen it to send a new reply.</p>
                    ) : null}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
