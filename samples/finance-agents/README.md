# Test files for the finance agents

Made-up data, with known answers, for trying the reconciliation agents. Every company, person and GSTIN is fictitious.

Each folder holds the two files the agent takes and `answer-key.json`, which says what a correct result contains.

The bank folder also has both files as Excel workbooks (`.xlsx`), laid out the way the downloads really are: the bank statement with the account details above the table and a summary below it, and the bank book with the company and period above the headings. Upload either the CSV or the Excel version — the answers are the same.

| Agent | Upload as… | …and | What it should find |
| :--- | :--- | :--- | :--- |
| **Bank Reconciliation** | Bank statement: `HDFC_statement_Sep2026.csv` | Bank book: `bank_book_Sep2026.csv` | Balance per bank ₹10,48,405.32, per books ₹10,99,955.67, both adjusted to ₹12,08,650.22. Four unpresented cheques, three deposits in transit, bank charges and interest, two direct debits, two direct credits, a returned cheque, two amounts keyed wrongly and one payment entered twice. |
| **Vendor Reconciliation** | Vendor statement: `Shakti_Packaging_statement_Apr-Sep2026.csv` | Our vendor ledger: `AP_ledger_V2031_Apr-Sep2026.csv` | Vendor says ₹21,44,796.80, our books say ₹11,49,377.42. The ₹9,95,419.38 difference is fully explained: three invoices not in our books, one not in theirs, two amount differences, a payment not yet in their statement, two of their credit notes, our debit note and TDS. |
| **GST ITC Reconciliation (GSTR-2B)** | GSTR-2B: `GSTR-2B_27AACCF4821K_Sep2026.csv` | Purchase register: `purchase_register_Sep2026.csv` | ITC as per books ₹48,95,308.67, as per GSTR-2B ₹47,19,055.29, eligible ₹45,84,295.36, at risk ₹2,71,643.73, in 2B but not booked ₹1,12,913.91 — plus tax amount, tax head, GSTIN and invoice number mismatches, a duplicate and blocked ITC. |

## Trying one

1. Open **Agents**, find the agent and click **Chat**.
2. Attach both files (the paperclip slots, or drag them onto the message box) and ask, for example, "Reconcile these two files and show me the result."
3. The answer comes back as a dashboard with Excel, PDF and PowerPoint downloads. Compare its figures with the table above or with `answer-key.json`.
4. Ask a follow-up in the same conversation — "Which suppliers should I chase first?", "Draft the journal entries", "Write an email to the vendor listing what they need to correct".

The files are in the formats real exports use: Indian amount formatting (`1,25,000.00`), `dd/mm/yy`, `01-Sep-2026` and `dd.mm.yyyy` dates, cheque numbers with leading zeros, SAP signed amounts and Tally debit / credit columns. The agents read them as they are; nothing needs cleaning first. Excel files must be `.xlsx` — an old `.xls` has to be saved as `.xlsx` or CSV first.
