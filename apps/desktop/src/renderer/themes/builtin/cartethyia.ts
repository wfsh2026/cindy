import lockupLight from '../../../../../../mods/cartethyia-theme/assets/cindy-logo-light.png';
import lockupDark from '../../../../../../mods/cartethyia-theme/assets/cindy-logo-dark.png';
import manifest from '../../../../../../mods/cartethyia-theme/manifest.json';
import darkColors from '../../../../../../mods/cartethyia-theme/colors/dark.json';
import lightColors from '../../../../../../mods/cartethyia-theme/colors/light.json';
import { cindyDark } from './cindy-dark';
import { cindyLight } from './cindy-light';
import type { Theme, ThemeBrand, ThemeModMetadata } from '../types';
import asset0 from '../../../../../../mods/cartethyia-theme/assets/head-image-light.png';
import asset1 from '../../../../../../mods/cartethyia-theme/assets/logo-light.png';
import asset2 from '../../../../../../mods/cartethyia-theme/assets/login/hero.png';
import asset3 from '../../../../../../mods/cartethyia-theme/assets/login/hero@2x.png';
import asset4 from '../../../../../../mods/cartethyia-theme/assets/login/wordmark.png';
import asset5 from '../../../../../../mods/cartethyia-theme/assets/login/wordmark@2x.png';
import asset6 from '../../../../../../mods/cartethyia-theme/assets/login/chibi/chibi-success.png';
import asset7 from '../../../../../../mods/cartethyia-theme/assets/login/chibi/chibi-failure.png';
import asset8 from '../../../../../../mods/cartethyia-theme/assets/login/chibi/chibi-neutral.png';
import asset9 from '../../../../../../mods/cartethyia-theme/assets/cindy-share-character.png';
import asset10 from '../../../../../../mods/cartethyia-theme/assets/head-image-dark.png';
import asset11 from '../../../../../../mods/cartethyia-theme/assets/logo-dark.png';
import asset12 from '../../../../../../mods/cartethyia-theme/assets/login/wordmark-dark.png';
import asset13 from '../../../../../../mods/cartethyia-theme/assets/login/wordmark-dark@2x.png';

const mod: ThemeModMetadata = { id: manifest.id, version: manifest.version, source: 'builtin', ...manifest.identity };
const lightBrand: ThemeBrand = {
  icon: { src: asset0 },
  logo: { src: lockupLight },
  wordmark: { src: asset1 },
  avatar: { src: asset0 },
  loading: { src: asset1 },
  loginHero: { src: asset2 },
  loginHero2x: { src: asset3 },
  loginWordmark: { src: asset4 },
  loginWordmark2x: { src: asset5 },
  statusSuccess: { src: asset6 },
  statusFailure: { src: asset7 },
  statusNeutral: { src: asset8 },
  shareCharacter: { src: asset9 },
};
export const cartethyiaLight: Theme = {
  id: 'cartethyia-light', name: 'Cartethyia Light', type: 'light', family: 'cartethyia', mod,
  colors: { ...cindyLight.colors, ...lightColors }, brand: lightBrand,
};
const darkBrand: ThemeBrand = {
  icon: { src: asset10 },
  logo: { src: lockupDark },
  wordmark: { src: asset11 },
  avatar: { src: asset10 },
  loading: { src: asset11 },
  loginHero: { src: asset2 },
  loginHero2x: { src: asset3 },
  loginWordmark: { src: asset12 },
  loginWordmark2x: { src: asset13 },
  statusSuccess: { src: asset6 },
  statusFailure: { src: asset7 },
  statusNeutral: { src: asset8 },
  shareCharacter: { src: asset9 },
};
export const cartethyiaDark: Theme = {
  id: 'cartethyia-dark', name: 'Cartethyia Drak', type: 'dark', family: 'cartethyia', mod,
  colors: { ...cindyDark.colors, ...darkColors }, brand: darkBrand,
};
