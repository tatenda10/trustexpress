import BASE_URL from '../context/Api'

export function resolveMediaUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  const normalized = raw.replace(/\\/g, '/')
  const collapsed = normalized.replace(/([^:]\/)\/+/g, '$1')

  if (/^https?:\/\//i.test(collapsed)) return collapsed

  if (/^\/?uploads\//i.test(collapsed)) {
    const path = collapsed.startsWith('/') ? collapsed : `/${collapsed}`
    return `${BASE_URL}${path}`
  }

  if (collapsed.startsWith('/')) return `${BASE_URL}${collapsed}`

  return collapsed
}
