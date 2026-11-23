export const O2C_PHASES = [
  {
    id: 'customer-pricing',
    name: 'Customer, Pricing & Promising Strategies',
    columnIds: ['2.1', '2.2', '2.3'],
  },
  {
    id: 'quote-contract-order',
    name: 'Quote, Contract & Order Fulfilment',
    columnIds: ['2.4', '2.5', '2.6'],
  },
  {
    id: 'subscription-mgmt',
    name: 'Subscription Management',
    columnIds: ['2.7'],
  },
  {
    id: 'invoice-to-cash',
    name: 'Invoice to Cash',
    columnIds: ['2.8', '2.9', '2.10', '2.11', '2.12'],
  },
  {
    id: 'period-end-close',
    name: 'Period End Close & Reporting',
    columnIds: ['2.13'],
  },
  {
    id: 'process-governance',
    name: 'Process Governance',
    columnIds: ['2.14', '2.15', '2.16'],
  },
];

export const O2C_MATRIX_COLUMNS = [
  {
    code: '2.1',
    name: 'Setup Customer Master Data & Credit',
    assetCount: 2,
    phase: 'Customer, Pricing & Promising Strategies',
    subProcessId: 'o2c-credit',
    items: [
      { code: '2.1.1', name: 'Establish Methodology & Customer Credit Limits', badge: 1, isCfoInput: false },
      { code: '2.1.2', name: 'Process New Customer Credit Application', badge: 1, isCfoInput: true },
      { code: '2.1.3', name: 'Setup Customer Financial Master Data', badge: null, isCfoInput: true },
      { code: '2.1.4', name: 'Perform Periodic Credit Review', badge: null, isCfoInput: true },
    ],
  },
  {
    code: '2.2',
    name: 'Pricing Strategy',
    assetCount: 2,
    phase: 'Customer, Pricing & Promising Strategies',
    subProcessId: 'o2c-billing',
    items: [
      { code: '2.2.1', name: 'Determine Pricing Strategies', badge: 1, isCfoInput: false },
      { code: '2.2.2', name: 'Execute Pricing Strategies', badge: 1, isCfoInput: false },
      { code: '2.2.3', name: 'Monitor Pricing Strategies', badge: null, isCfoInput: false },
    ],
  },
  {
    code: '2.3',
    name: 'Sales Order Promising Strategy',
    assetCount: 2,
    phase: 'Customer, Pricing & Promising Strategies',
    subProcessId: 'o2c-order',
    items: [
      { code: '2.3.1', name: 'Determine Sales Order Promising Strategies', badge: 1, isCfoInput: false },
      { code: '2.3.2', name: 'Implement Sales Order Promising Strategies', badge: 1, isCfoInput: true },
      { code: '2.3.3', name: 'Monitor Sales Order Promising Strategies', badge: null, isCfoInput: false },
    ],
  },
  {
    code: '2.4',
    name: 'Quote Management',
    assetCount: 1,
    phase: 'Quote, Contract & Order Fulfilment',
    subProcessId: 'o2c-order',
    items: [
      { code: '2.4.1', name: 'Create / Revise / Manage Quote', badge: 1, isCfoInput: false },
      { code: '2.4.2', name: 'Manage Deals', badge: null, isCfoInput: false },
      { code: '2.4.3', name: 'Collaborate & Present Quote', badge: null, isCfoInput: false },
      { code: '2.4.4', name: 'Review, Approve & Distribute Quote', badge: null, isCfoInput: false },
    ],
  },
  {
    code: '2.5',
    name: 'Customer Contract Lifecycle Management',
    assetCount: 2,
    phase: 'Quote, Contract & Order Fulfilment',
    subProcessId: 'o2c-master',
    items: [
      { code: '2.5.1', name: 'Establish Customer Contract Portfolio Management', badge: 1, isCfoInput: false },
      { code: '2.5.2', name: 'Manage Customer Contract', badge: null, isCfoInput: false },
      { code: '2.5.3', name: 'Negotiate, Approve & Sign Customer Contract', badge: 1, isCfoInput: false },
    ],
  },
  {
    code: '2.6',
    name: 'Order & Fulfilment Management',
    assetCount: 2,
    phase: 'Quote, Contract & Order Fulfilment',
    subProcessId: 'o2c-order',
    items: [
      { code: '2.6.1', name: 'Receive, Enter & Validate Order', badge: 1, isCfoInput: true },
      { code: '2.6.2', name: 'Check Credit Availability', badge: null, isCfoInput: true },
      { code: '2.6.3', name: 'Confirm Inventory/ Out of Stock', badge: null, isCfoInput: false },
      { code: '2.6.4', name: 'Confirm Order Fulfilment / Manage Lifecycle', badge: 1, isCfoInput: true },
      { code: '2.6.5', name: 'Process Change Orders', badge: null, isCfoInput: true },
      { code: '2.6.6', name: 'Create & Manage Install Base', badge: null, isCfoInput: false },
    ],
  },
  {
    code: '2.7',
    name: 'Subscription Management',
    assetCount: 2,
    phase: 'Subscription Management',
    subProcessId: 'o2c-billing',
    items: [
      { code: '2.7.1', name: 'Execute Contract & Activate Subscription', badge: 1, isCfoInput: false },
      { code: '2.7.2', name: 'Manage Subscription', badge: 1, isCfoInput: false },
      { code: '2.7.3', name: 'Convert Contract to Evergreen Subscription', badge: null, isCfoInput: false },
    ],
  },
  {
    code: '2.8',
    name: 'Billing Management',
    assetCount: 2,
    phase: 'Invoice to Cash',
    subProcessId: 'o2c-billing',
    items: [
      { code: '2.8.1', name: 'Manage Billing & Payment Methods', badge: null, isCfoInput: false },
      { code: '2.8.2', name: 'Generate, Review & Approve Invoice', badge: 1, isCfoInput: true },
      { code: '2.8.3', name: 'Distribute Invoice', badge: 1, isCfoInput: true },
      { code: '2.8.4', name: 'Generate & Distribute Statements', badge: null, isCfoInput: false },
      { code: '2.8.5', name: 'Manage Loyalty Programs, Incentives & Commissions', badge: null, isCfoInput: false },
    ],
  },
  {
    code: '2.9',
    name: 'Revenue Recognition',
    assetCount: 2,
    phase: 'Invoice to Cash',
    subProcessId: 'o2c-billing',
    items: [
      { code: '2.9.1', name: 'Define Standalone Selling Price (SSP) Stratification', badge: 1, isCfoInput: false },
      { code: '2.9.2', name: 'Perform Revenue Recognition', badge: 1, isCfoInput: true },
      { code: '2.9.3', name: 'Manage Revenue Recognition', badge: null, isCfoInput: false },
    ],
  },
  {
    code: '2.10',
    name: 'Customer Inquiry & Dispute',
    assetCount: 1,
    phase: 'Invoice to Cash',
    subProcessId: 'o2c-deductions',
    items: [
      { code: '2.10.1', name: 'Manage Customer Service Inquiries & Orders', badge: null, isCfoInput: false },
      { code: '2.10.2', name: 'Manage Customer Disputes', badge: 1, isCfoInput: true },
      { code: '2.10.3', name: 'Process Returns, Adjustments, Warranty Claims', badge: 1, isCfoInput: true },
      { code: '2.10.4', name: 'Process Charge Backs & Write-offs', badge: null, isCfoInput: true },
    ],
  },
  {
    code: '2.11',
    name: 'Cash Applications',
    assetCount: 3,
    phase: 'Invoice to Cash',
    subProcessId: 'o2c-billing',
    items: [
      { code: '2.11.1', name: 'Process Payments & Apply Receipts', badge: 1, isCfoInput: true },
      { code: '2.11.2', name: 'Process Direct Debit Payments', badge: null, isCfoInput: false },
      { code: '2.11.3', name: 'File Unapplied/Misapplied/Unidentified Payments', badge: 1, isCfoInput: true },
      { code: '2.11.4', name: 'Validate & Record Deductions', badge: 1, isCfoInput: false },
      { code: '2.11.5', name: 'Process Credit/Debit Memos', badge: null, isCfoInput: false },
      { code: '2.11.6', name: 'Manage Customer / Vendor Netting', badge: null, isCfoInput: false },
    ],
  },
  {
    code: '2.12',
    name: 'Collections Management',
    assetCount: 3,
    phase: 'Invoice to Cash',
    subProcessId: 'o2c-credit',
    items: [
      { code: '2.12.1', name: 'Define Collections Strategy', badge: null, isCfoInput: true },
      { code: '2.12.2', name: 'Perform Collection Activity', badge: 2, isCfoInput: true },
      { code: '2.12.3', name: 'Perform Escalation & Follow-up', badge: null, isCfoInput: true },
      { code: '2.12.4', name: 'Calculate Penalties on Past Due Collections', badge: 1, isCfoInput: false },
    ],
  },
  {
    code: '2.13',
    name: 'Period End Close',
    assetCount: 1,
    phase: 'Period End Close & Reporting',
    subProcessId: 'o2c-billing',
    items: [
      { code: '2.13.1', name: 'File Bank Transactions', badge: null, isCfoInput: false },
      { code: '2.13.2', name: 'Close AR Subledger & File with GL', badge: 1, isCfoInput: true },
      { code: '2.13.3', name: 'Close Revenue Subledger & File with GL', badge: null, isCfoInput: true },
      { code: '2.13.4', name: 'Prepare Bad Debt & Other Period End Accruals', badge: null, isCfoInput: true },
    ],
  },
  {
    code: '2.14',
    name: 'Reporting & Analytics',
    assetCount: 12,
    phase: 'Process Governance',
    subProcessId: 'o2c-credit',
    items: [
      { code: '2.14.1', name: 'Perform AR, Revenue & Aging Analysis', badge: 9, isCfoInput: true },
      { code: '2.14.2', name: 'Prepare Revenue Forecasting & Analysis', badge: 1, isCfoInput: false },
      { code: '2.14.3', name: 'Perform Customer Risk & Credit Analysis', badge: 2, isCfoInput: false },
      { code: '2.14.4', name: 'Collect & Analyze Voice of Customer Data', badge: null, isCfoInput: false },
      { code: '2.14.5', name: 'Prepare KPI Reporting & Analytics', badge: null, isCfoInput: true },
    ],
  },
  {
    code: '2.15',
    name: 'Manage Process',
    assetCount: 2,
    phase: 'Process Governance',
    subProcessId: 'o2c-master',
    items: [
      { code: '2.15.1', name: 'Maintain Policies, Procedures, & Templates', badge: null, isCfoInput: false },
      { code: '2.15.2', name: 'Maintain Internal Controls', badge: 1, isCfoInput: false },
      { code: '2.15.3', name: 'Maintain Delegation of Authority - Credit Approval', badge: null, isCfoInput: false },
      { code: '2.15.4', name: 'Manage Process Efficiency & Effectiveness', badge: 1, isCfoInput: false },
      { code: '2.15.5', name: 'Enhance Business Partner/ Employee Experience', badge: null, isCfoInput: false },
      { code: '2.15.6', name: 'Archive & Maintain Records', badge: null, isCfoInput: false },
    ],
  },
  {
    code: '2.16',
    name: 'System Governance',
    assetCount: 2,
    phase: 'Process Governance',
    subProcessId: 'o2c-master',
    items: [
      { code: '2.16.1', name: 'Maintain Customer Master Data', badge: 2, isCfoInput: false },
      { code: '2.16.2', name: 'Maintain Application Configuration & Security', badge: null, isCfoInput: false },
      { code: '2.16.3', name: 'Manage Application Releases & Upgrades', badge: null, isCfoInput: false },
      { code: '2.16.4', name: 'Maintain Reports', badge: null, isCfoInput: false },
      { code: '2.16.5', name: 'Manage Interfaces', badge: null, isCfoInput: false },
      { code: '2.16.6', name: 'Maintain Process Automation & Digital Labor', badge: null, isCfoInput: false },
    ],
  },
];

export const O2C_APPLICATION_TILES = {
  // Collections Management
  '2.12': {
    title: 'Collections Management & Autonomous Dunning',
    subProcessId: 'o2c-credit',
    l3Id: 'collections-dunning',
    flagship: true,
    assetsCount: 3,
    description: 'Dynamic customer risk scoring, propensity-to-pay prediction, automated tiered dunning outreach, and dispute escalation.',
    applicationTiles: [
      {
        id: 'app-coll-agent',
        name: 'Collections Prioritisation Agent',
        type: 'Predictive ML Solution',
        status: 'Pilot',
        maturity: 'Active',
        potential: 'High',
        impact: 'High',
        agents: ['collections-agent'],
        features: ['Propensity-to-pay ML scoring', 'Next-best-action recommendation engine', 'Multi-channel dunning triggers (Email/SMS/WhatsApp)', 'Credit-hold auto-escalation'],
        metrics: { dsoReduction: '12 days target', collectorProductivity: '+45%', overdueReduction: '₹18.5 Cr' }
      },
      {
        id: 'app-credit-risk',
        name: 'Autonomous Credit Risk & Limit Assessor',
        type: 'Risk Management',
        status: 'Active',
        maturity: 'Production',
        potential: 'High',
        impact: 'Medium',
        agents: ['anomaly-agent'],
        features: ['Real-time credit bureau data feed', 'Financial statement analysis model', 'Dynamic credit limit adjustment'],
        metrics: { badDebtPrevention: '-38%', reviewTurnaround: '4 hrs vs 5 days' }
      }
    ]
  },
  // Cash Application
  '2.11': {
    title: 'Cash Applications & Remittance Matching',
    subProcessId: 'o2c-billing',
    l3Id: 'cash-application',
    flagship: true,
    assetsCount: 3,
    description: 'Autonomous bank lockbox statement ingestion, check & wire remittance OCR, invoice-level clearing, and short-payment categorization.',
    applicationTiles: [
      {
        id: 'app-cash-app-engine',
        name: 'Intelligent Cash Application Engine',
        type: 'AI & Machine Learning',
        status: 'Production',
        maturity: 'Active',
        potential: 'High',
        impact: 'High',
        agents: ['invoice-reader', 'match-agent'],
        features: ['Multi-bank lockbox parsing', 'Unstructured remittance advice extraction', 'Automated GL clearing in SAP/Oracle', 'Short-payment code attribution'],
        metrics: { autoCashHitRate: '92.4%', unappliedCashReduction: '-75%', processingSpeed: '<2 mins' }
      },
      {
        id: 'app-deductions-workbench',
        name: 'Deductions & Dispute Resolution Workbench',
        type: 'Claims & Deductions',
        status: 'Active',
        maturity: 'Scaling',
        potential: 'High',
        impact: 'Medium',
        agents: ['ap-copilot'],
        features: ['Root-cause reason coding', 'Claims matching with trade promotions', 'Automated debit memo generation'],
        metrics: { disputeCycleTime: '-50%', recoveryRate: '+24%' }
      }
    ]
  },
  // Billing & Invoicing
  '2.8': {
    title: 'Billing & Invoice Generation',
    subProcessId: 'o2c-billing',
    l3Id: 'invoice-generation',
    flagship: false,
    assetsCount: 2,
    description: 'Multi-channel invoice dispatch, e-invoicing compliance (GSTN / PEPPOL), milestone billing, and customer statement self-service.',
    applicationTiles: [
      {
        id: 'app-e-invoice-hub',
        name: 'Enterprise E-Invoicing & Billing Hub',
        type: 'Billing Engine',
        status: 'Production',
        maturity: 'Production',
        potential: 'Medium',
        impact: 'Medium',
        agents: ['match-agent'],
        features: ['Automated GST IRN & QR code generation', 'EDI 810 customer delivery', 'Customer billing portal integration'],
        metrics: { touchlessBilling: '98.5%', deliveryFailureRate: '<0.1%' }
      }
    ]
  },
  // Customer Credit & Master Data
  '2.1': {
    title: 'Customer Master Data & Credit Management',
    subProcessId: 'o2c-credit',
    l3Id: 'credit-risk',
    flagship: false,
    assetsCount: 2,
    description: 'Automated KYC verification, GSTN/PAN validation, entity deduplication, and credit limit governance.',
    applicationTiles: [
      {
        id: 'app-cust-onboarding',
        name: 'Digital Customer Onboarding & KYC Suite',
        type: 'Master Data & Risk',
        status: 'Active',
        maturity: 'Scaling',
        potential: 'High',
        impact: 'Medium',
        agents: [],
        features: ['Automated credit bureau scoring', 'Tax ID validation API', 'Credit committee approval workflows'],
        metrics: { onboardingTime: '24 hrs vs 7 days', cleanMasterData: '99.7%' }
      }
    ]
  },
  // Order Fulfilment
  '2.6': {
    title: 'Order & Fulfilment Management',
    subProcessId: 'o2c-order',
    l3Id: 'order-processing',
    flagship: false,
    assetsCount: 2,
    description: 'Sales order entry digitisation, credit hold checking, inventory ATP allocation, and change order processing.',
    applicationTiles: [
      {
        id: 'app-sales-order-ai',
        name: 'Autonomous Sales Order Ingestion',
        type: 'GenAI & Order Automation',
        status: 'Active',
        maturity: 'Scaling',
        potential: 'Medium',
        impact: 'Medium',
        agents: ['invoice-reader'],
        features: ['Customer PO PDF ingestion', 'Line item price & UOM verification', 'Automated SAP VA01 creation'],
        metrics: { entrySpeed: '30 sec per PO', errorRate: '-85%' }
      }
    ]
  },
  // Reporting & Analytics
  '2.14': {
    title: 'AR Reporting & Analytics Intelligence',
    subProcessId: 'o2c-credit',
    l3Id: 'collections-dunning',
    flagship: false,
    assetsCount: 12,
    description: 'Real-time aging analysis, revenue forecasting, DSO driver bridges, and working capital scenario modeling.',
    applicationTiles: [
      {
        id: 'app-ar-analytics-copilot',
        name: 'AR & Working Capital Analytics Copilot',
        type: 'Analytics & GenAI',
        status: 'Active',
        maturity: 'Production',
        potential: 'High',
        impact: 'High',
        agents: ['variance-agent'],
        features: ['Aging bucket waterfall analysis', 'Customer payment behavior trend prediction', 'Dispute impact on cash flow simulation'],
        metrics: { dsoVisibility: 'Real-time daily', cashForecastAccuracy: '94%' }
      }
    ]
  }
};

