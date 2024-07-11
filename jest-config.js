module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['.'],
    testMatch: ['**/__tests__/**/*.ts'],
    transform: {
      '^.+\\.tsx?$': 'ts-jest',
    },
    moduleFileExtensions: ['ts', 'js', 'json', 'node'],
    moduleNameMapper: {
      '^@/(.*)$': '<rootDir>/$1',
    },
  };