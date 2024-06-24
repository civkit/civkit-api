const request = require('supertest');
const express = require('express');
const { authenticateUser } = require('../services/userService');
const { generateToken } = require('../utils/auth');

const app = express();
app.use(express.json());

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await authenticateUser(username, password);
    const token = generateToken(user);
    res.json({ token });
  } catch (error) {
    res.status(401).json({ message: 'Login failed', error: error.message });
  }
});

jest.mock('../services/userService', () => ({
  authenticateUser: jest.fn(),
}));

jest.mock('../utils/auth', () => ({
  generateToken: jest.fn(() => 'fakeToken'),
}));

describe('POST /api/login', () => {
  it('should return a token when login is successful', async () => {
    const user = { id: 1, username: 'testuser' };
    authenticateUser.mockResolvedValue(user);

    const response = await request(app)
      .post('/api/login')
      .send({ username: 'testuser', password: 'password123' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('token', 'fakeToken');
  });

  it('should return 401 when login fails', async () => {
    authenticateUser.mockRejectedValue(new Error('Invalid credentials'));

    const response = await request(app)
      .post('/api/login')
      .send({ username: 'testuser', password: 'wrongpassword' });

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('message', 'Login failed');
  });
});
