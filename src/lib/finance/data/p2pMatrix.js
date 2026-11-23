export const P2P_PHASES = [
  {
    id: 's2c',
    name: 'Source to Contract',
    columnIds: ['5.1', '5.2', '5.3', '5.4', '5.5'],
  },
  {
    id: 'r2p',
    name: 'Requisition to Pay',
    columnIds: ['5.6', '5.7', '5.8', '5.9', '5.10', '5.11', '5.12'],
  },
];

export const P2P_MATRIX_COLUMNS = [
  {
    code: '5.1',
    name: 'Procurement Strategy',
    assetCount: 3,
    phase: 'Source to Contract',
    subProcessId: 'p2p-spend',
    items: [
      { code: '5.1.1', name: 'Define Strategic Objectives', badge: null, isCfoInput: false },
      { code: '5.1.2', name: 'Develop Operating Model', badge: null, isCfoInput: false },
      { code: '5.1.3', name: 'Define Governance & Stakeholder Management Strategy', badge: null, isCfoInput: false },
      { code: '5.1.4', name: 'Define People & Resourcing Strategy', badge: null, isCfoInput: false },
      { code: '5.1.5', name: 'Define Risk Management & Regulatory Compliance Strategy', badge: null, isCfoInput: false },
      { code: '5.1.6', name: 'Define Technology Strategy', badge: null, isCfoInput: false },
      { code: '5.1.7', name: 'Define Data Insights & Performance Management Strategy', badge: 2, isCfoInput: false },
    ],
  },
  {
    code: '5.2',
    name: 'Strategic Category Management',
    assetCount: 5,
    phase: 'Source to Contract',
    subProcessId: 'p2p-spend',
    items: [
      { code: '5.2.1', name: 'Define Category Portfolio Management & Segmentation', badge: 1, isCfoInput: false },
      { code: '5.2.2', name: 'Build Business Alignment', badge: null, isCfoInput: false },
      { code: '5.2.3', name: 'Perform Category Analysis', badge: 1, isCfoInput: false },
      { code: '5.2.4', name: 'Define Buying Channel', badge: 1, isCfoInput: false },
      { code: '5.2.5', name: 'Develop & Execute Category Strategy', badge: 1, isCfoInput: false },
      { code: '5.2.6', name: 'Govern & Manage Category', badge: 1, isCfoInput: false },
    ],
  },
  {
    code: '5.3',
    name: 'Supplier Relationship Management',
    assetCount: 8,
    phase: 'Source to Contract',
    subProcessId: 'p2p-vendor',
    items: [
      { code: '5.3.1', name: 'Define Supplier Portfolio Management & Segmentation', badge: null, isCfoInput: false },
      { code: '5.3.2', name: 'Certify & Develop Supplier', badge: null, isCfoInput: false },
      { code: '5.3.3', name: 'On-board Supplier & Setup Supplier Master Data', badge: 3, isCfoInput: false, isHighlighted: true },
      { code: '5.3.4', name: 'Manage Supplier Performance & Risk', badge: 5, isCfoInput: false },
    ],
  },
  {
    code: '5.4',
    name: 'Strategic Sourcing',
    assetCount: 2,
    phase: 'Source to Contract',
    subProcessId: 'p2p-spend',
    items: [
      { code: '5.4.1', name: 'Identify Supplier Opportunity & Business Requirements', badge: null, isCfoInput: false },
      { code: '5.4.2', name: 'Develop Sourcing Strategy', badge: null, isCfoInput: false },
      { code: '5.4.3', name: 'Execute Sourcing Strategy', badge: 1, isCfoInput: false, isHighlighted: true },
      { code: '5.4.4', name: 'Negotiate & Select Supplier', badge: null, isCfoInput: false },
      { code: '5.4.5', name: 'Author & Finalize Contract', badge: null, isCfoInput: false },
      { code: '5.4.6', name: 'Enable Supplier & Item Master / Catalog', badge: 1, isCfoInput: false, isHighlighted: true },
    ],
  },
  {
    code: '5.5',
    name: 'Contract Lifecycle Management',
    assetCount: 1,
    phase: 'Source to Contract',
    subProcessId: 'p2p-vendor',
    items: [
      { code: '5.5.1', name: 'Establish Contract Portfolio Management', badge: null, isCfoInput: false },
      { code: '5.5.2', name: 'Manage T&Cs & Contract Templates', badge: null, isCfoInput: false },
      { code: '5.5.3', name: 'Manage Contract Compliance & Admin (incl. Master Data)', badge: 1, isCfoInput: false },
      { code: '5.5.4', name: 'Close Out Contract', badge: null, isCfoInput: false },
    ],
  },
  {
    code: '5.6',
    name: 'Requisitioning',
    assetCount: 1,
    phase: 'Requisition to Pay',
    subProcessId: 'p2p-po',
    items: [
      { code: '5.6.1', name: 'Create Requisition', badge: 1, isCfoInput: false, isHighlighted: true },
      { code: '5.6.2', name: 'Review & Approve Requisition (incl. Budget Control)', badge: null, isCfoInput: false },
      { code: '5.6.3', name: 'Modify or Cancel Requisition', badge: null, isCfoInput: false },
    ],
  },
  {
    code: '5.7',
    name: 'Purchasing',
    assetCount: 5,
    phase: 'Requisition to Pay',
    subProcessId: 'p2p-po',
    items: [
      { code: '5.7.1', name: 'Create Purchase Order', badge: 1, isCfoInput: false },
      { code: '5.7.2', name: 'Review, Approve, & Distribute Purchase Order', badge: 1, isCfoInput: false },
      { code: '5.7.3', name: 'Manage Purchase Order Lifecycle', badge: 3, isCfoInput: false },
      { code: '5.7.4', name: 'Modify or Cancel Purchase Order', badge: null, isCfoInput: false },
      { code: '5.7.5', name: 'Expedite Order', badge: null, isCfoInput: false },
    ],
  },
  {
    code: '5.8',
    name: 'Receiving',
    assetCount: 4,
    phase: 'Requisition to Pay',
    subProcessId: 'p2p-ap',
    items: [
      { code: '5.8.1', name: 'Receive Advanced Shipment Notice', badge: null, isCfoInput: false },
      { code: '5.8.2', name: 'Accept/Refuse & Record Receipt of Goods/Services', badge: 4, isCfoInput: false },
      { code: '5.8.3', name: 'Research/Resolve Exceptions (Disputes, Warranty, Return)', badge: null, isCfoInput: false },
    ],
  },
  {
    code: '5.9',
    name: 'Invoice Processing & Payment',
    assetCount: 22,
    phase: 'Requisition to Pay',
    subProcessId: 'p2p-ap',
    items: [
      { code: '5.9.1', name: 'Receive Invoices & Credit Notes (incl. Self Billing & Prepayments)', badge: null, isCfoInput: true },
      { code: '5.9.2', name: 'Validate, Approve, & Post Invoices / Credit Notes', badge: 14, isCfoInput: true, isHighlighted: true },
      { code: '5.9.3', name: 'Generate Payments File & Release Payments', badge: 6, isCfoInput: true },
      { code: '5.9.4', name: 'Perform Bank Reconciliations', badge: 2, isCfoInput: true },
    ],
  },
  {
    code: '5.10',
    name: 'Purchasing/Payment Inquiries',
    assetCount: 2,
    phase: 'Requisition to Pay',
    subProcessId: 'p2p-vendor',
    items: [
      { code: '5.10.1', name: 'Manage Supplier Self-Service Portal', badge: null, isCfoInput: false },
      { code: '5.10.2', name: 'Support Requisition Inquiries', badge: null, isCfoInput: false },
      { code: '5.10.3', name: 'Support Purchase Order Inquiries', badge: null, isCfoInput: false },
      { code: '5.10.4', name: 'Manage Payment Inquiries & Exceptions', badge: 2, isCfoInput: false },
    ],
  },
  {
    code: '5.11',
    name: 'P-Card/T&E Card Administration',
    assetCount: 2,
    phase: 'Requisition to Pay',
    subProcessId: 'p2p-te',
    items: [
      { code: '5.11.1', name: 'Administer P-Cards / T&E Cards', badge: null, isCfoInput: false },
      { code: '5.11.2', name: 'Create & Submit Card Expense Report', badge: null, isCfoInput: false },
      { code: '5.11.3', name: 'Audit Card Expenses & Resolve Exceptions', badge: null, isCfoInput: false },
      { code: '5.11.4', name: 'Post Approved Card Expenses to AP Sub ledger', badge: null, isCfoInput: false },
      { code: '5.11.5', name: 'Modify or Close P-Cards/T&E Cards', badge: null, isCfoInput: false },
      { code: '5.11.6', name: 'Manage P-Card/T&E Card Provider Payment', badge: null, isCfoInput: false },
    ],
  },
  {
    code: '5.12',
    name: 'Period End Close',
    assetCount: 3,
    phase: 'Requisition to Pay',
    subProcessId: 'p2p-ap',
    items: [
      { code: '5.12.1', name: 'Close AP Sub ledger & Reconcile with GL', badge: null, isCfoInput: true },
      { code: '5.12.2', name: 'Perform Reconciliations & Identify Adjustments', badge: null, isCfoInput: true },
      { code: '5.12.3', name: 'Prepare GRNI & Other Month End Accruals', badge: null, isCfoInput: true },
    ],
  },
];

// Map of matrix codes to application tiles and agents
export const P2P_APPLICATION_TILES = {
  // Accounts payable & invoice processing
  '5.9': {
    title: 'Invoice Processing & Payment',
    subProcessId: 'p2p-ap',
    l3Id: 'invoice-processing',
    flagship: true,
    assetsCount: 22,
    description: 'Autonomous multi-format invoice reading, 3-way matching, AI exception triage, and discount-optimized payment execution.',
    applicationTiles: [
      {
        id: 'app-inv-proc',
        name: 'Invoice Processing Automation',
        type: 'Flagship Solution',
        status: 'Production',
        maturity: 'Deep-Dive Ready ★',
        potential: 'High',
        impact: 'High',
        agentUrl: 'https://fcc-frontend-133379243863.asia-south1.run.app/',
        agents: ['invoice-reader', 'match-agent', 'ap-copilot'],
        features: ['GenAI VLM Document Reader', 'Configurable 3-Way Match Engine', 'Exception Triage Copilot', 'Duplicate Invoice Detection'],
        metrics: { savings: '₹14.0 Cr/yr', touchlessRate: '85% Target', cycleTime: '-65%' }
      },
      {
        id: 'app-grn-recon',
        name: 'GRN & Receipt Reconciliation',
        type: 'Matching & Audit',
        status: 'Production',
        maturity: 'Active',
        potential: 'Medium',
        impact: 'High',
        agents: ['match-agent'],
        features: ['Automated GRN to PO cross-check', 'Tolerance band auto-pass', 'Discrepancy routing'],
        metrics: { matchAccuracy: '99.1%', autoClearance: '78%' }
      },
      {
        id: 'app-payment-exec',
        name: 'Payment Execution & Discount Optimization',
        type: 'Liquidity & Payables',
        status: 'Active',
        maturity: 'Active',
        potential: 'High',
        impact: 'Medium',
        agents: ['cash-forecast'],
        features: ['Dynamic early-payment discount capture', 'Automated host-to-host banking release', 'Audit logging'],
        metrics: { discountsCaptured: '₹2.8 Cr/yr', paymentSla: '99.4%' }
      },
      {
        id: 'app-bank-recon',
        name: 'Bank Reconciliation',
        type: 'Flagship Solution',
        status: 'Production',
        maturity: 'Active ★',
        potential: 'High',
        impact: 'High',
        agentUrl: 'https://recon-frontend-lwpgyh3rxa-el.a.run.app/',
        agents: ['anomaly-agent', 'match-agent'],
        features: ['Multi-Bank MT940 & BAI2 Statement Auto-Ingestion', 'AI-Powered Rule & ML Matching Engine', 'Real-time GL Posting & Host-to-Host Clearing', 'Automated Unreconciled Variance Escalation'],
        metrics: { autoMatchRate: '98.5%', cycleTime: '-80%', backlog: 'Zero day' }
      }
    ]
  },
  // Bank Reconciliations (5.9.4)
  '5.9.4': {
    title: 'Perform Bank Reconciliations',
    subProcessId: 'p2p-ap',
    l3Id: 'invoice-processing',
    flagship: true,
    assetsCount: 2,
    description: 'Autonomous multi-bank statement parsing, rule and ML transaction matching, GL clearing, and discrepancy resolution.',
    applicationTiles: [
      {
        id: 'app-bank-recon-direct',
        name: 'Bank Reconciliation',
        type: 'Flagship Solution',
        status: 'Production',
        maturity: 'Active ★',
        potential: 'High',
        impact: 'High',
        agentUrl: 'https://recon-frontend-lwpgyh3rxa-el.a.run.app/',
        agents: ['anomaly-agent', 'match-agent'],
        features: [
          'Multi-Bank MT940 & BAI2 Statement Auto-Ingestion',
          'AI-Powered Rule & ML Matching Engine',
          'Real-time GL Posting & Host-to-Host Clearing',
          'Automated Unreconciled Variance Escalation'
        ],
        metrics: { autoMatchRate: '98.5%', cycleTime: '-80%', backlog: 'Zero day' }
      },
      {
        id: 'app-bank-cash-audit',
        name: 'Cash Application & Clearing Reconciler',
        type: 'Reconciliation & Controls',
        status: 'Production',
        maturity: 'Active',
        potential: 'High',
        impact: 'Medium',
        agents: ['anomaly-agent'],
        features: ['Automated bank fee & FX variance allocation', 'Host-to-host statement polling', 'Audit trail generation'],
        metrics: { autoClearance: '95%', reconciliationTime: 'Real-time' }
      }
    ]
  },
  // Purchasing & PO
  '5.7': {
    title: 'Purchasing Operations & Order Management',
    subProcessId: 'p2p-po',
    l3Id: 'po-creation',
    flagship: false,
    assetsCount: 5,
    description: 'PO lifecycle generation, multi-tier approval routing, vendor transmission, and expedited order tracking.',
    applicationTiles: [
      {
        id: 'app-po-gen',
        name: 'Autonomous PO Creation Engine',
        type: 'Procurement Automation',
        status: 'Active',
        maturity: 'Production',
        potential: 'Medium',
        impact: 'Medium',
        agents: ['match-agent'],
        features: ['Auto-conversion from approved PRs', 'Contract pricing validation', 'SAP/Oracle EDI transmission'],
        metrics: { poCycleTime: '2.5 hrs vs 2 days', accuracy: '99.8%' }
      },
      {
        id: 'app-order-lifecycle',
        name: 'Order Lifecycle & Expedite Monitor',
        type: 'Supplier Tracking',
        status: 'Active',
        maturity: 'Scaling',
        potential: 'Medium',
        impact: 'Medium',
        agents: [],
        features: ['Milestone tracking', 'Lead-time prediction', 'Automated vendor reminders'],
        metrics: { onTimeDelivery: '+14%', expedites: '-40%' }
      }
    ]
  },
  // Supplier Relationship Management
  '5.3': {
    title: 'Supplier Relationship Management',
    subProcessId: 'p2p-vendor',
    l3Id: 'vendor-onboarding',
    flagship: false,
    assetsCount: 8,
    description: 'Digital supplier onboarding, automated KYC & GST verification, performance risk scoring, and query resolution.',
    applicationTiles: [
      {
        id: 'app-vendor-kyc',
        name: 'Vendor Onboarding & Digital KYC',
        type: 'Vendor Management',
        status: 'Active',
        maturity: 'Scaling',
        potential: 'Medium',
        impact: 'Medium',
        agents: [],
        features: ['GSTN & PAN verification', 'Bank account penny-drop validation', 'Automated compliance checks'],
        metrics: { onboardingDays: '3 days vs 18 days', compliance: '100%' }
      },
      {
        id: 'app-vendor-query',
        name: 'Vendor Query Management Bot',
        type: 'Conversational AI',
        status: 'Active',
        maturity: 'Active',
        potential: 'High',
        impact: 'Medium',
        agents: ['ap-copilot'],
        features: ['Payment status self-service', 'Invoice rejection explanation', '24/7 WhatsApp & Web chat'],
        metrics: { callDeflection: '72%', queryResolution: '4 mins' }
      }
    ]
  },
  // Receiving & GRN
  '5.8': {
    title: 'Goods & Services Receiving',
    subProcessId: 'p2p-ap',
    l3Id: 'grn-recon',
    flagship: false,
    assetsCount: 4,
    description: 'Digital advance shipping notices (ASN), mobile GRN capture, warehouse dock reconciliation, and exception logging.',
    applicationTiles: [
      {
        id: 'app-dock-receiving',
        name: 'Smart Receiving & ASN Matcher',
        type: 'Warehouse & Receiving',
        status: 'Active',
        maturity: 'Production',
        potential: 'Medium',
        impact: 'High',
        agents: ['match-agent'],
        features: ['Barcode/QR dock scanning', 'Auto-receipt against PO lines', 'Shortage & damage capture'],
        metrics: { receivingLag: '-80%', dockThroughput: '+35%' }
      }
    ]
  },
  // Strategic Category & Spend
  '5.1': {
    title: 'Procurement Strategy & Analytics',
    subProcessId: 'p2p-spend',
    l3Id: 'spend-analytics',
    flagship: false,
    assetsCount: 3,
    description: 'Strategic procurement planning, taxonomy mapping, spend analytics, and operating model benchmarking.',
    applicationTiles: [
      {
        id: 'app-spend-cube',
        name: 'AI Spend Cube & Maverick Buying Detector',
        type: 'Procurement Analytics',
        status: 'Active',
        maturity: 'Scaling',
        potential: 'Medium',
        impact: 'Medium',
        agents: ['anomaly-agent'],
        features: ['Tail spend classification', 'Contract leakage detection', 'Price variance cross-plant analysis'],
        metrics: { spendAddressable: '92%', savingsIdentified: '₹8.4 Cr' }
      }
    ]
  },
  // P-Card & T&E
  '5.11': {
    title: 'P-Card & T&E Expense Administration',
    subProcessId: 'p2p-te',
    l3Id: 'te-processing',
    flagship: false,
    assetsCount: 2,
    description: 'Automated receipt OCR, expense policy compliance auditing, corporate card reconciliation, and sub-ledger posting.',
    applicationTiles: [
      {
        id: 'app-te-audit',
        name: 'Automated T&E Claim Auditor',
        type: 'Expense Management',
        status: 'Active',
        maturity: 'Production',
        potential: 'High',
        impact: 'Low',
        agents: ['invoice-reader', 'anomaly-agent'],
        features: ['Receipt OCR from mobile upload', 'Policy violation flagging', 'Auto-approval under ₹5,000 threshold'],
        metrics: { auditTouchless: '82%', reimbursementTime: '24 hrs' }
      }
    ]
  },
  // Period End Close
  '5.12': {
    title: 'Period End AP Sub-Ledger Close',
    subProcessId: 'p2p-ap',
    l3Id: 'journal-entries',
    flagship: true,
    assetsCount: 3,
    description: 'Sub-ledger to general ledger reconciliation, GRNI accrual automation, and period-end close cut-off controls.',
    applicationTiles: [
      {
        id: 'app-grni-accrual',
        name: 'GRNI Accruals & Close Automation',
        type: 'Period End Close',
        status: 'Active',
        maturity: 'Pilot',
        potential: 'Medium',
        impact: 'High',
        agents: ['close-copilot', 'anomaly-agent'],
        features: ['Aged unvouchered GRN provisioning', 'Auto-reversal journal generation', 'Close checklist integration'],
        metrics: { closeSpeed: '2.1 days saved', varianceAudit: '100%' }
      }
    ]
  }
};

