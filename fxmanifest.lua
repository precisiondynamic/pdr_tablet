fx_version 'cerulean'
game 'gta5'

name 'pdr_tablet'
description 'PDR Tablet - tablet OS and app platform'
version '1.2.0'

-- UI layer only. The prop / DUI / input integration adds its client scripts here.
-- The OS page is loaded via nui://pdr_tablet/web/os/index.html (see docs/PROTOCOL.md).

files {
    'web/os/index.html',
    'web/os/css/*.css',
    'web/os/js/*.js',
    'web/os/fonts/*.woff2',
    'web/sdk/pdr-tablet.js',
}
