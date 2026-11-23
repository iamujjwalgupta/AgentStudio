export const CHALLENGE_BUCKETS = [
  { id: 'growth', name: 'Growth', color: '#00338D' },
  { id: 'cost', name: 'Cost', color: '#483698' },
  { id: 'efficiency', name: 'Efficiency', color: '#0091DA' },
  { id: 'accuracy', name: 'Accuracy', color: '#005EB8' },
  { id: 'risk', name: 'Risk', color: '#E05206' },
  { id: 'compliance', name: 'Compliance', color: '#00A3A1' },
];

export const CHALLENGES = [
  { q: "Revenue growth isn't visible by plant or SKU in real time", bucket: 'growth', link: null },
  { q: "Forecasts don't reflect new product launches fast enough", bucket: 'growth', link: null },
  { q: 'Cost-to-serve finance is above peer benchmark', bucket: 'cost', link: 'invoice-processing' },
  { q: "Manufacturing cost variance isn't explained until month-end", bucket: 'cost', link: null },
  { q: 'Invoices are stuck in manual approval', bucket: 'efficiency', link: 'invoice-processing' },
  { q: 'Month-end close takes too long', bucket: 'efficiency', link: 'journal-entries' },
  { q: 'Manual journal entries create audit risk', bucket: 'accuracy', link: 'journal-entries' },
  { q: 'Forecast accuracy lags plan too often', bucket: 'accuracy', link: null },
  { q: 'Vendor disputes delay payments', bucket: 'risk', link: 'invoice-processing' },
  { q: "FX exposure isn't visible in real time", bucket: 'risk', link: null },
  { q: 'Statutory filings slip deadlines', bucket: 'compliance', link: null },
  { q: 'GST reconciliation mismatches recur every quarter', bucket: 'compliance', link: null },
];

