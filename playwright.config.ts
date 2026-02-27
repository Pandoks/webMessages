import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'pnpm build && pnpm preview',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		env: {
			IMESSAGE_RS_PASSWORD: 'e2e-test-placeholder'
		}
	},
	use: {
		baseURL: 'http://localhost:4173'
	},
	testDir: 'e2e'
});
