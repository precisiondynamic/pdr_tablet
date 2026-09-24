fx_version 'cerulean'
game 'gta5'

name 'pdr_tablet'
description 'PDR Tablet - tablet OS and app platform'
version '1.3.0'

-- UI layer only. The prop / DUI / input integration adds its client scripts here.
-- The OS page is loaded via nui://pdr_tablet/web/os/index.html (see docs/PROTOCOL.md).

files {
    'web/os/index.html',
    'web/os/css/*.css',
    'web/os/js/*.js',
    'web/os/fonts/*.woff2',
    'web/sdk/pdr-tablet.js',

    -- bundled reference apps (disable in-game with os:init { bundledApps = false })
    'web/apps/manifest.json',
    'web/apps/shared/*',
    'web/apps/*/index.html',
    'web/apps/*/*.css',
    'web/apps/*/*.js',
    'web/apps/*/*.svg',
    'web/apps/*/js/*.js',
}
