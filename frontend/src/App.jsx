import './App.css'
import { useEffect, useMemo, useState } from 'react'
import { API_BASE } from './api.js'
import Admin from './pages/Admin.jsx'
import Cashier from './pages/Cashier.jsx'
import Kitchen from './pages/Kitchen.jsx'
import Waiter from './pages/Waiter.jsx'

function App() {
  const screens = useMemo(
    () => [
      { key: 'waiter', label: 'Garson' },
      { key: 'cashier', label: 'Kasa' },
      { key: 'kitchen', label: 'Mutfak' },
      { key: 'admin', label: 'Admin' },
    ],
    [],
  )

  const [screen, setScreen] = useState(() => {
    const h = window.location.hash.replace('#', '').trim()
    return screens.some((s) => s.key === h) ? h : 'waiter'
  })

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace('#', '').trim()
      setScreen(screens.some((s) => s.key === h) ? h : 'waiter')
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [screens])

  function go(key) {
    window.location.hash = key
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">Restoran Otomasyonu</div>
        <div className="nav">
          {screens.map((s) => (
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
          <span className="muted">{API_BASE ? API_BASE : 'Same origin'}</span>
        </div>
      </div>

      {screen === 'waiter' ? <Waiter /> : null}
      {screen === 'cashier' ? <Cashier /> : null}
      {screen === 'kitchen' ? <Kitchen /> : null}
      {screen === 'admin' ? <Admin /> : null}
    </div>
  )
}

export default App
