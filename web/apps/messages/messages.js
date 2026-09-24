(function () {
    'use strict';
    var h = Kit.h, fill = Kit.fill, icon = Kit.icon;
    var tablet = PDRTablet;
    var Demo = window.MessagesDemo;

    var TRAFFIC_MIN = 40 * 1000;   // simulated message every 40–90 s
    var TRAFFIC_MAX = 90 * 1000;

    var data = null;               // { contacts, threads: { id: [msg] }, demo }
    var openId = null;
    var typing = {};               // contactId → true while a reply is "being typed"
    var trafficTimer = null;

    var threadsEl = document.getElementById('threads');
    var mainEl = document.getElementById('main');
    var demoSwitch = document.getElementById('demo-switch');

    /* ---------- persistence ---------- */

    var save = Kit.debounce(function () {
        if (tablet.inTablet) tablet.storage.set('messages', data).catch(function (e) { Kit.toast('Couldn’t save: ' + e.message); });
    }, 400);

    /* ---------- model ---------- */

    function contact(id) { return data.contacts.find(function (c) { return c.id === id; }) || null; }
    function thread(id) { return data.threads[id] || (data.threads[id] = []); }
    function last(id) { var t = thread(id); return t[t.length - 1] || null; }
    function unread(id) { return thread(id).filter(function (m) { return m.from === 'them' && !m.read; }).length; }
    function totalUnread() { return data.contacts.reduce(function (sum, c) { return sum + unread(c.id); }, 0); }
    function initials(name) {
        return name.replace(/[“”"()]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
    }
    function mid() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

    function isViewing(id) { return tablet.visible && openId === id; }

    function syncBadge() { if (tablet.inTablet) tablet.setBadge(totalUnread()); }

    function markRead(id) {
        var changed = false;
        thread(id).forEach(function (m) { if (!m.read) { m.read = true; changed = true; } });
        if (changed) { save(); syncBadge(); }
    }

    /**
     * A message arrives from a contact. Notifies (with a deep link to the thread) unless the
     * user is looking at that conversation right now.
     */
    function receive(contactId, text) {
        var c = contact(contactId);
        if (!c || !text) return;
        var viewing = isViewing(contactId);
        thread(contactId).push({ id: mid(), from: 'them', text: String(text).slice(0, 1000), time: Date.now(), read: viewing });
        save();
        syncBadge();
        if (!viewing && tablet.inTablet) tablet.notify({ title: c.name, body: text, data: { thread: contactId } });
        renderThreads();
        if (openId === contactId) renderConversation(true);
    }

    function send(text) {
        if (!openId || !text.trim()) return;
        var id = openId;
        thread(id).push({ id: mid(), from: 'me', text: text.trim().slice(0, 1000), time: Date.now(), read: true });
        save();
        renderThreads();
        renderConversation(true);
        scheduleReply(id);
    }

    function scheduleReply(id) {
        var pool = Demo.replies[id];
        if (!pool || typing[id]) return;
        setTimeout(function () {
            typing[id] = true;
            if (openId === id) renderConversation(true);
            setTimeout(function () {
                typing[id] = false;
                receive(id, pool[Math.floor(Math.random() * pool.length)]);
            }, 1400 + Math.random() * 1800);
        }, 600 + Math.random() * 900);
    }

    /* ---------- simulated traffic (runs in the background too) ---------- */

    function scheduleTraffic() {
        clearTimeout(trafficTimer);
        if (!data.demo) return;
        trafficTimer = setTimeout(function () {
            simulateIncoming();
            scheduleTraffic();
        }, TRAFFIC_MIN + Math.random() * (TRAFFIC_MAX - TRAFFIC_MIN));
    }

    function simulateIncoming(contactId) {
        var ids = Object.keys(Demo.ambient);
        var id = contactId || ids[Math.floor(Math.random() * ids.length)];
        var pool = Demo.ambient[id];
        receive(id, pool[Math.floor(Math.random() * pool.length)]);
    }

    /* ---------- rendering ---------- */

    function avatar(c, size) {
        return h('span', { class: 'msg-avatar ' + (size || ''), style: { background: c.color } }, initials(c.name));
    }

    function dayLabel(ts) {
        var d = new Date(ts), today = new Date();
        var y = new Date(); y.setDate(today.getDate() - 1);
        if (d.toDateString() === today.toDateString()) return 'Today';
        if (d.toDateString() === y.toDateString()) return 'Yesterday';
        return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    }

    function shortTime(ts) {
        var d = new Date(ts);
        if (d.toDateString() === new Date().toDateString()) return Kit.clock(ts, tablet.settings.clock24h);
        return Kit.relTime(ts);
    }

    function renderThreads() {
        var ids = data.contacts.map(function (c) { return c.id; })
            .filter(function (id) { return thread(id).length; })
            .sort(function (a, b) { return (last(b).time || 0) - (last(a).time || 0); });

        if (!ids.length) {
            fill(threadsEl, h('div', { class: 'msg-empty-list dim' }, 'No conversations'));
            return;
        }
        fill(threadsEl, ids.map(function (id) {
            var c = contact(id), m = last(id), n = unread(id);
            return h('button', {
                class: 'msg-thread' + (id === openId ? ' is-selected' : '') + (n ? ' is-unread' : ''),
                'data-id': id,
                onClick: function () { openThread(id); },
            },
            avatar(c),
            h('div', { class: 'msg-thread-text' },
                h('div', { class: 'msg-thread-top' },
                    h('span', { class: 'msg-thread-name' }, c.name),
                    h('span', { class: 'msg-thread-time' }, shortTime(m.time))),
                h('div', { class: 'msg-thread-bottom' },
                    h('span', { class: 'msg-thread-preview' }, typing[id] ? 'typing…' : (m.from === 'me' ? 'You: ' : '') + m.text),
                    n ? h('span', { class: 'msg-count' }, String(n)) : null)));
        }));
    }

    function renderConversation(keepInput) {
        var c = contact(openId);
        if (!c) {
            fill(mainEl, h('div', { class: 'status-page' },
                icon('chat'),
                h('div', { class: 'status-title' }, 'No Conversation Selected'),
                h('div', { class: 'status-desc' }, totalUnread()
                    ? 'You have ' + totalUnread() + ' unread message' + (totalUnread() === 1 ? '' : 's') + '.'
                    : 'Pick a conversation from the list.')));
            return;
        }

        var oldInput = mainEl.querySelector('.msg-input');
        var draft = keepInput && oldInput ? oldInput.value : '';
        var hadFocus = keepInput && oldInput && document.activeElement === oldInput;

        var messages = thread(openId);
        var list = h('div', { class: 'msg-list' });
        var lastDay = null;
        messages.forEach(function (m, i) {
            var day = new Date(m.time).toDateString();
            if (day !== lastDay) { list.append(h('div', { class: 'msg-day' }, dayLabel(m.time))); lastDay = day; }
            var next = messages[i + 1];
            var tail = !next || next.from !== m.from || next.time - m.time > 5 * 60 * 1000;
            list.append(h('div', { class: 'msg-bubble-row from-' + m.from + (tail ? ' has-tail' : '') },
                h('div', { class: 'msg-bubble' }, m.text,
                    tail ? h('span', { class: 'msg-bubble-time' }, Kit.clock(m.time, tablet.settings.clock24h)) : null)));
        });
        if (typing[openId]) list.append(h('div', { class: 'msg-bubble-row from-them has-tail' }, h('div', { class: 'msg-bubble msg-typing' }, h('i'), h('i'), h('i'))));

        var input = h('input', { class: 'entry msg-input', type: 'text', placeholder: 'Message ' + c.name.split(' ')[0], maxlength: 1000, spellcheck: false });
        input.value = draft;
        var sendBtn = h('button', { class: 'btn btn-suggested btn-circle msg-send', title: 'Send', disabled: !draft.trim() }, icon('send'));
        input.addEventListener('input', function () { sendBtn.disabled = !input.value.trim(); });
        var submit = function () {
            var text = input.value;
            if (!text.trim()) return;
            input.value = '';
            send(text);
        };
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
        sendBtn.addEventListener('click', submit);

        fill(mainEl,
            h('header', { class: 'msg-header' },
                avatar(c, 'is-small'),
                h('div', null,
                    h('div', { class: 'msg-header-name' }, c.name),
                    h('div', { class: 'msg-header-sub dim' }, typing[openId] ? 'typing…' : c.number))),
            list,
            h('div', { class: 'msg-composer' }, input, sendBtn));

        list.scrollTop = list.scrollHeight;
        if (hadFocus || !keepInput) input.focus({ preventScroll: true });
    }

    function openThread(id) {
        openId = id;
        markRead(id);
        renderThreads();
        renderConversation(false);
    }

    function compose() {
        var layer;
        var close = function () { layer.remove(); };
        layer = h('div', { class: 'kit-dialog-layer', onPointerdown: function (e) { if (e.target === layer) close(); } },
            h('div', { class: 'kit-dialog msg-picker' },
                h('div', { class: 'kit-dialog-title' }, 'New Message'),
                h('div', { class: 'msg-picker-list' }, data.contacts.map(function (c) {
                    return h('button', { class: 'msg-picker-row', onClick: function () { close(); openThread(c.id); } },
                        avatar(c, 'is-small'), h('div', null, h('div', { class: 'msg-thread-name' }, c.name), h('div', { class: 'dim' }, c.number)));
                })),
                h('button', { class: 'btn', style: { width: '100%', marginTop: '1.6rem' }, onClick: close }, 'Cancel')));
        document.body.append(layer);
    }

    function renderDemoSwitch() {
        demoSwitch.classList.toggle('is-on', !!data.demo);
        demoSwitch.setAttribute('aria-checked', String(!!data.demo));
    }

    /* ---------- wiring ---------- */

    document.getElementById('mark-read').append(icon('checkAll'));
    document.getElementById('compose').append(icon('plus'));
    document.getElementById('mark-read').addEventListener('click', function () {
        data.contacts.forEach(function (c) { markRead(c.id); });
        renderThreads();
        Kit.toast('All messages marked as read');
    });
    document.getElementById('compose').addEventListener('click', compose);
    demoSwitch.addEventListener('click', function (e) {
        e.preventDefault();
        data.demo = !data.demo;
        renderDemoSwitch();
        scheduleTraffic();
        save();
    });

    function handleLaunch(launch) {
        if (launch && typeof launch === 'object' && launch.thread && contact(launch.thread)) openThread(launch.thread);
    }

    tablet.ready().then(function () {
        return tablet.inTablet ? tablet.storage.get('messages').catch(function () { return null; }) : null;
    }).then(function (stored) {
        data = stored && stored.contacts && stored.threads ? stored : Demo.seed(Date.now());
        if (!stored) save();
        renderDemoSwitch();
        renderThreads();
        renderConversation(false);
        syncBadge();
        scheduleTraffic();
        handleLaunch(tablet.launchData);
    });

    tablet.on('launch', handleLaunch);
    tablet.on('show', function () {
        if (!data) return;
        if (openId) markRead(openId);
        renderThreads();
        if (openId) renderConversation(true);
    });
    tablet.on('hide', function () { save.flush(); });

    // the host (e.g. a phone/SMS resource) can push real messages:
    //   SendAppMessage('pdr.messages', 'incoming', { from = 'Dani Okafor', text = 'hey' })
    tablet.on('message:incoming', function (msg) {
        if (!msg || !msg.text || !data) return;
        var from = String(msg.from || 'Unknown Number');
        var c = data.contacts.find(function (x) { return x.id === from || x.name === from; });
        if (!c) {
            c = { id: 'c' + Date.now().toString(36), name: from.slice(0, 40), number: msg.number || 'Unknown', color: '#5e5c64' };
            data.contacts.push(c);
        }
        receive(c.id, msg.text);
    });

    setInterval(function () { if (data && tablet.visible) renderThreads(); }, 60000);

    // test hook (automated tests run inside this frame)
    window.__messages = { simulateIncoming: simulateIncoming, totalUnread: function () { return totalUnread(); } };
})();
