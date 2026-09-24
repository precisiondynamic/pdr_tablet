(function () {
    'use strict';
    var h = Kit.h, fill = Kit.fill, icon = Kit.icon;
    var tablet = PDRTablet;

    var MAX_NOTES = 500;
    var notes = [];          // { id, title, body, pinned, created, updated }
    var currentId = null;
    var query = '';
    var saveState = 'saved'; // 'saved' | 'saving' | 'error' | 'local'
    var persistent = tablet.inTablet;

    var listEl = document.getElementById('list');
    var mainEl = document.getElementById('main');
    var footerEl = document.getElementById('footer');
    var searchEl = document.getElementById('search');

    /* ---------- persistence ---------- */

    var save = Kit.debounce(function () {
        if (!persistent) return;
        saveState = 'saving';
        renderStatus();
        Promise.all([
            tablet.storage.set('notes', notes),
            tablet.storage.set('lastOpen', currentId),
        ]).then(function () {
            saveState = 'saved';
            renderStatus();
        }).catch(function (err) {
            saveState = 'error';
            renderStatus();
            Kit.toast('Couldn’t save: ' + err.message);
        });
    }, 500);

    function load() {
        if (!persistent) {
            saveState = 'local';
            return Promise.resolve();
        }
        return Promise.all([tablet.storage.get('notes'), tablet.storage.get('lastOpen')]).then(function (res) {
            notes = Array.isArray(res[0]) ? res[0].filter(function (n) { return n && n.id; }) : [];
            if (res[1] && find(res[1])) currentId = res[1];
        }).catch(function (err) {
            persistent = false;
            saveState = 'local';
            Kit.toast('Storage unavailable: ' + err.message);
        });
    }

    /* ---------- model ---------- */

    function find(id) { return notes.find(function (n) { return n.id === id; }) || null; }
    function uid() { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    function titleOf(n) { return n.title.trim() || firstLine(n.body) || 'Untitled Note'; }
    function firstLine(s) { return (s || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean)[0] || ''; }
    function snippet(n) {
        var lines = (n.body || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
        if (!n.title.trim()) lines.shift();
        return lines.join(' ').slice(0, 120);
    }
    function words(s) { return (s.trim().match(/\S+/g) || []).length; }

    function sorted() {
        return notes.slice().sort(function (a, b) {
            return (b.pinned - a.pinned) || (b.updated - a.updated);
        });
    }

    function visible() {
        if (!query) return sorted();
        var q = query.toLowerCase();
        return sorted().filter(function (n) {
            return n.title.toLowerCase().indexOf(q) !== -1 || n.body.toLowerCase().indexOf(q) !== -1;
        });
    }

    function create(title, body) {
        if (notes.length >= MAX_NOTES) {
            Kit.toast('You can keep up to ' + MAX_NOTES + ' notes');
            return null;
        }
        var now = Date.now();
        var note = { id: uid(), title: title || '', body: body || '', pinned: false, created: now, updated: now };
        notes.push(note);
        query = '';
        searchEl.value = '';
        open(note.id, true);
        save();
        return note;
    }

    function remove(id) {
        var index = notes.findIndex(function (n) { return n.id === id; });
        if (index === -1) return;
        var removed = notes.splice(index, 1)[0];
        if (currentId === id) currentId = null;
        renderList();
        renderEditor();
        save();
        Kit.toast('Note deleted', {
            label: 'Undo',
            onClick: function () {
                notes.push(removed);
                open(removed.id);
                save();
            },
        }, 5000);
    }

    function open(id, focusTitle) {
        currentId = id;
        renderList();
        renderEditor(focusTitle);
        save();
    }

    /* ---------- rendering ---------- */

    function renderStatus() {
        var total = notes.length;
        var text = total + (total === 1 ? ' note' : ' notes');
        var state = {
            saved: 'Saved',
            saving: 'Saving…',
            error: 'Not saved',
            local: 'Not saved (outside tablet)',
        }[saveState];
        fill(footerEl, h('span', null, text), h('span', { class: 'notes-save is-' + saveState }, state));
    }

    function renderList() {
        var items = visible();
        if (!notes.length) {
            fill(listEl, h('div', { class: 'notes-list-empty' }, 'No notes yet'));
        } else if (!items.length) {
            fill(listEl, h('div', { class: 'notes-list-empty' }, 'No notes match “' + query + '”'));
        } else {
            var pinned = items.filter(function (n) { return n.pinned; });
            var rest = items.filter(function (n) { return !n.pinned; });
            fill(listEl,
                pinned.length ? h('div', { class: 'notes-section' }, 'Pinned') : null,
                pinned.map(item),
                pinned.length && rest.length ? h('div', { class: 'notes-section' }, 'Notes') : null,
                rest.map(item));
        }
        renderStatus();
    }

    function item(n) {
        return h('button', {
            class: 'notes-item' + (n.id === currentId ? ' is-selected' : ''),
            'data-id': n.id,
            onClick: function () { open(n.id); },
        },
        h('div', { class: 'notes-item-title' }, n.pinned ? icon('pin', 'notes-item-pin') : null, h('span', null, titleOf(n))),
        h('div', { class: 'notes-item-meta' },
            h('span', { class: 'notes-item-time' }, Kit.relTime(n.updated)),
            h('span', { class: 'notes-item-snippet' }, snippet(n) || 'No additional text')));
    }

    function renderEditor(focusTitle) {
        var note = find(currentId);
        if (!note) {
            fill(mainEl, h('div', { class: 'status-page' },
                icon('note'),
                h('div', { class: 'status-title' }, notes.length ? 'No Note Selected' : 'Start Writing'),
                h('div', { class: 'status-desc' }, notes.length
                    ? 'Pick a note from the list, or start a new one.'
                    : 'Notes are saved on this tablet as you type.'),
                h('button', { class: 'btn btn-suggested btn-pill btn-lg', style: { marginTop: '1.6rem' }, onClick: function () { create(); } },
                    icon('plus'), 'New Note')));
            return;
        }

        var title = h('input', { class: 'notes-title', type: 'text', placeholder: 'Title', value: note.title, spellcheck: false, maxlength: 120 });
        var body = h('textarea', { class: 'notes-body', placeholder: 'Start typing…', spellcheck: false });
        body.value = note.body;
        var meta = h('span', { class: 'notes-meta dim' });

        var updateMeta = function () {
            meta.textContent = 'Edited ' + Kit.relTime(note.updated) + ' · ' + words(note.body) + ' words';
        };
        var changed = function () {
            note.title = title.value;
            note.body = body.value;
            note.updated = Date.now();
            updateMeta();
            // update just this row instead of rebuilding the list while typing
            var row = listEl.querySelector('[data-id="' + note.id + '"]');
            if (row) {
                row.querySelector('.notes-item-title span:last-child').textContent = titleOf(note);
                row.querySelector('.notes-item-snippet').textContent = snippet(note) || 'No additional text';
                row.querySelector('.notes-item-time').textContent = 'now';
            }
            save();
        };
        title.addEventListener('input', changed);
        body.addEventListener('input', changed);
        title.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); body.focus(); }
        });
        updateMeta();

        fill(mainEl,
            h('div', { class: 'notes-editor-bar' },
                meta,
                h('div', { class: 'notes-editor-actions' },
                    h('button', {
                        class: 'btn btn-flat' + (note.pinned ? ' is-active' : ''),
                        title: note.pinned ? 'Unpin' : 'Pin to top',
                        onClick: function () { note.pinned = !note.pinned; renderList(); renderEditor(); save(); },
                    }, icon('pin'), note.pinned ? 'Pinned' : 'Pin'),
                    h('button', {
                        class: 'btn btn-flat btn-destructive',
                        title: 'Delete note',
                        onClick: function () {
                            Kit.confirm({
                                title: 'Delete “' + titleOf(note) + '”?',
                                body: 'You can undo this for a few seconds afterwards.',
                                confirm: 'Delete',
                                destructive: true,
                            }).then(function (ok) { if (ok) remove(note.id); });
                        },
                    }, icon('trash'), 'Delete'))),
            h('div', { class: 'notes-editor' }, title, body));

        if (focusTitle) title.focus();
    }

    /* ---------- wiring ---------- */

    document.getElementById('search-icon').replaceWith(icon('search', 'notes-search-icon'));
    document.getElementById('new-note').append(icon('plus'));
    document.getElementById('new-note').addEventListener('click', function () { create(); });
    searchEl.addEventListener('input', function () { query = searchEl.value.trim(); renderList(); });
    document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); create(); }
    });

    function handleLaunch(data) {
        if (!data || typeof data !== 'object') return;
        if (data.note && find(data.note)) open(data.note);
        else if (data.create) create(String(data.title || ''), String(data.body || ''));
    }

    tablet.ready().then(function () {
        return load();
    }).then(function () {
        renderList();
        renderEditor();
        handleLaunch(tablet.launchData);
    });

    tablet.on('launch', handleLaunch);
    // leaving the foreground may be followed by eviction: write immediately
    tablet.on('hide', function () { save.flush(); });
    // relative times ("Edited 3 min ago") are stale after being in the background
    tablet.on('show', function () { renderList(); var n = find(currentId); if (n) renderEditor(); });
    setInterval(function () { if (tablet.visible) renderList(); }, 60000);
})();
