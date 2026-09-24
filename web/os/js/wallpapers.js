// Wallpapers are pure CSS so the OS ships without image assets.

export const WALLPAPERS = [
    {
        id: 'bloom',
        name: 'Bloom',
        css: `radial-gradient(ellipse 60% 55% at 72% 78%, rgba(125,180,255,.95) 0%, rgba(59,110,230,.75) 22%, transparent 60%),
              radial-gradient(ellipse 45% 70% at 88% 55%, rgba(80,140,255,.55) 0%, transparent 70%),
              radial-gradient(ellipse 80% 60% at 20% 10%, rgba(40,70,170,.55) 0%, transparent 70%),
              linear-gradient(160deg, #0a1a4a 0%, #0d2a7a 45%, #1646b8 75%, #0c1f5c 100%)`,
    },
    {
        id: 'aurora',
        name: 'Aurora',
        css: `radial-gradient(ellipse 70% 50% at 25% 30%, rgba(45,212,191,.55) 0%, transparent 65%),
              radial-gradient(ellipse 60% 60% at 80% 70%, rgba(139,92,246,.6) 0%, transparent 65%),
              radial-gradient(ellipse 50% 40% at 60% 20%, rgba(59,130,246,.45) 0%, transparent 70%),
              linear-gradient(180deg, #06121f 0%, #0b1730 60%, #120c2e 100%)`,
    },
    {
        id: 'dusk',
        name: 'Dusk',
        css: `radial-gradient(ellipse 70% 55% at 50% 100%, rgba(251,146,60,.8) 0%, rgba(236,72,153,.45) 35%, transparent 70%),
              radial-gradient(ellipse 60% 50% at 15% 20%, rgba(99,102,241,.45) 0%, transparent 70%),
              linear-gradient(180deg, #120a2a 0%, #2a1250 50%, #4a1648 100%)`,
    },
    {
        id: 'ocean',
        name: 'Ocean',
        css: `radial-gradient(ellipse 80% 60% at 30% 90%, rgba(14,165,233,.6) 0%, transparent 65%),
              radial-gradient(ellipse 60% 50% at 85% 25%, rgba(6,182,212,.35) 0%, transparent 70%),
              linear-gradient(200deg, #031525 0%, #05304a 55%, #064663 100%)`,
    },
    {
        id: 'forest',
        name: 'Forest',
        css: `radial-gradient(ellipse 70% 55% at 70% 80%, rgba(34,197,94,.45) 0%, transparent 65%),
              radial-gradient(ellipse 50% 50% at 20% 25%, rgba(20,184,166,.35) 0%, transparent 70%),
              linear-gradient(170deg, #04130d 0%, #0a2a1d 55%, #0f3a26 100%)`,
    },
    {
        id: 'graphite',
        name: 'Graphite',
        css: `radial-gradient(ellipse 70% 60% at 75% 70%, rgba(148,163,184,.22) 0%, transparent 65%),
              radial-gradient(ellipse 50% 50% at 20% 20%, rgba(100,116,139,.2) 0%, transparent 70%),
              linear-gradient(160deg, #0b0d12 0%, #151922 55%, #1c212c 100%)`,
    },
];

export function wallpaperCss(settings) {
    if (settings.wallpaper === 'custom' && isSafeUrl(settings.customWallpaper)) {
        return `url(${JSON.stringify(settings.customWallpaper)}) center / cover no-repeat, #0b1220`;
    }
    return (WALLPAPERS.find((w) => w.id === settings.wallpaper) || WALLPAPERS[0]).css;
}

export function isSafeUrl(url) {
    return typeof url === 'string' && /^(https?:\/\/|nui:\/\/)[^\s"'()]+$/i.test(url.trim());
}
