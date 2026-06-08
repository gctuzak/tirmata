import { useEffect, useMemo, useState } from 'react'
import {
  addItemToTable,
  getCategories,
  getProducts,
  getTableAdisyon,
  getTables,
  moveOrder,
  updateOrderItem,
  printKitchenOrder,
} from '../api.js'

function formatMoney(v) {
  const n = Number(v || 0)
  return `${n.toFixed(2)} ₺`
}

function StatusBadge({ status }) {
  const cls = status === 'occupied' ? 'badge badge-occupied' : 'badge badge-empty'
  const text = status === 'occupied' ? 'Dolu' : 'Boş'
  return <span className={cls}>{text}</span>
}

function normalizeSelectedOptions(options) {
  const groups = []

  for (const [groupName, value] of Object.entries(options)) {
    if (Array.isArray(value)) {
      const normalizedValues = [...new Set(value.map((item) => item.trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'tr'),
      )
      if (normalizedValues.length > 0) {
        groups.push(`${groupName}: ${normalizedValues.join(', ')}`)
      }
      continue
    }

    if (value) {
      groups.push(`${groupName}: ${String(value).trim()}`)
    }
  }

  return groups.length > 0 ? groups.join(' | ') : null
}

const CHANGE_REASON_OPTIONS = [
  'Musteri vazgecti',
  'Yanlis girildi',
  'Ikram',
  'Personel hatasi',
  'Diger',
]

export default function Waiter() {
  const [tables, setTables] = useState([])
  const [categories, setCategories] = useState([]) // This is now a tree
  const [categoryPath, setCategoryPath] = useState([]) // Track navigation path
  const [products, setProducts] = useState([])
  const [selectedTableId, setSelectedTableId] = useState(null)
  const [adisyon, setAdisyon] = useState(null)
  const [moveTargetTableId, setMoveTargetTableId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Product options modal state
  const [optionsModalProduct, setOptionsModalProduct] = useState(null)
  const [selectedOptions, setSelectedOptions] = useState({})
  const [changeReasonModal, setChangeReasonModal] = useState(null)
  const [selectedChangeReason, setSelectedChangeReason] = useState('')
  const [customChangeReason, setCustomChangeReason] = useState('')

  // Current level of categories based on path
  const currentCategories = useMemo(() => {
    let current = categories
    for (const catId of categoryPath) {
      const found = current.find((c) => Number(c.id) === Number(catId))
      if (found && found.children) {
        current = found.children
      } else {
        return []
      }
    }
    return current
  }, [categories, categoryPath])

  const currentCategoryName = useMemo(() => {
    if (categoryPath.length === 0) return 'Kategoriler'
    let current = categories
    let name = ''
    for (const catId of categoryPath) {
      const found = current.find((c) => Number(c.id) === Number(catId))
      if (found) {
        name = found.name
        current = found.children || []
      }
    }
    return name
  }, [categories, categoryPath])

  const selectedTable = useMemo(
    () => tables.find((t) => t.id === selectedTableId) || null,
    [tables, selectedTableId],
  )

  const emptyTables = useMemo(
    () => tables.filter((t) => t.status === 'empty' && t.id !== selectedTableId),
    [tables, selectedTableId],
  )

  const waiterStats = useMemo(
    () => [
      { label: 'Bos Masa', value: tables.filter((t) => t.status === 'empty').length },
      { label: 'Dolu Masa', value: tables.filter((t) => t.status === 'occupied').length },
      { label: 'Secili Urun', value: products.length },
    ],
    [products.length, tables],
  )

  async function refreshTables() {
    const t = await getTables()
    setTables(t)
  }

  async function refreshCategories() {
    const c = await getCategories()
    setCategories(c)
  }

  async function refreshProducts(categoryId) {
    const p = await getProducts({ activeOnly: true, categoryId: categoryId })
    setProducts(p)
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
        await Promise.all([refreshTables(), refreshCategories()])
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

  // Effect to load products when we reach a leaf category or any category
  useEffect(() => {
    const lastCatId = categoryPath[categoryPath.length - 1]
    if (lastCatId != null) {
      refreshProducts(lastCatId)
    } else {
      setProducts([])
    }
  }, [categoryPath])

  async function onSelectTable(tableId) {
    setSelectedTableId(tableId)
    setCategoryPath([])
    setProducts([])
    setMoveTargetTableId('')
  }

  function onSelectCategory(category) {
    setCategoryPath([...categoryPath, category.id])
  }

  function onGoBack() {
    setCategoryPath(categoryPath.slice(0, -1))
  }

  async function onAddProduct(product) {
    if (selectedTableId == null) return
    
    // Check if product has options
    if (product.options && product.options.length > 0) {
      setOptionsModalProduct(product)
      
      // Initialize default options
      const initialOptions = {}
      for (const opt of product.options) {
        if (opt.type === 'single') {
          initialOptions[opt.name] = opt.choices[0] // Default to first choice
        } else {
          initialOptions[opt.name] = [] // Empty array for multiple
        }
      }
      setSelectedOptions(initialOptions)
      return
    }
    
    await submitAddProduct(product.id, 1, null)
  }
  
  function handleOptionChange(groupName, choice, isMultiple) {
    setSelectedOptions(prev => {
      const newOpts = { ...prev }
      if (isMultiple) {
        const arr = newOpts[groupName] || []
        if (arr.includes(choice)) {
          newOpts[groupName] = arr.filter(c => c !== choice)
        } else {
          newOpts[groupName] = [...arr, choice]
        }
      } else {
        newOpts[groupName] = choice
      }
      return newOpts
    })
  }
  
  async function submitOptionsModal() {
    if (!optionsModalProduct) return

    const selected_options = normalizeSelectedOptions(selectedOptions)

    await submitAddProduct(optionsModalProduct.id, 1, selected_options)
    setOptionsModalProduct(null)
    setSelectedOptions({})
  }

  async function submitAddProduct(productId, quantity, selected_options) {
    try {
      setLoading(true)
      setError('')
      const a = await addItemToTable(selectedTableId, { product_id: productId, quantity, selected_options })
      setAdisyon(a)
      await refreshTables()
    } catch (e) {
      setError(e.message || 'Hata')
    } finally {
      setLoading(false)
    }
  }

  async function onMove() {
    if (!adisyon) return
    const target = Number(moveTargetTableId)
    if (!target) return
    try {
      setLoading(true)
      setError('')
      await moveOrder(adisyon.id, { new_table_id: target })
      setSelectedTableId(target)
      setMoveTargetTableId('')
      await refreshTables()
      await refreshAdisyon(target)
    } catch (e) {
      setError(e.message || 'Hata')
    } finally {
      setLoading(false)
    }
  }

  async function onSetQty(itemId, qty) {
    if (selectedTableId == null) return
    const currentItem = adisyon?.items.find((item) => item.id === itemId)
    if (!currentItem) return

    if (currentItem.is_printed && qty < Number(currentItem.quantity)) {
      setSelectedChangeReason('')
      setCustomChangeReason('')
      setChangeReasonModal({ itemId, qty, currentItem })
      return
    }

    try {
      setLoading(true)
      setError('')
      const a = await updateOrderItem(itemId, { quantity: qty })
      setAdisyon(a)
      await refreshTables()
      if (a == null) {
        await refreshAdisyon(selectedTableId)
      } else if (currentItem.is_printed && qty > Number(currentItem.quantity)) {
        alert('Ek adet yeni satir olarak eklendi. Siparisi tekrar gonderince mutfaga/bara yeniden basilir.')
      }
    } catch (e) {
      setError(e.message || 'Hata')
    } finally {
      setLoading(false)
    }
  }


  async function submitChangeReason() {
    if (!changeReasonModal) return

    const reason =
      selectedChangeReason === 'Diger' ? customChangeReason.trim() : selectedChangeReason.trim()
    if (!reason) {
      setError('Basili kalem degisikligi icin sebep secilmelidir.')
      return
    }

    try {
      setLoading(true)
      setError('')
      const a = await updateOrderItem(changeReasonModal.itemId, {
        quantity: changeReasonModal.qty,
        change_reason: reason,
      })
      setAdisyon(a)
      await refreshTables()
      if (a == null) {
        await refreshAdisyon(selectedTableId)
      }
      setChangeReasonModal(null)
      setSelectedChangeReason('')
      setCustomChangeReason('')
    } catch (e) {
      setError(e.message || 'Hata')
    } finally {
      setLoading(false)
    }
  }

  async function onSaveOrder() {
    if (!adisyon) return
    try {
      setLoading(true)
      setError('')
      await printKitchenOrder(adisyon.id)
      setSelectedTableId(null)
      setCategoryPath([])
      setProducts([])
      setMoveTargetTableId('')
      alert('Siparişler başarıyla kaydedildi ve mutfağa/bara iletildi!')
    } catch (e) {
      setError(e.message || 'Yazıcı hatası veya bağlantı sorunu.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="eyebrow">Servis Akisi</div>
          <div className="title">Garson Ekrani</div>
          <div className="subtitle">Masalari yonet, siparisi hizlica olustur ve mutfaga tek dokunusla gonder.</div>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => refreshTables()}>
            Masaları Yenile
          </button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      <div className="stats-grid">
        {waiterStats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className="stat-label">{stat.label}</div>
            <div className="stat-value">{stat.value}</div>
          </div>
        ))}
      </div>

      {selectedTableId == null ? (
        <div className="grid">
          {tables.map((t) => (
            <button
              key={t.id}
              className={t.status === 'occupied' ? 'card card-occupied' : 'card'}
              type="button"
              onClick={() => onSelectTable(t.id)}
            >
              <div className="card-title">{t.table_name}</div>
              <StatusBadge status={t.status} />
            </button>
          ))}
        </div>
      ) : (
        <div className="stack">
          <div className="hero-strip">
            <div>
              <div className="hero-strip-label">Secili Masa</div>
              <div className="hero-strip-title">{selectedTable ? selectedTable.table_name : `Masa #${selectedTableId}`}</div>
            </div>
            <div className="hero-strip-actions">
              <span className="meta-pill">{adisyon ? `${adisyon.items.length} kalem` : 'Yeni adisyon'}</span>
              <span className="meta-pill">{adisyon ? formatMoney(adisyon.total_amount) : '0.00 ₺'}</span>
            </div>
          </div>

          <div className="bar toolbar-row">
            <button className="btn btn-secondary" type="button" onClick={() => setSelectedTableId(null)}>
              ← Masalar
            </button>
            <div className="bar-title" style={{ flex: 1 }}>{selectedTable ? selectedTable.table_name : `Masa #${selectedTableId}`}</div>
            <button className="btn btn-secondary" type="button" onClick={() => refreshAdisyon(selectedTableId)}>
              Adisyon Yenile
            </button>
          </div>

          <div className="split">
            <div className="panel">
              <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {categoryPath.length > 0 && (
                  <button className="btn btn-sm btn-secondary" style={{ padding: '6px 10px', fontSize: '14px' }} onClick={onGoBack}>
                    ← Geri
                  </button>
                )}
                <span>{currentCategoryName}</span>
              </div>
              <div className="grid grid-tight">
                {currentCategories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="card"
                    onClick={() => onSelectCategory(c)}
                  >
                    <div className="card-title">{c.name}</div>
                  </button>
                ))}
              </div>

              {products.length > 0 ? (
                <>
                  <div className="panel-title" style={{ marginTop: 16 }}>
                    Ürünler
                  </div>
                  <div className="grid">
                    {products.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="card product-card"
                        disabled={loading}
                        onClick={() => onAddProduct(p)}
                      >
                        <div className="card-title">{p.name}</div>
                        <div className="muted">{formatMoney(p.price)}</div>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>

            <div className="panel">
              <div className="panel-title">Adisyon</div>
              {adisyon ? (
                <>
                  <div className="muted">{`Sipariş #${adisyon.id}`}</div>
                  {adisyon.has_changes ? (
                    <div className="alert alert-warning">
                      Bu adisyonda mutfaga iletilmis kalemler uzerinde degisiklik yapildi. Kasa ekrani bu kayitlari gorecek.
                    </div>
                  ) : null}
                  <div className="list">
                    {adisyon.items.map((it) => (
                      <div className="row" key={it.id}>
                        <div className="row-main">
                          <div className="row-title">{it.product_name}</div>
                          {it.selected_options && (
                            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
                              ↳ {it.selected_options}
                            </div>
                          )}
                          <div className="muted">{formatMoney(it.unit_price)}</div>
                          <div className="inline-pills">
                            <span className={it.is_printed ? 'status-chip status-chip-amber' : 'status-chip status-chip-blue'}>
                              {it.is_printed ? 'Gonderildi' : 'Yeni ek'}
                            </span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <button
                            className="btn btn-secondary"
                            type="button"
                            disabled={loading}
                            onClick={() => onSetQty(it.id, Math.max(0, Number(it.quantity) - 1))}
                          >
                            -
                          </button>
                          <div className="qty">{it.quantity}</div>
                          <button
                            className="btn btn-secondary"
                            type="button"
                            disabled={loading}
                            onClick={() => onSetQty(it.id, Number(it.quantity) + 1)}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {adisyon.change_logs && adisyon.change_logs.length > 0 ? (
                    <div className="change-log-panel">
                      <div className="panel-title" style={{ marginBottom: 10 }}>Degisiklik Kayitlari</div>
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

                  <button 
                    className="btn btn-green" 
                    type="button" 
                    style={{ width: '100%', marginTop: '16px', padding: '16px', fontSize: '18px' }}
                    disabled={loading || adisyon.items.length === 0}
                    onClick={onSaveOrder}
                  >
                    ✓ Siparişi Gönder / Kaydet
                  </button>

                  <div className="bar" style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
                    <select
                      className="input"
                      value={moveTargetTableId}
                      onChange={(e) => setMoveTargetTableId(e.target.value)}
                    >
                      <option value="">Masa Değiştir...</option>
                      {emptyTables.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.table_name}
                        </option>
                      ))}
                    </select>
                    <button className="btn" type="button" disabled={!moveTargetTableId || loading} onClick={onMove}>
                      Taşı
                    </button>
                  </div>
                </>
              ) : (
                <div className="muted">Açık adisyon yok</div>
              )}
            </div>
          </div>
        </div>
      )}
      {optionsModalProduct && (
        <div className="modal-backdrop">
          <div className="modal-card modal-sm">
            <h2 className="modal-title">{optionsModalProduct.name}</h2>
            <div className="modal-subtitle">Lutfen urune ait secenekleri belirleyin.</div>
            
            {optionsModalProduct.options.map((opt, i) => (
              <div key={i} className="option-group">
                <div className="option-group-title">{opt.name} {opt.type === 'multiple' ? '(Coklu Secim)' : '(Tekli Secim)'}</div>
                <div className="option-choices">
                  {opt.choices.map((c, j) => {
                    const isSelected = opt.type === 'multiple' 
                      ? (selectedOptions[opt.name] || []).includes(c)
                      : selectedOptions[opt.name] === c
                    
                    return (
                      <button 
                        key={j} 
                        type="button"
                        className={isSelected ? 'option-chip option-chip-selected' : 'option-chip'}
                        onClick={() => handleOptionChange(opt.name, c, opt.type === 'multiple')}
                      >
                        {c}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            
            <div className="modal-actions">
              <button 
                type="button" 
                className="btn btn-secondary" 
                style={{ flex: 1 }}
                onClick={() => {
                  setOptionsModalProduct(null)
                  setSelectedOptions({})
                }}
              >
                İptal
              </button>
              <button 
                type="button" 
                className="btn btn-green" 
                style={{ flex: 2 }}
                onClick={submitOptionsModal}
                disabled={loading}
              >
                Ekle
              </button>
            </div>
          </div>
        </div>
      )}
      {changeReasonModal && (
        <div className="modal-backdrop">
          <div className="modal-card modal-sm">
            <h2 className="modal-title">Degisiklik Sebebi</h2>
            <div className="modal-subtitle">
              Bu kalem mutfaga/bara iletildi. Azaltma veya silme islemi icin sebep secin.
            </div>

            <div className="reason-grid">
              {CHANGE_REASON_OPTIONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  className={selectedChangeReason === reason ? 'option-chip option-chip-selected' : 'option-chip'}
                  onClick={() => setSelectedChangeReason(reason)}
                >
                  {reason}
                </button>
              ))}
            </div>

            {selectedChangeReason === 'Diger' ? (
              <input
                className="input"
                type="text"
                value={customChangeReason}
                onChange={(e) => setCustomChangeReason(e.target.value)}
                placeholder="Sebebi yazin"
                style={{ marginTop: 14 }}
              />
            ) : null}

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={() => {
                  setChangeReasonModal(null)
                  setSelectedChangeReason('')
                  setCustomChangeReason('')
                }}
              >
                Vazgec
              </button>
              <button
                type="button"
                className="btn btn-green"
                style={{ flex: 2 }}
                onClick={submitChangeReason}
                disabled={
                  loading ||
                  !selectedChangeReason ||
                  (selectedChangeReason === 'Diger' && customChangeReason.trim().length < 2)
                }
              >
                Kaydet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
