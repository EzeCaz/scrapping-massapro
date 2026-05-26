#!/usr/bin/env python3
"""
Google Maps Business Scraper using Playwright
Extracts: business names, addresses, phone numbers, websites, ratings, categories, emails

Strategy:
1. Use Playwright to load the search results page (JS-rendered)
2. Collect card names and detail URLs from the search results
3. Navigate to each detail URL directly (avoids card-click reshuffling)
4. Extract phone, website, address from each detail page
5. Visit business websites to find email addresses
6. Score and prioritize results by email/phone availability

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
    # Print error result immediately so the API can capture it
    result = {
        'success': False,
        'query': '',
        'error': f'Scraper was interrupted by {sig_name}. This usually happens when the server restarts during scraping. Please try again.',
        'results': [],
    }
    print_result(result)
    sys.exit(130)  # 128 + SIGINT(2) = standard exit code for SIGINT

# Register signal handlers for graceful shutdown — only in the main thread
# (When running via FastAPI ThreadPoolExecutor, we're in a worker thread, so skip)
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
]


def is_booking_platform(url):
    """Check if a URL belongs to a booking platform we should skip."""
    if not url:
        return False
    url_lower = url.lower()
    return any(platform in url_lower for platform in BOOKING_PLATFORMS)


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

    # Filter out common false positives
    false_positives = {
        'example.com', 'test.com', 'email.com', 'domain.com',
        'yoursite.com', 'yourdomain.com', 'company.com',
        'sentry.io', 'wixpress.com', 'wix.com',
        'google.com', 'gmail.com', 'gstatic.com', 'googleapis.com',
    }
    filtered = set()
    for email in emails:
        domain = email.split('@')[1] if '@' in email else ''
        if domain.lower() not in false_positives and not domain.endswith('.png') and not domain.endswith('.jpg'):
            filtered.add(email)

    return list(filtered)


def clean_text(text):
    """Clean extracted text."""
    if not text:
        return ""
    return re.sub(r'\s+', ' ', text).strip()


def format_phone(phone_str):
    """Format a phone number string as (XXX) XXX-XXXX."""
    if not phone_str:
        return ''
    phone_str = phone_str.replace('tel:', '').replace('TEL:', '').strip()
    digits = re.sub(r'\D', '', phone_str)
    if len(digits) == 11 and digits.startswith('1'):
        digits = digits[1:]
    if len(digits) == 10:
        return f'({digits[:3]}) {digits[3:6]}-{digits[6:]}'
    return phone_str


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


def fetch_website_emails(website_url):
    """
    Visit a business's website to find email addresses.
    Tries the main page first, then common contact pages.
    """
    if not website_url:
        return []

    if is_booking_platform(website_url):
        return []

    all_emails = set()
    urls_to_try = [website_url]

    try:
        from urllib.parse import urlparse, urljoin
        base = website_url.rstrip('/')
        urls_to_try.extend([
            base + '/contact',
            base + '/contact-us',
            base + '/about',
            base + '/about-us',
        ])
    except:
        pass

    visited = set()
    for url in urls_to_try[:5]:
        if url in visited:
            continue
        visited.add(url)

        try:
            page = Fetcher.get(url, stealthy_headers=True)
            html_source = ''
            try:
                html_source = page.html_content if hasattr(page, 'html_content') else str(page)
            except:
                pass

            if html_source:
                emails = extract_emails_from_html(html_source)
                all_emails.update(emails)

        except Exception:
            continue

        if all_emails:
            break

    false_domains = {'example.com', 'test.com', 'email.com', 'domain.com', 'wix.com',
                     'sentry.io', 'wixpress.com', 'google.com', 'facebook.com', 'instagram.com'}
    filtered = [e for e in all_emails if e.split('@')[1].lower() not in false_domains
                and not e.endswith('.png') and not e.endswith('.jpg')]

    return filtered


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
                if not is_booking_platform(href):
                    details['website'] = href
                    break

        # Strategy 2: Website in Io6YTe info sections (domain name shown)
        if not details['website']:
            info_sections = page.query_selector_all('div.Io6YTe')
            for section in info_sections:
                text = section.inner_text().strip()
                # Check if it looks like a domain (e.g. "shearblissnyc.com")
                if re.match(r'^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(\.[a-zA-Z]{2,})?$', text):
                    if not is_booking_platform(text):
                        href = 'https://' + text if not text.startswith('http') else text
                        details['website'] = href
                        break

        # Extract address
        # Strategy 1: div.Io6YTe with zip code
        info_sections = page.query_selector_all('div.Io6YTe')
        for section in info_sections:
            text = section.inner_text().strip()
            if text and re.search(r'\d{5}', text):
                details['address'] = text
                break

        # Strategy 2: div.Io6YTe with address-like patterns (no zip but has street name)
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
        # Google Maps shows category as a button (e.g., "Hair salon")
        category_buttons = page.query_selector_all('button[jsaction*="category"]')
        if category_buttons:
            for btn in category_buttons:
                text = btn.inner_text().strip()
                if text and len(text) > 2:
                    details['category'] = text
                    break

        # Fallback: try finding category from Io6YTe sections
        if not details['category']:
            for section in info_sections:
                text = section.inner_text().strip()
                if text and 2 < len(text) < 50:
                    if not re.search(r'\d{5}', text) and '.' not in text:
                        cat_words = ['salon', 'barber', 'restaurant', 'dentist', 'doctor', 'gym', 'spa',
                                     'hotel', 'bakery', 'cafe', 'studio', 'shop', 'clinic', 'center']
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
    Navigates directly to each business detail URL for accurate data.
    
    Args:
        query: Search query string
        max_results: Maximum number of results to return
        fetcher_type: Type of fetcher (always uses Playwright for Google Maps)
        fetch_details: Whether to fetch detailed info for each result
        progress_callback: Optional callback(progress:int, message:str, detail_count:int) 
                          called during scraping to update job status
    """
    encoded_query = query.replace(' ', '+')
    url = f'https://www.google.com/maps/search/{encoded_query}?hl=en&gl=us'

    def _progress(current, total, message, detail_count=0):
        """Report progress via both stdout and callback."""
        print_progress(current, total, message, detail_count)
        if progress_callback:
            try:
                pct = int((current / max(total, 1)) * 100)
                progress_callback(pct, message, detail_count)
            except Exception:
                pass  # Never let callback errors break the scraper

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
                'error': f'Playwright Chromium is not installed on the server. Please run: playwright install chromium --with-deps. Original error: {error_msg}',
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

        # Scroll to load more results if needed
        cards = page.query_selector_all('div.Nv2PK')
        scroll_attempts = 0
        max_scroll_attempts = max(10, max_results // 3)  # Scale scrolling with requested results
        while len(cards) < max_results and scroll_attempts < max_scroll_attempts:
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

                # Try to get name from h1
                name = ''
                h1 = page.query_selector('h1')
                if h1:
                    name = h1.inner_text().strip()
                if not name:
                    # Try aria-label approach
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

                if not business['email'] and business['website']:
                    try:
                        website_emails = fetch_website_emails(business['website'])
                        if website_emails:
                            business['email'] = website_emails[0]
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

        # Step 2: Collect all card info (names and detail URLs) BEFORE navigating away
        card_info = []
        for card in cards[:max_results]:
            name_el = card.query_selector('div.qBF1Pd, .fontHeadlineSmall')
            name = name_el.inner_text().strip() if name_el else ''

            if not name:
                aria = card.get_attribute('aria-label') or ''
                if aria:
                    name = clean_text(aria)

            if not name:
                continue

            # Get the detail page link (a.hfpxzc is the main card link)
            link_el = card.query_selector('a.hfpxzc')
            href = link_el.get_attribute('href') if link_el else ''

            # Also try any link with /maps/place/
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
            max_details = min(total, max_results)

            for i, info in enumerate(card_info[:max_details]):
                # Check if shutdown was requested
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

                _progress(i + 1, max_details, f"Fetching details for: {info['name']}", len(businesses))

                if info['href']:
                    try:
                        # Navigate directly to the detail URL
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
                else:
                    # No detail URL, skip
                    pass

                businesses.append(biz)
        else:
            # No detail fetching, just create basic entries
            for info in card_info:
                businesses.append({
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
                })

        # Step 4: Visit business websites to find emails
        website_email_count = 0
        max_website_visits = max(15, max_results // 2)  # Scale with requested results

        for i, biz in enumerate(businesses):
            if biz['email']:
                continue
            if not biz['website']:
                continue
            if website_email_count >= max_website_visits:
                break

            _progress(len(businesses) + i, len(businesses) * 2,
                      f"Looking for email on: {biz['website']}", len(businesses))

            try:
                website_emails = fetch_website_emails(biz['website'])
                if website_emails:
                    biz['email'] = website_emails[0]
            except:
                pass

            website_email_count += 1
            time.sleep(0.3)

        # Step 5: Calculate priority scores
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

        # Sort by score (highest first)
        businesses.sort(key=lambda x: x.get('priority_score', 0), reverse=True)

        _progress(100, 100, "Scraping complete!", len(businesses))

        browser.close()
        p.stop()

        result = {
            'success': True,
            'query': query,
            'results_count': len(businesses),
            'results': businesses,
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
    parser.add_argument('--max-results', type=int, default=20, help='Max results')
    parser.add_argument('--fetcher', default='dynamic', choices=['basic', 'stealthy', 'dynamic'], help='Fetcher type (always uses Playwright for accuracy)')
    parser.add_argument('--no-details', action='store_true', help='Skip detail page fetching (faster but less data)')

    args = parser.parse_args()
    fetch_details = not args.no_details

    try:
        scrape_google_maps(args.query, args.max_results, args.fetcher, fetch_details)
    except Exception as e:
        # Catch any unhandled exceptions and print a proper error result
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
