const { chromium } = require('playwright-core')
const path = require('path')

// Hunts for the two photo-cutout complaints:
//  1. "white marks" — edge pixels whose unmixing divided by a tiny alpha and
//     clamped every channel to 255, so they read as bright specks.
//  2. "leftover background bits" — near-opaque pixels sitting alone in what
//     should be transparent space (islands outside the main subject).
;(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.getByText('Start a project', { exact: false }).first().click()
  await page.waitForTimeout(1200)
  await page.getByText('Continue without account', { exact: false }).click()
  await page.waitForTimeout(1000)

  await page.setInputFiles('input[type=file]', path.join(__dirname, 'fixtures/sample-person.jpg'))
  await page.waitForTimeout(2500)
  await page.locator('button.canvas-quick-cutout').click()
  await page.waitForFunction(() => /Background removed/.test(document.body.innerText), null, {
    timeout: 90000,
  })
  await page.waitForTimeout(2000)

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
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(image, 0, 0)
    const d = ctx.getImageData(0, 0, w, h).data

    let whiteEdge = 0 // partial alpha, all channels blown to ~255
    let partialTotal = 0
    let brightEdge = 0 // partial alpha, all channels >= 240
    let backdropTint = 0 // partial alpha still sitting on the backdrop colour
    const total = w * h

    // The source photo's studio backdrop (sampled from the original).
    const BG = [131, 154, 172]

    for (let i = 0; i < total; i += 1) {
      const o = i * 4
      const a = d[o + 3]
      if (a >= 8 && a <= 250) {
        partialTotal += 1
        const R = d[o]
        const G = d[o + 1]
        const B = d[o + 2]
        if (R >= 250 && G >= 250 && B >= 250) whiteEdge += 1
        if (R >= 240 && G >= 240 && B >= 240) brightEdge += 1
        const dr = R - BG[0]
        const dg = G - BG[1]
        const db = B - BG[2]
        if (Math.sqrt(dr * dr + dg * dg + db * db) < 30) backdropTint += 1
      }
    }

    return {
      size: `${w}x${h}`,
      partialPct: +((100 * partialTotal) / total).toFixed(2),
      whiteEdge,
      whiteEdgePctOfPartial: +((100 * whiteEdge) / Math.max(1, partialTotal)).toFixed(3),
      brightEdge,
      brightEdgePctOfPartial: +((100 * brightEdge) / Math.max(1, partialTotal)).toFixed(3),
      backdropTint,
      backdropTintPctOfPartial: +((100 * backdropTint) / Math.max(1, partialTotal)).toFixed(2),
    }
  })

  console.log('WHITE/BRIGHT EDGE DIAG', JSON.stringify(out, null, 2))
  await browser.close()
})().catch((err) => {
  console.error('FAILED', err)
  process.exit(1)
})
