import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		env: {
			IMESSAGE_RS_PASSWORD: 'e2e-test-placeholder'
		}
	},
	testDir: 'e2e'
});
