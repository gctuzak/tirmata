import { useEffect, useMemo, useState } from 'react'
import {
  createCategory,
  createProduct,
  createTable,
  createUser,
  deleteTable,
  getCategories,
  getDailyReport,
  getProducts,
  getTables,
  getUsers,
  updateTable,
  updateProduct,
  updateUser,
} from '../api.js'

function formatMoney(v) {
  const n = Number(v || 0)
  return `${n.toFixed(2)} ₺`
}

function parsePrice(v) {
  const s = String(v || '').replace(',', '.').trim()
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function formatPaymentMethod(method) {
  if (method === 'cash') return 'Nakit'
  if (method === 'card') return 'Kart'
  return 'Bilinmiyor'
}

function CategoryTreeItem({ category, selectedId, onSelect, level = 0 }) {
  const isSelected = category.id === selectedId
  return (
    <div>
      <div 
        className={`tree-node ${isSelected ? 'active' : ''}`}
        style={{ paddingLeft: `${8 + level * 16}px`, marginBottom: 2 }}
        onClick={() => onSelect(category.id)}
      >
        {category.name}
      </div>
      {category.children && category.children.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {category.children.map(child => (
            <CategoryTreeItem key={child.id} category={child} selectedId={selectedId} onSelect={onSelect} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

const roleLabels = {
  admin: 'Admin',
  waiter: 'Garson',
  cashier: 'Kasa',
  kitchen: 'Mutfak',
}

export default function Admin({ currentUser }) {
  const [tab, setTab] = useState('menu') // Changed default tab to 'menu'
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [tables, setTables] = useState([])
  const [categories, setCategories] = useState([])
  const [flatCategories, setFlatCategories] = useState([])
  const [products, setProducts] = useState([])

  const [selectedCategoryId, setSelectedCategoryId] = useState(null)
  const [users, setUsers] = useState([])

  const [newTableName, setNewTableName] = useState('')
  
  const [newCategoryName, setNewCategoryName] = useState('')

  const [newProductName, setNewProductName] = useState('')
  const [newProductPrice, setNewProductPrice] = useState('')
  const [newProductOptions, setNewProductOptions] = useState([])

  const [reportDate, setReportDate] = useState(() => {
    let today = new Date()
    const offset = today.getTimezoneOffset()
    today = new Date(today.getTime() - (offset*60*1000))
    return today.toISOString().split('T')[0]
  })
  const [dailyReport, setDailyReport] = useState(null)
  const [newUsername, setNewUsername] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [newUserRole, setNewUserRole] = useState('waiter')
  const [editingUser, setEditingUser] = useState(null)
  const [editingUserPassword, setEditingUserPassword] = useState('')

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

  const currentCategory = useMemo(() => {
    return categoryById.get(selectedCategoryId) || null
  }, [categoryById, selectedCategoryId])

  const currentSubcategories = useMemo(() => {
    if (!selectedCategoryId) return categories
    return currentCategory?.children || []
  }, [categories, currentCategory, selectedCategoryId])

  const currentProducts = useMemo(() => {
    if (!selectedCategoryId) return []
    return products.filter(p => p.category_id === selectedCategoryId)
  }, [products, selectedCategoryId])

  const adminStats = useMemo(
    () => [
      { label: 'Toplam Masa', value: tables.length },
      { label: 'Kategori', value: flatCategories.length },
      { label: 'Urun', value: products.length },
      { label: 'Kullanici', value: users.length },
    ],
    [flatCategories.length, products.length, tables.length, users.length],
  )

  async function refreshAll() {
    const [t, c, p, r, u] = await Promise.all([
      getTables(),
      getCategories(),
      getProducts({ activeOnly: false }),
      getDailyReport(reportDate),
      getUsers(),
    ])
    setTables(t)
    setCategories(c)
    setFlatCategories(flattenCategoryTree(c))
    setProducts(p)
    setDailyReport(r)
    setUsers(u)
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

  async function onRenameTable(tableId, value, currentName) {
    const nextName = value.trim()
    if (!nextName || nextName === currentName) return
    try {
      setLoading(true)
      setError('')
      await updateTable(tableId, { table_name: nextName })
      setTables(await getTables())
    } catch (e) {
      setError(e.message || 'Hata')
    } finally {
      setLoading(false)
    }
  }

  async function onDeleteTable(tableId, tableName) {
    const confirmed = window.confirm(`"${tableName}" masasini silmek istiyor musunuz?`)
    if (!confirmed) return

    try {
      setLoading(true)
      setError('')
      await deleteTable(tableId)
      setTables(await getTables())
    } catch (e) {
      setError(e.message || 'Hata')
    } finally {
      setLoading(false)
    }
  }

  async function onCreateCategory(parentId = null) {
    const name = newCategoryName.trim()
    if (!name) return
    try {
      setLoading(true)
      setError('')
      const payload = { name }
      if (parentId) {
        payload.parent_id = parentId
      }
      await createCategory(payload)
      setNewCategoryName('')
      const c = await getCategories()
      setCategories(c)
      setFlatCategories(flattenCategoryTree(c))
    } catch (e) {
      setError(e.message || 'Hata')
    } finally {
      setLoading(false)
    }
  }

  async function onCreateProduct(categoryId) {
    const name = newProductName.trim()
    const price = parsePrice(newProductPrice)
    if (!name || price == null || !categoryId) return
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

  async function onCreateUser() {
    if (!newUsername.trim() || !newUserPassword.trim()) return
    try {
      setLoading(true)
      setError('')
      await createUser({
        username: newUsername.trim(),
        password: newUserPassword,
        role: newUserRole,
        is_active: true,
      })
      setNewUsername('')
      setNewUserPassword('')
      setNewUserRole('waiter')
      setUsers(await getUsers())
    } catch (e) {
      setError(e.message || 'Hata')
    } finally {
      setLoading(false)
    }
  }

  async function onUpdateManagedUser(userId, payload) {
    try {
      setLoading(true)
      setError('')
      const updated = await updateUser(userId, payload)
      setUsers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      if (editingUser?.id === userId) {
        setEditingUser(updated)
        setEditingUserPassword('')
      }
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
          <div className="eyebrow">Kontrol Merkezi</div>
          <div className="title">Yonetim Paneli</div>
          <div className="subtitle">Masa yapisini, menuyu ve gunluk satis gorunumunu tek bir merkezden yonet.</div>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => refreshAll()}>
            Yenile
          </button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      <div className="stats-grid">
        {adminStats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className="stat-label">{stat.label}</div>
            <div className="stat-value">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="bar" style={{ marginBottom: 16 }}>
        <button className={tab === 'tables' ? 'btn btn-tab btn-tab-active' : 'btn btn-tab'} type="button" onClick={() => setTab('tables')}>
          Masalar
        </button>
        <button className={tab === 'menu' ? 'btn btn-tab btn-tab-active' : 'btn btn-tab'} type="button" onClick={() => setTab('menu')}>
          Menü Yönetimi
        </button>
        <button className={tab === 'reports' ? 'btn btn-tab btn-tab-active' : 'btn btn-tab'} type="button" onClick={() => setTab('reports')}>
          Raporlar
        </button>
        <button className={tab === 'users' ? 'btn btn-tab btn-tab-active' : 'btn btn-tab'} type="button" onClick={() => setTab('users')}>
          Kullanicilar
        </button>
      </div>

      {tab === 'tables' ? (
        <div className="panel">
          <div className="panel-title">Masa Ekle</div>
          <div className="bar">
            <input className="input" value={newTableName} onChange={(e) => setNewTableName(e.target.value)} placeholder="Masa Adı (örn: Masa 1)" />
            <button className="btn" type="button" disabled={loading} onClick={onCreateTable}>
              Ekle
            </button>
          </div>
          <div className="panel-title" style={{ marginTop: 24 }}>
            Mevcut Masalar
          </div>
          <div className="grid">
            {tables.map((t) => (
              <div key={t.id} className={t.status === 'occupied' ? 'card card-occupied' : 'card'}>
                <input
                  className="input"
                  defaultValue={t.table_name}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onRenameTable(t.id, e.currentTarget.value, t.table_name)
                  }}
                  onBlur={(e) => onRenameTable(t.id, e.currentTarget.value, t.table_name)}
                  aria-label="Masa Adi"
                />
                <div className="muted">{t.status === 'occupied' ? 'Dolu' : 'Boş'}</div>
                <div className="bar" style={{ marginTop: 12 }}>
                  <button className="btn btn-secondary" type="button" disabled>
                    {t.status === 'occupied' ? 'Dolu' : 'Hazir'}
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={loading}
                    onClick={() => onDeleteTable(t.id, t.table_name)}
                  >
                    Sil
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'menu' ? (
        <div className="split" style={{ gridTemplateColumns: '1fr 2fr', alignItems: 'start' }}>
          {/* LEFT PANE: Category Tree */}
          <div className="panel">
            <div className="panel-title">Kategoriler</div>
            <div className="list" style={{ minHeight: 200 }}>
              {categories.map(c => (
                <CategoryTreeItem key={c.id} category={c} selectedId={selectedCategoryId} onSelect={setSelectedCategoryId} />
              ))}
              {categories.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Henüz kategori yok.</div>}
            </div>
            
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>Ana Kategori Ekle</div>
              <div className="stack">
                <input className="input" value={selectedCategoryId ? '' : newCategoryName} onChange={(e) => {
                  if (selectedCategoryId) setSelectedCategoryId(null) // deselect to add root category
                  setNewCategoryName(e.target.value)
                }} placeholder="Yeni Ana Kategori" />
                <button className="btn btn-secondary" disabled={loading || selectedCategoryId !== null} onClick={() => onCreateCategory(null)}>Ekle</button>
              </div>
            </div>
          </div>

          {/* RIGHT PANE: Selected Category Details */}
          <div className="panel">
            {!selectedCategoryId ? (
              <div className="muted" style={{ textAlign: 'center', padding: 40 }}>
                Lütfen soldan düzenlemek istediğiniz kategoriyi seçin veya yeni bir ana kategori ekleyin.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div className="panel-title" style={{ margin: 0, fontSize: 20 }}>
                    Kategori: {currentCategory?.name}
                  </div>
                  <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => setSelectedCategoryId(currentCategory?.parent_id || null)}>
                    Üst Kategoriye Dön
                  </button>
                </div>
                
                {/* Subcategories */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Alt Kategoriler</div>
                  {currentSubcategories.length > 0 && (
                    <div className="grid grid-tight" style={{ marginBottom: 12 }}>
                      {currentSubcategories.map(c => (
                        <div key={c.id} className="card" style={{ cursor: 'pointer', padding: '10px' }} onClick={() => setSelectedCategoryId(c.id)}>
                          <div style={{ fontWeight: 'bold', color: '#0f172a' }}>{c.name}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="bar">
                    <input className="input" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="Yeni Alt Kategori Adı" />
                    <button className="btn btn-secondary" disabled={loading} onClick={() => onCreateCategory(selectedCategoryId)}>Ekle</button>
                  </div>
                </div>

                <hr style={{ border: 0, borderTop: '1px solid #e2e8f0', margin: '24px 0' }} />

                {/* Products */}
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: 12 }}>Ürünler</div>
                  <div className="list" style={{ marginBottom: 24 }}>
                    {currentProducts.map((p) => (
                      <div className="row" key={p.id}>
                        <div className="row-main">
                          <div className="row-title">{p.name}</div>
                          {p.options && p.options.length > 0 && (
                            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                              {p.options.length} opsiyon grubu var
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
                          <div className="muted" style={{ minWidth: 60, textAlign: 'right' }}>
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
                            Opsiyonlar
                          </button>
                        </div>
                      </div>
                    ))}
                    {currentProducts.length === 0 ? <div className="muted" style={{ fontSize: 14 }}>Bu kategoride henüz ürün yok.</div> : null}
                  </div>

                  <div style={{ padding: 16, border: '1px dashed #cbd5e1', borderRadius: 12, background: '#f8fafc' }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 12, color: '#0f172a' }}>Yeni Ürün Ekle ({currentCategory?.name})</div>
                    <div className="stack">
                      <div className="split" style={{ gap: 12 }}>
                        <input className="input" value={newProductName} onChange={(e) => setNewProductName(e.target.value)} placeholder="Ürün Adı (örn: Adana Kebap)" />
                        <input className="input" value={newProductPrice} onChange={(e) => setNewProductPrice(e.target.value)} inputMode="decimal" placeholder="Fiyat (örn: 120)" />
                      </div>
                      
                      <div style={{ marginTop: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 'bold', color: '#475569' }}>Opsiyonlar (İsteğe Bağlı)</span>
                          <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 8px' }} onClick={addOptionGroup}>+ Opsiyon Grubu Ekle</button>
                        </div>
                        
                        {newProductOptions.map((opt, i) => (
                          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <input className="input" style={{ flex: 1, minWidth: '100px', padding: '8px' }} placeholder="Grup (örn: Pişme)" value={opt.name} onChange={(e) => updateOptionGroup(i, 'name', e.target.value)} />
                            <select className="input" style={{ width: 'auto', padding: '8px' }} value={opt.type} onChange={(e) => updateOptionGroup(i, 'type', e.target.value)}>
                              <option value="single">Tekli</option>
                              <option value="multiple">Çoklu</option>
                            </select>
                            <input className="input" style={{ flex: 2, minWidth: '150px', padding: '8px' }} placeholder="Seçenekler (Az, Orta, Çok)" value={opt.choices} onChange={(e) => updateOptionGroup(i, 'choices', e.target.value)} />
                            <button type="button" className="btn" style={{ padding: '8px 12px', background: '#dc3545', color: 'white', border: 'none' }} onClick={() => removeOptionGroup(i)}>X</button>
                          </div>
                        ))}
                      </div>

                      <button className="btn" type="button" disabled={loading} onClick={() => onCreateProduct(selectedCategoryId)}>
                        Ürünü Ekle
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
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
              <div className="stats-grid" style={{ marginBottom: 24 }}>
                <div className="stat-card">
                  <div className="stat-label">Toplam Ciro</div>
                  <div className="stat-value">{formatMoney(dailyReport.total_revenue)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Kapanan Adisyon</div>
                  <div className="stat-value">{dailyReport.total_orders}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Ortalama Adisyon</div>
                  <div className="stat-value">{formatMoney(dailyReport.average_order_amount)}</div>
                </div>
              </div>

              <div className="split" style={{ alignItems: 'start' }}>
                <div className="panel">
                  <div className="panel-title" style={{ fontSize: 16, marginBottom: 8 }}>En Cok Satan Urunler</div>
                  <div className="list">
                    {dailyReport.sold_items && dailyReport.sold_items.length > 0 ? (
                      dailyReport.sold_items.slice(0, 10).map((item, idx) => (
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
                </div>

                <div className="stack">
                  <div className="panel">
                    <div className="panel-title" style={{ fontSize: 16, marginBottom: 8 }}>Ciro Liderleri</div>
                    <div className="list">
                      {dailyReport.top_products_by_revenue && dailyReport.top_products_by_revenue.length > 0 ? (
                        dailyReport.top_products_by_revenue.map((item, idx) => (
                          <div className="row row-compact" key={idx}>
                            <div className="row-main">
                              <div className="row-title">{item.product_name}</div>
                              <div className="muted">{item.quantity} adet</div>
                            </div>
                            <div style={{ fontWeight: 800, color: '#0f172a' }}>{formatMoney(item.total_price)}</div>
                          </div>
                        ))
                      ) : (
                        <div className="muted">Veri yok</div>
                      )}
                    </div>
                  </div>

                  <div className="panel">
                    <div className="panel-title" style={{ fontSize: 16, marginBottom: 8 }}>Odeme Dagilimi</div>
                    <div className="list">
                      {dailyReport.payment_breakdown && dailyReport.payment_breakdown.length > 0 ? (
                        dailyReport.payment_breakdown.map((payment) => (
                          <div className="row row-compact" key={payment.payment_method}>
                            <div className="row-main">
                              <div className="row-title">{formatPaymentMethod(payment.payment_method)}</div>
                              <div className="muted">{payment.order_count} adisyon</div>
                            </div>
                            <div style={{ fontWeight: 800, color: '#0f172a' }}>{formatMoney(payment.total_amount)}</div>
                          </div>
                        ))
                      ) : (
                        <div className="muted">Veri yok</div>
                      )}
                    </div>
                  </div>

                  <div className="panel">
                    <div className="panel-title" style={{ fontSize: 16, marginBottom: 8 }}>Degisiklik ve Iptal Ozeti</div>
                    <div className="grid grid-tight">
                      <div className="card">
                        <div className="card-title" style={{ fontSize: 14 }}>Toplam Degisiklik</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>
                          {dailyReport.change_summary?.total_change_events || 0}
                        </div>
                      </div>
                      <div className="card">
                        <div className="card-title" style={{ fontSize: 14 }}>Iptal Edilen Adet</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>
                          {dailyReport.change_summary?.cancelled_items || 0}
                        </div>
                      </div>
                      <div className="card">
                        <div className="card-title" style={{ fontSize: 14 }}>Iptal Tutar Etkisi</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>
                          {formatMoney(dailyReport.change_summary?.cancelled_value || 0)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="muted">Rapor yükleniyor...</div>
          )}
        </div>
      ) : null}

      {tab === 'users' ? (
        <div className="split" style={{ gridTemplateColumns: '1.1fr 1.4fr', alignItems: 'start' }}>
          <div className="panel">
            <div className="panel-title">Yeni Kullanici</div>
            <div className="stack">
              <input className="input" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="Kullanici adi" />
              <input className="input" type="password" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} placeholder="Sifre" />
              <select className="input" value={newUserRole} onChange={(e) => setNewUserRole(e.target.value)}>
                {Object.entries(roleLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <button className="btn" type="button" disabled={loading} onClick={onCreateUser}>
                Kullanici Ekle
              </button>
            </div>
            <div className="muted" style={{ marginTop: 12 }}>
              Sifreler basit kapali devre kullanim mantigiyla tutulur. Ilk varsayilan admin: admin / 1234
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">Kullanici Listesi</div>
            <div className="list">
              {users.map((user) => (
                <div className="row" key={user.id}>
                  <div className="row-main">
                    <div className="row-title">{user.username}</div>
                    <div className="muted">
                      {roleLabels[user.role] || user.role} • {user.is_active ? 'Aktif' : 'Pasif'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <select
                      className="input"
                      style={{ width: 130, minHeight: 42 }}
                      value={user.role}
                      onChange={(e) => onUpdateManagedUser(user.id, { role: e.target.value })}
                      disabled={loading}
                    >
                      {Object.entries(roleLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <button
                      className={user.is_active ? 'btn btn-secondary' : 'btn'}
                      type="button"
                      disabled={loading || user.id === currentUser?.id}
                      onClick={() => onUpdateManagedUser(user.id, { is_active: !user.is_active })}
                    >
                      {user.is_active ? 'Pasif Yap' : 'Aktif Yap'}
                    </button>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={() => {
                        setEditingUser(user)
                        setEditingUserPassword('')
                      }}
                    >
                      Sifre
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Edit Options Modal */}
      {editingProduct && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2 className="modal-title">Opsiyonlari Duzenle: {editingProduct.name}</h2>
            <div className="modal-subtitle">Mevcut opsiyonlari silebilir, degistirebilir veya yeni ekleyebilirsiniz.</div>
            
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

            <div className="modal-actions">
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

      {editingUser && (
        <div className="modal-backdrop">
          <div className="modal-card modal-sm">
            <h2 className="modal-title">Sifre Guncelle: {editingUser.username}</h2>
            <div className="modal-subtitle">Bu kullanici icin yeni sifre belirleyin.</div>
            <div className="stack">
              <input
                className="input"
                type="password"
                placeholder="Yeni sifre"
                value={editingUserPassword}
                onChange={(e) => setEditingUserPassword(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setEditingUser(null)}>
                Iptal
              </button>
              <button
                type="button"
                className="btn"
                style={{ flex: 2 }}
                disabled={loading || editingUserPassword.trim().length < 3}
                onClick={async () => {
                  await onUpdateManagedUser(editingUser.id, { password: editingUserPassword.trim() })
                  setEditingUser(null)
                  setEditingUserPassword('')
                }}
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
