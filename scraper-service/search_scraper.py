#!/usr/bin/env python3
"""
Search Engine Scraper using Scrapling
Scrapes Google Search results for a query and extracts data from result pages
Usage: python search_scraper.py --query "plumbers in Chicago" --max-pages 5 --fetcher stealthy
"""

import argparse
import json
import re
import sys
import time

import os
_project_root = os.environ.get('PROJECT_ROOT', '/home/z/my-project')
_local_site_packages = os.path.join(_project_root, 'scrapling_env/lib/python3.12/site-packages')
if os.path.isdir(_local_site_packages):
    sys.path.insert(0, _local_site_packages)

from scrapling.fetchers import Fetcher, StealthyFetcher, DynamicFetcher
from generic_scraper import extract_emails, extract_phones, extract_addresses, extract_social_links


def scrape_search_engine(query, max_pages=5, fetcher_type='stealthy'):
    """
    Scrape search engine results and extract contact data from result pages.
    
    Args:
        query: Search query
        max_pages: Number of result pages to process
        fetcher_type: Fetcher type to use
    
    Returns:
        Dictionary with aggregated results
    """
    all_results = []
    all_emails = []
    all_phones = []
    all_social_links = {}
    
    try:
        # Search Google
        encoded_query = query.replace(' ', '+')
        search_url = f'https://www.google.com/search?q={encoded_query}&num={max_pages * 10}'
        
        if fetcher_type == 'dynamic':
            search_page = DynamicFetcher.fetch(search_url, headless=True, network_idle=True, timeout=20000)
        elif fetcher_type == 'stealthy':
            search_page = StealthyFetcher.fetch(search_url, headless=True, timeout=20000)
        else:
            search_page = Fetcher.get(search_url, stealthy_headers=True)
        
        # Extract search result links
        result_links = []
        links = search_page.css('a[href]')
        
        for link in links:
            href = link.attrib.get('href', '')
            # Google search results have /url?q= prefix
            if '/url?q=' in href:
                actual_url = href.split('/url?q=')[1].split('&')[0]
                if actual_url.startswith('http') and 'google.com' not in actual_url:
                    result_links.append(actual_url)
            elif href.startswith('http') and 'google.com' not in href and 'googleapis' not in href:
                result_links.append(href)
        
        # Deduplicate
        result_links = list(dict.fromkeys(result_links))[:max_pages]
        
        # Scrape each result page
        for i, url in enumerate(result_links):
            try:
                time.sleep(1)  # Polite delay
                
                if fetcher_type == 'dynamic':
                    page = DynamicFetcher.fetch(url, headless=True, network_idle=True, timeout=15000)
                elif fetcher_type == 'stealthy':
                    page = StealthyFetcher.fetch(url, headless=True, timeout=15000)
                else:
                    page = Fetcher.get(url, stealthy_headers=True)
                
                # Extract text
                text_content = ''
                try:
                    body = page.css_first('body')
                    if body:
                        text_content = body.text if hasattr(body, 'text') else ''
                except:
                    text_content = page.get_all_text() if hasattr(page, 'get_all_text') else ''
                
                page_html = str(page.html) if hasattr(page, 'html') else text_content
                
                # Extract data
                emails = extract_emails(page_html)
                phones = extract_phones(text_content)
                addresses = extract_addresses(text_content)
                social_links = extract_social_links(page, url)
                
                # Title
                title = ''
                title_el = page.css_first('title')
                if title_el:
                    title = title_el.text if hasattr(title_el, 'text') else ''
                
                # Description
                description = ''
                meta_desc = page.css_first('meta[name="description"]')
                if meta_desc:
                    description = meta_desc.attrib.get('content', '')
                
                result = {
                    'url': url,
                    'title': title.strip(),
                    'description': description.strip(),
                    'emails': emails,
                    'phones': phones,
                    'addresses': addresses,
                    'social_links': social_links,
                }
                
                all_results.append(result)
                all_emails.extend(emails)
                all_phones.extend(phones)
                for platform, links in social_links.items():
                    if platform not in all_social_links:
                        all_social_links[platform] = []
                    all_social_links[platform].extend(links)
                
            except Exception as e:
                all_results.append({
                    'url': url,
                    'title': '',
                    'error': str(e),
                    'emails': [],
                    'phones': [],
                    'addresses': [],
                    'social_links': {},
                })
        
        # Deduplicate
        all_emails = list(set(all_emails))
        all_phones = list(set(all_phones))
        for platform in all_social_links:
            all_social_links[platform] = list(set(all_social_links[platform]))
        
        return {
            'success': True,
            'query': query,
            'pages_scraped': len(all_results),
            'emails': all_emails,
            'phones': all_phones,
            'social_links': all_social_links,
            'results': all_results,
        }
    
    except Exception as e:
        return {
            'success': False,
            'query': query,
            'error': str(e),
            'results': [],
            'emails': [],
            'phones': [],
            'social_links': {},
        }


def main():
    parser = argparse.ArgumentParser(description='Search Engine Scraper')
    parser.add_argument('--query', required=True, help='Search query')
    parser.add_argument('--max-pages', type=int, default=5, help='Number of result pages to scrape')
    parser.add_argument('--fetcher', default='stealthy', choices=['basic', 'stealthy', 'dynamic'], help='Fetcher type')
    
    args = parser.parse_args()
    result = scrape_search_engine(args.query, args.max_pages, args.fetcher)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
