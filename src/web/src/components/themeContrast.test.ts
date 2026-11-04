import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const [light, dark] = css.split('@media (prefers-color-scheme: dark)')
function color(theme: string, name: string): string {
  const result = new RegExp('--' + name + ':\\s*(#[a-fA-F0-9]{3,6})[;\\s]').exec(theme)
  if (!result) throw Error('Missing theme token: ' + name)
  return result[1]
}
function luminance(hex: string): number {
  let raw = hex.slice(1); if (raw.length === 3) raw = [...raw].map(s => s + s).join('')
  const rgb = [0, 2, 4].map(i => parseInt(raw.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
}
function contrast(a: string, b: string): number {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + 0.05) / (values[1] + 0.05)
}
describe('theme text contrast guard', () => {
  it.each([['light', light], ['dark', dark]])('%s body, heading and primary button tokens meet 4.5:1', (_name, theme) => {
    expect(contrast(color(theme, 'text'), color(theme, 'bg'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color(theme, 'text'), color(theme, 'page-bg'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color(theme, 'text'), color(theme, 'surface'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color(theme, 'text-h'), color(theme, 'bg'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color(theme, 'button-primary-text'), color(theme, 'accent'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color(theme, 'accent'), color(theme, 'bg'))).toBeGreaterThanOrEqual(4.5)
  })
})
