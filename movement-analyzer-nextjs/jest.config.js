module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    // Adjust these if your project uses different aliases or none
    '^@/utils/(.*)$': '<rootDir>/utils/$1',
    '^@/components/(.*)$': '<rootDir>/components/$1', // Though components are not directly tested here
    '^@/pages/(.*)$': '<rootDir>/pages/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'], // For global mocks or setup
  // Automatically clear mock calls and instances between every test
  clearMocks: true,
  // Coverage reporting
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageProvider: "v8", // or "babel"
  // Ignore coverage for these paths (e.g., config files, test utilities)
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/jest.config.js",
    "/jest.setup.js",
    "/coverage/"
  ],
  // Test file patterns
  testMatch: [
    "**/__tests__/**/*.test.[jt]s?(x)", // Standard Jest pattern
    "**/?(*.)+(spec|test).[tj]s?(x)"
  ],
};
