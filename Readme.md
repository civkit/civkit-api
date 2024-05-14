## Setting Up PostgreSQL Database and Tables

This guide walks you through setting up a PostgreSQL database and tables to store information about orders and invoices.

### Prerequisites:

- PostgreSQL installed on your system
- Node.js
- Lightning node

### Steps:

1. **Create a PostgreSQL Database:**

    Open a terminal window and run the following command to create a new database named `holdinvoices`:

    ```bash
    createdb holdinvoices
    ```

2. **Create the Tables:**

    ```sql
    CREATE TABLE orders (
        order_id SERIAL PRIMARY KEY,
        customer_id INT NOT NULL,
        order_details TEXT,
        amount_msat BIGINT,
        currency VARCHAR(3),
        payment_method VARCHAR(50),
        status VARCHAR(20),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        premium NUMERIC(5, 2) DEFAULT 0.00
    );

    CREATE TABLE invoices (
        invoice_id SERIAL PRIMARY KEY,
        order_id INT NOT NULL,
        bolt11 VARCHAR(255) NOT NULL,
        amount_msat BIGINT NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        invoice_type VARCHAR(10)
    );

    CREATE TABLE payouts (
        payout_id SERIAL PRIMARY KEY,
        order_id INT NOT NULL REFERENCES orders(order_id),
        ln_invoice TEXT NOT NULL,
        status CHARACTER VARYING(20) DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ```

3. **Create Authentication Tokens for Maker and Taker:**

    - **Maker Token Creation:**
    
      ```bash
      curl -X POST http://localhost:3000/api/register -H "Content-Type: application/json" -d '{
        "username": "maker",
        "password": "makerpassword"
      }'
      ```
    
      ```bash
      curl -X POST http://localhost:3000/api/login -H "Content-Type: application/json" -d '{
        "username": "maker",
        "password": "makerpassword"
      }'
      ```
    
    - **Taker Token Creation:**
    
      ```bash
      curl -X POST http://localhost:3000/api/register -H "Content-Type: application/json" -d '{
        "username": "taker",
        "password": "takerpassword"
      }'
      ```
    
      ```bash
      curl -X POST http://localhost:3000/api/login -H "Content-Type: application/json" -d '{
        "username": "taker",
        "password": "takerpassword"
      }'
      ```

4. **Running Test Curl Commands:**

    Once you've set up the database and tables, you can use curl commands to interact with your API for testing purposes. Here are some example commands:

    - **Create a new order:**
    
      ```bash
      curl -X POST http://localhost:3000/api/order -H "Content-Type: application/json" \
      -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTcsInVzZXJuYW1lIjoibWFrZXIiLCJpYXQiOjE3MTU2NzgxMjMsImV4cCI6MTcxNTY4MTcyM30.9drthez6_KaiHnJUuwYOYTenzUxvOOvsyNhuAquntC4" \
      -d '{
        "customer_id": 1234567,
        "order_details": "New Order for Testing",
        "amount_msat": 50000,
        "currency": "USD",
        "payment_method": "Credit Card",
        "status": "Pending",
        "type": 1 //sell order
      }'
      ```
    
    - **Take an order:**
    
      ```bash
      curl -X POST http://localhost:3000/api/orders/take -H "Content-Type: application/json" \
      -H "Authorization: Bearer <taker_token>" \
      -d '{
        "orderId": 18,
        "takerDetails": {
          "description": "Detailed description for the taker"
        }
      }'
      ```

    - **Sync invoices table to Lightning node:**
    
      ```bash
      curl -X POST http://localhost:3000/api/sync-invoices \
      -H "Authorization: Bearer <maker_token>"
      ```

    - **Submit a payout lightning invoice:**
    
      ```bash
      curl -X POST http://localhost:3000/api/payouts/submit -H "Content-Type: application/json" \
      -H "Authorization: Bearer <taker_token>" \
      -d '{
        "order_id": 14,
        "ln_invoice": "lnbc500n1pnzk6tqsp5xpd3ygj43dm6wh0tnk8d64mkavcmxay5ly8tnyc3dtmqlgkqedtqp..."
      }'
      ```

    - **Check payment hash status:**
    
      ```bash
      curl -X POST http://localhost:3000/api/holdinvoicelookup -H "Content-Type: application/json" \
      -d '{
        "payment_hash": "4f38cb95355deecabe1d13eb594b4420925ee7c32a8565ab8615a07745bdfca6"
      }'
      ```

    - **Settle a hold invoice by payment hash:**
    
      ```bash
      curl -X POST http://localhost:3000/api/settle-holdinvoice -H "Content-Type: application/json" \
      -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTgsInVzZXJuYW1lIjoidGFrZXIiLCJpYXQiOjE3MTU2MTAyMTUsImV4cCI6MTcxNTYxMzgxNX0.GAhNwEjzoqNd0vSA7lHGL3zmhtJBkYhb-ZqNeOJ6m0M" \
      -d '{
        "payment_hash": "f6b9e1824a3f0c71ecab49452b32e6d7d41f3c082f43b6e1e413cd159a341fe9"
      }'
      ```

    - **Confirm Fiat received**
    
      ```bash
      curl -X POST http://localhost:3000/api/fiat-received \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer <maker token>" \
      -d '{"order_id": 81}'
      {"message":"Fiat received processed successfully"}'
      ```

This setup allows you to easily test various functionalities of your API using curl commands. Replace `<maker_token>` and `<taker_token>` with the tokens generated for the maker and taker users, respectively.


