import axios from 'axios';
import crypto from 'crypto';

export const submit = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const { orderDetails } = req.body;
  if (!orderDetails) {
    return res.status(400).json({ error: 'Order details are required' });
  }

  // Generate a commitment from the order details (simple hash for this example)
  const commitment = crypto.createHash('sha256').update(JSON.stringify(orderDetails)).digest('hex');

  try {
    // Submit the commitment to Mainstay
    const mainstayResponse = await axios.post(
      `${process.env.MAINSTAY_API_URL}/commitment/send`,
      {
        commitment: commitment,
        position: process.env.MAINSTAY_POSITION,
        token: process.env.MAINSTAY_TOKEN,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    // Handle Mainstay response
    return res.status(200).json(mainstayResponse.data);
  } catch (error) {
    console.error('Error submitting to Mainstay:', error.response ? error.response.data : error.message);
    return res.status(500).json({ error: 'Failed to submit to Mainstay' });
  }
};
