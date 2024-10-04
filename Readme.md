# Civkit Application Setup

This README provides instructions for setting up the Civkit Africa application, including the database, frontend, API, chat application, and Nginx configuration.

## Database Setup (Prisma)

1. Install Prisma CLI:
   ```
   npm install -g prisma
   ```

2. Initialize Prisma in your project:
   ```
   prisma init
   ```

3. Update the `schema.prisma` file with your model definitions.

4. Generate Prisma client:
   ```
   prisma generate
   ```

5. Apply migrations:
   ```
   prisma migrate dev
   ```

## Frontend Setup

1. Navigate to the frontend directory:
   ```
   cd path/to/frontend
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Build the application:
   ```
   npm run build
   ```

4. Start development server:
   ```
   npm run dev
   ```

5. Update the `.env` file with necessary variables (e.g., API URL).

## API Setup

1. Navigate to the API directory:
   ```
   cd path/to/api
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Build the application:
   ```
   npm run build
   ```

4. Start development server:
   ```
   npm run dev
   ```

5. Generate JWT token:
   ```
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```

6. Update the `.env` file with the JWT token and other necessary variables.

## Chat Application Setup

1. Navigate to the chat application directory:
   ```
   cd path/to/chat
   ```

2. Run the build script:
   ```
   ./build.sh
   ```

3. Start the chat application:
   ```
   ./run.sh
   ```

## Nginx Setup

1. Install Nginx:
   ```
   sudo apt update
   sudo apt install nginx
   ```

2. Create a new Nginx configuration file:
   ```
   sudo nano /etc/nginx/sites-available/civkit-frontend-api
   ```

3. Add the following configuration:

   ```nginx
   server {
       listen 80;
       server_name frontend.civkit.africa;

       location / {
           proxy_pass http://127.0.0.1:3001;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }

   server {
       listen 80;
       server_name api.civkit.africa;

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }

   server {
       listen 80;
       server_name chat.civkit.africa;

       location / {
           proxy_pass http://127.0.0.1:3456;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

4. Enable the configuration:
   ```
   sudo ln -s /etc/nginx/sites-available/civkit-frontend-api /etc/nginx/sites-enabled/
   ```

5. Test Nginx configuration:
   ```
   sudo nginx -t
   ```

6. Reload Nginx:
   ```
   sudo systemctl reload nginx
   ```

7. Install Certbot for SSL:
   ```
   sudo apt install certbot python3-certbot-nginx
   ```

8. Obtain SSL certificates:
   ```
   sudo certbot --nginx -d frontend.civkit.africa -d api.civkit.africa -d chat.civkit.africa
   ```

9. Follow the prompts to complete SSL setup.

Remember to replace placeholder values (like port numbers and domain names) with your actual values. This README provides a quick overview of the setup process for each component of the Civkit Africa application.
These are the endpoints being consumed by FE:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/register | Register a new user |
| POST | /api/login | Authenticate a user |
| GET | /api/orders | Fetch all orders |
| POST | /api/orders/take | Take an existing order |
| POST | /api/check-and-create-chatroom | Check and create a chatroom for an order |
| GET | /api/orders/:orderId | Fetch details of a specific order |
| GET | /api/invoice/:orderId | Fetch invoice for a specific order |
| POST | /api/holdinvoicelookup | Check the status of a hold invoice |
| PUT | /api/orders/:orderId | Update a specific order |
| POST | /api/get-invoice | Get or create an invoice |
| POST | /api/taker-invoice/${orderId} | Create a taker invoice for an order |
| POST | /api/payouts | Submit a payout |
| POST | /api/taker-full-invoice/${orderId} | Create a full invoice for a taker |
| GET | /api/full-invoice/${orderId} | Fetch full invoice for an order |
| GET | /api/order/${orderId}/latest-chat-details | Fetch latest chat details for an order |
| GET | /api/currencies.json | Fetch available currencies |


Endpoints not consumed:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/check-accepted-invoices | Check and update accepted invoices |
| POST | /api/update-accept-offer-url | Update accept-offer URL |
| POST | /api/settle/settle-hold-invoices | Settle hold invoices for an order |
| POST | /api/orders/settle-holdinvoices-by-order | Settle hold invoices by order ID |
| POST | /api/submitToMainstay | Submit data to Mainstay |
