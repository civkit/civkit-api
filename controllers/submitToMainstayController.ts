import pkg from 'pg';
const { Pool } = pkg;
import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  // @ts-expect-error TS(2322): Type 'string | undefined' is not assignable to typ... Remove this comment to see the full error message
  port: process.env.DB_PORT,
});

export async function submit(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  try {
    // Fetch the user's npub and status from the database
    const userResult = await pool.query('SELECT username AS npub, status FROM users WHERE username = $1', [username]);
    if (userResult.rows.length === 0) {
      console.log(`User not found: ${username}`);
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    console.log(`Fetched user: ${JSON.stringify(user)}`);

    if (user.status !== 'complete') {
      console.log(`User registration not complete: ${username}, Status: ${user.status}`);
      return res.status(400).json({ error: 'User registration not complete' });
    }

    // Fetch the escrow runner's npub
    const escrowNpub = process.env.ESCROW_NPUB;

    // Create a commitment from the user's npub, the escrow runner's npub, and the user's status
    const commitmentData = {
      userNpub: user.npub,
      escrowNpub: escrowNpub,
      status: user.status
    };
    const commitment = crypto.createHash('sha256').update(JSON.stringify(commitmentData)).digest('hex');

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
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
    console.error('Error submitting to Mainstay:', error.response ? error.response.data : error.message);
    return res.status(500).json({ error: 'Failed to submit to Mainstay' });
  }
}
