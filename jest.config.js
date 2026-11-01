const transformIgnorePatterns = [
  'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@noble/.*|standard-navigation))',
];

module.exports = {
  projects: [
    {
      displayName: 'finance',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/__tests__/finance/**/*.test.ts'],
      transform: { '\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }] },
      transformIgnorePatterns,
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
    },
    {
      displayName: 'ui',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/__tests__/ui/**/*.test.tsx'],
      transformIgnorePatterns,
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
    },
  ],
};
