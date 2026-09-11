import assert from 'node:assert/strict';
import test from 'node:test';

const themes = {
  mise: { background: '#f5f2ec', foreground: '#1f1c16', muted: '#6e6759', accent: '#8a3324' },
  ink: { background: '#f2f2ef', foreground: '#171717', muted: '#62625e', accent: '#111111' },
  ocean: { background: '#eef4f3', foreground: '#17302f', muted: '#56706d', accent: '#176b73' },
  plum: { background: '#f5f0f4', foreground: '#352333', muted: '#756371', accent: '#813c72' },
  marketing: { background: '#fafaf7', foreground: '#14110a', muted: '#6b5d3a', accent: '#c63e19' },
};

function luminance(hex: string): number {
  const channels = hex.match(/[a-f0-9]{2}/gi)?.map(value => {
    const channel = Number.parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) || [];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first: string, second: string): number {
  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (light + 0.05) / (dark + 0.05);
}

for (const [name, theme] of Object.entries(themes)) {
  test(`${name} theme text colors meet WCAG AA contrast`, () => {
    assert.ok(contrast(theme.foreground, theme.background) >= 4.5);
    assert.ok(contrast(theme.muted, theme.background) >= 4.5);
    assert.ok(contrast(theme.accent, theme.background) >= 4.5);
  });
}
