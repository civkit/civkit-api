Created a postgres db

holdinvoices=> SELECT * FROM orders LIMIT 10;
 order_id | customer_id |     order_details     | amount_msat | currency | payment_method | status  |            created_at            
----------+-------------+-----------------------+-------------+----------+----------------+---------+----------------------------------
        1 |         123 | Test Order            |       50000 | USD      | Credit Card    | Pending | 2024-04-26 10:04:11.327266+05:30
        6 |         123 | New Order for Testing |       50000 | USD      | Credit Card    | Pending | 2024-04-26 11:20:47.128561+05:30
(2 rows)


thats the structure

here is a sample curl command
dave@dave-ThinkPad-T470-W10DG:~/new-lightning-api$ curl -X POST http://localhost:3000/api/order -H "Content-Type: application/json" -d '{
  "customer_id": 123,
  "order_details": "New Order for Testing",
  "amount_msat": 50000,
  "currency": "USD",
  "payment_method": "Credit Card",
  "status": "Pending"
}'
{"order_id":6,"customer_id":123,"order_details":"New Order for Testing","amount_msat":50000,"currency":"USD","payment_method":"Credit Card","status":"Pending","created_at":"2024-04-26T05:50:47.128Z"}dave@dave-ThinkPad-T470-W10DG:~/new-lightning-api$ 

