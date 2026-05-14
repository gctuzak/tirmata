import sqlite3
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from db import init_db
from db import connect as connect_db
from schemas import (
    Category,
    CategoryCreate,
    CloseOrder,
    MoveOrder,
    Order,
    OrderDetail,
    OrderItem,
    OrderItemAdd,
    OrderItemUpdate,
    Product,
    ProductCreate,
    ProductUpdate,
    Table,
    TableCreate,
    DailyReport,
    SoldItem,
)

app = FastAPI(title="Restaurant Automation (MVP)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_frontend_dist = Path(__file__).parent / "frontend" / "dist"
if _frontend_dist.exists():
    app.mount("/ui", StaticFiles(directory=_frontend_dist, html=True), name="ui")


@app.get("/")
def root() -> RedirectResponse:
    return RedirectResponse(url="/ui/")


def get_db() -> sqlite3.Connection:
    conn = connect_db()
    try:
        yield conn
    finally:
        conn.close()


@app.on_event("startup")
def _startup() -> None:
    init_db()


def _row_bool(v: object) -> bool:
    return bool(int(v)) if v is not None else False


def _get_table(conn: sqlite3.Connection, table_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT id, table_name, status FROM tables WHERE id=?", (table_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Table not found")
    return row


def _get_open_order_id(conn: sqlite3.Connection, table_id: int) -> int | None:
    row = conn.execute(
        "SELECT id FROM orders WHERE table_id=? AND status='open' ORDER BY id DESC LIMIT 1",
        (table_id,),
    ).fetchone()
    return int(row["id"]) if row is not None else None


def _recalc_total(conn: sqlite3.Connection, order_id: int) -> float:
    row = conn.execute(
        "SELECT COALESCE(SUM(unit_price * quantity), 0) AS total FROM order_items WHERE order_id=?",
        (order_id,),
    ).fetchone()
    total = float(row["total"]) if row is not None else 0.0
    conn.execute("UPDATE orders SET total_amount=? WHERE id=?", (total, order_id))
    return total


def _order_detail(conn: sqlite3.Connection, order_id: int) -> OrderDetail:
    order_row = conn.execute(
        "SELECT id, table_id, status, total_amount, payment_method, created_at FROM orders WHERE id=?",
        (order_id,),
    ).fetchone()
    if order_row is None:
        raise HTTPException(status_code=404, detail="Order not found")

    import json
    items_rows = conn.execute(
        "SELECT id, order_id, product_id, product_name, unit_price, quantity, is_prepared, prepared_at, selected_options FROM order_items WHERE order_id=? ORDER BY id",
        (order_id,),
    ).fetchall()

    items = [
        OrderItem(
            id=int(r["id"]),
            order_id=int(r["order_id"]),
            product_id=int(r["product_id"]) if r["product_id"] is not None else None,
            product_name=r["product_name"],
            unit_price=float(r["unit_price"]) if r["unit_price"] is not None else None,
            quantity=int(r["quantity"]),
            is_prepared=_row_bool(r["is_prepared"]) if "is_prepared" in r.keys() else False,
            prepared_at=r["prepared_at"],
            selected_options=r["selected_options"]
        )
        for r in items_rows
    ]

    created_at = order_row["created_at"]
    if isinstance(created_at, str):
        created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00")) if "T" in created_at else datetime.fromisoformat(created_at)

    return OrderDetail(
        id=int(order_row["id"]),
        table_id=int(order_row["table_id"]),
        status=order_row["status"],
        total_amount=float(order_row["total_amount"]),
        payment_method=order_row["payment_method"],
        created_at=created_at,
        items=items,
    )


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/categories", response_model=list[Category])
def list_categories(db: sqlite3.Connection = Depends(get_db)) -> list[Category]:
    rows = db.execute("SELECT id, name, parent_id FROM categories ORDER BY id").fetchall()
    
    # All categories by ID
    all_cats = {
        int(r["id"]): Category(
            id=int(r["id"]), 
            name=r["name"], 
            parent_id=int(r["parent_id"]) if r["parent_id"] is not None else None,
            children=[]
        ) 
        for r in rows
    }
    
    # Build tree
    root_cats = []
    for cat in all_cats.values():
        if cat.parent_id is None:
            root_cats.append(cat)
        else:
            parent = all_cats.get(cat.parent_id)
            if parent:
                parent.children.append(cat)
                
    return root_cats


@app.post("/categories", response_model=Category, status_code=201)
def create_category(payload: CategoryCreate, db: sqlite3.Connection = Depends(get_db)) -> Category:
    if payload.parent_id is not None:
        parent = db.execute("SELECT id FROM categories WHERE id=?", (payload.parent_id,)).fetchone()
        if parent is None:
            raise HTTPException(status_code=400, detail="Parent category not found")

    cur = db.execute(
        "INSERT INTO categories(name, parent_id) VALUES(?, ?)", 
        (payload.name.strip(), payload.parent_id)
    )
    db.commit()
    return Category(
        id=int(cur.lastrowid), 
        name=payload.name.strip(), 
        parent_id=payload.parent_id,
        children=[]
    )


@app.get("/products", response_model=list[Product])
def list_products(
    active_only: bool = Query(default=True),
    category_id: int | None = Query(default=None),
    db: sqlite3.Connection = Depends(get_db),
) -> list[Product]:
    where = []
    params: list[object] = []
    if active_only:
        where.append("is_active=1")
    if category_id is not None:
        where.append("category_id=?")
        params.append(category_id)
    sql = "SELECT id, category_id, name, price, is_active, options FROM products"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id"
    rows = db.execute(sql, tuple(params)).fetchall()
    
    import json
    
    return [
        Product(
            id=int(r["id"]),
            category_id=int(r["category_id"]) if r["category_id"] is not None else None,
            name=r["name"],
            price=float(r["price"]),
            is_active=_row_bool(r["is_active"]),
            options=json.loads(r["options"]) if r["options"] else []
        )
        for r in rows
    ]


@app.post("/products", response_model=Product, status_code=201)
def create_product(payload: ProductCreate, db: sqlite3.Connection = Depends(get_db)) -> Product:
    category_id = payload.category_id
    if category_id is not None:
        cat = db.execute("SELECT id FROM categories WHERE id=?", (category_id,)).fetchone()
        if cat is None:
            raise HTTPException(status_code=400, detail="Category not found")

    import json
    options_str = json.dumps(payload.options) if payload.options is not None else "[]"
    cur = db.execute(
        "INSERT INTO products(category_id, name, price, is_active, options) VALUES(?, ?, ?, ?, ?)",
        (category_id, payload.name.strip(), float(payload.price), 1 if payload.is_active else 0, options_str),
    )
    db.commit()
    return Product(
        id=int(cur.lastrowid),
        category_id=category_id,
        name=payload.name.strip(),
        price=float(payload.price),
        is_active=payload.is_active,
        options=payload.options or []
    )


@app.patch("/products/{product_id}", response_model=Product)
def update_product(product_id: int, payload: ProductUpdate, db: sqlite3.Connection = Depends(get_db)) -> Product:
    row = db.execute("SELECT id, category_id, name, price, is_active FROM products WHERE id=?", (product_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Product not found")

    updates = []
    params: list[object] = []
    if payload.category_id is not None:
        cat = db.execute("SELECT id FROM categories WHERE id=?", (payload.category_id,)).fetchone()
        if cat is None:
            raise HTTPException(status_code=400, detail="Category not found")
        updates.append("category_id=?")
        params.append(payload.category_id)
    if payload.name is not None:
        updates.append("name=?")
        params.append(payload.name.strip())
    if payload.price is not None:
        updates.append("price=?")
        params.append(float(payload.price))
    if payload.is_active is not None:
        updates.append("is_active=?")
        params.append(1 if payload.is_active else 0)

    import json
    if payload.options is not None:
        updates.append("options=?")
        params.append(json.dumps(payload.options))

    if updates:
        params.append(product_id)
        db.execute(f"UPDATE products SET {', '.join(updates)} WHERE id=?", tuple(params))
        db.commit()

    row2 = db.execute("SELECT id, category_id, name, price, is_active, options FROM products WHERE id=?", (product_id,)).fetchone()
    return Product(
        id=int(row2["id"]),
        category_id=int(row2["category_id"]) if row2["category_id"] is not None else None,
        name=row2["name"],
        price=float(row2["price"]),
        is_active=_row_bool(row2["is_active"]),
        options=json.loads(row2["options"]) if row2["options"] else []
    )


@app.get("/tables", response_model=list[Table])
def list_tables(db: sqlite3.Connection = Depends(get_db)) -> list[Table]:
    rows = db.execute("SELECT id, table_name, status FROM tables ORDER BY id").fetchall()
    return [Table(id=int(r["id"]), table_name=r["table_name"], status=r["status"]) for r in rows]


@app.post("/tables", response_model=Table, status_code=201)
def create_table(payload: TableCreate, db: sqlite3.Connection = Depends(get_db)) -> Table:
    cur = db.execute("INSERT INTO tables(table_name, status) VALUES(?, 'empty')", (payload.table_name.strip(),))
    db.commit()
    return Table(id=int(cur.lastrowid), table_name=payload.table_name.strip(), status="empty")


@app.get("/tables/{table_id}/adisyon", response_model=OrderDetail)
def get_table_adisyon(table_id: int, db: sqlite3.Connection = Depends(get_db)) -> OrderDetail:
    _get_table(db, table_id)
    order_id = _get_open_order_id(db, table_id)
    if order_id is None:
        raise HTTPException(status_code=404, detail="No open order for table")
    return _order_detail(db, order_id)


@app.post("/tables/{table_id}/items", response_model=OrderDetail, status_code=201)
def add_item_to_table_order(table_id: int, payload: OrderItemAdd, db: sqlite3.Connection = Depends(get_db)) -> OrderDetail:
    _get_table(db, table_id)
    prod = db.execute(
        "SELECT id, name, price, is_active FROM products WHERE id=?",
        (payload.product_id,),
    ).fetchone()
    if prod is None or int(prod["is_active"]) != 1:
        raise HTTPException(status_code=404, detail="Product not found")

    order_id = _get_open_order_id(db, table_id)
    if order_id is None:
        cur = db.execute("INSERT INTO orders(table_id, status, total_amount) VALUES(?, 'open', 0)", (table_id,))
        order_id = int(cur.lastrowid)
        db.execute("UPDATE tables SET status='occupied' WHERE id=?", (table_id,))

    unit_price = float(prod["price"])
    selected_options = payload.selected_options
    
    # If the item has selected_options, we should consider it as a unique entry in the cart.
    # We will match exact selected_options when grouping items.
    
    if selected_options is None:
        existing = db.execute(
            "SELECT id, quantity, product_name FROM order_items WHERE order_id=? AND product_id=? AND unit_price=? AND COALESCE(is_prepared, 0)=0 AND selected_options IS NULL LIMIT 1",
            (order_id, payload.product_id, unit_price),
        ).fetchone()
    else:
        existing = db.execute(
            "SELECT id, quantity, product_name FROM order_items WHERE order_id=? AND product_id=? AND unit_price=? AND COALESCE(is_prepared, 0)=0 AND selected_options=? LIMIT 1",
            (order_id, payload.product_id, unit_price, selected_options),
        ).fetchone()

    if existing is None:
        db.execute(
            "INSERT INTO order_items(order_id, product_id, product_name, unit_price, quantity, selected_options) VALUES(?, ?, ?, ?, ?, ?)",
            (order_id, payload.product_id, prod["name"], unit_price, int(payload.quantity), selected_options),
        )
    else:
        db.execute(
            "UPDATE order_items SET quantity=? WHERE id=?",
            (int(existing["quantity"]) + int(payload.quantity), int(existing["id"])),
        )

    total = _recalc_total(db, order_id)
    db.execute("UPDATE orders SET total_amount=? WHERE id=?", (total, order_id))
    db.commit()
    return _order_detail(db, order_id)


@app.get("/orders/{order_id}", response_model=OrderDetail)
def get_order(order_id: int, db: sqlite3.Connection = Depends(get_db)) -> OrderDetail:
    return _order_detail(db, order_id)


@app.post("/orders/{order_id}/move", response_model=Order, status_code=200)
def move_order(order_id: int, payload: MoveOrder, db: sqlite3.Connection = Depends(get_db)) -> Order:
    order = db.execute(
        "SELECT id, table_id, status, total_amount, payment_method, created_at FROM orders WHERE id=?",
        (order_id,),
    ).fetchone()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["status"] != "open":
        raise HTTPException(status_code=400, detail="Only open orders can be moved")

    old_table_id = int(order["table_id"])
    new_table = _get_table(db, payload.new_table_id)
    if new_table["status"] != "empty":
        raise HTTPException(status_code=400, detail="Target table is not empty")
    other_open = _get_open_order_id(db, int(new_table["id"]))
    if other_open is not None:
        raise HTTPException(status_code=400, detail="Target table already has an open order")

    db.execute("UPDATE orders SET table_id=? WHERE id=?", (int(new_table["id"]), order_id))
    db.execute("UPDATE tables SET status='occupied' WHERE id=?", (int(new_table["id"]),))

    still_open_old = _get_open_order_id(db, old_table_id)
    if still_open_old is None:
        db.execute("UPDATE tables SET status='empty' WHERE id=?", (old_table_id,))

    db.commit()

    order2 = db.execute(
        "SELECT id, table_id, status, total_amount, payment_method, created_at FROM orders WHERE id=?",
        (order_id,),
    ).fetchone()
    created_at = order2["created_at"]
    if isinstance(created_at, str):
        created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00")) if "T" in created_at else datetime.fromisoformat(created_at)
    return Order(
        id=int(order2["id"]),
        table_id=int(order2["table_id"]),
        status=order2["status"],
        total_amount=float(order2["total_amount"]),
        payment_method=order2["payment_method"],
        created_at=created_at,
    )


@app.post("/orders/{order_id}/close", response_model=Order, status_code=200)
def close_order(order_id: int, payload: CloseOrder, db: sqlite3.Connection = Depends(get_db)) -> Order:
    order = db.execute(
        "SELECT id, table_id, status, total_amount, payment_method, created_at FROM orders WHERE id=?",
        (order_id,),
    ).fetchone()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["status"] != "open":
        raise HTTPException(status_code=400, detail="Order already closed")

    total = _recalc_total(db, order_id)
    db.execute(
        "UPDATE orders SET status='closed', payment_method=?, total_amount=? WHERE id=?",
        (payload.payment_method, total, order_id),
    )
    db.execute("UPDATE tables SET status='empty' WHERE id=?", (int(order["table_id"]),))
    db.commit()

    order2 = db.execute(
        "SELECT id, table_id, status, total_amount, payment_method, created_at FROM orders WHERE id=?",
        (order_id,),
    ).fetchone()
    created_at = order2["created_at"]
    if isinstance(created_at, str):
        created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00")) if "T" in created_at else datetime.fromisoformat(created_at)
    return Order(
        id=int(order2["id"]),
        table_id=int(order2["table_id"]),
        status=order2["status"],
        total_amount=float(order2["total_amount"]),
        payment_method=order2["payment_method"],
        created_at=created_at,
    )

@app.post("/orders/{order_id}/print-kitchen", status_code=200)
def print_kitchen_order(order_id: int, db: sqlite3.Connection = Depends(get_db)):
    order = db.execute("SELECT id, table_id, status FROM orders WHERE id=?", (order_id,)).fetchone()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
        
    table = db.execute("SELECT table_name FROM tables WHERE id=?", (order["table_id"],)).fetchone()
    table_name = table["table_name"]
    
    # Sadece daha önce yazdırılmamış öğeleri al (is_printed = 0 veya NULL)
    items = db.execute(
        "SELECT id, product_name, quantity, selected_options FROM order_items WHERE order_id=? AND COALESCE(is_printed, 0)=0",
        (order_id,)
    ).fetchall()
    
    if not items:
        return {"status": "ok", "message": "No new items to print"}
        
    # Yazdırıldı olarak işaretle
    ids = [str(r["id"]) for r in items]
    placeholders = ",".join("?" for _ in ids)
    db.execute(f"UPDATE order_items SET is_printed=1 WHERE id IN ({placeholders})", tuple(ids))
    db.commit()
    
    # Yazıcıya gönder
    try:
        from printer import print_kitchen_receipt
        items_to_print = [
            {"quantity": r["quantity"], "product_name": r["product_name"], "selected_options": r["selected_options"]} 
            for r in items
        ]
        print_kitchen_receipt(table_name, items_to_print)
    except Exception as e:
        print(f"Print API Error: {e}")
        # Hata olsa bile API 200 dönebilir (garson ekranı kilitlenmesin diye)
    
    return {"status": "ok", "printed_count": len(items)}


@app.patch("/order-items/{item_id}", response_model=OrderDetail | None, status_code=200)
def update_order_item_quantity(
    item_id: int, payload: OrderItemUpdate, db: sqlite3.Connection = Depends(get_db)
) -> OrderDetail | None:
    item = db.execute(
        "SELECT id, order_id, quantity FROM order_items WHERE id=?",
        (item_id,),
    ).fetchone()
    if item is None:
        raise HTTPException(status_code=404, detail="Order item not found")

    order = db.execute(
        "SELECT id, table_id, status FROM orders WHERE id=?",
        (int(item["order_id"]),),
    ).fetchone()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["status"] != "open":
        raise HTTPException(status_code=400, detail="Order is not open")

    q = int(payload.quantity)
    if q <= 0:
        db.execute("DELETE FROM order_items WHERE id=?", (item_id,))
    else:
        db.execute("UPDATE order_items SET quantity=? WHERE id=?", (q, item_id))

    total = _recalc_total(db, int(order["id"]))
    remaining = db.execute(
        "SELECT COUNT(1) AS c FROM order_items WHERE order_id=?",
        (int(order["id"]),),
    ).fetchone()
    if remaining is not None and int(remaining["c"]) == 0:
        db.execute("DELETE FROM orders WHERE id=?", (int(order["id"]),))
        db.execute("UPDATE tables SET status='empty' WHERE id=?", (int(order["table_id"]),))
        db.commit()
        return None

    db.execute("UPDATE orders SET total_amount=? WHERE id=?", (total, int(order["id"])))
    db.commit()
    return _order_detail(db, int(order["id"]))


@app.post("/order-items/{item_id}/prepare", status_code=200)
def prepare_order_item(item_id: int, db: sqlite3.Connection = Depends(get_db)) -> dict:
    item = db.execute(
        "SELECT id, order_id FROM order_items WHERE id=?",
        (item_id,),
    ).fetchone()
    if item is None:
        raise HTTPException(status_code=404, detail="Order item not found")

    order = db.execute("SELECT id, status FROM orders WHERE id=?", (int(item["order_id"]),)).fetchone()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["status"] != "open":
        raise HTTPException(status_code=400, detail="Order is not open")

    db.execute(
        "UPDATE order_items SET is_prepared=1, prepared_at=CURRENT_TIMESTAMP WHERE id=?",
        (item_id,),
    )
    db.commit()
    return {"status": "ok"}


@app.get("/kitchen/open-items")
def kitchen_open_items(db: sqlite3.Connection = Depends(get_db)) -> list[dict]:
    rows = db.execute(
        """
        SELECT
            oi.id AS order_item_id,
            oi.order_id AS order_id,
            o.table_id AS table_id,
            t.table_name AS table_name,
            oi.product_name AS product_name,
            oi.quantity AS quantity,
            oi.unit_price AS unit_price,
            oi.selected_options AS selected_options,
            o.created_at AS order_created_at
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN tables t ON t.id = o.table_id
        WHERE o.status = 'open' AND COALESCE(oi.is_prepared, 0) = 0
        ORDER BY o.id DESC, oi.id ASC
        """
    ).fetchall()
    return [
        {
            "order_item_id": int(r["order_item_id"]),
            "order_id": int(r["order_id"]),
            "table_id": int(r["table_id"]),
            "table_name": r["table_name"],
            "product_name": r["product_name"],
            "quantity": int(r["quantity"]),
            "unit_price": float(r["unit_price"]) if r["unit_price"] is not None else None,
            "selected_options": r["selected_options"],
            "order_created_at": r["order_created_at"],
        }
        for r in rows
    ]

@app.get("/reports/daily", response_model=DailyReport)
def get_daily_report(date: str | None = None, db: sqlite3.Connection = Depends(get_db)) -> DailyReport:
    # If no date is provided, use today's date in local time
    if not date:
        date = datetime.now().strftime("%Y-%m-%d")
        
    # Total orders (customers/tables) and total revenue for the day
    stats = db.execute(
        "SELECT COUNT(id) as total_orders, COALESCE(SUM(total_amount), 0) as total_revenue "
        "FROM orders "
        "WHERE status = 'closed' AND date(created_at, 'localtime') = ?",
        (date,)
    ).fetchone()
    
    # Items sold on that day
    items = db.execute(
        "SELECT oi.product_name, SUM(oi.quantity) as qty, SUM(oi.unit_price * oi.quantity) as total_price "
        "FROM order_items oi "
        "JOIN orders o ON o.id = oi.order_id "
        "WHERE o.status = 'closed' AND date(o.created_at, 'localtime') = ? "
        "GROUP BY oi.product_name "
        "ORDER BY qty DESC",
        (date,)
    ).fetchall()
    
    sold_items = [
        SoldItem(
            product_name=r["product_name"],
            quantity=int(r["qty"]),
            total_price=float(r["total_price"])
        )
        for r in items
    ]
    
    return DailyReport(
        date=date,
        total_revenue=float(stats["total_revenue"]),
        total_orders=int(stats["total_orders"]),
        sold_items=sold_items
    )
