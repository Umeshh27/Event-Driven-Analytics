# Event-Driven Analytics System (CQRS & EDA)

Welcome to the Event-Driven Analytics System! This sophisticated backend project showcases a decoupled microservices architecture designed to handle e-commerce operations at scale using the **CQRS** (Command Query Responsibility Segregation) pattern seamlessly integrated with an **Event-Driven Architecture (EDA)**.

## 🚀 Project Overview

In traditional CRUD systems, scaling read-heavy query endpoints often conflicts with the transactional integrity requirements of write-heavy operations. This project solves that bottleneck by fundamentally separating them:

- **Write Model (Command Service):** Exclusively handles high-throughput creations (products, orders) using a perfectly normalized PostgreSQL schema.
- **Read Model (Query Service):** Exclusively serves instantaneous analytical aggregations using denormalized PostgreSQL Materialized Views.
- **Event Bus (RabbitMQ & Consumer Service):** Bridges the gap by robustly processing domain events and synchronizing the read views in the background.

![Architecture Flow](docs/data-flow.png)

## 🏗️ Architecture & Core Components

This stack revolves around five deeply connected yet autonomous services encapsulated in Docker:

### 1. Command Service (Port: 8080)

- **Framework & Language:** Node.js / Express
- **Responsibilities:** Point of entry for `Products` and `Orders`. Enforces database constraints (e.g., sufficient stock reduction).
- **Transactional Outbox Pattern**: Directly integrated into the Postgres transaction lifecycle. If an order succeeds, an `OrderCreated` domain event is atomic-inserted into the `outbox` table.
- **Outbox Publisher Process**: A lightweight internal polling daemon (via Postgres `SKIP LOCKED`) sweeps the `outbox` table securely and pushes events into RabbitMQ, preventing "dual-write" failure loops.

### 2. Consumer Service

- **Framework & Language:** Node.js / AMQPLib
- **Responsibilities:** Silently consumes events off the RabbitMQ `order-events` queue.
- **Idempotent Guaranteed Processing:** Dynamically generates a cryptographic payload hash matching it against a `processed_events` table before applying updates. This natively solves RabbitMQ’s inherent "at-least-once-delivery" edge-cases (message duplication).
- **View Aggregation:** Runs precise `ON CONFLICT DO UPDATE` commands to synchronize 4 analytical Materialized Views: `hourly_sales_view`, `category_metrics_view`, `product_sales_view`, and `customer_ltv_view`.

### 3. Query Service (Port: 8081)

- **Framework & Language:** Node.js / Express
- **Responsibilities:** Returns high-speed, table-scanned analytics results bypassing raw JOIN overheads.
- **Observability:** Hosts a dedicated `sync-status` API which computes literal eventual consistency lag by determining the difference between the most recently consumed event timestamp and actual chronological time.

### 4. Database Infrastructure

- **Write Database:** Postgres 14 (Normalized: `products`, `orders`, `order_items`, `outbox`)
- **Read Database:** Postgres 14 (Denormalized Materialized Event Views)

### 5. Message Broker

- **RabbitMQ:** Standard AMQP 0-9-1 implementation orchestrating `product-events` and `order-events` durable queues.

---

## ⚙️ Setup and Installation

### Prerequisites

Make sure you have [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) installed on your machine.

### Quick Start

1. Clone the repository and navigate to the project directory.
2. The infrastructure operates using an environment file. Copy the example configuration to initiate variables:
   ```bash
   cp .env.example .env
   ```
3. Boot up the entire architecture (Services, Postgres Nodes, RabbitMQ Dashboard) in detached mode:
   ```bash
   docker-compose up -d --build
   ```
4. Verify all components started successfully using the Docker dashboard or `docker ps`. You should see `(healthy)` flags across critical resources within roughly 15 seconds.

To test the APIs, direct your REST client to `http://localhost:8080` (Commands) and `http://localhost:8081` (Queries).

---

## 📡 API Reference

### Write Endpoints (Command Service - `localhost:8080`)

#### Create a Product

```http
POST /api/products
```

**Body:**

```json
{
  "name": "Wireless Mouse",
  "category": "Accessories",
  "price": 49.99,
  "stock": 100
}
```

**Response (201 Created):**

```json
{ "productId": 1 }
```

#### Place an Order

```http
POST /api/orders
```

**Body:**

```json
{
  "customerId": 801,
  "items": [{ "productId": 1, "quantity": 1, "price": 49.99 }]
}
```

**Response (201 Created):**

```json
{ "orderId": 1 }
```

---

### Read / Analytics Endpoints (Query Service - `localhost:8081`)

These endpoints seamlessly query the background-generated materialized views.

#### Retrieve Product Sales

```http
GET /api/analytics/products/1/sales
```

**Response:**

```json
{
  "productId": 1,
  "totalQuantitySold": 1,
  "totalRevenue": 49.99,
  "orderCount": 1
}
```

#### Retrieve Category Revenue

```http
GET /api/analytics/categories/Accessories/revenue
```

**Response:**

```json
{
  "category": "Accessories",
  "totalRevenue": 49.99,
  "totalOrders": 1
}
```

#### Retrieve Customer Lifetime Value (LTV)

```http
GET /api/analytics/customers/801/lifetime-value
```

**Response:**

```json
{
  "customerId": 801,
  "totalSpent": 49.99,
  "orderCount": 1,
  "lastOrderDate": "2026-02-26T08:17:46.438Z"
}
```

#### Query System Sync Status (Eventual Consistency Lag)

```http
GET /api/analytics/sync-status
```

**Response:**

```json
{
  "lastProcessedEventTimestamp": "2026-02-26T08:17:48.511Z",
  "lagSeconds": 0.402
}
```

---

## 💡 Implementation Details & Trade-offs Discussion

### **1. Why use the Outbox Pattern instead of polling directly?**

If the application crashes _after_ an order is saved in the Database but _before_ the message reaches RabbitMQ, the order remains successfully booked but the downstream analytics pipelines never receive it. By saving the event payload directly into an `outbox` Postgres table during the exact same ACÍD transaction as the Order processing, we achieve true **Atomic Writes**. The background pub-tool can safely distribute these whenever RabbitMQ is active.

### **2. Designing for Idempotency**

If a network timeout occurs while RabbitMQ sends an `ACK` flag back to the publisher daemon, the daemon might attempt to re-publish an event to RabbitMQ twice. To guard against duplicated analytics values (like double-counting revenue), the `consumer-service` cryptographically hashes the raw JSON payload. This SHA256 string explicitly acts as an `event_id`. By attempting to uniquely `INSERT` it into the Postgres `processed_events` table before applying the mutations, duplicates deliberately trigger rollbacks rendering any number of multiple events completely harmless.

### **3. Timezone Agnosticism (UTC Integrity)**

For accurate `hourly_sales_view` bucket intervals, all timestamps crossing wire protocols are firmly formatted under explicit UTC bounds before Postgres insertions.

---

_Thank you for exploring this CQRS EDA implementation. Happy testing and reviewing!_
