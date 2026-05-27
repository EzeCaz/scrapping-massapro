#!/usr/bin/env python3
"""
Google Maps Business Scraper using Playwright
Extracts: business names, addresses, phone numbers, websites, ratings, categories, emails

Strategy:
1. Use Playwright to load the search results page (JS-rendered)
2. Collect card names and detail URLs from the search results
3. Navigate to each detail URL directly (avoids card-click reshuffling)
4. Extract phone, website, address from each detail page
5. For businesses missing email/phone: visit their website to find contact info
6. Filter out results with no email AND no phone
7. Score and prioritize: email (highest) > phone > website

Usage:
  python google_maps_scraper.py --query "Hair salon in New York" --max-results 20 --fetcher dynamic --fetch-details
"""

import argparse
import json
import re
import sys
import time
import os
import signal
import traceback

# Add scrapling env to path for local development (Docker uses global pip install)
_project_root = os.environ.get('PROJECT_ROOT', os.path.dirname(os.path.abspath(__file__)))
_local_site_packages = os.path.join(_project_root, 'scrapling_env/lib/python3.12/site-packages')
if os.path.isdir(_local_site_packages):
    sys.path.insert(0, _local_site_packages)

from playwright.sync_api import sync_playwright
from scrapling.fetchers import Fetcher

# Global flag for graceful shutdown
_shutdown_requested = False

def handle_signal(signum, frame):
    """Handle shutdown signals gracefully."""
    global _shutdown_requested
    _shutdown_requested = True
    sig_name = signal.Signals(signum).name if hasattr(signal, 'Signals') else f'Signal {signum}'
    result = {
        'success': False,
        'query': '',
        'error': f'Scraper was interrupted by {sig_name}. Please try again.',
        'results': [],
    }
    print_result(result)
    sys.exit(130)

# Register signal handlers for graceful shutdown — only in the main thread
import threading
if threading.current_thread() is threading.main_thread():
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)


# Booking platform domains to skip when looking for real business websites
BOOKING_PLATFORMS = [
    'square.site', 'fresha.com', 'booker.com', 'phorest.com',
    'mindbodyonline.com', 'mindbody.io', 'vagaro.com', 'genbook.com',
    'styleseat.com', 'schedulicity.com', 'appointmentplus.com',
    'acuityscheduling.com', 'calendly.com', 'booksy.com',
    'cosmetask.com', 'beautyforte.com', 'salonbuilder.com',
    'miosalon.com', 'zolobooks.com', 'rosybookings.com',
    'salonlofts.com', 'thesalonbusiness.com', 'salontarget.com',
    'punchpass.com', 'zenplanner.com', 'tripadvisor.com',
    'yelp.com', 'opentable.com', 'groupon.com',
    'doordash.com', 'ubereats.com', 'grubhub.com', 'postmates.com',
    'seamless.com', 'foursquare.com', 'zomato.com',
    'wix.com', 'squarespace.com', 'godaddy.com',
    'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
    'linkedin.com', 'tiktok.com', 'youtube.com',
]

# Domains that are NOT real business websites (social, listing, etc.)
NOT_REAL_WEBSITES = [
    'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
    'linkedin.com', 'tiktok.com', 'youtube.com', 'goo.gl',
    'bit.ly', 'tinyurl.com', 'google.com', 'g.page',
    'maps.google.com', 'plus.google.com',
]


def is_booking_platform(url):
    """Check if a URL belongs to a booking platform we should skip."""
    if not url:
        return False
    url_lower = url.lower()
    return any(platform in url_lower for platform in BOOKING_PLATFORMS)


def is_real_website(url):
    """Check if a URL is a real business website (not social/listing)."""
    if not url:
        return False
    url_lower = url.lower()
    return not any(domain in url_lower for domain in NOT_REAL_WEBSITES)


def extract_emails_from_html(html_text):
    """Extract email addresses from raw HTML source using multiple strategies."""
    emails = set()

    # Strategy 1: mailto: links
    mailto_matches = re.findall(r'mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})', html_text)
    emails.update(mailto_matches)

    # Strategy 2: Standard email regex in text
    email_matches = re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', html_text)
    emails.update(email_matches)

    # Strategy 3: JavaScript arrays containing emails
    js_emails = re.findall(r'["\']([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})["\']', html_text)
    emails.update(js_emails)

    # Strategy 4: Obfuscated emails with [at] and [dot] patterns
    obfuscated = re.findall(r'([a-zA-Z0-9._%+-]+)\s*\[at\]\s*([a-zA-Z0-9.-]+)\s*\[dot\]\s*([a-zA-Z]{2,})', html_text, re.IGNORECASE)
    for user, domain, tld in obfuscated:
        emails.add(f'{user}@{domain}.{tld}')

    # Strategy 5: Emails with HTML entities
    entity_emails = re.findall(r'([a-zA-Z0-9._%+-]+)&#64;([a-zA-Z0-9.-]+)\.([a-zA-Z]{2,})', html_text)
    for user, domain, tld in entity_emails:
        emails.add(f'{user}@{domain}.{tld}')

    # Strategy 6: CF-encoded emails (Cloudflare __cf_email__)
    cf_emails = re.findall(r'data-cfemail="([a-f0-9]+)"', html_text)
    for hex_str in cf_emails:
        try:
            decoded = decode_cf_email(hex_str)
            if decoded and '@' in decoded:
                emails.add(decoded)
        except:
            pass

    # Filter out common false positives
    false_positives = {
        'example.com', 'test.com', 'email.com', 'domain.com',
        'yoursite.com', 'yourdomain.com', 'company.com',
        'sentry.io', 'wixpress.com', 'wix.com',
        'google.com', 'gmail.com', 'gstatic.com', 'googleapis.com',
        'facebook.com', 'instagram.com', 'twitter.com',
        'outlook.com', 'hotmail.com', 'yahoo.com',
        'mailchimp.com', 'sendgrid.net', 'hubspot.com',
        'wordpress.com', 'cloudflare.com', 'shopify.com',
    }
    filtered = set()
    for email in emails:
        domain = email.split('@')[1] if '@' in email else ''
        if (domain.lower() not in false_positives
            and not domain.endswith('.png')
            and not domain.endswith('.jpg')
            and not domain.endswith('.svg')
            and not domain.endswith('.css')
            and len(email) < 80):
            filtered.add(email)

    return list(filtered)


def decode_cf_email(hex_str):
    """Decode Cloudflare-encoded email addresses."""
    r = int(hex_str[:2], 16)
    email = ''
    for i in range(2, len(hex_str), 2):
        email += chr(int(hex_str[i:i+2], 16) ^ r)
    return email


def extract_phones_from_html(html_text):
    """Extract phone numbers from HTML source."""
    phones = set()

    # Strategy 1: tel: links
    tel_matches = re.findall(r'href=["\']tel:([^"\']+)', html_text, re.IGNORECASE)
    for tel in tel_matches:
        formatted = format_phone(tel)
        if formatted:
            phones.add(formatted)

    # Strategy 2: Various phone number formats in text
    phone_patterns = [
        r'\(\d{3}\)\s*\d{3}[-.\s]\d{4}',           # (XXX) XXX-XXXX
        r'\d{3}[-.\s]\d{3}[-.\s]\d{4}',              # XXX-XXX-XXXX
        r'\+1[-.\s]?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}',  # +1-XXX-XXX-XXXX
        r'\+1[-.\s]?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}',      # +1XXXXXXXXXX
    ]
    for pattern in phone_patterns:
        matches = re.findall(pattern, html_text)
        for m in matches:
            formatted = format_phone(m)
            if formatted:
                phones.add(formatted)

    # Strategy 3: aria-label or title with phone
    aria_phones = re.findall(r'aria-label=["\'][^"\']*?(?:Phone|Tel|Call)[:\s]+([^"\']+)', html_text, re.IGNORECASE)
    for ph in aria_phones:
        formatted = format_phone(ph)
        if formatted:
            phones.add(formatted)

    return list(phones)


def clean_text(text):
    """Clean extracted text."""
    if not text:
        return ""
    return re.sub(r'\s+', ' ', text).strip()


def format_phone(phone_str):
    """Format a phone number string as (XXX) XXX-XXXX."""
    if not phone_str:
        return ''
    phone_str = phone_str.replace('tel:', '').replace('TEL:', '').replace('Tel:', '').strip()
    # Remove common prefixes
    phone_str = re.sub(r'^(Phone:\s*|Tel:\s*|Call:\s*)', '', phone_str, flags=re.IGNORECASE)
    digits = re.sub(r'\D', '', phone_str)
    if len(digits) == 11 and digits.startswith('1'):
        digits = digits[1:]
    if len(digits) == 10 and digits[0] in '23456789':
        return f'({digits[:3]}) {digits[3:6]}-{digits[6:]}'
    if len(digits) >= 10:
        return phone_str
    return ''


def print_progress(current, total, message, detail_count=0):
    """Print progress as JSON for the API to capture."""
    pct = int((current / max(total, 1)) * 100)
    msg = json.dumps({
        "progress": pct,
        "current": current,
        "total": total,
        "message": message,
        "detail_count": detail_count
    })
    print(msg, flush=True)


def print_result(result):
    """Print the final result as JSON with a clear separator from progress messages."""
    print("===RESULT===", flush=True)
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)


def fetch_website_contact_info(website_url, playwright_browser=None):
    """
    Visit a business's website to find email addresses AND phone numbers.
    Tries the main page first, then common contact pages.
    
    Returns dict with 'emails' and 'phones' lists.
    """
    result = {'emails': [], 'phones': []}

    if not website_url:
        return result

    if is_booking_platform(website_url):
        return result

    # Ensure URL starts with http
    if not website_url.startswith('http'):
        website_url = 'https://' + website_url

    all_emails = set()
    all_phones = set()

    # Build list of URLs to try: main page + contact pages
    urls_to_try = [website_url]
    try:
        from urllib.parse import urlparse, urljoin
        base = website_url.rstrip('/')
        # Common contact page paths
        urls_to_try.extend([
            base + '/contact',
            base + '/contact-us',
            base + '/about',
            base + '/about-us',
            base + '/reach-us',
            base + '/get-in-touch',
        ])
    except:
        pass

    visited = set()
    for url in urls_to_try[:4]:  # Try up to 4 pages (faster for Render free tier)
        if url in visited:
            continue
        visited.add(url)

        try:
            # Use Playwright for JS-heavy sites if browser is available
            if playwright_browser:
                try:
                    ctx = playwright_browser.new_context(
                        viewport={'width': 1280, 'height': 800},
                        locale='en-US',
                    )
                    pg = ctx.new_page()
                    pg.goto(url, timeout=12000, wait_until='domcontentloaded')
                    time.sleep(1.5)
                    html_source = pg.content()
                    ctx.close()
                except:
                    # Fallback to simple fetcher
                    page = Fetcher.get(url, stealthy_headers=True)
                    html_source = page.html_content if hasattr(page, 'html_content') else str(page)
            else:
                page = Fetcher.get(url, stealthy_headers=True)
                html_source = page.html_content if hasattr(page, 'html_content') else str(page)

            if html_source:
                emails = extract_emails_from_html(html_source)
                phones = extract_phones_from_html(html_source)
                all_emails.update(emails)
                all_phones.update(phones)

        except Exception:
            continue

        # If we found both email and phone, stop early
        if all_emails and all_phones:
            break
        # If we found email, we can stop (phone might come from next page)
        if all_emails:
            # Still try one more contact page for phone
            continue

    # Filter false positives for emails
    false_domains = {'example.com', 'test.com', 'email.com', 'domain.com', 'wix.com',
                     'sentry.io', 'wixpress.com', 'google.com', 'facebook.com', 'instagram.com',
                     'squarespace.com', 'godaddy.com', 'wordpress.com', 'cloudflare.com'}
    result['emails'] = [e for e in all_emails
                        if e.split('@')[1].lower() not in false_domains
                        and not e.endswith('.png') and not e.endswith('.jpg')
                        and not e.endswith('.svg') and not e.endswith('.css')]
    result['phones'] = [p for p in all_phones if p]  # Remove empty strings

    return result


def extract_details_from_page(page):
    """
    Extract business details from a Google Maps detail page
    that was navigated to directly.
    """
    details = {
        'phone': '',
        'website': '',
        'address': '',
        'category': '',
        'rating': '',
        'reviews_count': '',
        'email': '',
    }

    try:
        # Wait for detail elements to appear
        try:
            page.wait_for_selector('div.Io6YTe, a[href^="tel:"]', timeout=8000)
        except:
            pass

        time.sleep(1.5)

        # Extract phone number
        # Strategy 1: tel: link (most reliable)
        tel_links = page.query_selector_all('a[href^="tel:"]')
        for el in tel_links:
            href = el.get_attribute('href') or ''
            if href.startswith('tel:'):
                details['phone'] = format_phone(href)
                break

        # Strategy 2: button with aria-label containing "Phone:"
        if not details['phone']:
            phone_buttons = page.query_selector_all('button[aria-label*="Phone:"]')
            for btn in phone_buttons:
                aria = btn.get_attribute('aria-label') or ''
                phone_match = re.search(r'Phone:\s*([\(]?\d{3}[\)]?[-.\s]?\d{3}[-.\s]?\d{4})', aria)
                if phone_match:
                    details['phone'] = phone_match.group(1).strip()
                    break

        # Extract website
        # Strategy 1: a[aria-label*="website"] or a[aria-label*="Website:"]
        website_links = page.query_selector_all('a[aria-label*="website"], a[aria-label*="Website:"]')
        for el in website_links:
            href = el.get_attribute('href') or ''
            if href and href.startswith('http') and 'google.com' not in href:
                if not is_booking_platform(href) and is_real_website(href):
                    details['website'] = href
                    break

        # Strategy 2: Website in Io6YTe info sections (domain name shown)
        if not details['website']:
            info_sections = page.query_selector_all('div.Io6YTe')
            for section in info_sections:
                text = section.inner_text().strip()
                # Check if it looks like a domain (e.g. "shearblissnyc.com")
                if re.match(r'^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(\.[a-zA-Z]{2,})?$', text):
                    if not is_booking_platform(text) and is_real_website(text):
                        href = 'https://' + text if not text.startswith('http') else text
                        details['website'] = href
                        break

        # Extract address
        info_sections = page.query_selector_all('div.Io6YTe')
        for section in info_sections:
            text = section.inner_text().strip()
            if text and re.search(r'\d{5}', text):
                details['address'] = text
                break

        if not details['address']:
            addr_keywords = ['ave', 'st', 'blvd', 'dr', 'ln', 'rd', 'way', 'ct', 'pl',
                           'street', 'avenue', 'broadway', 'road']
            for section in info_sections:
                text = section.inner_text().strip()
                if text and len(text) > 10 and any(kw in text.lower() for kw in addr_keywords):
                    if re.search(r'\d+', text):
                        details['address'] = text
                        break

        # Extract category
        category_buttons = page.query_selector_all('button[jsaction*="category"]')
        if category_buttons:
            for btn in category_buttons:
                text = btn.inner_text().strip()
                if text and len(text) > 2:
                    details['category'] = text
                    break

        if not details['category']:
            for section in info_sections:
                text = section.inner_text().strip()
                if text and 2 < len(text) < 50:
                    if not re.search(r'\d{5}', text) and '.' not in text:
                        cat_words = ['salon', 'barber', 'restaurant', 'dentist', 'doctor', 'gym', 'spa',
                                     'hotel', 'bakery', 'cafe', 'studio', 'shop', 'clinic', 'center',
                                     'plumber', 'electrician', 'lawyer', 'accountant', 'realtor',
                                     'contractor', 'mechanic', 'cleaner', 'trainer']
                        if any(w in text.lower() for w in cat_words):
                            details['category'] = text
                            break

        # Extract rating
        rating_el = page.query_selector('div[role="img"][aria-label*="star"], span[role="img"][aria-label*="star"]')
        if rating_el:
            aria = rating_el.get_attribute('aria-label') or ''
            rating_match = re.search(r'(\d+\.?\d*)', aria)
            if rating_match:
                details['rating'] = rating_match.group(1)

        # Extract reviews count
        reviews_el = page.query_selector('button[aria-label*="review"], span[aria-label*="review"]')
        if reviews_el:
            aria = reviews_el.get_attribute('aria-label') or ''
            reviews_match = re.search(r'(\d+[\d,]*)', aria)
            if reviews_match:
                details['reviews_count'] = reviews_match.group(1).replace(',', '')

        # Extract email from page HTML
        html = page.content()
        emails = extract_emails_from_html(html)
        if emails:
            details['email'] = emails[0]

    except Exception:
        pass

    return details


def scrape_google_maps(query, max_results=20, fetcher_type='dynamic', fetch_details=True, progress_callback=None):
    """
    Scrape Google Maps search results using Playwright.
    
    Prioritizes results with email > phone > website only.
    Scrapes 3x the requested results to ensure enough quality leads after filtering.
    Visits business websites to find missing email/phone.
    Filters out results with NO email AND NO phone.
    
    Args:
        query: Search query string
        max_results: Maximum number of results to RETURN (after filtering)
        fetcher_type: Type of fetcher (always uses Playwright for Google Maps)
        fetch_details: Whether to fetch detailed info for each result
        progress_callback: Optional callback(progress:int, message:str, detail_count:int)
    """
    encoded_query = query.replace(' ', '+')
    url = f'https://www.google.com/maps/search/{encoded_query}?hl=en&gl=us'

    # Scrape 3x more results than requested to compensate for filtering
    scrape_target = min(max_results * 2, 40)

    def _progress(current, total, message, detail_count=0):
        """Report progress via both stdout and callback."""
        print_progress(current, total, message, detail_count)
        if progress_callback:
            try:
                pct = int((current / max(total, 1)) * 100)
                progress_callback(pct, message, detail_count)
            except Exception:
                pass

    _progress(0, max_results, f"Fetching search results for: {query}")

    # Launch Playwright with better error handling for Render/Docker
    try:
        p = sync_playwright().start()
        browser = p.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--single-process',
                '--no-zygote',
            ],
        )
    except Exception as e:
        error_msg = str(e)
        if 'Executable doesn\'t exist' in error_msg or 'chromium' in error_msg.lower():
            return {
                'success': False,
                'query': query,
                'error': f'Playwright Chromium is not installed. Original error: {error_msg}',
                'results': [],
            }
        return {
            'success': False,
            'query': query,
            'error': f'Failed to launch Playwright browser: {error_msg}',
            'results': [],
        }

    context = browser.new_context(
        viewport={'width': 1440, 'height': 900},
        locale='en-US',
    )
    page = context.new_page()

    try:
        # Step 1: Navigate to search results
        _progress(5, max_results, "Loading Google Maps search page...")
        page.goto(url, timeout=45000, wait_until='domcontentloaded')

        # Wait for business cards to appear
        try:
            page.wait_for_selector('div.Nv2PK', timeout=20000)
        except:
            pass

        time.sleep(2)

        _progress(10, max_results, "Loading search results...")

        # Scroll to load more results
        cards = page.query_selector_all('div.Nv2PK')
        scroll_attempts = 0
        max_scroll_attempts = max(15, scrape_target // 2)
        while len(cards) < scrape_target and scroll_attempts < max_scroll_attempts:
            try:
                feed = page.query_selector('div[role="feed"]')
                if feed:
                    feed.evaluate('el => el.scrollTop = el.scrollHeight')
                else:
                    page.keyboard.press('End')
            except:
                page.keyboard.press('End')
            time.sleep(1.5)
            cards = page.query_selector_all('div.Nv2PK')
            scroll_attempts += 1

        if not cards:
            # Check if we're on a single business page
            is_detail = (
                len(page.query_selector_all('a[href^="tel:"]')) > 0 or
                len(page.query_selector_all('div.Io6YTe')) > 0
            )
            if is_detail:
                details = extract_details_from_page(page)
                name = ''
                h1 = page.query_selector('h1')
                if h1:
                    name = h1.inner_text().strip()
                if not name:
                    for el in page.query_selector_all('[aria-label]'):
                        aria = el.get_attribute('aria-label') or ''
                        if aria and 3 < len(aria) < 80:
                            skip = ['search', 'direction', 'save', 'share', 'close', 'menu', 'map', 'photo']
                            if not any(s in aria.lower() for s in skip):
                                name = aria
                                break

                business = {
                    'name': name,
                    'address': details['address'],
                    'phone': details['phone'],
                    'website': details['website'],
                    'rating': details['rating'],
                    'reviews_count': details['reviews_count'],
                    'category': details['category'],
                    'email': details['email'],
                    'source': 'Google Maps',
                    'source_url': url,
                }

                if (not business['email'] or not business['phone']) and business['website']:
                    try:
                        contact_info = fetch_website_contact_info(business['website'], playwright_browser=browser)
                        if not business['email'] and contact_info['emails']:
                            business['email'] = contact_info['emails'][0]
                        if not business['phone'] and contact_info['phones']:
                            business['phone'] = contact_info['phones'][0]
                    except:
                        pass

                score = 0
                if business.get('email'): score += 100
                if business.get('phone'): score += 50
                if business.get('website'): score += 10
                if business.get('address'): score += 5
                business['priority_score'] = score

                browser.close()
                p.stop()
                result = {
                    'success': True,
                    'query': query,
                    'results_count': 1,
                    'results': [business],
                }
                print_result(result)
                return result

            browser.close()
            p.stop()
            result = {
                'success': True,
                'query': query,
                'results_count': 0,
                'results': [],
                'message': 'No business listings found on the search page.',
            }
            print_result(result)
            return result

        # Step 2: Collect all card info (names and detail URLs)
        card_info = []
        for card in cards[:scrape_target]:
            name_el = card.query_selector('div.qBF1Pd, .fontHeadlineSmall')
            name = name_el.inner_text().strip() if name_el else ''

            if not name:
                aria = card.get_attribute('aria-label') or ''
                if aria:
                    name = clean_text(aria)

            if not name:
                continue

            link_el = card.query_selector('a.hfpxzc')
            href = link_el.get_attribute('href') if link_el else ''

            if not href:
                link_el = card.query_selector('a[href*="/maps/place/"]')
                href = link_el.get_attribute('href') if link_el else ''

            card_info.append({
                'name': name,
                'href': href,
            })

        _progress(15, max_results, f"Found {len(card_info)} businesses, fetching details...", len(card_info))

        # Step 3: Navigate to each detail URL and extract data
        businesses = []
        total = len(card_info)

        if fetch_details and card_info:
            max_details = min(total, scrape_target)

            for i, info in enumerate(card_info[:max_details]):
                if _shutdown_requested:
                    break

                biz = {
                    'name': info['name'],
                    'address': '',
                    'phone': '',
                    'website': '',
                    'rating': '',
                    'reviews_count': '',
                    'category': '',
                    'email': '',
                    'source': 'Google Maps',
                    'source_url': url,
                }

                pct = int(15 + (i / max_details) * 50)  # 15-65% range
                _progress(pct, max_results, f"Fetching details for: {info['name']}", len(businesses))

                if info['href']:
                    try:
                        page.goto(info['href'], timeout=25000, wait_until='domcontentloaded')
                        time.sleep(2)

                        details = extract_details_from_page(page)

                        if details.get('phone'):
                            biz['phone'] = details['phone']
                        if details.get('website'):
                            biz['website'] = details['website']
                        if details.get('address'):
                            biz['address'] = details['address']
                        if details.get('category'):
                            biz['category'] = details['category']
                        if details.get('rating'):
                            biz['rating'] = details['rating']
                        if details.get('reviews_count'):
                            biz['reviews_count'] = details['reviews_count']
                        if details.get('email'):
                            biz['email'] = details['email']

                    except Exception:
                        pass

                businesses.append(biz)
        else:
            for info in card_info:
                businesses.append({
                    'name': info['name'],
                    'address': '', 'phone': '', 'website': '',
                    'rating': '', 'reviews_count': '', 'category': '', 'email': '',
                    'source': 'Google Maps', 'source_url': url,
                })

        # Step 4: Visit business websites for businesses missing email OR phone
        # This is the critical step - we want to find email/phone from their website
        websites_to_visit = []
        for i, biz in enumerate(businesses):
            has_email = bool(biz.get('email'))
            has_phone = bool(biz.get('phone'))
            has_website = bool(biz.get('website')) and is_real_website(biz.get('website', ''))
            if (not has_email or not has_phone) and has_website:
                websites_to_visit.append(i)

        visited_count = 0
        max_visits = min(len(websites_to_visit), 20)  # Limit total visits for Render free tier

        for idx in websites_to_visit[:max_visits]:
            if _shutdown_requested:
                break

            biz = businesses[idx]
            pct = int(65 + (visited_count / max_visits) * 25)  # 65-90% range
            _progress(pct, max_results,
                      f"Searching website for contact info: {biz['name']}", len(businesses))

            try:
                contact_info = fetch_website_contact_info(biz['website'], playwright_browser=browser)
                if not biz.get('email') and contact_info['emails']:
                    biz['email'] = contact_info['emails'][0]
                if not biz.get('phone') and contact_info['phones']:
                    biz['phone'] = contact_info['phones'][0]
            except:
                pass

            visited_count += 1
            time.sleep(0.3)

        # Step 5: Calculate priority scores
        # Email = 100, Phone = 50, Website = 10, Address = 5
        for biz in businesses:
            score = 0
            if biz.get('email'):
                score += 100
            if biz.get('phone'):
                score += 50
            if biz.get('website'):
                score += 10
            if biz.get('address'):
                score += 5
            biz['priority_score'] = score

        # Step 6: Filter out results with NO email AND NO phone
        quality_leads = [b for b in businesses if b.get('email') or b.get('phone')]
        filtered_out = len(businesses) - len(quality_leads)

        # Step 7: Sort by priority score (highest first)
        quality_leads.sort(key=lambda x: x.get('priority_score', 0), reverse=True)

        # Step 8: Limit to requested number of results
        final_results = quality_leads[:max_results]

        _progress(100, 100, f"Scraping complete! {len(final_results)} quality leads found ({filtered_out} filtered out)", len(final_results))

        browser.close()
        p.stop()

        result = {
            'success': True,
            'query': query,
            'results_count': len(final_results),
            'total_scraped': len(businesses),
            'filtered_out': filtered_out,
            'results': final_results,
        }
        print_result(result)
        return result

    except Exception as e:
        try:
            browser.close()
        except:
            pass
        try:
            p.stop()
        except:
            pass
        result = {
            'success': False,
            'query': query,
            'error': str(e),
            'results': [],
        }
        print_result(result)
        return result


def main():
    parser = argparse.ArgumentParser(description='Google Maps Business Scraper')
    parser.add_argument('--query', required=True, help='Search query')
    parser.add_argument('--max-results', type=int, default=20, help='Max results to return (after filtering)')
    parser.add_argument('--fetcher', default='dynamic', choices=['basic', 'stealthy', 'dynamic'], help='Fetcher type (always uses Playwright for accuracy)')
    parser.add_argument('--no-details', action='store_true', help='Skip detail page fetching (faster but less data)')

    args = parser.parse_args()
    fetch_details = not args.no_details

    try:
        scrape_google_maps(args.query, args.max_results, args.fetcher, fetch_details)
    except Exception as e:
        error_msg = f'{type(e).__name__}: {str(e)}'
        traceback.print_exc(file=sys.stderr)
        result = {
            'success': False,
            'query': args.query,
            'error': error_msg,
            'results': [],
        }
        print_result(result)
        sys.exit(1)


if __name__ == '__main__':
    main()
