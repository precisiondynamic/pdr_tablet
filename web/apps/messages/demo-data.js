/* Demo content for the Messages reference app. Everything here is fictional. */
window.MessagesDemo = (function () {
    var MIN = 60 * 1000, HOUR = 60 * MIN;

    var contacts = [
        { id: 'marcus', name: 'Marcus Vega', number: '(555) 014-2231', color: '#e66100' },
        { id: 'dani', name: 'Dani Okafor', number: '(555) 019-8874', color: '#9141ac' },
        { id: 'lscustoms', name: 'LS Customs', number: '(555) 010-4400', color: '#1c71d8', business: true },
        { id: 'jess', name: 'Jess Park', number: '(555) 012-7719', color: '#26a269' },
        { id: 'unknown', name: 'Unknown Number', number: 'No caller ID', color: '#5e5c64' },
        { id: 'ray', name: 'Ray “Tow” Delgado', number: '(555) 017-3350', color: '#c64600' },
    ];

    // [contact, from, text, minutes ago]
    var history = [
        ['marcus', 'them', 'you coming to the meet tonight?', 190],
        ['marcus', 'me', 'where at', 185],
        ['marcus', 'them', 'LS Customs lot on Popular st, after 10', 184],
        ['marcus', 'them', 'bring the Sultan, people been asking about it', 183],
        ['dani', 'them', 'you still owe me for the pizza lol', 600],
        ['dani', 'me', 'I paid you back in cash??', 590],
        ['dani', 'them', 'that was for the gas', 588],
        ['dani', 'them', 'nice try tho', 587],
        ['lscustoms', 'them', 'Your vehicle is ready for pickup. Ref #4471. We close at 22:00.', 75],
        ['jess', 'me', 'grabbing coffee at Bean Machine, want anything?', 1500],
        ['jess', 'them', 'iced latte pls 🙏', 1498],
        ['jess', 'them', 'also are we still on for sunday', 1497],
        ['unknown', 'them', 'we need to talk. not over the phone.', 45],
        ['unknown', 'them', 'pier. 2am. come alone.', 44],
        ['ray', 'them', 'found your car in Sandy. $450 for the tow, cash only', 2900],
        ['ray', 'me', 'thats robbery', 2890],
        ['ray', 'them', 'thats towing', 2889],
    ];

    // replies after you send something
    var replies = {
        marcus: ['bet', 'say less', 'lmk when you pull up', 'nah the cops rolled by earlier, keep it chill', 'bring cash for the pinks'],
        dani: ['lmao', 'ok but venmo me', 'you’re impossible', 'fine. but you’re buying next time', '🙄'],
        lscustoms: ['Thanks for your message. A technician will reply during opening hours.', 'This number does not accept replies. Call (555) 010-4400.'],
        jess: ['omw', 'yesss', 'sunday works, 2pm?', 'haha no way', 'call me when you’re free'],
        unknown: ['don’t text this number.', '...', 'you know what this is about.'],
        ray: ['price is the price', 'cash. only.', 'yard closes at 6, don’t be late'],
    };

    // unprompted messages used by the simulator
    var ambient = {
        marcus: ['yo you see what happened at the meet', 'track day saturday, you in?', 'someone just rolled up in a full kit Elegy 😭'],
        dani: ['are you alive', 'call me when you get this', 'guess who I just saw at the Vanilla Unicorn'],
        lscustoms: ['Reminder: your vehicle is still waiting for pickup. Storage fees apply after 48h.', 'Weekend deal: 15% off respray and tint.'],
        jess: ['did you see the news about the bank thing downtown??', 'coffee tomorrow?', 'sending you the pics from sunday'],
        unknown: ['tick tock.', 'you were followed. switch cars.', 'he knows.'],
        ray: ['another one of yours in the lot. figured you’d want to know', 'you owe me 450, just saying'],
    };

    function seed(now) {
        var threads = {};
        contacts.forEach(function (c) { threads[c.id] = []; });
        history.forEach(function (row, i) {
            var t = now - row[3] * MIN;
            threads[row[0]].push({
                id: 'seed' + i,
                from: row[1],
                text: row[2],
                time: t,
                // the recent ones start unread, so the badge has something to show on first launch
                read: row[1] === 'me' || row[3] > 120,
            });
        });
        return { contacts: contacts.slice(), threads: threads, demo: true };
    }

    return { seed: seed, replies: replies, ambient: ambient, HOUR: HOUR, MIN: MIN };
})();
