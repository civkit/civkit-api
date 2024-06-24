const request = require('supertest');
const express = require('express');
const { registerUser, pollAndCompleteRegistration } = require('../services/userService');

const app = express();
app.use(express.json());

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await registerUser(username, password);
    res.status(201).json({
      message: 'Registration initiated, please pay the invoice to complete registration.',
      user: {
        id: user.id,
        username: user.username,
        created_at: user.created_at,
        invoice: user.invoice
      },
      invoice: user.invoice
    });
  } catch (error) {
    res.status(500).json({ message: 'Registration failed', error: error.message });
  }
});

jest.mock('../services/userService', () => ({
  registerUser: jest.fn(),
  pollAndCompleteRegistration: jest.fn(),
}));

describe('POST /api/register', () => {
  it('should generate an invoice and initiate registration', async () => {
    const user = {
      id: 1,
      username: 'testuser',
      created_at: new Date(),
      invoice: 'fakeInvoice'
    };
    registerUser.mockResolvedValue(user);

    const response = await request(app)
      .post('/api/register')
      .send({ username: 'testuser', password: 'password123' });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('invoice', 'fakeInvoice');
    expect(response.body.user).toHaveProperty('id', 1);
    expect(response.body.user).toHaveProperty('username', 'testuser');
  });

  it('should return 500 if registration fails', async () => {
    registerUser.mockRejectedValue(new Error('Registration failed'));

    const response = await request(app)
      .post('/api/register')
      .send({ username: 'testuser', password: 'password123' });

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty('message', 'Registration failed');
  });
});
