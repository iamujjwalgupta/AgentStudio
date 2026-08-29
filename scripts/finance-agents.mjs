/**
 * Fifty finance utilities, written as Agent Studio specs.
 *
 * Each entry is a partial spec; scripts/seed-agents.mjs fills in the defaults
 * from emptySpec(), derives every tool gate from the tool's risk, and decides
 * whether the agent can be published or has to wait for a connection.
 *
 * Nothing here assumes an industry. Every agent works from documents the team
 * already produces (a trial balance, an AP ledger, a bank statement) or from
 * public sources, so a manufacturer, a hospital and a bank can all run them.
 */

export const AGENTS = [
  /* ── Record to report ─────────────────────────────────────── */
  {
    name: "Month-End Close Conductor",
    archetype: "operator",
    domain: "financial close",
    purpose:
      "Walks the close checklist task by task, reports what is done, what is late and who owns it.",
    brief:
      "Every working day during close, check our close task table, work out which tasks are complete, which are overdue and who owns them, then post a short status to the finance channel and write the full checklist to a file.",
    steps: [
      "Query the close task table for the current period, retrieving the task name, owner, due date and completion status.",
      "Classify every task as complete, due today, or overdue, and count each group.",
      "For each overdue task, note the owner and how many days it has slipped.",
      "Write the full checklist to a file, ordered by status with overdue tasks first.",
      "Post a short status to the finance channel: counts by status, then the overdue tasks with their owners.",
    ],
    tools: ["sql_query", "write_file", "post_message"],
    inputs: [{ label: "Period", hint: "The close period, e.g. 2026-08" }],
    output: {
      format: "Markdown checklist",
      instructions: "Lead with the three counts. Never claim a task is complete without a status value backing it.",
    },
    trigger: { type: "schedule", schedule: "Every working day at 08:00 during close" },
    guardrails: { maxSteps: 14 },
  },
  {
    name: "Journal Entry Anomaly Reviewer",
    archetype: "analyst",
    domain: "financial close",
    purpose:
      "Reads a journal entry listing and surfaces the entries a reviewer should look at first.",
    brief:
      "Take our journal entry listing for the period and flag the entries worth a second look — round-number amounts, entries posted at the weekend or after hours, entries by unusual users, entries to rarely used accounts, and anything posted right at the period cut-off.",
    steps: [
      "Read the journal entry listing and identify the columns holding the entry number, date, posting user, account, description and amount.",
      "Flag entries matching each risk pattern: suspiciously round amounts, weekend or after-hours postings, users who post rarely, accounts used rarely in the period, and entries within two days of the cut-off.",
      "Rank the flagged entries by how many patterns each one triggers.",
      "Write a review sheet listing each flagged entry, the patterns it triggered, and what a reviewer should check.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [{ label: "Journal entry listing", hint: "CSV or XLSX export of the period's entries" }],
    output: {
      format: "Markdown review sheet",
      instructions:
        "State the total entry count and how many were flagged. A flag is a question for a reviewer, never an accusation — word it that way.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 14 },
  },
  {
    name: "Balance Sheet Reconciliation Checker",
    archetype: "analyst",
    domain: "financial close",
    purpose:
      "Compares a reconciliation pack against the ledger balance and reports every unexplained difference.",
    brief:
      "Given a balance sheet reconciliation and the ledger balance it supports, check the reconciliation adds up, that the supporting items are dated and explained, and tell me every difference that is not accounted for.",
    steps: [
      "Read the reconciliation and identify the ledger balance, the supporting items and the stated difference.",
      "Re-add the supporting items and confirm they agree to the balance being reconciled.",
      "Flag every reconciling item that has no explanation, no date, or is older than the ageing threshold given.",
      "Write a conclusion stating whether the account is reconciled, and list every unexplained difference with its amount.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Reconciliation", hint: "The reconciliation worksheet for the account" },
      { label: "Ageing threshold", hint: "How old an open item may be before it is flagged, e.g. 90 days" },
    ],
    output: {
      format: "Markdown reconciliation note",
      instructions: "Show the arithmetic you performed. If the reconciliation does not add up, say so in the first line.",
    },
    trigger: { type: "manual" },
    guardrails: {},
  },
  {
    name: "Accrual Completeness Tester",
    archetype: "analyst",
    domain: "financial close",
    purpose:
      "Tests whether costs incurred before the cut-off were accrued, using post-period invoices and open purchase orders.",
    brief:
      "Compare invoices received after the period end against the accruals we booked, and tell me which costs relating to the period look like they were missed.",
    steps: [
      "Read the post-period invoice listing and the accrual schedule.",
      "For each post-period invoice, determine the service period it relates to from its date and description.",
      "Identify invoices whose service period falls before the cut-off but which do not appear on the accrual schedule.",
      "Total the potential understatement and rank the gaps by amount.",
      "Write a schedule of suspected missing accruals with the evidence for each.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Post-period invoices", hint: "Invoices received after the cut-off date" },
      { label: "Accrual schedule", hint: "What was accrued at period end" },
      { label: "Cut-off date", hint: "The period end date" },
    ],
    output: {
      format: "Markdown schedule",
      instructions: "Give the total suspected understatement in the first line. Cite the invoice number behind every gap.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 14 },
  },
  {
    name: "Intercompany Mismatch Finder",
    archetype: "analyst",
    domain: "financial close",
    purpose: "Matches intercompany balances between entities and reports every pair that does not agree.",
    brief:
      "Take the intercompany balances from each entity and pair them up. Tell me every pair that does not agree, by how much, and which side is likely wrong.",
    steps: [
      "Read the intercompany balance listing and identify the entity pairs, the currency and the balance on each side.",
      "Match each receivable to the corresponding payable in the counterparty entity.",
      "Calculate the difference for every pair and flag those above the tolerance given.",
      "Where a difference exists, note whether it looks like timing, currency translation, or a genuinely missing entry.",
      "Write a mismatch schedule sorted by absolute difference.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Intercompany balances", hint: "Balances by entity pair" },
      { label: "Tolerance", hint: "Difference below which a pair is treated as agreed" },
    ],
    output: {
      format: "Markdown schedule",
      instructions: "Report the total absolute mismatch first. Show both sides of every pair you flag.",
    },
    trigger: { type: "manual" },
    guardrails: {},
  },
  {
    name: "Variance Commentary Writer",
    archetype: "author",
    domain: "financial close",
    purpose:
      "Turns a period-on-period movement schedule into written commentary a reviewer can sign.",
    brief:
      "Take this month's results against last month and against the same month last year, work out what actually moved, and write the commentary — cause, amount, and whether it repeats.",
    steps: [
      "Read the comparative results and calculate the movement for every line, in both absolute and percentage terms.",
      "Keep only the movements above the materiality threshold given.",
      "For each material movement, identify the driver from the account detail supplied.",
      "Write commentary for each: what moved, by how much, why, and whether it is one-off or recurring.",
      "Write the commentary to a file, ordered by the size of the movement.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Comparative results", hint: "Current period against prior period and prior year" },
      { label: "Materiality threshold", hint: "e.g. 50,000 or 5%" },
    ],
    output: {
      format: "Markdown commentary",
      instructions:
        "One paragraph per movement. State the driver only where the data supports it; where it does not, say the driver is unexplained and needs input.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 14 },
  },
  {
    name: "Trial Balance Anomaly Scanner",
    archetype: "sentinel",
    domain: "financial close",
    purpose:
      "Scans a trial balance for the things that should never be there — wrong-sign balances, dormant accounts that moved, and suspense.",
    brief:
      "Scan our trial balance and tell me what looks wrong before I take it into close: accounts with the wrong sign, suspense and clearing accounts with a balance, dormant accounts that suddenly moved, and anything that does not balance.",
    steps: [
      "Read the trial balance and confirm total debits equal total credits.",
      "Flag every account carrying a balance opposite to its normal sign.",
      "Flag every suspense, clearing or holding account with a non-zero balance.",
      "Compare against the prior period and flag accounts that were dormant but now carry a balance, and accounts that moved by more than the threshold.",
      "Write a findings sheet grouped by anomaly type, with the account code and balance for each.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Trial balance", hint: "Current period trial balance" },
      { label: "Prior trial balance", hint: "The comparative period" },
    ],
    output: {
      format: "Markdown findings sheet",
      instructions: "Open with whether the trial balance balances, and the count of anomalies by type.",
    },
    trigger: { type: "schedule", schedule: "Every month on the first working day" },
    guardrails: { maxSteps: 14 },
  },
  {
    name: "Chart of Accounts Hygiene Auditor",
    archetype: "analyst",
    domain: "master data",
    purpose:
      "Audits the chart of accounts for duplicates, dormant codes, inconsistent naming and accounts open to posting that should not be.",
    brief:
      "Look at our chart of accounts and tell me what needs cleaning up — near-duplicate accounts, codes nobody has posted to in a year, names that do not follow the convention, and accounts open for posting that should be blocked.",
    steps: [
      "Query the chart of accounts for the code, name, type, posting status and last posting date of every account.",
      "Group accounts with near-identical names or purposes and flag them as possible duplicates.",
      "Flag accounts with no postings in the dormancy window given, and header accounts left open to posting.",
      "Flag names that break the workspace naming convention supplied.",
      "Write a clean-up schedule with a recommended action for each account.",
    ],
    tools: ["sql_query", "write_file"],
    inputs: [
      { label: "Dormancy window", hint: "e.g. 12 months with no postings" },
      { label: "Naming convention", hint: "How account names are meant to be structured" },
    ],
    output: {
      format: "Markdown clean-up schedule",
      instructions: "Recommend an action per account: keep, merge, rename, or block for posting. Never recommend deleting an account that has postings.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 14 },
  },
  {
    name: "Fixed Asset Register Auditor",
    archetype: "analyst",
    domain: "fixed assets",
    purpose:
      "Recalculates depreciation, finds fully depreciated assets still on the books, and flags register-to-ledger differences.",
    brief:
      "Check our fixed asset register: recalculate the depreciation charge, find assets that are fully depreciated but still sitting there, spot assets with no useful life or a missing in-service date, and tell me if the register agrees to the ledger.",
    steps: [
      "Read the fixed asset register and identify cost, in-service date, useful life, method and accumulated depreciation for each asset.",
      "Recalculate the period depreciation charge for every asset and compare it to the charge recorded.",
      "Flag assets that are fully depreciated but not retired, assets with a missing or implausible useful life, and assets with no in-service date.",
      "Compare the register totals to the ledger balances supplied and report any difference.",
      "Write an audit schedule with the recalculated charge, the differences and the flagged assets.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Fixed asset register", hint: "Asset-level register export" },
      { label: "Ledger balances", hint: "Cost and accumulated depreciation per the ledger" },
    ],
    output: {
      format: "Markdown audit schedule",
      instructions: "Show your depreciation recalculation for any asset where you report a difference.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 16 },
  },

  /* ── Procure to pay ───────────────────────────────────────── */
  {
    name: "Invoice Three-Way Match Checker",
    archetype: "operator",
    domain: "accounts payable",
    purpose:
      "Matches invoice to purchase order to goods receipt and reports every invoice that cannot be cleared for payment.",
    brief:
      "Match each supplier invoice to its purchase order and goods receipt. Tell me which ones match, which are over-billed, which have no receipt yet, and which have no purchase order at all.",
    steps: [
      "Read the invoice, the purchase order listing and the goods receipt listing.",
      "Match each invoice to a purchase order by number, and to a goods receipt by purchase order line.",
      "Compare quantity and price across the three documents and calculate any difference.",
      "Classify each invoice as matched, price variance, quantity variance, receipt missing, or no purchase order.",
      "Write a match report grouped by classification with the value at stake in each group.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Invoices", hint: "Invoice document or listing" },
      { label: "Purchase orders", hint: "Open purchase order listing" },
      { label: "Goods receipts", hint: "Receipts recorded against the orders" },
      { label: "Tolerance", hint: "Price and quantity variance you will accept, e.g. 2%" },
    ],
    output: {
      format: "Markdown match report",
      instructions: "Never mark an invoice matched unless you can cite the purchase order number and the receipt behind it.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 16 },
  },
  {
    name: "Duplicate Payment Detector",
    archetype: "sentinel",
    domain: "accounts payable",
    purpose:
      "Finds probable duplicate invoices and payments before the payment run leaves the building.",
    brief:
      "Go through our payables and find likely duplicates — same supplier and amount on nearby dates, the same invoice number entered twice, invoice numbers that differ only by a leading zero or a stray character, and the same invoice booked under two supplier codes.",
    steps: [
      "Read the payables listing and identify supplier, invoice number, invoice date, amount and payment status.",
      "Find exact duplicates on supplier, invoice number and amount.",
      "Find near duplicates: same supplier and amount within the date window given, and invoice numbers that differ only by formatting.",
      "Find the same invoice number and amount recorded against different supplier codes with similar names.",
      "Rank the candidates by confidence and by the amount at risk, and write a recovery schedule.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Payables listing", hint: "Invoices and payments for the period" },
      { label: "Date window", hint: "How far apart two invoices can be and still be a suspected duplicate, e.g. 30 days" },
    ],
    output: {
      format: "Markdown recovery schedule",
      instructions:
        "Put the total amount at risk in the first line. Give every candidate a confidence of high, medium or low and say what makes it that.",
    },
    trigger: { type: "schedule", schedule: "Every week before the payment run" },
    guardrails: { maxSteps: 16 },
  },
  {
    name: "Vendor Master Data Cleanser",
    archetype: "analyst",
    domain: "master data",
    purpose:
      "Finds duplicate suppliers, missing tax or bank details, and vendors that share a bank account.",
    brief:
      "Audit our vendor master: duplicate suppliers under slightly different names, missing tax identifiers or bank details, vendors that have not been used in over a year, and any two vendors sharing a bank account.",
    steps: [
      "Query the vendor master for name, tax identifier, bank details, address, status and last transaction date.",
      "Group vendors with similar names, matching tax identifiers or matching addresses as suspected duplicates.",
      "Flag active vendors missing a tax identifier or bank details, and vendors with no activity in the dormancy window.",
      "Flag any bank account that appears against more than one vendor.",
      "Write a clean-up schedule with a recommended action for each finding.",
    ],
    tools: ["sql_query", "write_file"],
    inputs: [{ label: "Dormancy window", hint: "e.g. 18 months with no transactions" }],
    output: {
      format: "Markdown clean-up schedule",
      instructions:
        "Group findings by type with a count for each. Shared bank accounts go first — treat them as a control matter for a human, not a data quality note.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 14 },
  },
  {
    name: "Supplier Contract Obligation Extractor",
    archetype: "analyst",
    domain: "procurement",
    purpose:
      "Pulls the dates, money and exit terms out of a supplier contract into a schedule finance can act on.",
    brief:
      "Read this supplier contract and pull out everything finance needs: the term, the renewal and notice dates, the pricing and any escalator, payment terms, caps and minimum commitments, and what it costs to get out.",
    steps: [
      "Read the contract and locate the parties, the effective date and the term.",
      "Extract the renewal mechanism and the notice period, and calculate the date by which notice must be served.",
      "Extract the pricing, any indexation or escalation clause, payment terms and minimum spend commitment.",
      "Extract the liability cap, termination rights and any exit or break fee.",
      "Write an obligation schedule with a clause reference against every item.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [{ label: "Contract", hint: "The signed supplier agreement, PDF or DOCX" }],
    output: {
      format: "Markdown obligation schedule",
      instructions:
        "Cite the clause number for every extracted term. Where the contract is silent or ambiguous, write 'not stated' rather than inferring it. This is a summary for finance, not legal advice.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 14 },
  },
  {
    name: "Early Payment Discount Optimiser",
    archetype: "analyst",
    domain: "accounts payable",
    purpose:
      "Works out which invoices are worth paying early, and what the discounts we missed have cost.",
    brief:
      "Look at our open payables and the discount terms on each. Tell me which invoices are worth paying early against our cost of capital, what the annualised return is, and what we have already left on the table.",
    steps: [
      "Read the open payables listing and identify the discount terms, discount date and due date for each invoice.",
      "For every invoice still inside its discount window, calculate the annualised return from taking the discount.",
      "Compare each return to the cost of capital given and mark the invoice take or skip.",
      "Total the cash needed to take every worthwhile discount and the benefit it buys.",
      "Identify discounts already expired unclaimed and total what they were worth.",
      "Write a schedule of recommended early payments and a note on the discounts missed.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Open payables", hint: "Invoices with their terms and due dates" },
      { label: "Cost of capital", hint: "Annual rate to judge the discount against, e.g. 9%" },
    ],
    output: {
      format: "Markdown schedule",
      instructions: "Show the annualised return calculation for each recommendation. Lead with the total benefit and the cash it requires.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 14 },
  },
  {
    name: "Expense Policy Compliance Checker",
    archetype: "sentinel",
    domain: "employee expenses",
    purpose: "Tests an expense claim batch against the written policy and flags what breaches it.",
    brief:
      "Check these expense claims against our policy document. Flag anything over a limit, missing a receipt, submitted late, split to duck a threshold, or in a category we do not reimburse.",
    steps: [
      "Read the expense policy and extract every testable rule: category limits, receipt thresholds, submission deadlines and prohibited categories.",
      "Read the expense claim batch and evaluate every claim line against each rule.",
      "Flag claims that breach a rule, and separately flag sets of claims that look split to stay under a threshold.",
      "Group the breaches by rule and by claimant, with the value involved.",
      "Write an exception report listing each breach, the rule it breaks and the policy clause behind it.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Expense claims", hint: "The claim batch to test" },
      { label: "Expense policy", hint: "Your written policy document" },
    ],
    output: {
      format: "Markdown exception report",
      instructions:
        "Quote the policy clause behind every flag. Report breaches as items for review by a person, never as a decision on the claim.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 16 },
  },
  {
    name: "Purchase Commitment Tracker",
    archetype: "analyst",
    domain: "procurement",
    purpose:
      "Reports what has been committed on open purchase orders but not yet received, invoiced or spent.",
    brief:
      "Tell me what we have committed but not yet spent: open purchase orders by department, how much is received but not invoiced, how much is ordered but not received, and which orders have been sitting open too long.",
    steps: [
      "Query open purchase orders for the department, order value, received value and invoiced value.",
      "Calculate committed-not-received and received-not-invoiced for each order.",
      "Aggregate the commitment by department and compare it to the budget remaining supplied.",
      "Flag orders open longer than the ageing threshold and orders fully received with no invoice.",
      "Write a commitment report by department with the ageing exceptions listed.",
    ],
    tools: ["sql_query", "write_file"],
    inputs: [
      { label: "Ageing threshold", hint: "How long an order may stay open before it is flagged, e.g. 120 days" },
      { label: "Budget remaining", hint: "Remaining budget by department, if you want the comparison" },
    ],
    output: {
      format: "Markdown commitment report",
      instructions: "Lead with total commitment. Show received-not-invoiced separately — it is the accrual figure.",
    },
    trigger: { type: "schedule", schedule: "Every month before close" },
    guardrails: { maxSteps: 14 },
  },

  /* ── Order to cash ────────────────────────────────────────── */
  {
    name: "Receivables Collection Chaser",
    archetype: "author",
    domain: "credit control",
    purpose:
      "Drafts the right chase letter for each overdue customer based on how late they are and their history.",
    brief:
      "Go through the aged receivables, work out which accounts to chase, and draft the right message for each one — gentle for a first reminder, firmer as it ages — then send them once I have approved the wording.",
    steps: [
      "Read the aged receivables listing and identify each overdue customer, the invoices involved and how far past due they are.",
      "Assign each account a chase stage from the ageing bands and the contact history supplied.",
      "Draft a message for each account at the tone of its stage, listing the specific invoices, amounts and due dates.",
      "Present every draft for approval before anything is sent.",
      "Send the approved messages and write a log of what went to whom.",
    ],
    tools: ["read_document", "send_email", "write_file"],
    inputs: [
      { label: "Aged receivables", hint: "Open invoices by customer and ageing band" },
      { label: "Contact history", hint: "When each customer was last chased, if you have it" },
    ],
    output: {
      format: "Email drafts",
      instructions:
        "Every message names the exact invoices and amounts. Stay courteous at every stage. Never state a legal consequence or threaten action — escalation wording is a decision for a person.",
    },
    trigger: { type: "schedule", schedule: "Every Monday at 09:00" },
    guardrails: { maxSteps: 16 },
  },
  {
    name: "Customer Credit Risk Screener",
    archetype: "analyst",
    domain: "credit control",
    purpose:
      "Builds a credit picture of a prospective customer from public filings, news and their payment history.",
    brief:
      "Before we extend credit to a new customer, tell me what the public record says: filed accounts, any distress signals in the news, how long they have traded, and what limit looks sensible.",
    steps: [
      "Search public sources for the customer's filed accounts, registered status and trading history.",
      "Search recent news for distress signals: losses, restructuring, late filings, litigation, leadership churn.",
      "Retrieve any specific filing or page that carries the numbers, and pull out the key figures.",
      "Weigh the evidence into a plain-language risk assessment with the reasoning shown.",
      "Write a credit note with a recommended limit and the conditions that should attach to it.",
    ],
    tools: ["web_search", "fetch_url", "write_file"],
    inputs: [
      { label: "Customer name", hint: "Legal entity name, and registration number if you have it" },
      { label: "Credit requested", hint: "The limit and terms being asked for" },
    ],
    output: {
      format: "Markdown credit note",
      instructions:
        "Cite a source URL for every fact. Where the public record is thin, say so — a thin record is itself a finding. The recommendation is advisory; a person sets the limit.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 16 },
  },
  {
    name: "Cash Application Matcher",
    archetype: "operator",
    domain: "accounts receivable",
    purpose:
      "Matches unapplied receipts to open invoices, including part payments and lumped remittances.",
    brief:
      "Match the cash that came in against our open invoices. Handle the ones that paid several invoices in one transfer and the ones that paid short, and tell me what is left unmatched.",
    steps: [
      "Read the receipts listing and the open invoice listing.",
      "Match receipts to invoices on exact amount and reference first.",
      "For the remainder, look for combinations of open invoices that sum to a receipt, and part payments against a single invoice.",
      "Calculate any short payment and flag it with the invoice it relates to.",
      "Write an application schedule, and list every receipt still unmatched with the reference it carried.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Receipts", hint: "Cash received, with references and amounts" },
      { label: "Open invoices", hint: "Outstanding invoices by customer" },
    ],
    output: {
      format: "Markdown application schedule",
      instructions:
        "Report the match rate by value and by count. Propose matches only where the arithmetic is exact; anything you had to assume goes in the unmatched list for a person.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 16 },
  },
  {
    name: "DSO Driver Analyst",
    archetype: "analyst",
    domain: "working capital",
    purpose: "Explains why days sales outstanding moved, and which customers caused it.",
    brief:
      "Our DSO moved this period. Work out the real cause — is it a few slow customers, terms we granted, invoices going out late, or disputes — and quantify each driver.",
    steps: [
      "Read the receivables and revenue data and calculate days sales outstanding for the current and comparative periods.",
      "Decompose the movement into its drivers: mix of customers, changes in terms, billing delay, and disputed balances.",
      "Quantify each driver's contribution in days and reconcile them back to the total movement.",
      "Identify the customers contributing most to the deterioration.",
      "Write an analysis with the driver bridge and the specific accounts to act on.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Receivables data", hint: "Aged receivables for both periods" },
      { label: "Revenue data", hint: "Revenue for the same periods" },
    ],
    output: {
      format: "Markdown analysis",
      instructions: "The driver contributions must reconcile to the total DSO movement. Show that reconciliation.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 14 },
  },
  {
    name: "Credit Limit Review Board",
    archetype: "analyst",
    domain: "credit control",
    purpose:
      "Reviews existing credit limits against actual payment behaviour and recommends where to move them.",
    brief:
      "Review the credit limits on our existing customers against how they actually pay. Tell me who should have a higher limit, who should have a lower one, and who is consistently trading over the limit we set.",
    steps: [
      "Query customer balances, credit limits, payment history and average days to pay.",
      "Calculate limit utilisation and payment performance for every customer.",
      "Identify customers consistently exceeding their limit, and customers well within a limit they have earned an increase on.",
      "Recommend a revised limit for each exception, with the payment evidence behind it.",
      "Write a review schedule ordered by the size of the change recommended.",
    ],
    tools: ["sql_query", "write_file"],
    inputs: [{ label: "Review threshold", hint: "Utilisation level that triggers a review, e.g. above 90% or below 30%" }],
    output: {
      format: "Markdown review schedule",
      instructions:
        "Every recommendation cites the customer's actual payment record. Recommendations are for a credit committee to decide, not decisions.",
    },
    trigger: { type: "schedule", schedule: "Every quarter" },
    guardrails: { maxSteps: 14 },
  },
  {
    name: "Billing Leakage Detector",
    archetype: "sentinel",
    domain: "revenue assurance",
    purpose:
      "Finds work delivered but never invoiced, and contracted charges that were never billed.",
    brief:
      "Compare what we delivered against what we billed. Find the work with no invoice behind it, the contracted charges that never went out, and the rates we billed below the contract.",
    steps: [
      "Read the delivery or usage record and the invoice listing for the same period.",
      "Match delivered items to invoice lines and identify everything delivered but not billed.",
      "Compare the rate billed on each line against the contracted rate and flag every underbilling.",
      "Identify recurring charges in the contract that did not appear in the period's invoices.",
      "Write a leakage report with the value of each category and the total recoverable.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Delivery record", hint: "What was delivered, shipped or consumed in the period" },
      { label: "Invoices issued", hint: "What was actually billed" },
      { label: "Contract terms", hint: "Agreed rates and recurring charges" },
    ],
    output: {
      format: "Markdown leakage report",
      instructions: "Lead with total leakage. Cite the delivery reference and the contract rate behind every item.",
    },
    trigger: { type: "schedule", schedule: "Every month after billing closes" },
    guardrails: { maxSteps: 16 },
  },

  /* ── Treasury and cash ────────────────────────────────────── */
  {
    name: "Thirteen-Week Cash Flow Forecaster",
    archetype: "analyst",
    domain: "treasury",
    purpose:
      "Builds a rolling thirteen-week cash forecast from receivables, payables and known fixed outflows.",
    brief:
      "Build me a thirteen-week cash forecast. Take the open receivables and how those customers actually pay, the payables and their due dates, plus payroll, rent, tax and debt service, and show me the weekly position and the low point.",
    steps: [
      "Read the receivables, payables and fixed outflow schedules and the opening cash balance.",
      "Phase receivable collections into weeks using each customer's actual payment behaviour, not the invoice due date.",
      "Phase payables into weeks by due date, and add the known fixed outflows.",
      "Calculate the closing cash position for each of the thirteen weeks and identify the lowest point.",
      "Write the forecast as a weekly table with the assumptions listed underneath.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Opening cash", hint: "Cash balance at the start of week one" },
      { label: "Receivables and payables", hint: "Open items with dates" },
      { label: "Fixed outflows", hint: "Payroll, rent, tax, debt service and their dates" },
    ],
    output: {
      format: "Markdown forecast table",
      instructions:
        "State the minimum cash week and balance in the first line. List every assumption you made about collection timing — the forecast is only as good as those.",
    },
    trigger: { type: "schedule", schedule: "Every Monday at 07:00" },
    guardrails: { maxSteps: 16 },
  },
  {
    name: "Bank Statement Reconciler",
    archetype: "operator",
    domain: "treasury",
    purpose: "Reconciles a bank statement to the cash ledger and lists every unreconciled item.",
    brief:
      "Reconcile this bank statement to our cash book. Match what you can, then tell me what is outstanding on each side and whether the reconciliation actually works.",
    steps: [
      "Read the bank statement and the cash ledger for the same period.",
      "Match transactions on amount, date and reference, allowing for the clearing window given.",
      "List unpresented payments, deposits in transit, and bank items absent from the ledger such as charges and interest.",
      "Build the reconciliation from the bank balance to the ledger balance and confirm it agrees.",
      "Write the reconciliation with every open item listed and aged.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Bank statement", hint: "Statement for the period" },
      { label: "Cash ledger", hint: "The cash book for the same period" },
      { label: "Clearing window", hint: "Days a transaction may take to clear, e.g. 3" },
    ],
    output: {
      format: "Markdown reconciliation",
      instructions: "If the reconciliation does not agree, say so in the first line and give the unexplained difference.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 16 },
  },
  {
    name: "FX Exposure Snapshot",
    archetype: "analyst",
    domain: "treasury",
    purpose:
      "Restates foreign currency balances at current rates and shows what a rate move would cost.",
    brief:
      "Take our foreign currency balances, get today's rates, restate everything into our reporting currency, and show me what a move of a few percent either way would do to the result.",
    steps: [
      "Read the foreign currency balance listing and identify the currencies and amounts held.",
      "Find the current exchange rate for each currency against the reporting currency, recording the source and time.",
      "Restate every balance at the current rate and calculate the unrealised gain or loss against the booked rate.",
      "Run the sensitivity band given in both directions and show the effect on each currency and in total.",
      "Write an exposure snapshot with the net position by currency and the sensitivity table.",
    ],
    tools: ["web_search", "read_document", "write_file"],
    inputs: [
      { label: "Currency balances", hint: "Balances by currency with the rate they were booked at" },
      { label: "Reporting currency", hint: "The currency you report in" },
      { label: "Sensitivity band", hint: "e.g. plus and minus 5%" },
    ],
    output: {
      format: "Markdown exposure snapshot",
      instructions:
        "Record the rate source and the time you retrieved it against every rate. Rates move — say plainly that the snapshot is as at that moment.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 16 },
  },
  {
    name: "Debt Covenant Monitor",
    archetype: "sentinel",
    domain: "treasury",
    purpose:
      "Recalculates every covenant ratio, reports headroom, and warns before a breach happens.",
    brief:
      "Take our facility agreement and this period's results, recalculate each covenant exactly as the agreement defines it, tell me the headroom on each, and email me if any is close to breaching.",
    steps: [
      "Read the facility agreement and extract every financial covenant with its precise definition and test date.",
      "Read the period results and calculate each covenant ratio strictly as the agreement defines the inputs.",
      "Compare each result to its threshold and calculate the headroom in both ratio and monetary terms.",
      "Work out how far the underlying figure could move before each covenant breaches.",
      "If any covenant is inside the warning margin given, send an alert naming the covenant, the ratio and the headroom.",
    ],
    tools: ["read_document", "send_email", "write_file"],
    inputs: [
      { label: "Facility agreement", hint: "The loan agreement containing the covenants" },
      { label: "Period results", hint: "The financials for the test period" },
      { label: "Warning margin", hint: "Headroom below which you want to be alerted, e.g. 10%" },
    ],
    output: {
      format: "Markdown covenant report",
      instructions:
        "Quote the agreement's definition beside every ratio you calculate — the definition, not the ordinary meaning of the term. Show the full calculation. A covenant position is a matter for the CFO; report it, do not interpret the consequences.",
    },
    trigger: { type: "schedule", schedule: "Every month once results are final" },
    guardrails: { maxSteps: 16 },
  },
  {
    name: "Idle Cash Sweep Advisor",
    archetype: "analyst",
    domain: "treasury",
    purpose:
      "Identifies cash sitting idle beyond the buffer and what placing it would earn at current rates.",
    brief:
      "Look at our account balances and cash forecast, work out how much is genuinely surplus after the buffer, check what deposit rates are available, and tell me what we are giving up by leaving it where it is.",
    steps: [
      "Read the account balances and the cash forecast, and calculate the surplus above the operating buffer for each account.",
      "Determine how long each surplus can be committed before the forecast needs it back.",
      "Retrieve current deposit rates for the relevant terms and currencies from the rates source.",
      "Calculate the income foregone by leaving the surplus in place, per account and in total.",
      "Write a placement recommendation showing amount, term and expected income for each.",
    ],
    tools: ["read_document", "http_request", "write_file"],
    inputs: [
      { label: "Account balances", hint: "Current balances by account and currency" },
      { label: "Operating buffer", hint: "Minimum balance to leave in place" },
      { label: "Cash forecast", hint: "Forecast outflows that constrain the term" },
    ],
    output: {
      format: "Markdown recommendation",
      instructions:
        "Never recommend a term longer than the forecast shows the cash is free for. Record the rate source and retrieval time. This is analysis for a treasurer to act on, not investment advice.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 16 },
  },
  {
    name: "Payment Run Approver Brief",
    archetype: "author",
    domain: "accounts payable",
    purpose:
      "Summarises a proposed payment run so the approver sees the exceptions rather than a thousand lines.",
    brief:
      "Before I approve the payment run, give me a one-page brief: total and count, the largest payments, anything to a vendor whose bank details changed recently, anything to a new vendor, anything paid early, and anything unusual against that vendor's history.",
    steps: [
      "Query the proposed payment run for vendor, amount, invoice reference and due date.",
      "Summarise the run: total value, payment count, and the largest payments by value.",
      "Flag payments to vendors created or amended within the sensitivity window, and to vendors with no prior payment history.",
      "Flag payments falling materially outside that vendor's typical amount, and any invoice being paid ahead of its due date.",
      "Write a one-page approver brief leading with the exceptions.",
    ],
    tools: ["sql_query", "write_file"],
    inputs: [
      { label: "Payment run reference", hint: "Which proposed run to brief on" },
      { label: "Sensitivity window", hint: "How recently a vendor change counts as a flag, e.g. 30 days" },
    ],
    output: {
      format: "Markdown brief",
      instructions:
        "Keep it to one page. Exceptions first, totals second. The brief informs a human approval — it never constitutes one.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 14 },
  },

  /* ── Planning and analysis ────────────────────────────────── */
  {
    name: "Budget versus Actual Narrator",
    archetype: "author",
    domain: "financial planning",
    purpose:
      "Writes the budget variance story by department, separating price, volume and timing.",
    brief:
      "Take the budget against actuals by department and write the story: what is over, what is under, how much of it is timing rather than a real overspend, and what the full-year outturn looks like if it continues.",
    steps: [
      "Read the budget and actual results and calculate the variance for every department and line, in value and percentage.",
      "Keep the variances above the reporting threshold given.",
      "For each, separate the portion that is timing from the portion that is a genuine over or underspend, using the phasing supplied.",
      "Extrapolate each genuine variance to a full-year outturn.",
      "Write the commentary by department, with the forecast outturn and what would have to change to land on budget.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Budget and actuals", hint: "By department, for the period and year to date" },
      { label: "Reporting threshold", hint: "Variance size worth commenting on" },
      { label: "Budget phasing", hint: "How the budget was spread across the year" },
    ],
    output: {
      format: "Markdown commentary",
      instructions:
        "Separate timing from genuine variance explicitly — conflating them is the usual failure of this report. Do not assert a cause the data does not evidence.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 16 },
  },
  {
    name: "Rolling Forecast Assembler",
    archetype: "analyst",
    domain: "financial planning",
    purpose:
      "Rolls actuals into the forecast, reprojects the remaining periods and explains what changed.",
    brief:
      "Roll our forecast forward: replace the closed months with actuals, reproject the rest from the run rate and the drivers, and tell me what changed since the last version and why.",
    steps: [
      "Read the current forecast, the closed-period actuals and the driver assumptions.",
      "Replace forecast periods that are now closed with actuals.",
      "Reproject the remaining periods using the run rate and the drivers supplied, and state the basis for each line.",
      "Compare the new full-year view to the previous forecast and quantify every change.",
      "Write the reforecast with a bridge from the old view to the new one.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Current forecast", hint: "The forecast being rolled" },
      { label: "Actuals", hint: "Results for the periods now closed" },
      { label: "Driver assumptions", hint: "Volumes, rates or headcount driving the projection" },
    ],
    output: {
      format: "Markdown forecast",
      instructions: "The bridge must reconcile the old full-year number to the new one. State the projection basis for every line.",
    },
    trigger: { type: "schedule", schedule: "Every month once actuals are closed" },
    guardrails: { maxSteps: 16 },
  },
  {
    name: "Headcount Cost Modeller",
    archetype: "analyst",
    domain: "financial planning",
    purpose:
      "Turns a hiring plan into a phased people cost, fully loaded, by month and department.",
    brief:
      "Take our hiring plan and turn it into the actual monthly cost — salary, employer taxes, benefits, and the ramp from the start date — by department, and show what leavers give back.",
    steps: [
      "Read the hiring plan and the current headcount, with start dates, salaries and departments.",
      "Apply the loading rates given to convert each salary to a fully loaded cost.",
      "Phase each hire from its start date, including any partial first month, and phase leavers out.",
      "Aggregate the fully loaded cost by month and department, and compare it to the people budget supplied.",
      "Write a headcount cost schedule with the monthly profile and the variance to budget.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Hiring plan", hint: "Roles, start dates, salaries, departments" },
      { label: "Current headcount", hint: "Existing staff and any known leavers" },
      { label: "Loading rates", hint: "Employer taxes, benefits and other on-costs as a percentage" },
    ],
    output: {
      format: "Markdown cost schedule",
      instructions: "Show the monthly profile, not just the annual total — the phasing is the point. State the loading assumptions used.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 16 },
  },
  {
    name: "Unit Economics Calculator",
    archetype: "analyst",
    domain: "financial planning",
    purpose:
      "Works out what one unit actually costs and earns once shared costs are allocated properly.",
    brief:
      "Work out our true unit economics: revenue per unit, the direct cost, a fair share of the indirect cost, the contribution margin, and where the break-even volume sits.",
    steps: [
      "Read the cost and revenue data and separate costs into direct and indirect.",
      "Calculate revenue and direct cost per unit, and the resulting contribution margin.",
      "Allocate indirect costs across units on the basis given and state why that basis is reasonable.",
      "Calculate the fully absorbed cost per unit and the break-even volume.",
      "Test the sensitivity of the margin to a change in price, volume and direct cost, and write the analysis.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Cost and revenue data", hint: "Costs and revenue for the period, with volumes" },
      { label: "Allocation basis", hint: "How indirect costs should be spread, e.g. by volume or by revenue" },
    ],
    output: {
      format: "Markdown analysis",
      instructions:
        "Show contribution margin and fully absorbed margin separately — they answer different questions. Name the allocation basis wherever it affects a number.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 14 },
  },
  {
    name: "Scenario Sensitivity Runner",
    archetype: "analyst",
    domain: "financial planning",
    purpose:
      "Runs a base, upside and downside case over a plan and shows which assumption really matters.",
    brief:
      "Take our plan and run it under a downside, a base and an upside case. Flex the assumptions I give you, show the effect on profit and cash, and tell me which single assumption moves the answer most.",
    steps: [
      "Read the plan and identify the assumptions that drive it.",
      "Build the base case from the plan as it stands and state its outputs.",
      "Flex each assumption to its downside and upside values and recalculate profit and cash for each case.",
      "Vary one assumption at a time to rank them by how much each moves the result.",
      "Write a scenario summary with the three cases, the ranked sensitivities and the point at which the plan stops working.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Plan", hint: "The financial plan or model output to flex" },
      { label: "Scenario assumptions", hint: "Downside and upside values for each driver" },
    ],
    output: {
      format: "Markdown scenario summary",
      instructions: "Rank the sensitivities — knowing which assumption dominates is the deliverable. Show profit and cash separately.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 16 },
  },
  {
    name: "Board KPI Pack Builder",
    archetype: "author",
    domain: "management reporting",
    purpose:
      "Assembles the board metrics from source, with movements, trends and the commentary already written.",
    brief:
      "Pull the board metrics straight from source each month, show the movement and the trend on each, flag the ones off target, and write the commentary so the pack is ready to review rather than ready to build.",
    steps: [
      "Query the source tables for every metric in the pack definition, for the current and comparative periods.",
      "Calculate each metric, its movement against prior period and prior year, and its position against target.",
      "Flag every metric outside its tolerance and describe the trend over the periods available.",
      "Write commentary for each flagged metric explaining the movement from the underlying data.",
      "Write the pack with the metric table first and the commentary beneath.",
    ],
    tools: ["sql_query", "write_file"],
    inputs: [
      { label: "Pack definition", hint: "Which metrics, how each is calculated, and its target" },
      { label: "Period", hint: "Reporting period for the pack" },
    ],
    output: {
      format: "Markdown board pack",
      instructions:
        "Every metric shows the query behind it. If a metric cannot be calculated from the data, say so — never estimate a board number.",
    },
    trigger: { type: "schedule", schedule: "Every month on the fifth working day" },
    guardrails: { maxSteps: 18 },
  },
  {
    name: "Departmental Spend Benchmarker",
    archetype: "analyst",
    domain: "cost management",
    purpose:
      "Compares spend per category across departments and against external reference points.",
    brief:
      "Compare what each department spends per head by category, show me who is the outlier, and check our overall ratios against what is normal for organisations of our size.",
    steps: [
      "Read the spend data and calculate spend per head by department and category.",
      "Identify outliers where a department's spend per head diverges materially from the peer group.",
      "Search for published benchmark ranges for the main categories at a comparable size and sector.",
      "Compare our ratios to the benchmark ranges, being explicit about how comparable the basis is.",
      "Write a benchmark report with the internal comparison first and the external one second.",
    ],
    tools: ["read_document", "web_search", "write_file"],
    inputs: [
      { label: "Spend data", hint: "Spend by department and category, with headcount" },
      { label: "Comparison basis", hint: "Size and sector to benchmark against" },
    ],
    output: {
      format: "Markdown benchmark report",
      instructions:
        "Cite a source for every external benchmark and state its basis. Where the basis does not match ours, say so rather than presenting the comparison as like for like.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 16 },
  },
  {
    name: "Capex Business Case Evaluator",
    archetype: "analyst",
    domain: "investment appraisal",
    purpose:
      "Tests a capital request's numbers, recalculates the returns and names the assumptions it rests on.",
    brief:
      "Someone has submitted a capital request. Check the arithmetic, recalculate the payback, net present value and internal rate of return properly, work out how wrong the key assumption can be before the case fails, and tell me what is missing.",
    steps: [
      "Read the business case and extract the investment, the projected cash flows and every assumption behind them.",
      "Recalculate payback, net present value at the discount rate given, and internal rate of return.",
      "Compare your figures to those claimed and explain any difference.",
      "Find the break-even point for the key assumptions — how far each can move before the case stops working.",
      "Write an appraisal note stating whether the case holds, what it depends on, and what evidence is missing.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Business case", hint: "The capital request with its cash flow projections" },
      { label: "Discount rate", hint: "Rate to use for net present value" },
    ],
    output: {
      format: "Markdown appraisal note",
      instructions:
        "Show your recalculation. Where the case depends on an assumption with no evidence behind it, name that plainly — it is usually the whole answer.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 16 },
  },

  /* ── Tax, standards and regulation ────────────────────────── */
  {
    name: "Indirect Tax Return Preparer",
    archetype: "operator",
    domain: "indirect tax",
    purpose:
      "Assembles the sales and purchase tax figures for a return and flags the transactions that will not survive review.",
    brief:
      "Prepare the numbers for our indirect tax return from the transaction data: output tax, input tax, the net position, and flag anything with a missing tax number, a rate that looks wrong, or a cross-border treatment that needs checking.",
    steps: [
      "Read the transaction listing and separate sales from purchases by tax code.",
      "Total the output tax on sales and the input tax on purchases by rate, and calculate the net position.",
      "Flag transactions with a missing or invalid tax registration number, a rate inconsistent with the goods or service, or exempt and zero-rated items that may be miscoded.",
      "Flag cross-border transactions whose treatment depends on facts not present in the data.",
      "Write a return preparation pack with the totals, the workings and the exceptions to clear.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Transaction listing", hint: "Sales and purchases with tax codes for the period" },
      { label: "Jurisdiction", hint: "Which country or region's return this is" },
    ],
    output: {
      format: "Markdown preparation pack",
      instructions:
        "Show the workings for every total. Exceptions must be cleared by a person before filing. This prepares figures for review; it is not tax advice and is not a filing.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 16 },
  },
  {
    name: "Tax Law Change Watcher",
    archetype: "sentinel",
    domain: "tax compliance",
    purpose:
      "Watches the jurisdictions you operate in for tax changes and reports what actually affects you.",
    brief:
      "Watch for tax changes in the countries we operate in — rates, thresholds, filing deadlines, new reporting rules — and tell me what changed, when it takes effect, and what it means for us. Skip anything that does not touch us.",
    steps: [
      "Search for tax changes announced in each jurisdiction listed, within the period given.",
      "Retrieve the official source for each change and confirm the effective date from it.",
      "Discard changes that do not apply to the taxes and activities listed.",
      "For each remaining change, state what it alters, when it applies from, and what the organisation would have to do.",
      "Write a change digest ordered by effective date, soonest first.",
    ],
    tools: ["web_search", "fetch_url", "write_file"],
    inputs: [
      { label: "Jurisdictions", hint: "Countries or regions you operate in" },
      { label: "Taxes in scope", hint: "e.g. corporate income tax, VAT, payroll taxes" },
      { label: "Period", hint: "How far back to look, e.g. the last month" },
    ],
    output: {
      format: "Markdown digest",
      instructions:
        "Cite the official source URL for every change and prefer the authority's own page over commentary. Where a change is proposed rather than enacted, say so. This is a monitoring summary, not tax advice.",
    },
    trigger: { type: "schedule", schedule: "Every Monday at 08:00" },
    guardrails: { maxSteps: 18 },
  },
  {
    name: "Transfer Pricing File Drafter",
    archetype: "author",
    domain: "international tax",
    purpose:
      "Drafts the local file narrative — entity, transactions, functions, risks and method — from the source material.",
    brief:
      "Draft the transfer pricing local file from our entity information and intercompany transaction data: describe the business, list the related party transactions, set out the functions, assets and risks on each side, and explain the method chosen.",
    steps: [
      "Read the entity information and the intercompany transaction data.",
      "Draft the entity description: what it does, its structure and its place in the group.",
      "List every related party transaction with counterparty, nature, value and the pricing basis applied.",
      "Set out the functions performed, assets used and risks borne by each side of the material transactions.",
      "Explain the pricing method selected for each transaction category and why it fits, then write the file.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Entity information", hint: "Structure, activities and financials of the entity" },
      { label: "Intercompany transactions", hint: "Related party transactions with values and terms" },
      { label: "Pricing policy", hint: "The group's transfer pricing policy, if documented" },
    ],
    output: {
      format: "DOCX document",
      instructions:
        "Only state facts present in the source material; mark every gap as 'to be completed' rather than filling it. A tax specialist reviews and owns this file — you are drafting it.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 18 },
  },
  {
    name: "Withholding Tax Rate Look-up",
    archetype: "analyst",
    domain: "international tax",
    purpose:
      "Finds the treaty withholding rate for a cross-border payment and the conditions attached to it.",
    brief:
      "We are paying an entity in another country. Find the domestic withholding rate, the treaty rate between the two countries for that payment type, and what we have to hold on file to claim the lower rate.",
    steps: [
      "Search for the domestic withholding tax rate in the payer's jurisdiction for the payment type given.",
      "Find whether a double tax treaty is in force between the two jurisdictions and retrieve the article covering that payment type.",
      "Read the treaty article for the reduced rate and the conditions attached to claiming it.",
      "Identify the documentation required, such as a residence certificate or a beneficial ownership declaration.",
      "Write a look-up note with both rates, the article reference and the documentation checklist.",
    ],
    tools: ["web_search", "fetch_url", "write_file"],
    inputs: [
      { label: "Payer jurisdiction", hint: "Where the payment is made from" },
      { label: "Recipient jurisdiction", hint: "Where the recipient is resident" },
      { label: "Payment type", hint: "e.g. dividends, interest, royalties, services" },
    ],
    output: {
      format: "Markdown look-up note",
      instructions:
        "Cite the treaty article and a source URL for every rate. If you cannot confirm a treaty is in force, say so rather than assuming. This is research to hand to a tax adviser, not advice.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 16 },
  },
  {
    name: "Accounting Standards Update Monitor",
    archetype: "sentinel",
    domain: "financial reporting",
    purpose:
      "Tracks new and amended accounting standards and reports the ones that touch your balances.",
    brief:
      "Keep track of new and amended accounting standards under our framework, and tell me which ones actually affect us given the balances we carry, when they bite, and what we would have to do.",
    steps: [
      "Search the standard setter's publications for new and amended standards issued or effective in the window given.",
      "Retrieve the official page for each and confirm its effective date and transition provisions.",
      "Assess each against the balances and transaction types listed and discard those with no application.",
      "For each relevant standard, describe what changes, the effective date, and the practical work it creates.",
      "Write an impact digest ordered by effective date.",
    ],
    tools: ["web_search", "fetch_url", "write_file"],
    inputs: [
      { label: "Reporting framework", hint: "e.g. IFRS, US GAAP, or a local framework" },
      { label: "Balances in scope", hint: "The significant balances and transactions you carry" },
      { label: "Window", hint: "How far ahead and behind to look, e.g. issued in the last year" },
    ],
    output: {
      format: "Markdown impact digest",
      instructions:
        "Cite the standard setter's own page for every item. Distinguish issued, effective and early-adoptable clearly. A technical accountant assesses the impact — you are flagging what to assess.",
    },
    trigger: { type: "schedule", schedule: "Every quarter" },
    guardrails: { maxSteps: 18 },
  },
  {
    name: "Lease Schedule Builder",
    archetype: "operator",
    domain: "financial reporting",
    purpose:
      "Turns a lease contract into the liability and right-of-use schedules with the entries to post.",
    brief:
      "Take this lease, work out the present value of the payments, and build me the liability amortisation schedule, the right-of-use asset depreciation schedule and the journal entries for each period.",
    steps: [
      "Read the lease and extract the term, the payment amounts and dates, any escalation, options and incentives.",
      "Determine the lease term to use, taking account of options reasonably certain to be exercised, and state your reasoning.",
      "Discount the payments at the rate given to calculate the opening liability and right-of-use asset.",
      "Build the liability amortisation schedule with interest and payment for every period, and the straight-line depreciation schedule for the asset.",
      "Write the schedules with the period journal entries and the disclosure figures beneath them.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Lease contract", hint: "The signed lease" },
      { label: "Discount rate", hint: "Incremental borrowing rate or rate implicit in the lease" },
      { label: "Framework", hint: "IFRS 16 or ASC 842" },
    ],
    output: {
      format: "XLSX schedule",
      instructions:
        "Show the discounting workings. State every judgement — lease term, options, discount rate — explicitly, because they drive the whole schedule and a person must agree them.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 18 },
  },
  {
    name: "Revenue Recognition Assessor",
    archetype: "analyst",
    domain: "financial reporting",
    purpose:
      "Works a customer contract through the five-step model and proposes the recognition pattern.",
    brief:
      "Take this customer contract and work it through the revenue standard step by step — the performance obligations, the transaction price including anything variable, how the price should be allocated, and when each obligation is satisfied.",
    steps: [
      "Read the contract and confirm it meets the criteria for a contract with a customer.",
      "Identify each distinct performance obligation and explain why it is distinct.",
      "Determine the transaction price, including variable consideration, and state how you constrained it.",
      "Allocate the price across the obligations on standalone selling prices and show the allocation.",
      "Determine whether each obligation is satisfied over time or at a point in time, and write the assessment with the resulting revenue profile.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Customer contract", hint: "The signed contract and any related order forms" },
      { label: "Standalone selling prices", hint: "Your list or observable prices for each element" },
    ],
    output: {
      format: "Markdown assessment",
      instructions:
        "Work the five steps in order and show each one. Cite the contract clause behind every conclusion. Where a judgement is finely balanced, say so — that is exactly what a reviewer needs to see.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 18 },
  },

  /* ── Controls, audit and risk ─────────────────────────────── */
  {
    name: "Control Evidence Collector",
    archetype: "operator",
    domain: "internal control",
    purpose:
      "Pulls the population, selects the sample and assembles the evidence pack for a control test.",
    brief:
      "For this control test, pull the full population from the system, take a sample the right way, gather the evidence for each item, and tell me what is missing before the auditor asks.",
    steps: [
      "Query the source system for the full population the control covers in the test period, and record the population size.",
      "Select the sample using the method and size given, and record how each item was selected so the selection can be reproduced.",
      "For each selected item, retrieve the attributes the control requires, such as approver, approval date and amount.",
      "Test each item against the control's criteria and mark it passed, failed or evidence missing.",
      "Write an evidence pack with the population, the selection method, the sample and the result for every item.",
    ],
    tools: ["sql_query", "write_file"],
    inputs: [
      { label: "Control description", hint: "What the control is and what evidences it operating" },
      { label: "Test period", hint: "Period the test covers" },
      { label: "Sample method and size", hint: "e.g. random 25, or every item above a threshold" },
    ],
    output: {
      format: "Markdown evidence pack",
      instructions:
        "The selection must be reproducible — record exactly how it was made. Never mark an item passed without the attribute values that evidence it. Conclusions on control effectiveness are for the control owner.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 18 },
  },
  {
    name: "Segregation of Duties Conflict Detector",
    archetype: "sentinel",
    domain: "internal control",
    purpose:
      "Tests who can do which combinations of things, and whether anyone has actually done both.",
    brief:
      "Check our user access against the conflict rules: who can both raise and approve, who can create a vendor and pay it, who can post and review. Then tell me which of those people actually did both.",
    steps: [
      "Query user access for the roles and permissions held by each user.",
      "Evaluate every user against each conflict rule in the matrix given and list the conflicts held.",
      "For each conflict, query the transaction history for cases where that user actually performed both sides.",
      "Separate the findings into conflicts that are theoretical and conflicts that were exercised.",
      "Write a conflict report with the exercised conflicts first, naming the transactions involved.",
    ],
    tools: ["sql_query", "write_file"],
    inputs: [
      { label: "Conflict matrix", hint: "Which role or permission combinations are incompatible" },
      { label: "Review period", hint: "Period over which to test actual activity" },
    ],
    output: {
      format: "Markdown conflict report",
      instructions:
        "Exercised conflicts come first — a conflict acted on is a different matter from one merely held. Cite the transaction references. Report the facts; whether a conflict is acceptable is a decision for a person.",
    },
    trigger: { type: "schedule", schedule: "Every quarter" },
    guardrails: { maxSteps: 18 },
  },
  {
    name: "Fraud Red Flag Scanner",
    archetype: "sentinel",
    domain: "forensic review",
    purpose:
      "Runs the standard analytics over a transaction population and surfaces what warrants a closer look.",
    brief:
      "Run the usual analytics over this transaction data — digit distribution, amounts just under approval limits, round numbers, unusual timing, sequences that break — and tell me what deserves a closer look.",
    steps: [
      "Read the transaction data and identify the amount, date, user, counterparty and reference columns.",
      "Test the leading digit distribution of the amounts against the expected pattern and report the deviations.",
      "Flag amounts clustering just below the approval thresholds given, unusually round amounts, and transactions outside normal hours.",
      "Flag gaps and duplicates in reference sequences, and counterparties appearing only once for a material amount.",
      "Rank the findings by how far each departs from the population norm and write a review list with the reasoning for each.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Transaction data", hint: "The population to scan" },
      { label: "Approval thresholds", hint: "The limits people might structure around" },
    ],
    output: {
      format: "Markdown review list",
      instructions:
        "Every flag is a question for a human reviewer and nothing more. Never describe a transaction or a person as fraudulent, and do not name individuals as suspects — describe the pattern and cite the transaction reference.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 18 },
  },
  {
    name: "Audit Request Responder",
    archetype: "operator",
    domain: "external audit",
    purpose:
      "Works the auditor's request list, matches each item to what you hold and chases what is missing.",
    brief:
      "Take the auditor's request list, work out which items we have already provided or can satisfy from what we hold, and give me a tracker showing what is outstanding, who owns it and what is now overdue.",
    steps: [
      "Read the auditor's request list and normalise it into individual items with owners and due dates.",
      "Match each request against the documents provided and mark it satisfied, partially satisfied or outstanding.",
      "For partially satisfied items, state precisely what more is needed.",
      "Flag items past their due date and calculate how late each is.",
      "Write a tracker grouped by status, with overdue items first.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Auditor request list", hint: "The prepared-by-client list" },
      { label: "Documents provided", hint: "An index of what has already gone across" },
    ],
    output: {
      format: "Markdown tracker",
      instructions:
        "Never mark an item satisfied unless you can name the document that satisfies it. Give counts by status in the first line.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 16 },
  },
  /* ── Reporting and the outside world ──────────────────────── */
  {
    name: "Management Report Narrative Writer",
    archetype: "author",
    domain: "management reporting",
    purpose:
      "Writes the narrative section of the monthly pack from the numbers, in the register the board reads.",
    brief:
      "Take the monthly numbers and write the narrative for the pack — how the month went, what drove it, where we are against plan for the year, and what the reader should be worried about.",
    steps: [
      "Read the monthly results, the comparatives and the year-to-date position.",
      "Identify the four or five movements that genuinely explain the month.",
      "Write the performance narrative: what happened, what caused it, and how it compares to plan and prior year.",
      "Write a forward section covering the year-to-date trajectory and the risks visible in the numbers.",
      "Write the narrative to a file with a short executive summary at the top.",
    ],
    tools: ["read_document", "write_file"],
    inputs: [
      { label: "Monthly results", hint: "This month, prior month, prior year and year to date" },
      { label: "Plan", hint: "Budget or forecast for the comparison" },
    ],
    output: {
      format: "DOCX document",
      instructions:
        "Plain language, no filler, every claim tied to a number in the pack. Do not soften a bad month, and do not assert a cause the data does not show.",
    },
    trigger: { type: "schedule", schedule: "Every month once results are final" },
    guardrails: { maxSteps: 16 },
  },
  {
    name: "Lender and Investor Q&A Preparer",
    archetype: "author",
    domain: "external reporting",
    purpose:
      "Anticipates the questions a lender or investor will ask of your numbers, and drafts the answers.",
    brief:
      "Before the lender review, go through our results the way they will, work out the questions they are going to ask about the awkward bits, and draft answers grounded in our own numbers.",
    steps: [
      "Read the financial results and identify the movements and ratios an external reader will question.",
      "Search for the questions lenders and investors typically ask about this pattern of results.",
      "Draft the ten to fifteen questions most likely to come up, hardest first.",
      "Draft an answer to each, grounded in the figures, and note where our own data does not fully answer it.",
      "Write a briefing pack with each question, the answer and the supporting figures.",
    ],
    tools: ["read_document", "web_search", "write_file"],
    inputs: [
      { label: "Financial results", hint: "The results being presented" },
      { label: "Audience", hint: "Lender, existing investor, or prospective investor" },
    ],
    output: {
      format: "Markdown briefing pack",
      instructions:
        "Put the hardest questions first — a briefing that dodges them is worthless. Where our data does not support a confident answer, say so rather than drafting a claim that cannot be stood behind.",
    },
    trigger: { type: "manual" },
    guardrails: { maxSteps: 18 },
  },
  {
    name: "Counterparty Financial Health Monitor",
    archetype: "sentinel",
    domain: "third party risk",
    purpose:
      "Watches your significant customers and suppliers for public signs of financial trouble.",
    brief:
      "Keep an eye on our significant customers and suppliers. Watch for filed accounts, late filings, restructuring, insolvency notices, layoffs or credit downgrades, and tell me who has changed since last time and what our exposure to them is.",
    steps: [
      "Search public sources for recent filings, notices and news on each counterparty in the list.",
      "Retrieve the official record for anything material and confirm it from the source.",
      "Classify each counterparty as stable, watch or concern, with the evidence for that rating.",
      "For every counterparty rated watch or concern, state the exposure from the figures supplied and what is at risk.",
      "Write a monitoring report leading with the counterparties whose rating has changed.",
    ],
    tools: ["web_search", "fetch_url", "write_file"],
    inputs: [
      { label: "Counterparty list", hint: "Significant customers and suppliers, with legal entity names" },
      { label: "Exposure", hint: "Your balance or annual spend with each" },
    ],
    output: {
      format: "Markdown monitoring report",
      instructions:
        "Cite a source URL for every signal, and prefer an official register over news. Absence of news is not evidence of health — say when you found nothing. Ratings are indicative and for a person to act on.",
    },
    trigger: { type: "schedule", schedule: "Every Monday at 08:00" },
    guardrails: { maxSteps: 18 },
  },
];
