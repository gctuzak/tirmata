import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("RESTAURANT_DB_PATH", "restaurant.db"))
DEFAULT_ADMIN_USERNAME = os.environ.get("TIRMATA_DEFAULT_ADMIN_USERNAME", "admin")
DEFAULT_ADMIN_PASSWORD = os.environ.get("TIRMATA_DEFAULT_ADMIN_PASSWORD", "1234")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA busy_timeout=30000;")
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER,
    FOREIGN KEY(parent_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    is_active INTEGER DEFAULT 1,
    options TEXT, -- JSON array of option groups
    FOREIGN KEY(category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    status TEXT DEFAULT 'empty'
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER,
    status TEXT DEFAULT 'open',
    total_amount REAL DEFAULT 0,
    payment_method TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP,
    FOREIGN KEY(table_id) REFERENCES tables(id)
);

CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    product_id INTEGER,
    product_name TEXT,
    unit_price REAL,
    quantity INTEGER,
    is_prepared INTEGER DEFAULT 0,
    prepared_at TIMESTAMP,
    selected_options TEXT, -- JSON or comma separated string of chosen options
    is_printed INTEGER DEFAULT 0, -- Kitchen printer status
    FOREIGN KEY(order_id) REFERENCES orders(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_change_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    order_item_id INTEGER,
    action TEXT NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL,
    selected_options TEXT,
    reason TEXT,
    note TEXT NOT NULL,
    changed_by_user_id INTEGER,
    changed_by_username TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY(order_item_id) REFERENCES order_items(id),
    FOREIGN KEY(changed_by_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_orders_table_status ON orders(table_id, status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_order_change_logs_order_id ON order_change_logs(order_id);
"""


def init_db() -> None:
    conn = connect()
    try:
        conn.executescript(SCHEMA_SQL)
        
        # Category table migration for parent_id
        cat_cols = {r["name"] for r in conn.execute("PRAGMA table_info(categories)").fetchall()}
        if "parent_id" not in cat_cols:
            conn.execute("ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id)")
            
        # Product table migration for options
        prod_cols = {r["name"] for r in conn.execute("PRAGMA table_info(products)").fetchall()}
        if "options" not in prod_cols:
            conn.execute("ALTER TABLE products ADD COLUMN options TEXT")
            
        # Order items table migration
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(order_items)").fetchall()}
        if "is_prepared" not in cols:
            conn.execute("ALTER TABLE order_items ADD COLUMN is_prepared INTEGER DEFAULT 0")
        if "prepared_at" not in cols:
            conn.execute("ALTER TABLE order_items ADD COLUMN prepared_at TIMESTAMP")
        if "selected_options" not in cols:
            conn.execute("ALTER TABLE order_items ADD COLUMN selected_options TEXT")
        if "is_printed" not in cols:
            conn.execute("ALTER TABLE order_items ADD COLUMN is_printed INTEGER DEFAULT 0")

        order_cols = {r["name"] for r in conn.execute("PRAGMA table_info(orders)").fetchall()}
        if "closed_at" not in order_cols:
            conn.execute("ALTER TABLE orders ADD COLUMN closed_at TIMESTAMP")

        conn.execute(
            "UPDATE orders SET closed_at = created_at WHERE status = 'closed' AND closed_at IS NULL"
        )

        user_cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "is_active" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1")

        change_log_cols = {r["name"] for r in conn.execute("PRAGMA table_info(order_change_logs)").fetchall()}
        if "reason" not in change_log_cols:
            conn.execute("ALTER TABLE order_change_logs ADD COLUMN reason TEXT")

        user_count = conn.execute("SELECT COUNT(1) AS c FROM users").fetchone()
        if user_count is not None and int(user_count["c"]) == 0:
            conn.execute(
                "INSERT INTO users(username, password, role, is_active) VALUES(?, ?, 'admin', 1)",
                (DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD),
            )
        conn.commit()
    finally:
        conn.close()
