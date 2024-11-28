# Civkit Application Setup

This README provides instructions for setting up the Civkit Africa application, including the database, API and NGINX. Please consult and setup these 2 repos to get the full civkit marketplace experience. 

- Frontend: https://github.com/civkit/civkit-frontend
- Chat: https://github.com/civkit/civkit-chat

## Prerequisites

These are essential to the funtioning of the application. You will need to be able to manage a lightning node with routing for this project to work. We are using a plugin to manage hold invoices so versions of core lightning can impact the success of the installation. In order to get this setup done effectively, I suggest spending a bit of time on the prerequisites. The code is easier to run then the prerequisite setup. We are seeking contributors to improve this too so feel free to open a PR or issue to make this simpler. 

For now, you will need these to get the civkit api and frontend working as a marketplace runner. 

- c-lightning (v23.11.2) 
- daywalker hold invoice plugin (here https://github.com/daywalker90/holdinvoice?tab=readme-ov-file#installation)
- nostr relay. nostr-rs-relay preferred. (https://github.com/scsibug/nostr-rs-relay)
- a domain name
- a server to deploy on

You can run everything on signet, regtest and tesnet. It has been validated on all networks as functioning.

## Database Setup (Prisma)

Our code using a postgres database which we are managing with Prisma. You can easily setup the database yourself using prisma commands. This will create the tables. You can reference the schema.prisma table to understand the structure.

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
   npx prisma generate
   ```

5. Apply migrations:
   ```
   prisma migrate dev
   ```

## API Setup

1. Navigate to the API directory:
   ```
   cd path/to/api
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Generate JWT token:
   ```
   openssl rand -base64 32
   ```

4. Update the `.env` file with the JWT token and other necessary variables.

5. Build the application:
   ```
   npm run build
   ```
   
6. Start development server:
   ```
   npm run start
   ```

At this stage, your node will announce itself to the nostr relay you specified. This lets the world know your node is live in Nostr verse. An event kind 1505 is created by the API and sent to the relay specified in .env. You will also see a private key generate which is your node runner private key. Below is a successful bootup. 

```
 npm run start

> new-lightning-api@1.0.0 start
> node dist/server.js

LIGHTNING_NODE_API_URL: https://localhost:3010
Server running on port 3000
Using pubkey: 3f516e4a7d67592df8ad164cad54cf35b4d5f85fe9102ec75ac0e9da0acaaa3c
Created event: {
  "kind": 1505,
  "created_at": 1732769136,
  "tags": [
    [
      "t",
      "civkit"
    ],
    [
      "t",
      "orderbook"
    ]
  ],
  "content": "{\"message\":\"I'm a CivKit node. Place your orders here.\",\"url\":\"https://frontend.civkit.africa\"}",
  "pubkey": "3f516e4a7d67592df8ad164cad54cf35b4d5f85fe9102ec75ac0e9da0acaaa3c",
  "id": "dc05b668f3af1b88b1b2c0918593d6eab2ebac9e698a93c12059688b8e727484",
  "sig": "4e86688e5af682c118e63f1cfa7e85ae44a0ba99c929b7974a70eab93c641822755c29e937cf01e9bd92bed50ef41b9aaf669ce9dd46644f5f00cc8e8fd7c578"
}

Attempting to connect to wss://civkit.africa
Connected to wss://civkit.africa
Sending message to wss://civkit.africa: ["EVENT",{"kind":1505,"created_at":1732769136,"tags":[["t","civkit"],["t","orderbook"]],"content":"{\"message\":\"I'm a CivKit node. Place your orders here.\",\"url\":\"https://frontend.civkit.africa\"}","pubkey":"3f516e4a7d67592df8ad164cad54cf35b4d5f85fe9102ec75ac0e9da0acaaa3c","id":"dc05b668f3af1b88b1b2c0918593d6eab2ebac9e698a93c12059688b8e727484","sig":"4e86688e5af682c118e63f1cfa7e85ae44a0ba99c929b7974a70eab93c641822755c29e937cf01e9bd92bed50ef41b9aaf669ce9dd46644f5f00cc8e8fd7c578"}]
Received message from wss://civkit.africa: ["OK","dc05b668f3af1b88b1b2c0918593d6eab2ebac9e698a93c12059688b8e727484",true,""]
Event published successfully to wss://civkit.africa
Successfully published to wss://civkit.africa
CivKit node announced successfully
```
   
## Nginx Setup

This setup assumes you have setup chat and frontend, so if you have not done this, you can go ahead and do that first. The code can run for testing without nginx and self signed certs but its much easier to just get nginx working out the gate if you plan to use this for anything real. The setup is fairly straightforward but you will need to purchase a domain.

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
       server_name {{ frontend domain }};

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
       server_name {{api domain}};

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
       server_name {{chat domain}};

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

Remember to replace placeholder values (like port numbers and domain names) with your actual values. 

## How to Contribute

We are 100% OPEN SOURCE now and forever. We rely on the contributions of the public to move the mission of permissionless f*ck you money around the world. Our code is only good when its reviewed and improved. I have created a list of good first issues for users to look at to get started in contributing to the codebase.


Feel Free to Reach out to me here for questions and open issues. I will do my best to assist you.

We also have a telegram chat here: https://t.me/civkittv

## Other Notes
Our API code does have some technical debt in the sense of unused endpoints. If someone would like to review this and remove unused endpoints that are not consumed by frontend. Please open an issue if you find unused endpoints. It would help us tremendously and provide a tangible easy goal. 

Below is a non comprehensive list of endpoints. Please update or change this if you find new or unused endpoints.

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


Feel Free to Reach out to me here for questions and open issues. I will do my best to assist you.
