// If we are in dev mode and accessing via a specific IP (e.g. 192.168.x.x), 
// we should point to that IP's port 8000 instead of hardcoded localhost.
const getDevBaseUrl = () => {
  const hostname = window.location.hostname
  return `http://${hostname}:8000`
}

export const API_BASE =
  import.meta.env.PROD ? '' : import.meta.env.VITE_API_BASE_URL || getDevBaseUrl()
const SESSION_STORAGE_KEY = 'tirmata_session'

export function getStoredSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setStoredSession(session) {
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
}

export function clearStoredSession() {
  window.localStorage.removeItem(SESSION_STORAGE_KEY)
}

export async function api(path, options = {}) {
  const url = `${API_BASE}${path}`
  const headers = new Headers(options.headers || {})
  const session = getStoredSession()
  if (session?.token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${session.token}`)
  }
  if (!headers.has('Content-Type') && options.body != null) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(url, {
    ...options,
    headers,
  })

  let data = null
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    data = await res.json()
  } else {
    data = await res.text()
  }

  if (!res.ok) {
    if (res.status === 401) {
      clearStoredSession()
      window.dispatchEvent(new CustomEvent('tirmata:auth-expired'))
    }
    const message =
      typeof data === 'object' && data && 'detail' in data ? data.detail : String(data)
    const error = new Error(message)
    error.status = res.status
    error.data = data
    throw error
  }
  return data
}

export function login(payload) {
  return api('/auth/login', { method: 'POST', body: JSON.stringify(payload) })
}

export function logout() {
  return api('/auth/logout', { method: 'POST' })
}

export function getCurrentUser() {
  return api('/auth/me')
}

export function getUsers() {
  return api('/users')
}

export function createUser(payload) {
  return api('/users', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateUser(userId, payload) {
  return api(`/users/${userId}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export function getCategories() {
  return api('/categories')
}

export function createCategory(payload) {
  return api('/categories', { method: 'POST', body: JSON.stringify(payload) })
}

export function getTables() {
  return api('/tables')
}

export function createTable(payload) {
  return api('/tables', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateTable(tableId, payload) {
  return api(`/tables/${tableId}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export function deleteTable(tableId) {
  return api(`/tables/${tableId}`, { method: 'DELETE' })
}

export function getProducts({ activeOnly = true, categoryId = null } = {}) {
  const params = new URLSearchParams()
  params.set('active_only', activeOnly ? 'true' : 'false')
  if (categoryId != null) params.set('category_id', String(categoryId))
  return api(`/products?${params.toString()}`)
}

export function createProduct(payload) {
  return api('/products', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateProduct(productId, payload) {
  return api(`/products/${productId}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export function getTableAdisyon(tableId) {
  return api(`/tables/${tableId}/adisyon`)
}

export function addItemToTable(tableId, payload) {
  return api(`/tables/${tableId}/items`, { method: 'POST', body: JSON.stringify(payload) })
}

export function moveOrder(orderId, payload) {
  return api(`/orders/${orderId}/move`, { method: 'POST', body: JSON.stringify(payload) })
}

export function closeOrder(orderId, payload) {
  return api(`/orders/${orderId}/close`, { method: 'POST', body: JSON.stringify(payload) })
}

export function getKitchenOpenItems() {
  return api('/kitchen/open-items')
}

export function updateOrderItem(itemId, payload) {
  return api(`/order-items/${itemId}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export function prepareOrderItem(itemId) {
  return api(`/order-items/${itemId}/prepare`, { method: 'POST' })
}

export function printKitchenOrder(orderId) {
  return api(`/orders/${orderId}/print-kitchen`, { method: 'POST' })
}

export function getDailyReport(date) {
  const params = new URLSearchParams()
  if (date) params.set('date', date)
  return api(`/reports/daily?${params.toString()}`)
}
