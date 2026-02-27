CREATE TABLE IF NOT EXISTS product_sales_view (
    product_id INTEGER PRIMARY KEY,
    total_quantity_sold INTEGER NOT NULL DEFAULT 0,
    total_revenue DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    order_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS category_metrics_view (
    category_name VARCHAR(255) PRIMARY KEY,
    total_revenue DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    total_orders INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customer_ltv_view (
    customer_id INTEGER PRIMARY KEY,
    total_spent DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    order_count INTEGER NOT NULL DEFAULT 0,
    last_order_date TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS hourly_sales_view (
    hour_timestamp TIMESTAMP PRIMARY KEY,
    total_orders INTEGER NOT NULL DEFAULT 0,
    total_revenue DECIMAL(10, 2) NOT NULL DEFAULT 0.00
);

CREATE TABLE IF NOT EXISTS processed_events (
    event_id UUID PRIMARY KEY,
    processed_at TIMESTAMP NOT NULL DEFAULT NOW()
);
