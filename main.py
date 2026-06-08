import sqlite3
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from db import init_db
from db import connect as connect_db
from schemas import (
    AuthResponse,
    Category,
    CategoryCreate,
    CloseOrder,
    DailyReport,
    ChangeSummary,
    MoveOrder,
    Order,
    OrderChangeLog,
    OrderDetail,
    OrderItem,
    OrderItemAdd,
    OrderItemUpdate,
    PaymentSummary,
    Product,
    ProductCreate,
    ProductUpdate,
    SoldItem,
    LoginRequest,
    Table,
    TableCreate,
    TableUpdate,
    User,
    UserCreate,
    UserUpdate,
)


def _normalize_selected_options(selected_options: str | None) -> str | None:
    if selected_options is None:
        return None

    groups: list[str] = []
    for raw_group in selected_options.split("|"):
        group = raw_group.strip()
        if not group:
            continue

        if ":" not in group:
            groups.append(group)
            continue

        group_name, raw_values = group.split(":", 1)
        values = [value.strip() for value in raw_values.split(",") if value.strip()]
        if values:
            values = sorted(dict.fromkeys(values), key=str.casefold)
            groups.append(f"{group_name.strip()}: {', '.join(values)}")
        else:
            groups.append(group_name.strip())

    return " | ".join(groups) if groups else None


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


def _to_datetime(value: object) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00")) if "T" in value else datetime.fromisoformat(value)
    raise HTTPException(status_code=500, detail="Invalid datetime value")


def _user_from_row(row: sqlite3.Row) -> User:
    return User(
        id=int(row["id"]),
        username=row["username"],
        role=row["role"],
        is_active=_row_bool(row["is_active"]),
        created_at=_to_datetime(row["created_at"]),
    )


def _extract_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Oturum gerekli")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Gecersiz oturum")
    return token.strip()


def get_current_user(
    authorization: str | None = Header(default=None),
    db: sqlite3.Connection = Depends(get_db),
) -> User:
    token = _extract_bearer_token(authorization)
    row = db.execute(
        """
        SELECT u.id, u.username, u.role, u.is_active, u.created_at
        FROM user_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ?
        """,
        (token,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="Oturum bulunamadi")
    if not _row_bool(row["is_active"]):
        raise HTTPException(status_code=403, detail="Kullanici pasif")
    return _user_from_row(row)


def require_roles(*roles: str):
    def dependency(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role != "admin" and current_user.role not in roles:
            raise HTTPException(status_code=403, detail="Bu ekrana yetkiniz yok")
        return current_user

    return dependency


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


def _order_change_logs(conn: sqlite3.Connection, order_id: int) -> list[OrderChangeLog]:
    rows = conn.execute(
        """
        SELECT
            id,
            order_id,
            order_item_id,
            action,
            product_name,
            quantity,
            unit_price,
            selected_options,
            reason,
            note,
            changed_by_username,
            created_at
        FROM order_change_logs
        WHERE order_id=?
        ORDER BY id DESC
        """,
        (order_id,),
    ).fetchall()
    return [
        OrderChangeLog(
            id=int(r["id"]),
            order_id=int(r["order_id"]),
            order_item_id=int(r["order_item_id"]) if r["order_item_id"] is not None else None,
            action=r["action"],
            product_name=r["product_name"],
            quantity=int(r["quantity"]),
            unit_price=float(r["unit_price"]) if r["unit_price"] is not None else None,
            selected_options=r["selected_options"],
            reason=r["reason"],
            note=r["note"],
            changed_by_username=r["changed_by_username"],
            created_at=_to_datetime(r["created_at"]),
        )
        for r in rows
    ]


def _log_order_change(
    conn: sqlite3.Connection,
    *,
    order_id: int,
    order_item_id: int | None,
    action: str,
    product_name: str,
    quantity: int,
    unit_price: float | None,
    selected_options: str | None,
    reason: str | None,
    note: str,
    current_user: User,
) -> None:
    conn.execute(
        """
        INSERT INTO order_change_logs(
            order_id,
            order_item_id,
            action,
            product_name,
            quantity,
            unit_price,
            selected_options,
            reason,
            note,
            changed_by_user_id,
            changed_by_username
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            order_id,
            order_item_id,
            action,
            product_name,
            quantity,
            unit_price,
            selected_options,
            reason,
            note,
            current_user.id,
            current_user.username,
        ),
    )


def _order_detail(conn: sqlite3.Connection, order_id: int) -> OrderDetail:
    order_row = conn.execute(
        "SELECT id, table_id, status, total_amount, payment_method, created_at FROM orders WHERE id=?",
        (order_id,),
    ).fetchone()
    if order_row is None:
        raise HTTPException(status_code=404, detail="Order not found")

    import json
    items_rows = conn.execute(
        "SELECT id, order_id, product_id, product_name, unit_price, quantity, is_prepared, is_printed, prepared_at, selected_options FROM order_items WHERE order_id=? ORDER BY id",
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
            is_printed=_row_bool(r["is_printed"]) if "is_printed" in r.keys() else False,
            prepared_at=r["prepared_at"],
            selected_options=r["selected_options"]
        )
        for r in items_rows
    ]
    change_logs = _order_change_logs(conn, order_id)

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
        change_logs=change_logs,
        has_changes=len(change_logs) > 0,
    )


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: sqlite3.Connection = Depends(get_db)) -> AuthResponse:
    row = db.execute(
        "SELECT id, username, password, role, is_active, created_at FROM users WHERE lower(username)=lower(?)",
        (payload.username.strip(),),
    ).fetchone()
    if row is None or row["password"] != payload.password:
        raise HTTPException(status_code=401, detail="Kullanici adi veya sifre hatali")
    if not _row_bool(row["is_active"]):
        raise HTTPException(status_code=403, detail="Kullanici pasif")

    db.execute("DELETE FROM user_sessions WHERE user_id=?", (int(row["id"]),))
    token = uuid4().hex
    db.execute("INSERT INTO user_sessions(token, user_id) VALUES(?, ?)", (token, int(row["id"])))
    db.commit()
    return AuthResponse(token=token, user=_user_from_row(row))


@app.get("/auth/me", response_model=User)
def auth_me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@app.post("/auth/logout", status_code=200)
def logout(
    authorization: str | None = Header(default=None),
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    token = _extract_bearer_token(authorization)
    db.execute("DELETE FROM user_sessions WHERE token=?", (token,))
    db.commit()
    return {"status": "ok"}


@app.get("/users", response_model=list[User])
def list_users(
    db: sqlite3.Connection = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> list[User]:
    rows = db.execute(
        "SELECT id, username, role, is_active, created_at FROM users ORDER BY username COLLATE NOCASE"
    ).fetchall()
    return [_user_from_row(row) for row in rows]


@app.post("/users", response_model=User, status_code=201)
def create_user(
    payload: UserCreate,
    db: sqlite3.Connection = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> User:
    try:
        cur = db.execute(
            "INSERT INTO users(username, password, role, is_active) VALUES(?, ?, ?, ?)",
            (payload.username.strip(), payload.password, payload.role, 1 if payload.is_active else 0),
        )
        db.commit()
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=400, detail="Bu kullanici adi zaten var") from exc

    row = db.execute(
        "SELECT id, username, role, is_active, created_at FROM users WHERE id=?",
        (int(cur.lastrowid),),
    ).fetchone()
    return _user_from_row(row)


@app.patch("/users/{user_id}", response_model=User)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: sqlite3.Connection = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
) -> User:
    row = db.execute(
        "SELECT id, username, password, role, is_active, created_at FROM users WHERE id=?",
        (user_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Kullanici bulunamadi")

    updates = []
    params: list[object] = []
    if payload.username is not None:
        updates.append("username=?")
        params.append(payload.username.strip())
    if payload.password is not None:
        updates.append("password=?")
        params.append(payload.password)
    if payload.role is not None:
        if int(row["id"]) == current_user.id and payload.role != "admin":
            raise HTTPException(status_code=400, detail="Kendi kullanicinizi admin disina alamazsiniz")
        updates.append("role=?")
        params.append(payload.role)
    if payload.is_active is not None:
        if int(row["id"]) == current_user.id and not payload.is_active:
            raise HTTPException(status_code=400, detail="Kendi kullanicinizi pasif yapamazsiniz")
        updates.append("is_active=?")
        params.append(1 if payload.is_active else 0)

    if updates:
        try:
            params.append(user_id)
            db.execute(f"UPDATE users SET {', '.join(updates)} WHERE id=?", tuple(params))
            if payload.is_active is False:
                db.execute("DELETE FROM user_sessions WHERE user_id=?", (user_id,))
            db.commit()
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=400, detail="Bu kullanici adi zaten var") from exc

    updated = db.execute(
        "SELECT id, username, role, is_active, created_at FROM users WHERE id=?",
        (user_id,),
    ).fetchone()
    return _user_from_row(updated)


@app.get("/categories", response_model=list[Category])
def list_categories(
    db: sqlite3.Connection = Depends(get_db),
    _: User = Depends(require_roles("waiter", "cashier", "admin")),
) -> list[Category]:
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
def create_category(
    payload: CategoryCreate,
    db: sqlite3.Connection = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> Category:
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
    _: User = Depends(require_roles("waiter", "admin")),
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
def create_product(
    payload: ProductCreate,
    db: sqlite3.Connection = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> Product:
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
def update_product(
    product_id: int,
    payload: ProductUpdate,
    db: sqlite3.Connection = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> Product:
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
def list_tables(
    db: sqlite3.Connection = Depends(get_db),
    _: User = Depends(require_roles("waiter", "cashier", "admin")),
) -> list[Table]:
    rows = db.execute("SELECT id, table_name, status FROM tables ORDER BY id").fetchall()
    return [Table(id=int(r["id"]), table_name=r["table_name"], status=r["status"]) for r in rows]


@app.post("/tables", response_model=Table, status_code=201)
def create_table(
    payload: TableCreate,
    db: sqlite3.Connection = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> Table:
    table_name = payload.table_name.strip()
    duplicate = db.execute(
        "SELECT id FROM tables WHERE lower(table_name)=lower(?)",
        (table_name,),
    ).fetchone()
    if duplicate is not None:
        raise HTTPException(status_code=400, detail="Bu masa adi zaten kullanimda")

    cur = db.execute("INSERT INTO tables(table_name, status) VALUES(?, 'empty')", (table_name,))
    db.commit()
    return Table(id=int(cur.lastrowid), table_name=table_name, status="empty")


@app.patch("/tables/{table_id}", response_model=Table)
def update_table(
    table_id: int,
    payload: TableUpdate,
    db: sqlite3.Connection = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> Table:
    row = _get_table(db, table_id)
    table_name = payload.table_name.strip()
    duplicate = db.execute(
        "SELECT id FROM tables WHERE lower(table_name)=lower(?) AND id<>?",
        (table_name, table_id),
    ).fetchone()
    if duplicate is not None:
        raise HTTPException(status_code=400, detail="Bu masa adi zaten kullanimda")

    db.execute("UPDATE tables SET table_name=? WHERE id=?", (table_name, table_id))
    db.commit()
    return Table(id=int(row["id"]), table_name=table_name, status=row["status"])


@app.delete("/tables/{table_id}", status_code=200)
def delete_table(
    table_id: int,
    db: sqlite3.Connection = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> dict:
    row = _get_table(db, table_id)
    if row["status"] != "empty":
        raise HTTPException(status_code=400, detail="Dolu masa silinemez")

    history = db.execute("SELECT COUNT(1) AS c FROM orders WHERE table_id=?", (table_id,)).fetchone()
    if history is not None and int(history["c"]) > 0:
        raise HTTPException(status_code=400, detail="Siparis gecmisi olan masa silinemez")

    db.execute("DELETE FROM tables WHERE id=?", (table_id,))
    db.commit()
    return {"status": "ok"}


@app.get("/tables/{table_id}/adisyon", response_model=OrderDetail)
def get_table_adisyon(
    table_id: int,
    db: sqlite3.Connection = Depends(get_db),
    _: User = Depends(require_roles("waiter", "cashier", "admin")),
) -> OrderDetail:
    _get_table(db, table_id)
    order_id = _get_open_order_id(db, table_id)
    if order_id is None:
        raise HTTPException(status_code=404, detail="No open order for table")
    return _order_detail(db, order_id)


@app.post("/tables/{table_id}/items", response_model=OrderDetail, status_code=201)
def add_item_to_table_order(
    table_id: int,
    payload: OrderItemAdd,
    db: sqlite3.Connection = Depends(get_db),
    _: User = Depends(require_roles("waiter", "admin")),
) -> OrderDetail:
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
    selected_options = _normalize_selected_options(payload.selected_options)
    
    # If the item has selected_options, we should consider it as a unique entry in the cart.
    # We will match exact selected_options when grouping items.
    
    if selected_options is None:
        existing = db.execute(
            "SELECT id, quantity, product_name FROM order_items WHERE order_id=? AND product_id=? AND unit_price=? AND COALESCE(is_prepared, 0)=0 AND COALESCE(is_printed, 0)=0 AND selected_options IS NULL LIMIT 1",
            (order_id, payload.product_id, unit_price),
        ).fetchone()
    else:
        existing = db.execute(
            "SELECT id, quantity, product_name FROM order_items WHERE order_id=? AND product_id=? AND unit_price=? AND COALESCE(is_prepared, 0)=0 AND COALESCE(is_printed, 0)=0 AND selected_options=? LIMIT 1",
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
def get_order(
    order_id: int,
    db: sqlite3.Connection = Depends(get_db),
    _: User = Depends(require_roles("waiter", "cashier", "admin")),
) -> OrderDetail:
    return _order_detail(db, order_id)


@app.post("/orders/{order_id}/move", response_model=Order, status_code=200)
def move_order(
    order_id: int,
    payload: MoveOrder,
    db: sqlite3.Connection = Depends(get_db),
    _: User = Depends(require_roles("waiter", "admin")),
) -> Order:
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
def close_order(
    order_id: int,
    payload: CloseOrder,
    db: sqlite3.Connection = Depends(get_db),
    _: User = Depends(require_roles("cashier", "admin")),
) -> Order:
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
        "UPDATE orders SET status='closed', payment_method=?, total_amount=?, closed_at=CURRENT_TIMESTAMP WHERE id=?",
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
def print_kitchen_order(
    order_id: int,
    db: sqlite3.Connection = Depends(get_db),
    _: User = Depends(require_roles("waiter", "admin")),
):
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
        
    try:
        from printer import print_kitchen_receipt
        items_to_print = [
            {"quantity": r["quantity"], "product_name": r["product_name"], "selected_options": r["selected_options"]} 
            for r in items
        ]
        print_kitchen_receipt(table_name, items_to_print)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    ids = [str(r["id"]) for r in items]
    placeholders = ",".join("?" for _ in ids)
    db.execute(f"UPDATE order_items SET is_printed=1 WHERE id IN ({placeholders})", tuple(ids))
    db.commit()
    
    return {"status": "ok", "printed_count": len(items)}


@app.patch("/order-items/{item_id}", response_model=OrderDetail | None, status_code=200)
def update_order_item_quantity(
    item_id: int,
    payload: OrderItemUpdate,
    db: sqlite3.Connection = Depends(get_db),
    current_user: User = Depends(require_roles("waiter", "admin")),
) -> OrderDetail | None:
    item = db.execute(
        """
        SELECT
            id,
            order_id,
            product_id,
            product_name,
            unit_price,
            quantity,
            selected_options,
            COALESCE(is_printed, 0) AS is_printed
        FROM order_items
        WHERE id=?
        """,
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
    current_quantity = int(item["quantity"])
    was_printed = _row_bool(item["is_printed"])
    change_reason = payload.change_reason.strip() if payload.change_reason else None

    if q == current_quantity:
        return _order_detail(db, int(order["id"]))

    if was_printed and q < current_quantity and not change_reason:
        raise HTTPException(status_code=400, detail="Basili kalemlerde azaltma veya silme icin sebep secilmelidir")

    if was_printed and q > current_quantity:
        additional_qty = q - current_quantity
        db.execute(
            """
            INSERT INTO order_items(
                order_id,
                product_id,
                product_name,
                unit_price,
                quantity,
                selected_options,
                is_printed,
                is_prepared
            ) VALUES(?, ?, ?, ?, ?, ?, 0, 0)
            """,
            (
                int(item["order_id"]),
                int(item["product_id"]) if item["product_id"] is not None else None,
                item["product_name"],
                float(item["unit_price"]) if item["unit_price"] is not None else None,
                additional_qty,
                item["selected_options"],
            ),
        )
        _log_order_change(
            db,
            order_id=int(item["order_id"]),
            order_item_id=int(item["id"]),
            action="added",
            product_name=item["product_name"],
            quantity=additional_qty,
            unit_price=float(item["unit_price"]) if item["unit_price"] is not None else None,
            selected_options=item["selected_options"],
            reason=None,
            note="Basili siparise ek adet eklendi. Yeni miktar tekrar mutfaga gonderilecek.",
            current_user=current_user,
        )
    elif q <= 0:
        if was_printed:
            _log_order_change(
                db,
                order_id=int(item["order_id"]),
                order_item_id=None,
                action="cancelled",
                product_name=item["product_name"],
                quantity=current_quantity,
                unit_price=float(item["unit_price"]) if item["unit_price"] is not None else None,
                selected_options=item["selected_options"],
                reason=change_reason,
                note="Basili siparis tamamen iptal edildi.",
                current_user=current_user,
            )
        db.execute("DELETE FROM order_items WHERE id=?", (item_id,))
    else:
        if was_printed and q < current_quantity:
            cancelled_qty = current_quantity - q
            _log_order_change(
                db,
                order_id=int(item["order_id"]),
                order_item_id=int(item["id"]),
                action="cancelled",
                product_name=item["product_name"],
                quantity=cancelled_qty,
                unit_price=float(item["unit_price"]) if item["unit_price"] is not None else None,
                selected_options=item["selected_options"],
                reason=change_reason,
                note="Basili sipariste miktar azaltildi.",
                current_user=current_user,
            )
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
def prepare_order_item(
    item_id: int,
    db: sqlite3.Connection = Depends(get_db),
    _: User = Depends(require_roles("kitchen", "admin")),
) -> dict:
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
def kitchen_open_items(
    db: sqlite3.Connection = Depends(get_db),
    _: User = Depends(require_roles("kitchen", "admin")),
) -> list[dict]:
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
        WHERE o.status = 'open' AND COALESCE(oi.is_prepared, 0) = 0 AND COALESCE(oi.is_printed, 0) = 1
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
def get_daily_report(
    date: str | None = None,
    db: sqlite3.Connection = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> DailyReport:
    if not date:
        date = datetime.now().strftime("%Y-%m-%d")

    stats = db.execute(
        "SELECT COUNT(id) as total_orders, COALESCE(SUM(total_amount), 0) as total_revenue "
        "FROM orders "
        "WHERE status = 'closed' AND date(COALESCE(closed_at, created_at), 'localtime') = ?",
        (date,)
    ).fetchone()

    items = db.execute(
        "SELECT oi.product_name, SUM(oi.quantity) as qty, SUM(oi.unit_price * oi.quantity) as total_price "
        "FROM order_items oi "
        "JOIN orders o ON o.id = oi.order_id "
        "WHERE o.status = 'closed' AND date(COALESCE(o.closed_at, o.created_at), 'localtime') = ? "
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

    top_revenue_rows = db.execute(
        "SELECT oi.product_name, SUM(oi.quantity) as qty, SUM(oi.unit_price * oi.quantity) as total_price "
        "FROM order_items oi "
        "JOIN orders o ON o.id = oi.order_id "
        "WHERE o.status = 'closed' AND date(COALESCE(o.closed_at, o.created_at), 'localtime') = ? "
        "GROUP BY oi.product_name "
        "ORDER BY total_price DESC, qty DESC "
        "LIMIT 5",
        (date,),
    ).fetchall()

    top_products_by_revenue = [
        SoldItem(
            product_name=r["product_name"],
            quantity=int(r["qty"]),
            total_price=float(r["total_price"]),
        )
        for r in top_revenue_rows
    ]

    payment_rows = db.execute(
        "SELECT COALESCE(payment_method, 'unknown') AS payment_method, COUNT(id) AS order_count, "
        "COALESCE(SUM(total_amount), 0) AS total_amount "
        "FROM orders "
        "WHERE status = 'closed' AND date(COALESCE(closed_at, created_at), 'localtime') = ? "
        "GROUP BY COALESCE(payment_method, 'unknown') "
        "ORDER BY total_amount DESC",
        (date,),
    ).fetchall()

    payment_breakdown = [
        PaymentSummary(
            payment_method=r["payment_method"],
            total_amount=float(r["total_amount"]),
            order_count=int(r["order_count"]),
        )
        for r in payment_rows
    ]

    change_stats = db.execute(
        "SELECT "
        "COUNT(id) AS total_change_events, "
        "COALESCE(SUM(CASE WHEN action='cancelled' THEN quantity ELSE 0 END), 0) AS cancelled_items, "
        "COALESCE(SUM(CASE WHEN action='cancelled' THEN quantity * COALESCE(unit_price, 0) ELSE 0 END), 0) AS cancelled_value "
        "FROM order_change_logs "
        "WHERE date(created_at, 'localtime') = ?",
        (date,),
    ).fetchone()

    total_orders = int(stats["total_orders"])
    total_revenue = float(stats["total_revenue"])
    average_order_amount = total_revenue / total_orders if total_orders > 0 else 0.0

    return DailyReport(
        date=date,
        total_revenue=total_revenue,
        total_orders=total_orders,
        average_order_amount=average_order_amount,
        sold_items=sold_items,
        top_products_by_revenue=top_products_by_revenue,
        payment_breakdown=payment_breakdown,
        change_summary=ChangeSummary(
            total_change_events=int(change_stats["total_change_events"]),
            cancelled_items=int(change_stats["cancelled_items"]),
            cancelled_value=float(change_stats["cancelled_value"]),
        ),
    )
