Setting Up PostgreSQL Database and Tables


Create PostgreSQL Database:
Make sure PostgreSQL is installed on your system.
Open a terminal window and run the following command to create a new PostgreSQL database:

createdb holdinvoices

Create Orders Table:
The orders table stores information about orders placed by customers.
The table structure includes columns such as order_id, customer_id, order_details, amount_msat, currency, payment_method, status, and created_at.
sql

Copy code
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

Create Invoices Table:
The invoices table stores information about invoices generated for orders.
This table includes columns such as invoice_id, order_id, bolt11, amount_msat, description, status, created_at, and expires_at.

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

Running Test Curl Commands

After setting up the database and tables, you can run test curl commands to interact with your API.
Here's an example curl command to create a new order via the API:

curl -X POST http://localhost:3000/api/order -H "Content-Type: application/json" -d '{
  "customer_id": 123,
  "order_details": "New Order for Testing",
  "amount_msat": 50000,
  "currency": "USD",
  "payment_method": "Credit Card",
  "status": "Pending"
}'
This command sends a POST request to the specified API endpoint (http://localhost:3000/api/order) with JSON data representing a new order.

Modify the JSON data as needed to test different scenarios.
