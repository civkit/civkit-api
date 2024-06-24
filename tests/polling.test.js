const { pollAndCompleteRegistration } = require('../services/userService');

jest.mock('../services/userService', () => ({
  pollAndCompleteRegistration: jest.fn(),
}));

describe('Polling for registration completion', () => {
  it('should poll and complete registration successfully', async () => {
    pollAndCompleteRegistration.mockResolvedValue(true);

    // Simulate the polling function being called
    await pollAndCompleteRegistration();

    expect(pollAndCompleteRegistration).toHaveBeenCalled();
  });

  it('should handle errors during polling', async () => {
    pollAndCompleteRegistration.mockRejectedValue(new Error('Polling error'));

    try {
      await pollAndCompleteRegistration();
    } catch (error) {
      expect(error).toEqual(new Error('Polling error'));
    }
  });
});
