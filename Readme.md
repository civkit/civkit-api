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

    CREATE TABLE chats (
        chat_id SERIAL PRIMARY KEY,
        order_id INT NOT NULL,
        chatroom_url TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'open',
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
      
      ```bash
      export MAKER_TOKEN=<maker_token_from_previous_command>
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
      
      ```bash
      export TAKER_TOKEN=<taker_token_from_previous_command>
      ```

4. **Running Test Curl Commands:**

    Once you've set up the database and tables, you can use curl commands to interact with your API for testing purposes. Here are some example commands:

    - **Create a new order:**
    
      ```bash
      curl -X POST http://localhost:3000/api/order -H "Content-Type: application/json" \
      -H "Authorization: Bearer $MAKER_TOKEN" \
      -d '{
        "customer_id": 1234567,
        "order_details": "New Order for Testing",
        "amount_msat": 50000,
        "currency": "USD",
        "payment_method": "Credit Card",
        "status": "Pending",
        "type": 0
      }'
      ```
    
    - **Take an order:**
    
      ```bash
      curl -X POST http://localhost:3000/api/orders/take -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TAKER_TOKEN" \
      -d '{
        "orderId": 175,
        "takerDetails": {
          "description": "Detailed description for the taker"
        }
      }'
      ```

    - **Sync invoices table to Lightning node:**
    
      ```bash
      curl -X POST http://localhost:3000/api/sync-invoices \
      -H "Authorization: Bearer $MAKER_TOKEN"
      ```

    - **Submit a payout lightning invoice:**
    
      ```bash
      curl -X POST http://localhost:3000/api/payouts/submit -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TAKER_TOKEN" \
      -d '{
        "order_id": 93,
        "ln_invoice": "lntb500n1pnyxhj6sp5wa0qddh6m7ngxc26kc6jwt9usdxgsu4wren9nx8dxe6qjxjgm0dqpp5yceze5tt2g77g4yuc030d3407mr5rkvzmgk2eqhvv5tqp3cytl0sdq4daexgetj8yej6arpddjhyxqyjw5qcqp2rzjqfnfnd4vynmcfz6ulcc2fvpp7et3dw9wdqg3sxnl2ljn89vvml8kk2hjdqqq0dqqqqqqqqqpqqqqqzsqqcrzjqgtm5k28l67ntm5jffy8kzv794mfkj3ak44e4pfzn9xyc5fjken6c2hjdqqq0vcqqqqqqqqpqqqqqzsqqcrzjqgtm5k28l67ntm5jffy8kzv794mfkj3ak44e4pfzn9xyc5fjken6c2h5f5qqtwqqqqqqqqqpqqqqqzsqqc9qxpqysgqsfagrq3krtymttwrnjkdwm3yvhpjq2590c4nt3d8r0nwzzxxt058y60g9lp0gztm6lrdvp5jcwnfy5zzhr23lkwh5ua4tawzrhz0hacpyhvw8f"
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
      -H "Authorization: Bearer $TAKER_TOKEN" \
      -d '{
        "payment_hash": "f6b9e1824a3f0c71ecab49452b32e6d7d41f3c082f43b6e1e413cd159a341fe9"
      }'
      ```

    - **Confirm Fiat received**
    
      ```bash
      curl -X POST http://localhost:3000/api/fiat-received \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $MAKER_TOKEN" \
      -d '{"order_id": 93}'
      {"message":"Fiat received processed successfully"}'
      ```

    - **Sync Hold**
    
      ```bash
      curl -X POST http://localhost:3000/api/check-accepted-invoices -H "Content-Type: application/json" \
      -H "Authorization: Bearer $MAKER_TOKEN" \
      -d '{"orderId": 110}'
      ```

    - **Check and create chatroom:**
    
      ```bash
      curl -X POST http://localhost:3000/api/check-and-create-chatroom -H "Content-Type: application/json" \
      -H "Authorization: Bearer $MAKER_TOKEN" \
      -d '{
        "orderId": 181
      }'
      ```

This setup allows you to easily test various functionalities of your API using curl commands. Replace `<maker_token>` and `<taker_token>` with the tokens generated for the maker and taker users, respectively.
