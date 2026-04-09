import BASE_URL from '../context/Api'

export function resolveMediaUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  const normalized = raw.replace(/\\/g, '/')
  const collapsed = normalized.replace(/([^:]\/)\/+/g, '$1')

  if (/^https?:\/\//i.test(collapsed)) return collapsed

  if (/^\/?uploads\//i.test(collapsed)) {
    return collapsed.startsWith('/') ? collapsed : `/${collapsed}`
  }

  if (collapsed.startsWith('/')) return collapsed

  return collapsed
}

export function resolveMediaCandidates(value) {
  const raw = String(value || '').trim()
  if (!raw) return []

  const normalized = raw.replace(/\\/g, '/')
  const collapsed = normalized.replace(/([^:]\/)\/+/g, '$1')

  if (/^https?:\/\//i.test(collapsed)) return [collapsed]

  const candidates = []

  if (/^\/?uploads\//i.test(collapsed)) {
    const path = collapsed.startsWith('/') ? collapsed : `/${collapsed}`
    candidates.push(path)
    if (BASE_URL) {
      candidates.push(`${BASE_URL}${path}`)
    }
  } else if (collapsed.startsWith('/')) {
    candidates.push(collapsed)
    if (BASE_URL) {
      candidates.push(`${BASE_URL}${collapsed}`)
    }
  } else {
    candidates.push(collapsed)
  }

  return Array.from(new Set(candidates.filter(Boolean)))
}
