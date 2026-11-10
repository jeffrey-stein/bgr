const { chromium } = require('playwright-core')
const path = require('path')
const fs = require('fs')

// Dumps an alpha histogram plus two visualisations:
//  - alpha heatmap (white = opaque, black = transparent, grey = partial)
//  - cutout composited over magenta so halos/leakage are obvious
;(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))

  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173', { waitUntil: 'networkidle' })
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
  await page.waitForTimeout(2500)

  const out = await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll('img')].filter(
      (i) => i.src.startsWith('blob:') && i.naturalWidth > 500,
    )
    if (!imgs.length) return { error: 'no cutout image' }
    const image = new Image()
    image.src = imgs[imgs.length - 1].src
    await image.decode()

    const w = image.naturalWidth
    const h = image.naturalHeight
    const src = document.createElement('canvas')
    src.width = w
    src.height = h
    const sctx = src.getContext('2d', { willReadFrequently: true })
    sctx.drawImage(image, 0, 0)
    const data = sctx.getImageData(0, 0, w, h).data

    // Histogram in 20 buckets.
    const buckets = new Array(20).fill(0)
    let total = 0
    for (let i = 3; i < data.length; i += 4) {
      buckets[Math.min(19, Math.floor(data[i] / 13))] += 1
      total += 1
    }
    const histogram = buckets.map((n, i) => ({
      range: `${i * 13}-${i * 13 + 12}`,
      pct: +((100 * n) / total).toFixed(2),
    }))

    // Alpha heatmap.
    const heat = document.createElement('canvas')
    heat.width = w
    heat.height = h
    const hctx = heat.getContext('2d')
    const himage = hctx.createImageData(w, h)
    for (let i = 0; i < total; i += 1) {
      const a = data[i * 4 + 3]
      himage.data[i * 4] = a
      himage.data[i * 4 + 1] = a
      himage.data[i * 4 + 2] = a
      himage.data[i * 4 + 3] = 255
    }
    hctx.putImageData(himage, 0, 0)

    // Over magenta.
    const mag = document.createElement('canvas')
    mag.width = w
    mag.height = h
    const mctx = mag.getContext('2d')
    mctx.fillStyle = '#ff00ff'
    mctx.fillRect(0, 0, w, h)
    mctx.drawImage(image, 0, 0)

    return {
      histogram,
      heat: heat.toDataURL('image/png'),
      magenta: mag.toDataURL('image/png'),
    }
  })

  if (out.error) {
    console.log('ERROR', out.error)
  } else {
    console.log('ALPHA HISTOGRAM (bucket -> % of pixels)')
    for (const row of out.histogram) {
      if (row.pct > 0.05) console.log(`  ${row.range}: ${row.pct}%`)
    }
    for (const [name, key] of [['alpha-heat', 'heat'], ['cutout-magenta', 'magenta']]) {
      const b64 = out[key].replace(/^data:image\/png;base64,/, '')
      fs.writeFileSync(path.join(__dirname, '..', `${name}.png`), Buffer.from(b64, 'base64'))
      console.log('wrote', `${name}.png`)
    }
  }
  await browser.close()
})().catch((err) => {
  console.error('FAILED', err)
  process.exit(1)
})
