#!/usr/bin/env python3
"""
Generic Website Scraper using Scrapling
Extracts: emails, phone numbers, addresses, social links, and other contact info
Usage: python generic_scraper.py --url "https://example.com" --depth 1 --fetcher stealthy
"""

import argparse
import json
import re
import sys
from urllib.parse import urljoin, urlparse

import os
_project_root = os.environ.get('PROJECT_ROOT', '/home/z/my-project')
_local_site_packages = os.path.join(_project_root, 'scrapling_env/lib/python3.12/site-packages')
if os.path.isdir(_local_site_packages):
    sys.path.insert(0, _local_site_packages)

from scrapling.fetchers import Fetcher, StealthyFetcher, DynamicFetcher


def extract_emails(text):
    """Extract email addresses from text."""
    email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
    return list(set(re.findall(email_pattern, text)))


def extract_phones(text):
    """Extract phone numbers from text."""
    phone_patterns = [
        r'\+?1?\s*\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}',
        r'\+\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}',
        r'\(\d{3}\)\s*\d{3}[-.\s]?\d{4}',
        r'tel:\+?[\d\s-]+',
    ]
    phones = []
    for pattern in phone_patterns:
        found = re.findall(pattern, text)
        phones.extend(found)
    # Clean tel: prefix
    cleaned = []
    for p in list(set(phones)):
        p = p.replace('tel:', '').strip()
        if p:
            cleaned.append(p)
    return cleaned


def extract_social_links(page, base_url=''):
    """Extract social media profile links."""
    social_patterns = {
        'facebook': r'(?:https?://)?(?:www\.)?facebook\.com/[\w.-]+',
        'twitter': r'(?:https?://)?(?:www\.)?(?:twitter\.com|x\.com)/[\w.-]+',
        'linkedin': r'(?:https?://)?(?:www\.)?linkedin\.com/(?:in|company)/[\w.-]+',
        'instagram': r'(?:https?://)?(?:www\.)?instagram\.com/[\w.-]+',
        'youtube': r'(?:https?://)?(?:www\.)?youtube\.com/(?:c|channel|user)/[\w.-]+',
        'tiktok': r'(?:https?://)?(?:www\.)?tiktok\.com/@[\w.-]+',
    }
    
    social_links = {}
    page_text = ''
    
    # Get all href attributes from anchor tags
    links = page.css('a[href]')
    all_hrefs = []
    for link in links:
        href = link.attrib.get('href', '')
        if href:
            all_hrefs.append(href)
    
    all_urls_text = ' '.join(all_hrefs)
    
    for platform, pattern in social_patterns.items():
        matches = re.findall(pattern, all_urls_text)
        if matches:
            social_links[platform] = list(set(matches))
    
    return social_links


def extract_addresses(text):
    """Extract US-style addresses from text."""
    address_patterns = [
        r'\d+\s+[A-Za-z0-9\s]+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Road|Rd|Way|Court|Ct|Place|Pl|Suite|Ste)[.,]?\s*(?:[A-Za-z\s]+)?,?\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?',
    ]
    addresses = []
    for pattern in address_patterns:
        found = re.findall(pattern, text, re.IGNORECASE)
        addresses.extend(found)
    return list(set(addresses))


def scrape_generic(url, depth=1, fetcher_type='stealthy', progress_callback=None):
    """
    Scrape a generic website for contact information.
    
    Args:
        url: Target URL
        depth: How many linked pages to also scrape (0 = just the given URL)
        fetcher_type: Type of fetcher to use
    
    Returns:
        Dictionary with extracted data
    """
    visited = set()
    all_emails = []
    all_phones = []
    all_addresses = []
    all_social_links = {}
    page_results = []

    def _report_progress(progress, message, detail_count=0):
        if progress_callback:
            try:
                progress_callback(progress, message, detail_count)
            except Exception:
                pass
    
    def scrape_page(target_url):
        if target_url in visited:
            return
        if not target_url.startswith('http'):
            return
        visited.add(target_url)
        
        try:
            if fetcher_type == 'dynamic':
                page = DynamicFetcher.fetch(target_url, headless=True, network_idle=True, timeout=20000)
            elif fetcher_type == 'stealthy':
                page = StealthyFetcher.fetch(target_url, headless=True, timeout=20000)
            else:
                page = Fetcher.get(target_url, stealthy_headers=True)
            
            # Extract all visible text
            text_content = ''
            try:
                # Get text from body
                body = page.css_first('body')
                if body:
                    text_content = body.text if hasattr(body, 'text') else ''
            except:
                text_content = page.get_all_text() if hasattr(page, 'get_all_text') else ''
            
            # Extract from page source
            page_text = str(page.html) if hasattr(page, 'html') else text_content
            
            # Extract contact info
            emails = extract_emails(page_text)
            phones = extract_phones(page_text)
            addresses = extract_addresses(text_content)
            social_links = extract_social_links(page, target_url)
            
            # Extract title
            title = ''
            title_el = page.css_first('title')
            if title_el:
                title = title_el.text if hasattr(title_el, 'text') else ''
            
            # Extract meta description
            description = ''
            meta_desc = page.css_first('meta[name="description"]')
            if meta_desc:
                description = meta_desc.attrib.get('content', '')
            
            page_result = {
                'url': target_url,
                'title': title.strip(),
                'description': description.strip(),
                'emails': emails,
                'phones': phones,
                'addresses': addresses,
                'social_links': social_links,
            }
            
            page_results.append(page_result)
            
            # Aggregate results
            all_emails.extend(emails)
            all_phones.extend(phones)
            all_addresses.extend(addresses)
            for platform, links in social_links.items():
                if platform not in all_social_links:
                    all_social_links[platform] = []
                all_social_links[platform].extend(links)
            
            # If depth > 0, find and scrape linked pages on same domain
            if depth > 0:
                base_domain = urlparse(target_url).netloc
                links = page.css('a[href]')
                for link in links:
                    href = link.attrib.get('href', '')
                    full_url = urljoin(target_url, href)
                    if urlparse(full_url).netloc == base_domain and full_url not in visited:
                        if len(visited) < depth + 1:  # Limit pages
                            scrape_page(full_url)
        
        except Exception as e:
            page_results.append({
                'url': target_url,
                'error': str(e),
                'emails': [],
                'phones': [],
                'addresses': [],
                'social_links': {},
            })
    
    scrape_page(url)
    
    # Deduplicate
    all_emails = list(set(all_emails))
    all_phones = list(set(all_phones))
    all_addresses = list(set(all_addresses))
    for platform in all_social_links:
        all_social_links[platform] = list(set(all_social_links[platform]))
    
    return {
        'success': True,
        'url': url,
        'pages_scraped': len(visited),
        'emails': all_emails,
        'phones': all_phones,
        'addresses': all_addresses,
        'social_links': all_social_links,
        'page_details': page_results,
    }


def main():
    parser = argparse.ArgumentParser(description='Generic Website Scraper')
    parser.add_argument('--url', required=True, help='Target URL')
    parser.add_argument('--depth', type=int, default=0, help='Crawl depth (0 = single page)')
    parser.add_argument('--fetcher', default='stealthy', choices=['basic', 'stealthy', 'dynamic'], help='Fetcher type')
    
    args = parser.parse_args()
    result = scrape_generic(args.url, args.depth, args.fetcher)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
