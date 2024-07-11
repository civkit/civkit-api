import { authenticateUser } from '../services/userService';
import prisma from '../config/prismaClient';
import bcrypt from 'bcrypt';

jest.mock('../config/prismaClient', () => ({
  user: {
    findUnique: jest.fn(),
  },
}));

jest.mock('bcrypt');

describe('Login Function', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should authenticate a valid user', async () => {
    const mockUser = {
      id: 1,
      username: '0dd6b589436d8261faba861f9a4df4b910f81c812cac7e0c402086bdcb7179a2',
      password: '$2b$10$abcdefghijklmnopqrstuvwxyz123456', // Mocked hashed password
    };

    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser);
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);

    const result = await authenticateUser('0dd6b589436d8261faba861f9a4df4b910f81c812cac7e0c402086bdcb7179a2', 'makerpassword');

    expect(result).toEqual(mockUser);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { username: '0dd6b589436d8261faba861f9a4df4b910f81c812cac7e0c402086bdcb7179a2' },
    });
    expect(bcrypt.compare).toHaveBeenCalledWith('makerpassword', mockUser.password);
  });

  it('should throw an error for non-existent user', async () => {
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);

    await expect(authenticateUser('nonexistent', 'password')).rejects.toThrow('User not found');
  });

  it('should throw an error for incorrect password', async () => {
    const mockUser = {
      id: 1,
      username: '0dd6b589436d8261faba861f9a4df4b910f81c812cac7e0c402086bdcb7179a2',
      password: '$2b$10$abcdefghijklmnopqrstuvwxyz123456', // Mocked hashed password
    };

    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser);
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(false);

    await expect(authenticateUser('0dd6b589436d8261faba861f9a4df4b910f81c812cac7e0c402086bdcb7179a2', 'wrongpassword')).rejects.toThrow('Invalid credentials');
  });
});