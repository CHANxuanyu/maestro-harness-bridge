/**
 * Playwright configuration for Electron E2E testing
 *
 * This configuration is designed to test the Maestro Electron application.
 * E2E tests launch the actual packaged/built application and interact with
 * the UI through Playwright's browser automation.
 */
import { defineConfig } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration
 */
const realNative = process.env.MAESTRO_E2E_REAL === '1';

export default defineConfig({
	// Test directory
	testDir: './e2e',

	// Test file patterns
	testMatch: '**/*.spec.ts',

	// Run tests in files in parallel
	fullyParallel: false, // Electron tests should run sequentially to avoid conflicts

	// Fail the build on CI if you accidentally left test.only in the source code
	forbidOnly: !!process.env.CI,

	// A failed native acceptance run must remain failed, including on CI.
	retries: 0,

	// Opt out of parallel tests for Electron
	workers: 1,

	// Reporter to use
	reporter: realNative
		? [['list'], ['html', { open: 'never' }], ['./e2e/native-reporter.ts']]
		: process.env.CI
			? [['github'], ['html', { open: 'never' }]]
			: [['list'], ['html', { open: 'never' }]],

	// Shared settings for all the projects below
	use: {
		// Base URL to use in actions like `await page.goto('/')`
		// For Electron, this is handled differently - we use app.evaluate()

		// Collect trace when retrying the failed test
		trace: 'on-first-retry',

		// Capture screenshot on failure
		screenshot: 'only-on-failure',

		// Record video on failure
		video: 'on-first-retry',

		// Timeout for each action
		actionTimeout: 10000,
	},

	// Configure projects for major browsers
	projects: [
		{
			name: 'electron',
			testDir: './e2e',
			testIgnore: '**/native-*.spec.ts',
			use: {
				// Electron-specific settings will be configured in test fixtures
			},
		},
		{
			name: 'native',
			testMatch: '**/native-*.spec.ts',
			testIgnore:
				realNative && !process.env.MAESTRO_E2E_SHARED_PATH ? '**/native-shared.spec.ts' : [],
			timeout: realNative ? 240000 : 60000,
			use: { trace: 'off', video: 'off' },
		},
	],

	// Global test timeout
	timeout: 60000,

	// Expect timeout
	expect: {
		timeout: realNative ? 90000 : 10000,
	},

	// Output directory for test artifacts
	outputDir: 'e2e-results/',

	// Run local dev server before starting the tests
	// For Electron, we build and launch the app in the test fixtures
	// webServer: undefined,
});
