(function () {
    'use strict';
    var h = Kit.h, fill = Kit.fill;

    /* ------------------------------------------------------------------ */
    /* evaluator — recursive descent, no eval()                            */
    /*   expr    = term (('+'|'−') term)*                                  */
    /*   term    = unary (('×'|'÷') unary | implicit-multiply unary)*      */
    /*   unary   = ('−'|'+') unary | postfix                               */
    /*   postfix = primary ('²' | '%')*                                    */
    /*   primary = number | '(' expr ')' | '√' unary                       */
    /* ------------------------------------------------------------------ */

    function CalcError(message) { this.message = message; }

    function tokenize(src) {
        var out = [], i = 0;
        while (i < src.length) {
            var c = src[i];
            if (/[0-9.]/.test(c)) {
                // plain numbers, plus exponent form so huge/tiny results can be reused ("1e+21")
                var m = /^[0-9.]+(?:e[+\-]?[0-9]+)?/.exec(src.slice(i));
                var text = m[0];
                if ((text.match(/\./g) || []).length > 1) throw new CalcError('Invalid number');
                out.push({ t: 'num', v: parseFloat(text === '.' ? '0' : text) });
                i += text.length;
            } else if ('+−×÷()²%√'.indexOf(c) !== -1) {
                out.push({ t: c });
                i++;
            } else {
                i++;   // ignore anything else (spaces, separators)
            }
        }
        return out;
    }

    function evaluate(src) {
        var tokens = tokenize(src);
        if (!tokens.length) return null;
        // be forgiving: auto-close open brackets and ignore a trailing operator
        var open = 0;
        tokens.forEach(function (t) { if (t.t === '(') open++; if (t.t === ')') open--; });
        while (open-- > 0) tokens.push({ t: ')' });
        while (tokens.length && '+−×÷√('.indexOf(tokens[tokens.length - 1].t) !== -1) tokens.pop();
        if (!tokens.length) return null;

        var pos = 0;
        var peek = function () { return tokens[pos] || { t: 'end' }; };
        var next = function () { return tokens[pos++]; };

        function expr() {
            var v = term();
            while (peek().t === '+' || peek().t === '−') v = next().t === '+' ? v + term() : v - term();
            return v;
        }
        function term() {
            var v = unary();
            for (;;) {
                var t = peek().t;
                if (t === '×') { next(); v *= unary(); }
                else if (t === '÷') {
                    next();
                    var d = unary();
                    if (d === 0) throw new CalcError("Can't divide by zero");
                    v /= d;
                } else if (t === '(' || t === '√' || t === 'num') { v *= unary(); }   // 2(3), 2√9
                else return v;
            }
        }
        function unary() {
            if (peek().t === '−') { next(); return -unary(); }
            if (peek().t === '+') { next(); return unary(); }
            return postfix();
        }
        function postfix() {
            var v = primary();
            for (;;) {
                if (peek().t === '²') { next(); v = v * v; }
                else if (peek().t === '%') { next(); v = v / 100; }
                else return v;
            }
        }
        function primary() {
            var t = next();
            if (!t) throw new CalcError('Incomplete expression');
            if (t.t === 'num') return t.v;
            if (t.t === '(') {
                var v = expr();
                if (next()?.t !== ')') throw new CalcError('Missing )');
                return v;
            }
            if (t.t === '√') {
                var r = unary();
                if (r < 0) throw new CalcError('Invalid input');
                return Math.sqrt(r);
            }
            throw new CalcError('Syntax error');
        }

        var value = expr();
        if (pos < tokens.length) throw new CalcError('Syntax error');
        if (!isFinite(value)) throw new CalcError('Result too large');
        return value;
    }

    /** 12 significant digits (hides 0.1 + 0.2 noise), exponent form for huge/tiny values. */
    function format(n) {
        if (n === 0) return '0';
        var abs = Math.abs(n);
        if (abs >= 1e15 || abs < 1e-9) return n.toExponential(8).replace(/\.?0+e/, 'e').replace('e+', 'e');
        var s = String(parseFloat(n.toPrecision(12)));
        var parts = s.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return parts.join('.');
    }

    /** Pretty-print the raw expression: thousands separators + spaced operators. */
    function pretty(src) {
        return src
            .replace(/[0-9]+/g, function (d, i) {
                return src[i - 1] === '.' ? d : d.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
            })
            .replace(/([+×÷])/g, ' $1 ')
            .replace(/(\d|\)|²|%)−/g, '$1 − ');
    }

    /* ------------------------------------------------------------------ */
    /* state + input                                                        */
    /* ------------------------------------------------------------------ */

    var expr = '';
    var justEvaluated = false;
    var evaluatedExpr = '';
    var history = [];
    var exprEl = document.getElementById('expr');
    var resultEl = document.getElementById('result');
    var OPS = '+−×÷';

    function lastNumberSpan(s) {
        var m = s.match(/[0-9.]+$/);
        return m ? { start: s.length - m[0].length, text: m[0] } : null;
    }

    function input(key) {
        if (/^[0-9]$/.test(key)) {
            if (justEvaluated) expr = '';
            var last = lastNumberSpan(expr);
            if (last && last.text === '0') expr = expr.slice(0, -1);   // no leading zeros
            if (/[)²%]$/.test(expr)) expr += '×';
            expr += key;
        } else if (key === '.') {
            if (justEvaluated) expr = '';
            var num = lastNumberSpan(expr);
            if (num && num.text.indexOf('.') !== -1) return;
            if (!num) expr += /[)²%]$/.test(expr) ? '×0' : '0';
            expr += '.';
        } else if (OPS.indexOf(key) !== -1) {
            if (!expr && key !== '−') expr = '0';
            if (OPS.indexOf(expr.slice(-1)) !== -1) {
                // replace the operator, but allow a minus after × or ÷ (e.g. 5 × −2)
                if (key === '−' && '×÷'.indexOf(expr.slice(-1)) !== -1) expr += key;
                else expr = expr.replace(/[+−×÷]+$/, '') + key;
            } else {
                expr += key;
            }
        } else if (key === '(') {
            if (justEvaluated) expr = '';
            if (/[0-9.)²%]$/.test(expr)) expr += '×';
            expr += '(';
        } else if (key === ')') {
            var opens = (expr.match(/\(/g) || []).length - (expr.match(/\)/g) || []).length;
            if (opens <= 0 || /[+−×÷(]$/.test(expr)) return;
            expr += ')';
        } else if (key === '²' || key === '%') {
            if (!/[0-9.)²%]$/.test(expr)) return;
            expr += key;
        } else if (key === '√') {
            if (justEvaluated) expr = '';
            if (/[0-9.)²%]$/.test(expr)) expr += '×';
            expr += '√';
        } else if (key === '±') {
            var n = lastNumberSpan(expr);
            if (!n) { expr += '−'; }
            else if (expr[n.start - 1] === '−' && (n.start === 1 || '(+−×÷'.indexOf(expr[n.start - 2]) !== -1)) {
                expr = expr.slice(0, n.start - 1) + expr.slice(n.start);
            } else {
                expr = expr.slice(0, n.start) + '−' + expr.slice(n.start);
            }
        } else if (key === 'back') {
            expr = justEvaluated ? '' : expr.slice(0, -1);
        } else if (key === 'clear') {
            expr = '';
        } else if (key === '=') {
            return equals();
        }
        justEvaluated = false;
        render();
    }

    function equals() {
        if (!expr) return;
        try {
            var v = evaluate(expr);
            if (v === null) return;
            history.unshift({ expr: expr, result: v });
            evaluatedExpr = expr;
            if (history.length > 30) history.pop();
            // keep a plain machine form so the result can be edited further
            expr = String(parseFloat(v.toPrecision(12))).replace('-', '−');
            justEvaluated = true;
            render();
            renderHistory();
            resultEl.classList.remove('pop'); void resultEl.offsetWidth; resultEl.classList.add('pop');
        } catch (e) {
            if (!(e instanceof CalcError)) throw e;
            resultEl.textContent = e.message;
            resultEl.className = 'calc-result num is-error';
        }
    }

    //  typing a number   → expression line empty, result shows the number
    //  typing an expr    → expression line shows it, result shows a dimmed live preview
    //  after "="         → expression line shows "… =", result shows the answer
    function render() {
        var text, cls = 'calc-result num';
        if (justEvaluated) {
            exprEl.textContent = evaluatedExpr ? pretty(evaluatedExpr) + ' =' : '';
            text = format(parseFloat(expr.replace('−', '-')));
        } else {
            var hasOp = /[+−×÷²%√()]/.test(expr.replace(/^−/, ''));
            exprEl.textContent = hasOp ? pretty(expr) : '';
            if (hasOp) {
                try {
                    var v = evaluate(expr);
                    text = v === null ? '' : format(v);
                } catch (e) {
                    text = '';
                }
                cls += ' is-preview';
            } else {
                text = expr ? pretty(expr) : '0';
            }
        }
        resultEl.textContent = text;
        resultEl.className = cls;
        // shrink long numbers so they always fit
        var len = text.length;
        resultEl.style.fontSize = len > 22 ? '3rem' : len > 16 ? '4rem' : len > 11 ? '5.2rem' : '';
        exprEl.scrollLeft = exprEl.scrollWidth;
    }

    function renderHistory() {
        var list = document.getElementById('history');
        if (!history.length) {
            fill(list, h('div', { class: 'calc-history-empty' }, 'Calculations appear here'));
            return;
        }
        fill(list, history.map(function (item) {
            return h('button', {
                class: 'calc-history-item',
                title: 'Use this result',
                onClick: function () {
                    expr = String(parseFloat(item.result.toPrecision(12))).replace('-', '−');
                    evaluatedExpr = item.expr;
                    justEvaluated = true;
                    render();
                },
            }, h('span', { class: 'calc-history-expr num' }, pretty(item.expr) + ' ='), h('span', { class: 'calc-history-result num' }, format(item.result)));
        }));
    }

    /* ------------------------------------------------------------------ */
    /* keypad                                                               */
    /* ------------------------------------------------------------------ */

    var KEYS = [
        ['(', '(', 'fn'], [')', ')', 'fn'], ['x²', '²', 'fn'], ['√', '√', 'fn'],
        ['C', 'clear', 'fn danger'], ['⌫', 'back', 'fn'], ['%', '%', 'fn'], ['÷', '÷', 'op'],
        ['7', '7'], ['8', '8'], ['9', '9'], ['×', '×', 'op'],
        ['4', '4'], ['5', '5'], ['6', '6'], ['−', '−', 'op'],
        ['1', '1'], ['2', '2'], ['3', '3'], ['+', '+', 'op'],
        ['±', '±', 'fn'], ['0', '0'], ['.', '.'], ['=', '=', 'eq'],
    ];

    var keyEls = {};
    fill(document.getElementById('keys'), KEYS.map(function (k) {
        var el = h('button', { class: 'calc-key ' + (k[2] || 'num-key'), 'data-key': k[1], onClick: function () { input(k[1]); } },
            k[1] === 'back' ? Kit.icon('backspace') : k[0]);
        keyEls[k[1]] = el;
        return el;
    }));

    var clearBtn = document.getElementById('clear-history');
    clearBtn.append(Kit.icon('trash'));
    clearBtn.addEventListener('click', function () { history = []; renderHistory(); });

    // keyboard (real keys, or keys relayed by the tablet in a DUI)
    var KEYMAP = { '*': '×', x: '×', '/': '÷', '-': '−', '+': '+', Enter: '=', '=': '=', Backspace: 'back', Escape: 'clear', Delete: 'clear', ',': '.', '.': '.', '(': '(', ')': ')', '%': '%', '^': '²', r: '√' };
    document.addEventListener('keydown', function (e) {
        var key = /^[0-9]$/.test(e.key) ? e.key : KEYMAP[e.key];
        if (!key) return;
        e.preventDefault();
        input(key);
        var el = keyEls[key];
        if (el) { el.classList.add('is-pressed'); setTimeout(function () { el.classList.remove('is-pressed'); }, 120); }
    });

    render();
    renderHistory();
    PDRTablet.ready();

    // exposed for automated tests
    window.__calc = { evaluate: evaluate, format: format };
})();
