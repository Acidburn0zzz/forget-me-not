import { h } from "tsx-dom";
import { Dialog, showDialog, hideDialog } from "./dialog";
import { on, removeAllChildren } from "../../lib/htmlUtils";
import { connectSettings } from "../../lib/htmlSettings";
import { Cookies, browser } from "webextension-polyfill-ts";
import { getBadgeForCleanupType, BadgeInfo } from "../../background/backgroundHelpers";
import { getDomain } from "tldjs";
import { settings } from "../../lib/settings";
import { wetLayer } from "wet-layer";
import { appendPunycode, showAddRuleDialog, getSuggestedRuleExpression } from "../helpers";

interface CookieListCookie {
    badge: BadgeInfo;
    cookie: Cookies.Cookie;
}

interface CookieListForDomain {
    badge: BadgeInfo;
    domain: string;
    firstPartyDomain: string;
    cookies: CookieListCookie[];
}

function compareCaseInsensitive(a: string, b: string) {
    const lowerA = a.toLowerCase();
    const lowerB = b.toLowerCase();
    if (lowerA < lowerB)
        return -1;
    if (lowerA > lowerB)
        return 1;
    return 0;
}

function compareDomain(a: CookieListForDomain, b: CookieListForDomain) {
    const value = compareCaseInsensitive(a.firstPartyDomain, b.firstPartyDomain);
    if (value !== 0)
        return value;
    return compareCaseInsensitive(a.domain, b.domain);
}

function compareCookieName(a: CookieListCookie, b: CookieListCookie) {
    return compareCaseInsensitive(a.cookie.name, b.cookie.name);
}

async function getCookieList() {
    const cookies = await browser.cookies.getAll({});
    const cookiesByDomain: { [s: string]: CookieListForDomain } = {};
    for (const cookie of cookies) {
        const rawDomain = cookie.domain.startsWith(".") ? cookie.domain.substr(1) : cookie.domain;
        const firstPartyDomain = getDomain(rawDomain) || rawDomain;
        const cleanupTypeForCookie = settings.getCleanupTypeForCookie(rawDomain, cookie.name);
        const badge = getBadgeForCleanupType(cleanupTypeForCookie);
        const byDomain = cookiesByDomain[cookie.domain];
        const mapped = { badge, cookie };
        if (byDomain) {
            byDomain.cookies.push(mapped);
        } else {
            cookiesByDomain[rawDomain] = {
                badge: getBadgeForCleanupType(settings.getCleanupTypeForDomain(rawDomain)),
                domain: cookie.domain,
                firstPartyDomain,
                cookies: [mapped]
            };
        }
    }
    const cookiesByDomainList = Object.keys(cookiesByDomain)
        .map((domain) => cookiesByDomain[domain])
        .sort(compareDomain);
    for (const a of cookiesByDomainList)
        a.cookies.sort(compareCookieName);
    return cookiesByDomainList;
}

function mapToCookieItem(entry: CookieListCookie) {
    const expires = entry.cookie.session
        ? "On Session End"
        : new Date(entry.cookie.expirationDate || 0).toLocaleString() || "?";

    const cookieAttributes = <ul class="collapsed cookie_attributes">
        <li class="cookie_list_split">
            <b>Value:</b>
            <span class="cookie_list_value" data-searchable>{entry.cookie.value}</span>
        </li>
        <li class="cookie_list_split">
            <b>Expires:</b>
            <span class="cookie_list_value">{expires}</span>
        </li>
        <li class="cookie_list_split">
            <b>Store:</b>
            <span class="cookie_list_value">{entry.cookie.storeId}</span>
        </li>
        <li class="cookie_list_split">
            <b>Secure:</b>
            <span class="cookie_list_value">{entry.cookie.secure ? "Yes" : "No"}</span>
        </li>
    </ul>;
    const toggleCookieAttributes = (e: MouseEvent) => {
        const collapsed = cookieAttributes.classList.toggle("collapsed");
        (e.currentTarget as HTMLElement).textContent = collapsed ? "+" : "-";
    };

    function addCookieRule() {
        showAddRuleDialog(getSuggestedRuleExpression(entry.cookie.domain, entry.cookie.name));
    }
    const title = wetLayer.getMessage(entry.badge.i18nButton + "@title");
    return <li>
        <div class="cookie_list_split">
            <span class="cookie_list_toggle" onClick={toggleCookieAttributes}>+</span>
            <span class={entry.badge.className} title={title}>{wetLayer.getMessage(entry.badge.i18nBadge)}</span>
            <i class="cookie_list_label" data-searchable>{entry.cookie.name}</i>
            <button class="cookie_list_add_rule" onClick={addCookieRule}>+ Add Rule</button>
        </div>
        {cookieAttributes}
    </li>;
}

function mapToDomainItem(entry: CookieListForDomain) {
    const cookiesList = <ul class="collapsed">{entry.cookies.map(mapToCookieItem)}</ul>;

    const toggler = <span class="cookie_list_toggle" onClick={toggleCookiesList}>+</span>;
    function toggleCookiesList() {
        const collapsed = cookiesList.classList.toggle("collapsed");
        toggler.textContent = collapsed ? "+" : "-";
    }

    function addDomainRule() {
        showAddRuleDialog(getSuggestedRuleExpression(entry.domain));
    }
    const punified = appendPunycode(entry.domain);
    const title = wetLayer.getMessage(entry.badge.i18nButton + "@title");
    return <li>
        <div class="cookie_list_split">
            {toggler}
            <span class={entry.badge.className} title={title}>{wetLayer.getMessage(entry.badge.i18nBadge)}</span>
            <b title={punified} data-searchable>{punified}</b>
            <button class="cookie_list_add_rule" onClick={addDomainRule}>+ Add Rule</button>
        </div>
        {cookiesList}
    </li>;
}

interface CookieBrowserDialogProps {
    button: HTMLElement;
}

export function CookieBrowserDialog({ button }: CookieBrowserDialogProps) {
    function onCancel() {
        hideDialog(dialog);
    }

    const buttons = [
        <button data-i18n="prompt_cancel" onClick={onCancel} />
    ];

    const cookieList = <ul class="cookie_list" />;
    const searchField = <input class="cookie_list_search" placeholder="Search.." /> as HTMLInputElement;
    function filterList() {
        const needle = searchField.value.trim().toLowerCase();
        if (needle) {
            for (const child of cookieList.children) {
                const searchables = [...child.querySelectorAll("*[data-searchable]")];
                const collapsed = searchables.every((s) => (s.textContent || "").toLowerCase().indexOf(needle) === -1);
                child.classList.toggle("collapsed", collapsed);
            }
        } else {
            for (const child of cookieList.children)
                child.classList.toggle("collapsed", false);
        }
    }
    on(searchField, "input", filterList);

    const dialog = <Dialog className="clean_dialog" titleI18nKey="cookie_browser_title">
        <div>{searchField}</div>
        {cookieList}
        <div class="split_equal split_wrap">{buttons}</div>
    </Dialog>;
    on(button, "click", () => {
        removeAllChildren(cookieList);
        getCookieList().then((list) => {
            for (const byDomain of list)
                cookieList.appendChild(mapToDomainItem(byDomain));
            filterList();
        });
        showDialog(dialog, buttons[0]);
    });
    connectSettings(dialog);
    return dialog;
}
