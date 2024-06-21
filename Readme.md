## Civkit API
This is a an escrow/chat API using c-lightning for hold invoices, integrated with a seperate chat that allows a civkit node runner to manage the escrow and backend of a peer to peer marketplace from a laptop. We have attempted to simplify some of the steps needed to handle this. This code is experimental and not production ready. We welcome contributors.

What this code does
- create hold invoices
- create full invoices
- payout invoices based on orderIds
- returns chat url's for trades

This has only been used on testnet and is using cligtning. We would like to add other escrow options including LND and on-chain escrow as options for traders. This is intended as a starting template and feel free to open issues and PR's to help us get there.

To run the code as it is, requires a few things
- c-lightning node https://github.com/ElementsProject/lightning****
- hold invoice plugin enabled https://github.com/daywalker90/holdinvoice?tab=readme-ov-file#installation****
- postgres database
- nostr relay on port 8080
- chat on localhost:3456

You can configure the .env file for your lightning node and jwt secret. In config/db,js, you can configure postgres credentials. THere is also ndksetup.js which currently doesnt sign events but creates a nostr identity. 

In future development, this should be the escrow runner's identity and users can send signed events to rank them as an escrow runner/dispute moderator.

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

    ALTER TABLE invoices ADD COLUMN user_type VARCHAR(10);


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
    ALTER TABLE users ALTER COLUMN username TYPE VARCHAR(64);
    ALTER TABLE users ALTER COLUMN invoice TYPE VARCHAR(9999);
    ALTER TABLE users ALTER COLUMN status TYPE VARCHAR(64);
    ALTER TABLE users ALTER COLUMN payment_hash TYPE VARCHAR(255);

    CREATE TABLE chats (
        chat_id SERIAL PRIMARY KEY,
        order_id INT NOT NULL,
        chatroom_url TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'open',
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE chats ADD COLUMN token VARCHAR(255);
    ALTER TABLE chats ADD COLUMN accept_offer_url VARCHAR(955);


    ```
3. **Create .env file using .env-sample**

      ```
      LIGHTNING_NODE_API_URL=https://localhost:3010
      RUNE=
      DB_USER=
      DB_HOST=
      DB_NAME=holdinvoices
      DB_PASSWORD=
      DB_PORT=5432
      JWT_SECRET=
      ```
You can generate the secret with openssl rand -base64 64 and use that as the jwt. Ideally, we can automate this later.

Pay close attention to your postgres setup now as it can be a pain to debug later. Double check the user/host/password. Its a good idea to have a seperate set of credentials for this to avoid confusion and keep things a bit more organized.


4. **Create Authentication Tokens for Maker and Taker:**

    - **Maker Token Creation:**
    
      ```bash
      curl -X POST http://localhost:3000/api/register -H "Content-Type: application/json" -d '{
        "username": "6b2ab9c2b202923b738db40f272ec203bc675d2410d0aa85feb9026650165464",
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
      export TAKER_TOKEN=
      ```
Everythhing after this will require a lightning node.

5. **Running Test Curl Commands:**

    Once you've set up the database and tables, you can use curl commands to interact with your API for testing purposes. Here are some example commands:

    - **Create a new order:**
    
      ```bash
      curl -X POST http://localhost:3000/api/order -H "Content-Type: application/json" \
      -H "Authorization: Bearer $MAKER_TOKEN" \
      -d '{
        "order_details": "New Order for Testing",
        "amount_msat": 50000,
        "currency": "USD",
        "payment_method": "Credit Card",
        "status": "Pending",
        "type": 1
      }'
      ```
    
    - **Take an order:**
    
      ```bash
      curl -X POST http://localhost:3000/api/orders/take -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TAKER_TOKEN" \
      -d '{
        "orderId": 249,
        "takerDetails": {
          "description": "Detailed description for the taker"
        }
      }'
      ```

    - **Sync invoices table to Lightning node:**
    
      ```bash
      curl -X POST http://localhost:3000/api/sync-invoices \
      -H "Authorization: Bearer $TAKER_TOKEN"
      ```

    - **Submit a payout lightning invoice:**
    
      ```bash
      curl -X POST http://localhost:3000/api/payouts/submit -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TAKER_TOKEN" \
      -d '{
        "order_id": 183,
        "ln_invoice": "lntb500n1pn9suexsp5ef6zc0ee3txs5sntdmwrhpy6su0lj3q37x34y9r8mulkeeljml7qpp5z0r9c2amcpuwkdspd9nh3tmk9svslx99c5u3k8l2j7548yu45ursdqddaexgetjxyurxxqyjw5qcqp2rzjqgtm5k28l67ntm5jffy8kzv794mfkj3ak44e4pfzn9xyc5fjken6c2hjdqqq0vcqqqqqqqqpqqqqqzsqqc9qxpqysgq8r3phkr780mataj44tkzv72gnj4cak2gyyex05p9fg4874xh5njscwuvpnywmfgrgz6tu72mkhqq7ltld2hpjkthky5h7sq8aw9wvfgqqztvpl"
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
      -d '{"order_id": 184}'
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
        "orderId": 183
      }'
      ```

    - **Settle Hold invoices by Order ID**
    
      ```bash
     curl -X POST http://localhost:3000/api/settle-holdinvoices-by-order \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TAKER_TOKEN" \
     -d '{"orderId": 365}'
      ```


This setup allows you to easily test various functionalities of your API using curl commands. Replace `<maker_token>` and `<taker_token>` with the tokens generated for the maker and taker users, respectively.
