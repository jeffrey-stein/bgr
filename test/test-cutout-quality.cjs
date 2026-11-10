const { chromium } = require('playwright-core')
const path = require('path')

// Measures cutout quality on a real subject:
//  - hardSteps: opaque pixels sitting next to fully transparent ones (jagged edge)
//  - partialPct: share of pixels carrying a soft alpha (hair/edge detail)
//  - coverage: how much of the frame survived as foreground
;(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const logs = []
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.getByText('Start a project', { exact: false }).first().click()
  await page.waitForTimeout(1200)
  await page.getByText('Continue without account', { exact: false }).click()
  await page.waitForTimeout(1000)

  await page.setInputFiles(
    'input[type=file]',
    path.join(__dirname, 'fixtures/sample-person.jpg'),
  )
  await page.waitForTimeout(2500)

  await page.locator('button.canvas-quick-cutout').click()
  await page.waitForFunction(
    () => /Background removed/.test(document.body.innerText),
    null,
    { timeout: 60000 },
  )
  await page.waitForTimeout(2000)
  await page.screenshot({ path: 'shot-cutout-after.png' })

  const stats = await page.evaluate(async () => {
    // The cutout is the blob rendered several times in the stage/inspector.
    const imgs = [...document.querySelectorAll('img')].filter(
      (i) => i.src.startsWith('blob:') && i.naturalWidth > 500,
    )
    if (!imgs.length) return { error: 'no cutout image' }
    const src = imgs[imgs.length - 1].src

    const image = new Image()
    image.src = src
    await image.decode()

    const w = image.naturalWidth
    const h = image.naturalHeight
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(image, 0, 0)
    const data = ctx.getImageData(0, 0, w, h).data

    let opaque = 0
    let transparent = 0
    let partial = 0
    let hardSteps = 0
    let softRuns = 0
    const a = (i) => data[i * 4 + 3]

    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x
        const av = a(i)
        if (av > 250) opaque += 1
        else if (av < 5) transparent += 1
        else partial += 1

        const right = a(i + 1)
        const down = a(i + w)
        if ((av > 250 && right < 5) || (av < 5 && right > 250)) hardSteps += 1
        if ((av > 250 && down < 5) || (av < 5 && down > 250)) hardSteps += 1
        if (av >= 5 && av <= 250) softRuns += 1
      }
    }
    const total = opaque + transparent + partial
    return {
      size: `${w}x${h}`,
      opaquePct: +((100 * opaque) / total).toFixed(2),
      transparentPct: +((100 * transparent) / total).toFixed(2),
      partialPct: +((100 * partial) / total).toFixed(2),
      hardStepRatePer10k: +((10000 * hardSteps) / total).toFixed(2),
      coveragePct: +((100 * (opaque + partial)) / total).toFixed(2),
    }
  })

  console.log('CUTOUT STATS', JSON.stringify(stats, null, 2))
  console.log('LOGS', logs.slice(-15).join('\n'))
  await browser.close()
})().catch((err) => {
  console.error('FAILED', err)
  process.exit(1)
})
