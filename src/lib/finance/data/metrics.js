export const METRICS = {
  cash_position: { label: 'Cash & Liquidity Position', unit: '₹ Cr', category: 'liquidity', base: 1240, vol: 55, better: 'up' },
  ccc: { label: 'Cash Conversion Cycle', unit: 'days', category: 'liquidity', base: 46, vol: 2.5, better: 'down' },
  fcf: { label: 'Free Cash Flow (rolling)', unit: '₹ Cr', category: 'liquidity', base: 310, vol: 22, better: 'up' },
  ebitda_margin: { label: 'EBITDA Margin', unit: '%', category: 'growth', base: 14.2, vol: 0.5, better: 'up' },
  ebitda_growth: { label: 'EBITDA Growth', unit: '% YoY', category: 'growth', base: 9.6, vol: 0.7, better: 'up' },
  revenue_growth: { label: 'Revenue Growth', unit: '% YoY', category: 'growth', base: 8.4, vol: 0.6, better: 'up' },
  roce: { label: 'Return on Capital Employed', unit: '%', category: 'growth', base: 12.6, vol: 0.4, better: 'up' },
  forecast_accuracy: { label: 'Forecast Accuracy', unit: '%', category: 'risk', base: 84, vol: 1.6, better: 'up' },
  control_exceptions: { label: 'Control Exceptions (open)', unit: '', category: 'risk', base: 18, vol: 3, better: 'down' },
  cost_to_serve: { label: 'Cost-to-Serve Finance', unit: '% rev', category: 'cost', base: 1.4, vol: 0.06, better: 'down' },
  mfg_cost_variance: { label: 'Manufacturing Cost Variance', unit: '%', category: 'cost', base: 2.1, vol: 0.25, better: 'down' },
  close_cycle_days: { label: 'Close Cycle Time', unit: 'days', category: 'risk', base: 6.2, vol: 0.4, better: 'down' },
  je_backlog: { label: 'Journal Entry Backlog', unit: '', category: 'risk', base: 42, vol: 5, better: 'down' },
  statutory_status: { label: 'On-Time Filing Rate', unit: '%', category: 'risk', base: 96, vol: 1, better: 'up' },
  ic_mismatch: { label: 'Intercompany Mismatches', unit: '', category: 'risk', base: 27, vol: 4, better: 'down' },
  budget_variance: { label: 'Budget vs Actual Variance', unit: '%', category: 'growth', base: 3.8, vol: 0.4, better: 'down' },
  invoice_backlog: { label: 'Invoice Backlog', unit: '', category: 'cost', base: 1240, vol: 90, better: 'down' },
  touchless_pct: { label: '% Touchless Invoices', unit: '%', category: 'cost', base: 42, vol: 2, better: 'up' },
  dso_segment: { label: 'DSO — Export Segment', unit: 'days', category: 'liquidity', base: 61, vol: 2, better: 'down' },
  exception_queue: { label: 'Exception Queue', unit: '', category: 'cost', base: 96, vol: 8, better: 'down' },
  sla_adherence: { label: 'SLA Adherence', unit: '%', category: 'cost', base: 91, vol: 1.2, better: 'up' },
  cash_13wk: { label: '13-Wk Cash Forecast Confidence', unit: '%', category: 'liquidity', base: 88, vol: 1.5, better: 'up' },
  fx_exposure: { label: 'Unhedged FX Exposure', unit: '$ M', category: 'risk', base: 18, vol: 2, better: 'down' },
  funding_headroom: { label: 'Funding Headroom', unit: '₹ Cr', category: 'liquidity', base: 640, vol: 30, better: 'up' },
  covenant_status: { label: 'Covenant Headroom', unit: '%', category: 'risk', base: 34, vol: 2, better: 'up' },
};

export const METRIC_LINKS = {
  revenue_growth: { view: 'challenges' },
  ebitda_growth: { view: 'drilldown', metric: 'ebitda_growth' },
  roce: { view: 'challenges' },
  budget_variance: { view: 'challenges' },
  funding_headroom: { view: 'challenges' },
  covenant_status: { view: 'challenges' },
  ccc: { view: 'domain', l1: 'o2c', l2: 'o2c-billing', l3: 'cash-application' },
  fcf: { view: 'domain', l1: 'treasury-tower', l2: 'tre-cash', l3: 'cash-forecasting' },
  cash_13wk: { view: 'domain', l1: 'treasury-tower', l2: 'tre-cash', l3: 'cash-forecasting' },
  fx_exposure: { view: 'domain', l1: 'treasury-tower', l2: 'tre-risk', l3: 'fx-exposure-mgmt' },
  cost_to_serve: { view: 'drilldown', metric: 'cost_to_serve' },
  invoice_backlog: { view: 'domain', l1: 'p2p', l2: 'p2p-ap', l3: 'invoice-processing' },
  touchless_pct: { view: 'domain', l1: 'p2p', l2: 'p2p-ap', l3: 'invoice-processing' },
  exception_queue: { view: 'domain', l1: 'p2p', l2: 'p2p-ap', l3: 'invoice-processing' },
  sla_adherence: { view: 'domain', l1: 'p2p', l2: 'p2p-vendor', l3: 'vendor-query' },
  control_exceptions: { view: 'domain', l1: 'r2r', l2: 'r2r-close', l3: 'journal-entries' },
  close_cycle_days: { view: 'domain', l1: 'r2r', l2: 'r2r-close', l3: 'journal-entries' },
  je_backlog: { view: 'domain', l1: 'r2r', l2: 'r2r-close', l3: 'journal-entries' },
  ic_mismatch: { view: 'domain', l1: 'r2r', l2: 'r2r-ic', l3: 'ic-recon' },
  statutory_status: { view: 'domain', l1: 'tax-tower', l2: 'tax-direct', l3: 'tax-return' },
  dso_segment: { view: 'domain', l1: 'o2c', l2: 'o2c-credit', l3: 'collections-dunning' },
  mfg_cost_variance: { view: 'domain', l1: 'cost-tower', l2: 'cost-standard', l3: 'cost-variance' },
  cash_position: { view: 'domain', l1: 'treasury-tower', l2: 'tre-cash', l3: 'cash-forecasting' },
  forecast_accuracy: { view: 'domain', l1: 'fpna-tower', l2: 'fpna-plan', l3: 'rolling-forecast' },
};

export const DRILLDOWN_METRICS = ['cost_to_serve', 'ebitda_growth'];

export const DRILLDOWN = {
  ebitda_growth: {
    title: 'EBITDA Growth — Driver Tree',
    metricVal: '9.6% YoY',
    note: 'Decomposed as revenue-growth contribution + margin-change contribution by segment, following standard FP&A EBITDA bridge logic.',
    dims: {
      'Business Unit': [
        { seg: 'Powertrain Components', share: '38%', growth: '6.5%', marginChg: '+40bps', level: 'green' },
        { seg: 'Industrial Equipment', share: '27%', growth: '11.2%', marginChg: '+90bps', level: 'green' },
        { seg: 'Consumer Appliances', share: '20%', growth: '4.1%', marginChg: '-60bps', level: 'red' },
        { seg: 'Aftermarket & Services', share: '15%', growth: '12.8%', marginChg: '+150bps', level: 'green' },
      ],
      'Geography': [
        { seg: 'Domestic (India)', share: '55%', growth: '9.8%', marginChg: '+30bps', level: 'green' },
        { seg: 'Exports — Americas', share: '18%', growth: '5.2%', marginChg: '+20bps', level: 'amber' },
        { seg: 'Exports — Europe', share: '15%', growth: '2.1%', marginChg: '-80bps', level: 'red' },
        { seg: 'Exports — APAC', share: '12%', growth: '14.6%', marginChg: '+60bps', level: 'green' },
      ],
      'Product Line': [
        { seg: 'Castings & Forgings', share: '34%', growth: '5.5%', marginChg: '+10bps', level: 'amber' },
        { seg: 'Precision Machined Parts', share: '29%', growth: '9.0%', marginChg: '+70bps', level: 'green' },
        { seg: 'Assemblies & Modules', share: '22%', growth: '10.5%', marginChg: '+50bps', level: 'green' },
        { seg: 'Tooling & Dies', share: '15%', growth: '-1.2%', marginChg: '-120bps', level: 'red' },
      ],
      'Service Line': [
        { seg: 'Product Sales', share: '82%', growth: '7.0%', marginChg: '+20bps', level: 'amber' },
        { seg: 'Spares & Aftermarket', share: '11%', growth: '15.0%', marginChg: '+180bps', level: 'green' },
        { seg: 'AMC / Service Contracts', share: '5%', growth: '18.0%', marginChg: '+140bps', level: 'green' },
        { seg: 'Engineering Services', share: '2%', growth: '6.0%', marginChg: '+30bps', level: 'amber' },
      ],
    },
    cols: ['Revenue Share', 'YoY Growth', 'Margin Change'],
  },
  cost_to_serve: {
    title: 'Cost-to-Serve — Driver Tree',
    metricVal: '1.4% of revenue (company avg)',
    note: 'Finance function cost allocated to each segment, divided by that segment\'s revenue — flags where transaction complexity or scale gaps drive up finance cost.',
    dims: {
      'Business Unit': [
        { seg: 'Powertrain Components', share: '₹1,900 Cr rev', growth: '₹24 Cr cost', marginChg: '1.26%', level: 'green' },
        { seg: 'Industrial Equipment', share: '₹1,350 Cr rev', growth: '₹17 Cr cost', marginChg: '1.26%', level: 'green' },
        { seg: 'Consumer Appliances', share: '₹1,000 Cr rev', growth: '₹17 Cr cost', marginChg: '1.70%', level: 'amber' },
        { seg: 'Aftermarket & Services', share: '₹750 Cr rev', growth: '₹15 Cr cost', marginChg: '2.00%', level: 'red' },
      ],
      'Geography': [
        { seg: 'Domestic (India)', share: '₹2,750 Cr rev', growth: '₹33 Cr cost', marginChg: '1.20%', level: 'green' },
        { seg: 'Exports — Americas', share: '₹900 Cr rev', growth: '₹14 Cr cost', marginChg: '1.56%', level: 'amber' },
        { seg: 'Exports — Europe', share: '₹750 Cr rev', growth: '₹14 Cr cost', marginChg: '1.87%', level: 'red' },
        { seg: 'Exports — APAC', share: '₹600 Cr rev', growth: '₹9 Cr cost', marginChg: '1.50%', level: 'amber' },
      ],
      'Product Line': [
        { seg: 'Castings & Forgings', share: '₹1,700 Cr rev', growth: '₹22 Cr cost', marginChg: '1.29%', level: 'green' },
        { seg: 'Precision Machined Parts', share: '₹1,450 Cr rev', growth: '₹18 Cr cost', marginChg: '1.24%', level: 'green' },
        { seg: 'Assemblies & Modules', share: '₹1,100 Cr rev', growth: '₹17 Cr cost', marginChg: '1.55%', level: 'amber' },
        { seg: 'Tooling & Dies', share: '₹750 Cr rev', growth: '₹13 Cr cost', marginChg: '1.73%', level: 'red' },
      ],
      'Service Line': [
        { seg: 'Product Sales', share: '₹4,100 Cr rev', growth: '₹49 Cr cost', marginChg: '1.20%', level: 'green' },
        { seg: 'Spares & Aftermarket', share: '₹550 Cr rev', growth: '₹12 Cr cost', marginChg: '2.18%', level: 'red' },
        { seg: 'AMC / Service Contracts', share: '₹250 Cr rev', growth: '₹6 Cr cost', marginChg: '2.40%', level: 'red' },
        { seg: 'Engineering Services', share: '₹100 Cr rev', growth: '₹3 Cr cost', marginChg: '3.00%', level: 'red' },
      ],
    },
    cols: ['Revenue', 'Finance Cost Allocated', 'Cost-to-Serve %'],
  },
};

export function seedFromString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h) || 1;
}

export function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function genSeries(key, base, vol, n = 12) {
  const rnd = mulberry32(seedFromString(key));
  let v = base - vol * 0.6;
  const out = [];
  for (let i = 0; i < n; i++) {
    v += (rnd() - 0.42) * vol * 0.35;
    out.push(v);
  }
  out[out.length - 1] = base;
  return out;
}

export function fmtNum(n) {
  if (Math.abs(n) >= 100) return Math.round(n).toLocaleString('en-IN');
  return (Math.round(n * 10) / 10).toString();
}

export function catColor(cat) {
  return (
    {
      liquidity: '#0091DA',
      growth: '#00338D',
      cost: '#483698',
      risk: '#E05206',
    }[cat] || '#7f8fa9'
  );
}

