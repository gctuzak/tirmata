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
    
    // Format selected options as a string
    const optsStrArr = []
    for (const [groupName, value] of Object.entries(selectedOptions)) {
      if (Array.isArray(value)) {
        if (value.length > 0) optsStrArr.push(`${groupName}: ${value.join(', ')}`)
      } else if (value) {
        optsStrArr.push(`${groupName}: ${value}`)
      }
    }
    const selected_options = optsStrArr.length > 0 ? optsStrArr.join(' | ') : null
    
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
    try {
      setLoading(true)
      setError('')
      const a = await updateOrderItem(itemId, { quantity: qty })
      setAdisyon(a)
      await refreshTables()
      if (a == null) {
        await refreshAdisyon(selectedTableId)
      }
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
        <div className="title">Garson</div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => refreshTables()}>
            Masaları Yenile
          </button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}

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
          <div className="bar" style={{ flexWrap: 'wrap', marginBottom: '12px' }}>
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
                        className="card"
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
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
        }}>
          <div style={{ background: 'white', borderRadius: 8, padding: 24, width: '100%', maxWidth: 400, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ marginTop: 0, marginBottom: 8 }}>{optionsModalProduct.name}</h2>
            <div style={{ marginBottom: 16, color: '#666' }}>Lütfen seçenekleri belirleyin:</div>
            
            {optionsModalProduct.options.map((opt, i) => (
              <div key={i} style={{ marginBottom: 16, padding: 12, border: '1px solid #eee', borderRadius: 6 }}>
                <div style={{ fontWeight: 'bold', marginBottom: 8 }}>{opt.name} {opt.type === 'multiple' ? '(Çoklu Seçim)' : '(Tekli Seçim)'}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {opt.choices.map((c, j) => {
                    const isSelected = opt.type === 'multiple' 
                      ? (selectedOptions[opt.name] || []).includes(c)
                      : selectedOptions[opt.name] === c
                    
                    return (
                      <button 
                        key={j} 
                        type="button"
                        onClick={() => handleOptionChange(opt.name, c, opt.type === 'multiple')}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 4,
                          border: isSelected ? '2px solid #007bff' : '1px solid #ccc',
                          background: isSelected ? '#e6f2ff' : 'white',
                          cursor: 'pointer'
                        }}
                      >
                        {c}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            
            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
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
                className="btn" 
                style={{ flex: 2, background: '#28a745', color: 'white', border: 'none' }}
                onClick={submitOptionsModal}
                disabled={loading}
              >
                Ekle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
