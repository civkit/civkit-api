# Setting Up PostgreSQL Database and Tables
## This guide walks you through setting up a PostgreSQL database and tables to store information about orders and invoices.

Prerequisites:

- PostgreSQL installed on your system
- node.js
- lightning node

Steps:
Create a PostgreSQL Database:
Open a terminal window and run the following command to create a new database named holdinvoices:

```
createdb holdinvoices
```

Create the Orders Table:

The orders table stores details about customer orders. It includes columns for order ID, customer ID, order details, amount (in milli-satoshis), currency, payment method, status, and creation timestamp.

```
CREATE TABLE orders (
    order_id SERIAL PRIMARY KEY,
    customer_id INT NOT NULL,
    order_details TEXT,
    amount_msat BIGINT,
    currency VARCHAR(3),
    payment_method VARCHAR(50),
    status VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE orders ADD COLUMN premium NUMERIC(5, 2) DEFAULT 0.00;
```

Create the Invoices Table:

The invoices table stores information about invoices generated for orders. This table includes columns for invoice ID, order ID, BOLT 11 invoice string, amount (in milli-satoshis), description, status, creation timestamp, and expiration timestamp.

```
CREATE TABLE invoices (
    invoice_id SERIAL PRIMARY KEY,
    order_id INT NOT NULL,
    bolt11 VARCHAR(255) NOT NULL,
    amount_msat BIGINT NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

ALTER TABLE invoices
ADD COLUMN invoice_type VARCHAR(10);
```

```
CREATE TABLE payouts (
  payout_id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(order_id),
  ln_invoice TEXT NOT NULL,
  status CHARACTER VARYING(20) DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

Running Test Curl Commands
Once you've set up the database and tables, you can use curl commands to interact with your API for testing purposes.

Here's an example curl command to create a new order via the API:
```
curl -X POST http://localhost:3000/api/order -H "Content-Type: application/json" -d '{
  "customer_id": 1234567,
  "order_details": "New Order for Testing",
  "amount_msat": 50000,
  "currency": "USD",
  "payment_method": "Credit Card",
  "status": "Pending"
}'

--------------------------------------------
after adding fields type and premium

curl -X POST http://localhost:3000/api/order -H "Content-Type: application/json" -d '{
  "customer_id": 1234567,
  "order_details": "New Order for Testing",
  "amount_msat": 50000,
  "currency": "USD",
  "payment_method": "Credit Card",
  "status": "Pending",
  "type": 1,
  "premium": 1.5
}'

```

check payment hash status
```
curl -X POST http://localhost:3000/api/holdinvoicelookup -H "Content-Type: application/json" -d '{
  "payment_hash": "4f38cb95355deecabe1d13eb594b4420925ee7c32a8565ab8615a07745bdfca6"
}'
```

submit payout lightning invoice

```
curl -X POST http://localhost:3000/api/payouts/submit -H "Content-Type: application/json" -d '{
    "order_id": 14,
    "ln_invoice": "lnbc500n1pnzk6tqsp5xpd3ygj43dm6wh0tnk8d64mkavcmxay5ly8tnyc3dtmqlgkqedtqp..."
}'
```

take order
```
curl -X POST http://localhost:3000/api/orders/take      -H "Content-Type: application/json"      -d '{"orderId": 18, "takerDetails": {"description": "Detailed description for the taker"}}'
```
curl -X POST http://localhost:3000/api/orders/take      -H "Content-Type: application/json"      -d '{"orderId": 62, "takerDetails": {"description": "Detailed description for the taker"}}'

sync invoices table to lightning node
```
curl -X POST http://localhost:3000/api/sync-invoices
{"message":"Invoices synchronized successfully"}
```

when both invoices for an orderid switch to paid, the chatroom should open.

fiat received endpoint. it will payout to the payout invoice for that id. payout not working entrely yet.

```
curl -X POST http://localhost:3000/api/fiat-received -H "Content-Type: application/json" -d '{"order_id": 55}'
```
Settle a hold invoice by payment hash
```
 curl -X POST http://localhost:3000/api/settle-holdinvoice -H "Content-Type: application/json" -d '{
  "payment_hash": "049c7e172dfa8fcee31669795ed31178f23a964a9251f6fe2ac6c7f7c98010be"
}'
{"message":"Hold invoice settled successfully","result":{"state":"settled"}}
```


curl -X POST http://localhost:3000/api/orders/take      -H "Content-Type: application/json"      -d '{"orderId": 69, "takerDetails": {"description": "Detailed description for the taker"}}'




CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,  -- This will store the hashed password
    created_at TIMESTAMPTZ DEFAULT NOW()
);


curl -X POST http://localhost:3000/api/orders/take -H "Content-Type: application/json" \
-H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MiwidXNlcm5hbWUiOiJ1c2VyMSIsImlhdCI6MTcxNTU4NjE2MSwiZXhwIjoxNzE1NTg5NzYxfQ.UZIu8FuFm8SOOdfEcHwIYprqoocIE3rw8KBynDcAap8" -d '{
  "orderId": 69,
  "takerDetails": {
    "description": "Detailed description for the taker"
  }
}'
