// Wallpapers are pure CSS so the OS ships without image assets.

export const WALLPAPERS = [
    {
        id: 'adwaita',
        name: 'Adwaita',
        css: `radial-gradient(circle at 78% 112%, #62a0ea 0 22%, transparent 22.3%),
              radial-gradient(circle at 78% 112%, #3584e4 0 34%, transparent 34.3%),
              radial-gradient(circle at 78% 112%, #1c71d8 0 47%, transparent 47.3%),
              radial-gradient(circle at 78% 112%, #1a5fb4 0 61%, transparent 61.3%),
              linear-gradient(160deg, #0f1a2e 0%, #13284d 100%)`,
    },
    {
        id: 'aubergine',
        name: 'Aubergine',
        css: `radial-gradient(ellipse 70% 60% at 85% 95%, rgba(233,84,32,.85) 0%, rgba(233,84,32,0) 60%),
              radial-gradient(ellipse 60% 50% at 20% 10%, rgba(119,33,111,.7) 0%, transparent 70%),
              linear-gradient(135deg, #2c001e 0%, #4c1440 55%, #77216f 100%)`,
    },
    {
        id: 'arch',
        name: 'Nightfall',
        css: `radial-gradient(ellipse 55% 45% at 50% 58%, rgba(23,147,209,.45) 0%, transparent 70%),
              radial-gradient(ellipse 90% 40% at 50% 110%, rgba(23,147,209,.35) 0%, transparent 70%),
              linear-gradient(180deg, #0b0e13 0%, #101722 100%)`,
    },
    {
        id: 'mint',
        name: 'Mint',
        css: `radial-gradient(ellipse 70% 55% at 15% 90%, rgba(135,207,62,.45) 0%, transparent 65%),
              radial-gradient(ellipse 60% 50% at 85% 15%, rgba(38,162,105,.45) 0%, transparent 70%),
              linear-gradient(160deg, #0d1f17 0%, #133024 55%, #1a3d2b 100%)`,
    },
    {
        id: 'plasma',
        name: 'Plasma',
        css: `linear-gradient(115deg, transparent 0 48%, rgba(61,174,233,.28) 48% 52%, transparent 52%),
              linear-gradient(115deg, transparent 0 58%, rgba(155,89,182,.3) 58% 64%, transparent 64%),
              radial-gradient(ellipse 80% 70% at 70% 60%, rgba(41,128,185,.55) 0%, transparent 70%),
              linear-gradient(160deg, #10141f 0%, #1b2233 60%, #232a3d 100%)`,
    },
    {
        id: 'slate',
        name: 'Slate',
        css: `radial-gradient(ellipse 70% 60% at 75% 75%, rgba(154,153,150,.18) 0%, transparent 65%),
              linear-gradient(160deg, #1a1a1c 0%, #242427 55%, #2d2d31 100%)`,
    },
];

export function wallpaperCss(settings) {
    if (settings.wallpaper === 'custom' && isSafeUrl(settings.customWallpaper)) {
        return `url(${JSON.stringify(settings.customWallpaper.trim())}) center / cover no-repeat, #1d1d20`;
    }
    return (WALLPAPERS.find((w) => w.id === settings.wallpaper) || WALLPAPERS[0]).css;
}

export function isSafeUrl(url) {
    return typeof url === 'string' && /^(https?:\/\/|nui:\/\/)[^\s"'()\\]+$/i.test(url.trim());
}
