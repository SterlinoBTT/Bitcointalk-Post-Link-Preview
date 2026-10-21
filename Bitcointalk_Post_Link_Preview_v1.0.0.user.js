// ==UserScript==
// @name         Bitcointalk Post Link Preview
// @namespace    https://github.com/SterlinoBTT
// @version      1.0.0
// @description  Preview Bitcointalk topic and post links inside forum posts.
// @author       Sterlino
// @match        https://bitcointalk.org/*
// @match        https://www.bitcointalk.org/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(() => {
    'use strict';

    const HOVER_DELAY = 500, SHORT_POST = 1600, LONG_QUOTE = 450;
    const cache = new Map();
    let timer, activeLink;

    const popup = document.createElement('div');
    popup.id = 'bt-link-preview';
    popup.innerHTML = '<div class="bt-head"></div><div class="bt-body"></div><div class="bt-foot"></div>';
    document.body.appendChild(popup);
    addStyle();

    const $ = s => popup.querySelector(s);
    const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();

    document.addEventListener('mouseover', e => {
        const link = e.target.closest?.('a[href]');
        if (!link || popup.contains(link) || !isPreviewLink(link)) return;

        clearTimeout(timer);
        activeLink = link;
        timer = setTimeout(() => openPreview(link), HOVER_DELAY);
    }, true);

    document.addEventListener('mouseout', e => {
        const link = e.target.closest?.('a[href]');
        if (!link || link !== activeLink || !isNormalPostLink(link)) return;

        clearTimeout(timer);
        setTimeout(() => {
            if (!popup.matches(':hover') && !link.matches(':hover')) closePreview();
        }, 150);
    }, true);

    popup.addEventListener('mouseleave', () => {
        setTimeout(() => {
            if (!activeLink?.matches(':hover')) closePreview();
        }, 150);
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closePreview();
    });

    function isNormalPostLink(link) {
        return !!link.closest('div.post') &&
            !link.closest('.quote') &&
            !link.closest('.quoteheader');
    }

    function isPreviewLink(link) {
        if (!isNormalPostLink(link)) return false;
        try {
            const url = new URL(link.href, location.href);
            return url.hostname.replace(/^www\./, '') === 'bitcointalk.org' &&
                /[?&]topic=\d+/i.test(url.href);
        } catch {
            return false;
        }
    }

    async function openPreview(link) {
        if (activeLink !== link || !isNormalPostLink(link)) return;

        const url = link.href;
        showMessage(link, 'Loading preview...');

        if (cache.has(url)) return render(cache.get(url), link);

        try {
            const response = await fetch(url, { credentials: 'include' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = parsePage(await response.text(), url);
            if (!data) throw new Error('Post not found');

            cache.set(url, data);
            if (activeLink === link) render(data, link);
        } catch (error) {
            if (activeLink === link) showMessage(link, `Preview unavailable: ${error.message}`);
        }
    }

    function parsePage(html, url) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const msgId = url.match(/msg(\d+)/i)?.[1];
        const subject = (msgId && doc.querySelector(`#subject_${msgId}`)) ||
            doc.querySelector('.subject[id^="subject_"]');

        if (!subject) return null;

        const cell = subject.closest('td.td_headerandpost') || subject.closest('td');
        const post = cell?.querySelector('div.post');
        if (!post) return null;

        const table = cell.closest('table');
        const numberLink = cell.querySelector('a.message_number');
        const boards = doc.querySelectorAll('.nav a[href*="board="]');
        const body = post.cloneNode(true);
        cleanPost(body);

        return {
            title: text(subject),
            board: text(boards[boards.length - 1]),
            author: text(table?.querySelector('.poster_info a[href*="action=profile"]')) || 'Unknown member',
            number: text(numberLink),
            date: findDate(cell.textContent || ''),
            postUrl: numberLink?.href || url,
            html: body.innerHTML,
            length: text(body).length
        };
    }

    function cleanPost(root) {
        root.querySelectorAll('script,style,iframe,form,input,button,video,audio').forEach(el => el.remove());

        root.querySelectorAll('img').forEach(img => {
            const marker = document.createElement('span');
            marker.className = 'bt-image';
            marker.textContent = '[Image]';
            img.replaceWith(marker);
        });

        root.querySelectorAll('*').forEach(el => {
            [...el.attributes].forEach(attr => {
                if (attr.name.startsWith('on') || ['style', 'id', 'srcset'].includes(attr.name)) {
                    el.removeAttribute(attr.name);
                }
            });
        });
    }

    function render(data, link) {
        if (!isNormalPostLink(link)) return closePreview();

        $('.bt-head').innerHTML =
            `<b>${escapeHtml(data.title)}</b><small>${escapeHtml(
                [data.board, data.author, data.number, data.date].filter(Boolean).join(' | ')
            )}</small>`;

        const body = $('.bt-body');
        const foot = $('.bt-foot');
        body.innerHTML = '';
        foot.innerHTML = '';

        const content = document.createElement('div');
        content.innerHTML = data.html;

        let collapsed = false;

        if (data.length > SHORT_POST) {
            const quotes = [...content.querySelectorAll('.quote')];

            quotes.forEach(quote => {
                if (text(quote).length <= LONG_QUOTE && quotes.length < 3) return;

                collapsed = true;
                quote.classList.add('bt-cut-quote');

                const button = makeButton('Show quote', 'bt-small');
                button.onclick = () => {
                    const expanded = quote.classList.toggle('bt-expanded');
                    button.textContent = expanded ? 'Hide quote' : 'Show quote';
                    positionPopup(link);
                };
                quote.after(button);
            });
        }

        body.appendChild(content);

        if (collapsed) {
            const full = makeButton('Full post');
            full.onclick = () => {
                const expanded = full.dataset.full !== '1';
                full.dataset.full = expanded ? '1' : '0';
                full.textContent = expanded ? 'Compact' : 'Full post';

                content.querySelectorAll('.bt-cut-quote').forEach(q =>
                    q.classList.toggle('bt-expanded', expanded)
                );
                content.querySelectorAll('.bt-small').forEach(b =>
                    b.style.display = expanded ? 'none' : ''
                );
                positionPopup(link);
            };
            foot.appendChild(full);
        }

        foot.appendChild(openButton('Open post', data.postUrl));
        popup.classList.add('show');
        positionPopup(link);
    }

    function showMessage(link, message) {
        $('.bt-head').innerHTML = '<b>Bitcointalk Preview</b>';
        $('.bt-body').textContent = message;
        $('.bt-foot').innerHTML = '';
        popup.classList.add('show');
        positionPopup(link);
    }

    function closePreview() {
        clearTimeout(timer);
        popup.classList.remove('show');
        activeLink = null;
    }

    function positionPopup(link) {
        if (!link || !popup.classList.contains('show')) return;

        const r = link.getBoundingClientRect();
        popup.style.cssText += ';left:10px;top:10px';
        const p = popup.getBoundingClientRect();

        const left = Math.max(10, Math.min(r.left, innerWidth - p.width - 10));
        let top = r.bottom + 8;

        if (top + p.height > innerHeight - 10) top = r.top - p.height - 8;
        popup.style.left = `${left}px`;
        popup.style.top = `${Math.max(10, top)}px`;
    }

    function findDate(value) {
        const months = 'January|February|March|April|May|June|July|August|September|October|November|December';
        return value.match(
            new RegExp(`(?:Today|Yesterday) at \\d{1,2}:\\d{2}:\\d{2} (?:AM|PM)|(?:${months}) \\d{1,2}, \\d{4}, \\d{1,2}:\\d{2}:\\d{2} (?:AM|PM)`, 'i')
        )?.[0] || '';
    }

    function makeButton(label, extraClass = '') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `bt-btn ${extraClass}`.trim();
        button.textContent = label;
        return button;
    }

    function openButton(label, href) {
        const link = document.createElement('a');
        link.className = 'bt-btn';
        link.textContent = label;
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        return link;
    }

    function escapeHtml(value) {
        const chars = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return String(value).replace(/[&<>"']/g, c => chars[c]);
    }

    function addStyle() {
        const style = document.createElement('style');
        style.textContent = `
#bt-link-preview{position:fixed;z-index:9999999;display:none;width:min(700px,calc(100vw - 20px));max-height:70vh;overflow:hidden;border:1px solid #9aa4ad;border-radius:5px;background:#fff;color:#222;box-shadow:0 6px 20px #0004;font:13px/1.45 Arial,sans-serif;text-align:left}
#bt-link-preview.show{display:block}
#bt-link-preview *{box-sizing:border-box}
#bt-link-preview .bt-head{padding:9px 11px;background:#edf1f4;border-bottom:1px solid #d5dbe0}
#bt-link-preview .bt-head b{display:block;color:#24557b;font-size:14px}
#bt-link-preview .bt-head small{display:block;margin-top:3px;color:#6d747a}
#bt-link-preview .bt-body{padding:11px;max-height:calc(70vh - 88px);overflow:auto}
#bt-link-preview .bt-foot{display:flex;justify-content:flex-end;gap:6px;padding:7px 9px;background:#f3f5f6;border-top:1px solid #d5dbe0}
#bt-link-preview .bt-btn{padding:5px 8px;border:1px solid #98a4ae;border-radius:3px;background:#eef2f5;color:#285273;text-decoration:none;cursor:pointer;font:12px Arial}
#bt-link-preview .bt-small{display:block;margin:4px 0 8px;padding:3px 6px}
#bt-link-preview .quoteheader{margin-top:8px;padding:5px 7px!important;background:#e9edf0!important}
#bt-link-preview .quote{padding:7px!important}
#bt-link-preview .bt-cut-quote{max-height:85px;overflow:hidden}
#bt-link-preview .bt-cut-quote.bt-expanded{max-height:none}
#bt-link-preview .bt-image{display:inline-block;padding:2px 5px;background:#eceff1;color:#777;font-size:11px}
#bt-link-preview .code{overflow:auto;white-space:pre-wrap}`;
        document.head.appendChild(style);
    }
})();
