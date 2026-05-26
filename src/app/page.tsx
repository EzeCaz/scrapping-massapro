'use client';

import React, { useState, useCallback, useEffect } from 'react';
import {
  Search,
  MapPin,
  Globe,
  Mail,
  Phone,
  ExternalLink,
  Download,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Star,
  Building2,
  Zap,
  Shield,
  MousePointerClick,
  FileJson,
  FileSpreadsheet,
  Trash2,
  Copy,
  Check,
  ListChecks,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  Sheet,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';

// Types
interface ScrapingConfig {
  type: 'google-maps' | 'generic' | 'search';
  query: string;
  url: string;
  maxResults: number;
  maxPages: number;
  depth: number;
  fetcher: 'basic' | 'stealthy' | 'dynamic';
  domains: string[];
  fetchDetails: boolean;
}

interface BusinessResult {
  name: string;
  address: string;
  phone: string;
  website: string;
  rating: string;
  reviews_count: string;
  category: string;
  email: string;
  source: string;
  source_url: string;
  priority_score?: number;
}

interface GenericResult {
  url: string;
  title: string;
  description: string;
  emails: string[];
  phones: string[];
  addresses: string[];
  social_links: Record<string, string[]>;
  error?: string;
}

interface ScrapeResponse {
  success: boolean;
  error?: string;
  query?: string;
  url?: string;
  results_count?: number;
  results?: BusinessResult[];
  emails?: string[];
  phones?: string[];
  addresses?: string[];
  social_links?: Record<string, string[]>;
  page_details?: GenericResult[];
  page_emails?: string[];
  page_phones?: string[];
  pages_scraped?: number;
  raw_output?: string;
}

interface DomainOption {
  value: string;
  label: string;
  icon: React.ReactNode;
  description: string;
}

interface Lead {
  id: string;
  name: string;
  address: string;
  phone: string;
  website: string;
  email: string;
  rating: string;
  reviewsCount: string;
  category: string;
  source: string;
  sourceUrl: string;
  priorityScore: number;
  notes: string;
  status: 'new' | 'contacted' | 'qualified' | 'lost';
  createdAt: string;
  updatedAt: string;
}

type LeadSortField = 'name' | 'email' | 'phone' | 'address' | 'category' | 'status' | 'priorityScore' | 'createdAt' | 'updatedAt';
type SortOrder = 'asc' | 'desc';

const DOMAIN_OPTIONS: DomainOption[] = [
  {
    value: 'google-maps',
    label: 'Google Maps',
    icon: <MapPin className="h-4 w-4" />,
    description: 'Search business listings on Google Maps',
  },
  {
    value: 'search',
    label: 'Google Search',
    icon: <Search className="h-4 w-4" />,
    description: 'Search the web and scrape result pages',
  },
  {
    value: 'generic',
    label: 'Direct URL',
    icon: <Globe className="h-4 w-4" />,
    description: 'Scrape a specific website URL directly',
  },
];

const FETCHER_INFO = {
  basic: {
    label: 'Fetcher (Basic)',
    icon: <Zap className="h-4 w-4" />,
    description: 'Fast HTTP requests with TLS fingerprint. Best for simple sites.',
  },
  stealthy: {
    label: 'StealthyFetcher',
    icon: <Shield className="h-4 w-4" />,
    description: 'Bypasses Cloudflare & anti-bot. Best for protected sites.',
  },
  dynamic: {
    label: 'DynamicFetcher',
    icon: <MousePointerClick className="h-4 w-4" />,
    description: 'Full browser automation. Best for JavaScript-heavy sites like Google Maps.',
  },
};

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  contacted: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  qualified: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  lost: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

export default function Home() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('config');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [config, setConfig] = useState<ScrapingConfig>({
    type: 'google-maps',
    query: '',
    url: '',
    maxResults: 20,
    maxPages: 5,
    depth: 0,
    fetcher: 'dynamic',
    domains: [],
    fetchDetails: true,
  });
  const [domainInput, setDomainInput] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [result, setResult] = useState<ScrapeResponse | null>(null);
  const [scrapeHistory, setScrapeHistory] = useState<
    { timestamp: string; config: ScrapingConfig; result: ScrapeResponse }[]
  >([]);

  // Lead selection on Results tab
  const [selectedResultIndexes, setSelectedResultIndexes] = useState<Set<number>>(new Set());
  const [addingToLeads, setAddingToLeads] = useState(false);

  // Lead List state
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadSortBy, setLeadSortBy] = useState<LeadSortField>('createdAt');
  const [leadSortOrder, setLeadSortOrder] = useState<SortOrder>('desc');
  const [leadSearchFilter, setLeadSearchFilter] = useState('');
  const [leadStatusFilter, setLeadStatusFilter] = useState<string>('all');
  const [leadCategoryFilter, setLeadCategoryFilter] = useState('');
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [deletingLeads, setDeletingLeads] = useState(false);

  // Fetch leads when Lead List tab is selected
  const fetchLeads = useCallback(async () => {
    setLeadsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('sortBy', leadSortBy);
      params.set('sortOrder', leadSortOrder);
      if (leadStatusFilter && leadStatusFilter !== 'all') params.set('status', leadStatusFilter);
      if (leadSearchFilter) params.set('search', leadSearchFilter);
      if (leadCategoryFilter) params.set('category', leadCategoryFilter);

      const res = await fetch(`/api/leads?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setLeads(data.leads);
      } else {
        toast({ title: 'Error loading leads', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load leads', variant: 'destructive' });
    } finally {
      setLeadsLoading(false);
    }
  }, [leadSortBy, leadSortOrder, leadStatusFilter, leadSearchFilter, leadCategoryFilter, toast]);

  useEffect(() => {
    if (activeTab === 'leads') {
      fetchLeads();
    }
  }, [activeTab, leadSortBy, leadSortOrder, leadStatusFilter, leadSearchFilter, leadCategoryFilter, fetchLeads]);

  // Warm up the Render scraper service on page load so it's ready when user searches
  const [scraperAwake, setScraperAwake] = useState(false);
  useEffect(() => {
    fetch('/api/wakeup').catch(() => {}).then((res) => {
      if (res?.ok) {
        setScraperAwake(true);
        console.log('[warmup] Scraper service is awake');
      }
    });
  }, []);

  const handleScrape = useCallback(async () => {
    if (config.type !== 'generic' && !config.query.trim()) {
      toast({
        title: 'Missing query',
        description: 'Please enter a search query',
        variant: 'destructive',
      });
      return;
    }
    if (config.type === 'generic' && !config.url.trim()) {
      toast({
        title: 'Missing URL',
        description: 'Please enter a URL to scrape',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    setProgress(0);
    setResult(null);
    setSelectedResultIndexes(new Set());
    setStatusMessage('Starting scraper...');
    setActiveTab('results');

    try {
      // Start the async job
      const startResponse = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      const startData = await startResponse.json();

      if (!startData.success || !startData.jobId) {
        setResult({ success: false, error: startData.error || 'Failed to start scraping job' });
        setLoading(false);
        return;
      }

      const jobId = startData.jobId;

      // Poll for progress
      const pollInterval = setInterval(async () => {
        try {
          const pollResponse = await fetch(`/api/scrape?jobId=${jobId}`);
          const pollData = await pollResponse.json();

          if (pollData.progress !== undefined) {
            setProgress(pollData.progress);
          }
          if (pollData.message) {
            setStatusMessage(pollData.message);
          }

          if (pollData.status === 'completed') {
            clearInterval(pollInterval);
            setResult(pollData.result);
            setProgress(100);
            setLoading(false);

            if (pollData.result?.success) {
              setScrapeHistory((prev) => [
                { timestamp: new Date().toISOString(), config: { ...config }, result: pollData.result },
                ...prev,
              ]);
              toast({
                title: 'Scraping complete!',
                description: `Found ${pollData.result.results?.length || pollData.result.emails?.length || 0} results`,
              });
            } else {
              toast({
                title: 'Scraping completed with issues',
                description: pollData.result?.error || 'No results found',
                variant: 'destructive',
              });
            }
          } else if (pollData.status === 'failed') {
            clearInterval(pollInterval);
            setResult({ success: false, error: pollData.error || 'Scraping failed' });
            setProgress(0);
            setLoading(false);
            toast({
              title: 'Scraping failed',
              description: pollData.error || 'Unknown error',
              variant: 'destructive',
            });
          }
        } catch {
          // Polling error, continue
        }
      }, 2000);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to scrape',
        variant: 'destructive',
      });
      setLoading(false);
    }
  }, [config, toast]);

  const exportJSON = useCallback(() => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scrape-results-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const exportCSV = useCallback(() => {
    if (!result) return;
    let csvContent = '';

    if (result.results && result.results.length > 0) {
      const headers = ['Name', 'Address', 'Phone', 'Email', 'Website', 'Rating', 'Category', 'Source'];
      csvContent = headers.join(',') + '\n';
      csvContent += result.results
        .map((r) =>
          [
            `"${(r.name || '').replace(/"/g, '""')}"`,
            `"${(r.address || '').replace(/"/g, '""')}"`,
            `"${(r.phone || '').replace(/"/g, '""')}"`,
            `"${(r.email || '').replace(/"/g, '""')}"`,
            `"${(r.website || '').replace(/"/g, '""')}"`,
            r.rating || '',
            `"${(r.category || '').replace(/"/g, '""')}"`,
            r.source || '',
          ].join(',')
        )
        .join('\n');
    } else if (result.page_details && result.page_details.length > 0) {
      const headers = ['URL', 'Title', 'Emails', 'Phones', 'Social Links'];
      csvContent = headers.join(',') + '\n';
      csvContent += result.page_details
        .map((r) =>
          [
            `"${r.url}"`,
            `"${(r.title || '').replace(/"/g, '""')}"`,
            `"${(r.emails || []).join('; ')}"`,
            `"${(r.phones || []).join('; ')}"`,
            `"${Object.entries(r.social_links || {})
              .map(([k, v]) => `${k}: ${v.join(', ')}`)
              .join('; ')}"`,
          ].join(',')
        )
        .join('\n');
    } else {
      csvContent = 'Emails,Phones,Addresses\n';
      csvContent += `"${(result.emails || []).join('; ')}","${(result.phones || []).join('; ')}","${(result.addresses || []).join('; ')}"`;
    }

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scrape-results-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const copyToClipboard = useCallback(
    async (text: string, field: string) => {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    },
    []
  );

  const addDomain = useCallback(() => {
    const domain = domainInput.trim();
    if (domain && !config.domains.includes(domain)) {
      setConfig((prev) => ({ ...prev, domains: [...prev.domains, domain] }));
      setDomainInput('');
    }
  }, [domainInput, config.domains]);

  const removeDomain = useCallback((domain: string) => {
    setConfig((prev) => ({ ...prev, domains: prev.domains.filter((d) => d !== domain) }));
  }, []);

  const clearResults = useCallback(() => {
    setResult(null);
    setProgress(0);
    setSelectedResultIndexes(new Set());
  }, []);

  // Toggle result row selection
  const toggleResultSelection = useCallback((index: number) => {
    setSelectedResultIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const toggleAllResults = useCallback(() => {
    if (!result?.results) return;
    if (selectedResultIndexes.size === result.results.length) {
      setSelectedResultIndexes(new Set());
    } else {
      setSelectedResultIndexes(new Set(result.results.map((_, i) => i)));
    }
  }, [result?.results, selectedResultIndexes.size]);

  // Add selected results to Lead List
  const addSelectedToLeads = useCallback(async () => {
    if (!result?.results || selectedResultIndexes.size === 0) return;
    setAddingToLeads(true);
    try {
      const selectedLeads = Array.from(selectedResultIndexes).map((i) => result.results![i]);
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: selectedLeads }),
      });
      const data = await res.json();
      if (data.success) {
        toast({
          title: 'Leads added!',
          description: `${data.created} lead(s) added, ${data.skipped} duplicate(s) skipped.`,
        });
        setSelectedResultIndexes(new Set());
      } else {
        toast({ title: 'Error', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to add leads', variant: 'destructive' });
    } finally {
      setAddingToLeads(false);
    }
  }, [result?.results, selectedResultIndexes, toast]);

  // Toggle lead selection
  const toggleLeadSelection = useCallback((id: string) => {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAllLeads = useCallback(() => {
    if (selectedLeadIds.size === leads.length) {
      setSelectedLeadIds(new Set());
    } else {
      setSelectedLeadIds(new Set(leads.map((l) => l.id)));
    }
  }, [leads, selectedLeadIds.size]);

  // Delete selected leads
  const deleteSelectedLeads = useCallback(async () => {
    if (selectedLeadIds.size === 0) return;
    setDeletingLeads(true);
    try {
      const res = await fetch('/api/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedLeadIds) }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'Leads deleted', description: `${data.deleted} lead(s) deleted.` });
        setSelectedLeadIds(new Set());
        fetchLeads();
      } else {
        toast({ title: 'Error', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to delete leads', variant: 'destructive' });
    } finally {
      setDeletingLeads(false);
    }
  }, [selectedLeadIds, toast, fetchLeads]);

  // Update lead status
  const updateLeadStatus = useCallback(async (id: string, status: string) => {
    try {
      const res = await fetch('/api/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      const data = await res.json();
      if (data.success) {
        setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status: status as Lead['status'] } : l)));
        toast({ title: 'Status updated', description: `Lead status changed to ${status}.` });
      } else {
        toast({ title: 'Error', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to update lead', variant: 'destructive' });
    }
  }, [toast]);

  // Sort handler
  const handleLeadSort = useCallback((field: LeadSortField) => {
    setLeadSortBy((prev) => {
      if (prev === field) {
        setLeadSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
      } else {
        setLeadSortOrder('asc');
      }
      return field;
    });
  }, []);

  // Export leads as CSV
  const exportLeadsCSV = useCallback((leadsToExport: Lead[]) => {
    const headers = ['Name', 'Address', 'Phone', 'Email', 'Website', 'Rating', 'Reviews', 'Category', 'Status', 'Priority Score', 'Source', 'Notes', 'Created At'];
    let csv = headers.join(',') + '\n';
    csv += leadsToExport
      .map((l) =>
        [
          `"${(l.name || '').replace(/"/g, '""')}"`,
          `"${(l.address || '').replace(/"/g, '""')}"`,
          `"${(l.phone || '').replace(/"/g, '""')}"`,
          `"${(l.email || '').replace(/"/g, '""')}"`,
          `"${(l.website || '').replace(/"/g, '""')}"`,
          l.rating || '',
          `"${(l.reviewsCount || '').replace(/"/g, '""')}"`,
          `"${(l.category || '').replace(/"/g, '""')}"`,
          l.status || '',
          l.priorityScore || 0,
          `"${(l.source || '').replace(/"/g, '""')}"`,
          `"${(l.notes || '').replace(/"/g, '""')}"`,
          l.createdAt || '',
        ].join(',')
      )
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'CSV exported', description: `${leadsToExport.length} lead(s) exported.` });
  }, [toast]);

  // Export leads as JSON
  const exportLeadsJSON = useCallback((leadsToExport: Lead[]) => {
    const blob = new Blob([JSON.stringify(leadsToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'JSON exported', description: `${leadsToExport.length} lead(s) exported.` });
  }, [toast]);

  // Open in Google Sheets
  const openInGoogleSheets = useCallback((leadsToExport: Lead[]) => {
    // Export CSV first, then open Google Sheets with instructions
    const headers = ['Name', 'Address', 'Phone', 'Email', 'Website', 'Rating', 'Reviews', 'Category', 'Status', 'Priority Score', 'Source', 'Notes'];
    let tsv = headers.join('\t') + '\n';
    tsv += leadsToExport
      .map((l) =>
        [
          l.name || '',
          l.address || '',
          l.phone || '',
          l.email || '',
          l.website || '',
          l.rating || '',
          l.reviewsCount || '',
          l.category || '',
          l.status || '',
          l.priorityScore || 0,
          l.source || '',
          l.notes || '',
        ]
          .map((v) => String(v).replace(/\t/g, ' '))
          .join('\t')
      )
      .join('\n');

    // Copy TSV to clipboard and open Google Sheets
    navigator.clipboard.writeText(tsv).then(() => {
      window.open('https://docs.google.com/spreadsheets/create', '_blank');
      toast({
        title: 'Ready for Google Sheets',
        description: 'Data copied to clipboard! In Google Sheets, paste (Ctrl+V / Cmd+V) to import.',
      });
    });
  }, [toast]);

  // Get leads to export (selected or all)
  const getExportLeads = useCallback((): Lead[] => {
    if (selectedLeadIds.size > 0) {
      return leads.filter((l) => selectedLeadIds.has(l.id));
    }
    return leads;
  }, [leads, selectedLeadIds]);

  // Sort icon renderer
  const renderSortIcon = useCallback(
    (field: LeadSortField) => {
      if (leadSortBy !== field) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />;
      return leadSortOrder === 'asc' ? (
        <ArrowUp className="ml-1 h-3 w-3" />
      ) : (
        <ArrowDown className="ml-1 h-3 w-3" />
      );
    },
    [leadSortBy, leadSortOrder]
  );

  // Count stats
  const totalEmails =
    result?.emails?.length || result?.results?.filter(r => r.email).length || result?.page_emails?.length || 0;
  const totalPhones =
    result?.phones?.length || result?.results?.filter(r => r.phone).length || result?.page_phones?.length || 0;
  const totalResults = result?.results?.length || result?.page_details?.length || 0;
  const totalSocial = Object.values(result?.social_links || {}).reduce(
    (sum, links) => sum + links.length,
    0
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Search className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">Scrapling Web Scraper</h1>
                <p className="text-sm text-muted-foreground">
                  Powered by Scrapling — Extract contact data from Google Maps & the web
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Scraper service status indicator */}
              <Badge variant={scraperAwake ? "default" : "secondary"} className="text-xs gap-1">
                <span className={`h-2 w-2 rounded-full ${scraperAwake ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`} />
                {scraperAwake ? 'Service Ready' : 'Waking up...'}
              </Badge>
              {result && (
                <>
                  <Button variant="outline" size="sm" onClick={exportCSV}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={exportJSON}>
                    <FileJson className="mr-2 h-4 w-4" />
                    JSON
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 flex-1">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="config">
              <Search className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Configure Search</span>
              <span className="sm:hidden">Search</span>
            </TabsTrigger>
            <TabsTrigger value="results">
              <Building2 className="mr-2 h-4 w-4" />
              Results
              {totalResults > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {totalResults}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="leads">
              <ListChecks className="mr-2 h-4 w-4" />
              Lead List
              {leads.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {leads.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="history">
              <Globe className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">History</span>
              <span className="sm:hidden">History</span>
              {scrapeHistory.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {scrapeHistory.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ===================== CONFIG TAB ===================== */}
          <TabsContent value="config" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-3">
              {/* Left: Search Config */}
              <div className="lg:col-span-2 space-y-6">
                {/* Search Type */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Search Domain</CardTitle>
                    <CardDescription>Choose where to search for data</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {DOMAIN_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          onClick={() =>
                            setConfig((prev) => ({
                              ...prev,
                              type: option.value as ScrapingConfig['type'],
                              fetcher:
                                option.value === 'google-maps'
                                  ? 'dynamic'
                                  : option.value === 'search'
                                  ? 'stealthy'
                                  : 'stealthy',
                            }))
                          }
                          className={`flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-all hover:bg-accent ${
                            config.type === option.value
                              ? 'border-primary bg-primary/5 ring-1 ring-primary'
                              : 'border-border'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {option.icon}
                            <span className="font-medium">{option.label}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">{option.description}</span>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Search Input */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">
                      {config.type === 'generic' ? 'Target URL' : 'Search Query'}
                    </CardTitle>
                    <CardDescription>
                      {config.type === 'google-maps'
                        ? 'e.g., "restaurants near New York", "dentists in London"'
                        : config.type === 'search'
                        ? 'e.g., "plumbers in Chicago", "web design agencies Berlin"'
                        : 'Enter the full URL of the website to scrape'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {config.type === 'generic' ? (
                      <div className="space-y-2">
                        <Label htmlFor="url">Website URL</Label>
                        <Input
                          id="url"
                          placeholder="https://example.com"
                          value={config.url}
                          onChange={(e) => setConfig((prev) => ({ ...prev, url: e.target.value }))}
                        />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label htmlFor="query">Search Query</Label>
                        <Textarea
                          id="query"
                          placeholder={
                            config.type === 'google-maps'
                              ? 'restaurants near New York'
                              : 'plumbers in Chicago'
                          }
                          value={config.query}
                          onChange={(e) => setConfig((prev) => ({ ...prev, query: e.target.value }))}
                          rows={2}
                        />
                      </div>
                    )}

                    {/* Domain Filter for search mode */}
                    {config.type === 'search' && (
                      <div className="space-y-3">
                        <Label>Domain Filter (optional)</Label>
                        <div className="flex gap-2">
                          <Input
                            placeholder="e.g., linkedin.com, yelp.com"
                            value={domainInput}
                            onChange={(e) => setDomainInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addDomain()}
                          />
                          <Button variant="outline" onClick={addDomain}>
                            Add
                          </Button>
                        </div>
                        {config.domains.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {config.domains.map((domain) => (
                              <Badge key={domain} variant="secondary" className="gap-1">
                                {domain}
                                <button
                                  onClick={() => removeDomain(domain)}
                                  className="ml-1 hover:text-destructive"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Fetcher Type */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Fetcher Engine</CardTitle>
                    <CardDescription>
                      Choose the scraping engine based on the target site complexity
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {(Object.keys(FETCHER_INFO) as Array<keyof typeof FETCHER_INFO>).map(
                        (key) => {
                          const info = FETCHER_INFO[key];
                          return (
                            <button
                              key={key}
                              onClick={() => setConfig((prev) => ({ ...prev, fetcher: key }))}
                              className={`flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-all hover:bg-accent ${
                                config.fetcher === key
                                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                  : 'border-border'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                {info.icon}
                                <span className="font-medium text-sm">{info.label}</span>
                              </div>
                              <span className="text-xs text-muted-foreground">{info.description}</span>
                            </button>
                          );
                        }
                      )}
                    </div>
                    {config.type === 'google-maps' && config.fetcher !== 'dynamic' && (
                      <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-200">
                        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>Google Maps requires JavaScript rendering. DynamicFetcher is recommended.</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Right: Settings & Actions */}
              <div className="space-y-6">
                {/* Parameters */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Parameters</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {config.type === 'google-maps' && (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="maxResults">Max Results</Label>
                          <Input
                            id="maxResults"
                            type="number"
                            min={1}
                            max={500}
                            value={config.maxResults}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                maxResults: Math.min(parseInt(e.target.value) || 20, 500),
                              }))
                            }
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <Label htmlFor="fetchDetails">Fetch Details</Label>
                            <p className="text-xs text-muted-foreground">
                              Visit each business page for phone, website &amp; email
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs">Recommended</Badge>
                            <Switch
                              id="fetchDetails"
                              checked={config.fetchDetails}
                              onCheckedChange={(checked) =>
                                setConfig((prev) => ({ ...prev, fetchDetails: checked }))
                              }
                            />
                          </div>
                        </div>
                      </>
                    )}

                    {config.type === 'search' && (
                      <div className="space-y-2">
                        <Label htmlFor="maxPages">Pages to Scrape</Label>
                        <Input
                          id="maxPages"
                          type="number"
                          min={1}
                          max={20}
                          value={config.maxPages}
                          onChange={(e) =>
                            setConfig((prev) => ({
                              ...prev,
                              maxPages: parseInt(e.target.value) || 5,
                            }))
                          }
                        />
                      </div>
                    )}

                    {config.type === 'generic' && (
                      <div className="space-y-3">
                        <Label htmlFor="depth">Crawl Depth</Label>
                        <Input
                          id="depth"
                          type="number"
                          min={0}
                          max={3}
                          value={config.depth}
                          onChange={(e) =>
                            setConfig((prev) => ({
                              ...prev,
                              depth: parseInt(e.target.value) || 0,
                            }))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          0 = single page, 1+ = follow internal links
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Quick Summary */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Scrape Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Source</span>
                      <span className="font-medium">
                        {DOMAIN_OPTIONS.find((d) => d.value === config.type)?.label}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Fetcher</span>
                      <span className="font-medium">{FETCHER_INFO[config.fetcher].label}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {config.type === 'generic' ? 'Target URL' : 'Query'}
                      </span>
                      <span className="font-medium truncate max-w-[150px]">
                        {config.type === 'generic' ? config.url || '—' : config.query || '—'}
                      </span>
                    </div>
                    {config.type === 'search' && config.domains.length > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Domains</span>
                        <span className="font-medium">{config.domains.length} filter(s)</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Action Buttons */}
                <Button
                  className="w-full h-12 text-base"
                  onClick={handleScrape}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Scraping...
                    </>
                  ) : (
                    <>
                      <Search className="mr-2 h-5 w-5" />
                      Start Scraping
                    </>
                  )}
                </Button>

                {result && (
                  <Button variant="outline" className="w-full" onClick={clearResults}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Clear Results
                  </Button>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ===================== RESULTS TAB ===================== */}
          <TabsContent value="results" className="space-y-6">
            {/* Loading Progress */}
            {loading && (
              <Card>
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{statusMessage || 'Scraping in progress...'}</span>
                      <span className="font-medium">{Math.round(progress)}%</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                    <p className="text-xs text-muted-foreground">
                      Fetching business details and emails. This may take a few minutes...
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Error State */}
            {result && !result.success && (
              <Card className="border-destructive">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-semibold text-destructive">Scraping Failed</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        {result.error || 'An unknown error occurred.'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Results */}
            {result && result.success && (
              <>
                {/* Stats Cards */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                          <Building2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{totalResults}</p>
                          <p className="text-xs text-muted-foreground">Results Found</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
                          <Mail className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{totalEmails}</p>
                          <p className="text-xs text-muted-foreground">Emails</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                          <Phone className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{totalPhones}</p>
                          <p className="text-xs text-muted-foreground">Phone Numbers</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
                          <Globe className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{totalSocial}</p>
                          <p className="text-xs text-muted-foreground">Social Links</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Add to Lead List Action Bar */}
                {result.results && result.results.length > 0 && selectedResultIndexes.size > 0 && (
                  <Card className="border-primary/50 bg-primary/5">
                    <CardContent className="pt-6">
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <ListChecks className="h-5 w-5 text-primary" />
                          <span className="font-medium">
                            {selectedResultIndexes.size} result(s) selected
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedResultIndexes(new Set())}
                          >
                            Clear Selection
                          </Button>
                          <Button
                            size="sm"
                            onClick={addSelectedToLeads}
                            disabled={addingToLeads}
                          >
                            {addingToLeads ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Plus className="mr-2 h-4 w-4" />
                            )}
                            Add to Lead List
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Business Results Table (Google Maps) */}
                {result.results && result.results.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Business Listings</CardTitle>
                      <CardDescription>
                        {result.results.length} businesses found for &ldquo;{result.query}&rdquo;
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="rounded-md border overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-12">
                                <Checkbox
                                  checked={
                                    result.results.length > 0 &&
                                    selectedResultIndexes.size === result.results.length
                                  }
                                  onCheckedChange={toggleAllResults}
                                  aria-label="Select all results"
                                />
                              </TableHead>
                              <TableHead className="min-w-[200px]">Name</TableHead>
                              <TableHead className="min-w-[150px]">Address</TableHead>
                              <TableHead>Phone</TableHead>
                              <TableHead>Email</TableHead>
                              <TableHead>Rating</TableHead>
                              <TableHead>Category</TableHead>
                              <TableHead>Website</TableHead>
                              <TableHead>Score</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {result.results.map((biz, i) => (
                              <TableRow
                                key={i}
                                className={selectedResultIndexes.has(i) ? 'bg-primary/5' : ''}
                              >
                                <TableCell>
                                  <Checkbox
                                    checked={selectedResultIndexes.has(i)}
                                    onCheckedChange={() => toggleResultSelection(i)}
                                    aria-label={`Select ${biz.name}`}
                                  />
                                </TableCell>
                                <TableCell className="font-medium">{biz.name || '—'}</TableCell>
                                <TableCell className="text-sm">{biz.address || '—'}</TableCell>
                                <TableCell>
                                  {biz.phone ? (
                                    <span className="inline-flex items-center gap-1 text-sm">
                                      <Phone className="h-3 w-3" />
                                      {biz.phone}
                                    </span>
                                  ) : (
                                    '—'
                                  )}
                                </TableCell>
                                <TableCell>
                                  {biz.email ? (
                                    <span className="inline-flex items-center gap-1 text-sm">
                                      <Mail className="h-3 w-3" />
                                      {biz.email}
                                    </span>
                                  ) : (
                                    '—'
                                  )}
                                </TableCell>
                                <TableCell>
                                  {biz.rating ? (
                                    <span className="inline-flex items-center gap-1">
                                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                                      {biz.rating}
                                      {biz.reviews_count && (
                                        <span className="text-xs text-muted-foreground">
                                          ({biz.reviews_count})
                                        </span>
                                      )}
                                    </span>
                                  ) : (
                                    '—'
                                  )}
                                </TableCell>
                                <TableCell>
                                  {biz.category ? (
                                    <Badge variant="secondary" className="text-xs">
                                      {biz.category}
                                    </Badge>
                                  ) : (
                                    '—'
                                  )}
                                </TableCell>
                                <TableCell>
                                  {biz.website ? (
                                    <a
                                      href={biz.website}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                      Visit
                                    </a>
                                  ) : (
                                    '—'
                                  )}
                                </TableCell>
                                <TableCell>
                                  {biz.priority_score !== undefined ? (
                                    <Badge
                                      variant={biz.priority_score >= 100 ? 'default' : biz.priority_score >= 50 ? 'secondary' : 'outline'}
                                      className="text-xs"
                                    >
                                      {biz.priority_score}
                                    </Badge>
                                  ) : (
                                    '—'
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Aggregated Contact Info */}
                {(result.emails && result.emails.length > 0) ||
                (result.phones && result.phones.length > 0) ||
                (result.addresses && result.addresses.length > 0) ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Extracted Contact Data</CardTitle>
                      <CardDescription>
                        All unique emails, phone numbers, and addresses found across scraped pages
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-6 md:grid-cols-3">
                        {/* Emails */}
                        <div className="space-y-3">
                          <h4 className="flex items-center gap-2 font-medium text-sm">
                            <Mail className="h-4 w-4 text-orange-500" />
                            Emails ({result.emails?.length || 0})
                          </h4>
                          <div className="max-h-64 overflow-y-auto space-y-1.5 rounded-md border p-3">
                            {(result.emails || []).length === 0 ? (
                              <p className="text-xs text-muted-foreground">No emails found</p>
                            ) : (
                              (result.emails || []).map((email, i) => (
                                <div
                                  key={i}
                                  className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                                >
                                  <span className="truncate">{email}</span>
                                  <button
                                    onClick={() => copyToClipboard(email, `email-${i}`)}
                                    className="shrink-0 text-muted-foreground hover:text-foreground"
                                  >
                                    {copiedField === `email-${i}` ? (
                                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                                    ) : (
                                      <Copy className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        {/* Phones */}
                        <div className="space-y-3">
                          <h4 className="flex items-center gap-2 font-medium text-sm">
                            <Phone className="h-4 w-4 text-violet-500" />
                            Phone Numbers ({result.phones?.length || 0})
                          </h4>
                          <div className="max-h-64 overflow-y-auto space-y-1.5 rounded-md border p-3">
                            {(result.phones || []).length === 0 ? (
                              <p className="text-xs text-muted-foreground">No phones found</p>
                            ) : (
                              (result.phones || []).map((phone, i) => (
                                <div
                                  key={i}
                                  className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                                >
                                  <span className="truncate">{phone}</span>
                                  <button
                                    onClick={() => copyToClipboard(phone, `phone-${i}`)}
                                    className="shrink-0 text-muted-foreground hover:text-foreground"
                                  >
                                    {copiedField === `phone-${i}` ? (
                                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                                    ) : (
                                      <Copy className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        {/* Addresses */}
                        <div className="space-y-3">
                          <h4 className="flex items-center gap-2 font-medium text-sm">
                            <MapPin className="h-4 w-4 text-emerald-500" />
                            Addresses ({result.addresses?.length || 0})
                          </h4>
                          <div className="max-h-64 overflow-y-auto space-y-1.5 rounded-md border p-3">
                            {(result.addresses || []).length === 0 ? (
                              <p className="text-xs text-muted-foreground">No addresses found</p>
                            ) : (
                              (result.addresses || []).map((addr, i) => (
                                <div
                                  key={i}
                                  className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                                >
                                  <span className="truncate">{addr}</span>
                                  <button
                                    onClick={() => copyToClipboard(addr, `addr-${i}`)}
                                    className="shrink-0 text-muted-foreground hover:text-foreground"
                                  >
                                    {copiedField === `addr-${i}` ? (
                                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                                    ) : (
                                      <Copy className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ) : null}

                {/* Social Links */}
                {result.social_links && Object.keys(result.social_links).length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Social Media Profiles</CardTitle>
                      <CardDescription>Social media accounts found during scraping</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {Object.entries(result.social_links).map(([platform, links]) => (
                          <div key={platform} className="space-y-2">
                            <h4 className="font-medium text-sm capitalize">{platform}</h4>
                            <div className="space-y-1">
                              {links.map((link, i) => (
                                <a
                                  key={i}
                                  href={link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted hover:underline"
                                >
                                  <ExternalLink className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{link}</span>
                                </a>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Page Details (Generic/Search results) */}
                {result.page_details && result.page_details.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Page Details</CardTitle>
                      <CardDescription>
                        Contact data extracted from {result.page_details.length} page(s)
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Accordion type="multiple" className="w-full">
                        {result.page_details.map((page, i) => (
                          <AccordionItem key={i} value={`page-${i}`}>
                            <AccordionTrigger className="hover:no-underline">
                              <div className="flex items-center gap-3 text-left">
                                <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <div>
                                  <p className="font-medium text-sm">{page.title || page.url}</p>
                                  <p className="text-xs text-muted-foreground truncate max-w-md">
                                    {page.url}
                                  </p>
                                </div>
                                {page.error && <Badge variant="destructive">Error</Badge>}
                              </div>
                            </AccordionTrigger>
                            <AccordionContent>
                              {page.error ? (
                                <p className="text-sm text-destructive">{page.error}</p>
                              ) : (
                                <div className="grid gap-4 sm:grid-cols-2">
                                  <div>
                                    <h5 className="text-xs font-medium text-muted-foreground mb-2">
                                      Description
                                    </h5>
                                    <p className="text-sm">{page.description || 'No description'}</p>
                                  </div>
                                  <div className="space-y-3">
                                    {page.emails.length > 0 && (
                                      <div>
                                        <h5 className="text-xs font-medium text-muted-foreground mb-1">
                                          Emails
                                        </h5>
                                        {page.emails.map((e, j) => (
                                          <p key={j} className="text-sm flex items-center gap-1">
                                            <Mail className="h-3 w-3" /> {e}
                                          </p>
                                        ))}
                                      </div>
                                    )}
                                    {page.phones.length > 0 && (
                                      <div>
                                        <h5 className="text-xs font-medium text-muted-foreground mb-1">
                                          Phones
                                        </h5>
                                        {page.phones.map((p, j) => (
                                          <p key={j} className="text-sm flex items-center gap-1">
                                            <Phone className="h-3 w-3" /> {p}
                                          </p>
                                        ))}
                                      </div>
                                    )}
                                    {Object.keys(page.social_links).length > 0 && (
                                      <div>
                                        <h5 className="text-xs font-medium text-muted-foreground mb-1">
                                          Social
                                        </h5>
                                        {Object.entries(page.social_links).map(
                                          ([platform, links]) => (
                                            <p key={platform} className="text-sm">
                                              <span className="font-medium capitalize">
                                                {platform}:
                                              </span>{' '}
                                              {links.join(', ')}
                                            </p>
                                          )
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </CardContent>
                  </Card>
                )}

                {/* Export Bar */}
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                      <p className="text-sm text-muted-foreground">
                        Export {totalResults} results with {totalEmails} emails and {totalPhones}{' '}
                        phone numbers
                      </p>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={exportCSV}>
                          <FileSpreadsheet className="mr-2 h-4 w-4" />
                          Export CSV
                        </Button>
                        <Button variant="outline" size="sm" onClick={exportJSON}>
                          <FileJson className="mr-2 h-4 w-4" />
                          Export JSON
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {/* Empty State */}
            {!result && !loading && (
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
                      <Search className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="text-lg font-semibold">No Results Yet</h3>
                    <p className="text-sm text-muted-foreground mt-1 max-w-md">
                      Configure your search in the &ldquo;Configure Search&rdquo; tab, then click
                      &ldquo;Start Scraping&rdquo; to extract data.
                    </p>
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => setActiveTab('config')}
                    >
                      Go to Configuration
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ===================== LEAD LIST TAB ===================== */}
          <TabsContent value="leads" className="space-y-6">
            {/* Filters Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Filter className="h-5 w-5" />
                  Filter & Search Leads
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="lead-search">Search</Label>
                    <Input
                      id="lead-search"
                      placeholder="Search by name, email, phone..."
                      value={leadSearchFilter}
                      onChange={(e) => setLeadSearchFilter(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lead-status-filter">Status</Label>
                    <Select value={leadStatusFilter} onValueChange={setLeadStatusFilter}>
                      <SelectTrigger id="lead-status-filter">
                        <SelectValue placeholder="All statuses" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="new">New</SelectItem>
                        <SelectItem value="contacted">Contacted</SelectItem>
                        <SelectItem value="qualified">Qualified</SelectItem>
                        <SelectItem value="lost">Lost</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lead-category-filter">Category</Label>
                    <Input
                      id="lead-category-filter"
                      placeholder="Filter by category..."
                      value={leadCategoryFilter}
                      onChange={(e) => setLeadCategoryFilter(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Bulk Actions */}
            {selectedLeadIds.size > 0 && (
              <Card className="border-destructive/50 bg-destructive/5">
                <CardContent className="pt-6">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <ListChecks className="h-5 w-5 text-destructive" />
                      <span className="font-medium">
                        {selectedLeadIds.size} lead(s) selected
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedLeadIds(new Set())}
                      >
                        Clear Selection
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={deleteSelectedLeads}
                        disabled={deletingLeads}
                      >
                        {deletingLeads ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="mr-2 h-4 w-4" />
                        )}
                        Delete Selected
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Export Bar for Leads */}
            {leads.length > 0 && (
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <p className="text-sm text-muted-foreground">
                      {selectedLeadIds.size > 0
                        ? `Export ${selectedLeadIds.size} selected lead(s)`
                        : `Export ${leads.length} lead(s)`}
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => exportLeadsCSV(getExportLeads())}
                      >
                        <FileSpreadsheet className="mr-2 h-4 w-4" />
                        CSV
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => exportLeadsJSON(getExportLeads())}
                      >
                        <FileJson className="mr-2 h-4 w-4" />
                        JSON
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openInGoogleSheets(getExportLeads())}
                      >
                        <Sheet className="mr-2 h-4 w-4" />
                        Google Sheets
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Leads Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <ListChecks className="h-5 w-5" />
                  Saved Leads
                </CardTitle>
                <CardDescription>
                  {leads.length} lead(s) found. Click column headers to sort.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {leadsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : leads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
                      <ListChecks className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="text-lg font-semibold">No Leads Yet</h3>
                    <p className="text-sm text-muted-foreground mt-1 max-w-md">
                      Select results from scraping and click &ldquo;Add to Lead List&rdquo; to save them here.
                    </p>
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => setActiveTab('results')}
                    >
                      Go to Results
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">
                            <Checkbox
                              checked={leads.length > 0 && selectedLeadIds.size === leads.length}
                              onCheckedChange={toggleAllLeads}
                              aria-label="Select all leads"
                            />
                          </TableHead>
                          <TableHead
                            className="cursor-pointer select-none hover:bg-muted/50"
                            onClick={() => handleLeadSort('name')}
                          >
                            <span className="inline-flex items-center">
                              Name {renderSortIcon('name')}
                            </span>
                          </TableHead>
                          <TableHead
                            className="cursor-pointer select-none hover:bg-muted/50"
                            onClick={() => handleLeadSort('address')}
                          >
                            <span className="inline-flex items-center">
                              Address {renderSortIcon('address')}
                            </span>
                          </TableHead>
                          <TableHead
                            className="cursor-pointer select-none hover:bg-muted/50"
                            onClick={() => handleLeadSort('phone')}
                          >
                            <span className="inline-flex items-center">
                              Phone {renderSortIcon('phone')}
                            </span>
                          </TableHead>
                          <TableHead
                            className="cursor-pointer select-none hover:bg-muted/50"
                            onClick={() => handleLeadSort('email')}
                          >
                            <span className="inline-flex items-center">
                              Email {renderSortIcon('email')}
                            </span>
                          </TableHead>
                          <TableHead>Rating</TableHead>
                          <TableHead
                            className="cursor-pointer select-none hover:bg-muted/50"
                            onClick={() => handleLeadSort('category')}
                          >
                            <span className="inline-flex items-center">
                              Category {renderSortIcon('category')}
                            </span>
                          </TableHead>
                          <TableHead>Website</TableHead>
                          <TableHead
                            className="cursor-pointer select-none hover:bg-muted/50"
                            onClick={() => handleLeadSort('priorityScore')}
                          >
                            <span className="inline-flex items-center">
                              Score {renderSortIcon('priorityScore')}
                            </span>
                          </TableHead>
                          <TableHead
                            className="cursor-pointer select-none hover:bg-muted/50"
                            onClick={() => handleLeadSort('status')}
                          >
                            <span className="inline-flex items-center">
                              Status {renderSortIcon('status')}
                            </span>
                          </TableHead>
                          <TableHead
                            className="cursor-pointer select-none hover:bg-muted/50"
                            onClick={() => handleLeadSort('createdAt')}
                          >
                            <span className="inline-flex items-center">
                              Created {renderSortIcon('createdAt')}
                            </span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {leads.map((lead) => (
                          <TableRow
                            key={lead.id}
                            className={selectedLeadIds.has(lead.id) ? 'bg-primary/5' : ''}
                          >
                            <TableCell>
                              <Checkbox
                                checked={selectedLeadIds.has(lead.id)}
                                onCheckedChange={() => toggleLeadSelection(lead.id)}
                                aria-label={`Select ${lead.name}`}
                              />
                            </TableCell>
                            <TableCell className="font-medium">{lead.name || '—'}</TableCell>
                            <TableCell className="text-sm">{lead.address || '—'}</TableCell>
                            <TableCell>
                              {lead.phone ? (
                                <span className="inline-flex items-center gap-1 text-sm">
                                  <Phone className="h-3 w-3" />
                                  {lead.phone}
                                </span>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell>
                              {lead.email ? (
                                <span className="inline-flex items-center gap-1 text-sm">
                                  <Mail className="h-3 w-3" />
                                  {lead.email}
                                </span>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell>
                              {lead.rating ? (
                                <span className="inline-flex items-center gap-1">
                                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                                  {lead.rating}
                                  {lead.reviewsCount && (
                                    <span className="text-xs text-muted-foreground">
                                      ({lead.reviewsCount})
                                    </span>
                                  )}
                                </span>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell>
                              {lead.category ? (
                                <Badge variant="secondary" className="text-xs">
                                  {lead.category}
                                </Badge>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell>
                              {lead.website ? (
                                <a
                                  href={lead.website}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  Visit
                                </a>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell>
                              {lead.priorityScore ? (
                                <Badge
                                  variant={lead.priorityScore >= 100 ? 'default' : lead.priorityScore >= 50 ? 'secondary' : 'outline'}
                                  className="text-xs"
                                >
                                  {lead.priorityScore}
                                </Badge>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell>
                              <Select
                                value={lead.status}
                                onValueChange={(value) => updateLeadStatus(lead.id, value)}
                              >
                                <SelectTrigger className="h-7 w-[110px] text-xs">
                                  <Badge className={`text-xs ${STATUS_COLORS[lead.status] || ''}`}>
                                    {lead.status}
                                  </Badge>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="new">
                                    <Badge className={`text-xs ${STATUS_COLORS.new}`}>new</Badge>
                                  </SelectItem>
                                  <SelectItem value="contacted">
                                    <Badge className={`text-xs ${STATUS_COLORS.contacted}`}>contacted</Badge>
                                  </SelectItem>
                                  <SelectItem value="qualified">
                                    <Badge className={`text-xs ${STATUS_COLORS.qualified}`}>qualified</Badge>
                                  </SelectItem>
                                  <SelectItem value="lost">
                                    <Badge className={`text-xs ${STATUS_COLORS.lost}`}>lost</Badge>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(lead.createdAt).toLocaleDateString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===================== HISTORY TAB ===================== */}
          <TabsContent value="history" className="space-y-6">
            {scrapeHistory.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
                      <Globe className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="text-lg font-semibold">No History</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Your scraping history will appear here after running searches.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {scrapeHistory.map((entry, i) => (
                  <Card key={i}>
                    <CardContent className="pt-6">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">
                              {DOMAIN_OPTIONS.find((d) => d.value === entry.config.type)?.label}
                            </Badge>
                            <Badge variant="outline">{FETCHER_INFO[entry.config.fetcher].label}</Badge>
                          </div>
                          <p className="font-medium text-sm">
                            {entry.config.type === 'generic'
                              ? entry.config.url
                              : entry.config.query}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(entry.timestamp).toLocaleString()} —{' '}
                            {entry.result.results?.length || entry.result.page_details?.length || 0}{' '}
                            results
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setResult(entry.result);
                            setConfig(entry.config);
                            setActiveTab('results');
                          }}
                        >
                          View
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t mt-auto">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Scrapling Web Scraper — Powered by Scrapling v0.4.8</span>
            <span>Extract public data responsibly</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
