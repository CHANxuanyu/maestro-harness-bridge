import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['e2e/fixtures/native/*.test.ts'],
		environment: 'node',
		pool: 'forks',
		maxWorkers: 1,
	},
});
