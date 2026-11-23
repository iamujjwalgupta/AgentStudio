function l2(id, name, potential, impact, l3list) {
  return { id, name, potential, impact, l3: l3list };
}

export const DOMAIN = [
  {
    id: 'p2p',
    name: 'Procure-to-Pay',
    priority: 'High',
    l2: [
      l2('p2p-ap', 'Accounts Payable', 'High', 'High', [
        { id: 'invoice-processing', name: 'Invoice Processing', potential: 'High', impact: 'High', flagship: true },
        { id: 'grn-recon', name: 'GRN Reconciliation', potential: 'Medium', impact: 'High', flagship: false },
        { id: 'payment-processing', name: 'Payment Processing', potential: 'High', impact: 'Medium', flagship: false },
      ]),
      l2('p2p-vendor', 'Vendor Management', 'High', 'Medium', [
        { id: 'vendor-onboarding', name: 'Vendor Onboarding & KYC', potential: 'Medium', impact: 'Medium', flagship: false },
        { id: 'vendor-query', name: 'Vendor Query Management', potential: 'High', impact: 'Medium', flagship: false },
      ]),
      l2('p2p-po', 'Purchase Order Management', 'Medium', 'Medium', [
        { id: 'po-creation', name: 'PO Creation & Approval Routing', potential: 'Medium', impact: 'Medium', flagship: false },
      ]),
      l2('p2p-te', 'Travel & Expense Management', 'High', 'Low', [
        { id: 'te-processing', name: 'T&E Claim Processing', potential: 'High', impact: 'Low', flagship: false },
      ]),
      l2('p2p-spend', 'Procurement Analytics & Spend Mgmt', 'Medium', 'Medium', [
        { id: 'spend-analytics', name: 'Spend Analytics & Category Insights', potential: 'Medium', impact: 'Medium', flagship: false },
      ]),
    ],
  },
  {
    id: 'o2c',
    name: 'Order-to-Cash',
    priority: 'High',
    l2: [
      l2('o2c-credit', 'Credit & Collections', 'High', 'High', [
        { id: 'collections-dunning', name: 'Collections & Dunning', potential: 'High', impact: 'High', flagship: false },
        { id: 'credit-risk', name: 'Credit Risk Assessment', potential: 'High', impact: 'Medium', flagship: false },
      ]),
      l2('o2c-billing', 'Billing & Receivables', 'High', 'High', [
        { id: 'invoice-generation', name: 'Invoice Generation', potential: 'Medium', impact: 'Medium', flagship: false },
        { id: 'cash-application', name: 'Cash Application', potential: 'High', impact: 'High', flagship: false },
      ]),
      l2('o2c-order', 'Order Management', 'Medium', 'Medium', [
        { id: 'order-processing', name: 'Sales Order Processing', potential: 'Medium', impact: 'Medium', flagship: false },
      ]),
      l2('o2c-master', 'Customer Master Data Management', 'Medium', 'Low', [
        { id: 'customer-master', name: 'Customer Master & Credit Limits', potential: 'Medium', impact: 'Low', flagship: false },
      ]),
      l2('o2c-deductions', 'Deductions & Claims Management', 'High', 'Medium', [
        { id: 'deductions-mgmt', name: 'Deductions & Short-Payment Resolution', potential: 'High', impact: 'Medium', flagship: false },
      ]),
    ],
  },
  {
    id: 'r2r',
    name: 'Record-to-Report',
    priority: 'High',
    l2: [
      l2('r2r-close', 'Close & Consolidation', 'Medium', 'High', [
        { id: 'journal-entries', name: 'Journal Entries', potential: 'Medium', impact: 'High', flagship: true },
        { id: 'account-recon', name: 'Account Reconciliation', potential: 'High', impact: 'High', flagship: false },
        { id: 'mgmt-reporting', name: 'Management Reporting', potential: 'Medium', impact: 'Medium', flagship: false },
      ]),
      l2('r2r-fa', 'Fixed Assets', 'Medium', 'Medium', [
        { id: 'asset-accounting', name: 'Asset Accounting', potential: 'Medium', impact: 'Medium', flagship: false },
      ]),
      l2('r2r-ic', 'Intercompany', 'Medium', 'High', [
        { id: 'ic-recon', name: 'Intercompany Reconciliation', potential: 'Medium', impact: 'High', flagship: false },
      ]),
      l2('r2r-stat', 'Statutory & Regulatory Reporting', 'Medium', 'High', [
        { id: 'stat-reporting', name: 'Statutory Financial Statements', potential: 'Medium', impact: 'High', flagship: false },
      ]),
      l2('r2r-disc', 'Financial Reporting & Disclosures', 'Low', 'Medium', [
        { id: 'disclosures', name: 'Board & Investor Disclosures', potential: 'Low', impact: 'Medium', flagship: false },
      ]),
    ],
  },
  {
    id: 'fpna-tower',
    name: 'FP&A / Budgeting & Forecasting',
    priority: 'High',
    l2: [
      l2('fpna-plan', 'Planning & Budgeting', 'Medium', 'High', [
        { id: 'annual-budget', name: 'Annual Budget Cycle', potential: 'Medium', impact: 'High', flagship: false },
        { id: 'rolling-forecast', name: 'Rolling Forecast', potential: 'High', impact: 'High', flagship: false },
      ]),
      l2('fpna-analysis', 'Analysis & Reporting', 'High', 'Medium', [
        { id: 'variance-analysis-fpna', name: 'Variance Analysis', potential: 'High', impact: 'Medium', flagship: false },
        { id: 'scenario-modelling', name: 'Scenario Modelling', potential: 'High', impact: 'High', flagship: false },
      ]),
      l2('fpna-dash', 'Management Reporting & Dashboards', 'High', 'Medium', [
        { id: 'mgmt-dashboards', name: 'Automated MIS & Dashboards', potential: 'High', impact: 'Medium', flagship: false },
      ]),
      l2('fpna-capex', 'Capital Planning & Investment Appraisal', 'Low', 'High', [
        { id: 'capex-appraisal', name: 'Capex Business Case Appraisal', potential: 'Low', impact: 'High', flagship: false },
      ]),
      l2('fpna-strat', 'Strategic & Long-Range Planning', 'Low', 'Medium', [
        { id: 'lr-planning', name: 'Long-Range Strategic Planning', potential: 'Low', impact: 'Medium', flagship: false },
      ]),
    ],
  },
  {
    id: 'treasury-tower',
    name: 'Treasury & Cash Management',
    priority: 'High',
    l2: [
      l2('tre-cash', 'Cash Management', 'High', 'High', [
        { id: 'cash-forecasting', name: 'Cash Forecasting', potential: 'High', impact: 'High', flagship: false },
        { id: 'bank-recon', name: 'Bank Reconciliation', potential: 'High', impact: 'Medium', flagship: false },
      ]),
      l2('tre-risk', 'Risk Management', 'Medium', 'High', [
        { id: 'fx-exposure-mgmt', name: 'FX Exposure Management', potential: 'Medium', impact: 'High', flagship: false },
      ]),
      l2('tre-debt', 'Debt & Funding Management', 'Medium', 'Medium', [
        { id: 'debt-mgmt', name: 'Debt Covenant & Funding Tracking', potential: 'Medium', impact: 'Medium', flagship: false },
      ]),
      l2('tre-invest', 'Investment Management', 'Low', 'Medium', [
        { id: 'investment-mgmt', name: 'Surplus Cash Investment', potential: 'Low', impact: 'Medium', flagship: false },
      ]),
      l2('tre-bank', 'Bank Relationship & Account Mgmt', 'Medium', 'Low', [
        { id: 'bank-relations', name: 'Bank Account & Signatory Management', potential: 'Medium', impact: 'Low', flagship: false },
      ]),
    ],
  },
  {
    id: 'cost-tower',
    name: 'Cost & Manufacturing Accounting',
    priority: 'Medium',
    l2: [
      l2('cost-standard', 'Standard Costing', 'Medium', 'High', [
        { id: 'cost-rollup', name: 'Cost Roll-up', potential: 'Medium', impact: 'High', flagship: false },
        { id: 'cost-variance', name: 'Variance Analysis', potential: 'Medium', impact: 'Medium', flagship: false },
      ]),
      l2('cost-inv', 'Inventory Valuation & Accounting', 'Medium', 'High', [
        { id: 'inv-valuation', name: 'Inventory Valuation & Provisioning', potential: 'Medium', impact: 'High', flagship: false },
      ]),
      l2('cost-margin', 'Product Costing & Margin Analysis', 'High', 'High', [
        { id: 'margin-analysis', name: 'Product / SKU Margin Analysis', potential: 'High', impact: 'High', flagship: false },
      ]),
      l2('cost-capacity', 'Capacity & Utilisation Analysis', 'Medium', 'Medium', [
        { id: 'capacity-analysis', name: 'Plant Capacity & Utilisation Reporting', potential: 'Medium', impact: 'Medium', flagship: false },
      ]),
      l2('cost-mfgvar', 'Manufacturing Variance Reporting', 'Medium', 'Medium', [
        { id: 'mfgvar-reporting', name: 'Labour & Overhead Variance Reporting', potential: 'Medium', impact: 'Medium', flagship: false },
      ]),
    ],
  },
  {
    id: 'tax-tower',
    name: 'Tax & Statutory Compliance',
    priority: 'Medium',
    l2: [
      l2('tax-direct', 'Direct & Indirect Tax', 'Medium', 'Medium', [
        { id: 'tax-return', name: 'Tax Return Preparation', potential: 'Medium', impact: 'Medium', flagship: false },
        { id: 'gst-recon', name: 'GST Reconciliation', potential: 'High', impact: 'Medium', flagship: false },
      ]),
      l2('tax-tp', 'Transfer Pricing', 'Low', 'Medium', [
        { id: 'transfer-pricing', name: 'Transfer Pricing Documentation', potential: 'Low', impact: 'Medium', flagship: false },
      ]),
      l2('tax-prov', 'Tax Provisioning & Reporting', 'Medium', 'High', [
        { id: 'tax-provisioning', name: 'Deferred Tax & Provisioning', potential: 'Medium', impact: 'High', flagship: false },
      ]),
      l2('tax-audit', 'Statutory Audit Support', 'Low', 'Medium', [
        { id: 'audit-support', name: 'Statutory Auditor Data Requests', potential: 'Low', impact: 'Medium', flagship: false },
      ]),
      l2('tax-calendar', 'Regulatory Filings & Compliance Calendar', 'High', 'Medium', [
        { id: 'filing-calendar', name: 'Compliance Calendar & Filing Tracker', potential: 'High', impact: 'Medium', flagship: false },
      ]),
    ],
  },
  {
    id: 'audit-tower',
    name: 'Internal Audit & Controls',
    priority: 'Medium',
    l2: [
      l2('audit-continuous', 'Continuous Controls Monitoring', 'Medium', 'High', [
        { id: 'anomaly-monitoring', name: 'Anomaly Monitoring', potential: 'Medium', impact: 'High', flagship: false },
      ]),
      l2('audit-planning', 'Internal Audit Planning & Execution', 'Low', 'Medium', [
        { id: 'audit-planning', name: 'Risk-Based Audit Planning', potential: 'Low', impact: 'Medium', flagship: false },
      ]),
      l2('audit-sox', 'SOX / ICFR Compliance', 'Medium', 'High', [
        { id: 'sox-testing', name: 'Controls Testing & Evidence Collection', potential: 'Medium', impact: 'High', flagship: false },
      ]),
      l2('audit-fraud', 'Fraud Risk Management', 'Medium', 'High', [
        { id: 'fraud-mgmt', name: 'Fraud Risk Scoring & Case Management', potential: 'Medium', impact: 'High', flagship: false },
      ]),
      l2('audit-policy', 'Policy & Governance Management', 'Low', 'Low', [
        { id: 'policy-mgmt', name: 'Policy Library & Attestation Tracking', potential: 'Low', impact: 'Low', flagship: false },
      ]),
    ],
  },
];

export const THEME_L1_MAP = {
  touchless: ['p2p', 'o2c'],
  realtime: ['r2r', 'fpna-tower'],
  workingcap: ['treasury-tower', 'o2c'],
  embedded: ['r2r', 'audit-tower'],
  talent: null,
};

export const THEMES = [
  { id: 'touchless', name: 'Touchless Transaction Processing', gap: 'Cost-to-serve 1.4% of revenue vs. 0.8% top-quartile — 0.6pt gap', towers: ['Procure-to-Pay', 'Order-to-Cash'] },
  { id: 'realtime', name: 'Real-Time Decision Support', gap: 'Close cycle 6.2 days vs. 3.9 days top-quartile — 2.3 day gap', towers: ['Record-to-Report', 'FP&A'] },
  { id: 'workingcap', name: 'Working Capital & Cash Optimisation', gap: 'CCC 46 days vs. 34 days peer median — 12 day gap', towers: ['Treasury', 'Order-to-Cash'] },
  { id: 'embedded', name: 'Embedded Risk, Controls & Compliance', gap: '18 open control exceptions vs. 6 top-quartile — 12 exception gap', towers: ['Record-to-Report', 'Internal Audit'] },
  { id: 'talent', name: 'Finance Talent Reimagined', gap: '58% of finance FTE time on transactional work vs. 30% top-quartile — 28pt gap', towers: ['All towers'] },
];

export const DEEPDIVES = {
  'invoice-processing': {
    theme: 'Touchless Transaction Processing',
    gap: 'Cost-to-serve is 1.4% of revenue vs. 0.8% top-quartile — a 0.6pt gap',
    challenges: [
      '~60% of invoices still require manual 3-way matching',
      'Exceptions are routed by email with no SLA tracking',
      'Duplicate-payment risk from manual GRN matching',
    ],
    steps: [
      { t: 'Invoice intake & digitisation', o: 'AI', agent: 'invoice-reader' },
      { t: '3-way match against PO & GRN', o: 'Automation', agent: 'match-agent' },
      { t: 'Exception detection & routing', o: 'AI', agent: 'ap-copilot' },
      { t: 'Exception resolution', o: 'Human', agent: null },
      { t: 'Payment scheduling & discount capture', o: 'Automation', agent: null },
      { t: 'Continuous learning from analyst decisions', o: 'AI', agent: 'ap-copilot' },
    ],
    features: [
      'Multi-format GenAI invoice reader (PDF / scan / email)',
      'Configurable 3-way match rules engine',
      'Exception workbench with SLA timers',
      'Duplicate & fraud detection model',
      'Early-payment discount optimiser',
      'Vendor self-service query portal',
    ],
    benefit: {
      k1: '₹14.0 Cr / yr',
      l1: 'Estimated annual savings',
      k2: '85%',
      l2: 'Target touchless rate (from 42%)',
      calc: '1.2M invoices/yr × ₹117 savings per invoice (₹195 → ₹78 fully-loaded cost)',
      assumptions: [
        '1.2M invoices processed per year',
        '85% touchless adoption reached by Year 2',
        'Fully loaded cost per FTE: ₹9L/yr — illustrative, replace with actual',
      ],
    },
    india: {
      co: 'Tata Motors',
      tag: 'TM',
      text: 'Deployed TCS Cognix™, an AI-ML platform, to automate and transform accounts payable and lift day-to-day finance operations efficiency.',
      src: 'TCS client case study (tcs.com)',
    },
    agents: ['invoice-reader', 'match-agent', 'ap-copilot'],
  },
  'journal-entries': {
    theme: 'Real-Time Decision Support',
    gap: 'Close cycle is 6.2 days vs. 3.9 days top-quartile — a 2.3 day gap',
    challenges: [
      'Journal entries prepared manually across 14 plant ledgers',
      'Recurring accruals re-keyed every month',
      'Close calendar slips whenever any one entity is late',
    ],
    steps: [
      { t: 'Data aggregation from plant ERPs', o: 'Automation', agent: null },
      { t: 'Recurring & accrual journal generation', o: 'AI', agent: 'close-copilot' },
      { t: 'Anomaly & threshold check vs. history', o: 'AI', agent: 'anomaly-agent' },
      { t: 'Review & approval of flagged / material entries', o: 'Human', agent: null },
      { t: 'Posting & consolidation below materiality', o: 'Automation', agent: null },
      { t: 'Close-narrative drafting for review', o: 'AI', agent: 'close-copilot' },
    ],
    features: [
      'Auto-draft recurring & accrual journals',
      'Materiality-based auto-approval routing',
      'Anomaly detection vs. historical patterns',
      'Multi-entity consolidation engine',
      'GenAI close-narrative drafting',
      'Real-time close-status tracker',
    ],
    benefit: {
      k1: '₹4.6 Cr / yr',
      l1: 'Estimated effort savings',
      k2: '2.3 days',
      l2: 'Faster close (6.2 → 3.9 days)',
      calc: '14 entities × 0.4 FTE-equivalent effort saved × ₹11L fully-loaded FTE cost',
      assumptions: [
        '14 reporting entities in scope',
        '0.4 FTE-equivalent effort saved per entity',
        'Fully loaded cost per FTE: ₹11L/yr — illustrative, replace with actual',
      ],
    },
    india: {
      co: 'Tech Mahindra',
      tag: 'TM',
      text: 'Deployed TechM Orion, an agentic AI platform with 300+ enterprise agents, and Project Indus (an Indic foundation LLM) across enterprise operations including finance workflows.',
      src: 'Tech Mahindra "AI Delivered Right" materials (techmahindra.com)',
    },
    agents: ['close-copilot', 'anomaly-agent'],
  },
};

