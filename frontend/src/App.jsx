import './App.css'
import { useEffect, useMemo, useState } from 'react'
import {
  API_BASE,
  clearStoredSession,
  getCurrentUser,
  getStoredSession,
  login,
  logout,
  setStoredSession,
} from './api.js'
import Admin from './pages/Admin.jsx'
import Cashier from './pages/Cashier.jsx'
import Kitchen from './pages/Kitchen.jsx'
import Waiter from './pages/Waiter.jsx'

function App() {
  const screens = useMemo(
    () => [
      { key: 'waiter', label: 'Garson', roles: ['waiter', 'admin'] },
      { key: 'cashier', label: 'Kasa', roles: ['cashier', 'admin'] },
      { key: 'kitchen', label: 'Mutfak', roles: ['kitchen', 'admin'] },
      { key: 'admin', label: 'Admin', roles: ['admin'] },
    ],
    [],
  )
  const [authReady, setAuthReady] = useState(false)
  const [session, setSession] = useState(() => getStoredSession())
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  const [screen, setScreen] = useState(() => {
    const h = window.location.hash.replace('#', '').trim()
    return screens.some((s) => s.key === h) ? h : 'waiter'
  })

  const currentUser = session?.user || null
  const allowedScreens = useMemo(() => {
    if (!currentUser) return []
    return screens.filter((item) => item.roles.includes(currentUser.role))
  }, [currentUser, screens])

  const defaultScreen = allowedScreens[0]?.key || null

  function go(key) {
    window.location.hash = key
  }

  async function hydrateSession() {
    const stored = getStoredSession()
    if (!stored?.token) {
      setSession(null)
      setAuthReady(true)
      return
    }

    try {
      const user = await getCurrentUser()
      const nextSession = { token: stored.token, user }
      setStoredSession(nextSession)
      setSession(nextSession)
    } catch {
      clearStoredSession()
      setSession(null)
    } finally {
      setAuthReady(true)
    }
  }

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace('#', '').trim()
      setScreen(screens.some((s) => s.key === h) ? h : 'waiter')
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [screens])

  useEffect(() => {
    hydrateSession()
    const onExpired = () => {
      clearStoredSession()
      setSession(null)
      setAuthReady(true)
    }
    window.addEventListener('tirmata:auth-expired', onExpired)
    return () => window.removeEventListener('tirmata:auth-expired', onExpired)
  }, [])

  useEffect(() => {
    if (!currentUser || !defaultScreen) return
    if (!allowedScreens.some((item) => item.key === screen)) {
      go(defaultScreen)
    }
  }, [allowedScreens, currentUser, defaultScreen, screen])

  async function handleLogin(event) {
    event.preventDefault()
    try {
      setLoginLoading(true)
      setLoginError('')
      const result = await login(loginForm)
      setStoredSession(result)
      setSession(result)
      const firstScreen = screens.find((item) => item.roles.includes(result.user.role))
      if (firstScreen) {
        go(firstScreen.key)
      }
    } catch (error) {
      setLoginError(error.message || 'Giris basarisiz')
    } finally {
      setLoginLoading(false)
    }
  }

  async function handleLogout() {
    try {
      await logout()
    } catch {
      // Session may already be gone.
    } finally {
      clearStoredSession()
      setSession(null)
      setLoginForm({ username: '', password: '' })
      setLoginError('')
    }
  }

  if (!authReady) {
    return (
      <div className="app">
        <div className="auth-shell">
          <div className="auth-card">
            <div className="auth-title">Oturum kontrol ediliyor</div>
            <div className="muted">Lutfen bekleyin...</div>
          </div>
        </div>
      </div>
    )
  }

  if (!currentUser) {
    return (
      <div className="app">
        <div className="auth-shell">
          <form className="auth-card" onSubmit={handleLogin}>
            <div className="brand-wrap">
              <div className="brand-mark">T</div>
              <div>
                <div className="brand auth-brand">Tirmata POS</div>
                <div className="brand-subtitle auth-brand-subtitle">Kapali devre restoran otomasyonu</div>
              </div>
            </div>
            <div className="auth-title">Giris Yap</div>
            <div className="auth-subtitle">Rolunuze uygun ekrana ulasmak icin kullanici adi ve sifrenizi girin.</div>
            {loginError ? <div className="alert">{loginError}</div> : null}
            <div className="stack">
              <input
                className="input"
                placeholder="Kullanici adi"
                value={loginForm.username}
                onChange={(event) => setLoginForm((prev) => ({ ...prev, username: event.target.value }))}
              />
              <input
                className="input"
                type="password"
                placeholder="Sifre"
                value={loginForm.password}
                onChange={(event) => setLoginForm((prev) => ({ ...prev, password: event.target.value }))}
              />
              <button className="btn" type="submit" disabled={loginLoading}>
                {loginLoading ? 'Giris yapiliyor...' : 'Giris Yap'}
              </button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-shell">
          <div className="brand-wrap">
            <div className="brand-mark">T</div>
            <div>
              <div className="brand">Tirmata POS</div>
              <div className="brand-subtitle">Servis, mutfak ve kasa tek akışta</div>
            </div>
          </div>
          <div className="nav">
            {allowedScreens.map((s) => (
              <button
                key={s.key}
                type="button"
                className={screen === s.key ? 'nav-btn nav-btn-active' : 'nav-btn'}
                onClick={() => go(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="meta">
            <div className="topbar-meta">
              <span className="meta-pill">{currentUser.username} · {currentUser.role}</span>
              {API_BASE ? <span className="meta-pill">{API_BASE}</span> : null}
              <button type="button" className="nav-btn" onClick={handleLogout}>
                Cikis
              </button>
            </div>
          </div>
        </div>
      </div>

      {screen === 'waiter' ? <Waiter /> : null}
      {screen === 'cashier' ? <Cashier /> : null}
      {screen === 'kitchen' ? <Kitchen /> : null}
      {screen === 'admin' ? <Admin currentUser={currentUser} /> : null}
    </div>
  )
}

export default App
