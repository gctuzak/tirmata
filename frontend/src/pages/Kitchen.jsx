import { useEffect, useState } from 'react'
import { getKitchenOpenItems, prepareOrderItem } from '../api.js'

function formatMoney(v) {
  const n = Number(v || 0)
  return `${n.toFixed(2)} ₺`
}

export default function Kitchen() {
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [loadingId, setLoadingId] = useState(null)

  async function refresh() {
    const data = await getKitchenOpenItems()
    setItems(data)
  }

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        setError('')
        const data = await getKitchenOpenItems()
        if (!alive) return
        setItems(data)
      } catch (e) {
        if (!alive) return
        setError(e.message || 'Hata')
      }
    }
    tick()
    const id = setInterval(tick, 3000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  async function onPrepare(itemId) {
    try {
      setLoadingId(itemId)
      setError('')
      await prepareOrderItem(itemId)
      await refresh()
    } catch (e) {
      setError(e.message || 'Hata')
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div className="title">Mutfak</div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => refresh()}>
            Yenile
          </button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      <div className="panel">
        <div className="panel-title">Açık Kalemler</div>
        <div className="list">
          {items.map((it) => (
            <div className="row" key={it.order_item_id}>
              <div className="row-main">
                <div className="row-title">{it.product_name}</div>
                {it.selected_options && (
                  <div className="muted" style={{ fontSize: '14px', marginTop: 4, color: '#d97706', fontWeight: 'bold' }}>
                    ↳ {it.selected_options}
                  </div>
                )}
                <div className="muted">{`${it.table_name} • ${formatMoney(it.unit_price)}`}</div>
              </div>
              <div className="qty">{it.quantity}</div>
              <button
                className="btn btn-green"
                type="button"
                disabled={loadingId === it.order_item_id}
                onClick={() => onPrepare(it.order_item_id)}
              >
                Hazır
              </button>
            </div>
          ))}
          {items.length === 0 ? <div className="muted">Açık sipariş yok</div> : null}
        </div>
      </div>
    </div>
  )
}
