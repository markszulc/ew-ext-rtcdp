// Loads Spectrum Web Components from the CDN and registers the Spectrum 2 theme.
// jsDelivr's +esm builds inline a private copy of the Theme class into every theme entry file,
// so the stock `theme-*.js` registrations never reach the defined <sp-theme>. Registering the
// CSS-only fragment modules on the defined element class avoids that.
const SWC_VERSION = '1.12.6';
const CDN = 'https://cdn.jsdelivr.net/npm/@spectrum-web-components';
const THEME = `${CDN}/theme@${SWC_VERSION}/src/spectrum-two`;

const FRAGMENTS = [
  ['spectrum-two', 'system', `${THEME}/theme.css.js/+esm`],
  ['light-spectrum-two', 'color', `${THEME}/theme-light.css.js/+esm`],
  ['dark-spectrum-two', 'color', `${THEME}/theme-dark.css.js/+esm`],
  ['medium-spectrum-two', 'scale', `${THEME}/scale-medium.css.js/+esm`],
];

// Spectrum workflow icons are not part of the elements bundle, so they are loaded individually.
export const ICONS = [
  'user-group', 'refresh', 'settings', 'copy', 'text', 'checkmark-circle', 'add-circle', 'clock', 'info', 'chat',
];

function loadIcons() {
  return Promise.allSettled(ICONS
    .filter((name) => !customElements.get(`sp-icon-${name}`))
    .map((name) => import(`${CDN}/icons-workflow@${SWC_VERSION}/icons/sp-icon-${name}.js/+esm`)));
}

export default async function loadSpectrum() {
  await import(`${CDN}/bundle@${SWC_VERSION}/elements.js/+esm`);
  const Theme = customElements.get('sp-theme');
  const [styles] = await Promise.all([
    Promise.all(FRAGMENTS.map(([, , url]) => import(url))),
    loadIcons(),
  ]);
  FRAGMENTS.forEach(([name, kind], i) => Theme.registerThemeFragment(name, kind, styles[i].default));
  return Theme;
}
