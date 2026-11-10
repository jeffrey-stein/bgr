const { chromium } = require('playwright-core')
const path = require('path')
const fs = require('fs')

;(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const page = await context.newPage()
  const logs = []
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })

  // Landing page -> studio (no account).
  await page.waitForTimeout(1200)
  await page.getByText('Start a project', { exact: false }).first().click()
  await page.waitForTimeout(1200)
  await page.getByText('Continue without account', { exact: false }).click()
  await page.waitForTimeout(1000)

  await page.setInputFiles('input[type=file]', path.join(__dirname, 'fixtures/sample-person.webm'))
  await page.waitForSelector('[class*=asset]', { timeout: 30000 })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: 'shot-video-loaded.png' })
  console.log('loaded status', await page.locator('.canvas-status').allTextContents())

  await page.locator('.canvas-quick-cutout').click()
  console.log('toggled cutout')
  await page.waitForFunction(
    () => document.querySelector('.canvas-status')?.textContent?.includes('live'),
    null,
    { timeout: 60000 },
  )
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'shot-video-cutout.png' })
  console.log('cutout status', await page.locator('.canvas-status').allTextContents())

  await page.locator('.timeline-play').click()
  await page.waitForTimeout(1100)
  await page.screenshot({ path: 'shot-video-playing.png' })
  await page.locator('.timeline-play').click()

  await page.locator('.footer-audio').click()
  await page.waitForTimeout(300)
  await page.locator('.audio-extract-card .primary-action').click()
  await page.waitForSelector('.audio-player', { timeout: 60000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'shot-audio-ready.png' })
  console.log('audio', await page.locator('.audio-player').count(), await page.locator('.toast').allTextContents())

  await page.locator('.footer-export').click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'shot-export-modal.png' })
  console.log('format card', await page.locator('.export-format-card').allTextContents())
  console.log('export disabled', await page.locator('.export-run').isDisabled())

  const downloadPromise = page.waitForEvent('download', { timeout: 180000 })
  await page.locator('.export-run').click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'shot-export-progress.png' })
  const download = await downloadPromise
  const savePath = path.join(__dirname, 'exported-greenscreen.' + download.suggestedFilename().split('.').pop())
  await download.saveAs(savePath)
  console.log('DOWNLOADED', savePath, fs.statSync(savePath).size)
  await page.waitForTimeout(1000)
  await page.screenshot({ path: 'shot-export-done.png' })
  console.log('LOGS', logs.slice(-40).join('\n'))
  await browser.close()
})()
