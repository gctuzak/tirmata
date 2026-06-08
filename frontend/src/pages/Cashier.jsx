import { useEffect, useMemo, useState } from 'react'
import { closeOrder, getTableAdisyon, getTables } from '../api.js'

function formatMoney(v) {
  const n = Number(v || 0)
  return `${n.toFixed(2)} ₺`
}

export default function Cashier() {
  const [tables, setTables] = useState([])
  const [selectedTableId, setSelectedTableId] = useState(null)
  const [adisyon, setAdisyon] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const occupiedTables = useMemo(() => tables.filter((t) => t.status === 'occupied'), [tables])
  const selectedTable = useMemo(
    () => tables.find((t) => t.id === selectedTableId) || null,
    [tables, selectedTableId],
  )

  const cashierStats = useMemo(
    () => [
      { label: 'Acik Masa', value: occupiedTables.length },
      { label: 'Secili Adisyon', value: adisyon ? formatMoney(adisyon.total_amount) : '0.00 ₺' },
      { label: 'Bekleyen Kalem', value: adisyon ? adisyon.items.length : 0 },
    ],
    [adisyon, occupiedTables.length],
  )

  async function refreshTables() {
    const t = await getTables()
    setTables(t)
  }

  async function refreshAdisyon(tableId) {
    try {
      const a = await getTableAdisyon(tableId)
      setAdisyon(a)
    } catch (e) {
      if (e && e.status === 404) {
        setAdisyon(null)
        return
      }
      throw e
    }
  }

  useEffect(() => {
    ;(async () => {
      try {
        setError('')
        await refreshTables()
      } catch (e) {
        setError(e.message || 'Hata')
      }
    })()
  }, [])

  useEffect(() => {
    if (selectedTableId == null) return
    ;(async () => {
      try {
        setError('')
        await refreshAdisyon(selectedTableId)
      } catch (e) {
        setError(e.message || 'Hata')
      }
    })()
  }, [selectedTableId])

  async function onClose(method) {
    if (!adisyon) return
    try {
      setLoading(true)
      setError('')
      await closeOrder(adisyon.id, { payment_method: method })
      await refreshTables()
      setSelectedTableId(null)
      setAdisyon(null)
    } catch (e) {
      setError(e.message || 'Hata')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="eyebrow">Odeme Merkezi</div>
          <div className="title">Kasa Ekrani</div>
          <div className="subtitle">Acilan adisyonlari tek bakista gor, odemeyi hizli ve hatasiz sekilde tamamla.</div>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => refreshTables()}>
            Masaları Yenile
          </button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      <div className="stats-grid">
        {cashierStats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className="stat-label">{stat.label}</div>
            <div className="stat-value">{stat.value}</div>
          </div>
        ))}
      </div>

      {selectedTableId == null ? (
        <div className="grid">
          {occupiedTables.map((t) => (
            <button key={t.id} className="card card-occupied" type="button" onClick={() => setSelectedTableId(t.id)}>
              <div className="card-title">{t.table_name}</div>
              <div className="muted">Dolu</div>
            </button>
          ))}
          {occupiedTables.length === 0 ? <div className="muted">Dolu masa yok</div> : null}
        </div>
      ) : (
        <div className="panel">
          <div className="hero-strip">
            <div>
              <div className="hero-strip-label">Odeme Bekleyen Masa</div>
              <div className="hero-strip-title">{selectedTable ? selectedTable.table_name : `Masa #${selectedTableId}`}</div>
            </div>
            <div className="hero-strip-actions">
              <span className="meta-pill">{adisyon ? `${adisyon.items.length} kalem` : '0 kalem'}</span>
              <span className="meta-pill">{adisyon ? formatMoney(adisyon.total_amount) : '0.00 ₺'}</span>
            </div>
          </div>

          <div className="bar toolbar-row">
            <button className="btn btn-secondary" type="button" onClick={() => setSelectedTableId(null)}>
              Masa Seç
            </button>
            <div className="bar-title">{selectedTable ? selectedTable.table_name : `Masa #${selectedTableId}`}</div>
            <button className="btn btn-secondary" type="button" onClick={() => refreshAdisyon(selectedTableId)}>
              Adisyon Yenile
            </button>
          </div>

          {adisyon ? (
            <>
              <div className="muted">{`Sipariş #${adisyon.id}`}</div>
              {adisyon.has_changes ? (
                <div className="alert alert-warning">
                  Bu adisyonda mutfaga iletilmis siparis degisikligi var. Odeme almadan once asagidaki kayitlari kontrol edin.
                </div>
              ) : null}
              <div className="list">
                {adisyon.items.map((it) => (
                  <div className="row" key={it.id}>
                    <div className="row-main">
                      <div className="row-title">{it.product_name}</div>
                      {it.selected_options ? <div className="muted">{it.selected_options}</div> : null}
                      <div className="muted">{formatMoney(it.unit_price)}</div>
                    </div>
                    <div className="qty">{it.quantity}</div>
                  </div>
                ))}
              </div>
              {adisyon.change_logs && adisyon.change_logs.length > 0 ? (
                <div className="change-log-panel">
                  <div className="panel-title" style={{ fontSize: 16, marginBottom: 8 }}>Degisiklik Kayitlari</div>
                  <div className="list">
                    {adisyon.change_logs.map((log) => (
                      <div className="row row-compact" key={log.id}>
                        <div className="row-main">
                          <div className="row-title">
                            {log.action === 'cancelled' ? 'Iptal/Azaltma' : 'Ek Adet'}
                          </div>
                          <div className="muted">
                            {log.quantity} x {log.product_name}
                            {log.selected_options ? ` • ${log.selected_options}` : ''}
                          </div>
                          {log.reason ? <div className="muted">Sebep: {log.reason}</div> : null}
                          <div className="muted">{log.note}</div>
                        </div>
                        <div className="muted">{log.changed_by_username || 'Bilinmiyor'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="total">
                <div>Toplam</div>
                <div className="total-amount">{formatMoney(adisyon.total_amount)}</div>
              </div>
              <div className="bar" style={{ marginTop: 12 }}>
                <button className="btn btn-green" type="button" disabled={loading} onClick={() => onClose('cash')}>
                  Nakit Ödeme Al
                </button>
                <button className="btn btn-blue" type="button" disabled={loading} onClick={() => onClose('card')}>
                  Kart Ödeme Al
                </button>
              </div>
            </>
          ) : (
            <div className="muted">Açık adisyon yok</div>
          )}
        </div>
      )}
    </div>
  )
}
