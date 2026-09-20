import { test, expect } from '@playwright/test'

const sshHost = process.env.WRENCH_E2E_SSH_HOST
const sshUser = process.env.WRENCH_E2E_SSH_USER
const sshPassword = process.env.WRENCH_E2E_SSH_PASSWORD
const sshPort = process.env.WRENCH_E2E_SSH_PORT || '22'
const enabled = Boolean(sshHost && sshUser && sshPassword)
test.skip(!enabled, 'Set WRENCH_E2E_SSH_HOST/USER/PASSWORD to run the real SSH smoke test')

/**
 * Optional real-chain smoke test. It is skipped unless explicitly configured;
 * credentials stay in process env and are never included in test output.
 */
test('real SSH terminal and SFTP smoke path', async ({ page }) => {
  await page.goto('/ssh')
  const quickConnect = page.getByText('快速连接', { exact: true }).first()
  await expect(quickConnect).toBeVisible({ timeout: 15_000 })
  await quickConnect.click()

  await page.getByPlaceholder('主机地址').fill(sshHost!)
  await page.getByPlaceholder('端口').fill(sshPort)
  await page.getByPlaceholder('用户名').fill(sshUser!)
  await page.getByPlaceholder('密码（可选）').fill(sshPassword!)
  await page.getByRole('button', { name: /快速连接/ }).last().click()

  const terminal = page.getByTestId('ssh-terminal-panel')
  await expect(terminal).toBeVisible({ timeout: 30_000 })
  await expect(terminal.locator('.xterm')).toBeVisible({ timeout: 30_000 })
  const terminalBox = await terminal.locator('.xterm').boundingBox()
  expect(terminalBox?.width).toBeGreaterThan(0)
  expect(terminalBox?.height).toBeGreaterThan(0)

  // Exercise the actual PTY input path without exposing command output in logs.
  await terminal.locator('.xterm-helper-textarea').pressSequentially('printf e2e-ok')
  await terminal.locator('.xterm-helper-textarea').press('Enter')

  await page.getByRole('button', { name: '文件' }).click()
  const sftp = page.getByTestId('ssh-sftp-panel')
  await expect(sftp).toBeVisible({ timeout: 30_000 })
  const sftpBox = await sftp.boundingBox()
  expect(sftpBox?.width).toBeGreaterThan(0)
  expect(sftpBox?.height).toBeGreaterThan(0)

  await page.getByRole('button', { name: '终端' }).click()
  await expect(sftp).toBeHidden()
  await expect(terminal.locator('.xterm')).toBeVisible()
  await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
})
