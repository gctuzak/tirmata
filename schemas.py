from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

RoleName = Literal["admin", "waiter", "cashier", "kitchen"]


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1)
    parent_id: int | None = None


class Category(CategoryCreate):
    id: int
    children: list["Category"] = []


Category.update_forward_refs()


class ProductCreate(BaseModel):
    category_id: int | None = None
    name: str = Field(min_length=1)
    price: float = Field(gt=0)
    is_active: bool = True
    options: list[dict] | None = None


class ProductUpdate(BaseModel):
    category_id: int | None = None
    name: str | None = None
    price: float | None = Field(default=None, gt=0)
    is_active: bool | None = None
    options: list[dict] | None = None


class Product(BaseModel):
    id: int
    category_id: int | None = None
    name: str
    price: float
    is_active: bool
    options: list[dict] | None = None


class TableCreate(BaseModel):
    table_name: str = Field(min_length=1)


class TableUpdate(BaseModel):
    table_name: str = Field(min_length=1)


class Table(BaseModel):
    id: int
    table_name: str
    status: str


class OrderItemAdd(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)
    selected_options: str | None = None


class OrderItem(BaseModel):
    id: int
    order_id: int
    product_id: int | None = None
    product_name: str | None = None
    unit_price: float | None = None
    quantity: int
    is_prepared: bool = False
    is_printed: bool = False
    prepared_at: datetime | None = None
    selected_options: str | None = None


class OrderItemUpdate(BaseModel):
    quantity: int = Field(ge=0)
    change_reason: str | None = Field(default=None, min_length=2)


class Order(BaseModel):
    id: int
    table_id: int
    status: str
    total_amount: float
    payment_method: Literal["cash", "card"] | None = None
    created_at: datetime


class OrderChangeLog(BaseModel):
    id: int
    order_id: int
    order_item_id: int | None = None
    action: Literal["cancelled", "added"]
    product_name: str
    quantity: int
    unit_price: float | None = None
    selected_options: str | None = None
    reason: str | None = None
    note: str
    changed_by_username: str | None = None
    created_at: datetime


class OrderDetail(Order):
    items: list[OrderItem]
    change_logs: list[OrderChangeLog] = []
    has_changes: bool = False


class MoveOrder(BaseModel):
    new_table_id: int


class CloseOrder(BaseModel):
    payment_method: Literal["cash", "card"]


class SoldItem(BaseModel):
    product_name: str
    quantity: int
    total_price: float


class PaymentSummary(BaseModel):
    payment_method: str
    total_amount: float
    order_count: int


class ChangeSummary(BaseModel):
    total_change_events: int
    cancelled_items: int
    cancelled_value: float


class DailyReport(BaseModel):
    date: str
    total_revenue: float
    total_orders: int
    average_order_amount: float
    sold_items: list[SoldItem]
    top_products_by_revenue: list[SoldItem]
    payment_breakdown: list[PaymentSummary]
    change_summary: ChangeSummary


class UserBase(BaseModel):
    username: str = Field(min_length=3)
    role: RoleName
    is_active: bool = True


class UserCreate(UserBase):
    password: str = Field(min_length=3)


class UserUpdate(BaseModel):
    username: str | None = Field(default=None, min_length=3)
    password: str | None = Field(default=None, min_length=3)
    role: RoleName | None = None
    is_active: bool | None = None


class User(UserBase):
    id: int
    created_at: datetime


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class AuthResponse(BaseModel):
    token: str
    user: User
