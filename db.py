import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("RESTAURANT_DB_PATH", "restaurant.db"))


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

CREATE INDEX IF NOT EXISTS idx_orders_table_status ON orders(table_id, status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
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
        conn.commit()
    finally:
        conn.close()
