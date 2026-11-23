export const PERSONAS = [
  {
    id: 'cfo',
    name: 'CFO / Finance Head',
    role: 'Strategic',
    avatar: 'CF',
    focus: 'Enterprise-wide performance, capital allocation, board narrative.',
    metrics: ['revenue_growth', 'ebitda_growth', 'roce', 'ccc', 'fcf', 'cost_to_serve', 'control_exceptions'],
    insights: [
      { text: 'Cost-to-serve is 1.4% of revenue vs. 0.8% top-quartile — a 0.6pt margin opportunity hiding in transactional finance.', level: 'red' },
      { text: 'Control exceptions (18 open) are trending above the 6-exception top-quartile band — a board-reporting risk.', level: 'red' },
      { text: 'ROCE at 12.6% trails plan by ~40bps this quarter — worth a capital-allocation review with FP&A.', level: 'amber' },
    ],
  },
  {
    id: 'controller',
    name: 'Controller / R2R Lead',
    role: 'Close & Compliance',
    avatar: 'CT',
    focus: 'Financial close, consolidation, statutory reporting, controls.',
    metrics: ['close_cycle_days', 'je_backlog', 'statutory_status', 'ic_mismatch', 'control_exceptions', 'cost_to_serve'],
    insights: [
      { text: 'Close cycle of 6.2 days sits 2.3 days behind top-quartile — mostly attributable to manual journal entries.', level: 'red' },
      { text: '42 journal entries are currently flagged for review — a growing backlog ahead of quarter-close.', level: 'amber' },
      { text: 'Intercompany mismatches (27 open) are concentrated in Plant 1–Plant 3 postings.', level: 'amber' },
    ],
  },
  {
    id: 'fpna',
    name: 'FP&A Lead',
    role: 'Planning & Foresight',
    avatar: 'FP',
    focus: 'Budgeting, forecasting, scenario planning, decision support.',
    metrics: ['forecast_accuracy', 'budget_variance', 'revenue_growth', 'ebitda_margin', 'roce'],
    insights: [
      { text: 'Forecast accuracy at 84% is within reach of top-quartile (90%+) — rolling-forecast automation is the fastest lever.', level: 'green' },
      { text: 'Budget variance of 3.8% is being driven by Plant 4 raw-material cost overruns.', level: 'amber' },
      { text: 'EBITDA margin of 14.2% is tracking ~60bps below the FY plan.', level: 'amber' },
    ],
  },
  {
    id: 'ops',
    name: 'Transactional Ops Lead (P2P+O2C)',
    role: 'Shared Services / GBS',
    avatar: 'OP',
    focus: 'Invoice-to-pay and order-to-cash throughput.',
    metrics: ['invoice_backlog', 'touchless_pct', 'dso_segment', 'exception_queue', 'sla_adherence'],
    insights: [
      { text: 'Touchless invoice rate of 42% trails the 85% target — the largest single efficiency gap in the finance value chain.', level: 'red' },
      { text: 'Invoice backlog of 1,240 is concentrated in 3 vendor categories.', level: 'amber' },
      { text: 'SLA adherence (91%) dips whenever monthly volume exceeds ~12,000 invoices.', level: 'amber' },
    ],
  },
  {
    id: 'treasury',
    name: 'Treasury & Risk Lead',
    role: 'Liquidity & Exposure',
    avatar: 'TR',
    focus: 'Cash, funding, FX, working capital execution.',
    metrics: ['cash_13wk', 'fx_exposure', 'funding_headroom', 'covenant_status', 'ccc'],
    insights: [
      { text: 'FX exposure ($18M unhedged) is above policy threshold, despite strong 13-week cash forecast confidence (88%).', level: 'red' },
      { text: 'Funding headroom of ₹640 Cr gives comfortable runway for Plant 5 capex.', level: 'green' },
      { text: 'CCC of 46 days trails peer median (34 days) by 12 days — the single largest cash-unlock opportunity.', level: 'red' },
    ],
  },
];

export const PLACEHOLDER_PERSONAS = [
  'Tax Head',
  'Internal Audit Lead',
  'GBS / Shared Services Head',
  'Finance Business Partner',
];

export const ACTION_LIBRARY = {
  cfo: [
    {
      title: '42 journal entries flagged for review',
      sev: 'high',
      meta: 'R2R · Anomaly Detection Agent · 22 min ago',
      breakdown: [
        ['Plant 1', '14 entries'],
        ['Plant 3', '11 entries'],
        ['Plant 5', '9 entries'],
        ['Other', '8 entries'],
      ],
      steps: [
        'Review flagged entries by plant',
        'Assign to controller for sign-off',
        'Approve or escalate material items',
        'Post & close in R2R',
      ],
      goTo: { view: 'domain', l1: 'r2r', l2: 'r2r-close', l3: 'journal-entries' },
    },
    {
      title: 'Approve AP automation Phase 2 budget (₹3.2 Cr)',
      sev: 'med',
      meta: 'Finance Transformation · due Friday',
      breakdown: [
        ['Requested', '₹3.2 Cr'],
        ['Payback', '9 months'],
        ['Annualised impact', '₹14.0 Cr/yr'],
      ],
      steps: [
        'Review the business case',
        'Confirm funding source',
        'Sign off with CFO office',
        'Notify transformation team',
      ],
      goTo: { view: 'domain', l1: 'p2p', l2: 'p2p-ap', l3: 'invoice-processing' },
    },
    {
      title: 'Plant 3 intercompany mismatch of ₹2.4 Cr vs. Plant 1',
      sev: 'med',
      meta: 'R2R Reconciliation · 1 hr ago',
      breakdown: [
        ['Plant 1 ledger', '₹18.6 Cr'],
        ['Plant 3 ledger', '₹16.2 Cr'],
        ['Variance', '₹2.4 Cr'],
      ],
      steps: [
        'Pull both entity ledgers',
        'Identify timing vs. real variance',
        'Post correcting entry',
        'Confirm with both plant controllers',
      ],
      goTo: { view: 'domain', l1: 'r2r', l2: 'r2r-ic', l3: 'ic-recon' },
    },
    {
      title: 'Sign off FX hedging policy update',
      sev: 'low',
      meta: 'Treasury · awaiting CFO review',
      breakdown: [
        ['Current hedge ratio', '62%'],
        ['Proposed', '75%'],
        ['Unhedged exposure', '$18M'],
      ],
      steps: [
        'Review Treasury recommendation',
        'Check covenant implications',
        'Approve or request changes',
      ],
      goTo: { view: 'domain', l1: 'treasury-tower', l2: 'tre-risk', l3: 'fx-exposure-mgmt' },
    },
  ],
  controller: [
    {
      title: '42 journal entries flagged for review',
      sev: 'high',
      meta: 'R2R · Anomaly Detection Agent · 22 min ago',
      breakdown: [
        ['Plant 1', '14 entries'],
        ['Plant 3', '11 entries'],
        ['Plant 5', '9 entries'],
        ['Other', '8 entries'],
      ],
      steps: [
        'Review flagged entries by plant',
        'Assign for sign-off',
        'Approve or escalate material items',
        'Post & close in R2R',
      ],
      goTo: { view: 'domain', l1: 'r2r', l2: 'r2r-close', l3: 'journal-entries' },
    },
    {
      title: '3 intercompany mismatches open — Plant 1 vs. Plant 3',
      sev: 'med',
      meta: 'R2R Reconciliation · 1 hr ago',
      breakdown: [
        ['Plant 1 ledger', '₹18.6 Cr'],
        ['Plant 3 ledger', '₹16.2 Cr'],
        ['Variance', '₹2.4 Cr'],
      ],
      steps: [
        'Pull both entity ledgers',
        'Identify timing vs. real variance',
        'Post correcting entry',
      ],
      goTo: { view: 'domain', l1: 'r2r', l2: 'r2r-ic', l3: 'ic-recon' },
    },
    {
      title: 'Close checklist for Entity IN-07 at 92%',
      sev: 'low',
      meta: 'Close Tracker · Today, 06:00',
      breakdown: [
        ['Completed', '92%'],
        ['Remaining', '3 tasks'],
      ],
      steps: [
        'Complete remaining close tasks',
        'Confirm sign-off from local controller',
        'Lock entity for consolidation',
      ],
      goTo: { view: 'domain', l1: 'r2r', l2: 'r2r-close', l3: 'journal-entries' },
    },
  ],
  fpna: [
    {
      title: 'Rolling forecast needs refresh — RM index updated',
      sev: 'med',
      meta: 'FP&A · 5 hrs ago',
      breakdown: [
        ['RM index change', '+3.1%'],
        ['Forecast impact', '~₹8 Cr'],
      ],
      steps: [
        'Pull updated raw-material index',
        'Re-run rolling forecast model',
        'Flag material variances to CFO',
      ],
      goTo: { view: 'domain', l1: 'fpna-tower', l2: 'fpna-analysis', l3: 'scenario-modelling' },
    },
    {
      title: 'Plant 4 budget variance needs commentary',
      sev: 'med',
      meta: 'Variance Analysis · Today',
      breakdown: [
        ['Variance', '3.8%'],
        ['Driver', 'Raw-material overrun'],
      ],
      steps: [
        'Draft variance commentary',
        'Validate with Plant 4 controller',
        'Submit for CFO review',
      ],
      goTo: { view: 'domain', l1: 'fpna-tower', l2: 'fpna-analysis', l3: 'variance-analysis-fpna' },
    },
  ],
  ops: [
    {
      title: 'Invoice backlog spike — 1,240 pending',
      sev: 'high',
      meta: 'P2P · Today',
      breakdown: [
        ['>7 days old', '410'],
        ['3–7 days', '520'],
        ['<3 days', '310'],
      ],
      steps: [
        'Run AP Exception Copilot on the backlog',
        'Prioritise items >7 days old',
        'Escalate vendor-blocked items',
      ],
      goTo: { view: 'domain', l1: 'p2p', l2: 'p2p-ap', l3: 'invoice-processing' },
    },
    {
      title: 'Top 10 vendor disputes in queue',
      sev: 'med',
      meta: 'Vendor Management · Today',
      breakdown: [
        ['Payment delay disputes', '6'],
        ['Pricing disputes', '4'],
      ],
      steps: [
        'Review the dispute queue',
        'Resolve or escalate each case',
        'Update vendor on status',
      ],
      goTo: { view: 'domain', l1: 'p2p', l2: 'p2p-vendor', l3: 'vendor-query' },
    },
  ],
  treasury: [
    {
      title: '13-week cash forecast confidence dipped',
      sev: 'med',
      meta: 'Treasury · Today',
      breakdown: [
        ['This week', '88%'],
        ['Last week', '92%'],
      ],
      steps: [
        'Review forecast model drift',
        'Check for one-off transactions',
        'Re-validate with entity treasurers',
      ],
      goTo: { view: 'domain', l1: 'treasury-tower', l2: 'tre-cash', l3: 'cash-forecasting' },
    },
    {
      title: 'Unhedged FX exposure above policy threshold',
      sev: 'high',
      meta: 'Risk Management · Today',
      breakdown: [
        ['Current exposure', '$18M'],
        ['Policy threshold', '$12M'],
      ],
      steps: [
        'Review exposure by currency',
        'Propose hedge instruments',
        'Get CFO sign-off',
      ],
      goTo: { view: 'domain', l1: 'treasury-tower', l2: 'tre-risk', l3: 'fx-exposure-mgmt' },
    },
  ],
};

