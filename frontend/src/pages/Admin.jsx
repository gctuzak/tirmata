import { useEffect, useMemo, useState } from 'react'
import { createCategory, createProduct, createTable, getCategories, getProducts, getTables, updateProduct, getDailyReport } from '../api.js'

function formatMoney(v) {
  const n = Number(v || 0)
  return `${n.toFixed(2)} ₺`
}

function parsePrice(v) {
  const s = String(v || '').replace(',', '.').trim()
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export default function Admin() {
  const [tab, setTab] = useState('tables')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [tables, setTables] = useState([])
  const [categories, setCategories] = useState([])
  const [flatCategories, setFlatCategories] = useState([])
  const [products, setProducts] = useState([])

  const [newTableName, setNewTableName] = useState('')
  
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryParentId, setNewCategoryParentId] = useState('')

  const [newProductName, setNewProductName] = useState('')
  const [newProductPrice, setNewProductPrice] = useState('')
  const [newProductCategoryId, setNewProductCategoryId] = useState('')
  const [newProductOptions, setNewProductOptions] = useState([])

  const [reportDate, setReportDate] = useState(() => {
    let today = new Date()
    const offset = today.getTimezoneOffset()
    today = new Date(today.getTime() - (offset*60*1000))
    return today.toISOString().split('T')[0]
  })
  const [dailyReport, setDailyReport] = useState(null)

  function addOptionGroup() {
    setNewProductOptions([...newProductOptions, { name: '', type: 'single', choices: '' }])
  }

  function updateOptionGroup(index, field, value) {
    const updated = [...newProductOptions]
    updated[index][field] = value
    setNewProductOptions(updated)
  }

  function removeOptionGroup(index) {
    setNewProductOptions(newProductOptions.filter((_, i) => i !== index))
  }

  const [editingProduct, setEditingProduct] = useState(null)
  const [editingOptions, setEditingOptions] = useState([])

  function openEditOptions(p) {
    setEditingProduct(p)
    const initialOpts = (p.options || []).map(o => ({
      name: o.name,
      type: o.type,
      choices: o.choices.join(', ')
    }))
    setEditingOptions(initialOpts)
  }

  function addEditOptionGroup() {
    setEditingOptions([...editingOptions, { name: '', type: 'single', choices: '' }])
  }

  function updateEditOptionGroup(index, field, value) {
    const updated = [...editingOptions]
    updated[index][field] = value
    setEditingOptions(updated)
  }

  function removeEditOptionGroup(index) {
    setEditingOptions(editingOptions.filter((_, i) => i !== index))
  }

  async function saveEditedOptions() {
    if (!editingProduct) return
    const optionsPayload = editingOptions
      .filter(opt => opt.name.trim() && opt.choices.trim())
      .map(opt => ({
        name: opt.name.trim(),
        type: opt.type,
        choices: opt.choices.split(',').map(c => c.trim()).filter(Boolean)
      }))

    try {
      setLoading(true)
      setError('')
      await updateProduct(editingProduct.id, { options: optionsPayload })
      setProducts(await getProducts({ activeOnly: false }))
      setEditingProduct(null)
    } catch (e) {
      setError(e.message || 'Hata')
    } finally {
      setLoading(false)
    }
  }

  function flattenCategoryTree(cats, prefix = '') {
    let result = []
    for (const c of cats) {
      const label = prefix ? `${prefix} > ${c.name}` : c.name
      result.push({ ...c, label })
      if (c.children && c.children.length > 0) {
        result = result.concat(flattenCategoryTree(c.children, label))
      }
    }
    return result
  }

  const categoryById = useMemo(() => {
    const m = new Map()
    for (const c of flatCategories) m.set(c.id, c)
    return m
  }, [flatCategories])

  async function refreshAll() {
    const [t, c, p, r] = await Promise.all([
      getTables(),
      getCategories(),
      getProducts({ activeOnly: false }),
      getDailyReport(reportDate)
    ])
    setTables(t)
    setCategories(c)
    setFlatCategories(flattenCategoryTree(c))
    setProducts(p)
    setDailyReport(r)
  }

  useEffect(() => {
    ;(async () => {
      try {
        setError('')
        await refreshAll()
      } catch (e) {
        setError(e.message || 'Hata')
      }
    })()
  }, [reportDate])

  async function onCreateTable() {
    const name = newTableName.trim()
    if (!name) return
    try {
      setLoading(true)
      setError('')
      await createTable({ table_name: name })
      setNewTableName('')
      setTables(await getTables())
    } catch (e) {
      setError(e.message || 'Hata')
    } finally {
      setLoading(false)
    }
  }

  async function onCreateCategory() {
    const name = newCategoryName.trim()
    if (!name) return
    try {
      setLoading(true)
      setError('')
      const payload = { name }
      if (newCategoryParentId) {
        payload.parent_id = Number(newCategoryParentId)
      }
      await createCategory(payload)
      setNewCategoryName('')
      setNewCategoryParentId('')
      const c = await getCategories()
      setCategories(c)
      setFlatCategories(flattenCategoryTree(c))
    } catch (e) {
      setError(e.message || 'Hata')
    } finally {
      setLoading(false)
    }
  }

  async function onCreateProduct() {
    const name = newProductName.trim()
    const price = parsePrice(newProductPrice)
    const categoryId = newProductCategoryId ? Number(newProductCategoryId) : null
    if (!name || price == null) return
    try {
      setLoading(true)
      setError('')
      const optionsPayload = newProductOptions
        .filter(opt => opt.name.trim() && opt.choices.trim())
        .map(opt => ({
          name: opt.name.trim(),
          type: opt.type,
          choices: opt.choices.split(',').map(c => c.trim()).filter(Boolean)
        }))

      await createProduct({
        name,
        price,
        category_id: categoryId,
        is_active: true,
        options: optionsPayload.length > 0 ? optionsPayload : null
      })
      setNewProductName('')
      setNewProductPrice('')
      setNewProductCategoryId('')
      setNewProductOptions([])
      setProducts(await getProducts({ activeOnly: false }))
    } catch (e) {
      setError(e.message || 'Hata')
    } finally {
      setLoading(false)
    }
  }

  async function onToggleActive(p) {
    try {
      setLoading(true)
      setError('')
      await updateProduct(p.id, { is_active: !p.is_active })
      setProducts(await getProducts({ activeOnly: false }))
    } catch (e) {
      setError(e.message || 'Hata')
    } finally {
      setLoading(false)
    }
  }

  async function onUpdatePrice(p, value) {
    const price = parsePrice(value)
    if (price == null) return
    try {
      setLoading(true)
      setError('')
      await updateProduct(p.id, { price })
      setProducts(await getProducts({ activeOnly: false }))
    } catch (e) {
      setError(e.message || 'Hata')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div className="title">Admin</div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => refreshAll()}>
            Yenile
          </button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      <div className="bar">
        <button className={tab === 'tables' ? 'btn btn-tab btn-tab-active' : 'btn btn-tab'} type="button" onClick={() => setTab('tables')}>
          Masalar
        </button>
        <button className={tab === 'categories' ? 'btn btn-tab btn-tab-active' : 'btn btn-tab'} type="button" onClick={() => setTab('categories')}>
          Kategoriler
        </button>
        <button className={tab === 'products' ? 'btn btn-tab btn-tab-active' : 'btn btn-tab'} type="button" onClick={() => setTab('products')}>
          Ürünler
        </button>
        <button className={tab === 'reports' ? 'btn btn-tab btn-tab-active' : 'btn btn-tab'} type="button" onClick={() => setTab('reports')}>
          Raporlar
        </button>
      </div>

      {tab === 'tables' ? (
        <div className="panel">
          <div className="panel-title">Masa Ekle</div>
          <div className="bar">
            <input className="input" value={newTableName} onChange={(e) => setNewTableName(e.target.value)} placeholder="Masa 1" />
            <button className="btn" type="button" disabled={loading} onClick={onCreateTable}>
              Ekle
            </button>
          </div>
          <div className="panel-title" style={{ marginTop: 16 }}>
            Masalar
          </div>
          <div className="grid">
            {tables.map((t) => (
              <div key={t.id} className={t.status === 'occupied' ? 'card card-occupied' : 'card'}>
                <div className="card-title">{t.table_name}</div>
                <div className="muted">{t.status === 'occupied' ? 'Dolu' : 'Boş'}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'categories' ? (
        <div className="panel">
          <div className="panel-title">Kategori Ekle</div>
          <div className="stack">
            <input className="input" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="Yeni Kategori Adı" />
            <select className="input" value={newCategoryParentId} onChange={(e) => setNewCategoryParentId(e.target.value)}>
              <option value="">Üst Kategori Yok (Ana Kategori)</option>
              {flatCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <button className="btn" type="button" disabled={loading} onClick={onCreateCategory}>
              Ekle
            </button>
          </div>
          <div className="panel-title" style={{ marginTop: 16 }}>
            Kategoriler
          </div>
          <div className="list">
            {flatCategories.map((c) => (
              <div key={c.id} className="row">
                <div className="row-main">
                  <div className="row-title">{c.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'products' ? (
        <div className="panel">
          {/* Ürün Ekle Formu... */}
          <div className="panel-title">Ürün Ekle</div>
          <div className="stack">
            <input className="input" value={newProductName} onChange={(e) => setNewProductName(e.target.value)} placeholder="Ürün Adı (örn: Adana Kebap)" />
            <input className="input" value={newProductPrice} onChange={(e) => setNewProductPrice(e.target.value)} inputMode="decimal" placeholder="Fiyat (örn 75)" />
            <select className="input" value={newProductCategoryId} onChange={(e) => setNewProductCategoryId(e.target.value)}>
              <option value="">Kategori Seçiniz (Gerekli)</option>
              {flatCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            
            <div style={{ padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--bg)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 'bold' }}>Ürün Opsiyonları (İsteğe Bağlı)</span>
                <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 8px' }} onClick={addOptionGroup}>+ Opsiyon Grubu Ekle</button>
              </div>
              
              {newProductOptions.map((opt, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input className="input" style={{ flex: 1, minWidth: '100px' }} placeholder="Grup Adı (örn: Şeker)" value={opt.name} onChange={(e) => updateOptionGroup(i, 'name', e.target.value)} />
                  <select className="input" style={{ width: 'auto' }} value={opt.type} onChange={(e) => updateOptionGroup(i, 'type', e.target.value)}>
                    <option value="single">Tekli Seçim</option>
                    <option value="multiple">Çoklu Seçim</option>
                  </select>
                  <input className="input" style={{ flex: 2, minWidth: '150px' }} placeholder="Seçenekler (Virgülle ayırın: Sade, Orta)" value={opt.choices} onChange={(e) => updateOptionGroup(i, 'choices', e.target.value)} />
                  <button type="button" className="btn" style={{ padding: '4px 8px', background: '#dc3545', color: 'white', border: 'none' }} onClick={() => removeOptionGroup(i)}>X</button>
                </div>
              ))}
              {newProductOptions.length === 0 && <div className="muted" style={{ fontSize: 12 }}>Bu ürüne ekstra seçim özelliği eklemek için yukarıdaki butona tıklayın.</div>}
            </div>

            <button className="btn" type="button" disabled={loading || !newProductCategoryId} onClick={onCreateProduct}>
              Ekle
            </button>
          </div>

          <div className="panel-title" style={{ marginTop: 16 }}>
            Ürünler
          </div>

          <div className="list">
            {products.map((p) => (
              <div className="row" key={p.id}>
                <div className="row-main">
                  <div className="row-title">{p.name}</div>
                  <div className="muted">
                    {p.category_id != null && categoryById.has(p.category_id) ? categoryById.get(p.category_id).name : 'Kategori yok'}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    className="input input-sm"
                    defaultValue={String(p.price)}
                    inputMode="decimal"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onUpdatePrice(p, e.currentTarget.value)
                    }}
                    onBlur={(e) => onUpdatePrice(p, e.currentTarget.value)}
                    aria-label="Fiyat"
                  />
                  <div className="muted" style={{ minWidth: 72, textAlign: 'right' }}>
                    {formatMoney(p.price)}
                  </div>
                  <button
                    className={p.is_active ? 'btn btn-secondary' : 'btn'}
                    type="button"
                    disabled={loading}
                    onClick={() => onToggleActive(p)}
                  >
                    {p.is_active ? 'Aktif' : 'Pasif'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => openEditOptions(p)}
                  >
                    Opsiyonlar {(p.options && p.options.length > 0) ? `(${p.options.length})` : ''}
                  </button>
                </div>
              </div>
            ))}
            {products.length === 0 ? <div className="muted">Ürün yok</div> : null}
          </div>
        </div>
      ) : null}

      {tab === 'reports' ? (
        <div className="panel">
          <div className="panel-title">Günlük Satış Raporu</div>
          <div className="bar" style={{ marginBottom: 16 }}>
            <input 
              type="date" 
              className="input" 
              value={reportDate} 
              onChange={(e) => setReportDate(e.target.value)} 
            />
            <button className="btn btn-secondary" onClick={() => refreshAll()} disabled={loading}>
              Raporu Yenile
            </button>
          </div>

          {dailyReport ? (
            <>
              <div className="grid" style={{ marginBottom: 24 }}>
                <div className="card" style={{ background: '#e6f2ff', borderColor: '#b3d7ff' }}>
                  <div className="card-title" style={{ fontSize: 14, color: '#0056b3' }}>Toplam Ciro</div>
                  <div style={{ fontSize: 24, fontWeight: 'bold', marginTop: 8 }}>{formatMoney(dailyReport.total_revenue)}</div>
                </div>
                <div className="card" style={{ background: '#e6ffed', borderColor: '#b3ffcc' }}>
                  <div className="card-title" style={{ fontSize: 14, color: '#006622' }}>Hizmet Verilen Masa/Müşteri</div>
                  <div style={{ fontSize: 24, fontWeight: 'bold', marginTop: 8 }}>{dailyReport.total_orders}</div>
                </div>
              </div>

              <div className="panel-title" style={{ fontSize: 16, marginBottom: 8 }}>Satılan Ürünler Özeti</div>
              <div className="list">
                {dailyReport.sold_items && dailyReport.sold_items.length > 0 ? (
                  dailyReport.sold_items.map((item, idx) => (
                    <div className="row" key={idx}>
                      <div className="row-main">
                        <div className="row-title">{item.product_name}</div>
                        <div className="muted">{formatMoney(item.total_price)} Toplam</div>
                      </div>
                      <div className="qty" style={{ padding: '4px 12px', background: '#f1f5f9', borderRadius: 16 }}>
                        {item.quantity} Adet
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="muted" style={{ padding: 16, textAlign: 'center' }}>
                    Bu tarihe ait henüz tamamlanmış sipariş bulunmuyor.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="muted">Rapor yükleniyor...</div>
          )}
        </div>
      ) : null}

      {/* Edit Options Modal */}
      {editingProduct && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
        }}>
          <div style={{ background: 'white', borderRadius: 8, padding: 24, width: '100%', maxWidth: 600, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ marginTop: 0, marginBottom: 8 }}>Opsiyonları Düzenle: {editingProduct.name}</h2>
            <div style={{ marginBottom: 16, color: '#666' }}>Mevcut opsiyonları silebilir, değiştirebilir veya yeni ekleyebilirsiniz.</div>
            
            <div style={{ padding: '16px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--bg)', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ fontSize: 16, fontWeight: 'bold' }}>Opsiyon Grupları</span>
                <button type="button" className="btn btn-secondary" onClick={addEditOptionGroup}>+ Opsiyon Grubu Ekle</button>
              </div>
              
              {editingOptions.map((opt, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap', paddingBottom: 12, borderBottom: i < editingOptions.length - 1 ? '1px solid #ddd' : 'none' }}>
                  <div style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: 4, minWidth: '120px' }}>
                    <label style={{ fontSize: 12, fontWeight: 'bold' }}>Grup Adı</label>
                    <input className="input" placeholder="örn: Şeker" value={opt.name} onChange={(e) => updateEditOptionGroup(i, 'name', e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 12, fontWeight: 'bold' }}>Seçim Tipi</label>
                    <select className="input" value={opt.type} onChange={(e) => updateEditOptionGroup(i, 'type', e.target.value)}>
                      <option value="single">Tekli Seçim</option>
                      <option value="multiple">Çoklu Seçim</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', flex: 2, flexDirection: 'column', gap: 4, minWidth: '200px' }}>
                    <label style={{ fontSize: 12, fontWeight: 'bold' }}>Seçenekler (Virgülle ayırın)</label>
                    <input className="input" placeholder="örn: Sade, Orta" value={opt.choices} onChange={(e) => updateEditOptionGroup(i, 'choices', e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 12, color: 'transparent' }}>Sil</label>
                    <button type="button" className="btn" style={{ background: '#dc3545', color: 'white', border: 'none' }} onClick={() => removeEditOptionGroup(i)}>Sil</button>
                  </div>
                </div>
              ))}
              {editingOptions.length === 0 && <div className="muted" style={{ fontSize: 14 }}>Bu ürüne henüz opsiyon eklenmemiş.</div>}
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button 
                type="button" 
                className="btn btn-secondary" 
                style={{ flex: 1 }}
                onClick={() => setEditingProduct(null)}
              >
                İptal
              </button>
              <button 
                type="button" 
                className="btn" 
                style={{ flex: 2, background: '#28a745', color: 'white', border: 'none' }}
                onClick={saveEditedOptions}
                disabled={loading}
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

